import { cloneElement, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { App, Button, Checkbox, Dropdown, Space, Table, Typography } from 'antd'
import type { GetRef, TableProps } from 'antd'
import { parseSheetClipboard, sheetClearSelectionEdits, sheetFillDownEdits, sheetPasteSelectionEdits, type SheetEdit, type SheetPoint } from '../utils/shipmentSheet'
import { sheetArrowKeys, sheetArrowPoint, sheetArrowUsesEditor } from '../utils/shipmentSheetNavigation'
import { formatShipmentPallet } from '../utils/shipmentDisplay'
import { createShipmentHorizontalScroll } from '../utils/shipmentHorizontalScroll'
import { shipmentFrozenColumns, shipmentFrozenRowSpan } from '../utils/shipmentSheetFreeze'
import { ShipmentSheetDraftContext, ShipmentSheetFillContext, type ShipmentDraftCommit } from './ShipmentSheetDraft'

type Props<T extends object> = TableProps<T> & {
  fields: readonly string[]
  onEdits: (edits: SheetEdit[]) => void | boolean | Promise<void | boolean>
  onUndo: () => void
  undoDisabled: boolean
  onRedo: () => void
  redoDisabled: boolean
  rowOrder: string
  valueAt: (row: number, field: string) => string | number | undefined
  editableAt?: (row: number, field: string) => boolean
  displayAt: (row: number, col: number) => string | number | undefined
  extraEditorAt?: (row: number, col: number) => boolean
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
export default function ShipmentSheetTable<T extends object>({ fields, onEdits, onUndo, undoDisabled, onRedo, redoDisabled, rowOrder, valueAt, editableAt, displayAt, extraEditorAt, columns = [], ...props }: Props<T>) {
  const { message } = App.useApp()
  const root = useRef<HTMLDivElement>(null)
  const table = useRef<GetRef<typeof Table>>(null)
  const topScroll = useRef<HTMLDivElement>(null)
  const horizontalScroll = useRef<ReturnType<typeof createShipmentHorizontalScroll> | null>(null)
  useLayoutEffect(() => {
    const sync = createShipmentHorizontalScroll({
      elements: () => ({ header: root.current?.querySelector<HTMLElement>('.ant-table-header') || null, rail: topScroll.current }),
      scrollBody: left => {
        // Empty AntD tables use a native body whose public scrollTo only
        // supports row targets. Horizontal proxy calls require a virtual body.
        if (!root.current?.querySelector('.ant-table-tbody-virtual-holder')) return
        const position: { left: number; top?: number } = { left }
        if (!table.current) return
        table.current.scrollTo(position)
        return true
      },
      requestFrame: callback => requestAnimationFrame(callback), cancelFrame: cancelAnimationFrame,
    })
    horizontalScroll.current = sync
    return () => { sync.dispose(); horizontalScroll.current = null }
  }, [])
  const [scrollSize, setScrollSize] = useState({ width: 0, contentWidth: 0 })
  const [viewportHeight, setViewportHeight] = useState(200)
  const measureScroll = useCallback(() => {
    const header = root.current?.querySelector<HTMLElement>('.ant-table-header')
    if (!header) return
    const width = header.clientWidth
    const contentWidth = header.scrollWidth
    setScrollSize(current => current.width === width && current.contentWidth === contentWidth
      ? current : { width, contentWidth })
    // Measure the actual flex space, including wrapped toolbars and the native
    // top scrollbar, rather than reserving a fixed fraction of the window.
    const toolbar = root.current?.querySelector<HTMLElement>('.shipment-sheet-toolbar')
    if (root.current) setViewportHeight(Math.max(120, root.current.clientHeight
      - (toolbar?.offsetHeight || 0) - (topScroll.current?.offsetHeight || 0) - header.offsetHeight - 2))
  }, [])
  useLayoutEffect(measureScroll)
  useLayoutEffect(() => { horizontalScroll.current?.resize() }, [scrollSize.width, scrollSize.contentWidth])
  useEffect(() => {
    const header = root.current?.querySelector<HTMLElement>('.ant-table-header')
    const observer = new ResizeObserver(measureScroll)
    for (const element of [root.current, header, header?.querySelector('table'),
      root.current?.querySelector('.shipment-sheet-toolbar'), topScroll.current])
      if (element) observer.observe(element)
    return () => observer.disconnect()
  }, [measureScroll])

  const drafts = useRef(new Set<ShipmentDraftCommit>())
  const batchPending = useRef(false)
  const latest = useRef({ onEdits, valueAt, rowOrder, editableAt })
  useLayoutEffect(() => { latest.current = { onEdits, valueAt, rowOrder, editableAt } })
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
  const [anchor, setAnchor] = useState<SheetPoint | null>(null)
  const [end, setEnd] = useState<SheetPoint | null>(null)
  const [frozen, setFrozen] = useState<{ rows: number; col: number | null }>({ rows: 0, col: null })
  useLayoutEffect(() => {
    table.current?.scrollTo({ top: 0 })
    horizontalScroll.current?.scrollTo(0)
  }, [frozen.rows, frozen.col])
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
  const frozenRows = Math.min(frozen.rows, Math.max(0, count - 1))
  const bodyRowIndex = (row: number) => row - frozenRows
  const rowSpanAt = (row: number, col: number) => shipmentFrozenRowSpan(row, frozenRows,
    index => columns[col].onCell?.(props.dataSource![index], index)?.rowSpan)
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
    return rowSpanAt(p.row, p.col) !== 0 && span?.colSpan !== 0
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
    if (!cellAt(p) && p.row >= frozenRows) table.current?.scrollTo({ index: bodyRowIndex(p.row) })
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
        if (pending.point.row >= frozenRows && (box.top < viewport.top || box.bottom > viewport.bottom)) table.current?.scrollTo({ index: bodyRowIndex(pending.point.row) })
        const col = pending.point.col
        const fixedColumns = shipmentFrozenColumns(columns, frozen.col)
        if (header && !fixedColumns[col].fixed) {
          const selectionWidth = props.rowSelection ? Number(props.rowSelection.columnWidth) || 32 : 0
          const sizes = columns.map((column, i) => widths[i] || Number(column.width) || 120)
          const left = sizes.slice(0, col).reduce((sum, width) => sum + width, selectionWidth)
          const fixedLeft = sizes.reduce((sum, width, i) => sum + (fixedColumns[i].fixed === 'left' ? width : 0), frozen.col === -1 ? 0 : selectionWidth) + 8
          const fixedRight = sizes.reduce((sum, width, i) => sum + (fixedColumns[i].fixed === 'right' ? width : 0), 8)
          let offset = header.scrollLeft
          if (left < offset + fixedLeft) offset = Math.max(0, left - fixedLeft)
          else if (left + sizes[col] > offset + holder.clientWidth - fixedRight) offset = left + sizes[col] - holder.clientWidth + fixedRight
          horizontalScroll.current?.scrollTo(offset)
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
  const clearSelection = () => { void runBatch(values => sheetClearSelectionEdits(anchor, end, count, fields,
    (row, field) => values.editableAt?.(row, field) !== false && hasCell({ row, col: fields.indexOf(field) }))) }
  const fillFrom = (source: number, target: number, field: string) => { void runBatch(values => {
    if (target <= source) throw new Error('请把复制点向下拖动到目标行')
    const col = fields.indexOf(field)
    return sheetFillDownEdits({ row: source, col }, { row: target, col }, count, fields, values.valueAt)
  }) }
  const mapped = shipmentFrozenColumns(columns, frozen.col).map((column, col) => ({
    ...column,
    width: widths[col] || Number(column.width) || 120,
    render: (value: unknown, record: T, bodyRow: number) => {
      const row = bodyRow + frozenRows
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
        const otherFixedWidth = shipmentFrozenColumns(columns, frozen.col).reduce((total, c, i) => total + (i !== col && c.fixed === 'left' ? (widths[i] || Number(c.width) || 120) : 0), 40)
        const maxWidth = column.fixed === 'left' ? Math.max(60, Math.min(600, (root.current?.clientWidth || 1000) - otherFixedWidth - 300)) : 600
        let frame: number | null = null, pendingWidth: number | null = null
        const apply = () => {
          frame = null
          if (pendingWidth == null) return
          const width = pendingWidth; pendingWidth = null
          setWidths(old => old[col] === width ? old : { ...old, [col]: width })
        }
        const move = (e: PointerEvent) => {
          pendingWidth = Math.max(60, Math.min(maxWidth, original + e.clientX - x))
          if (frame == null) frame = requestAnimationFrame(apply)
        }
        const cleanup = (flush: boolean) => {
          if (frame != null) cancelAnimationFrame(frame)
          frame = null
          if (flush) apply()
          window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop)
          window.removeEventListener('pointercancel', stop); window.removeEventListener('blur', stop)
          resizeCleanup.current = null
        }
        const stop = () => cleanup(true)
        resizeCleanup.current = () => cleanup(false)
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop)
        window.addEventListener('pointercancel', stop); window.addEventListener('blur', stop)
      }} />
    </div>,
    onCell: (record: T, bodyRow = 0) => {
      const row = bodyRow + frozenRows
      const original = column.onCell?.(record, row) || {}
      return { ...original, rowSpan: rowSpanAt(row, col), tabIndex: -1,
        'data-sheet-row': row, 'data-sheet-col': col,
        'data-sheet-mode': editingCell?.row === row && editingCell.col === col ? 'edit' : 'navigate',
        className: [original.className, !fields[col] || editableAt?.(row, fields[col]) === false ? 'shipment-sheet-protected' : '', inSelection(row, col) ? 'shipment-sheet-selected' : ''].filter(Boolean).join(' '),
      }
    },
  }))
  const freezeAtSelection = (mode: 'both' | 'rows' | 'columns') => {
    if (!anchor) return
    setFrozen(current => ({ rows: mode === 'columns' ? current.rows : anchor.row,
      col: mode === 'rows' ? current.col : anchor.col - 1 }))
  }
  const recordKey = (record: T, index: number): React.Key => typeof props.rowKey === 'function'
    ? props.rowKey(record, index) : (record as Record<string, React.Key>)[String(props.rowKey || 'key')]
  const selectedKeys = props.rowSelection?.selectedRowKeys || []
  const updateSelection = (keys: React.Key[], type: 'all' | 'single') => props.rowSelection?.onChange?.(keys,
    (props.dataSource || []).filter((record, index) => keys.includes(recordKey(record, index))), { type })
  const rowSelection = props.rowSelection ? { ...props.rowSelection, fixed: frozen.col === -1 ? false : true,
    preserveSelectedRowKeys: true,
    columnTitle: <Checkbox aria-label="选择全部明细" checked={count > 0 && selectedKeys.length === count}
      indeterminate={selectedKeys.length > 0 && selectedKeys.length < count}
      onChange={event => updateSelection(event.target.checked ? (props.dataSource || []).map(recordKey) : [], 'all')} />,
  } : undefined
  const fixedWidth = mapped.reduce((total, col) => total + (col.fixed === 'left' ? Number(col.width) : 0), props.rowSelection && frozen.col !== -1 ? Number(props.rowSelection.columnWidth) || 32 : 0)
  return <ShipmentSheetDraftContext.Provider value={registerDraft}><ShipmentSheetFillContext.Provider value={fillFrom}><div className={`shipment-sheet${frozenRows ? ' shipment-sheet-has-frozen-rows' : ''}`} ref={root} tabIndex={-1} style={{ '--sheet-fixed-width': `${fixedWidth}px` } as React.CSSProperties}
    onScrollCapture={event => {
      const holder = event.target as HTMLElement
      if (holder.matches('.ant-table-header')) horizontalScroll.current?.headerScroll(holder.scrollLeft)
      if (!holder.matches('.ant-table-tbody-virtual-holder')) return
      const active = document.activeElement as HTMLElement | null
      if (!root.current?.contains(active) || !active?.matches('input,textarea') || active.closest('.ant-select,.ant-picker')) return
      const cell = active.closest<HTMLElement>('[data-sheet-col]')
      if (!cell) return
      const box = cell.getBoundingClientRect(), viewport = holder.getBoundingClientRect()
      // Scrollbars, touch and programmatic scrolls do not emit wheel. Commit
      // before the virtual list removes the active row, without blurring a
      // newly focused visible editor during keyboard navigation.
      if (box.bottom <= viewport.top || box.top >= viewport.bottom) active.blur()
    }}
    onTouchStartCapture={event => {
      if (!(event.target as HTMLElement).closest('.shipment-sheet-top-scroll')) horizontalScroll.current?.cancelPending()
    }}
    onWheelCapture={event => {
      if (!(event.target as HTMLElement).closest('.shipment-sheet-top-scroll')) horizontalScroll.current?.cancelPending()
      // Horizontal trackpad gestures keep the current editor/caret intact.
      // Only vertical scrolling can remove the active virtual row.
      if (event.shiftKey || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
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
      if ((event.target as HTMLElement).closest('.shipment-sheet-top-scroll')) return
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
      if ((event.target as HTMLElement).closest('.shipment-sheet-top-scroll')) return
      if (!anchor || !end) return
      const editor = (event.target as HTMLElement).closest<HTMLInputElement | HTMLTextAreaElement>('input,textarea')
      if (anchor.row === end.row && anchor.col === end.col && editor && editor.selectionStart !== editor.selectionEnd) return
      event.preventDefault()
      const values: string[] = []
      for (let row = Math.min(anchor.row, end.row); row <= Math.max(anchor.row, end.row); row++) {
        const cells: string[] = []
        for (let col = Math.min(anchor.col, end.col); col <= Math.max(anchor.col, end.col); col++) {
          const input = Array.from(cellAt({ row, col })?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([readonly]),textarea:not([readonly])') || [])
            .find(editor => !editor.closest('.ant-select,.ant-picker'))
          const text = input?.value ?? (fields[col] ? String(valueAt(row, fields[col]) ?? '') : String(displayAt(row, col) ?? cellText(cellAt({ row, col }))))
          cells.push(quote(fields[col] === 'pallet' ? formatShipmentPallet(text) : text))
        }
        values.push(cells.join('\t'))
      }
      event.clipboardData.setData('text/plain', values.join('\n'))
    }}
    onKeyDownCapture={event => {
      if ((event.target as HTMLElement).closest('.shipment-sheet-top-scroll')) return
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
      const p = point(event.target) || anchor
      const target = event.target as HTMLElement
      const isEditing = !!p && editingCell?.row === p.row && editingCell.col === p.col
      const historyKey = event.key.toLowerCase()
      const redo = historyKey === 'z' && event.shiftKey || historyKey === 'y' && !event.shiftKey
      const undo = historyKey === 'z' && !event.shiftKey
      if ((event.ctrlKey || event.metaKey) && !event.altKey && (undo || redo)) {
        const textEditor = target.closest('input:not([readonly]),textarea:not([readonly]),[contenteditable="true"]')
        if (textEditor && (isEditing || !point(target))) return
        event.preventDefault(); event.stopPropagation()
        if (!event.repeat) {
          if (redo) { if (!redoDisabled) onRedo() }
          else if (!undoDisabled) onUndo()
        }
        return
      }
      if (!p) return
      // A selected input stays mounted: native typing/selection, including the
      // very first character, starts editing without forwarding synthetic keys.
      if (!isEditing && !event.ctrlKey && !event.metaKey && !event.altKey
        && event.key.length === 1 && canEdit(p))
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
      if ((event.key === 'Delete' || event.key === 'Backspace') && !event.ctrlKey && !event.metaKey && !event.altKey
        && (!isEditing || (anchor && end && (anchor.row !== end.row || anchor.col !== end.col)))
        && !target.closest('button,a,select,[contenteditable="true"]')) {
        event.preventDefault(); event.stopPropagation()
        if (!event.repeat) clearSelection()
        return
      }
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
      <Button size="small" onClick={onUndo} disabled={undoDisabled} aria-keyshortcuts="Control+Z Meta+Z" title="Ctrl+Z / ⌘Z：撤回上一步表格操作">撤回</Button>
      <Button size="small" onClick={onRedo} disabled={redoDisabled} aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y" title="Ctrl/⌘+Shift+Z 或 Ctrl+Y：恢复刚撤回的表格操作">恢复</Button>
      <Dropdown menu={{ items: [
        { key: 'both', label: '冻结选中格上方行和左侧列', disabled: !anchor },
        { key: 'rows', label: '冻结选中格上方行', disabled: !anchor },
        { key: 'columns', label: '冻结选中格左侧列', disabled: !anchor },
        { key: 'clear', label: '取消冻结' }, { key: 'default', label: '恢复默认冻结' },
      ], onClick: ({ key }) => {
        if (key === 'clear') setFrozen({ rows: 0, col: -1 })
        else if (key === 'default') setFrozen({ rows: 0, col: null })
        else freezeAtSelection(key as 'both' | 'rows' | 'columns')
      } }}><Button size="small">冻结范围 ▾</Button></Dropdown>
      <Button size="small" onClick={fillDown} title="Ctrl/⌘D：单选复制上一行；多行选区按首行向下填充">向下填充选区</Button>
      <Button size="small" onClick={clearSelection} disabled={!anchor || !end} title="Delete / Backspace：清空所选可编辑单元格，不删除明细行">清空选区</Button>
    </Space>
    <div ref={topScroll} className="shipment-sheet-top-scroll" tabIndex={0} role="region" aria-label="横向滚动走货明细"
      style={{ width: scrollSize.width || '100%', display: scrollSize.contentWidth > scrollSize.width ? undefined : 'none' }}
      onKeyDown={event => event.stopPropagation()}
      onScroll={event => horizontalScroll.current?.railScroll(event.currentTarget.scrollLeft)}>
      <div style={{ width: scrollSize.contentWidth, height: 1 }} />
    </div>
    <Table<T> {...props} ref={table} virtual bordered columns={mapped} rowSelection={rowSelection}
      rowKey={(record, index) => recordKey(record, (index || 0) + frozenRows)}
      dataSource={props.dataSource?.slice(frozenRows)}
      summary={frozenRows ? () => <Table.Summary fixed="top">
        {props.dataSource!.slice(0, frozenRows).map((record, row) => <Table.Summary.Row key={recordKey(record, row)}>
          {rowSelection && <Table.Summary.Cell index={0}><Checkbox aria-label={`选择第 ${row + 1} 行`}
            checked={selectedKeys.includes(recordKey(record, row))}
            onChange={event => updateSelection(event.target.checked ? [...selectedKeys, recordKey(record, row)]
              : selectedKeys.filter(key => key !== recordKey(record, row)), 'single')} /></Table.Summary.Cell>}
          {mapped.map((column, col) => {
            const cell = column.onCell(record, row - frozenRows)
            const { rowSpan, colSpan, ...attributes } = cell
            const field = 'dataIndex' in column ? column.dataIndex : undefined
            const value = field == null ? undefined : (Array.isArray(field) ? field : [field])
              .reduce<unknown>((value, key) => value == null ? undefined : (value as Record<string, unknown>)[String(key)], record)
            return rowSpan === 0 || colSpan === 0 ? null : <Table.Summary.Cell key={col} index={col + (rowSelection ? 1 : 0)}
              rowSpan={rowSpan} colSpan={colSpan} align={column.align} className={cell.className}>
              <div {...attributes}>{column.render(value, record, row - frozenRows) as React.ReactNode}</div>
            </Table.Summary.Cell>
          })}
        </Table.Summary.Row>)}
      </Table.Summary> : props.summary}
      scroll={{ ...props.scroll, y: viewportHeight, x: mapped.reduce((total, col) => total + Number(col.width), 40) }} />
  </div></ShipmentSheetFillContext.Provider></ShipmentSheetDraftContext.Provider>
}
