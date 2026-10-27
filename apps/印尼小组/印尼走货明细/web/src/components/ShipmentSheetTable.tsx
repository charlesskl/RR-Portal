import { useEffect, useRef, useState } from 'react'
import { App, Button, Space, Table, Typography } from 'antd'
import type { TableProps } from 'antd'
import { parseSheetClipboard, sheetFillDownEdits, sheetPasteEdits, type SheetEdit, type SheetPoint } from '../utils/shipmentSheet'

type Props<T extends object> = TableProps<T> & {
  fields: readonly string[]
  onEdits: (edits: SheetEdit[]) => void
  rowOrder: string
  valueAt: (row: number, field: string) => string | number | undefined
}
const point = (target: EventTarget | null): SheetPoint | null => {
  const cell = (target as HTMLElement)?.closest?.<HTMLElement>('td[data-sheet-col]')
  return cell ? { row: Number(cell.dataset.sheetRow), col: Number(cell.dataset.sheetCol) } : null
}
function cellText(cell: HTMLElement | null): string {
  if (!cell) return ''
  const select = cell.querySelector('.ant-select-selection-item')
  if (select) return select.getAttribute('title') || select.textContent || ''
  const input = cell.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea')
  return input ? input.value : cell.innerText.replace(/\s*▾\s*$/, '').trim()
}
const quote = (value: string) => /[\t\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value

/** Spreadsheet interaction layer; the page retains ownership of data and saving. */
export default function ShipmentSheetTable<T extends object>({ fields, onEdits, rowOrder, valueAt, columns = [], ...props }: Props<T>) {
  const { message } = App.useApp()
  const root = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<SheetPoint | null>(null)
  const [end, setEnd] = useState<SheetPoint | null>(null)
  const [widths, setWidths] = useState<Record<number, number>>({})
  const resizeCleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => resizeCleanup.current?.(), [])
  useEffect(() => { setAnchor(null); setEnd(null) }, [rowOrder])
  const count = props.dataSource?.length || 0
  const inSelection = (row: number, col: number) => anchor && end
    && row >= Math.min(anchor.row, end.row) && row <= Math.max(anchor.row, end.row)
    && col >= Math.min(anchor.col, end.col) && col <= Math.max(anchor.col, end.col)
  const cellAt = (p: SheetPoint) => root.current?.querySelector<HTMLElement>(`td[data-sheet-row="${p.row}"][data-sheet-col="${p.col}"]`) || null
  const focus = (p: SheetPoint) => {
    const cell = cellAt(p)
    if (!cell) return
    setAnchor(p); setEnd(p)
    cell.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const input = cell.querySelector<HTMLElement>('input:not([readonly]):not([disabled]),textarea:not([readonly]):not([disabled]),input[role="combobox"]:not([disabled])')
    ;(input || cell).focus()
  }
  const fillDown = () => {
    try { onEdits(sheetFillDownEdits(anchor, end, count, fields, valueAt)) }
    catch (error) { message.info((error as Error).message) }
  }
  const mapped = columns.map((column, col) => ({
    ...column,
    width: widths[col] || Number(column.width) || 120,
    title: <div className="shipment-sheet-heading">
      {typeof column.title === 'function' ? column.title({}) : column.title}
      <span className="shipment-sheet-resize" role="separator" aria-label={`调整第 ${col + 1} 列宽`} onPointerDown={event => {
        event.preventDefault(); event.stopPropagation(); resizeCleanup.current?.()
        const x = event.clientX; const original = widths[col] || Number(column.width) || 120
        const otherFixedWidth = columns.reduce((total, c, i) => total + (i !== col && c.fixed === 'left' ? (widths[i] || Number(c.width) || 120) : 0), 40)
        const maxWidth = column.fixed === 'left' ? Math.max(60, Math.min(600, (root.current?.clientWidth || 1000) - otherFixedWidth - 300)) : 600
        const move = (e: PointerEvent) => setWidths(old => ({ ...old, [col]: Math.max(60, Math.min(maxWidth, original + e.clientX - x)) }))
        const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); resizeCleanup.current = null }
        resizeCleanup.current = stop
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop)
      }} />
    </div>,
    onCell: (record: T, row = 0) => {
      const original = column.onCell?.(record, row) || {}
      return { ...original, tabIndex: -1,
        'data-sheet-row': row, 'data-sheet-col': col,
        className: [original.className, !fields[col] ? 'shipment-sheet-protected' : '', inSelection(row, col) ? 'shipment-sheet-selected' : ''].filter(Boolean).join(' '),
      }
    },
  }))
  const fixedWidth = mapped.reduce((total, col) => total + (col.fixed === 'left' ? Number(col.width) : 0), 64)
  return <div className="shipment-sheet" ref={root} style={{ '--sheet-fixed-width': `${fixedWidth}px` } as React.CSSProperties}
    onFocusCapture={event => { const p = point(event.target); if (p) { setAnchor(p); setEnd(p) } }}
    onClickCapture={event => {
      const p = point(event.target); if (!p) return
      if (event.shiftKey && anchor) { event.preventDefault(); event.stopPropagation(); setEnd(p) }
      else { setAnchor(p); setEnd(p) }
    }}
    onMouseDownCapture={event => { if (event.shiftKey && anchor && point(event.target)) event.preventDefault() }}
    onPasteCapture={event => {
      const start = point(event.target) || anchor
      if (!start) return
      const text = event.clipboardData.getData('text/plain')
      // Quoted Excel multiline cells are parsed as one value, not unrelated rows.
      const nativeEditor = (event.target as HTMLElement).closest('input:not([readonly]):not([disabled]),textarea:not([readonly]):not([disabled])')
      if (!text.includes('\t') && !text.includes('\n') && (fields[start.col] || nativeEditor)) return
      event.preventDefault(); event.stopPropagation()
      try { onEdits(sheetPasteEdits(parseSheetClipboard(text), start, count, fields)) }
      catch (error) { message.error((error as Error).message) }
    }}
    onCopyCapture={event => {
      if (!anchor || !end || (anchor.row === end.row && anchor.col === end.col)) return
      event.preventDefault()
      const values: string[] = []
      for (let row = Math.min(anchor.row, end.row); row <= Math.max(anchor.row, end.row); row++) {
        const cells: string[] = []
        for (let col = Math.min(anchor.col, end.col); col <= Math.max(anchor.col, end.col); col++)
          cells.push(quote(fields[col] ? String(valueAt(row, fields[col]) ?? '') : cellText(cellAt({ row, col }))))
        values.push(cells.join('\t'))
      }
      event.clipboardData.setData('text/plain', values.join('\n'))
    }}
    onKeyDownCapture={event => {
      if (event.nativeEvent.isComposing) return
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'd') {
        event.preventDefault(); event.stopPropagation()
        if (!event.repeat) fillDown()
        return
      }
      const p = point(event.target); if (!p) return
      // Existing pickers in protected columns (new-row material selection,
      // category selection) keep their own keyboard behaviour.
      if (!fields[p.col] && (event.target as HTMLElement).closest('input,textarea,button,[role="combobox"]')) return
      if (event.key === 'Escape') { setAnchor(null); setEnd(null); return }
      if ((event.target as HTMLElement).getAttribute('aria-expanded') === 'true') return
      if (event.key === 'Enter' && (event.target as HTMLElement).closest('.ant-picker')) return
      if (event.key !== 'Tab' && event.key !== 'Enter') return
      if (event.key === 'Enter' && (event.altKey || event.ctrlKey || event.metaKey)) return
      const delta = event.shiftKey ? -1 : 1
      let next: SheetPoint | null = null
      if (event.key === 'Enter') {
        for (let row = p.row + delta; row >= 0 && row < count; row += delta)
          if (cellAt({ row, col: p.col })) { next = { row, col: p.col }; break }
      } else {
        for (let idx = p.row * fields.length + p.col + delta; idx >= 0 && idx < count * fields.length; idx += delta) {
          const candidate = { row: Math.floor(idx / fields.length), col: idx % fields.length }
          if (fields[candidate.col] && cellAt(candidate)) { next = candidate; break }
        }
      }
      if (next) { event.preventDefault(); event.stopPropagation(); focus(next) }
    }}>
    <Space wrap className="shipment-sheet-toolbar">
      <Typography.Text strong>表格编辑</Typography.Text>
      <Typography.Text type="secondary">Tab 左右切换 · Enter 下一行 · Shift 点击选区 · Ctrl/Cmd+C 复制 · 粘贴 Excel 多格数据</Typography.Text>
      <Button size="small" onClick={fillDown} title="Ctrl/⌘D：单选复制上一行；多行选区按首行向下填充">向下填充选区</Button>
      <Typography.Text type="secondary">Ctrl/⌘D：单选复制上一行，多行按首行填充</Typography.Text>
      <Typography.Text type="secondary">灰底列禁止批量覆盖；拖动表头右边线调整列宽。修改后请保存。</Typography.Text>
    </Space>
    <Table<T> {...props} bordered columns={mapped} scroll={{ ...props.scroll, x: mapped.reduce((total, col) => total + Number(col.width), 40) }} />
  </div>
}
