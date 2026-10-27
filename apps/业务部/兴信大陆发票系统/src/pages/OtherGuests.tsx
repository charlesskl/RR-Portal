/* eslint-disable */
// @ts-nocheck —— UI 胶水层；核心逻辑在 src/lib/otherGuests.js，由 scripts/other-regression.mjs 验证
import { useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import { AlertTriangle, FileSpreadsheet, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  BOOKS, scanDetailSheets, planSheet, generateOther, inspectTemplateBook, filterPlanByDate, invSortKey,
  categoryOfLabel, CATEGORY_NAMES,
} from '@/lib/otherGuests.js'
import { parseOtherDetail } from '@/lib/offThreadParse.js'
import { normRange, inRangeYmd } from '@/lib/dateRange.js'
import { MonthWarnings } from '@/components/MonthWarnings.tsx'
import { loadAsset } from '@/lib/loadAsset.js'
import { mergeWorkbookBuffers } from '@/lib/mergeBooks.js'

const fmtMoney = (v) =>
  v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (d) => {
  if (!(d instanceof Date) || isNaN(d)) return ''
  const pad = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const timestamp = () => {
  const d = new Date()
  const pad = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function StepBadge({ n }) {
  return (
    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-teal-700/20 bg-teal-700/10 text-xs font-semibold text-teal-800">
      {n}
    </span>
  )
}

const cardCls = 'rounded-xl border-neutral-200/90 shadow-[0_1px_2px_rgba(0,0,0,0.04)]'

export default function OtherGuests() {
  const [books, setBooks] = useState(null)        // { key: { buffer, sheetCount } }
  const [booksError, setBooksError] = useState('')
  const [source, setSource] = useState(null)      // { name, sheetRowsMap }
  const [parsing, setParsing] = useState(false)
  const [scan, setScan] = useState(null)          // { supported, unsupported }
  const [selected, setSelected] = useState(new Set())
  const [expanded, setExpanded] = useState(new Set())
  const [plans, setPlans] = useState({})          // sheetName -> planSheet 结果（懒计算缓存）
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)
  const [genError, setGenError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef(null)
  const [customBooks, setCustomBooks] = useState({})  // key -> { buffer, name, sheetCount }
  const [tplPicker, setTplPicker] = useState(null)    // { name, buffer, sheetCount, matches }
  const [tplError, setTplError] = useState('')
  const tplFileRef = useRef(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showRangeDetail, setShowRangeDetail] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const loaded = {}
        for (const [key, b] of Object.entries(BOOKS)) {
          loaded[key] = { buffer: await loadAsset(b.file), short: b.short }
        }
        setBooks(loaded)
      } catch (e) { setBooksError(String(e.message || e)) }
    })()
  }, [])

  /** 上传自定义模板本：.xls 直接拒绝；解析 sheet 名，唯一全中自动匹配，否则让用户选目标本 */
  const onTplUpload = async (file) => {
    if (!file) return
    setTplError(''); setTplPicker(null)
    const name = file.name || ''
    const buffer = await file.arrayBuffer()
    const magic = new Uint8Array(buffer.slice(0, 4))
    const isZip = magic[0] === 0x50 && magic[1] === 0x4b // 'PK'
    if (/\.xls$/i.test(name) || !isZip) {
      setTplError(`「${name}」是老格式 .xls（或不是有效的 .xlsx）。浏览器端无法精确保样式地转换老格式，请先在 Excel / WPS 里「另存为 → Excel 工作簿 (*.xlsx)」后再上传。`)
      return
    }
    try {
      const info = await inspectTemplateBook(buffer)
      const full = Object.entries(info.matches).filter(([, m]) => m.missing.length === 0)
      if (full.length === 1) {
        applyCustomBook(full[0][0], buffer, name, info.sheetNames.length)
      } else {
        setTplPicker({ name, buffer, sheetCount: info.sheetNames.length, matches: info.matches })
      }
    } catch (e) {
      setTplError(`模板本「${name}」解析失败：${e.message || e}。请确认文件未损坏，且为 .xlsx 格式。`)
    }
  }

  const applyCustomBook = (key, buffer, name, sheetCount) => {
    setCustomBooks((prev) => ({ ...prev, [key]: { buffer, name, sheetCount } }))
    setTplPicker(null); setTplError(''); setResult(null)
  }
  const restoreBook = (key) => {
    setCustomBooks((prev) => { const n = { ...prev }; delete n[key]; return n })
    setResult(null)
  }

  const onSourceUpload = async (file) => {
    if (!file) return
    setParsing(true); setResult(null); setPlans({}); setExpanded(new Set())
    try {
      const buffer = await file.arrayBuffer()
      const sheetRowsMap = await parseOtherDetail(buffer)
      const sc = scanDetailSheets(sheetRowsMap)
      setSource({ name: file.name, sheetRowsMap })
      setScan(sc)
      setSelected(new Set(sc.supported.map((s) => s.name)))
    } catch (e) {
      setScan(null); setSource(null)
      setGenError(`明细表解析失败：${e.message || e}`)
    } finally { setParsing(false) }
  }

  const planFor = (name) => {
    if (plans[name]) return plans[name]
    const p = planSheet(name, source.sheetRowsMap[name])
    setPlans((prev) => ({ ...prev, [name]: p }))
    return p
  }

  const toggleExpand = (name) => {
    if (!expanded.has(name)) planFor(name)   // 展开前确保计划已算
    setExpanded((ex) => { const n = new Set(ex); n.has(name) ? n.delete(name) : n.add(name); return n })
  }

  const selectedList = useMemo(() => (scan ? scan.supported.filter((s) => selected.has(s.name)) : []), [scan, selected])

  const range = useMemo(() => normRange(dateFrom, dateTo), [dateFrom, dateTo])

  // 启用日期范围后：逐 sheet 计算范围内发票（kept），生成时只含范围内票
  const filterInfo = useMemo(() => {
    if (!range.active || !scan) return null
    let kept = 0, dropped = 0, noDate = 0
    const bySheet = {}
    for (const s of scan.supported) {
      const f = filterPlanByDate(planFor(s.name), range)
      bySheet[s.name] = f
      kept += f.kept; dropped += f.dropped; noDate += f.noDate
    }
    return { kept, dropped, noDate, bySheet }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.active, range.lo, range.hi, scan, plans])

  const selectedInvoices = filterInfo
    ? selectedList.reduce((s, x) => s + (filterInfo.bySheet[x.name] ? filterInfo.bySheet[x.name].kept : 0), 0)
    : selectedList.reduce((s, x) => s + x.invoiceCount, 0)

  // 筛选范围内发票明细（客人 | 发票号 | 日期 | 类型 | 金额），按发票号数字升序
  const rangeDetail = useMemo(() => {
    if (!filterInfo || !scan) return null
    const list = []
    for (const s of scan.supported) {
      const f = filterInfo.bySheet[s.name]
      if (!f) continue
      for (const v of f.plan.invoices) {
        list.push({ label: s.label || s.name, inv: v.inv, date: fmtDate(v.date), total: v.total, kind: v.kindName })
      }
    }
    list.sort((a, b) => { const ka = invSortKey(a.inv), kb = invSortKey(b.inv); return ka.n - kb.n || (ka.s < kb.s ? -1 : ka.s > kb.s ? 1 : 0) })
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterInfo, scan])

  // 生成提示条目（缺金额/异常行/费用行跳过/拆续票/无发票号行）：从完整计划派生并挂日期归属，
  // 由 MonthWarnings 按当前日期范围过滤——切日期即时更新，不再等重新生成
  const noteItems = useMemo(() => {
    if (!scan) return []
    const items = []
    for (const s of selectedList) {
      const p = planFor(s.name)
      if (!p) continue
      const ymdByInv = new Map(p.invoices.map((v) => [v.inv, fmtDate(v.date)]))
      const yOf = (e) => fmtDate(e.date) || ymdByInv.get(e.inv) || ''
      for (const e of p.skippedNoAmt) items.push({ text: `${p.sheetName}：第 ${e.row} 行（${e.inv}）缺金额未进发票${e.desc ? ` — ${e.desc}` : ''}`, ymd: yOf(e) })
      for (const e of p.anomalies) items.push({ text: `${p.sheetName}：第 ${e.row} 行（${e.inv}）${e.issue}${e.desc ? ` — ${e.desc}` : ''}`, ymd: yOf(e) })
      for (const e of p.skippedFee) items.push({ text: `${p.sheetName}：第 ${e.row} 行（${e.inv}）Deposit 型费用行跳过（无历史对照）${e.desc ? ` — ${e.desc}` : ''}`, ymd: yOf(e) })
      for (const e of p.splits) items.push({ text: `${p.sheetName}：${e.inv} 超容量拆 ${e.chunkCount} 张续票（共 ${e.lineCount} 行）`, ymd: yOf(e) })
      for (const e of p.skippedNoInv) items.push({ text: `${p.sheetName}：第 ${e.row} 行无发票号，已跳过`, ymd: fmtDate(e.date) })
    }
    return items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan, selected, plans])

  const doGenerate = async () => {
    if (!books || !source) return
    setGenerating(true); setProgress(0); setResult(null); setGenError('')
    try {
      let ps = selectedList.map((s) => planFor(s.name)).filter(Boolean)
      if (filterInfo) {
        ps = ps.map((p) => filterInfo.bySheet[p.sheetName].plan).filter((p) => p.chunks.length > 0)
        if (!ps.length) throw new Error(`筛选日期范围 ${range.lo || '…'} ~ ${range.hi || '…'} 内没有发票`)
      }
      const bookBuffers = {}
      for (const [k, b] of Object.entries(books)) bookBuffers[k] = (customBooks[k] && customBooks[k].buffer) || b.buffer
      const res = await generateOther({
        bookBuffers, plans: ps, timestamp: timestamp(),
        onProgress: (d, t) => setProgress(Math.round((d / t) * 100)),
      })
      setResult(res)
      setMergeSel(new Set(res.files.map((f) => f.label)))
    } catch (e) {
      console.error(e)
      setGenError(String(e && e.message ? e.message : e))
    } finally { setGenerating(false) }
  }

  const downloadFiles = async (files, zipName) => {
    const a = document.createElement('a')
    if (files.length === 1) {
      const f = files[0]
      a.href = URL.createObjectURL(new Blob([f.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      a.download = f.name
    } else {
      const zip = new JSZip()
      for (const f of files) zip.file(f.name, f.buffer)
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
      a.href = URL.createObjectURL(blob)
      a.download = zipName
    }
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const download = async () => {
    if (!result) return
    await downloadFiles(result.files, `其他客发票_${timestamp()}.zip`)
  }

  // 分类下载：该分类下所有客人的 sheet 合并成一个工作簿（同客连续、票号升序）
  const [merging, setMerging] = useState('')
  const [mergeNote, setMergeNote] = useState('')
  const [mergeSel, setMergeSel] = useState(new Set())  // 自选合并：勾选的客人 label
  const downloadCat = async (g) => {
    if (merging) return
    setMerging(g.cat); setMergeNote('')
    try {
      const { buffer, renames } = await mergeWorkbookBuffers(g.files.map((f) => ({ buffer: f.buffer, tag: f.label })))
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      a.download = `其他客发票_${g.name}_${timestamp()}.xlsx`
      a.click()
      URL.revokeObjectURL(a.href)
      if (renames.length) setMergeNote(`${g.name}合并工作簿里有 ${renames.length} 张重名 sheet 已加客人后缀区分：${renames.map((r) => `${r.from}→${r.to}`).join('；')}`)
    } catch (e) {
      setGenError(`合并${g.name}分类失败：${e.message || e}`)
    } finally { setMerging('') }
  }

  // 按所属公司（香港/远东/国际/未分类）分组，供分份下载
  const filesByCat = useMemo(() => {
    if (!result) return []
    const m = new Map()
    for (const f of result.files) {
      const c = f.cat || categoryOfLabel(f.label) || 'other'
      if (!m.has(c)) m.set(c, [])
      m.get(c).push(f)
    }
    return ['hk', 'yd', 'intl', 'other']
      .filter((c) => m.has(c))
      .map((c) => ({ cat: c, name: CATEGORY_NAMES[c] || c, files: m.get(c) }))
  }, [result])

  // 自选合并：按客人 label 分组（保持生成顺序），勾选哪些客人的发票进同一张表格
  const customers = useMemo(() => {
    if (!result) return []
    const m = new Map()
    for (const f of result.files) {
      if (!m.has(f.label)) m.set(f.label, { label: f.label, cat: f.cat || 'other', sheetCount: 0 })
      m.get(f.label).sheetCount += f.sheetCount
    }
    return [...m.values()]
  }, [result])

  const downloadMergeSel = async () => {
    if (!result || merging || mergeSel.size === 0) return
    const picked = result.files.filter((f) => mergeSel.has(f.label))
    setMerging('custom'); setMergeNote('')
    try {
      const { buffer, renames } = await mergeWorkbookBuffers(picked.map((f) => ({ buffer: f.buffer, tag: f.label })))
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      a.download = `其他客发票_自选合并_${timestamp()}.xlsx`
      a.click()
      URL.revokeObjectURL(a.href)
      if (renames.length) setMergeNote(`自选合并工作簿里有 ${renames.length} 张重名 sheet 已加客人后缀区分：${renames.map((r) => `${r.from}→${r.to}`).join('；')}`)
    } catch (e) {
      setGenError(`自选合并失败：${e.message || e}`)
    } finally { setMerging('') }
  }
  const mergeSelCount = customers.filter((c) => mergeSel.has(c.label)).reduce((n, c) => n + c.sheetCount, 0)

  const exportCsv = () => {
    if (!result) return
    const head = '输出文件,sheet名,客人,来源sheet,类型,模板,明细行数,合计USD,提示\n'
    const body = result.report.map((r) => [
      r.file, r.sheet, r.customer, r.srcSheet, r.kind, r.tpl, r.lines,
      r.total !== null && r.total !== undefined ? r.total.toFixed(2) : '',
      (r.flags || []).join('；'),
    ].map((x) => String(x).includes(',') ? `"${String(x).replace(/"/g, '""')}"` : x).join(',')).join('\n')
    const blob = new Blob(['﻿' + head + body], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `其他客生成报告_${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="min-h-screen bg-neutral-50 pb-28 text-neutral-900">
      {/* 页头 */}
      <div className="border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <p className="text-xs font-medium tracking-[0.2em] text-teal-700">多客人汇总 · 批量生成</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">其他客发票</h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-neutral-500">
            上传多客人汇总出货明细表，系统自动识别已配置模板的客人 sheet，按历史发票模版批量生成并按客人分文件输出，多个文件自动打包为 ZIP。
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        {/* 步骤 1：模板本 */}
        <Card className={cardCls}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-3 text-base"><StepBadge n="1" />模板本（内置）</CardTitle>
            <CardDescription>
              以各模板本里的历史发票 sheet 为模版生成：兴信香港（TOMY/Zanzoon/John Adams/Masterkidz）、
              兴信远东（CEPIA/Moose/Tokidos/龙昌/Exceenis）、兴信香港新模板（Tigerhead 出货/模费、John Adams 定金，2026-09 文员提供）。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              {books ? (
                Object.entries(BOOKS).map(([key, b]) => {
                  const custom = customBooks[key]
                  return (
                    <span key={key} className="inline-flex items-center gap-1.5">
                      <Badge variant="outline" className={custom
                        ? 'border-amber-300 bg-amber-50 px-2.5 py-1 font-normal text-amber-800'
                        : 'border-teal-200 bg-teal-50 px-2.5 py-1 font-normal text-teal-800'}>
                        <FileSpreadsheet className="h-3 w-3" />{b.short}{custom ? '（自定义）' : ''}
                      </Badge>
                      {custom && (
                        <>
                          <span className="max-w-48 truncate font-mono text-xs text-neutral-400" title={custom.name}>{custom.name}</span>
                          <button type="button" onClick={() => restoreBook(key)}
                            className="rounded border border-neutral-200 px-1.5 py-0.5 text-xs text-neutral-500 hover:border-teal-400 hover:text-teal-700">
                            恢复内置
                          </button>
                        </>
                      )}
                    </span>
                  )
                })
              ) : booksError ? (
                <span className="text-red-600">{booksError}</span>
              ) : (
                <span className="text-neutral-500">加载中…</span>
              )}
              {books && (
                <Button size="sm" variant="outline" className="ml-auto" onClick={() => tplFileRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5" />上传自定义模板本
                </Button>
              )}
            </div>
            {tplError && (
              <Alert variant="destructive" className="border-red-200 bg-red-50/60"><AlertDescription>{tplError}</AlertDescription></Alert>
            )}
            {tplPicker && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3">
                <div className="text-xs text-amber-700">
                  「{tplPicker.name}」（{tplPicker.sheetCount} 个 sheet）不能自动确定替换哪个模板本，请选择目标：
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {Object.entries(BOOKS).map(([key, b]) => {
                    const m = tplPicker.matches[key]
                    return (
                      <Button key={key} size="sm" variant="outline"
                        onClick={() => applyCustomBook(key, tplPicker.buffer, tplPicker.name, tplPicker.sheetCount)}>
                        {b.short}（模板匹配 {m.hit}/{m.need}{m.missing.length ? `，缺 ${m.missing.join('、')}` : ''}）
                      </Button>
                    )
                  })}
                  <Button size="sm" variant="ghost" onClick={() => setTplPicker(null)}>取消</Button>
                </div>
              </div>
            )}
            {books && Object.keys(customBooks).length > 0 && (
              <div className="text-xs text-amber-700">生成时将使用上传的自定义模板本替换对应内置本；刷新页面恢复全部内置。</div>
            )}
          </CardContent>
        </Card>

        {/* 步骤 2：上传明细表 */}
        <Card className={cardCls}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-3 text-base"><StepBadge n="2" />上传出货明细表</CardTitle>
            <CardDescription>多客人汇总表（.xlsx），一个 sheet = 一个客人的一类单据；系统自动识别各客人 sheet，未配置专属模板的按通用格式套用生成并标注「模板套用（推测）」请人工核对。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              className={`flex h-32 cursor-pointer items-center justify-center rounded-xl border border-dashed transition-colors ${dragOver ? 'border-teal-600 bg-teal-50/60' : 'border-neutral-300 bg-neutral-50/60 hover:border-teal-500/60 hover:bg-teal-50/40'}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); onSourceUpload(e.dataTransfer.files?.[0]) }}
            >
              <div className="text-center">
                <div className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full border bg-white shadow-sm transition-colors ${dragOver ? 'border-teal-300 text-teal-700' : 'border-neutral-200 text-neutral-400'}`}>
                  <Upload className="h-4 w-4" />
                </div>
                <div className="mt-2.5 text-sm text-neutral-600">{parsing ? '正在解析，请稍候…' : '点击选择或拖拽明细表到这里'}</div>
                <div className="mt-1 text-xs text-neutral-400">仅支持 .xlsx</div>
              </div>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx" className="hidden" aria-label="明细表上传"
              onChange={(e) => { onSourceUpload(e.target.files?.[0]); e.target.value = '' }} />
            {source && scan && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-600">
                <Badge variant="outline" className="max-w-md truncate border-neutral-200 font-mono text-xs font-normal text-neutral-600">{source.name}</Badge>
                <span>
                  识别到 <b className="text-teal-800">{scan.supported.length}</b> 个可生成的客人 sheet（共 {scan.supported.reduce((s, x) => s + x.invoiceCount, 0)} 张发票{filterInfo && <>，筛选后 <b className="text-teal-800">{filterInfo.kept}</b> 张</>}），
                  <span className="text-neutral-400">{scan.unsupported.length} 个 sheet 格式不适用未生成</span>
                  {(scan.excluded || []).length > 0 && <span className="text-amber-700">，{scan.excluded.length} 个 sheet 未标框不生成</span>}
                  {(scan.indonesia || []).length > 0 && <span className="text-neutral-400">，{scan.indonesia.length} 个印尼 sheet 按口径不打</span>}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 步骤 3：选择客人 sheet */}
        {scan && (
          <Card className={cardCls}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-3 text-base"><StepBadge n="3" />选择要生成的客人</CardTitle>
              <CardDescription>发票号分组按从小到大排序生成；点击任意一行可展开核对发票清单。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                <span className="text-neutral-500">发票日期</span>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 w-36 text-xs" title="起始日期（含当天）" />
                <span className="text-neutral-400">至</span>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 w-36 text-xs" title="截止日期（含当天）" />
                {(dateFrom || dateTo) && (
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setDateFrom(''); setDateTo('') }}>清空</Button>
                )}
              </div>
              {filterInfo && (
                <div className="rounded-lg border border-teal-200 bg-teal-50/70 px-3 py-2 text-xs text-teal-900">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>
                      已筛选:{range.lo || '不限'} ~ {range.hi || '不限'} → 范围内 <b>{filterInfo.kept}</b> 张
                      （范围外 {filterInfo.dropped} 张不生成{filterInfo.noDate > 0 && <>，日期缺失 {filterInfo.noDate} 张已排除</>}）
                      {range.inverted && <span className="ml-1 text-amber-700">起止倒置已自动互换</span>}
                    </span>
                    <Button size="sm" variant="outline" className="h-6 px-2 text-xs"
                      onClick={() => setShowRangeDetail((v) => !v)}>
                      {showRangeDetail ? '收起明细' : `查看明细 ${filterInfo.kept} 张`}
                    </Button>
                  </div>
                  {showRangeDetail && rangeDetail && (
                    <div className="mt-2 max-h-72 overflow-auto rounded border border-teal-200 bg-white">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-teal-50 text-neutral-600">
                          <tr>
                            <th className="px-2 py-1 text-left font-medium">客人</th>
                            <th className="px-2 py-1 text-left font-medium">发票号</th>
                            <th className="px-2 py-1 text-left font-medium">日期</th>
                            <th className="px-2 py-1 text-left font-medium">类型</th>
                            <th className="px-2 py-1 text-right font-medium">金额(USD)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rangeDetail.map((v, i) => (
                            <tr key={i} className="border-t border-neutral-100">
                              <td className="px-2 py-1 text-neutral-500">{v.label}</td>
                              <td className="px-2 py-1 font-medium text-teal-900">{v.inv}</td>
                              <td className="px-2 py-1 tabular-nums">{v.date}</td>
                              <td className="px-2 py-1 text-neutral-500">{v.kind || ''}</td>
                              <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(v.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Button size="sm" variant="outline" onClick={() => setSelected(new Set(scan.supported.map((s) => s.name)))}>全选</Button>
                <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>取消全选</Button>
                <span className="ml-auto text-neutral-500">已选 <b className="text-teal-800">{selected.size}</b> 个 sheet · {selectedInvoices} 张发票</span>
              </div>
              {selectedList.length > 0 && (
                <MonthWarnings items={noteItems} range={range} title="生成提示"
                  placeholder="选择发票日期范围后，这里只显示该范围内的生成提示（缺金额、异常行、费用行跳过、拆续票等）。" />
              )}
              <div className="max-h-[26rem] overflow-auto rounded-lg border border-neutral-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 border-b border-neutral-200 bg-neutral-50/95 text-xs text-neutral-500">
                    <tr>
                      <th className="w-10 px-3 py-2.5"></th>
                      <th className="px-3 py-2.5 text-left font-medium">明细表 sheet</th>
                      <th className="px-3 py-2.5 text-left font-medium">客人</th>
                      <th className="px-3 py-2.5 text-right font-medium">发票数</th>
                      <th className="px-3 py-2.5 text-left font-medium">备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scan.supported.map((s) => {
                      const checked = selected.has(s.name)
                      const open = expanded.has(s.name)
                      const plan = open ? planFor(s.name) : null
                      return [
                        <tr key={s.name}
                          className={`border-t border-neutral-100 transition-colors cursor-pointer ${checked ? 'bg-teal-50/50' : 'hover:bg-neutral-50'}`}
                          onClick={() => toggleExpand(s.name)}>
                          <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" className="accent-teal-700" checked={checked}
                              onChange={(e) => setSelected((sel) => {
                                const next = new Set(sel)
                                e.target.checked ? next.add(s.name) : next.delete(s.name)
                                return next
                              })} />
                          </td>
                          <td className="px-3 py-1.5 font-mono text-xs">{open ? '▾ ' : '▸ '}{s.name}</td>
                          <td className="px-3 py-1.5 text-xs">{s.label}</td>
                          <td className="px-3 py-1.5 text-right text-xs tabular-nums">
                            {filterInfo
                              ? <><b className="text-teal-800">{filterInfo.bySheet[s.name].kept}</b><span className="text-neutral-400">/{s.invoiceCount}</span></>
                              : s.invoiceCount}
                          </td>
                          <td className="px-3 py-1.5 text-xs">
                            {s.guess && <span className="text-amber-600">⚠ 模板套用（推测）</span>}
                          </td>
                        </tr>,
                        open && plan && (
                          <tr key={s.name + '-detail'} className="bg-neutral-50/70">
                            <td colSpan={5} className="px-6 py-3">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-neutral-400">
                                    <th className="py-1 text-left font-medium">发票号</th>
                                    <th className="py-1 text-left font-medium">类型</th>
                                    <th className="py-1 text-left font-medium">日期</th>
                                    <th className="py-1 text-right font-medium">明细行</th>
                                    <th className="py-1 text-right font-medium">合计USD</th>
                                    <th className="py-1 text-left font-medium">提示</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {plan.invoices.map((v) => {
                                    const inR = !range.active || inRangeYmd(fmtDate(v.date), range)
                                    return (
                                    <tr key={v.inv} className={`border-t border-neutral-200/70 ${inR ? '' : 'opacity-40'}`}>
                                      <td className="py-0.5 font-mono">{v.inv}</td>
                                      <td className="py-0.5">{v.kindName}</td>
                                      <td className="py-0.5">{fmtDate(v.date)}</td>
                                      <td className="py-0.5 text-right">{v.lineCount}</td>
                                      <td className="py-0.5 text-right tabular-nums">{fmtMoney(v.total)}</td>
                                      <td className="py-0.5 text-amber-600">{inR ? v.flags.join('；') : <span className="text-neutral-400">范围外</span>}</td>
                                    </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        ),
                      ]
                    })}
                  </tbody>
                </table>
              </div>
              {(scan.excluded || []).length > 0 && (
                <details className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 text-xs">
                  <summary className="flex cursor-pointer items-center gap-1.5 font-medium text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5" />{scan.excluded.length} 个 sheet 未标框，按口径不生成（与月份无关的固定口径，点击展开）
                  </summary>
                  <div className="mt-1.5 space-y-0.5 text-neutral-600">
                    {scan.excluded.map((s) => (
                      <div key={s.name}>
                        <b className="font-medium text-neutral-800">{s.name}</b>（{s.label}，{s.reason}）：
                        {s.invoiceCount} 张发票未生成 — <span className="font-mono">{s.invoices.join('、')}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              {scan.unsupported.length > 0 && (
                <details className="text-xs text-neutral-500">
                  <summary className="cursor-pointer">格式不适用未生成的 {scan.unsupported.length} 个 sheet</summary>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-neutral-400">
                    {scan.unsupported.map((s) => <span key={s.name} className="font-mono">{s.name}（{s.rows}行{s.reason ? `，${s.reason}` : ''}）</span>)}
                  </div>
                </details>
              )}
              {(scan.indonesia || []).length > 0 && (
                <details className="text-xs text-neutral-500">
                  <summary className="cursor-pointer">印尼票按口径不打的 {scan.indonesia.length} 个 sheet</summary>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-neutral-400">
                    {scan.indonesia.map((s) => <span key={s.name} className="font-mono">{s.name}（{s.rows}行）</span>)}
                  </div>
                </details>
              )}
            </CardContent>
          </Card>
        )}

        {/* 步骤 4：生成 · 下载 */}
        {scan && (
          <Card className={cardCls}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-3 text-base"><StepBadge n="4" />生成 · 下载</CardTitle>
              <CardDescription>按「客人 sheet × 模板本」分文件输出（与旧工具一致），同一客人的 sheet 连续排列不混客；分类下载按钮把该类全部 sheet 合并成一个工作簿（香港 / 远东 / 国际各一份），下方可按客人勾选自由合并成一张表格，「全部打包」为按客人分文件的 ZIP。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-teal-200/70 bg-teal-50/50 px-4 py-3 text-sm">
                    <span>生成 <b>{result.files.length}</b> 个文件 · 共 <b>{result.report.length}</b> 个 sheet</span>
                    {result.report.filter((r) => r.flags.length).length > 0 && (
                      <span className="text-amber-600">⚠ 带提示 {result.report.filter((r) => r.flags.length).length} 张</span>
                    )}
                    <div className="ml-auto flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={exportCsv}>导出报告 CSV</Button>
                      {filesByCat.map((g) => (
                        <Button key={g.cat} size="sm" className="bg-teal-700 text-white hover:bg-teal-800"
                          disabled={!!merging}
                          title={`${g.name}分类全部 ${g.files.reduce((n, f) => n + f.sheetCount, 0)} 张 sheet 合并为一个工作簿下载`}
                          onClick={() => downloadCat(g)}>
                          {merging === g.cat ? '合并中…' : `⬇ ${g.name}（${g.files.reduce((n, f) => n + f.sheetCount, 0)}张）`}
                        </Button>
                      ))}
                      {filesByCat.length > 1 && (
                        <Button size="sm" variant="outline" title="按「客人 sheet × 模板本」分文件打成 ZIP（未合并）" onClick={download}>全部打包</Button>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {result.files.map((f) => (
                      <Badge key={f.name} variant="outline" className={`rounded-md px-2 py-1 font-mono font-normal ${(f.cat || 'other') === 'other' ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-neutral-200 bg-white text-neutral-600'}`}>
                        <FileSpreadsheet className="h-3 w-3 text-teal-700" />【{CATEGORY_NAMES[f.cat || 'other'] || '未分类'}】{f.name}（{f.sheetCount}张）
                      </Badge>
                    ))}
                  </div>
                  {customers.length > 0 && (
                    <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-medium text-neutral-800">选择要合并到一张表格的客人：</span>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setMergeSel(new Set(customers.map((c) => c.label)))}>全选</Button>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setMergeSel(new Set())}>取消全选</Button>
                        <Button size="sm" className="ml-auto h-7 bg-teal-700 text-white hover:bg-teal-800"
                          disabled={!!merging || mergeSel.size === 0}
                          title="把勾选客人的全部发票 sheet 合并成一个工作簿下载（同客连续、票号升序）"
                          onClick={downloadMergeSel}>
                          {merging === 'custom' ? '合并中…' : `⬇ 选中客人合并成一张表格（${mergeSelCount}张）`}
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                        {customers.map((c) => (
                          <label key={c.label} className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-700">
                            <input type="checkbox" className="accent-teal-700" checked={mergeSel.has(c.label)}
                              onChange={(e) => setMergeSel((sel) => {
                                const next = new Set(sel)
                                e.target.checked ? next.add(c.label) : next.delete(c.label)
                                return next
                              })} />
                            <span>【{CATEGORY_NAMES[c.cat] || '未分类'}】{c.label}</span>
                            <span className="text-neutral-400">（{c.sheetCount}张）</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  {result.files.some((f) => (f.cat || 'other') === 'other') && (
                    <p className="text-xs text-amber-700">黄色【未分类】= 该客在排期目录里未标框（文员口径暂不生成），如确认要归香港/远东/国际，告诉我调整分类。</p>
                  )}
                  {mergeNote && (
                    <p className="text-xs text-teal-800">{mergeNote}</p>
                  )}
                  <div className="max-h-96 overflow-auto rounded-lg border border-neutral-200 bg-white">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10 border-b border-neutral-200 bg-neutral-50/95 text-xs text-neutral-500">
                        <tr>
                          {['sheet 名', '客人', '类型', '模板', '明细行', '合计USD', '提示'].map((h) => (
                            <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.report.map((r, i) => (
                          <tr key={r.sheet + i} className="border-t border-neutral-100">
                            <td className="px-3 py-1.5 font-mono text-xs">{r.sheet}</td>
                            <td className="px-3 py-1.5 text-xs">{r.customer}</td>
                            <td className="px-3 py-1.5 text-xs">{r.kind}</td>
                            <td className="px-3 py-1.5 text-xs">{r.book} / {r.tpl}</td>
                            <td className="px-3 py-1.5 text-right text-xs">{r.lines}</td>
                            <td className="px-3 py-1.5 text-right text-xs tabular-nums">{fmtMoney(r.total)}</td>
                            <td className="px-3 py-1.5 text-xs text-amber-600">{(r.flags || []).join('；')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* 底部固定操作栏 */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white/90 shadow-[0_-4px_16px_rgba(0,0,0,0.04)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
          <div className="text-sm text-neutral-600">
            已选 <b className="text-teal-800">{selected.size}</b> 个客人 sheet
            <span className="ml-3 text-neutral-500">共 <b className="text-teal-800">{selectedInvoices}</b> 张发票{filterInfo && <span className="text-teal-700">（已按日期筛选）</span>}</span>
          </div>
          <div className="ml-auto">
            <Button onClick={doGenerate} disabled={generating || parsing || !books || !source || selected.size === 0} size="lg"
              className="bg-teal-700 text-white shadow-sm hover:bg-teal-800">
              {generating ? `生成中 ${progress}%` : `生成 ${selectedInvoices} 张发票`}
            </Button>
          </div>
        </div>
      </div>
      {/* 模板本上传的隐藏 input 放在最后：保持 input[type=file] 的 DOM 顺序（明细表输入在先是既有约定） */}
      <input ref={tplFileRef} type="file" accept=".xlsx,.xls" className="hidden" aria-label="模板本上传"
        onChange={(e) => { onTplUpload(e.target.files?.[0]); e.target.value = '' }} />
    </div>
  )
}
