/**
 * 日期范围筛选（三个标签页共用）：'yyyy-mm-dd' 字符串闭区间比较。
 * 留空不限；起止倒置自动互换（inverted 标记供 UI 提示）；启用筛选时日期缺失一律排除。
 * 纯 ESM，浏览器 / Node 通用。
 */

/** 规范化范围输入 → { active, lo, hi, inverted }（lo/hi 为 'yyyy-mm-dd'，可空表示不限）
 *  兼容不支持 type=date 的浏览器（手输 2026/7/1、2026.7.1、2026年7月1日 等都归一成 yyyy-mm-dd，
 *  否则字符串比较 '/' > '-' 会把所有发票判成范围外，表现为"一个也筛不到"） */
const normDateStr = (s) => {
  const m = s.trim().match(/^(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})\D{0,3}$/);
  if (!m) return s.trim();
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
};
export function normRange(from, to) {
  const f = normDateStr(from || ''), t = normDateStr(to || '');
  if (!f && !t) return { active: false, lo: '', hi: '', inverted: false };
  const inverted = !!(f && t && f > t);
  return { active: true, lo: inverted ? t : f, hi: inverted ? f : t, inverted };
}

/** Date → 'yyyy-mm-dd'（本地年月日，与各页 fmtDate 一致）；非 Date 返回 '' */
export function ymdOf(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** { y, m, d } → 'yyyy-mm-dd'；缺返回 '' */
export function ymdOfParts(p) {
  if (!p || !p.y || !p.m || !p.d) return '';
  const pad = (x) => String(x).padStart(2, '0');
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** 判断 'yyyy-mm-dd' 是否在范围内（含边界）。range 来自 normRange；ymd 缺失 → 启用筛选时排除 */
export function inRangeYmd(ymd, range) {
  if (!range || !range.active) return true;
  if (!ymd) return false;
  if (range.lo && ymd < range.lo) return false;
  if (range.hi && ymd > range.hi) return false;
  return true;
}
