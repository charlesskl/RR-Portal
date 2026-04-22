/**
 * Production System — Shared Utilities
 */

/** Auto-detect API base path from current URL (e.g., "/rr" when accessed via /rr/) */
var API_BASE = (function() {
  var p = window.location.pathname;
  var m = p.match(/^(\/[^/]+)\//);
  if (m && m[1] !== '/api') return m[1];
  return '';
})();

function apiFetch(path, opts) {
  return fetch(API_BASE + path, opts);
}

/**
 * 材料名规范化（与后端 normMat 保持一致）
 * 去空格/括号/横杠/下划线、度↔°、全角数字→半角、转小写
 */
function normMat(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[０-９]/g, function(c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/度/g, '°')
    .replace(/[\s\-\(\)（）_]/g, '');
}

/**
 * 构建 normalized material → unit_price (>0) 的映射
 * @param {Array<{material:string, unit_price:number}>} prices
 */
function buildPriceMap(prices) {
  var map = {};
  (prices || []).forEach(function(p) {
    var price = +(p.unit_price || 0);
    if (price > 0 && p.material) map[normMat(p.material)] = price;
  });
  return map;
}

/**
 * 解析材料名获取单价（模糊匹配 + 混合料按最高比例组分取价）
 * @param {string} material
 * @param {Object} priceMap - normalized map from buildPriceMap
 * @returns {number} unit_price，0 表示查不到
 */
function resolvePrice(material, priceMap) {
  if (!material) return 0;
  var direct = priceMap[normMat(material)];
  if (direct) return direct;
  var parts = String(material).split(/[+＋]/).map(function(s) { return s.trim(); }).filter(Boolean);
  if (parts.length < 2) return 0;
  var mixed = parts.map(function(p) {
    var m = p.match(/^(\d+(?:\.\d+)?)\s*[%％]\s*(.+)$/);
    return m ? { pct: +m[1], name: m[2].trim() } : null;
  }).filter(Boolean);
  if (mixed.length < 2) return 0;
  mixed.sort(function(a, b) { return b.pct - a.pct; });
  for (var i = 0; i < mixed.length; i++) {
    var price = priceMap[normMat(mixed[i].name)];
    if (price) return price;
  }
  return 0;
}

/** HTML escape — prevents XSS in innerHTML contexts */
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Material summary aggregation from order items.
 * @param {Array} items - items with .material and .required_material_kg
 * @returns {{ entries: Array<[string, number]>, total: number }}
 */
function calcMatSummary(items) {
  var agg = {};
  (items || []).forEach(function(it) {
    if (!it.material) return;
    agg[it.material] = (agg[it.material] || 0) + (parseFloat(it.required_material_kg) || 0);
  });
  var entries = [];
  for (var k in agg) { if (agg[k] > 0) entries.push([k, agg[k]]); }
  var total = entries.reduce(function(s, e) { return s + e[1]; }, 0);
  return { entries: entries, total: total };
}

/**
 * Unified date formatting → YYYY-MM-DD
 */
function fmtDate(s) {
  if (!s || s === '-') return '-';
  s = String(s).trim();
  if (!/\d/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var parts = s.replace(/[./]/g, '-').split('-').map(function(p) { return p.trim(); });
  if (parts.length < 3) return s;
  var a = +parts[0], b = +parts[1], c = +parts[2];
  // YYYY-M-D or YYYY/M/D
  if (a > 99) return a + '-' + String(b).padStart(2, '0') + '-' + String(c).padStart(2, '0');
  // Two-digit year in position c (e.g., 13/5/26 or 5/13/26)
  if (c >= 20 && c <= 99) {
    if (a > 12) return '20' + c + '-' + String(b).padStart(2, '0') + '-' + String(a).padStart(2, '0'); // D/M/YY
    if (b > 12) return '20' + c + '-' + String(a).padStart(2, '0') + '-' + String(b).padStart(2, '0'); // M/D/YY
    return '20' + c + '-' + String(a).padStart(2, '0') + '-' + String(b).padStart(2, '0'); // M/D/YY default
  }
  // Two-digit year in position a (e.g., 26/5/13)
  if (a >= 20 && a <= 99 && b <= 12) return '20' + a + '-' + String(b).padStart(2, '0') + '-' + String(c).padStart(2, '0');
  return s;
}
