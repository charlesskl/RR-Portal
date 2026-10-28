// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { inRangeYmd, normRange, ymdOf, ymdOfParts } from '../src/lib/dateRange.js';
import { partitionWarnings, ymOfYmd } from '../src/lib/monthWarnings.js';
import { baseOfSheetName } from '../src/lib/miandan.js';

describe('shared date filters and warning groups', () => {
  it('normalizes input separators, swaps reversed bounds, and includes both endpoints', () => {
    const range = normRange('2026年10月31日', '2026/10/1');
    expect(range).toEqual({ active: true, lo: '2026-10-01', hi: '2026-10-31', inverted: true });
    expect(inRangeYmd('2026-10-01', range)).toBe(true);
    expect(inRangeYmd('2026-10-31', range)).toBe(true);
    expect(inRangeYmd('2026-09-30', range)).toBe(false);
    expect(inRangeYmd('', range)).toBe(false);
    expect(inRangeYmd('', normRange('', ''))).toBe(true);
  });

  it('handles open-ended ranges and missing dates', () => {
    expect(inRangeYmd('2026-12-31', normRange('2026-10-01', ''))).toBe(true);
    expect(inRangeYmd('2026-09-30', normRange('', '2026-10-01'))).toBe(true);
    expect(ymdOf(new Date(2026, 9, 12))).toBe('2026-10-12');
    expect(ymdOf(new Date('invalid'))).toBe('');
    expect(ymdOf(null)).toBe('');
    expect(ymdOfParts({ y: 2026, m: 10, d: 1 })).toBe('2026-10-01');
  });

  it('groups only warnings in range and keeps undated warnings separate', () => {
    const warnings = [
      { text: 'October', ymd: '2026-10-01' },
      { text: 'September', ymd: '2026-09-30' },
      { text: 'November', ymd: '2026-11-01' },
      { text: 'Unknown', ymd: '' },
    ];
    expect(partitionWarnings(warnings, normRange('', ''))).toEqual({ shown: [], undated: [] });
    const grouped = partitionWarnings(warnings, normRange('2026-09-01', '2026-10-31'));
    expect(grouped.shown.map((g) => g.ym)).toEqual(['2026-09', '2026-10']);
    expect(grouped.undated.map((w) => w.text)).toEqual(['Unknown']);
    expect(ymOfYmd(null)).toBe('');
  });

  it.each([
    ['ZB95001折-2', 'ZB95001'],
    ['ZB95001-2折', 'ZB95001'],
    ['ZB95001折 取消', 'ZB95001'],
    ['95002 -3', '95002'],
    ['95002 取消', '95002'],
    ['说明', null],
  ])('finds warning date keys from %s', (name, expected) => {
    expect(baseOfSheetName(name)).toBe(expected);
  });
});
