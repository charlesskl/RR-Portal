// 网格单元格宽度规则:内容视觉宽度(CJK 计 2)、列统一宽度(最长内容 +3)、
// 长度上限(超过 CELL_CAP_LEN 的字段截断显示,点击/聚焦浮层完整展示,见 CellInput)。

export const visualLen = (s: string) =>
  [...s].reduce((n, ch) => n + (ch.charCodeAt(0) > 0xff ? 2 : 1), 0);

export const CELL_CAP_LEN = 30;
// +3:输入框内边距/光标余量
export const CELL_CAP_CH = CELL_CAP_LEN + 3;

// 列统一宽度(ch):该列最长内容 +3 余量,封顶 CELL_CAP_CH
export const colWidthCh = (contents: string[], min = 6) =>
  Math.min(Math.max(min, ...contents.map(visualLen)) + 3, CELL_CAP_CH);
