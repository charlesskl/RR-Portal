// 拉别在下拉框里的统一显示名：拉长 + 拉别简称（取「：」前的部分）。
// 例："A拉：自动喷" + 拉长"宋沛霖" → "宋沛霖A拉"；"UV拉：UV" + "唐龙" → "唐龙UV拉"。
// 排序（A/B/C/UV）由后端 GET /api/lines 统一返回，前端不再各自排。
export function lineLabel(l: { name: string; leaderName?: string | null }): string {
  const short = l.name.split(/[：:]/)[0];
  return `${l.leaderName ?? ""}${short}`;
}
