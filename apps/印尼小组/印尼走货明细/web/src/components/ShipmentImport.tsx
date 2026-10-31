import { useState } from 'react'
import { Alert, App, Button, Descriptions, Image, InputNumber, Modal, Select, Space, Table, Upload } from 'antd'
import { api, type Dictionaries, type Material } from '../api/client'
import { importShipmentFile, matchShipmentMaterial, planShipmentImport, type ExistingShipmentImportRow, type ShipmentImportItem, type ShipmentImportRow } from '../utils/shipmentImport'
import { toolImportDefaults } from '../utils/toolImportDefaults'
import { createCartonGroupId } from '../utils/cartonGroupId'
import ShipmentImportSource from './ShipmentImportSource'
import { shipmentGrossPerPc, shipmentWeightQuantity } from '../utils/shipmentWeight'
import { isShipmentCountUnit } from '../utils/shipmentDeclaration'
import { applyShipmentImport } from '../utils/shipmentImportApply'

const currencies = ['¥', 'US$', 'HK$', 'IDR'].map(value => ({ value, label: value }))
export default function ShipmentImport({ existing, materials, onImport }: {
  existing: ExistingShipmentImportRow[]; materials: ReadonlyMap<number, Material>
  onImport: (rows: ShipmentImportItem[], targets: number[]) => void | boolean
}) {
  const { message } = App.useApp()
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<ShipmentImportRow[] | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [fileName, setFileName] = useState('')
  const selected = (rows || []).filter(row => row.selected)
  const matching = existing.map(row => ({ ...row, material_snapshot: materials.get(row.material_id!) || row.material_snapshot }))
  const targets = planShipmentImport(selected.map(row => row.item), matching)
  const targetByKey = new Map(selected.map((row, index) => [row.key, targets[index]]))
  const linkedTarget = (row: ShipmentImportRow) => {
    const target = targetByKey.get(row.key)
    return target != null && target >= 0 && existing[target]?.outbound_id ? existing[target] : undefined
  }
  const preview = (() => {
    if (!selected.length || targets.some(target => target < -1)) return {}
    try {
      return { items: applyShipmentImport(existing, materials, selected.map(row => row.item), targets) }
    } catch (error) { return { error: (error as Error).message } }
  })()
  const displayItem = (row: ShipmentImportRow): ShipmentImportItem => {
    const target = targetByKey.get(row.key), linked = linkedTarget(row)
    const value = linked && (preview.items?.[target!] || linked)
    return value ? { ...value, material_snapshot: value.material_snapshot || materials.get(value.material_id!) || row.item.material_snapshot } : row.item
  }
  const change = (key: string, fields: Partial<ShipmentImportItem>) => setRows(current => current!.map(r => {
    if (r.key !== key) return r
    const item = { ...r.item, ...fields }
    if ('qty' in fields && isShipmentCountUnit(item.material_snapshot.unit_kg)) item.kg = fields.qty
    return { ...r, item }
  }))
  async function read(file: File) {
    setBusy(true)
    try {
      const result = await importShipmentFile(file)
      if (!result.rows.length) throw new Error(result.warnings.join('；'))
      const candidates: Material[] = []
      const notices = [...result.warnings]
      let dicts: Dictionaries = { hs: [], suppliers: [], translations: [] }
      try {
        const [tools, dictionaries] = await Promise.all([api.get<Material[]>('/materials/tools'), api.get<Dictionaries>('/dictionaries')])
        candidates.push(...tools.data); dicts = dictionaries.data
      } catch { notices.push('工具库或字典未加载成功，本次仅使用文件资料，请核对') }
      const codes = [...new Set(result.rows.map(r => r.item.material_snapshot.product_code).filter((v): v is string => !!v))]
      // Bound concurrent requests for large files.
      for (let i = 0; i < codes.length; i += 4) await Promise.all(codes.slice(i, i + 4).map(async code => {
        try { const { data } = await api.get<Material[]>('/materials', { params: { code } }); candidates.push(...data) }
        catch { notices.push(`货号 ${code} 的资料库未加载，使用文件资料`) }
      }))
      const groupIds = new Map<string, string>()
      const imported = result.rows.map(row => {
        const matched = matchShipmentMaterial(row.item.material_snapshot, candidates)
        const enriched = toolImportDefaults(matched.material, dicts)
        const item = { ...row.item, material_snapshot: enriched.material,
          supplier: row.item.supplier || enriched.material.supplier,
          customs_company: row.item.customs_company || enriched.material.customs_company }
        if (item.carton_group) {
          const key = JSON.stringify([item.carton_group, item.supplier || '', item.customs_company || ''])
          if (!groupIds.has(key)) groupIds.set(key, createCartonGroupId())
          item.carton_group = groupIds.get(key)
        }
        return { ...row, item, warnings: [...row.warnings, ...enriched.warnings,
          matched.matches === 1 ? '已匹配资料库；文件值仅保存在本次走货单，不覆盖资料库' :
            matched.matches > 1 ? '匹配到多条物料，未自动关联；使用文件资料' : '未匹配资料库；使用文件资料'] }
      })
      // An incomplete/invalid merged carton count must be reviewed manually.
      const bad = new Set(imported.filter(r => r.item.carton_group && !(Number(r.item.cartons) > 0)).map(r => r.item.carton_group))
      imported.forEach(r => { if (bad.has(r.item.carton_group)) { r.item.carton_group = undefined; r.warnings.push('合并箱数无有效数值，导入后请重新合并') } })
      setRows(imported); setWarnings(notices); setFileName(file.name)
    } catch (e) { message.error(e instanceof Error ? e.message : '读取失败') }
    finally { setBusy(false) }
    return false
  }
  function confirm() {
    if (!selected.length) return
    if (targets.some(t => t < -1)) { message.warning('请取消勾选待核对行：重复匹配无法确定覆盖对象，请核对原明细后重试'); return }
    if (selected.some(r => !linkedTarget(r) && r.item.price != null && !r.item.currency)) { message.warning('请补充采购币种后导入'); return }
    if (onImport(selected.map(r => r.item), targets) === false) return
    setRows(null)
    message.success(`已更新 ${targets.filter(t => t >= 0).length} 行，新增 ${targets.filter(t => t === -1).length} 行，请点击走货单“保存”`)
  }
  return <>
    <Upload accept=".xlsx" showUploadList={false} beforeUpload={read} disabled={busy}>
      <Button size="small" loading={busy}>Excel 导入走货资料</Button>
    </Upload>
    <Modal title={`导入走货资料 — ${fileName}`} open={rows !== null} width="95vw" onCancel={() => setRows(null)}
      onOk={confirm} okText="确认导入（相同更新，新增追加）" okButtonProps={{ disabled: !(rows || []).some(r => r.selected) }}>
      <Alert type="info" showIcon message="支持新版清溪表：按列名识别，不依赖固定位置。主明细所有字段及公式缓存值保存在“原表资料”，合同、发票、汇总等配套表不重复导成物料。按货号、中文名、规格、供应商匹配当前明细；唯一匹配更新有值字段，空白保留原值，无匹配则追加。已关联出库行仅更新装箱和报关资料，原出库关联、数量重量、申报单位及采购来源/单价保持不变。重复匹配仍需核对。不改资料库或整柜设置，发票价格按系统规则重算。" />
      {warnings.length > 0 && <Alert type="warning" message={warnings.join('；')} />}
      {preview.error && <Alert type="warning" message={preview.error} />}
      <Space style={{ margin: '12px 0' }} wrap>
        <span>识别 {(rows || []).length} 行，已选 {(rows || []).filter(r => r.selected).length} 行</span>
        <Select mode="multiple" style={{ minWidth: 320 }} placeholder="选择工作表"
          value={[...new Set((rows || []).filter(r => r.selected).map(r => r.sheet))]}
          options={[...new Set((rows || []).map(r => r.sheet))].map(value => ({ value, label: value }))}
          onChange={sheets => setRows(current => current!.map(r => ({ ...r, selected: sheets.includes(r.sheet) })))} />
        <Select placeholder="空白币种统一设置" style={{ width: 190 }} value={null} options={currencies}
          onChange={currency => setRows(current => current!.map(r => ({ ...r, item: { ...r.item, currency: r.item.currency || currency || undefined } })))} />
      </Space>
      <Table<ShipmentImportRow> rowKey="key" dataSource={rows || []} size="small" pagination={{ pageSize: 15 }} scroll={{ x: 1700, y: 430 }}
        rowSelection={{ selectedRowKeys: (rows || []).filter(r => r.selected).map(r => r.key), onChange: keys => setRows(current => current!.map(r => ({ ...r, selected: keys.includes(r.key) }))) }}
        expandable={{ expandedRowRender: r => <><Descriptions size="small" column={3} items={[
          { key: 'spec', label: '规格', children: displayItem(r).material_snapshot.spec || '—' },
          { key: 'en', label: '英文名', children: displayItem(r).material_snapshot.name_en || '—' },
          { key: 'hs', label: 'HS 中 / 印尼', children: `${displayItem(r).material_snapshot.hs_cn || '—'} / ${displayItem(r).material_snapshot.hs_id || '—'}` },
          { key: 'qpc', label: '每箱数量', children: displayItem(r).qty_per_carton || '—' },
          { key: 'box', label: '箱号 / 卡板', children: `${displayItem(r).carton_no || '—'} / ${displayItem(r).pallet || '—'}` },
          { key: 'dim', label: '长 / 宽 / 高 cm', children: [displayItem(r).material_snapshot.length, displayItem(r).material_snapshot.width, displayItem(r).material_snapshot.height].map(v => v ?? '—').join(' / ') },
          { key: 'weights', label: '毛重 / 净重 kg', children: [
            shipmentGrossPerPc(displayItem(r).material_snapshot.weight_per_carton, displayItem(r).weighing_qty) * shipmentWeightQuantity(displayItem(r).material_snapshot.name_zh, displayItem(r).qty),
            Number(displayItem(r).material_snapshot.net_per_pc || 0) * shipmentWeightQuantity(displayItem(r).material_snapshot.name_zh, displayItem(r).qty),
          ].map(v => v.toFixed(2)).join(' / ') },
          { key: 'department', label: '使用部门', children: displayItem(r).material_snapshot.department || '—' },
          { key: 'source', label: '完整源字段', children: <ShipmentImportSource source={displayItem(r).material_snapshot.import_source} /> },
          { key: 'date', label: '采购日期', children: displayItem(r).po_date || '—' },
          { key: 'contract', label: '合同 / 日期', children: `${displayItem(r).contract_no || '—'} / ${displayItem(r).contract_date || '—'}` },
          { key: 'invoice', label: '发票 / 日期', children: `${displayItem(r).invoice_no || '—'} / ${displayItem(r).invoice_date || '—'}` },
        ]} />{r.warnings.map((w, i) => <div key={i}>{w}</div>)}</> }}
        columns={[
          { title: '导入方式', width: 150, render: (_, r) => {
            const target = targetByKey.get(r.key)
            if (target == null) return '未勾选'
            return target === -1 ? '新增' : target === -2 ? '待核对：重复匹配' : `更新已有第 ${target + 1} 行${linkedTarget(r) ? '（保留出库）' : ''}`
          } },
          { title: '来源', render: (_, r) => `${r.sheet} 第${r.row}行`, width: 180 },
          { title: '图片', width: 60, render: (_, r) => displayItem(r).material_snapshot.image ? <Image width={40} src={displayItem(r).material_snapshot.image} /> : '—' },
          { title: '货号 / 物料', width: 230, render: (_, r) => <>{displayItem(r).material_snapshot.product_code}<br />{displayItem(r).material_snapshot.name_zh}</> },
          { title: '供应商 / 报关公司', width: 220, render: (_, r) => <>{displayItem(r).supplier}<br />{displayItem(r).customs_company || '未填'}</> },
          { title: '送货数量', width: 110, render: (_, r) => <InputNumber min={0} readOnly={!!linkedTarget(r)} title={linkedTarget(r) ? '保留原出库分配数量' : undefined} value={linkedTarget(r) ? linkedTarget(r)!.qty : displayItem(r).qty} onChange={v => change(r.key, { qty: v ?? undefined })} style={{ width: '100%' }} /> },
          { title: '申报数量 / 单位', width: 130, render: (_, r) => <><InputNumber min={0} readOnly={!!linkedTarget(r) || isShipmentCountUnit(displayItem(r).material_snapshot.unit_kg)} title={linkedTarget(r) ? '保留原申报数量及单位' : undefined} value={linkedTarget(r) ? linkedTarget(r)!.kg : displayItem(r).kg} onChange={v => change(r.key, { kg: v ?? undefined })} style={{ width: '100%' }} />{displayItem(r).material_snapshot.unit_kg}</> },
          { title: '箱数', width: 90, render: (_, r) => <>{displayItem(r).cartons ?? '—'}{displayItem(r).carton_group ? '（共箱）' : ''}</> },
          { title: '采购单价 / 币种', width: 140, render: (_, r) => <>{(linkedTarget(r) ? linkedTarget(r)!.price : displayItem(r).price) ?? '—'}<Select style={{ width: '100%' }} disabled={!!linkedTarget(r)} value={linkedTarget(r) ? linkedTarget(r)!.currency : displayItem(r).currency} options={currencies} onChange={currency => change(r.key, { currency })} /></> },
          { title: '采购单号', width: 150, render: (_, r) => (linkedTarget(r) ? linkedTarget(r)!.po_no : displayItem(r).po_no) || '—' },
          { title: '核对提示', width: 230, render: (_, r) => r.warnings.join('；') },
        ]} />
    </Modal>
  </>
}
