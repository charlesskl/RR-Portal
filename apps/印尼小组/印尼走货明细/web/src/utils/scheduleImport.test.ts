import { describe, expect, it } from 'vitest'
import { scheduleSheetToRawGrid } from './scheduleImport'

describe('schedule import raw values', () => {
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
