// 旧版ERP二次加工(喷油/电镀/植发/植绒)规则,与后端 SecondProcessCategory 保持同一映射。
// 照抄老系统 web/src/utils/secondProcess.ts(塑胶共用物料表「二次加工类别」推导提示用)。
// 类别后缀: 白胶件->电镀->印喷 = BD;白胶件->印喷->植绒 = AF;白胶件->印喷->植发 = AH。
// 顺序容错: 电镀与印喷组合无论先后都归 BD。加工字母绑定工序本身:
//   BD 类: 电镀=B(第一次), 印喷=D(第二次);AF 类: 印喷=A, 植绒=F;AH 类: 印喷=A, 植发=H。

type 工序 = "电镀" | "印喷" | "植绒" | "植发";

// 把自由文本的加工内容归一到四种工序之一;"喷油"/"移印"视同"印喷"(含「喷」或「印」即归印喷)。无法识别返回 null。
function 归一(加工内容?: string | null): 工序 | null {
  const s = (加工内容 ?? "").trim();
  if (!s) return null;
  if (s.includes("电镀")) return "电镀";
  if (s.includes("植绒")) return "植绒";
  if (s.includes("植发")) return "植发";
  if (s.includes("喷") || s.includes("印")) return "印喷";
  return null;
}

// 按 加工内容(第一次) + 二次加工内容(第二次) 推导类别后缀;组合不在三种之内返回 null。
export function 二次加工类别后缀(
  加工内容?: string | null,
  二次加工内容?: string | null,
): string | null {
  const a = 归一(加工内容);
  const b = 归一(二次加工内容);
  if (!a || !b || a === b) return null;
  const pair = new Set([a, b]);
  if (pair.has("电镀") && pair.has("印喷")) return "BD";
  if (pair.has("印喷") && pair.has("植绒")) return "AF";
  if (pair.has("印喷") && pair.has("植发")) return "AH";
  return null;
}

// 某类别下某工序对应的加工字母;类别或工序无法识别返回 null。
export function 二次加工字母(类别后缀?: string | null, 加工内容?: string | null): string | null {
  const p = 归一(加工内容);
  if (!p) return null;
  switch (类别后缀) {
    case "BD":
      return p === "电镀" ? "B" : p === "印喷" ? "D" : null;
    case "AF":
      return p === "印喷" ? "A" : p === "植绒" ? "F" : null;
    case "AH":
      return p === "印喷" ? "A" : p === "植发" ? "H" : null;
    default:
      return null;
  }
}
