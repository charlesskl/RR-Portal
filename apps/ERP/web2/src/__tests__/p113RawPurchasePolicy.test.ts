import { describe, expect, it } from "vitest";
import { rawPurchaseLimitLabel, validateRawPurchase } from "@/lib/rawPurchasePolicy";
import { rawIssueMessageTarget } from "@/lib/rawIssueMessage";
import type { RawPurchaseAnalysisRow } from "@/api/types";

const policy: RawPurchaseAnalysisRow = { 原料编号: "P113-R", 单位: "KG", 常用原料: false, 每包重量: 25, 可购数量: 28, 缺口数量KG: 28, 可购上限: 78, 可购上限KG: 78 };
describe("原料采购按实际缺口硬限与明确消息类型", () => {
  it("28KG缺口+两包25KG允许3整包，不把缺口先凑整包放大上限", () => {
    const bags = { ...policy, 单位: "包", 可购上限: 3 };
    expect(validateRawPurchase([{ 原料编号: "P113-R", 单位: "包", 订货数量: 3 }], [bags])).toBeNull();
    expect(validateRawPurchase([{ 原料编号: "P113-R", 单位: "包", 订货数量: 4 }], [bags])).toContain("超过采购上限");
    expect(rawPurchaseLimitLabel(policy)).toContain("整包最多 3 包");
  });
  it("相同原料不同大小写及公斤别名的多行共享一份上限", () => {
    expect(validateRawPurchase([{ 原料编号: "p113-r", 单位: "KG", 订货数量: 30 }, { 原料编号: " P113-R ", 单位: "公斤", 订货数量: 50 }], [policy])).toContain("合计 80");
  });
  it("采购不得切换库存单位绕额度，包须整包，KG最多四位小数", () => {
    expect(validateRawPurchase([{ 原料编号: "P113-R", 单位: "包", 订货数量: 1 }], [policy])).toContain("须与库存单位 KG 一致");
    expect(validateRawPurchase([{ 原料编号: "P113-R", 单位: "包", 订货数量: 1.1 }], [{ ...policy, 单位: "包", 可购上限: 3 }])).toContain("须填写整包数量");
    expect(validateRawPurchase([{ 原料编号: "P113-R", 单位: "KG", 订货数量: 1.12345 }], [policy])).toContain("最多四位小数");
    expect(validateRawPurchase([{ 原料编号: "P113-R", 单位: "公斤", 订货数量: 1.1234 }], [policy])).toBeNull();
  });
  it("非常用无缺口不重复采购，历史未标记同样受限", () => {
    expect(validateRawPurchase([{ 原料编号: "P113-R", 单位: "KG", 订货数量: 1 }], [{ ...policy, 常用原料: null, 可购上限: 0, 可购上限KG: 0 }])).toContain("超过采购上限");
  });
  it("明确常用可额外补库，不猜包重或接受未加载的政策", () => {
    expect(validateRawPurchase([{ 原料编号: "P113-R", 单位: "KG", 订货数量: 500 }], [{ ...policy, 常用原料: true, 可购上限: null, 可购上限KG: null }])).toBeNull();
    expect(validateRawPurchase([{ 原料编号: "P113-R", 单位: "KG", 订货数量: 1 }], [{ ...policy, 每包重量: null, 采购限制原因: "缺少明确每包重量" }])).toContain("缺少明确每包重量");
    expect(validateRawPurchase([{ 原料编号: "P113-R", 单位: "KG", 订货数量: 1 }], [])).toContain("未核实");
  });
  it("有限正数与后端限制原因均不可绕过", () => {
    expect(validateRawPurchase([{ 原料编号: "P113-R", 单位: "KG", 订货数量: Infinity }], [policy])).toContain("大于 0");
    expect(validateRawPurchase([{ 原料编号: "P113-R", 单位: "KG", 订货数量: 1 }], [{ ...policy, 采购限制原因: "源单尚未终审" }])).toContain("源单尚未终审");
  });
  it("原料消息只按明确类型打开真实原料出库号，不按YCK猜路由", () => {
    expect(rawIssueMessageTarget({ 类型: "原料领料待出库", 单号: " LL-甲 / ? " })).toBe("/plastic-raw-material-stock-issue?open=LL-%E7%94%B2%20%2F%20%3F");
    expect(rawIssueMessageTarget({ 类型: "未知类型", 单号: "YCK123" })).toBeNull();
    expect(rawIssueMessageTarget({ 类型: "原料领料待出库", 单号: " " })).toBeNull();
    expect(rawIssueMessageTarget({ 类型: "领料审批", 单号: "YCK123" })).toBeNull();
  });
});
