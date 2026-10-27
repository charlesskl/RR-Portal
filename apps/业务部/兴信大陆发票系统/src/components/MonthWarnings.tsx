/* eslint-disable */
// @ts-nocheck —— UI 胶水层；过滤逻辑在 src/lib/monthWarnings.js，由 scripts/month-warnings.test.jsx 验证
import { AlertTriangle } from 'lucide-react'
import { partitionWarnings } from '@/lib/monthWarnings.js'

/**
 * 三模块统一的「按月提示」区：
 * - 未选日期范围 → 占位提示语（inactiveMode='all' 时改为全量列出，用于提示本就按生成范围产出的模块）
 * - 选了范围 → 只列范围内条目，按 yyyy-mm 分组；归属不明的收进「未注明月份」折叠组
 * items: [{ text, ymd }]，ymd 为 'yyyy-mm-dd' 或 ''；range 为 dateRange.normRange 的结果
 */
export function MonthWarnings({ items, range, title = '提示', placeholder = '选择日期范围后，这里只显示该日期范围内的提示。', inactiveMode = 'placeholder' }) {
  if (!range || !range.active) {
    if (inactiveMode === 'all' && items.length) {
      return <WarnBox title={title} groups={[{ ym: '', items }]} undated={[]} />
    }
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-2.5 text-xs text-neutral-400">
        {placeholder}
      </div>
    )
  }
  const { shown, undated } = partitionWarnings(items, range)
  if (!shown.length && !undated.length) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-2.5 text-xs text-emerald-700">
        ✓ {range.lo || '…'} ~ {range.hi || '…'} 范围内没有需要提示的问题
      </div>
    )
  }
  return <WarnBox title={`${title}（${range.lo || '不限'} ~ ${range.hi || '不限'}）`} groups={shown} undated={undated} />
}

function WarnBox({ title, groups, undated }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-700">
        <AlertTriangle className="h-3.5 w-3.5" />{title}
      </div>
      <div className="space-y-1.5 text-xs text-neutral-600">
        {groups.map((g) => (
          <div key={g.ym || 'all'}>
            {g.ym && <div className="font-medium text-neutral-800">{g.ym}（{g.items.length} 条）</div>}
            <div className="space-y-0.5">
              {g.items.map((it, i) => <div key={i}>{it.text}</div>)}
            </div>
          </div>
        ))}
        {undated.length > 0 && (
          <details className="text-neutral-500">
            <summary className="cursor-pointer">未注明月份（{undated.length} 条）</summary>
            <div className="mt-1 space-y-0.5">
              {undated.map((it, i) => <div key={i}>{it.text}</div>)}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}
