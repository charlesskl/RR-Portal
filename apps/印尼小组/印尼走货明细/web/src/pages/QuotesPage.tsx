import { useEffect, useMemo, useRef, useState } from 'react'
import { App, Button, Card, Input, InputNumber, Popconfirm, Select, Space, Table, Typography } from 'antd'
import { api } from '../api/client'

// Legacy quote shape (from old HTML — settings.quotes blob)
interface Quote {
  supplier?: string
  matName?: string
  spec?: string
  minQty?: number
  unitPrice?: number
  currency?: string
  quoteDate?: string
  notes?: string
}

const CURR = [
  { value: '¥',   label: '¥ 人民币' },
  { value: 'HK$', label: 'HK$ 港币' },
  { value: 'US$', label: 'US$ 美金' },
  { value: 'Rp',  label: 'Rp 印尼盾' },
]

export default function QuotesPage() {
  const { message } = App.useApp()
  const [rows, setRows] = useState<Quote[]>([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [selKeys, setSelKeys] = useState<React.Key[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const blobVersion = useRef<string>('')

  async function load() {
    setLoading(true)
    try {
      const resp = await api.get<Quote[]>('/quotes/blob')
      blobVersion.current = resp.headers['x-blob-version'] ?? ''
      setRows(Array.isArray(resp.data) ? resp.data : [])
      setDirty(false)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function save() {
    setLoading(true)
    try {
      const resp = await api.put('/quotes/blob', rows, { headers: { 'X-Expected-Version': blobVersion.current } })
      blobVersion.current = resp.headers['x-blob-version'] ?? blobVersion.current
      message.success('已保存')
      setDirty(false)
    } catch (e: any) {
      if ((e as any)?.response?.status === 409) {
        message.error('数据已被他人修改，正在刷新…')
        load()
        return
      }
      message.error('保存失败: ' + (e?.message ?? e))
    } finally { setLoading(false) }
  }

  function patch(i: number, k: keyof Quote, v: any) {
    setRows((r) => r.map((q, idx) => idx === i ? { ...q, [k]: v } : q))
    setDirty(true)
  }
  function add() {
    setRows((r) => [{ supplier: '', matName: '', spec: '', minQty: 0, unitPrice: 0, currency: '¥' }, ...r])
    setDirty(true)
  }
  function del(i: number) {
    setRows((r) => r.filter((_, idx) => idx !== i))
    setDirty(true)
  }
  function delSelected() {
    if (!selKeys.length) return
    const sel = new Set(selKeys.map(Number))
    setRows((r) => r.filter((_, idx) => !sel.has(idx)))
    setSelKeys([])
    setDirty(true)
  }
  function clearAll() {
    if (!rows.length) return
    setRows([]); setSelKeys([]); setDirty(true)
    message.success('已清空（记得点 💾 保存全部 才会写入后端）')
  }

  // 币种归一：把任意写法映射到下拉选项 ¥/HK$/US$/Rp（顺序重要：HK$ 含 $，先判）
  function inferCurrency(text: any): string {
    const t = String(text ?? '')
    if (/HK\$|HKD|港币|港元|港/i.test(t)) return 'HK$'
    if (/US\$|USD|美元|美金|\$/i.test(t)) return 'US$'
    if (/Rp|IDR|印尼盾|盾/i.test(t)) return 'Rp'
    if (/RMB|CNY|￥|¥|人民币|元/i.test(t)) return '¥'
    return ''
  }

  function parseTierQty(value: any): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
    const text = String(value ?? '').trim().toUpperCase().replace(/[,，\s]/g, '')
    const match = text.match(/^(\d+(?:\.\d+)?)(K|千)?(?:PCS?|PCE|个)?$/)
    if (!match) return null
    const qty = Number(match[1]) * (match[2] ? 1000 : 1)
    return Number.isFinite(qty) && qty > 0 ? qty : null
  }

  function parsePrice(value: any): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    const text = String(value ?? '').trim()
    if (!text) return null
    const price = Number(text.replace(/,/g, '').replace(/[^\d.-]/g, ''))
    return Number.isFinite(price) ? price : null
  }

  async function importExcel(file: File) {
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const today = new Date().toISOString().slice(0, 10)  // 导入当天日期，Excel 未提供日期时使用
      const imported: Quote[] = []
      for (const sn of wb.SheetNames) {
        const ws = wb.Sheets[sn]
        if (!ws) continue
        const grid = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' })
        if (!grid.length) continue
        // 格式化文本网格 + 数字格式(numFmt)网格 —— 用于从单价单元格识别 US$/¥ 等
        const wGrid = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '', raw: false })
        const zGrid: any[][] = []
        const ref = ws['!ref']
        if (ref) {
          const range = XLSX.utils.decode_range(ref)
          for (let r = range.s.r; r <= range.e.r; r++) {
            const row: any[] = []
            for (let c = range.s.c; c <= range.e.c; c++) {
              const cell = ws[XLSX.utils.encode_cell({ r, c })]
              row.push(cell ? (cell.z || '') : '')
            }
            zGrid.push(row)
          }
        }
        // 表头行：含 名称/物料/品名 且 含 供应商/单价/价格
        let hdrRow = -1
        for (let i = 0; i < Math.min(8, grid.length); i++) {
          const j = (grid[i] || []).map((c: any) => String(c ?? '').replace(/\s+/g, '')).join('|')
          if ((j.includes('名称') || j.includes('物料') || j.includes('品名')) &&
              (j.includes('供应商') || j.includes('单价') || j.includes('价格'))) { hdrRow = i; break }
        }
        if (hdrRow < 0) hdrRow = 0
        const hdr = (grid[hdrRow] || []).map((c: any) => String(c ?? '').trim())
        const findCol = (...kws: string[]) => {
          for (let i = 0; i < hdr.length; i++) for (const k of kws) if (hdr[i].includes(k)) return i
          return -1
        }
        const cSup = findCol('供应商', '厂家', '卖方', 'Supplier')
        const cName = findCol('物料名', '物料名称', '名称', '品名', 'Material')
        const cSpec = findCol('规格', 'Spec')
        const cMinQty = findCol('起订量', '起订', 'MOQ', '最小')
        const cPrice = findCol('单价', '价格', 'Price')
        const cCurr = findCol('币种', '货币', '币别', 'Currency')
        const cDate = findCol('报价日期', '日期', 'Date')
        const cNotes = findCol('备注', 'Notes', 'Remark')
        const cCode = findCol('货号', '款号', 'Code')
        // 横向阶梯报价：在表头附近寻找 0.5K / 1K / 10K 等数量档位。
        let tierRow = -1
        let tierCols: Array<{ col: number; minQty: number }> = []
        for (let r = hdrRow; r < Math.min(grid.length, hdrRow + 4); r++) {
          const candidateRow = grid[r] || []
          const hasMaterialData = r > hdrRow && (
            (cName >= 0 && String(candidateRow[cName] ?? '').trim())
            || (cSup >= 0 && String(candidateRow[cSup] ?? '').trim())
          )
          if (hasMaterialData) break
          const found = candidateRow.map((cell: any, col: number) => ({
            col,
            minQty: parseTierQty(cell),
          })).filter((x): x is { col: number; minQty: number } => x.minQty !== null)
          if (found.length > tierCols.length) { tierRow = r; tierCols = found }
        }
        // 至少两个数量表头才视为横向阶梯，避免把普通表头中的数字误判为档位。
        const hasHorizontalTiers = tierCols.length >= 2
        // 全表级推断：单价表头 → sheet 名 → 表头及之前任意单元格
        let inferred = inferCurrency(cPrice >= 0 ? hdr[cPrice] : '') || inferCurrency(sn)
        for (let r = 0; r <= hdrRow && !inferred; r++)
          for (const cell of (grid[r] || [])) { inferred = inferCurrency(cell); if (inferred) break }
        for (let i = Math.max(hdrRow, hasHorizontalTiers ? tierRow : hdrRow) + 1; i < grid.length; i++) {
          const row = grid[i] || []
          const matName = cName >= 0 ? String(row[cName] ?? '').trim() : ''
          if (!matName) continue
          let sup = cSup >= 0 ? String(row[cSup] ?? '').trim() : ''
          if (!sup) for (let j = i - 1; j > hdrRow; j--) {
            const s = cSup >= 0 ? String((grid[j] || [])[cSup] ?? '').trim() : ''
            if (s) { sup = s; break }
          }
          // 行级币种：① 独立列 ② 单价格子的格式化文本/numFmt ③ 全表推断 ④ ¥
          let cur = cCurr >= 0 ? inferCurrency(row[cCurr]) : ''
          if (!cur && cPrice >= 0) {
            cur = inferCurrency((wGrid[i] || [])[cPrice]) || inferCurrency((zGrid[i] || [])[cPrice])
          }
          const currency = cur || inferred || '¥'
          // 单价：原始数字优先，否则从字符串里剥出数字
          let price = 0
          const raw = cPrice >= 0 ? row[cPrice] : 0
          if (typeof raw === 'number') price = raw
          else if (raw != null && raw !== '') price = Number(String(raw).replace(/[^\d.]/g, '')) || 0
          const code = cCode >= 0 ? String(row[cCode] ?? '').trim() : ''
          const noteBase = cNotes >= 0 ? String(row[cNotes] ?? '').trim() : ''
          const common = {
            supplier: sup,
            matName,
            spec: cSpec >= 0 ? String(row[cSpec] ?? '').trim() : '',
            quoteDate: (cDate >= 0 ? String(row[cDate] ?? '').trim() : '') || today,
            notes: code ? (noteBase ? noteBase + ' / 货号:' + code : '货号:' + code) : noteBase,
          }
          if (hasHorizontalTiers) {
            for (const tier of tierCols) {
              const rawTierPrice = row[tier.col]
              const tierPrice = parsePrice(rawTierPrice)
              if (tierPrice === null || tierPrice <= 0) continue
              const tierCurrency = inferCurrency((wGrid[i] || [])[tier.col])
                || inferCurrency((zGrid[i] || [])[tier.col])
                || inferCurrency(rawTierPrice)
                || (cCurr >= 0 ? inferCurrency(row[cCurr]) : '')
                || inferred
                || '¥'
              imported.push({
                ...common,
                minQty: tier.minQty,
                unitPrice: tierPrice,
                currency: tierCurrency,
              })
            }
            continue
          }
          imported.push({
            ...common,
            minQty: cMinQty >= 0 ? (parseTierQty(row[cMinQty]) ?? 0) : 0,
            unitPrice: price,
            currency,
          })
        }
      }
      const named = imported.filter((q) => q.supplier || q.matName)
      const valid = named.filter((q) => Number(q.minQty) > 0)
      const skippedNoMinQty = named.length - valid.length
      if (!valid.length) { message.warning('没识别到有效报价（需含供应商/物料名，且起订量必须大于 0）'); return }
      setRows((r) => [...valid, ...r])
      setDirty(true)
      message.success(`已导入 ${valid.length} 行${skippedNoMinQty ? `，跳过 ${skippedNoMinQty} 条无起订量记录` : ''} — 别忘点 💾 保存全部`)
    } catch (e: any) {
      message.error('导入失败: ' + (e?.message ?? e))
    }
  }

  async function exportExcel() {
    const XLSX = await import('xlsx')
    const data = rows.map((q) => ({
      供应商: q.supplier ?? '',
      物料名: q.matName ?? '',
      规格: q.spec ?? '',
      起订量: q.minQty ?? 0,
      单价: q.unitPrice ?? 0,
      币种: q.currency ?? '¥',
      日期: q.quoteDate ?? '',
      备注: q.notes ?? '',
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '报价')
    XLSX.writeFile(wb, `报价_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const filtered = useMemo(() => rows
    .map((q, _i) => ({ q, _i }))
    .filter(({ q }) => {
      if (!filter) return true
      const s = filter.toLowerCase()
      return ((q.supplier || '') + (q.matName || '') + (q.spec || '') + (q.notes || '')).toLowerCase().includes(s)
    }), [rows, filter])

  // Tiered-pricing group count
  const tierGroups = useMemo(() => {
    const set = new Set<string>()
    for (const q of rows) set.add(`${q.supplier ?? ''}|${q.matName ?? ''}|${q.spec ?? ''}`)
    return set.size
  }, [rows])

  return (
    <div style={{ padding: 16 }}>
      <Card
        title={
          <span>
            报价管理 — 共 <b>{rows.length}</b> 条 · 阶梯组 <b>{tierGroups}</b>
            {dirty && <Typography.Text type="warning"> · 未保存</Typography.Text>}
          </span>
        }
        extra={
          <Space wrap>
            <Input.Search allowClear placeholder="搜索 供应商/物料/规格/备注" style={{ width: 260 }}
              onSearch={setFilter} onChange={(e) => !e.target.value && setFilter('')} />
            <Button onClick={load} disabled={loading}>🔄 重新加载</Button>
            <Button onClick={add}>➕ 新增</Button>
            <Popconfirm title={`删除选中的 ${selKeys.length} 条?`} onConfirm={delSelected} disabled={!selKeys.length}>
              <Button danger disabled={!selKeys.length}>🗑 批量删除 ({selKeys.length})</Button>
            </Popconfirm>
            <Popconfirm title={`清空全部 ${rows.length} 条报价？此操作不可撤销`} okText="清空" okButtonProps={{ danger: true }} onConfirm={clearAll} disabled={!rows.length}>
              <Button danger disabled={!rows.length}>🗑 清空全部</Button>
            </Popconfirm>
            <Button onClick={() => fileRef.current?.click()}>📥 导入 Excel</Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importExcel(f); e.target.value = '' }} />
            <Button onClick={exportExcel} disabled={!rows.length}>📤 导出 Excel</Button>
            <Button type="primary" onClick={save} loading={loading} disabled={!dirty}>💾 保存全部</Button>
          </Space>
        }
      >
        <Table
          rowKey={(r) => String(r._i)}
          size="small"
          loading={loading}
          dataSource={filtered}
          rowSelection={{ selectedRowKeys: selKeys, onChange: (k) => setSelKeys(k) }}
          pagination={{ defaultPageSize: 50, showSizeChanger: true }}
          scroll={{ x: 1200 }}
          columns={[
            { title: '#', width: 50, align: 'center', render: (_v, _r, i) => i + 1 },
            { title: '供应商', width: 200, render: (_v, r) => <Input size="small" value={r.q.supplier} onChange={(e) => patch(r._i, 'supplier', e.target.value)} /> },
            { title: '物料名', width: 200, render: (_v, r) => <Input size="small" value={r.q.matName} onChange={(e) => patch(r._i, 'matName', e.target.value)} /> },
            { title: '规格', width: 160, render: (_v, r) => <Input size="small" value={r.q.spec} onChange={(e) => patch(r._i, 'spec', e.target.value)} /> },
            { title: '起订量', width: 100, render: (_v, r) => <InputNumber size="small" min={0} value={r.q.minQty} onChange={(v) => patch(r._i, 'minQty', v ?? 0)} style={{ width: '100%' }} /> },
            { title: '单价', width: 120, render: (_v, r) => <InputNumber size="small" min={0} step={0.0001} value={r.q.unitPrice} onChange={(v) => patch(r._i, 'unitPrice', v ?? 0)} style={{ width: '100%' }} /> },
            { title: '币种', width: 110, render: (_v, r) => <Select size="small" value={r.q.currency || '¥'} options={CURR} onChange={(x) => patch(r._i, 'currency', x)} style={{ width: '100%' }} /> },
            { title: '日期', width: 120, render: (_v, r) => <Input size="small" value={r.q.quoteDate} placeholder="YYYY-MM-DD" onChange={(e) => patch(r._i, 'quoteDate', e.target.value)} /> },
            { title: '备注', width: 160, render: (_v, r) => <Input size="small" value={r.q.notes} onChange={(e) => patch(r._i, 'notes', e.target.value)} /> },
            {
              title: '', width: 50, fixed: 'right',
              render: (_v, r) => (
                <Popconfirm title="删除该条?" onConfirm={() => del(r._i)}>
                  <a style={{ color: '#ff4d4f', fontSize: 16 }}>×</a>
                </Popconfirm>
              ),
            },
          ]}
        />
      </Card>
    </div>
  )
}
