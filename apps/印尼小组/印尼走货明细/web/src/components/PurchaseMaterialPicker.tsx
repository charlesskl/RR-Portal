import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Input, InputNumber, Modal, Select, Space, Table } from 'antd'
import { api, type Material } from '../api/client'
import { purchaseMaterialChoices, selectedPurchaseMaterials, type PurchaseMaterialChoice, type PurchaseMaterialGroup } from '../utils/purchaseMaterialSelection'

export default function PurchaseMaterialPicker({ codes, groups, resolveCode, onCancel, onConfirm, onBatchConfirm, generate }: {
  codes: string[]
  groups?: PurchaseMaterialGroup[]
  resolveCode: (code: string) => string
  onCancel: () => void
  onConfirm: (choices: PurchaseMaterialChoice[]) => Promise<boolean> | boolean
  onBatchConfirm: (choices: PurchaseMaterialChoice[]) => Promise<boolean> | boolean
  generate: boolean
}) {
  const [code, setCode] = useState('')
  const [choices, setChoices] = useState<PurchaseMaterialChoice[]>([])
  const [keys, setKeys] = useState<string[]>([])
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const submitting = useRef(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let cancelled = false
    setKeys([]); setQuantities({}); setChoices([]); setError('')
    const requested = groups?.length ? groups.map(g => resolveCode(g.code)) : code ? [code] : []
    if (!requested.length) { setLoading(false); return }
    setLoading(true)
    Promise.all([...new Set(requested)].map(async c => {
      const { data } = await api.get<Material[]>('/materials', { params: { code: c } })
      return [c, data] as const
    })).then(entries => {
      if (cancelled) return
      const byCode = new Map(entries)
      setChoices(groups?.length
        ? groups.flatMap(g => purchaseMaterialChoices(byCode.get(resolveCode(g.code)) || [], g.code, g))
        : purchaseMaterialChoices(byCode.get(code) || [], code))
    }).catch(() => {
      if (!cancelled) setError('物料加载失败，请重试；不会使用不完整资料下单。')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [code, groups, resolveCode, retry])
  const selected = selectedPurchaseMaterials(choices, keys, quantities)
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return choices.filter(c => [c.productCode, c.label, c.material.name_zh, c.material.material_code, c.material.spec, c.material.supplier]
      .some(v => (v || '').toLowerCase().includes(q)))
  }, [choices, search])
  async function confirm(batch = false) {
    if (submitting.current || loading) return
    if (!selected.length || selected.some(c => !Number.isFinite(c.quantity) || c.quantity <= 0)) {
      setError('请勾选物料，并为每条已选物料填写大于 0 的订单量。'); return
    }
    submitting.current = true
    setSaving(true); setError('')
    try { if (await (batch ? onBatchConfirm : onConfirm)(selected)) onCancel() }
    catch { setError('下单未完成，请核对采购单列表后再重试，避免重复下单。') }
    finally { submitting.current = false; setSaving(false) }
  }
  return <Modal open title={groups ? '选择排期对应货号的物料' : '从物料库选择'} width="90vw"
    onCancel={() => !saving && onCancel()} maskClosable={!saving} closable={!saving}
    footer={<Space wrap>
      <Button onClick={onCancel} disabled={saving}>取消</Button>
      {!generate && <Button onClick={() => confirm()} disabled={saving || loading || !selected.length}>加入当前采购单</Button>}
      <Button type="primary" loading={saving} disabled={loading || !selected.length}
        onClick={() => confirm(!generate)}>{generate ? '用所选物料生成采购单' : '批量下单'}</Button>
    </Space>}>
    <Space wrap style={{ marginBottom: 12 }}>
      {!groups && <Select showSearch placeholder="先选择货号" value={code || undefined} style={{ width: 240 }}
        options={codes.map(value => ({ value, label: value }))} onChange={setCode} disabled={saving} />}
      <Input.Search allowClear placeholder="搜索物料名称 / 编码 / 规格 / 供应商 / 货号" value={search}
        onChange={e => setSearch(e.target.value)} style={{ width: 390 }} />
      <span>已选 {selected.length} 条</span>
      <Button onClick={() => { setKeys([]); setQuantities({}) }} disabled={saving}>清空勾选</Button>
    </Space>
    <Alert type="info" showIcon style={{ marginBottom: 12 }}
      message="仅带入勾选的物料。订单量 × 物料用量计算物料量，损耗沿用现有采购规则；单价可套用报价。"
      description={generate ? '确认后按供应商及 RRI/RRM 来源分单；未勾选物料不会下单。' : '可跨供应商勾选后点击「批量下单」，按供应商及 RRI/RRM 来源生成独立草稿采购单，不改动当前采购单。「加入当前采购单」仅支持同一供应商，加入后仍需保存。'} />
    {error && <Alert type="error" showIcon message={error} action={<Button onClick={() => setRetry(n => n + 1)}>重新加载</Button>} />}
    <Table<PurchaseMaterialChoice> rowKey="key" size="small" loading={loading} dataSource={visible}
      pagination={{ defaultPageSize: 20 }} scroll={{ x: 1250, y: 420 }}
      rowSelection={{ selectedRowKeys: keys, onChange: next => setKeys(next.map(String)), preserveSelectedRowKeys: true,
        getCheckboxProps: () => ({ disabled: saving }) }}
      locale={{ emptyText: !groups && !code ? '请先选择货号' : '该货号没有可选物料，或没有匹配的搜索结果' }}
      columns={[
        { title: '排期 / TOMY PO', dataIndex: 'label', width: 180, hidden: !groups },
        { title: '货号', dataIndex: 'productCode', width: 120 },
        { title: '供应商', dataIndex: ['material', 'supplier'], width: 200 },
        { title: '物料名称', dataIndex: ['material', 'name_zh'], width: 190 },
        { title: '物料编码', dataIndex: ['material', 'material_code'], width: 130 },
        { title: '规格', dataIndex: ['material', 'spec'], width: 180 },
        { title: '类别', dataIndex: ['material', 'category'], width: 110 },
        { title: '用量', render: (_, c) => c.material.usage_qty ?? 1, width: 90 },
        { title: '订单量', width: 130, render: (_, c) => <InputNumber min={0} disabled={saving}
          value={quantities[c.key] ?? c.quantity} style={{ width: '100%' }}
          onChange={value => setQuantities(prev => ({ ...prev, [c.key]: value ?? 0 }))} /> },
        { title: '走货单位', dataIndex: ['material', 'unit_kg'], width: 100 },
      ]} />
  </Modal>
}
