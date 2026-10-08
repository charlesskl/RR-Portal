// 塑胶共用物料表纯逻辑(独立成 lib 避免页面文件导出非组件触发 fast-refresh;
// 对照老系统 web/src/pages/plastics/PlasticCommonMaterialPage.tsx 的表单/校验口径)。

export const 套数规则提示 = "套数必须等于 出模数 ÷ 用量";
// 无单价权限时工模带回跳过的价格字段(对照老系统 价格字段)
export const 价格字段 = new Set(["啤机价钱", "胶件啤工价", "胶料单价", "原胶料单价"]);

// 表单数值字段(提交时转 Number,空串=null;对照老系统 InputNumber 清空=null)
export const NUM_FIELDS = [
  "加工单价",
  "整啤净重",
  "原胶件单净重",
  "整啤模腔数",
  "出模数",
  "用量",
  "套数",
  "水口比例",
  "整啤毛重",
  "模具日产量",
  "啤机价钱",
  "胶件啤工价",
  "胶料单价",
  "原胶料单价",
  "加工总单价",
  "其它成本",
] as const;

export type CommonFormState = Record<string, string>;

export const EMPTY_COMMON_FORM: CommonFormState = {
  客户: "",
  塑胶货号: "",
  工模编号: "",
  物料编号: "",
  物料名称: "",
  颜色: "",
  色粉号: "",
  用料名称: "",
  加工内容: "",
  二次加工内容: "",
  共用原料编号: "",
  备注内容: "",
  工模表备注: "",
  ...Object.fromEntries(NUM_FIELDS.map((k) => [k, ""])),
};

// 表单 -> 提交载荷(数值字段空串=null,其余空串=不带;对照老系统 form.validateFields 原样提交)
export function commonFormToPayload(form: CommonFormState): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(form)) {
    if ((NUM_FIELDS as readonly string[]).includes(k)) {
      body[k] = v.trim() === "" ? null : Number(v);
    } else if (v.trim() !== "") {
      body[k] = v.trim();
    }
  }
  return body;
}

// 套数校验(对照老系统 validator;全部满足时才校验,返回错误文案或 null)
export function validate套数(form: CommonFormState): string | null {
  const v = form.套数?.trim();
  if (!v) return null;
  const m = form.出模数?.trim();
  const u = form.用量?.trim();
  if (!m || !u) return null;
  const mu = Number(u);
  if (mu === 0) return 套数规则提示;
  const expected = Math.round((Number(m) / mu) * 10000) / 10000;
  return Math.abs(Number(v) - expected) < 1e-9 ? null : 套数规则提示;
}
