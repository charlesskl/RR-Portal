// 用量分数支持:印刷/裁切类物料常用「1/6」「1/2」写法(1 张料出 N 个,每套耗 1/N 张),
// 数据库 使用数量 仍是 decimal(下游 需求=数量×用量 全是数值计算),输入/显示层做 分数⇔小数 互转。

// 中文输入法兼容:全角斜杠「／」、分数斜杠「⁄」、除法斜杠「∕」归一为 ASCII "/";
// 全角数字「０-９」与全角点「．」一并归一——用户中文输入状态直接打 1/2 常产出 "1／2"/"１／２"
const normalize = (s: string): string =>
  s
    .replace(/[／⁄∕]/g, "/")
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 48))
    .replace(/．/g, ".");

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

// 解析用量输入:支持 "1/6"、"1 / 6"、全角 "1／6"/"１／６"、小数 "0.5"、整数 "2";空→undefined,非法/除零→undefined
export function parseQtyInput(s: string): number | undefined {
  const t = normalize(s).trim();
  if (!t) return undefined;
  const frac = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(t);
  if (frac) {
    const a = Number(frac[1]);
    const b = Number(frac[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return undefined;
    return a / b;
  }
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

// 用量显示:整数原样;0<n<1 且在容差内可约成 分母≤24 的分数 → "1/6"(decimal(18,4) 存的
// 0.1667 也能回显出 1/6);其余按最多 4 位小数去尾零
export function formatQty(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (Number.isInteger(n)) return String(n);
  if (n > 0 && n < 1) {
    // 绝对容差 0.0001:decimal(18,4) 四舍五入误差 ≤0.00005,真分数值必命中;普通小数不误判
    for (let d = 2; d <= 24; d++) {
      const r = Math.round(n * d);
      if (r >= 1 && Math.abs(n - r / d) < 0.0001) {
        const g = gcd(r, d);
        return `${r / g}/${d / g}`;
      }
    }
  }
  return String(Number(n.toFixed(4)));
}
