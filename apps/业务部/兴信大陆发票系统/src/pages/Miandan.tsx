/* eslint-disable */
// @ts-nocheck —— UI 胶水层；核心逻辑在 src/lib/miandan.js，由 scripts/miandan-verify.mjs 验证
import { useEffect, useMemo, useRef, useState } from 'react'
import { FileSpreadsheet, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { TPL_FILE, parseAnySourceBook, generateMiandan, baseOfSheetName } from '@/lib/miandan.js'
import { normRange, ymdOfParts, inRangeYmd } from '@/lib/dateRange.js'
import { MonthWarnings } from '@/components/MonthWarnings.tsx'
import { parseMiandanBook, parseInvoiceBook, reconcile, buildReportBuffer } from '@/lib/reconcile.js'
import { loadAsset } from '@/lib/loadAsset.js'

const fmtMoney = (v) =>
  v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 发票号排序：数字部分升序（小的在上），同号按全串排（REV 跟基号后） */
const invCmp = (a, b) => {
  const na = +(String(a.inv).match(/\d+/) || [Infinity])[0]
  const nb = +(String(b.inv).match(/\d+/) || [Infinity])[0]
  return na - nb || String(a.inv).localeCompare(String(b.inv))
}

const timestamp = () => {
  const d = new Date()
  const pad = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

const KIND_LABEL = { us: '美国簿', intl: '国际簿' }
const KIND_BADGE = {
  us: 'border-sky-200 bg-sky-50 text-sky-800',
  intl: 'border-violet-200 bg-violet-50 text-violet-800',
}

function StepBadge({ n }) {
  return (
    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-teal-700/20 bg-teal-700/10 text-xs font-semibold text-teal-800">
      {n}
    </span>
  )
}

const cardCls = 'rounded-xl border-neutral-200/90 shadow-[0_1px_2px_rgba(0,0,0,0.04)]'

function BlockTable({ sheet }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Badge variant="outline" className={`font-normal ${KIND_BADGE[sheet.kind]}`}>{KIND_LABEL[sheet.kind]}</Badge>
        {sheet.name}
        <span className="text-xs font-normal text-neutral-400">
          {sheet.blocks.reduce((n, b) => n + b.rows, 0)} 行 · {sheet.blocks.length} 个月份块
        </span>
      </div>
      <div className="overflow-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50/95 text-xs text-neutral-500">
            <tr>
              {['月份块', '行数', '香港合计(USD)', '香港合计(HK$)', '大陆合计(USD)', '大陆合计(HK$)'].map((h) => (
                <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.blocks.map((b) => (
              <tr key={`${b.year}-${b.month}`} className="border-t border-neutral-100">
                <td className="px-3 py-1.5 text-xs font-medium">{b.year}年{b.month}月</td>
                <td className="px-3 py-1.5 text-right text-xs">{b.rows}</td>
                <td className="px-3 py-1.5 text-right text-xs tabular-nums">{fmtMoney(b.sumD)}</td>
                <td className="px-3 py-1.5 text-right text-xs tabular-nums">{fmtMoney(b.sumE)}</td>
                <td className="px-3 py-1.5 text-right text-xs tabular-nums">{fmtMoney(b.sumJ)}</td>
                <td className="px-3 py-1.5 text-right text-xs tabular-nums">{fmtMoney(b.sumK)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function Miandan() {
  const [tpl, setTpl] = useState(null)            // { buffer }
  const [tplError, setTplError] = useState('')
  const [sources, setSources] = useState([])      // [{ name, status, stats, parsed, error }]
  const [parsing, setParsing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState(null)      // generateMiandan 返回 + fileName
  const [genError, setGenError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showRangeDetail, setShowRangeDetail] = useState(false)
  const fileRef = useRef(null)

  // —— 金额核对（面单 ↔ 发票）——
  const [recMdFile, setRecMdFile] = useState(null)      // { name, buffer } 上传的旧面单；null=用刚生成的
  const [recInvFiles, setRecInvFiles] = useState([])    // [{ name, buffer }] 修改大陆发票工作簿（可多文件）
  const [recRunning, setRecRunning] = useState(false)
  const [recResult, setRecResult] = useState(null)      // { rows, summary, reportBuffer, mdName }
  const [recError, setRecError] = useState('')
  const recMdRef = useRef(null)
  const recInvRef = useRef(null)

  const readXlsxFile = async (file, what) => {
    const buffer = await file.arrayBuffer()
    const magic = new Uint8Array(buffer.slice(0, 4))
    if (!(magic[0] === 0x50 && magic[1] === 0x4b)) {
      throw new Error(`${what}「${file.name}」是老格式 .xls（或不是有效的 .xlsx）。请先在 Excel / WPS 里「另存为 → Excel 工作簿 (*.xlsx)」后再上传。`)
    }
    return buffer
  }

  const onRecMdUpload = async (file) => {
    if (!file) return
    setRecError(''); setRecResult(null)
    try {
      const buffer = await readXlsxFile(file, '面单文件')
      setRecMdFile({ name: file.name, buffer })
    } catch (e) { setRecError(String(e.message || e)) }
  }

  const onRecInvUpload = async (files) => {
    if (!files || !files.length) return
    setRecError(''); setRecResult(null)
    try {
      const list = []
      for (const file of Array.from(files)) list.push({ name: file.name, buffer: await readXlsxFile(file, '发票工作簿') })
      setRecInvFiles((prev) => [...prev.filter((x) => !list.some((f) => f.name === x.name)), ...list])
    } catch (e) { setRecError(String(e.message || e)) }
  }

  const doReconcile = async () => {
    setRecRunning(true); setRecResult(null); setRecError('')
    await new Promise((r) => setTimeout(r, 50)) // 让「核对中…」先渲染，再做重活
    try {
      const mdBuf = recMdFile ? recMdFile.buffer : (result && result.buffer)
      const mdName = recMdFile ? recMdFile.name : (result && result.fileName)
      if (!mdBuf) throw new Error('请先在上方生成面单，或上传面单文件（.xlsx）')
      if (!recInvFiles.length) throw new Error('请上传至少一个「修改大陆发票」工作簿（ZURU 标签页的生成产物）')
      const md = parseMiandanBook(mdBuf)
      const map = new Map()
      for (const f of recInvFiles) {
        const { map: m2 } = parseInvoiceBook(f.buffer)
        for (const [k, v] of m2) map.set(k, v)
      }
      const rec = reconcile(md.rows, map)
      rec.reportBuffer = await buildReportBuffer(rec)
      rec.mdName = mdName
      setRecResult(rec)
    } catch (e) {
      console.error(e)
      setRecError(String(e && e.message ? e.message : e))
    } finally { setRecRunning(false) }
  }

  const downloadReport = () => {
    if (!recResult || !recResult.reportBuffer) return
    const d = new Date()
    const pad = (x) => String(x).padStart(2, '0')
    const blob = new Blob([recResult.reportBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `面单发票核对分析_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.xlsx`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  useEffect(() => {
    ;(async () => {
      try {
        setTpl({ buffer: await loadAsset(TPL_FILE) })
      } catch (e) { setTplError(String(e.message || e)) }
    })()
  }, [])

  const onUpload = async (files) => {
    if (!files || !files.length) return
    setParsing(true); setResult(null)
    try {
      for (const file of Array.from(files)) {
        if (!/\.xlsx$/i.test(file.name)) {
          setSources((s) => [...s.filter((x) => x.name !== file.name),
            { name: file.name, status: 'error', error: '只支持 .xlsx（.xls 请先用 Excel/WPS 另存为 .xlsx）' }])
          continue
        }
        setSources((s) => [...s.filter((x) => x.name !== file.name), { name: file.name, status: 'parsing' }])
        await new Promise((r) => setTimeout(r, 50))
        try {
          const buffer = await file.arrayBuffer()
          const parsed = await parseAnySourceBook(buffer, file.name)
          setSources((s) => s.map((x) => x.name === file.name ? { ...x, status: 'done', parsed } : x))
        } catch (e) {
          setSources((s) => s.map((x) => x.name === file.name ? { ...x, status: 'error', error: String(e.message || e) } : x))
        }
      }
    } finally { setParsing(false) }
  }

  const ready = sources.filter((s) => s.status === 'done')
  const countByKind = (kind) => ready.filter((s) => s.parsed.kind === kind).reduce((n, s) => n + s.parsed.stats.finalCount, 0)
  const totalFinal = ready.reduce((n, s) => n + s.parsed.stats.finalCount, 0)

  const range = useMemo(() => normRange(dateFrom, dateTo), [dateFrom, dateTo])

  // 启用日期范围后：合并去重（同号取版本链更长的，与生成逻辑一致）再数范围内张数，并产出范围内明细
  const rangeCount = useMemo(() => {
    if (!range.active || !ready.length) return null
    const merged = new Map()
    for (const s of ready) {
      for (const [base, v] of s.parsed.bases) {
        const old = merged.get(base)
        if (!old || v.versions >= old.versions) merged.set(base, { ...v, kind: s.parsed.kind })
      }
    }
    const keptList = []
    let dropped = 0
    for (const v of merged.values()) {
      const ymd = ymdOfParts(v.date)
      if (inRangeYmd(ymd, range)) keptList.push({ inv: v.inv, ymd, total: v.total, versions: v.versions, kind: v.kind })
      else dropped++
    }
    keptList.sort(invCmp)
    return { kept: keptList.length, dropped, total: merged.size, keptList }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.active, range.lo, range.hi, sources])

  // 源簿提示条目（跳过/取消/草稿），挂日期归属后由 MonthWarnings 按所选范围过滤，切日期即时更新
  const warnItems = useMemo(() => {
    const ymdByBase = new Map()
    for (const s of ready) {
      for (const [base, v] of s.parsed.bases) {
        if (!ymdByBase.has(base)) ymdByBase.set(base, ymdOfParts(v.date))
      }
    }
    const ymdOfSheet = (name) => {
      const b = baseOfSheetName(name)
      return (b && ymdByBase.get(b)) || ''
    }
    const items = []
    for (const s of ready) {
      const p = s.parsed
      const fn = p.stats.fileName
      for (const sk of p.skipped) items.push({ text: `${fn}:${sk.sheet} ${sk.reason},已跳过`, ymd: ymdOfSheet(sk.sheet) })
      for (const c of p.cancelled || []) items.push({ text: `${fn}:${c} 标记「取消」,未进面单(如属误标请改名后重新上传)`, ymd: ymdOfSheet(c) })
      for (const d of p.drafts || []) items.push({ text: `${fn}:${d} 名像发票号但内容不完整(疑似草稿),未进面单`, ymd: ymdOfSheet(d) })
    }
    return items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources])

  const doGenerate = async () => {
    if (!tpl || !ready.length) return
    setGenerating(true); setResult(null); setGenError('')
    try {
      const res = await generateMiandan({ tplBuffer: tpl.buffer, parsedList: ready.map((s) => s.parsed), dateRange: range })
      const allBlocks = res.sheets.flatMap((s) => s.blocks)
      const months = allBlocks.map((b) => b.month)
      res.fileName = `二车间大陆面单_${allBlocks[0].year}年${Math.min(...months)}-${Math.max(...months)}月_${timestamp()}.xlsx`
      setResult(res)
    } catch (e) {
      console.error(e)
      setGenError(String(e && e.message ? e.message : e))
    } finally { setGenerating(false) }
  }

  const download = () => {
    if (!result) return
    const blob = new Blob([result.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = result.fileName
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const allSelfOk = result && result.sheets.every((s) => s.selfCheck.fails.length === 0)

  return (
    <div className="min-h-screen bg-neutral-50 pb-28 text-neutral-900">
      <div className="border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <p className="text-xs font-medium tracking-[0.2em] text-teal-700">ZURU · 二车间</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">大陆面单生成</h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-neutral-500">
            上传 ZURU 源簿（美国簿=减价40%后模版 ZB 系列；国际簿=ZURU(国际) 纯数字系列）→ 自动取每张发票的末版 sheet 合计与日期 →
            按月分块生成面单：美国簿出「华登亚洲1-12月」，国际簿出「华登（国际）1-12月」；两本一起传则一次出双 sheet。
            香港块 ×7.75、大陆块 ×0.967，公式全活，块末自动合计。
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        {/* 步骤 1：上传源簿 */}
        <Card className={cardCls}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-3 text-base"><StepBadge n="1" />上传源簿</CardTitle>
            <CardDescription>
              支持多文件（美国簿/国际簿可混传，自动识别；同号发票自动取版本链更长的）。
              美国簿读「ZB05928折」形 sheet（改版 折-2/-3 取末版）；国际簿读「97438 / 97525-4」形纯数字 sheet
              （-2/-3 取末版，第 1 行带 (REVn) 标注的发票号自动加 REVn 后缀）。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <Badge variant="outline" className={tpl ? 'border-teal-200 bg-teal-50 font-normal text-teal-800' : 'border-neutral-200 font-normal'}>
                <FileSpreadsheet className="h-3 w-3" />面单格式模板{tpl ? '（内置）' : tplError ? '（加载失败）' : '（加载中…）'}
              </Badge>
              {tplError && <span className="text-red-600">{tplError}</span>}
            </div>
            <div
              className={`flex h-32 cursor-pointer items-center justify-center rounded-xl border border-dashed transition-colors ${dragOver ? 'border-teal-600 bg-teal-50/60' : 'border-neutral-300 bg-neutral-50/60 hover:border-teal-500/60 hover:bg-teal-50/40'}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); onUpload(e.dataTransfer.files) }}
            >
              <div className="text-center">
                <div className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full border bg-white shadow-sm transition-colors ${dragOver ? 'border-teal-300 text-teal-700' : 'border-neutral-200 text-neutral-400'}`}>
                  <Upload className="h-4 w-4" />
                </div>
                <div className="mt-2.5 text-sm text-neutral-600">{parsing ? '正在解析，请稍候…' : '点击选择或拖拽源簿文件到这里'}</div>
                <div className="mt-1 text-xs text-neutral-400">支持 .xlsx，可多选；24MB / 3600+ sheet 的国际簿解析约需几秒</div>
              </div>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx" multiple className="hidden" aria-label="源簿上传"
              onChange={(e) => { onUpload(e.target.files); e.target.value = '' }} />
            {sources.map((s) => (
              <div key={s.name} className="flex items-center gap-2 text-sm">
                <Badge variant="outline" className="max-w-md truncate border-neutral-200 font-normal text-neutral-600">{s.name}</Badge>
                {s.status === 'parsing' && <span className="text-neutral-500">解析中…</span>}
                {s.status === 'done' && (
                  <span className="text-teal-700">
                    <Badge variant="outline" className={`mr-1 font-normal ${KIND_BADGE[s.parsed.kind]}`}>{KIND_LABEL[s.parsed.kind]}</Badge>
                    ✓ 发票 {s.parsed.stats.finalCount} 张（末版）
                    {s.parsed.stats.revised > 0 && <span className="text-neutral-500">，含改版 {s.parsed.stats.revised} 张</span>}
                    {s.parsed.skipped.length > 0 && (
                      <span className="text-amber-600" title={s.parsed.skipped.map((x) => `${x.sheet}：${x.reason}`).join('\n')}>
                        ，跳过 {s.parsed.skipped.length} 张（悬停看名单）
                      </span>
                    )}
                    {(s.parsed.cancelled?.length > 0 || s.parsed.drafts?.length > 0) && (
                      <span className="text-amber-600"
                        title={[...(s.parsed.cancelled || []).map((x) => `${x}：标记取消`), ...(s.parsed.drafts || []).map((x) => `${x}：名像发票号但内容不完整(疑似草稿)`)].join('\n')}>
                        ，取消/草稿 {(s.parsed.cancelled?.length || 0) + (s.parsed.drafts?.length || 0)} 张未进面单（悬停看名单）
                      </span>
                    )}
                  </span>
                )}
                {s.status === 'error' && <span className="text-red-600">{s.error}</span>}
              </div>
            ))}
            {ready.length > 0 && (
              <div className="flex gap-4 text-sm text-neutral-600">
                {countByKind('us') > 0 && <span>美国簿末版 <b className="text-sky-800">{countByKind('us')}</b> 张</span>}
                {countByKind('intl') > 0 && <span>国际簿末版 <b className="text-violet-800">{countByKind('intl')}</b> 张</span>}
                <span>共 <b className="text-teal-800">{totalFinal}</b> 张</span>
                {rangeCount && <span className="text-teal-700">范围内 <b>{rangeCount.kept}</b> 张</span>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 步骤 2：生成 · 自检 · 下载 */}
        <Card className={cardCls}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-3 text-base"><StepBadge n="2" />生成 · 自检 · 下载</CardTitle>
            <CardDescription>生成后自动逐行自检（E=D×7.75、J=D×0.967、K 与 M 按 sheet 各自惯例、H/I 引用、序号、排序、合计=明细和）。</CardDescription>
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
              <span className="text-xs text-neutral-400">留空不限；设范围后只让范围内发票进面单（整月被滤掉就不出该月份块）</span>
            </div>
            {rangeCount && (
              <div className="rounded-lg border border-teal-200 bg-teal-50/70 px-3 py-2 text-xs text-teal-900">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>
                    已筛选:{range.lo || '不限'} ~ {range.hi || '不限'} → 范围内 <b>{rangeCount.kept}</b> 张（共 {rangeCount.total} 张，范围外 {rangeCount.dropped} 张不进面单）
                    {range.inverted && <span className="ml-1 text-amber-700">起止倒置已自动互换</span>}
                  </span>
                  <Button size="sm" variant="outline" className="h-6 px-2 text-xs"
                    onClick={() => setShowRangeDetail((v) => !v)}>
                    {showRangeDetail ? '收起明细' : `查看明细 ${rangeCount.kept} 张`}
                  </Button>
                </div>
                {showRangeDetail && (
                  <div className="mt-2 max-h-72 overflow-auto rounded border border-teal-200 bg-white">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-teal-50 text-neutral-600">
                        <tr>
                          <th className="px-2 py-1 text-left font-medium">发票号</th>
                          <th className="px-2 py-1 text-left font-medium">日期</th>
                          <th className="px-2 py-1 text-right font-medium">金额(USD)</th>
                          <th className="px-2 py-1 text-left font-medium">来源</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rangeCount.keptList.map((v, i) => (
                          <tr key={i} className="border-t border-neutral-100">
                            <td className="px-2 py-1 font-medium text-teal-900">{v.inv}{v.versions > 1 && <span className="ml-1 text-neutral-400">×{v.versions}</span>}</td>
                            <td className="px-2 py-1 tabular-nums">{v.ymd}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(v.total)}</td>
                            <td className="px-2 py-1 text-neutral-500">{KIND_LABEL[v.kind] || ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            {genError && (
              <Alert variant="destructive" className="border-red-200 bg-red-50/60"><AlertDescription className="whitespace-pre-wrap">{genError}</AlertDescription></Alert>
            )}
            {ready.length > 0 && (
              <MonthWarnings items={warnItems} range={range} title="源簿提示"
                placeholder="选择发票日期范围后，这里只列出该范围内被跳过 / 取消 / 疑似草稿的发票。" />
            )}
            {result && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-teal-200/70 bg-teal-50/50 px-4 py-3 text-sm">
                  <span>
                    {result.sheets.map((s) => `${s.name} ${s.blocks.reduce((n, b) => n + b.rows, 0)} 行`).join(' + ')}
                  </span>
                  {result.filter && result.filter.active && (
                    <span className="text-teal-700">已筛选：范围内 {result.filter.kept} 张（范围外 {result.filter.dropped} 张未进面单）</span>
                  )}
                  {allSelfOk
                    ? <span className="text-emerald-700">✓ 自检通过 {result.sheets.map((s) => `${s.selfCheck.passed}/${s.selfCheck.checks}`).join(' + ')}</span>
                    : <span className="text-amber-600">⚠ 自检 {result.sheets.map((s) => `${s.selfCheck.passed}/${s.selfCheck.checks}`).join(' + ')}</span>}
                  <div className="ml-auto">
                    <Button size="sm" className="bg-teal-700 text-white hover:bg-teal-800" onClick={download}>⬇ 下载面单</Button>
                  </div>
                </div>
                {result.sheets.flatMap((s) => s.selfCheck.fails.slice(0, 5).map((f, i) => (
                  <Alert key={`${s.name}-${i}`} className="border-amber-200 bg-amber-50/60"><AlertDescription>{s.name}: {f}</AlertDescription></Alert>
                )))}
                {result.sheets.map((s) => <BlockTable key={s.name} sheet={s} />)}
                <p className="text-xs text-neutral-400">
                  美国簿出 ZB 系列（华登亚洲1-12月）；国际簿出纯数字系列（华登（国际）1-12月，客名取各发票 sheet 的抬头）。
                  只传一本就只生成对应 sheet。
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 步骤 3：金额核对（面单 ↔ 发票） */}
        <Card className={cardCls}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-3 text-base"><StepBadge n="3" />金额核对（面单 ↔ 发票）</CardTitle>
            <CardDescription>
              面单大陆块「金额USD(J)」对照「修改大陆发票」每票 USD 总金额（多段票取最后一段累计），容差 ±0.02 USD；
              发票号 REV / A 前缀 / 全角括号自动规范化匹配。结果下载为分析 Excel（差异红底、缺边黄底）。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-neutral-500">面单文件</span>
                <Badge variant="outline" className={`font-normal ${recMdFile || result ? 'border-teal-200 bg-teal-50 text-teal-800' : 'border-neutral-200 text-neutral-500'}`}>
                  <FileSpreadsheet className="h-3 w-3" />
                  {recMdFile ? recMdFile.name : result ? `刚生成的：${result.fileName}` : '（未提供：请先生成面单或上传）'}
                </Badge>
                <Button size="sm" variant="outline" onClick={() => recMdRef.current?.click()}>上传旧面单核对</Button>
                {recMdFile && <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setRecMdFile(null); setRecResult(null) }}>改用生成的面单</Button>}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-neutral-500">发票工作簿</span>
                <Button size="sm" variant="outline" onClick={() => recInvRef.current?.click()}>选择文件（可多选）</Button>
                {recInvFiles.map((f) => (
                  <Badge key={f.name} variant="outline" className="max-w-md truncate border-neutral-200 font-normal text-neutral-600">
                    {f.name}
                    <button className="ml-1 text-neutral-400 hover:text-red-600" onClick={() => { setRecInvFiles((p) => p.filter((x) => x.name !== f.name)); setRecResult(null) }}>×</button>
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-neutral-400">发票工作簿 = ZURU 标签页生成的「修改大陆发票…xlsx」（母版里非本次生成的 sheet 也能读，多段票自动取末段）。</p>
            </div>
            <div>
              <Button onClick={doReconcile} disabled={recRunning || (!recMdFile && !result) || !recInvFiles.length}
                className="bg-teal-700 text-white shadow-sm hover:bg-teal-800">
                {recRunning ? '核对中…' : '核对'}
              </Button>
            </div>
            {recError && (
              <Alert variant="destructive" className="border-red-200 bg-red-50/60"><AlertDescription className="whitespace-pre-wrap">{recError}</AlertDescription></Alert>
            )}
            {recResult && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-teal-200/70 bg-teal-50/50 px-4 py-3 text-sm">
                  <span>面单 {recResult.mdName}（{recResult.summary.miandanCount} 行） ↔ 发票 {recResult.summary.invoiceCount} 张</span>
                  <span className="text-emerald-700">一致 <b>{recResult.summary.match}</b></span>
                  {recResult.summary.diff > 0 && <span className="font-medium text-red-600">差异 <b>{recResult.summary.diff}</b></span>}
                  {recResult.summary.onlyMiandan > 0 && <span className="text-amber-600">仅面单有 <b>{recResult.summary.onlyMiandan}</b></span>}
                  {recResult.summary.onlyInvoice > 0 && <span className="text-amber-600">仅发票有 <b>{recResult.summary.onlyInvoice}</b></span>}
                  {recResult.summary.revFallback > 0 && <span className="text-neutral-500">REV 配对 {recResult.summary.revFallback}</span>}
                  <div className="ml-auto">
                    <Button size="sm" className="bg-teal-700 text-white hover:bg-teal-800" onClick={downloadReport}>⬇ 下载分析 Excel</Button>
                  </div>
                </div>
                {[
                  { key: '差异', cls: 'border-red-200 bg-red-50/50 text-red-800', rows: recResult.rows.filter((r) => r.result === '差异') },
                  { key: '仅面单有', cls: 'border-amber-200 bg-amber-50/50 text-amber-800', rows: recResult.rows.filter((r) => r.result === '仅面单有') },
                  { key: '仅发票有', cls: 'border-amber-200 bg-amber-50/50 text-amber-800', rows: recResult.rows.filter((r) => r.result === '仅发票有') },
                ].filter((g) => g.rows.length > 0).map((g) => (
                  <details key={g.key} className={`rounded-lg border px-4 py-2.5 ${g.cls}`}>
                    <summary className="cursor-pointer text-sm font-medium">{g.key} {g.rows.length} 张（点击展开）</summary>
                    <div className="mt-2 max-h-72 overflow-auto rounded-md border border-neutral-200 bg-white">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 border-b border-neutral-200 bg-neutral-50/95 text-neutral-500">
                          <tr>
                            <th className="px-3 py-1.5 text-left font-medium">发票号</th>
                            <th className="px-3 py-1.5 text-left font-medium">月份</th>
                            <th className="px-3 py-1.5 text-right font-medium">面单USD(J)</th>
                            <th className="px-3 py-1.5 text-right font-medium">发票USD(末段)</th>
                            <th className="px-3 py-1.5 text-right font-medium">差(USD)</th>
                          </tr>
                        </thead>
                        <tbody className="text-neutral-700">
                          {g.rows.slice(0, 500).map((r) => (
                            <tr key={r.key + r.sheetName} className="border-t border-neutral-100">
                              <td className="px-3 py-1 font-mono">{r.inv}{r.revFallback && <span className="ml-1 text-neutral-400">(REV配对)</span>}</td>
                              <td className="px-3 py-1">{r.year ? `${r.year}-${String(r.month).padStart(2, '0')}` : ''}</td>
                              <td className="px-3 py-1 text-right tabular-nums">{fmtMoney(r.jUsd)}</td>
                              <td className="px-3 py-1 text-right tabular-nums">{fmtMoney(r.invUsd)}</td>
                              <td className="px-3 py-1 text-right tabular-nums">{r.diffUsd === null ? '—' : fmtMoney(r.diffUsd)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {g.rows.length > 500 && <div className="p-2 text-center text-neutral-400">仅显示前 500 条，全部见分析 Excel</div>}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 底部固定操作栏 */}<div className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white/90 shadow-[0_-4px_16px_rgba(0,0,0,0.04)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
          <div className="text-sm text-neutral-600">
            已识别 <b className="text-teal-800">{totalFinal}</b> 张末版发票
            {rangeCount && <span className="ml-3 text-teal-700">范围内 <b>{rangeCount.kept}</b> 张（已按日期筛选）</span>}
          </div>
          <div className="ml-auto">
            <Button onClick={doGenerate} disabled={generating || parsing || !tpl || !ready.length} size="lg"
              className="bg-teal-700 text-white shadow-sm hover:bg-teal-800">
              {generating ? '生成中…' : '生成面单'}
            </Button>
          </div>
        </div>
      </div>
      {/* 金额核对的隐藏上传输入 */}
      <input ref={recMdRef} type="file" accept=".xlsx" className="hidden" aria-label="核对面单上传"
        onChange={(e) => { onRecMdUpload(e.target.files?.[0]); e.target.value = '' }} />
      <input ref={recInvRef} type="file" accept=".xlsx" multiple className="hidden" aria-label="核对发票簿上传"
        onChange={(e) => { onRecInvUpload(e.target.files); e.target.value = '' }} />
    </div>
  )
}
