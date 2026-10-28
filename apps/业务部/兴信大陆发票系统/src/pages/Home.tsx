/* eslint-disable */
// @ts-nocheck —— UI 胶水层；核心逻辑在 src/lib/*.js，由 scripts/regression.mjs / e2e.mjs / ui-smoke 验证
import { useEffect, useMemo, useRef, useState } from 'react'
import { FileSpreadsheet, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { invoiceTotal, fmtDate } from '@/lib/invoice.js'
import { parseZuruSource } from '@/lib/offThreadParse.js'
import { normRange, inRangeYmd } from '@/lib/dateRange.js'
import { MonthWarnings } from '@/components/MonthWarnings.tsx'
import { XlsxPackage } from '@/lib/xlsxPackage.js'
import { generate } from '@/lib/engine.js'
import { loadAsset } from '@/lib/loadAsset.js'
import OtherGuests from '@/pages/OtherGuests.tsx'
import Miandan from '@/pages/Miandan.tsx'

const XINGXIN_MODULES = [
  { k: 'zuru', t: 'ZURU 发票', d: '国际/美国订单批量生成' },
  { k: 'other', t: '其他客发票', d: '香港 / 远东 / 国际分类生成' },
  { k: 'miandan', t: '面单', d: '大陆面单 + 金额核对' },
]

/** 三个模块常驻，切换时保留已上传文件和核对结果。 */
function Sidebar({ mode, setMode }) {
  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-neutral-200 bg-white">
      <div className="flex items-center gap-2.5 border-b border-neutral-100 px-5 py-4">
        <FileSpreadsheet className="h-6 w-6 text-teal-700" />
        <div>
          <div className="text-sm font-semibold tracking-tight">兴信大陆发票系统</div>
          <div className="text-[11px] text-neutral-400">兴信厂区 · 独立工作台</div>
        </div>
      </div>
      <nav aria-label="兴信功能模块" className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
        {XINGXIN_MODULES.map((m) => (
          <button key={m.k} onClick={() => setMode(m.k)} aria-current={mode === m.k ? 'page' : undefined}
            className={`flex w-full flex-col rounded-lg px-3 py-2 text-left ${mode === m.k ? 'bg-teal-700 text-white' : 'text-neutral-600 hover:bg-neutral-50'}`}>
            <span className="text-sm">{m.t}</span>
            <span className="text-[11px] opacity-75">{m.d}</span>
          </button>
        ))}
      </nav>
      <div className="border-t border-neutral-100 px-5 py-3 text-[11px] leading-relaxed text-neutral-400">
        文件在当前浏览器中处理，请及时下载生成结果。
      </div>
    </aside>
  )
}

