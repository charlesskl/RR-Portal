// 打印模板共享素材(公司抬头/注意事项/落款/A4 CSS/esc/开新窗口),单源。
// 照抄老系统 web/src/utils/printContract.ts;採購單(printPurchaseOrder)、物料单据
// (printMaterialDoc 复用 esc/openPrintWindow)、装配加工合同(printAssemblyContract)共用。
export const COMPANY_NAME = "东莞兴信塑胶制品有限公司";
export const COMPANY_ADDRESS =
  "广东省东莞市清溪镇上元管理区兴信塑胶制品有限公司银坑北环路59号B栋2楼";
export const COMPANY_TEL = "0769-87362376";
export const COMPANY_FAX = "0769-87362377";
export const COMPANY_TELFAX = `TEL:${COMPANY_TEL}  FAX:${COMPANY_FAX}`;

// 注意事项(7条,原样)
export const PRINT_NOTES = [
  "1、收到本采购订单后，请24小时内予确认（签名、或及盖章），未签回，拒找数。",
  "2、供应商按时交货，延期交货应承担违约责任，且采购方有权取消部分或全部订单；",
  "3、所提供的物料或部件需要满足US, EU, AUS, NZ, CAN,CHN的最新玩具安全要求以及符合玩具的相关测试标准（例如：EN71, ASTM F963, AS / NZS ISO8124, GB6675, Reach, requirements of EC directive 2009/48/EC, Phthalates, PAH, lead, cadmium, Azo, PFAS,Formaldehyde, USP51, USP61/62 和其他适用的规定等等，电子类玩具还需要满足EN62115/ROHS/EMC/FCC/ICES-003/RCM/2006/66/EC等等）；",
  "4、货物之详细规格应与样品、或图纸相符；",
  "5、采购方收货仅为形式、数量收货，供应商保证货物质量、规格符合上述约定，同意随时抽检或全检；如有不符，同意补货或退货，如生产或市场销售中造成采购方损失，承担采购方损失；",
  "6、次月5号前提供当月对账单、送货单原件给甲方财务对账，双方同意付款时以港币折算为人民币付款，港币折算为人民币的汇率以送货当月月结后第60天的中国人民银行公布的港币与人民币汇率中间价核算，如果60天为节假日，顺延至工作日；付款前乙方提供发票、收款收据。如发生争议，同意由采购方法院管辖；",
  "7.其他事项：",
];

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);

export const d10 = (v?: string | null) => (v ? String(v).slice(0, 10) : "");

// 公司抬头(三行居中)
export const companyHeaderHtml = () =>
  `<div class="co-head"><div class="name">${esc(COMPANY_NAME)}</div><div>${esc(COMPANY_ADDRESS)}</div><div>${esc(COMPANY_TELFAX)}</div></div>`;

// 注意事项块
export const notesHtml = () =>
  `<div class="notes">${PRINT_NOTES.map((n) => `<div>${esc(n)}</div>`).join("")}</div>`;

// 落款(签字行 + 日期/页码行)
export const footerHtml = () =>
  `<div class="sign">
  <div>供应商确认：______&nbsp;&nbsp;采购签核：______&nbsp;&nbsp;业务：______&nbsp;&nbsp;主管：______&nbsp;&nbsp;经理：______</div>
  <div>日期：____年__月__日&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;日期：____年__月__日&nbsp;&nbsp;&nbsp;&nbsp;共&nbsp;&nbsp;页，第&nbsp;&nbsp;页</div>
</div>`;

// A4 黑白细边框表格;@page margin:0 去掉浏览器页眉页脚(日期/标题/URL/页码画在页边距里,
// 0 边距即无处绘制),视觉边距改由 body padding 承担,内容铺满整页
const css = `
  @page{size:A4 portrait;margin:0}
  body{font-family:"Microsoft YaHei","SimSun",sans-serif;margin:0;padding:12mm;color:#000;font-size:12px}
  .co-head{text-align:center;line-height:1.5}
  .co-head .name{font-size:16px;font-weight:700}
  .co-head div{font-size:11px}
  .co-head .name{font-size:16px}
  h2.doc-title{text-align:center;margin:6px 0;font-size:16px;letter-spacing:6px}
  table{width:100%;border-collapse:collapse}
  th,td{border:1px solid #000;padding:3px 5px;font-size:11px;text-align:left;vertical-align:top}
  th{text-align:center}
  .num{text-align:right}
  table.head-box td{border:none;padding:1px 4px;font-size:12px}
  .kv-line{margin:4px 0;font-size:12px}
  .terms{border:1px solid #000;padding:6px 8px;margin-top:6px;line-height:1.7;font-size:11px}
  .notes{margin-top:8px;line-height:1.7;font-size:11px}
  .sign{margin-top:14px;line-height:2;font-size:12px}
`;

export const wrapPrintHtml = (title: string, bodyHtml: string, extraCss = "") =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${css}${extraCss}</style></head>
<body>${bodyHtml}</body></html>`;

// 开新窗口写入 HTML 并触发浏览器打印(模式A)。
export function openPrintWindow(html: string): void {
  const w = window.open("", "_blank", "width=960,height=720");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}
