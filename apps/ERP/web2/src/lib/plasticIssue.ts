import type { IssueBasisRow, PlasticIssueLine } from "@/api/types";

// 塑胶领料单纯逻辑(对照老系统 web/src/utils/issueBasisPick.ts 与
// web/src/pages/plastics/PlasticIssueFormPage.tsx / PlasticIssueLineTable.tsx)。

// ---------- 批量领料(按生产单带入应领明细)挑选纯逻辑,逐条照抄 issueBasisPick ----------

// 解析多生产单号输入:逗号/空格/换行/顿号分隔,去空白、去重(保持输入顺序)
export const parse生产单号s = (input: string): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[\s,，、;；]+/)) {
    const no = raw.trim();
    if (no && !seen.has(no)) {
      seen.add(no);
      out.push(no);
    }
  }
  return out;
};

// 行唯一键:生产单号+货号+物料编号(按货号分组口径下单内唯一;多单靠生产单号区分)
export const issueBasisKey = (r: IssueBasisRow): string =>
  `${r.生产单号 ?? ""}|${r.货号 ?? ""}|${r.物料编号 ?? ""}`;

// 多单合并:拍平 -> 按 货号->物料编号(再生产单号) 排序 -> 同键去重(保留先到的)
export const mergeIssueBasisRows = (groups: IssueBasisRow[][]): IssueBasisRow[] => {
  const all = groups.flat().filter((r) => !!r.物料编号);
  const seen = new Set<string>();
  return all
    .slice()
    .sort(
      (a, b) =>
        (a.货号 ?? "").localeCompare(b.货号 ?? "", "zh-Hans-CN") ||
        (a.物料编号 ?? "").localeCompare(b.物料编号 ?? "", "zh-Hans-CN") ||
        (a.生产单号 ?? "").localeCompare(b.生产单号 ?? "", "zh-Hans-CN"),
    )
    .filter((r) => {
      const k = issueBasisKey(r);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
};

// 货号筛选选项:distinct 货号(保持排序后首次出现顺序;空货号归为空串)
export const distinct货号 = (rows: IssueBasisRow[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const v = r.货号 ?? "";
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
};

// ---------- 明细编辑行 ----------

// 塑胶领料明细编辑行(对照老系统 PlasticIssueLineTable;保真列序:
// 装配采购|生产单号|款号|物料编号|模具编号|物料名称|颜色|色粉号|用料名称|单位|数量)
export interface EditLine {
  key: number;
  装配采购?: string;
  生产单号?: string;
  款号?: string;
  物料编号?: string;
  模具编号?: string;
  物料名称?: string;
  规格?: string;
  颜色?: string;
  色粉号?: string;
  用料名称?: string;
  仓位号?: string;
  单位?: string;
  数量: string; // 输入框受控值,保存时 Number() 转换
}

// 应领行 -> 明细行(数量=应领量;照抄老系统 bringIssueBasis 的塑胶映射)
export const basisRowToLine = (r: IssueBasisRow, fallback生产单号: string, key: number): EditLine => ({
  key,
  生产单号: r.生产单号 ?? fallback生产单号,
  款号: r.款号 ?? undefined,
  物料编号: r.物料编号 ?? undefined,
  物料名称: r.物料名称 ?? undefined,
  规格: r.规格 ?? undefined,
  颜色: r.颜色 ?? undefined,
  单位: r.单位 ?? undefined,
  数量: String(Number(r.数量 ?? 0)),
});

// 提交前过滤:必须有物料编号且数量>0(对照老系统 save 的 ok 过滤)
export const validLines = (lines: EditLine[]) =>
  lines.filter((l) => !!l.物料编号 && Number(l.数量 || 0) > 0);

export const sumQty = (lines: { 数量?: string | number }[]) =>
  lines.reduce((a, l) => a + (Number(l.数量) || 0), 0);

// 编辑行 -> 提交明细(空串不带;数量转数值;对照后端 PlasticIssueCreateLineDto)
export const toSubmitLine = (l: EditLine): PlasticIssueLine => {
  const t = (v?: string) => (v && v.trim() !== "" ? v.trim() : undefined);
  return {
    装配采购: t(l.装配采购),
    生产单号: t(l.生产单号),
    款号: t(l.款号),
    物料编号: t(l.物料编号),
    模具编号: t(l.模具编号),
    物料名称: t(l.物料名称),
    规格: t(l.规格),
    颜色: t(l.颜色),
    色粉号: t(l.色粉号),
    用料名称: t(l.用料名称),
    仓位号: t(l.仓位号),
    单位: t(l.单位),
    数量: Number(l.数量),
  };
};

// 默认仓库预填:表头仓库为空且该物料设置有默认仓库时返回默认仓库;否则 null(不覆盖已填)
export function prefillDefaultWarehouse(
  current: string | null | undefined,
  默认仓库?: string | null,
): string | null {
  if ((current ?? "").trim()) return null;
  const wh = (默认仓库 ?? "").trim();
  return wh || null;
}

// 库存参考行:明细内 distinct 物料编号(保持首现顺序),库存数量取自库存表
export function stockRefRows(
  lines: { 物料编号?: string; 物料名称?: string }[],
  stock: Record<string, number>,
): { 物料编号: string; 物料名称?: string; 库存数量: number }[] {
  const seen = new Set<string>();
  const out: { 物料编号: string; 物料名称?: string; 库存数量: number }[] = [];
  for (const l of lines) {
    if (l.物料编号 && !seen.has(l.物料编号)) {
      seen.add(l.物料编号);
      out.push({ 物料编号: l.物料编号, 物料名称: l.物料名称, 库存数量: stock[l.物料编号] ?? 0 });
    }
  }
  return out;
}

// ---------- 打印(老系统表单页为 window.print();新系统统一开新窗口渲染单头+明细) ----------

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);

// 打印列与明细编辑列同序(保真;无价格列,与老系统表单页一致)
const PRINT_COLS: [string, string][] = [
  ["装配采购", "装配采购"],
  ["生产单号", "生产单号"],
  ["款号", "款号"],
  ["物料编号", "物料编号"],
  ["模具编号", "模具编号"],
  ["物料名称", "物料名称"],
  ["颜色", "颜色"],
  ["色粉号", "色粉号"],
  ["用料名称", "用料名称"],
  ["单位", "单位"],
  ["数量", "数量"],
  ["备注", "备注"],
];

export function buildPlasticIssuePrintHtml(
  title: string,
  detail: { 单头: Record<string, unknown> | null; 明细: Record<string, unknown>[] },
): string {
  const h = detail.单头 ?? {};
  const lines = detail.明细 ?? [];
  const headItems: [string, unknown][] = [
    ["单号", h.单号],
    ["日期", String(h.日期 ?? "").slice(0, 10)],
    ["领料部门", h.领料部门],
    ["领料人", h.领料人],
    ["仓库", h.仓库],
    ["收件人", h.收件人],
    ["电脑单号", h.电脑单号],
    ["领料备注", h.领料备注],
    ["操作员", h.操作员],
    ["备注", h.备注],
  ];
  const headHtml = headItems
    .map(([k, v]) => `<span class="hi"><b>${esc(k)}：</b>${esc(v)}</span>`)
    .join("");
  const thead = `<tr>${PRINT_COLS.map(([t]) => `<th>${esc(t)}</th>`).join("")}</tr>`;
  const tbody = lines
    .map((l) => `<tr>${PRINT_COLS.map(([, k]) => `<td>${esc(l[k])}</td>`).join("")}</tr>`)
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body{font-family:"Microsoft YaHei",sans-serif;margin:24px;color:#000}
  h2{text-align:center;margin:0 0 16px}
  .head{display:flex;flex-wrap:wrap;gap:6px 22px;margin-bottom:14px;font-size:13px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{border:1px solid #333;padding:4px 6px;text-align:left}
  th{background:#f0f0f0}
  @page{size:A4;margin:0}
  @media print{body{margin:0;padding:10mm}}
</style></head>
<body>
  <h2>${esc(title)}</h2>
  <div class="head">${headHtml}</div>
  <table><thead>${thead}</thead><tbody>${tbody}</tbody></table>
</body></html>`;
}

export function printPlasticIssue(
  title: string,
  detail: { 单头: Record<string, unknown> | null; 明细: Record<string, unknown>[] },
): void {
  const w = window.open("", "_blank", "width=1100,height=760");
  if (!w) return;
  w.document.write(buildPlasticIssuePrintHtml(title, detail));
  w.document.close();
  w.focus();
  w.print();
}