const fmtMoney = (v) =>
  v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtTime = (d) => {
  const pad = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 号段解析：支持 "98632-98700, ZB05569, ZB05580-ZB05600" */
function matchToken(name, token) {
  if (name === token) return true
  const range = token.split('-')
  if (range.length !== 2) return false
  const [lo, hi] = range
  const num = (s) => {
    const m = s.match(/^(ZB)?0*(\d+)$/i)
    return m ? { zb: !!m[1], n: +m[2] } : null
  }
  const a = num(lo), b = num(hi), x = num(name)
  if (!a || !b || !x || a.zb !== x.zb || b.zb !== x.zb) return false
  return x.n >= a.n && x.n <= b.n
}

function StepBadge({ n }) {
  return (
    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-teal-700/20 bg-teal-700/10 text-xs font-semibold text-teal-800">
      {n}
    </span>
  )
}

const cardCls = 'rounded-xl border-neutral-200/90 shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
const invoiceKey = (invoice) => JSON.stringify([invoice.customer || 'ZURU', invoice.outSheetName])

export default function Home() {
  const [mode, setMode] = useState('zuru')
  const [base, setBase] = useState(null)
  const [baseLoading, setBaseLoading] = useState(true)
  const [baseError, setBaseError] = useState('')
  const [zuruTpl, setZuruTpl] = useState(null)
  const [zuruTplError, setZuruTplError] = useState('')
  const [sources, setSources] = useState([])
  const [invoices, setInvoices] = useState([])
  const [parsing, setParsing] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const [selected, setSelected] = useState(new Set())
  const [onlyNew, setOnlyNew] = useState(true)
  const [fmt, setFmt] = useState('all')
  const [search, setSearch] = useState('')
  const [rangeInput, setRangeInput] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showOutOfRange, setShowOutOfRange] = useState(false)
  const [expanded, setExpanded] = useState(new Set())

  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)
  const [genError, setGenError] = useState('')
  const [slimOutput, setSlimOutput] = useState(true)
  const [history, setHistory] = useState([])

  const fileRef = useRef(null)
  const baseRef = useRef(null)

  useEffect(() => {
    try {
      setHistory(JSON.parse(localStorage.getItem('xingxin-invoice-history') || '[]'))
    } catch { setHistory([]) }
    ;(async () => {
      try {
        const buffer = await loadAsset('/base-master.xlsx')
        setBase({ buffer, name: '内置空白母版（不含历史发票）', names: [], isDefault: true })
      } catch (e) {
        setBaseError(String(e))
      } finally {
        setBaseLoading(false)
      }
    })()
    ;(async () => {
      try {
        const buffer = await loadAsset('/zuru-tpl/兴信-zuru.xlsx')
        setZuruTpl({ buffer })
      } catch (e) {
        setZuruTplError(String(e))
      }
    })()
  }, [])

  const baseNames = useMemo(() => new Set(base?.names || []), [base])

  const onBaseUpload = async (file) => {
    if (!file) return
    setBaseLoading(true); setBaseError('')
    try {
      const buffer = await file.arrayBuffer()
      const pkg = await XlsxPackage.load(buffer)
      const names = pkg.getSheetNames()
      if (!names.includes('98631')) throw new Error('这个工作簿里找不到模版 sheet「98631」，请上传正确的母版')
      setBase({ buffer, name: file.name, names, isDefault: false })
      setResult(null)
    } catch (e) {
      setBaseError(`读取失败：${e.message || e}（请先用 Excel/WPS 把 .xls 另存为 .xlsx 再上传）`)
    } finally { setBaseLoading(false) }
  }

  const onSourceUpload = async (files) => {
    if (!files || !files.length) return
    setParsing(true); setResult(null)
    try {
      for (const file of Array.from(files)) {
        setSources((s) => [...s.filter((x) => x.name !== file.name), { name: file.name, count: null, status: 'parsing' }])
        await new Promise((r) => setTimeout(r, 50))
        try {
          const buffer = await file.arrayBuffer()
          const invs = await parseZuruSource(buffer)
          setInvoices((prev) => [...prev.filter((x) => !invs.some((v) => v.srcSheetName === x.srcSheetName && v.customer === x.customer)), ...invs])
          setSelected((sel) => {
            const next = new Set(sel)
            for (const v of invs) if (!baseNames.has(v.outSheetName)) next.add(invoiceKey(v))
            return next
          })
          setSources((s) => s.map((x) => x.name === file.name ? { ...x, count: invs.length, status: 'done', unrec: invs.unrecognized || [] } : x))
        } catch (e) {
          setSources((s) => s.map((x) => x.name === file.name ? { ...x, status: 'error', error: String(e) } : x))
        }
      }
    } finally { setParsing(false) }
  }

  const range = useMemo(() => normRange(dateFrom, dateTo), [dateFrom, dateTo])

  const filtered = useMemo(() => {
    let list = invoices
    if (onlyNew) list = list.filter((v) => !baseNames.has(v.outSheetName))
    if (fmt !== 'all') list = list.filter((v) => v.format === fmt)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((v) =>
        v.outSheetName.toLowerCase().includes(q) ||
        String(v.invNo).toLowerCase().includes(q) ||
        v.po.toLowerCase().includes(q))
    }
    return list
  }, [invoices, onlyNew, fmt, search, baseNames])

  const inRangeOf = (v) => !range.active || inRangeYmd(fmtDate(v.date), range)

  const rangeStats = useMemo(() => {
    if (!range.active) return null
    let inC = 0
    for (const v of filtered) if (inRangeYmd(fmtDate(v.date), range)) inC++
    return { inCount: inC, outCount: filtered.length - inC }
  }, [filtered, range])

  // 表格实际显示的行：启用日期筛选时默认只显示范围内发票（范围外可一键展开）
  const visibleList = useMemo(
    () => (range.active && !showOutOfRange ? filtered.filter(inRangeOf) : filtered),
    [filtered, range.active, range.lo, range.hi, showOutOfRange])

  // 启用日期范围后，范围外发票自动取消勾选（不可再选）
  useEffect(() => {
    if (!range.active) return
    const ymdByName = new Map(invoices.map((v) => [invoiceKey(v), fmtDate(v.date)]))
    setSelected((sel) => {
      const next = new Set([...sel].filter((n) => inRangeYmd(ymdByName.get(n) || '', range)))
      return next.size === sel.size ? sel : next
    })
  }, [range.active, range.lo, range.hi, invoices])

  const selectedList = useMemo(() => invoices.filter((v) => selected.has(invoiceKey(v))), [invoices, selected])
  const selectedCount = selectedList.length
  const selectedAmount = useMemo(() => selectedList.reduce((s, v) => s + invoiceTotal(v), 0), [selectedList])

  // generate 的 warnings 本就按本次生成范围产出；这里挂上系列票的日期归属，
  // 改了日期范围后无需重新生成也能由 MonthWarnings 即时过滤
  const warnItemsOf = (res) => (res.warnings || []).map((w) => {
    const m = String(w).match(/^(\S+) 系列：/)
    const v = m && (invoices.find((x) => x.outSheetName === m[1]) || invoices.find((x) => x.outSheetName.startsWith(`${m[1]}-`)))
    return { text: w, ymd: v ? fmtDate(v.date) : '' }
  })

  const toggleAll = (check) => {
    setSelected((sel) => {
      const next = new Set(sel)
      for (const v of filtered) {
        if (check && !inRangeOf(v)) continue
        check ? next.add(invoiceKey(v)) : next.delete(invoiceKey(v))
      }
      return next
    })
  }

  const applyRange = () => {
    const tokens = rangeInput.split(/[,，\s]+/).filter(Boolean)
    if (!tokens.length) return
    const hit = filtered.filter((v) => tokens.some((t) => matchToken(v.outSheetName, t.trim())))
    setSelected((sel) => {
      const next = new Set(sel)
      for (const v of hit) if (!baseNames.has(v.outSheetName) && inRangeOf(v)) next.add(invoiceKey(v))
      return next
    })
  }

  const doGenerate = async () => {
    if (!base) return
    setGenerating(true); setProgress(0); setResult(null); setGenError('')
    try {
      // 按客人分组：每个客人单独生成一个输出工作簿，绝不混在一个文件里
      const groups = new Map()
      for (const v of invoices) {
        if (!selected.has(invoiceKey(v))) continue
        if (!inRangeOf(v)) continue
        const c = v.customer || 'ZURU'
        if (!groups.has(c)) groups.set(c, new Set())
        groups.get(c).add(v.outSheetName)
      }
      const results = []
      let gi = 0
      for (const [customer, names] of groups) {
        if (customer === 'ZURU' && !zuruTpl) throw new Error(`兴信 ZURU 新模板未加载${zuruTplError ? `：${zuruTplError}` : '，请刷新页面重试'}`)
        const res = await generate({
          baseBuffer: base.buffer,
          baseName: base.name,
          baseIsTemplate: base.isDefault,
          invoices: invoices.filter((v) => (v.customer || 'ZURU') === customer),
          selected: names,
          slimOutput,
          zuruTplBuffer: customer === 'ZURU' ? zuruTpl.buffer : undefined,
          onProgress: (d, t) => setProgress(Math.round(((gi + d / t) / groups.size) * 100)),
        })
        res.todoCount = names.size
        res.customer = customer
        results.push(res)
        gi++
      }
      setResult(results)
      const made = results.reduce((s, r) => s + r.report.filter((x) => x.status !== 'skipped').length, 0)
      const skippedN = results.reduce((s, r) => s + r.skipped.length, 0)
      const warnN = results.reduce((s, r) => s + r.report.filter((x) => x.status === 'warn').length, 0)
      setHistory((h) => {
        const next = [{ time: fmtTime(new Date()), count: made, skipped: skippedN, warn: warnN }, ...h].slice(0, 8)
        try { localStorage.setItem('xingxin-invoice-history', JSON.stringify(next)) } catch {}
        return next
      })
    } catch (e) {
      console.error(e)
      setGenError(String(e && e.message ? e.message : e))
    } finally { setGenerating(false) }
  }

  const download = (res) => {
    if (!res) return
    const blob = new Blob([res.output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const a = document.createElement('a')
    const d = new Date()
    const pad = (x) => String(x).padStart(2, '0')
    const made = res.todoCount - res.skipped.length
    a.href = URL.createObjectURL(blob)
    const cust = res.customer && res.customer !== 'ZURU' ? `_${res.customer}` : ''
    a.download = `修改大陆发票${cust}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_新增${made}张.xlsx`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const exportCsv = (res) => {
    if (!res) return
    const head = 'sheet名,发票号,日期,PO号,明细行数,分段,I48合计,源表合计×0.967,差值,状态\n'
    const body = res.report.map((r) => [
      r.name, r.invNo || '', r.date || '', r.po || '', r.lines ?? '', r.parts || '',
      r.total ?? '', r.refTotal !== null && r.refTotal !== undefined ? r.refTotal.toFixed(4) : '',
      r.diff !== null && r.diff !== undefined ? r.diff.toFixed(4) : '',
      r.status === 'ok' ? '正常' : r.status === 'warn' ? '待核对' : '跳过',
    ].join(',')).join('\n')
    const blob = new Blob(['﻿' + head + body], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    const cust = res.customer && res.customer !== 'ZURU' ? `_${res.customer}` : ''
    a.download = `验证报告${cust}_${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const resultList = result || []

  // 三个页面常驻渲染（keep-alive）：切换标签只隐藏，不卸载，
  // 保证「面单生成 → 切去 ZURU 生成发票 → 回来金额核对」流程中各页状态不丢。
  const hide = (m) => (mode === m ? undefined : 'none')

  return (
    <div className="flex">
      <Sidebar mode={mode} setMode={setMode} />
      <main className="min-w-0 flex-1">
        <div style={{ display: hide('other') }}>
          <OtherGuests />
        </div>
        <div style={{ display: hide('miandan') }}>
          <Miandan />
        </div>
        <div style={{ display: hide('zuru') }}>
    <div className="min-h-screen bg-neutral-50 pb-28 text-neutral-900">
      {/* 顶部页头 */}
      <div className="border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <p className="text-xs font-medium tracking-[0.2em] text-teal-700">ZURU · 批量生成</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">兴信 ZURU 发票生成</h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-neutral-500">
            上传 ZURU 源表（国际 / 美国订单）或 JAZ / Sky Castle / Toy Monster 香港票 → 选择发票 → 按既有模版批量生成「修改大陆发票」：单价自动 ×0.967，原单价保留在 K 列，多段发票自动累计合计。ZURU 票已改用兴信抬头新格式（东莞兴信塑胶制品有限公司 / ROYAL REGENT 买方，发票号在 H9、日期在 G13）；香港票仍用旧版式。不同客人分开生成，每客一个输出文件。
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        {/* 步骤 1 */}
        <Card className={cardCls}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-3 text-base"><StepBadge n="1" />基础工作簿</CardTitle>
            <CardDescription>默认使用不含历史票的空白母版。如需识别已开票号码或补算多段票，请上传自己的历史母版（.xlsx，保留 98631 模板页）。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            {baseLoading ? (
              <span className="text-sm text-neutral-500">加载中…</span>
            ) : base ? (
              <>
                <Badge variant="outline" className={base.isDefault ? 'border-teal-200 bg-teal-50 text-teal-800' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}>{base.isDefault ? '内置母版' : '已替换'}</Badge>
                <span className="text-sm font-medium">{base.name}</span>
                <span className="text-sm text-neutral-500">共 {base.names.length} 张 sheet</span>
              </>
            ) : (
              <span className="text-sm text-red-600">{baseError}</span>
            )}
            {zuruTplError
              ? <span className="text-sm text-red-600">ZURU 兴信新模板加载失败：{zuruTplError}</span>
              : zuruTpl && <span className="text-xs text-neutral-400">ZURU 兴信新模板已加载</span>}
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => baseRef.current?.click()}>
              上传其他基础工作簿
            </Button>
            <input ref={baseRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => onBaseUpload(e.target.files?.[0])} />
          </CardContent>
        </Card>

        {/* 步骤 2 */}
        <Card className={cardCls}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-3 text-base"><StepBadge n="2" />上传源表</CardTitle>
            <CardDescription>支持「2026年ZURU(国际）」「ZURU美国订单减价40%后模版」「JAZ / Sky Castle / Toy Monster 香港票」格式，可拖拽多个文件。大文件解析约需十几秒，解析在后台线程进行，页面不会卡死。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              className={`flex h-32 cursor-pointer items-center justify-center rounded-xl border border-dashed transition-colors ${dragOver ? 'border-teal-600 bg-teal-50/60' : 'border-neutral-300 bg-neutral-50/60 hover:border-teal-500/60 hover:bg-teal-50/40'}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); onSourceUpload(e.dataTransfer.files) }}
            >
              <div className="text-center">
                <div className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full border bg-white shadow-sm transition-colors ${dragOver ? 'border-teal-300 text-teal-700' : 'border-neutral-200 text-neutral-400'}`}>
                  <Upload className="h-4 w-4" />
                </div>
                <div className="mt-2.5 text-sm text-neutral-600">{parsing ? '正在解析，请稍候…' : '点击选择或拖拽源表文件到这里'}</div>
                <div className="mt-1 text-xs text-neutral-400">支持 .xlsx / .xls，可多选</div>
              </div>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" multiple className="hidden" aria-label="ZURU源表上传"
              onChange={(e) => { onSourceUpload(e.target.files); e.target.value = '' }} />
            {sources.map((s) => (
              <div key={s.name} className="flex items-center gap-2 text-sm">
                <Badge variant="outline" className="max-w-md truncate border-neutral-200 font-normal text-neutral-600">{s.name}</Badge>
                {s.status === 'parsing' && <span className="text-neutral-500">解析中…</span>}
                {s.status === 'done' && <span className="text-teal-700">✓ 识别出发票 {s.count} 张</span>}
                {s.status === 'done' && s.unrec && s.unrec.length > 0 && (
                  <span className="text-amber-700" title={s.unrec.join('、')}>
                    ⚠ {s.unrec.length} 张 sheet 版式不认识未生成：{s.unrec.slice(0, 6).join('、')}{s.unrec.length > 6 ? ` 等 ${s.unrec.length} 张` : ''}（鼠标悬停看全部）
                  </span>
                )}
                {s.status === 'error' && <span className="text-red-600">{s.error}</span>}
              </div>
            ))}
            {invoices.length > 0 && (
              <div className="text-sm text-neutral-600">
                共识别发票 <b className="text-teal-800">{invoices.length}</b> 张，
                其中母版里还没有的 <b className="text-emerald-700">{invoices.filter((v) => !baseNames.has(v.outSheetName)).length}</b> 张
              </div>
            )}
          </CardContent>
        </Card>

        {/* 步骤 3 */}
        <Card className={cardCls}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-3 text-base"><StepBadge n="3" />选择要生成的发票</CardTitle>
            <CardDescription>默认已勾选母版里还没有的新发票；点击任意一行可展开明细核对。多段发票（-2、-3）只在最后一段填累计合计。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <label className="flex items-center gap-2">
                <Switch checked={onlyNew} onCheckedChange={setOnlyNew} />只显示母版里没有的
              </label>
              <div className="flex items-center gap-1 rounded-full bg-neutral-100 p-0.5">
                {[{ k: 'all', t: '全部' }, { k: 'intl', t: '国际' }, { k: 'us', t: '美国' }, { k: 'jaz', t: 'JAZ' }, { k: 'skycastle', t: 'Sky Castle' }, { k: 'toymonster', t: 'Toy Monster' }].map((o) => (
                  <button key={o.k} onClick={() => setFmt(o.k)}
                    className={`rounded-full px-3 py-1 text-xs transition-colors ${fmt === o.k ? 'bg-white font-medium text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'}`}>
                    {o.t}
                  </button>
                ))}
              </div>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 w-36 text-xs" title="起始日期" />
              <span className="text-neutral-400">至</span>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 w-36 text-xs" title="截止日期" />
              <Input placeholder="搜索发票号 / PO…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 w-48" />
            </div>
            {range.active && (
              <div className="rounded-lg border border-teal-200 bg-teal-50/70 px-3 py-2 text-xs text-teal-900">
                已筛选：{range.lo || '不限'} ~ {range.hi || '不限'} → 范围内 <b>{rangeStats.inCount}</b> 张
                （范围外 {rangeStats.outCount} 张不可选，生成时只包含范围内发票）
                {range.inverted && <span className="ml-1 text-amber-700">起止倒置已自动互换</span>}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Input placeholder="号段快选，如 98632-98700, ZB05569-ZB05600" value={rangeInput}
                onChange={(e) => setRangeInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyRange()}
                className="h-8 w-96 font-mono text-xs" />
              <Button size="sm" variant="outline" onClick={applyRange}>选中号段</Button>
              <span className="ml-auto text-neutral-500">
                {range.active
                  ? <>范围内 <b className="text-teal-800">{rangeStats.inCount}</b> 张 · 已选 <b className="text-teal-800">{selectedCount}</b> 张</>
                  : <>筛选出 {filtered.length} 张 · 已选 <b className="text-teal-800">{selectedCount}</b> 张</>}
              </span>
              {range.active && rangeStats.outCount > 0 && (
                <Button size="sm" variant="ghost" className="h-8 text-xs text-neutral-500"
                  onClick={() => setShowOutOfRange((v) => !v)}>
                  {showOutOfRange ? '隐藏范围外' : `显示范围外 ${rangeStats.outCount} 张`}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => toggleAll(true)}>全选当前筛选</Button>
              <Button size="sm" variant="outline" onClick={() => toggleAll(false)}>取消全选</Button>
            </div>

            <div className="max-h-[28rem] overflow-auto rounded-lg border border-neutral-200 bg-white">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 border-b border-neutral-200 bg-neutral-50/95 text-xs text-neutral-500">
                  <tr>
                    <th className="w-10 px-3 py-2.5"></th>
                    <th className="px-3 py-2.5 text-left font-medium">输出 sheet 名</th>
                    <th className="px-3 py-2.5 text-left font-medium">发票号</th>
                    <th className="px-3 py-2.5 text-left font-medium">日期</th>
                    <th className="px-3 py-2.5 text-left font-medium">PO 号</th>
                    <th className="px-3 py-2.5 text-left font-medium">来源</th>
                    <th className="px-3 py-2.5 text-right font-medium">明细行</th>
                    <th className="px-3 py-2.5 text-right font-medium">合计(×0.967)</th>
                    <th className="px-3 py-2.5 text-left font-medium">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleList.slice(0, 300).map((v) => {
                    const rowKey = JSON.stringify([v.customer || 'ZURU', v.srcSheetName])
                    const exists = baseNames.has(v.outSheetName)
                    const checked = selected.has(invoiceKey(v))
                    const open = expanded.has(rowKey)
                    const bad = !v.date || !v.po
                    const inR = inRangeOf(v)
                    return [
                      <tr key={rowKey}
                        className={`border-t border-neutral-100 transition-colors cursor-pointer ${exists || !inR ? 'opacity-45' : ''} ${checked ? 'bg-teal-50/50' : 'hover:bg-neutral-50'}`}
                        onClick={() => setExpanded((ex) => { const n = new Set(ex); open ? n.delete(rowKey) : n.add(rowKey); return n })}>
                        <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" className="accent-teal-700" checked={checked} disabled={exists || !inR}
                            onChange={(e) => setSelected((sel) => {
                              const next = new Set(sel)
                              e.target.checked ? next.add(invoiceKey(v)) : next.delete(invoiceKey(v))
                              return next
                            })} />
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs">{open ? '▾ ' : '▸ '}{v.outSheetName}</td>
                        <td className="px-3 py-1.5 font-mono text-xs">{String(v.invNo)}</td>
                        <td className="px-3 py-1.5 text-xs">{fmtDate(v.date)}</td>
                        <td className="px-3 py-1.5 font-mono text-xs">{v.po}</td>
                        <td className="px-3 py-1.5"><Badge variant="outline" className="border-neutral-200 text-xs font-normal text-neutral-600">{v.customer && v.customer !== 'ZURU' ? v.customer : v.format === 'intl' ? '国际' : '美国'}</Badge></td>
                        <td className="px-3 py-1.5 text-right text-xs">{v.lines.length}</td>
                        <td className="px-3 py-1.5 text-right text-xs font-medium tabular-nums">{fmtMoney(invoiceTotal(v))}</td>
                        <td className="px-3 py-1.5 text-xs">
                          {exists ? <span className="text-neutral-400">母版已有</span>
                            : !inR ? <span className="text-neutral-400">范围外</span>
                            : bad ? <span className="text-amber-600">⚠ 缺{v.date ? '' : '日期'}{!v.date && !v.po ? '/' : ''}{v.po ? '' : 'PO'}</span>
                            : <span className="text-emerald-700">新</span>}
                        </td>
                      </tr>,
                      open && (
                        <tr key={rowKey + '-detail'} className="bg-neutral-50/70">
                          <td colSpan={9} className="px-6 py-3">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-neutral-400">
                                  <th className="py-1 text-left font-medium">货号 / MA#</th>
                                  <th className="py-1 text-right font-medium">数量</th>
                                  <th className="py-1 text-right font-medium">原单价(K)</th>
                                  <th className="py-1 text-right font-medium">×0.967(G)</th>
                                  <th className="py-1 text-right font-medium">金额(I)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {v.lines.map((ln, i) => ln.kind === 'qty' ? (
                                  <tr key={i} className="text-neutral-400">
                                    <td className="py-0.5">（小计行）</td>
                                    <td className="py-0.5 text-right">{ln.qty}</td>
                                    <td></td><td></td><td></td>
                                  </tr>
                                ) : (
                                  <tr key={i}>
                                    <td className="py-0.5 font-mono">{ln.code ?? '（无码扣款）'}</td>
                                    <td className="py-0.5 text-right tabular-nums">{ln.qty}</td>
                                    <td className="py-0.5 text-right tabular-nums">{ln.unit}</td>
                                    <td className="py-0.5 text-right tabular-nums">{(ln.unit * 0.967).toFixed(4)}</td>
                                    <td className="py-0.5 text-right tabular-nums">{fmtMoney(ln.unit * 0.967 * ln.qty)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      ),
                    ]
                  })}
                </tbody>
              </table>
              {visibleList.length > 300 && (
                <div className="border-t border-neutral-100 p-2 text-center text-xs text-neutral-500">
                  仅显示前 300 张（共 {visibleList.length} 张），全选/生成对全部筛选结果生效；可用搜索或号段缩小范围
                </div>
              )}
              {visibleList.length === 0 && (
                <div className="p-10 text-center text-sm text-neutral-400">
                  {range.active ? '该日期范围内没有发票 —— 调整起止日期，或点上方「显示范围外」查看全部' : '没有匹配的发票 —— 请先在第 2 步上传源表，或调整筛选条件'}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 步骤 4 */}
        <Card className={cardCls}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-3 text-base"><StepBadge n="4" />生成 · 验证 · 下载</CardTitle>
            <CardDescription>生成后逐张自动验证（系统合计 vs 源表合计×0.967），差值超过 0.02 的会标黄提醒。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center gap-2 text-sm text-neutral-600">
              <Switch checked={slimOutput} onCheckedChange={setSlimOutput} />
              只导出新增的发票（不含上传母版中的历史发票；关掉则保留历史发票。ZURU 新版式始终仅导出本次生成的票）
            </label>
            {generating && (
              <div className="flex items-center gap-3">
                <Progress value={progress} className="w-72" />
                <span className="text-sm tabular-nums text-neutral-500">{progress}%</span>
              </div>
            )}
            {genError && (
              <Alert variant="destructive" className="border-red-200 bg-red-50/60"><AlertDescription className="whitespace-pre-wrap">{genError}</AlertDescription></Alert>
            )}

            {result && (
              <div className="space-y-6">
                {resultList.map((res) => {
                  const okCount = res.report.filter((r) => r.status === 'ok').length
                  const warnCount = res.report.filter((r) => r.status === 'warn').length
                  return (
                  <div key={res.customer} className="space-y-4">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-teal-200/70 bg-teal-50/50 px-4 py-3 text-sm">
                  <Badge variant="outline" className="border-teal-300 bg-white text-teal-800">{res.customer}</Badge>
                  <span>本次处理 <b>{res.todoCount}</b> 张：</span>
                  <span className="text-emerald-700">✓ 正常 {okCount}</span>
                  {warnCount > 0 && <span className="text-amber-600">⚠ 待核对 {warnCount}</span>}
                  {res.skipped.length > 0 && <span className="text-neutral-500">跳过（母版已有）{res.skipped.length}</span>}
                  <div className="ml-auto flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => exportCsv(res)}>导出验证报告 CSV</Button>
                    <Button size="sm" className="bg-teal-700 text-white hover:bg-teal-800" onClick={() => download(res)}>⬇ 下载{res.customer !== 'ZURU' ? ` ${res.customer} ` : ''}工作簿</Button>
                  </div>
                </div>
                {res.warnings.length > 0 && (
                  <MonthWarnings items={warnItemsOf(res)} range={range} title="生成提示" inactiveMode="all" />
                )}
                {warnCount > 0 && (
                  <Alert className="border-amber-300 bg-amber-50/80">
                    <AlertDescription>
                      <div className="font-medium text-amber-800">⚠ 待核对 {warnCount} 张（差值超 ±0.02，请人工核对后再用）：</div>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-amber-900">
                        {res.report.filter((r) => r.status === 'warn').map((r) => (
                          <span key={r.name} title={r.note}>
                            <b className="font-mono">{r.name}</b>
                            {r.diff !== null && r.diff !== undefined && <span className="text-amber-700">（差 {r.diff > 0 ? '+' : ''}{r.diff.toFixed(4)}）</span>}
                          </span>
                        ))}
                      </div>
                      <div className="mt-1 text-xs text-amber-700">多段票只选了部分段数时差值属正常；其余请对照源表检查明细行。</div>
                    </AlertDescription>
                  </Alert>
                )}
                <div className="max-h-96 overflow-auto rounded-lg border border-neutral-200 bg-white">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 border-b border-neutral-200 bg-neutral-50/95 text-xs text-neutral-500">
                      <tr>
                        {['sheet 名', '发票号', '日期', 'PO 号', '明细行', '分段', 'I48 合计', '源表合计×0.967', '差值', '状态'].map((h) => (
                          <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {res.report.map((r) => (
                        <tr key={r.name} className="border-t border-neutral-100">
                          <td className="px-3 py-1.5 font-mono text-xs">{r.name}</td>
                          <td className="px-3 py-1.5 font-mono text-xs">{r.invNo || ''}</td>
                          <td className="px-3 py-1.5 text-xs">{r.date}</td>
                          <td className="px-3 py-1.5 font-mono text-xs">{r.po || ''}</td>
                          <td className="px-3 py-1.5 text-right text-xs">{r.lines ?? ''}</td>
                          <td className="px-3 py-1.5 text-xs">{r.parts}</td>
                          <td className="px-3 py-1.5 text-right text-xs tabular-nums">{fmtMoney(r.total)}</td>
                          <td className="px-3 py-1.5 text-right text-xs tabular-nums">{fmtMoney(r.refTotal)}</td>
                          <td className="px-3 py-1.5 text-right text-xs tabular-nums">{r.diff !== null && r.diff !== undefined ? r.diff.toFixed(4) : '—'}</td>
                          <td className="px-3 py-1.5 text-xs">
                            {r.status === 'ok' && <span className="text-emerald-700">✓ 正常</span>}
                            {r.status === 'warn' && <span className="text-amber-600" title={r.note}>⚠ 待核对</span>}
                            {r.status === 'skipped' && <span className="text-neutral-400">跳过</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                  </div>
                  )
                })}
                <p className="text-xs text-neutral-400">
                  差值 = 系统合计 − 源表合计×0.967，±0.02 以内属正常（源表自身有分位舍入）。生成文件为 .xlsx，如需 .xls 可用 Excel/WPS 另存。
                </p>
              </div>
            )}

            {history.length > 0 && (
              <div className="border-t border-neutral-100 pt-3">
                <div className="mb-1.5 text-xs font-medium text-neutral-500">最近生成记录</div>
                <div className="space-y-1">
                  {history.map((h, i) => (
                    <div key={i} className="text-xs text-neutral-400">
                      {h.time} —— 生成 {h.count} 张{h.skipped ? `，跳过 ${h.skipped}` : ''}{h.warn ? `，待核对 ${h.warn}` : ''}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 底部固定操作栏 */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white/90 shadow-[0_-4px_16px_rgba(0,0,0,0.04)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
          <div className="text-sm text-neutral-600">
            已选 <b className="text-teal-800">{selectedCount}</b> 张
            <span className="ml-3 text-neutral-500">合计金额 <b className="text-teal-800 tabular-nums">{fmtMoney(selectedAmount)}</b> USD</span>
          </div>
          <div className="ml-auto">
            <Button onClick={doGenerate} disabled={generating || parsing || !base || selectedCount === 0} size="lg"
              className="bg-teal-700 text-white shadow-sm hover:bg-teal-800">
              {generating ? `生成中 ${progress}%` : `生成 ${selectedCount} 张发票`}
            </Button>
          </div>
        </div>
      </div>
    </div>
      </div>
      </main>
    </div>
  )
}
