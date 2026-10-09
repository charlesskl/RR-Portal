import { useState } from 'react'
import { Alert, App, Button, Descriptions, Image, InputNumber, Modal, Select, Space, Table, Upload } from 'antd'
import { api, type Dictionaries, type Material } from '../api/client'
import { importShipmentFile, matchShipmentMaterial, planShipmentImport, type ExistingShipmentImportRow, type ShipmentImportItem, type ShipmentImportRow } from '../utils/shipmentImport'
import { toolImportDefaults } from '../utils/toolImportDefaults'
import { createCartonGroupId } from '../utils/cartonGroupId'

const currencies = ['¥', 'US$', 'HK$', 'IDR'].map(value => ({ value, label: value }))
export default function ShipmentImport({ existing, onImport }: { existing: ExistingShipmentImportRow[]; onImport: (rows: ShipmentImportItem[], targets: number[]) => void }) {
  const { message } = App.useApp()
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<ShipmentImportRow[] | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [fileName, setFileName] = useState('')
  const change = (key: string, fields: Partial<ShipmentImportItem>) => setRows(current => current!.map(r => r.key === key ? { ...r, item: { ...r.item, ...fields } } : r))
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
    const selected = (rows || []).filter(row => row.selected)
    if (!selected.length) return
    if (selected.some(r => r.item.price != null && !r.item.currency)) { message.warning('请补充采购币种后导入'); return }
    const targets = planShipmentImport(selected.map(r => r.item), existing)
    if (targets.some(t => t < -1)) { message.warning('请取消勾选待核对行：重复匹配无法确定覆盖对象，已关联出库的行需在原明细中修改'); return }
    onImport(selected.map(r => r.item), targets); setRows(null)
    message.success(`已更新 ${targets.filter(t => t >= 0).length} 行，新增 ${targets.filter(t => t === -1).length} 行，请点击走货单“保存”`)
  }
  return <>
    <Upload accept=".xlsx" showUploadList={false} beforeUpload={read} disabled={busy}>
      <Button size="small" loading={busy}>Excel 导入走货资料</Button>
    </Upload>
    <Modal title={`导入走货资料 — ${fileName}`} open={rows !== null} width="95vw" onCancel={() => setRows(null)}
      onOk={confirm} okText="确认导入（相同更新，新增追加）" okButtonProps={{ disabled: !(rows || []).some(r => r.selected) }}>
      <Alert type="info" showIcon message="按货号、中文名、规格、供应商匹配当前走货明细；有采购单号、报关公司时一并核对。唯一匹配则更新文件中有值的字段，空白保留原值；没有匹配才追加。重复匹配或已关联出库的行需人工核对。不改资料库及整柜信息，发票价格按导出规则重算。" />
      {warnings.length > 0 && <Alert type="warning" message={warnings.join('；')} />}
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
          { key: 'spec', label: '规格', children: r.item.material_snapshot.spec || '—' },
          { key: 'en', label: '英文名', children: r.item.material_snapshot.name_en || '—' },
          { key: 'hs', label: 'HS 中 / 印尼', children: `${r.item.material_snapshot.hs_cn || '—'} / ${r.item.material_snapshot.hs_id || '—'}` },
          { key: 'qpc', label: '每箱数量', children: r.item.qty_per_carton || '—' },
          { key: 'box', label: '箱号 / 卡板', children: `${r.item.carton_no || '—'} / ${r.item.pallet || '—'}` },
          { key: 'dim', label: '长 / 宽 / 高 cm', children: [r.item.material_snapshot.length, r.item.material_snapshot.width, r.item.material_snapshot.height].map(v => v ?? '—').join(' / ') },
          { key: 'date', label: '采购日期', children: r.item.po_date || '—' },
          { key: 'contract', label: '合同 / 日期', children: `${r.item.contract_no || '—'} / ${r.item.contract_date || '—'}` },
          { key: 'invoice', label: '发票 / 日期', children: `${r.item.invoice_no || '—'} / ${r.item.invoice_date || '—'}` },
        ]} />{r.warnings.map((w, i) => <div key={i}>{w}</div>)}</> }}
        columns={[
          { title: '导入方式', width: 150, render: (_, r) => {
            const selected = (rows || []).filter(row => row.selected)
            const index = selected.findIndex(row => row.key === r.key)
            if (index < 0) return '未勾选'
            const target = planShipmentImport(selected.map(row => row.item), existing)[index]
            return target === -1 ? '新增' : target === -2 ? '待核对：重复匹配' : target === -3 ? '待核对：已关联出库' : `更新已有第 ${target + 1} 行`
          } },
          { title: '来源', render: (_, r) => `${r.sheet} 第${r.row}行`, width: 180 },
          { title: '图片', width: 60, render: (_, r) => r.item.material_snapshot.image ? <Image width={40} src={r.item.material_snapshot.image} /> : '—' },
          { title: '货号 / 物料', width: 230, render: (_, r) => <>{r.item.material_snapshot.product_code}<br />{r.item.material_snapshot.name_zh}</> },
          { title: '供应商 / 报关公司', width: 220, render: (_, r) => <>{r.item.supplier}<br />{r.item.customs_company || '未填'}</> },
          { title: '送货数量', width: 110, render: (_, r) => <InputNumber min={0} value={r.item.qty} onChange={v => change(r.key, { qty: v ?? undefined })} style={{ width: '100%' }} /> },
          { title: '申报量 / 单位', width: 130, render: (_, r) => <><InputNumber min={0} value={r.item.kg} onChange={v => change(r.key, { kg: v ?? undefined })} style={{ width: '100%' }} />{r.item.material_snapshot.unit_kg}</> },
          { title: '箱数', width: 90, render: (_, r) => <>{r.item.cartons ?? '—'}{r.item.carton_group ? '（共箱）' : ''}</> },
          { title: '采购单价 / 币种', width: 140, render: (_, r) => <>{r.item.price ?? '—'}<Select style={{ width: '100%' }} value={r.item.currency} options={currencies} onChange={currency => change(r.key, { currency })} /></> },
          { title: '采购单号', width: 150, render: (_, r) => r.item.po_no || '—' },
          { title: '核对提示', width: 230, render: (_, r) => r.warnings.join('；') },
        ]} />
    </Modal>
  </>
}
