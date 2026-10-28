import type { SheetPoint } from './shipmentSheet'

export const sheetArrowKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

/** Adjacent visible cell on the same axis; do not wrap at table boundaries. */
export function sheetArrowPoint(start: SheetPoint, key: string, rows: number, columns: number,
  hasCell: (point: SheetPoint) => boolean): SheetPoint | null {
  if (!sheetArrowKeys.has(key) || !Number.isInteger(start.row) || !Number.isInteger(start.col)
    || start.row < 0 || start.row >= rows || start.col < 0 || start.col >= columns) return null
  const dr = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0
  const dc = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0
  for (let row = start.row + dr, col = start.col + dc;
    row >= 0 && row < rows && col >= 0 && col < columns; row += dr, col += dc) {
    const point = { row, col }
    if (hasCell(point)) return point
  }
  return null
}

/** Text editing wins until a horizontal caret reaches its edge. */
export function sheetArrowUsesEditor(target: HTMLElement, key: string): boolean {
  // F2 focuses these composite editors. Their closed inputs still need arrows
  // to open/select options or move within a date; grid navigation owns the td.
  if (target.closest('.ant-select,.ant-picker')) return true
  if (target.closest('button,a,select,[contenteditable="true"]')) return true
  const editor = target.closest<HTMLInputElement | HTMLTextAreaElement>('input,textarea')
  if (!editor || editor.readOnly || editor.disabled) return false
  if (editor.tagName === 'TEXTAREA') return true
  if (key === 'ArrowUp' || key === 'ArrowDown') return false
  // Native number inputs may not expose their caret. Do not steal text editing.
  const { selectionStart: start, selectionEnd: end } = editor
  if (start == null || end == null || start !== end) return true
  return key === 'ArrowLeft' ? start > 0 : end < editor.value.length
}
