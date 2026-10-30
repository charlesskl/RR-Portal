import { cloneElement, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { App, Button, Space, Table, Typography } from 'antd'
import type { GetRef, TableProps } from 'antd'
import { parseSheetClipboard, sheetFillDownEdits, sheetPasteSelectionEdits, type SheetEdit, type SheetPoint } from '../utils/shipmentSheet'
import { sheetArrowKeys, sheetArrowPoint, sheetArrowUsesEditor } from '../utils/shipmentSheetNavigation'
import { ShipmentSheetDraftContext, ShipmentSheetFillContext, type ShipmentDraftCommit } from './ShipmentSheetDraft'

type Props<T extends object> = TableProps<T> & {
  fields: readonly string[]
  onEdits: (edits: SheetEdit[]) => void | boolean | Promise<void | boolean>
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
  const drafts = useRef(new Set<ShipmentDraftCommit>())
  const batchPending = useRef(false)
  const latest = useRef({ onEdits, valueAt, rowOrder })
  latest.current = { onEdits, valueAt, rowOrder }
  const registerDraft = useCallback((commit: ShipmentDraftCommit, pending: () => Promise<boolean> | null) => {
    drafts.current.add(commit)
    return () => {
      // Wheel scrolling may unmount a number while its capacity check is in
      // flight. A subsequent batch must still await that existing commit.
      const task = pending()
      const remove = () => { drafts.current.delete(commit) }
      if (task) void task.then(remove, remove)
      else remove()
    }
  }, [])
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
  const selectionGesture = useRef<{ anchor: SheetPoint; end: SheetPoint; dragged: boolean } | null>(null)
  const suppressClick = useRef(false)
  const finishSelection = useCallback(() => {
    const gesture = selectionGesture.current
    if (!gesture) return
    if (gesture.dragged) {
      // Focus the grid, never an endpoint input: focus must not collapse the
      // range or start editing the last cell when the mouse is released.
      pendingFocus.current = null
      suppressClick.current = true
      root.current?.focus({ preventScroll: true })
      setEditingCell(null)
      setAnchor(gesture.anchor); setEnd(gesture.end)
    }
    selectionGesture.current = null
  }, [])
  useEffect(() => {
    const cancel = () => { selectionGesture.current = null; suppressClick.current = false }
    window.addEventListener('pointerup', finishSelection)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('pointerup', finishSelection)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
    }
  }, [finishSelection])
  const [widths, setWidths] = useState<Record<number, number>>({})
  const resizeCleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => resizeCleanup.current?.(), [])
  useEffect(() => {
    setAnchor(null); setEnd(null); setEditingCell(null); pendingFocus.current = null
    selectionGesture.current = null; suppressClick.current = false
  }, [rowOrder])
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
      // Keep one real input focused even in navigation mode. The first letter
      // or IME composition can then type natively without losing its first key.
      ;(editorAt(pending.point) || cell).focus({ preventScroll: true })
      pendingFocus.current = null
    }
    apply()
    return () => cancelAnimationFrame(frame)
  })
  const runBatch = async (build: (values: typeof latest.current) => SheetEdit[]) => {
    if (batchPending.current) return
    batchPending.current = true
    const originalOrder = latest.current.rowOrder
    try {
      // Finish the source before applying the batch, using its latest committed value.
      for (const commit of [...drafts.current]) if (!await commit()) return
      if (latest.current.rowOrder !== originalOrder) {
        message.info('明细顺序已变化，当前输入已保留，请重新选择范围后操作')
        return
      }
      await latest.current.onEdits(build(latest.current))
    } catch (error) { message.error((error as Error).message) }
    finally { batchPending.current = false }
  }
  const fillDown = () => { void runBatch(values => sheetFillDownEdits(anchor, end, count, fields, values.valueAt)) }
  const fillFrom = (source: number, target: number, field: string) => { void runBatch(values => {
    if (target <= source) throw new Error('请把复制点向下拖动到目标行')
    const col = fields.indexOf(field)
    return sheetFillDownEdits({ row: source, col }, { row: target, col }, count, fields, values.valueAt)
  }) }
  const mapped = columns.map((column, col) => ({
    ...column,
    width: widths[col] || Number(column.width) || 120,
    render: (value: unknown, record: T, row: number) => {
      const rendered = column.render?.(value, record, row) ?? value as React.ReactNode
      if (!canEdit({ row, col }) || (editingCell?.row === row && editingCell.col === col)
        || (!editingCell && anchor?.row === row && anchor.col === col)) return rendered
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
        'data-sheet-mode': editingCell?.row === row && editingCell.col === col ? 'edit' : 'navigate',
        className: [original.className, !fields[col] || editableAt?.(row, fields[col]) === false ? 'shipment-sheet-protected' : '', inSelection(row, col) ? 'shipment-sheet-selected' : ''].filter(Boolean).join(' '),
      }
    },
  }))
  const fixedWidth = mapped.reduce((total, col) => total + (col.fixed === 'left' ? Number(col.width) : 0), 64)
  return <ShipmentSheetDraftContext.Provider value={registerDraft}><ShipmentSheetFillContext.Provider value={fillFrom}><div className="shipment-sheet" ref={root} tabIndex={-1} style={{ '--sheet-fixed-width': `${fixedWidth}px` } as React.CSSProperties}
    onWheelCapture={() => {
      // Flush drafts before wheel scrolling can unmount a virtual row.
      const active = document.activeElement as HTMLElement | null
      if (root.current?.contains(active) && active?.matches('input,textarea') && !active.closest('.ant-select,.ant-picker')) active.blur()
    }}
    onPointerDownCapture={event => {
      suppressClick.current = false
      if (batchPending.current) { event.preventDefault(); event.stopPropagation(); return }
      const p = point(event.target)
      if (!p) {
        const active = document.activeElement as HTMLElement | null
        if (root.current?.contains(active) && active?.matches('input,textarea') && !active.closest('.ant-select,.ant-picker')) active.blur()
        return
      }
      if (event.button !== 0 || event.pointerType === 'touch' || !hasCell(p)) return
      const target = event.target as HTMLElement
      if (target.closest('button,a,[role="button"],input[type="checkbox"],.shipment-fill-handle,.shipment-sheet-resize')) return
      if (!event.shiftKey && target.closest('.ant-select,.ant-picker')) return
      const isEditing = editingCell?.row === p.row && editingCell.col === p.col
      if (!event.shiftKey && isEditing && target.closest('input,textarea,.ant-select,.ant-picker,[contenteditable="true"]')) return
      event.preventDefault()
      pendingFocus.current = null
      const start = event.shiftKey && anchor ? anchor : p
      selectionGesture.current = { anchor: start, end: p, dragged: !!event.shiftKey && !!anchor }
      if (event.shiftKey && anchor) { setEnd(p); root.current?.focus({ preventScroll: true }) }
    }}
    onPointerMoveCapture={event => {
      const gesture = selectionGesture.current
      if (!gesture || !(event.buttons & 1) || batchPending.current) return
      const p = point(event.target)
      if (!p || !hasCell(p) || (p.row === gesture.end.row && p.col === gesture.end.col)) return
      event.preventDefault()
      gesture.end = p; gesture.dragged = true
      pendingFocus.current = null
      root.current?.focus({ preventScroll: true })
      setEditingCell(null)
      setAnchor(gesture.anchor); setEnd(p)
    }}
    onPointerUpCapture={finishSelection}
    onDragStartCapture={event => { if (selectionGesture.current) event.preventDefault() }}
    onFocusCapture={event => {
      if (selectionGesture.current?.dragged || suppressClick.current) return
      const p = point(event.target); if (p) { setAnchor(p); setEnd(p) }
    }}
    onCompositionStartCapture={event => {
      const p = point(event.target)
      if (p && canEdit(p) && (editingCell?.row !== p.row || editingCell.col !== p.col)) setEditingCell(p)
    }}
    onClickCapture={event => {
      if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); return }
      if (batchPending.current) { event.preventDefault(); event.stopPropagation(); return }
      const p = point(event.target); if (!p) return
      if (event.shiftKey && anchor) {
        pendingFocus.current = null
        event.preventDefault(); event.stopPropagation(); setEnd(p)
        // A virtualized anchor can be offscreen. Keep keyboard events within
        // the grid without focusing another cell and collapsing the range.
        if (!root.current?.contains(document.activeElement)) root.current?.focus({ preventScroll: true })
      }
      else {
        setAnchor(p); setEnd(p)
        if ((event.target as HTMLElement).closest('input,textarea,.ant-select,.ant-picker')) {
          // Pointer-down selection prevents native focus. Explicitly restore
          // it when a click is intended to edit the already mounted input.
          if (canEdit(p)) focus(p)
          return
        }
        // Plain/read-only cells must receive focus too, not only their inputs.
        if (!(event.target as HTMLElement).closest('input,textarea,button,[role="button"],a,select,[contenteditable="true"],.ant-select,.ant-picker'))
          focus(p, false)
      }
    }}
    onDoubleClickCapture={event => {
      const p = point(event.target)
      if (p && canEdit(p)) focus(p)
    }}
    onMouseDownCapture={event => { if (selectionGesture.current || (event.shiftKey && anchor && point(event.target))) event.preventDefault() }}
    onPasteCapture={event => {
      if (batchPending.current) { event.preventDefault(); event.stopPropagation(); return }
      const multiple = !!anchor && !!end && (anchor.row !== end.row || anchor.col !== end.col)
      const start = multiple ? anchor : point(event.target) || anchor
      if (!start) return
      const text = event.clipboardData.getData('text/plain')
      // Quoted Excel multiline cells are parsed as one value, not unrelated rows.
      const nativeEditor = (event.target as HTMLElement).closest('input:not([readonly]):not([disabled]),textarea:not([readonly]):not([disabled])')
      if (!multiple && !text.includes('\t') && !text.includes('\n') && nativeEditor) return
      event.preventDefault(); event.stopPropagation()
      try {
        const matrix = parseSheetClipboard(text)
        void runBatch(() => sheetPasteSelectionEdits(matrix, start, multiple ? end : null, count, fields))
      }
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
        for (let col = Math.min(anchor.col, end.col); col <= Math.max(anchor.col, end.col); col++) {
          const input = cellAt({ row, col })?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input:not([readonly]),textarea:not([readonly])')
          cells.push(quote(input?.value ?? (fields[col] ? String(valueAt(row, fields[col]) ?? '') : String(displayAt(row, col) ?? cellText(cellAt({ row, col }))))))
        }
        values.push(cells.join('\t'))
      }
      event.clipboardData.setData('text/plain', values.join('\n'))
    }}
    onKeyDownCapture={event => {
      if (batchPending.current) { event.preventDefault(); event.stopPropagation(); return }
      // Never intercept the first key of an IME session or recreate its input.
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
        const composingPoint = point(event.target)
        if (composingPoint && canEdit(composingPoint)
          && (editingCell?.row !== composingPoint.row || editingCell.col !== composingPoint.col)) setEditingCell(composingPoint)
        return
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'd') {
        event.preventDefault(); event.stopPropagation()
        if (!event.repeat) fillDown()
        return
      }
      const p = point(event.target) || anchor; if (!p) return
      const target = event.target as HTMLElement
      const isEditing = editingCell?.row === p.row && editingCell.col === p.col
      // A selected input stays mounted: native typing/selection, including the
      // very first character, starts editing without forwarding synthetic keys.
      if (!isEditing && !event.ctrlKey && !event.metaKey && !event.altKey
        && (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete') && canEdit(p))
        setEditingCell(p)
      // Existing pickers in protected columns (new-row material selection,
      // category selection) keep their own keyboard behaviour.
      const protectedControl = target.closest('input,textarea,button,[role="combobox"]')
      const readOnlyDisplay = target.closest('input[readonly],textarea[readonly]') && !target.closest('.ant-select,.ant-picker')
      if (!fields[p.col] && protectedControl && !(sheetArrowKeys.has(event.key) && readOnlyDisplay)) return
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation()
        // Commit the draft by blurring, then return to four-arrow navigation.
        focus(p, false)
        return
      }
      if (target.getAttribute('aria-expanded') === 'true' || target.closest('[aria-expanded="true"]')
        || cellAt(p)?.querySelector('[aria-expanded="true"]')) return
      // Batch-protected columns can still contain their own material/category
      // picker. F2 may focus that enabled control without opening batch edits.
      if (event.key === 'F2' && canEdit(p)) {
        event.preventDefault(); event.stopPropagation(); focus(p); return
      }
      if (sheetArrowKeys.has(event.key)) {
        if (event.ctrlKey || event.metaKey || event.altKey || (event.shiftKey && target.closest('input,textarea'))
          || (isEditing && sheetArrowUsesEditor(target, event.key))) return
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
      <Typography.Text aria-live="polite">{anchor && end
        ? `已选 ${Math.abs(anchor.row - end.row) + 1} 行 × ${Math.abs(anchor.col - end.col) + 1} 列（${(Math.abs(anchor.row - end.row) + 1) * (Math.abs(anchor.col - end.col) + 1)} 格）`
        : '尚未选择单元格'}</Typography.Text>
      <Button size="small" onClick={fillDown} title="Ctrl/⌘D：单选复制上一行；多行选区按首行向下填充">向下填充选区</Button>
    </Space>
    <Table<T> {...props} ref={table} virtual bordered columns={mapped}
      scroll={{ ...props.scroll, y: viewportHeight, x: mapped.reduce((total, col) => total + Number(col.width), 40) }} />
  </div></ShipmentSheetFillContext.Provider></ShipmentSheetDraftContext.Provider>
}
