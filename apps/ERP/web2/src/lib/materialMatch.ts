// 「货号-物料名」前缀匹配规则:BOM 设置页自动带出/物料选择器按货号过滤共用。
// 物料命名约定:专属料「92125-吊卡」;共用料「92125/92119-贴纸」(两货号共用)。

// 货号前缀:92125-MA → 92125(前缀即货号)
export const 货号前缀 = (productNo: string) => productNo.split("-")[0] || productNo;

export interface MaterialPrefixRow {
  款号?: unknown;
  塑胶货号?: unknown;
  物料名称?: unknown;
}

// 前缀匹配物料:①物料名称按「/」分词,任一词命中前缀或以「前缀-」开头
// (92125-吊卡=92125 专属;92125/92119=两货号共用;92119/92125-贴纸 亦命中 92125);
// ②款号/塑胶货号精确命中,或按「/」分词命中前缀(塑胶仓,如 款号=92119/92125 的 92125 件)
export const matchPrefix = (m: MaterialPrefixRow, productNo: string) => {
  const base = 货号前缀(productNo);
  const by货号 = [m.款号, m.塑胶货号].some((v) => {
    const s = String(v ?? "").trim();
    return s === productNo || (base !== productNo && s.split("/").includes(base)) || s === base;
  });
  const by名称 = String(m.物料名称 ?? "")
    .split("/")
    .some((t) => {
      const tok = t.trim();
      return tok === base || tok.startsWith(`${base}-`);
    });
  return by货号 || by名称;
};
