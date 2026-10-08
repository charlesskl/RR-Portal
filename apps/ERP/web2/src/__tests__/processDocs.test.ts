// Batch 6 喷油/加工群纯函数:对照老系统 web/src/__tests__/factoryProcessMatch.test.ts 全量移植
// + 塑胶加工采购单明细展开/可见性合并/保存校验 + 喷油订单分组带入 + 三级流转徽章文案。
import { describe, expect, it } from "vitest";
import { factoryCategoryMatches } from "@/lib/factoryProcessMatch";
import {
  bringSprayRows,
  chainBadge,
  expandProcessBasis,
  groupSprayOrders,
  matchCount,
  mergeShownEdit,
  processLineVisible,
  sprayRowSpanGroups,
  validateProcessPurchaseLines,
  validateWpiLines,
  validProcessPurchaseLines,
} from "@/lib/processDocs";
import type { PPPOBasisRow, PPPOLine, SprayOrderReceivedRow } from "@/api/types";

describe("factoryCategoryMatches 加工内容↔加工厂类别(逐条移植老测试)", () => {
  it("印刷加工 匹配 移印/印喷/喷油/丝印/UV打印", () => {
    for (const c of ["移印", "印喷", "喷油", "丝印", "UV打印"])
      expect(factoryCategoryMatches("印刷加工", c)).toBe(true);
  });
  it("电镀加工 匹配 电镀,不匹配 移印", () => {
    expect(factoryCategoryMatches("电镀加工", "电镀")).toBe(true);
    expect(factoryCategoryMatches("电镀加工", "移印")).toBe(false);
  });
  it("镭雕 匹配 镭射;车发 匹配 车缝;啤机 匹配 啤塑", () => {
    expect(factoryCategoryMatches("镭雕", "镭射")).toBe(true);
    expect(factoryCategoryMatches("车发加工", "车缝")).toBe(true);
    expect(factoryCategoryMatches("啤机加工", "啤塑")).toBe(true);
  });
  it("厂无类别=不限制;行无加工内容=不匹配", () => {
    expect(factoryCategoryMatches(null, "移印")).toBe(true);
    expect(factoryCategoryMatches("", "移印")).toBe(true);
    expect(factoryCategoryMatches("电镀加工", null)).toBe(false);
    expect(factoryCategoryMatches("电镀加工", "  ")).toBe(false);
  });
  it("未知类别按去后缀包含匹配", () => {
    expect(factoryCategoryMatches("打磨加工", "打磨抛光")).toBe(true);
    expect(factoryCategoryMatches("打磨加工", "电镀")).toBe(false);
  });
});

describe("expandProcessBasis 调入加工清单展开", () => {
  const basis: PPPOBasisRow[] = [
    { 生产单号: "MO1", 款号: "K1", 物料编号: "M1", 物料名称: "白件", 加工内容: "喷油", 单价: 2.5 },
    {
      生产单号: "MO1",
      款号: "K1",
      物料编号: "M2",
      物料名称: "二加件",
      加工内容: "电镀",
      二次加工内容: "印喷",
      二次加工类别: "BD",
      单价: 1.2,
    },
  ];
  it("普通行原样 1 条;二次加工(BD)行展开 第一次/第二次 两条且带加工字母 B/D", () => {
    const ls = expandProcessBasis(basis);
    expect(ls).toHaveLength(3);
    expect(ls[0]).toMatchObject({ 物料编号: "M1", 加工内容: "喷油", 数量: 0, 单价: 2.5 });
    expect(ls[1]).toMatchObject({ 物料编号: "M2", 加工内容: "电镀", 加工次序: "第一次", 加工字母: "B" });
    expect(ls[2]).toMatchObject({ 物料编号: "M2", 加工内容: "印喷", 加工次序: "第二次", 加工字母: "D" });
  });
});

