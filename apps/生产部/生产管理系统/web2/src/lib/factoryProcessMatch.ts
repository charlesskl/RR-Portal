// 加工内容 与 加工厂类别 的一致性判断(照抄老系统 web/src/utils/factoryProcessMatch.ts)。
// 规则:类别去「加工」后缀后与加工内容做包含匹配,另配同义关键字
// (印刷=印/喷 覆盖 移印/印喷/喷油/UV打印;镭雕=镭 覆盖 镭射;车发=车/缝 等)。
// 厂无类别=不限制;行无加工内容=不匹配。
const ALIAS: Record<string, string[]> = {
  印刷: ["印", "喷"],
  电镀: ["电镀"],
  啤机: ["啤"],
  车发: ["车", "缝"],
  植绒: ["植绒"],
  镭雕: ["镭"],
  装配: ["装配"],
};

export function factoryCategoryMatches(类别?: string | null, 加工内容?: string | null): boolean {
  const cat = (类别 ?? "").trim();
  const content = (加工内容 ?? "").trim();
  if (!cat) return true;
  if (!content) return false;
  const key = cat.replace(/加工$/, "");
  const kws = ALIAS[key] ?? [key];
  return kws.some((k) => content.includes(k));
}
