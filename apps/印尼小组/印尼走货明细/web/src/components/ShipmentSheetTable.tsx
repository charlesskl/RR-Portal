import { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { App, Button, Space, Table, Typography } from 'antd'
import type { GetRef, TableProps } from 'antd'
import { parseSheetClipboard, sheetFillDownEdits, sheetPasteEdits, type SheetEdit, type SheetPoint } from '../utils/shipmentSheet'
import { sheetArrowKeys, sheetArrowPoint, sheetArrowUsesEditor } from '../utils/shipmentSheetNavigation'

type Props<T extends object> = TableProps<T> & {
  fields: readonly string[]
  onEdits: (edits: SheetEdit[]) => void
  rowOrder: string
  valueAt: (row: number, field: string) => string | number | undefined
  editableAt?: (row: number, field: string) => boolean
  displayAt: (row: number, col: number) => string | number | undefined
  extraEditorAt?: (row: number, col: number) => boolean
  viewportOffset?: number
}
const point = (target: EventTarget | null): SheetPoint | null => {
  const cell = (target as HTMLElement)?.closest?.<HTMLElement>('[data-sheet-col]')
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
export default function ShipmentSheetTable<T extends object>({ fields, onEdits, rowOrder, valueAt, editableAt, displayAt, extraEditorAt, viewportOffset = 400, columns = [], ...props }: Props<T>) {
  const { message } = App.useApp()
  const root = useRef<HTMLDivElement>(null)
  const table = useRef<GetRef<typeof Table>>(null)
  const [editingCell, setEditingCell] = useState<SheetPoint | null>(null)
  const pendingFocus = useRef<{ point: SheetPoint; edit: boolean } | null>(null)
  const [viewportHeight, setViewportHeight] = useState(() => Math.max(200, window.innerHeight - viewportOffset))
  useEffect(() => {
    const resize = () => setViewportHeight(Math.max(200, window.innerHeight - viewportOffset))
    resize(); window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [viewportOffset])
  const [anchor, setAnchor] = useState<SheetPoint | null>(null)
  const [end, setEnd] = useState<SheetPoint | null>(null)
  const [widths, setWidths] = useState<Record<number, number>>({})
  const resizeCleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => resizeCleanup.current?.(), [])
  useEffect(() => { setAnchor(null); setEnd(null); setEditingCell(null); pendingFocus.current = null }, [rowOrder])
  const count = props.dataSource?.length || 0
  const inSelection = (row: number, col: number) => anchor && end
    && row >= Math.min(anchor.row, end.row) && row <= Math.max(anchor.row, end.row)
    && col >= Math.min(anchor.col, end.col) && col <= Math.max(anchor.col, end.col)
  const cellAt = (p: SheetPoint) => Array.from(root.current?.querySelectorAll<HTMLElement>(`[data-sheet-row="${p.row}"][data-sheet-col="${p.col}"]`) || [])
    .find(cell => cell.style.visibility !== 'hidden') || null
  // Logical coordinates include rows outside the rendered virtual window.
  const hasCell = (p: SheetPoint) => {
    const record = props.dataSource?.[p.row]
    if (!record || !columns[p.col]) return false
    const span = columns[p.col].onCell?.(record, p.row)
    return span?.rowSpan !== 0 && span?.colSpan !== 0
  }
  const canEdit = (p: SheetPoint) => !!extraEditorAt?.(p.row, p.col)
    || (!!fields[p.col] && editableAt?.(p.row, fields[p.col]) !== false)
  const editorAt = (p: SheetPoint) => cellAt(p)?.querySelector<HTMLElement>('input:not([readonly]):not([disabled]),textarea:not([readonly]):not([disabled]),input[role="combobox"]:not([disabled])') || null
  const focus = (p: SheetPoint, edit = true) => {
    if (!hasCell(p)) return
    const active = document.activeElement as HTMLElement | null
    const previous = point(active)
    // Commit a number's draft before replacing its editor (including virtual unmounts).
    if (previous && (previous.row !== p.row || previous.col !== p.col || !edit)) active?.blur()
    setAnchor(p); setEnd(p)
    setEditingCell(edit && canEdit(p) ? p : null)
    pendingFocus.current = { point: p, edit }
    if (!cellAt(p)) table.current?.scrollTo({ index: p.row })
  }
  useLayoutEffect(() => {
    let frame = 0, attempts = 0
    const apply = () => {
      const pending = pendingFocus.current
      if (!pending) return
      const cell = cellAt(pending.point)
      if (!cell) {
        if (++attempts < 30) frame = requestAnimationFrame(apply)
        return
      }
      const holder = root.current?.querySelector<HTMLElement>('.ant-table-tbody-virtual-holder')
      const header = root.current?.querySelector<HTMLElement>('.ant-table-header')
      if (holder) {
        // Native scrollIntoView changes the holder's scrollLeft, bypassing
        // rc-virtual-list's logical horizontal offset and misaligning headers.
        for (let ancestor = cell.parentElement; ancestor && holder.contains(ancestor); ancestor = ancestor.parentElement)
          ancestor.scrollLeft = 0
        const box = cell.getBoundingClientRect(), viewport = holder.getBoundingClientRect()
        if (box.top < viewport.top || box.bottom > viewport.bottom) table.current?.scrollTo({ index: pending.point.row })
        const col = pending.point.col
        if (header && !columns[col].fixed) {
          const selectionWidth = props.rowSelection ? Number(props.rowSelection.columnWidth) || 32 : 0
          const sizes = columns.map((column, i) => widths[i] || Number(column.width) || 120)
          const left = sizes.slice(0, col).reduce((sum, width) => sum + width, selectionWidth)
          const fixedLeft = sizes.reduce((sum, width, i) => sum + (columns[i].fixed === 'left' ? width : 0), selectionWidth) + 8
          const fixedRight = sizes.reduce((sum, width, i) => sum + (columns[i].fixed === 'right' ? width : 0), 8)
          let offset = header.scrollLeft
          if (left < offset + fixedLeft) offset = Math.max(0, left - fixedLeft)
          else if (left + sizes[col] > offset + holder.clientWidth - fixedRight) offset = left + sizes[col] - holder.clientWidth + fixedRight
          header.scrollLeft = offset
          // The installed virtual-list proxy accepts a horizontal position;
          // update both sides, including while rc-table holds its scroll lock.
          const position: { left: number; top?: number } = { left: header.scrollLeft }
          table.current?.scrollTo(position)
        }
      }
      ;(pending.edit ? editorAt(pending.point) || cell : cell).focus({ preventScroll: true })
      pendingFocus.current = null
    }
    apply()
    return () => cancelAnimationFrame(frame)
  })
  const fillDown = () => {
    try { onEdits(sheetFillDownEdits(anchor, end, count, fields, valueAt)) }
    catch (error) { message.info((error as Error).message) }
  }
  const mapped = columns.map((column, col) => ({
    ...column,
    width: widths[col] || Number(column.width) || 120,
    render: (value: unknown, record: T, row: number) => {
      const rendered = column.render?.(value, record, row) ?? value as React.ReactNode
      if (!canEdit({ row, col }) || (editingCell?.row === row && editingCell.col === col)) return rendered
      const preview = <span className="shipment-sheet-preview">{String(displayAt(row, col) ?? '') || '\u00a0'}</span>
      // Keep lightweight fill/drop handles; only mount their input on activation.
      return isValidElement<{ children?: React.ReactNode; onFill?: unknown }>(rendered) && rendered.props.onFill
        ? cloneElement(rendered, { children: preview }) : preview
    },
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
        className: [original.className, !fields[col] || editableAt?.(row, fields[col]) === false ? 'shipment-sheet-protected' : '', inSelection(row, col) ? 'shipment-sheet-selected' : ''].filter(Boolean).join(' '),
      }
    },
  }))
  const fixedWidth = mapped.reduce((total, col) => total + (col.fixed === 'left' ? Number(col.width) : 0), 64)
  return <div className="shipment-sheet" ref={root} style={{ '--sheet-fixed-width': `${fixedWidth}px` } as React.CSSProperties}
    onWheelCapture={() => {
      // Flush number drafts before wheel scrolling can unmount a virtual row.
      const active = document.activeElement as HTMLElement | null
      if (root.current?.contains(active) && active?.closest('.ant-input-number')) active.blur()
    }}
    onPointerDownCapture={event => {
      if (!point(event.target)) {
        const active = document.activeElement as HTMLElement | null
        if (root.current?.contains(active) && active?.closest('.ant-input-number')) active.blur()
      }
    }}
    onFocusCapture={event => { const p = point(event.target); if (p) { setAnchor(p); setEnd(p) } }}
    onClickCapture={event => {
      const p = point(event.target); if (!p) return
      if (event.shiftKey && anchor) { event.preventDefault(); event.stopPropagation(); setEnd(p) }
      else {
        setAnchor(p); setEnd(p)
        // Plain/read-only cells must receive focus too, not only their inputs.
        if (!(event.target as HTMLElement).closest('input,textarea,button,a,select,[contenteditable="true"],.ant-select,.ant-picker,.ant-input-number'))
          focus(p)
      }
    }}
    onMouseDownCapture={event => { if (event.shiftKey && anchor && point(event.target)) event.preventDefault() }}
    onPasteCapture={event => {
      const start = point(event.target) || anchor
      if (!start) return
      const text = event.clipboardData.getData('text/plain')
      // Quoted Excel multiline cells are parsed as one value, not unrelated rows.
      const nativeEditor = (event.target as HTMLElement).closest('input:not([readonly]):not([disabled]),textarea:not([readonly]):not([disabled])')
      if (!text.includes('\t') && !text.includes('\n') && nativeEditor) return
      event.preventDefault(); event.stopPropagation()
      try { onEdits(sheetPasteEdits(parseSheetClipboard(text), start, count, fields)) }
      catch (error) { message.error((error as Error).message) }
    }}
    onCopyCapture={event => {
      if (!anchor || !end) return
      const editor = (event.target as HTMLElement).closest<HTMLInputElement | HTMLTextAreaElement>('input,textarea')
      if (anchor.row === end.row && anchor.col === end.col && editor && editor.selectionStart !== editor.selectionEnd) return
      event.preventDefault()
      const values: string[] = []
      for (let row = Math.min(anchor.row, end.row); row <= Math.max(anchor.row, end.row); row++) {
        const cells: string[] = []
        for (let col = Math.min(anchor.col, end.col); col <= Math.max(anchor.col, end.col); col++)
          cells.push(quote(fields[col] ? String(valueAt(row, fields[col]) ?? '') : String(displayAt(row, col) ?? cellText(cellAt({ row, col })))))
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
      const target = event.target as HTMLElement
      // Existing pickers in protected columns (new-row material selection,
      // category selection) keep their own keyboard behaviour.
      const protectedControl = target.closest('input,textarea,button,[role="combobox"]')
      const readOnlyDisplay = target.closest('input[readonly],textarea[readonly]') && !target.closest('.ant-select,.ant-picker')
      if (!fields[p.col] && protectedControl && !(sheetArrowKeys.has(event.key) && readOnlyDisplay)) return
      if (event.key === 'Escape') { setAnchor(null); setEnd(null); return }
      if (target.getAttribute('aria-expanded') === 'true' || target.closest('[aria-expanded="true"]')
        || cellAt(p)?.querySelector('[aria-expanded="true"]')) return
      // Batch-protected columns can still contain their own material/category
      // picker. F2 may focus that enabled control without opening batch edits.
      if (event.key === 'F2' && canEdit(p)) {
        event.preventDefault(); event.stopPropagation(); focus(p); return
      }
      if (sheetArrowKeys.has(event.key)) {
        if (event.ctrlKey || event.metaKey || event.altKey || (event.shiftKey && target.closest('input,textarea'))
          || sheetArrowUsesEditor(target, event.key)) return
        event.preventDefault(); event.stopPropagation()
        const next = sheetArrowPoint(p, event.key, count, fields.length, hasCell)
        // Focus the cell, so following arrow presses keep navigating the grid.
        // Leaving a numeric editor still triggers its normal blur/commit flow.
        if (next) focus(next, false)
        return
      }
      if (event.key === 'Enter' && (event.target as HTMLElement).closest('.ant-picker')) return
      if (event.key !== 'Tab' && event.key !== 'Enter') return
      if (event.key === 'Enter' && (event.altKey || event.ctrlKey || event.metaKey)) return
      const delta = event.shiftKey ? -1 : 1
      let next: SheetPoint | null = null
      if (event.key === 'Enter') {
        for (let row = p.row + delta; row >= 0 && row < count; row += delta)
          if (hasCell({ row, col: p.col })) { next = { row, col: p.col }; break }
      } else {
        for (let idx = p.row * fields.length + p.col + delta; idx >= 0 && idx < count * fields.length; idx += delta) {
          const candidate = { row: Math.floor(idx / fields.length), col: idx % fields.length }
          if (canEdit(candidate) && hasCell(candidate)) { next = candidate; break }
        }
      }
      if (next) { event.preventDefault(); event.stopPropagation(); focus(next) }
    }}>
    <Space wrap className="shipment-sheet-toolbar">
      <Typography.Text strong>表格编辑</Typography.Text>
      <Typography.Text type="secondary">↑↓←→ 跳转单元格 · F2 编辑 · Tab 左右切换 · Enter 下一行 · Shift 点击选区 · Ctrl/Cmd+C 复制 · 粘贴 Excel 多格数据</Typography.Text>
      <Button size="small" onClick={fillDown} title="Ctrl/⌘D：单选复制上一行；多行选区按首行向下填充">向下填充选区</Button>
      <Typography.Text type="secondary">Ctrl/⌘D：单选复制上一行，多行按首行填充</Typography.Text>
      <Typography.Text type="secondary">灰底列禁止批量覆盖；拖动表头右边线调整列宽。修改后请保存。</Typography.Text>
    </Space>
    <Table<T> {...props} ref={table} virtual bordered columns={mapped}
      scroll={{ ...props.scroll, y: viewportHeight, x: mapped.reduce((total, col) => total + Number(col.width), 40) }} />
  </div>
}