describe("塑胶加工采购单 可见性/合并/校验", () => {
  const lines: PPPOLine[] = [
    { 物料编号: "M1", 加工内容: "喷油", 数量: 10 },
    { 物料编号: "M2", 加工内容: "电镀", 数量: 5 },
    { 数量: 0 }, // 手录空白行(无物料编号且无加工内容)始终可见
  ];
  it("processLineVisible:厂类别过滤+手录空白行始终可见", () => {
    expect(processLineVisible(lines[0], "印刷加工")).toBe(true);
    expect(processLineVisible(lines[1], "印刷加工")).toBe(false);
    expect(processLineVisible(lines[2], "印刷加工")).toBe(true);
    expect(matchCount(lines, "印刷加工")).toBe(1);
  });
  it("mergeShownEdit:可见行替换/删除,隐藏行保留,新行追加末尾", () => {
    const visible = (l: PPPOLine) => processLineVisible(l, "印刷加工");
    // 可见行=[M1, 空白];编辑为 改M1数量+删空白+加新行
    const next: PPPOLine[] = [{ ...lines[0], 数量: 99 }, { 物料编号: "M9", 加工内容: "移印", 数量: 1 }];
    const out = mergeShownEdit(lines, visible, next);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ 物料编号: "M1", 数量: 99 });
    expect(out[1]).toMatchObject({ 物料编号: "M2", 数量: 5 }); // 隐藏行原样保留
    expect(out[2]).toMatchObject({ 物料编号: "M9" }); // 新行追加末尾
  });
  it("validateProcessPurchaseLines:无厂类别与有厂类别文案逐字", () => {
    expect(validateProcessPurchaseLines([{ 物料编号: "M1", 数量: 1 }])).toBeNull();
    expect(validateProcessPurchaseLines([{ 物料编号: "", 数量: 1 }])).toBe(
      "请至少录入一行有效物料明细(物料编号+数量)",
    );
    expect(validateProcessPurchaseLines([{ 物料编号: "", 数量: 1 }], "电镀加工")).toBe(
      "没有与厂类别[电镀加工]一致的有效物料明细(物料编号+数量),无法下单",
    );
    expect(validProcessPurchaseLines([{ 物料编号: "M1", 数量: 0 }, { 物料编号: "M2", 数量: 2 }])).toHaveLength(1);
  });
});

describe("白件领料单 明细校验", () => {
  it("validateWpiLines:至少一行 物料编号+数量>0,文案逐字", () => {
    expect(validateWpiLines([{ 物料编号: "M1", 数量: 3 }])).toBeNull();
    expect(validateWpiLines([{ 物料编号: "M1", 数量: 0 }])).toBe(
      "请至少录入一行有效物料明细(物料编号+数量)",
    );
    expect(validateWpiLines([])).toBe("请至少录入一行有效物料明细(物料编号+数量)");
  });
});

describe("喷油订单 分组/带入", () => {
  const recv: SprayOrderReceivedRow[] = [
    { 采购单号: "PO1", 供应商名称: "喷油一厂", 数量: 10, 物料编号: "M1", 喷油接收: "0" },
    { 采购单号: "PO1", 供应商名称: "喷油一厂", 数量: 20, 物料编号: "M2", 喷油接收: "0" },
    { 采购单号: "PO2", 供应商名称: "喷油二厂", 数量: 5, 物料编号: "M3", 喷油接收: "1", 喷油接收人: "张三" },
  ];
  it("groupSprayOrders:按采购单号聚合行数/数量合计/接收态", () => {
    const gs = groupSprayOrders(recv);
    expect(gs).toHaveLength(2);
    expect(gs[0]).toMatchObject({ 单号: "PO1", 行数: 2, 数量合计: 30, 接收: "0" });
    expect(gs[1]).toMatchObject({ 单号: "PO2", 行数: 1, 数量合计: 5, 接收: "1", 接收人: "张三" });
  });
  it("sprayRowSpanGroups:接收状态列跨行合并(组首行下标+行数)", () => {
    const m = sprayRowSpanGroups(recv);
    expect(m.get("PO1")).toEqual({ count: 2, first: 0 });
    expect(m.get("PO2")).toEqual({ count: 1, first: 2 });
  });
  it("bringSprayRows:带入该单明细,订购数量=订单数量,单位 个", () => {
    const rs = bringSprayRows(recv, "PO1");
    expect(rs).toHaveLength(2);
    expect(rs[0]).toMatchObject({ 物料编号: "M1", 订购数量: 10, 单位: "个" });
    expect(rs[1]).toMatchObject({ 物料编号: "M2", 订购数量: 20, 单位: "个" });
  });
});

describe("chainBadge 三级流转徽章文案", () => {
  it("已审核/经理已审(人)/主管已审(人)/未审核 四级", () => {
    expect(chainBadge({ 审核: "1" })[1]).toBe("已审核");
    expect(chainBadge({ 审核: "0", 经理审核: "1", 经理审核人: "李四" })[1]).toBe("经理已审(李四)");
    expect(chainBadge({ 审核: "0", 主管审核: "1", 主管审核人: "张三" })[1]).toBe("主管已审(张三)");
    expect(chainBadge({})[1]).toBe("未审核");
    expect(chainBadge(null)[1]).toBe("未审核");
  });
});
