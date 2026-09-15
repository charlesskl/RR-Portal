import { describe, expect, it } from 'vitest'
import { isFullyYellowScheduleRow, isYellowScheduleCell, scheduleSheetToRawGrid } from './scheduleImport'

const yellow = (rgb = 'FFFF00') => ({ s: { patternType: 'solid', fgColor: { rgb } } })
const white = { s: { patternType: 'none' } }

describe('schedule import fill filtering', () => {
  it('recognizes WPS yellow in RGB and ARGB form', () => {
    expect(isYellowScheduleCell(yellow('FFFF00'))).toBe(true)
    expect(isYellowScheduleCell(yellow('FFFFFF00'))).toBe(true)
  })

  it('imports a row only when every A-AP cell is yellow', () => {
    expect(isFullyYellowScheduleRow(Array.from({ length: 42 }, () => yellow()))).toBe(true)
    expect(isFullyYellowScheduleRow([...Array.from({ length: 41 }, () => yellow()), white])).toBe(false)
  })

  it('does not mistake an isolated yellow date cell for an unplaced row', () => {
    expect(isFullyYellowScheduleRow([white, white, yellow(), white])).toBe(false)
  })

  it('keeps text headers even when their cell number format is a date', () => {
    const ws = {
      '!ref': 'A1:B2',
      A1: { t: 's', v: '货号', z: 'yyyy/m/d' },
      B1: { t: 's', v: '数量', z: 'General' },
      A2: { t: 's', v: 'E73622A' },
      B2: { t: 'n', v: 3000 },
    }
    const utils = {
      decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: 1, c: 1 } }),
      encode_cell: ({ r, c }: { r: number; c: number }) => `${String.fromCharCode(65 + c)}${r + 1}`,
    }
    expect(scheduleSheetToRawGrid(ws, utils)).toEqual([
      ['货号', '数量'],
      ['E73622A', 3000],
    ])
  })
})
