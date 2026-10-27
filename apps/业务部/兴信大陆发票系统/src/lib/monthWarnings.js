/**
 * 按月提示分组：三个模块（ZURU 发票 / 其他客 / 面单）共用的展示层过滤。
 * 条目统一为 { text, ymd }，ymd 为 'yyyy-mm-dd'，空串/null 表示归属不明。
 * 启用日期范围时：范围内条目按 yyyy-mm 分组返回，归属不明的进 undated（页面折叠展示）；
 * 未启用范围时两组都为空，由页面显示占位提示语。
 */

import { inRangeYmd } from './dateRange.js';

/** 'yyyy-mm-dd' → 'yyyy-mm'（空值 → ''） */
export const ymOfYmd = (ymd) => (ymd ? String(ymd).slice(0, 7) : '');

/**
 * @param items [{ text, ymd }]
 * @param range dateRange.normRange 的结果
 * @returns { shown: [{ ym, items }], undated: [{ text, ymd }] }（shown 按 ym 升序）
 */
export function partitionWarnings(items, range) {
  if (!range || !range.active) return { shown: [], undated: [] };
  const byYm = new Map();
  const undated = [];
  for (const it of items || []) {
    if (it.ymd && inRangeYmd(it.ymd, range)) {
      const ym = ymOfYmd(it.ymd);
      if (!byYm.has(ym)) byYm.set(ym, []);
      byYm.get(ym).push(it);
    } else if (!it.ymd) {
      undated.push(it);
    }
  }
  return { shown: [...byYm.keys()].sort().map((ym) => ({ ym, items: byYm.get(ym) })), undated };
}
