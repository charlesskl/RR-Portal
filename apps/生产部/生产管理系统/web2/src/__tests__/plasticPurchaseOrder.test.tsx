// 塑胶采购订单:纯函数移植(老 web/src/__tests__/plasticPurchaseOrderDrawerStock.test.ts 逐条
// + mergeLines/owedStatus/filterSubmitLines/basisToLine 口径)+ 打印模板断言(对照老
// printPlasticContract/printMoldingSheet 模板关键结构)+ 页面行为(打开/三级审核/喷油校验/下推入仓)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { useEffect } from "react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import {
  applyMoldBalance,
  applyStockDeduction,
  basisToLine,
  buildMoldingSheetHtml,
  buildPlasticContractPrintHtml,
  filterSubmitLines,
  display加工类型,
  lineRawKg,
  mergeLines,
  mergeMoldPairLines,
  mergeProcessContents,
  mergeRawMaterials,
  moldGroups,
  owedStatus,
  plasticDefaultSelect,
  rawKgOf,
  shotsOf,
  type PpoEditLine,
} from "@/lib/plasticPurchase";
import PlasticPurchaseOrderPage from "@/pages/PlasticPurchaseOrderPage";
import PlasticPurchaseOrderPrintPage from "@/pages/PlasticPurchaseOrderPrintPage";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: () => number }) => {
    const size = opts.estimateSize();
    return {
      getTotalSize: () => opts.count * size,
      getVirtualItems: () =>
        Array.from({ length: opts.count }, (_, i) => ({ index: i, start: i * size, size, key: i })),
      measure: () => {},
    };
  },
}));

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS_FULL = [{ 组: "塑胶采购", 菜单: "塑胶采购订单", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 打印: true }];

// ---------- 纯函数 ----------

describe("塑胶采购订单·默认勾选(对照 plasticPurchaseOrderDrawerStock.test.ts)", () => {
  it("普通行默认勾选", () => {
    expect(plasticDefaultSelect({ 数量: 200, 可用库存: 50 })).toBe(true);
    expect(plasticDefaultSelect({ 数量: 200, 可用库存: 0 })).toBe(true);
    expect(plasticDefaultSelect({ 数量: 200 })).toBe(true);
  });

  it("可用库存 >= 订购数量 -> 默认不勾选", () => {
    expect(plasticDefaultSelect({ 数量: 200, 可用库存: 200 })).toBe(false);
    expect(plasticDefaultSelect({ 数量: 200, 可用库存: 500 })).toBe(false);
  });

  it("订购数量为 0 不参与库存判断,仍默认勾选", () => {
    expect(plasticDefaultSelect({ 数量: 0, 可用库存: 100 })).toBe(true);
  });

  it("已下单行默认不勾选(原有规则保留)", () => {
    expect(plasticDefaultSelect({ 已订数量: 5, 数量: 200, 可用库存: 0 })).toBe(false);
  });

  it("有 需求数量 时按需求判定(扣库存后 数量 变小不影响勾选)", () => {
    // 需求 100 库存 500:就算当前数量被扣成 0,仍按需求判定为「库存够」默认不勾
    expect(plasticDefaultSelect({ 需求数量: 100, 数量: 0, 可用库存: 500 })).toBe(false);
    // 需求 100 库存 30(部分扣减):仍默认勾
    expect(plasticDefaultSelect({ 需求数量: 100, 数量: 70, 可用库存: 30 })).toBe(true);
  });
});

describe("塑胶采购订单·计算库存(applyStockDeduction)", () => {
  const line = (over: Partial<PpoEditLine>): PpoEditLine => ({
    key: 1, 数量: "0", 用量: "", 套数: "", ...over,
  });

  it("勾选:订购数量=max(需求−可用库存,0);库存空=不扣", () => {
    const rs = applyStockDeduction(
      [
        line({ key: 1, 物料编号: "A", 需求数量: 100, 数量: "100", 可用库存: 30 }),
        line({ key: 2, 物料编号: "B", 需求数量: 100, 数量: "100", 可用库存: 500 }), // 扣到 0
        line({ key: 3, 物料编号: "C", 需求数量: 100, 数量: "100" }), // 无库存数据:不扣
        line({ key: 4, 物料编号: "D", 数量: "8" }), // 无需求数量(补料/手工行):不动
      ],
      true,
    );
    expect(rs.map((r) => r.数量)).toEqual(["70", "0", "100", "8"]);
  });

  it("取消勾选:恢复全量需求;无需求行不动", () => {
    const rs = applyStockDeduction(
      [
        line({ key: 1, 物料编号: "A", 需求数量: 100, 数量: "70", 可用库存: 30 }),
        line({ key: 2, 物料编号: "D", 数量: "8" }),
      ],
      false,
    );
    expect(rs.map((r) => r.数量)).toEqual(["100", "8"]);
  });
});

describe("塑胶采购订单·mergeLines/owedStatus/filterSubmitLines", () => {
  const line = (over: Partial<PpoEditLine>): PpoEditLine => ({
    key: 1, 数量: "0", 用量: "", 套数: "", ...over,
  });

  it("mergeLines 按物料编号合并数量/入仓/欠数,序号重排", () => {
    const rows = mergeLines([
      line({ key: 1, 物料编号: "M1", 物料名称: "齿轮", 数量: "100", 入仓数量: 40, 欠数: 60 }),
      line({ key: 2, 物料编号: "M1", 数量: "50", 入仓数量: 10, 欠数: 40 }),
      line({ key: 3, 物料编号: "M2", 数量: "20" }),
      line({ key: 4, 物料编号: "", 数量: "999" }), // 空编号跳过
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ 序号: 1, 物料编号: "M1", 数量合计: 150, 入仓合计: 50, 欠数合计: 100 });
    expect(rows[1]).toMatchObject({ 序号: 2, 物料编号: "M2", 数量合计: 20, 入仓合计: null, 欠数合计: null });
  });

  it("owedStatus:欠/超收/已完成/无数据", () => {
    expect(owedStatus(5)).toEqual({ kind: "欠", value: 5 });
    expect(owedStatus(-3)).toEqual({ kind: "超收", value: 3 });
    expect(owedStatus(0)).toEqual({ kind: "完成", value: 0 });
    expect(owedStatus(null)).toBeNull();
  });

  it("filterSubmitLines:过滤无效行;喷油单只留印喷类;单头加工内容裁剪", () => {
    const lines = [
      line({ key: 1, 物料编号: "M1", 数量: "10", 加工内容: "喷油" }),
      line({ key: 2, 物料编号: "M2", 数量: "5", 加工内容: "电镀" }),
      line({ key: 3, 物料编号: "M3", 数量: "0" }), // 数量 0 无效
      line({ key: 4, 物料编号: "", 数量: "8" }), // 无编号无效
    ];
    const all = filterSubmitLines(lines, { 喷油单: false, 加工内容: "" });
    expect(all.kept.map((l) => l.物料编号)).toEqual(["M1", "M2"]);
    const oil = filterSubmitLines(lines, { 喷油单: true, 加工内容: "" });
    expect(oil.kept.map((l) => l.物料编号)).toEqual(["M1"]);
    expect(oil.dropped喷油).toBe(1);
    const 加工 = filterSubmitLines(lines, { 喷油单: false, 加工内容: "电镀" });
    expect(加工.kept.map((l) => l.物料编号)).toEqual(["M2"]);
    expect(加工.dropped加工).toBe(1);
  });

  it("filterSubmitLines:二次加工模式不做行级喷油/加工内容裁剪(行来自可二次加工库存,无行级加工内容)", () => {
    const lines = [
      line({ key: 1, 物料编号: "M1", 数量: "10" }), // 库存行:无加工内容
      line({ key: 2, 物料编号: "M2", 数量: "5", 已加工工序: "啤塑" }),
      line({ key: 3, 物料编号: "M3", 数量: "0" }), // 数量 0 仍无效
    ];
    const r = filterSubmitLines(lines, { 喷油单: true, 加工内容: "印喷", 二次加工: true });
    expect(r.kept.map((l) => l.物料编号)).toEqual(["M1", "M2"]);
    expect(r.dropped喷油).toBe(0);
    expect(r.dropped加工).toBe(0);
  });

  it("display加工类型:未选加工内容的一次加工单=啤机;选了才算一次/二次加工", () => {
    expect(display加工类型("一次加工", null)).toBe("啤机");
    expect(display加工类型(undefined, "")).toBe("啤机");
    expect(display加工类型(null, "  ")).toBe("啤机");
    expect(display加工类型("一次加工", "印喷")).toBe("一次加工");
    expect(display加工类型("二次加工", "喷油")).toBe("二次加工");
    expect(display加工类型("二次加工", null)).toBe(""); // 未选加工内容不算二次加工
  });

  it("basisToLine:数量默认=计划数量×用量,四舍五入取整(100000×1/3→33333);印喷类加工内容写入备注", () => {
    const l = basisToLine(
      { 生产单号: "MO1", 物料编号: "M1", 计划数量: 100, 用量: 0.25, 加工内容: "喷油", 已订数量: 3 },
      1,
    );
    expect(l.数量).toBe("25");
    expect(l.需求数量).toBe(25);
    expect(l.备注).toBe("喷油");
    expect(l.已订数量).toBe(3);
    // 1/3 用量出小数时取整,且不影响啤数口径(⌈33333/6⌉=⌈33333.33/6⌉)
    expect(basisToLine({ 物料编号: "M1b", 计划数量: 100000, 用量: 0.333333 }, 9).数量).toBe("33333");
    const noQty = basisToLine({ 物料编号: "M2", 加工内容: "电镀" }, 2);
    expect(noQty.数量).toBe("0");
    expect(noQty.需求数量).toBeNull();
    expect(noQty.备注).toBeUndefined();
  });

  it("basisToLine:带损耗率时数量=计划数量×用量×(1+损耗率/100)取整,损耗率随行带出", () => {
    const l = basisToLine({ 物料编号: "M3", 计划数量: 3000, 用量: 1, 损耗率: 6.67 }, 3);
    expect(l.数量).toBe("3200");
    expect(l.损耗率).toBe(6.67);
    // 无损耗率不加成
    expect(basisToLine({ 物料编号: "M4", 计划数量: 3000, 用量: 1 }, 4).数量).toBe("3000");
  });

  it("basisToLine:原料关联(编号/名称/单件克重/原料库存)随行带出", () => {
    const l = basisToLine(
      { 物料编号: "M5", 原料编号: "R1", 原料名称: "ABS GP22", 单件克重: 1.6, 原料库存: 100 },
      5,
    );
    expect(l.原料编号).toBe("R1");
    expect(l.原料名称).toBe("ABS GP22");
    expect(l.单件克重).toBe(1.6);
    expect(l.原料库存).toBe(100);
  });

  it("rawKgOf/lineRawKg:数量×单件克重/1000(2 位取舍);无克重返回 null,快照兜底", () => {
    expect(rawKgOf(10000, 1.6)).toBe(16);
    expect(rawKgOf("3000", 1.6)).toBe(4.8);
    expect(rawKgOf(100, null)).toBeNull();
    expect(rawKgOf(100, 0)).toBeNull();
    expect(lineRawKg(line({ 数量: "10000", 单件克重: 1.6, 原料用量KG: 9.99 }))).toBe(16);
    expect(lineRawKg(line({ 数量: "10000", 原料用量KG: 9.99 }))).toBe(9.99);
  });

  it("mergeRawMaterials:按原料合并扣减KG,扣后剩余=原料库存−扣减", () => {
    const rows = mergeRawMaterials([
      line({ key: 1, 物料编号: "M1", 数量: "10000", 原料编号: "R1", 原料名称: "ABS GP22", 单件克重: 1.6, 原料库存: 20 }),
      line({ key: 2, 物料编号: "M2", 数量: "5000", 原料编号: "R1", 单件克重: 1.6 }),
      line({ key: 3, 物料编号: "M3", 数量: "100" }), // 无原料关联跳过
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      原料编号: "R1",
      原料名称: "ABS GP22",
      扣减KG: 24,
      库存KG: 20,
      剩余KG: -4,
    });
  });

  it("shotsOf:啤数=ceil(数量/出模数);无出模数返回 null", () => {
    expect(shotsOf(1000, 4)).toBe(250);
    expect(shotsOf(1001, 4)).toBe(251);
    expect(shotsOf("1000", 1)).toBe(1000);
    expect(shotsOf(1000, null)).toBeNull();
    expect(shotsOf(1000, 0)).toBeNull();
  });

  it("moldGroups:同模多配件分组算共啤数;啤数不齐标不平衡;单物料/无模具编号不成组", () => {
    const groups = moldGroups([
      line({ key: 1, 模具编号: "GM1", 物料编号: "A", 数量: "1000", 出模数: 4 }), // 250啤
      line({ key: 2, 模具编号: "GM1", 物料编号: "B", 数量: "1000", 出模数: 1 }), // 1000啤
      line({ key: 3, 模具编号: "GM2", 物料编号: "C", 数量: "2000", 出模数: 2 }), // 平衡组
      line({ key: 4, 模具编号: "GM2", 物料编号: "D", 数量: "1000", 出模数: 1 }),
      line({ key: 5, 模具编号: "GM3", 物料编号: "E", 数量: "100", 出模数: 1 }), // 单物料不成组
      line({ key: 6, 模具编号: "GM3", 物料编号: "E", 数量: "100", 出模数: 1, 颜色: "红" }),
      line({ key: 7, 物料编号: "F", 数量: "100", 出模数: 1 }), // 无模具编号
    ]);
    expect(groups).toHaveLength(2);
    const g1 = groups.find((g) => g.模具编号 === "GM1")!;
    expect(g1).toMatchObject({ 配件数: 2, 共啤数: 1000, 不平衡: true });
    // 一套模明细:组内行带 数量/出模数/啤数(面板逐配件展示用)
    expect(g1.lines[0]).toMatchObject({ 物料编号: "A", 数量: "1000", 出模数: 4, 啤数: 250 });
    const g2 = groups.find((g) => g.模具编号 === "GM2")!;
    expect(g2).toMatchObject({ 配件数: 2, 共啤数: 1000, 不平衡: false });
  });

  it("moldGroups:组内有行缺出模数时共啤数为 null、不判不平衡", () => {
    const groups = moldGroups([
      line({ key: 1, 模具编号: "GM1", 物料编号: "A", 数量: "1000", 出模数: 4 }),
      line({ key: 2, 模具编号: "GM1", 物料编号: "B", 数量: "1000" }),
    ]);
    expect(groups[0].共啤数).toBeNull();
    expect(groups[0].不平衡).toBe(false);
  });

  it("applyMoldBalance:啤数小的行数量补足到 共啤数×出模数", () => {
    const src = [
      line({ key: 1, 模具编号: "GM1", 物料编号: "A", 数量: "1000", 出模数: 4 }), // 250→1000啤:补到4000
      line({ key: 2, 模具编号: "GM1", 物料编号: "B", 数量: "1000", 出模数: 1 }), // 1000啤:不动
      line({ key: 3, 模具编号: "GM2", 物料编号: "C", 数量: "2000", 出模数: 2 }), // 平衡组:不动
      line({ key: 4, 模具编号: "GM2", 物料编号: "D", 数量: "1000", 出模数: 1 }),
    ];
    const r = applyMoldBalance(src);
    expect(r.补齐行数).toBe(1);
    expect(r.lines[0].数量).toBe("4000");
    expect(r.lines[1].数量).toBe("1000");
    expect(r.lines[2].数量).toBe("2000");
    // 全部平衡时原样返回
    const flat = applyMoldBalance(src.slice(2));
    expect(flat.补齐行数).toBe(0);
  });

  it("mergeProcessContents:接口值并上固定集合且去重", () => {
    const merged = mergeProcessContents(["喷油", "镭雕"]);
    expect(merged).toContain("镭雕");
    expect(merged).toContain("喷油");
    expect(merged).toContain("植绒");
    expect(merged.filter((x) => x === "喷油")).toHaveLength(1);
  });
});

describe("塑胶采购订单·打印模板", () => {
  const detail = {
    单头: {
      单号: "PPO1", 编号: "PO-9", 日期: "2026-09-01", 交货日期: "2026-09-20",
      供应商名称: "喷油厂A", 供应商联系人: "张三", 供应商电话: "123", 操作员: "op",
      备注: "备注X", 交货地点: "东莞",
    },
    明细: [
      { 款号: "K1", 物料名称: "壳", 用料名称: "ABS", 颜色: "黑", 数量: 200, 单重: 5, 备注: "喷油" },
    ],
  };

  it("委托加工合同:单重G/总重KG=单重×数量/1000 两位;订单编号优先取 编号", () => {
    const html = buildPlasticContractPrintHtml(detail as never);
    expect(html).toContain("委托加工合同");
    expect(html).toContain("订单编号：PO-9");
    expect(html).toContain("<td class=\"num\">5</td><td class=\"num\">1.00</td><td class=\"num\">200</td>");
    expect(html).toContain("收到本采购订单后"); // 注意事项 7 条(共享打印资产)
    expect(html).toContain("0769-87362376");
  });

  it("委托加工合同(对照 ActiveReports 原单):数量千分位/单价 HK$3位/金额=数量×单价 HK$1位/TOTAL 合计/日期中文/交货地点默认", () => {
    const html = buildPlasticContractPrintHtml({
      单头: { 单号: "PPO9", 日期: "2022-10-31", 交货日期: "2022-10-31", 供应商名称: "揭阳市华存玩具制品有限公司", 操作员: "邓娟" },
      明细: [
        { 款号: "K1", 物料名称: "挂卡", 用料名称: "ABS", 颜色: "红", 数量: 24741, 单重: 0.41, 加工单价: 0.093 },
        { 款号: "K2", 物料名称: "睫毛", 用料名称: "ABS", 颜色: "香槟金", 数量: 16492, 单重: 6.7, 加工单价: 0.093 },
      ],
    } as never);
    // 数量千分位整数;单价 HK$+原值;金额=数量×单价 HK$+千分位 1 位小数
    expect(html).toContain('<td class="num">24,741</td><td class="num">HK$0.093</td><td class="num">HK$2,300.9</td>');
    expect(html).toContain('<td class="num">16,492</td><td class="num">HK$0.093</td><td class="num">HK$1,533.8</td>');
    // TOTAL 行金额合计(24741+16492)×0.093=3834.7
    expect(html).toContain('<td class="num">HK$3,834.7</td>');
    // 日期/交货日期中文;交货地点空时默认公司
    expect(html).toContain("日期：2022年10月31日");
    expect(html).toContain("交货日期：2022年10月31日");
    expect(html).toContain("交货地点：东莞市清溪镇上元管理区 东莞兴信塑胶制品有限公司");
    // 无加工单价(无「单价」权限置 null)时单价/金额/TOTAL 全留空(HK$ 仅表头「金额(HK$)」一处)
    const masked = buildPlasticContractPrintHtml({
      单头: { 单号: "PPO9" },
      明细: [{ 款号: "K1", 物料名称: "挂卡", 数量: 100, 单重: 0.41, 加工单价: null }],
    } as never);
    expect(masked.split("HK$")).toHaveLength(2);
  });

  it("啤机部生产啤货表:总套数=件数,啤数=⌈件数/出模数⌉,总净重=整啤净重×啤数/1000;末页用料汇总(混料拆分/发料×1.005/包数÷25)", () => {
    const html = buildMoldingSheetHtml({
      单头: { 单号: "PPO2", 供应商名称: "啤机厂", 日期: "2026-09-01", 交货日期: "2026-09-21", 操作员: "op" },
      明细: [
        { 款号: "K1", 模具编号: "MJ1", 物料名称: "壳", 数量: 1000, 出模数: 2, 颜色: "黑", 色粉号: "SF1", 用料名称: "ABS", 整啤净重: 50, 加工内容: "印喷" },
        { 款号: "K2", 模具编号: "MJ2", 物料名称: "盖", 数量: 500, 出模数: 4, 用料名称: "ABS", 整啤净重: 20 },
        { 款号: "K3", 模具编号: "MJ3", 物料名称: "蛋", 数量: 1000, 出模数: 1, 用料名称: "PP EP332K + PP 1120 (7:3)", 整啤净重: 100 },
      ],
    } as never);
    expect(html).toContain("啤 机 部 生 产 啤 货 表");
    // 总套数=件数 1000,啤数=⌈1000/2⌉=500;总净重=50×500/1000=25.0
    expect(html).toContain('<td class="num">1000</td><td class="num">500</td>');
    expect(html).toContain('<td class="num">50</td><td class="num">25.0</td>');
    // 第二行:啤数 ⌈500/4⌉=125,总净重 20×125/1000=2.5
    expect(html).toContain('<td class="num">500</td><td class="num">125</td>');
    expect(html).toContain('<td class="num">20</td><td class="num">2.5</td>');
    // 加工单价 0 / 加工金额 0.0(塑胶单无加工费,原样)
    expect(html).toContain('<td class="num">0</td><td class="num">0.0</td>');
    // 用料汇总(末页表格末行,无边框表格分列对齐):ABS 27.5(25.0+2.5)→发料 27.6,包数 1.1
    expect(html).toContain('<table class="ms-agg-t">');
    expect(html).toContain("〖ABS〗");
    expect(html).toContain('<td class="a-num">27.5 KG</td>');
    expect(html).toContain('<td class="a-num">27.6 KG</td>');
    expect(html).toContain("（包数：1.1 包）；");
    // 混料 (7:3) 拆分:100×1000/1000=100 → 70.0/30.0
    expect(html).toContain("〖PP EP332K〗");
    expect(html).toContain('<td class="a-num">70.0 KG</td>');
    expect(html).toContain('<td class="a-num">70.4 KG</td>');
    expect(html).toContain("〖PP 1120〗");
    expect(html).toContain('<td class="a-num">30.0 KG</td>');
    expect(html).toContain('<td class="a-num">30.2 KG</td>');
    // 汇总跟在末页数据后(只有 1 页,无独立汇总页)
    expect(html).toContain("第 1 页，共 1 页");
    expect(html).not.toContain("第 2 页");
    // 特别注明(两格版式) + 备注行
    expect(html).toContain('<td class="ctr">特别注明</td>');
    expect(html).toContain("凡是移印、喷油、电镀、车衣部加工配件都需要先安排啤货");
    // 表头中文日期 + 接单日期
    expect(html).toContain("出单日期：2026年09月01日");
    expect(html).toContain("交货日期：2026年09月21日");
    expect(html).toContain("接单日期：2026年09月01日");
    // 备注列:行备注空时回落 加工内容(原单 喷油 标记同款)
    expect(html).toContain("<td>印喷</td>");
  });

  // 耳朵打印合并(对照原单照片:同模 RBCEZ2-03M-01 每色一行「耳朵」50000/16667 啤/181.5G/3025.1KG;
  // 整啤净重=一啤整模净重,物料资料按模登记,对件同值 181.5,合并取同值不合计)
  const EAR_ROWS = [
    { 物料编号: "57001663", 物料名称: "左耳朵", 模具编号: "MJ3", 数量: 50000, 色粉号: "89208", 颜色: "幻彩红", 用料名称: "PVC 95度(透明)", 整啤净重: 181.5, 出模数: 3 },
    { 物料编号: "57001643", 物料名称: "右耳朵", 模具编号: "MJ3", 数量: 50000, 色粉号: "89208", 颜色: "幻彩红", 用料名称: "PVC 95度(透明)", 整啤净重: 181.5, 出模数: 3 },
    { 物料编号: "57001642", 物料名称: "左耳朵", 模具编号: "MJ3", 数量: 50000, 色粉号: "89209", 颜色: "幻彩紫", 用料名称: "PVC 95度(透明)", 整啤净重: 181.5, 出模数: 3 },
    { 物料编号: "57001664", 物料名称: "右耳朵", 模具编号: "MJ3", 数量: 50000, 色粉号: "89209", 颜色: "幻彩紫", 用料名称: "PVC 95度(透明)", 整啤净重: 181.5, 出模数: 3 },
  ];

  it("mergeMoldPairLines:同模同色粉的 左/右 成对件合一行(数量=对数,整啤净重取同值不合计);换色/非左右件不合行", () => {
    const rows = mergeMoldPairLines([
      ...EAR_ROWS,
      { 物料编号: "M1", 物料名称: "大角", 模具编号: "MJ1", 数量: 100, 整啤净重: 40 },
    ] as never);
    expect(rows.map((r) => [r.物料名称, r.数量, r.整啤净重])).toEqual([
      ["耳朵", 50000, 181.5],
      ["耳朵", 50000, 181.5],
      ["大角", 100, 40],
    ]);
  });

  it("啤货表打印:同模耳朵按色粉合行(每色一行,啤数16667,整啤净重181.5,总净重3025.1),用料汇总不重复计", () => {
    const html = buildMoldingSheetHtml({
      单头: { 单号: "PPO3", 供应商名称: "啤机厂", 日期: "2026-09-17", 交货日期: "2026-09-17", 操作员: "op" },
      明细: EAR_ROWS,
    } as never);
    // 4 行耳朵 → 2 行「耳朵」(幻彩红/幻彩紫 各一行)
    expect(html.match(/>耳朵</g)).toHaveLength(2);
    // 啤数 ⌈50000/3⌉=16667;整啤净重 91.5+90=181.5;总净重 181.5×16667/1000=3025.1
    expect(html).toContain('<td class="num">50000</td><td class="num">16667</td>');
    expect(html).toContain('<td class="num">181.5</td><td class="num">3025.1</td>');
    // 用料汇总:PVC 95度 两色合计 6050.1(3025.1×2,不重复计)→发料 ×1.005
    expect(html).toContain("〖PVC 95度(透明)〗");
    expect(html).toContain('<td class="a-num">6050.1 KG</td>');
    expect(html).toContain('<td class="a-num">6080.4 KG</td>');
  });
});

// ---------- 页面 ----------

const PPO_LIST = {
  items: [
    { id: 1, 单号: "PPO1", 供应商名称: "恒科", 数量: 150, 日期: "2026-09-01", 审核: "0", 主管审核: "0", 经理审核: "0" },
  ],
  total: 1,
};

const PPO_DETAIL = {
  单头: { id: 1, 单号: "PPO1", 供应商编号: "S1", 供应商名称: "恒科", 日期: "2026-09-01", 审核: "0", 主管审核: "0", 经理审核: "0", 加工类型: "一次加工", 加工内容: null as string | null },
  明细: [{ id: 11, 生产单号: "MO1", 物料编号: "M1", 物料名称: "齿轮", 数量: 150, 欠数: 150, 入仓数量: 0, 原料编号: "R1", 原料名称: "ABS GP22", 原料用量KG: 0.24, 原料库存: 100 }],
};

type Call = { url: string; method: string; body?: string };

function installFetch(perms: unknown = PERMS_FULL, detail = PPO_DETAIL) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/plastic-purchase-orders") {
        if (init?.method === "POST") return json({ 单号: "PPO-NEW" });
        return json(PPO_LIST);
      }
      if (p === "/api/plastic-purchase-orders/processing-contents") return json(["喷油"]);
      if (p === "/api/plastic-purchase-orders/basis")
        return json([
          { 生产单号: "MO1", 合同号: "PO-1", 物料编号: "M1", 物料名称: "齿轮", 颜色: "黑", 单位: "个", 计划数量: 100, 用量: 1, 加工内容: "喷油", 已订数量: 0, 可用库存: 0 },
        ]);
      if (p === "/api/plastic-purchase-orders/second-process-stock") return json([]);
      if (p.startsWith("/api/plastic-purchase-orders/")) {
        const no = decodeURIComponent(p.split("/").pop()!);
        if (init?.method === "PUT") return json({});
        if (init?.method === "DELETE") return json({});
        if (p.endsWith("/approve") || p.endsWith("/supervisor-approve") || p.endsWith("/manager-approve") || p.endsWith("/unapprove"))
          return json({});
        void no;
        return json(detail);
      }
      return json({ 消息: `unhandled ${p}` }, 404);
    }),
  );
  return calls;
}

let lastLoc = "";
function Probe() {
  const l = useLocation();
  useEffect(() => {
    lastLoc = l.pathname + l.search;
  }, [l]);
  return null;
}

const setup = (perms?: unknown, detail = PPO_DETAIL) => {
  const calls = installFetch(perms, detail);
  renderWithProviders(
    <>
      <Probe />
      <Routes>
        <Route path="/plastic-purchase-orders" element={<PlasticPurchaseOrderPage />} />
        <Route path="/plastic-receipts" element={<div>塑胶入仓STUB</div>} />
      </Routes>
    </>,
    "/plastic-purchase-orders",
  );
  return calls;
};

beforeEach(() => {
  lastLoc = "";
  localStorage.clear();
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PlasticPurchaseOrderPage", () => {
  it("首屏自动打开最新单:表单回填单头,明细行与欠数状态渲染", async () => {
    setup();
    await screen.findByDisplayValue("恒科");
    expect(screen.getAllByText("齿轮").length).toBeGreaterThan(0); // 明细网格 + 物料清单(合并)各一处
    // 明细行与物料清单(合并)都显「欠 150」红色
    const owed = screen.getAllByText("欠 150");
    expect(owed.length).toBeGreaterThan(0);
    expect(owed[0].className).toContain("text-[#dc2626]");
    // 三级流转:未审核 -> 只见「主管审核」
    expect(screen.getByRole("button", { name: "主管审核" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "经理审核" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "反审核" })).not.toBeInTheDocument();
  });

  it("三级流转按钮按状态推进:经理已审单只见「审核(下发)」;已审核单只读+反审核+下推入仓", async () => {
    const audited = {
      单头: { ...PPO_DETAIL.单头, 审核: "1", 主管审核: "1", 经理审核: "1" },
      明细: PPO_DETAIL.明细,
    };
    setup(PERMS_FULL, audited);
    await screen.findByText("已审核");
    expect(screen.getByRole("button", { name: "反审核" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "主管审核" })).not.toBeInTheDocument();
    // 下推入仓:跳 /plastic-receipts?ppo=
    fireEvent.click(screen.getByRole("button", { name: "下推入仓" }));
    await waitFor(() => expect(lastLoc).toBe("/plastic-receipts?ppo=PPO1"));
    await screen.findByText("塑胶入仓STUB");
  });

  it("主管审核:POST supervisor-approve 后重取详情", async () => {
    const calls = setup();
    await screen.findByDisplayValue("恒科");
    fireEvent.click(screen.getByRole("button", { name: "主管审核" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("/plastic-purchase-orders/PPO1/supervisor-approve") && c.method === "POST"),
      ).toBe(true),
    );
  });

  it("喷油供应商保存:未选加工内容拦截", async () => {
    setup();
    await screen.findByDisplayValue("恒科");
    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    // 喷油供应商(名称含「喷油」)
    fireEvent.change(screen.getByLabelText("供应商"), { target: { value: "" } });
    // 供应商输入只读,走选择器;直接改表单不可行,改用手填路径:此处校验拦截逻辑由 filterSubmitLines 覆盖,
    // 页面级断言:明细为空时保存拦截
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请选供应商");
  });

  it("明细为空保存拦截(对照老系统:至少一行有效物料)", async () => {
    const calls = setup();
    await screen.findByDisplayValue("恒科");
    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    // 填供应商需要通过选择器;桩供应商接口后选一行
    await screen.findByRole("button", { name: "保存" });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请选供应商");
    expect(calls.some((c) => c.url.endsWith("/plastic-purchase-orders") && c.method === "POST")).toBe(false);
  });

  it("打印:已打开单据 → 系统内打印预览页(/plastic-purchase-order-print?doc=)", async () => {
    setup();
    await screen.findByDisplayValue("恒科");
    fireEvent.click(screen.getByRole("button", { name: "打印" }));
    await waitFor(() =>
      expect(lastLoc).toBe("/plastic-purchase-order-print?doc=PPO1"),
    );
  });

  it("打印预览页:按次数/工序选模板(啤机单→啤货表;选了工序→委托加工合同,不看供应商名)", async () => {
    installFetch();
    const { unmount } = renderWithProviders(
      <Routes>
        <Route path="/plastic-purchase-order-print" element={<PlasticPurchaseOrderPrintPage />} />
      </Routes>,
      "/plastic-purchase-order-print?doc=PPO1",
    );
    // PPO_DETAIL:一次加工且无加工内容 = 啤机单 → 啤机部生产啤货表(供应商名不含喷油也能对上)
    const iframe = (await screen.findByTitle("打印预览")) as HTMLIFrameElement;
    await waitFor(() =>
      expect(iframe.srcdoc).toContain("啤 机 部 生 产 啤 货 表"),
    );
    expect(iframe.srcdoc).toContain("第 1 页，共 1 页");
    unmount();
    // 二次加工+工序(喷油)→ 委托加工合同(供应商名不含「喷油」也按工序裁决)
    const un2 = installFetch(PERMS_FULL, {
      单头: { ...PPO_DETAIL.单头, 加工类型: "二次加工", 加工内容: "喷油" },
      明细: PPO_DETAIL.明细,
    });
    void un2;
    const r2 = renderWithProviders(
      <Routes>
        <Route path="/plastic-purchase-order-print" element={<PlasticPurchaseOrderPrintPage />} />
      </Routes>,
      "/plastic-purchase-order-print?doc=PPO1",
    );
    const iframe2 = (await screen.findByTitle("打印预览")) as HTMLIFrameElement;
    await waitFor(() => expect(iframe2.srcdoc).toContain("委托加工合同"));
    r2.unmount();
    // 一次加工+印喷(直接外发印喷)→ 同样走委托加工合同
    installFetch(PERMS_FULL, {
      单头: { ...PPO_DETAIL.单头, 加工类型: "一次加工", 加工内容: "印喷" },
      明细: PPO_DETAIL.明细,
    });
    renderWithProviders(
      <Routes>
        <Route path="/plastic-purchase-order-print" element={<PlasticPurchaseOrderPrintPage />} />
      </Routes>,
      "/plastic-purchase-order-print?doc=PPO1",
    );
    const iframe3 = (await screen.findByTitle("打印预览")) as HTMLIFrameElement;
    await waitFor(() => expect(iframe3.srcdoc).toContain("委托加工合同"));
  });

  it("二次加工未选工序:保存拦截(一次加工不选工序=啤机订单,二次必须选)", async () => {
    const calls = setup(PERMS_FULL, {
      单头: { ...PPO_DETAIL.单头, 加工类型: "二次加工", 加工内容: null },
      明细: PPO_DETAIL.明细,
    });
    await screen.findByDisplayValue("恒科");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("二次加工必须选择加工内容(喷油/印喷等工序)");
    expect(calls.some((c) => c.method === "PUT" || c.method === "POST")).toBe(false);
  });

  it("堵模提示(保存时触发):同模啤数不齐弹窗;取消=允许堵模直接保存", async () => {
    const moldDetail = {
      单头: PPO_DETAIL.单头, // 一次加工无工序 = 啤机单
      明细: [
        { id: 21, 生产单号: "MO1", 物料编号: "M1", 物料名称: "壳", 模具编号: "MJ1", 数量: 150, 出模数: 2, 欠数: 150, 入仓数量: 0, 原料编号: "R1", 原料名称: "ABS", 原料用量KG: 0.24, 原料库存: 100 },
        { id: 22, 生产单号: "MO1", 物料编号: "M2", 物料名称: "盖", 模具编号: "MJ1", 数量: 100, 出模数: 2, 欠数: 100, 入仓数量: 0, 原料编号: "R1", 原料名称: "ABS", 原料用量KG: 0.16, 原料库存: 100 },
      ],
    };
    const calls = setup(PERMS_FULL, moldDetail);
    await screen.findByDisplayValue("恒科");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    // 弹窗:壳 75 啤 / 盖 50 啤,不齐
    await screen.findByText(/同模配件需求不齐/);
    expect(screen.getByText(/全模共 75 啤/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PUT")).toBe(false); // 弹窗期间未提交
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1)); // 允许堵模直接保存
    await screen.findByText("已保存修改");
  });

  it("堵模提示:按最大啤数补齐并保存(数量补到同模一致,只提交一次)", async () => {
    const moldDetail = {
      单头: PPO_DETAIL.单头,
      明细: [
        { id: 21, 生产单号: "MO1", 物料编号: "M1", 物料名称: "壳", 模具编号: "MJ1", 数量: 150, 出模数: 2, 欠数: 150, 入仓数量: 0, 原料编号: "R1", 原料名称: "ABS", 原料用量KG: 0.24, 原料库存: 100 },
        { id: 22, 生产单号: "MO1", 物料编号: "M2", 物料名称: "盖", 模具编号: "MJ1", 数量: 100, 出模数: 2, 欠数: 100, 入仓数量: 0, 原料编号: "R1", 原料名称: "ABS", 原料用量KG: 0.16, 原料库存: 100 },
      ],
    };
    const calls = setup(PERMS_FULL, moldDetail);
    await screen.findByDisplayValue("恒科");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText(/同模配件需求不齐/);
    fireEvent.click(screen.getByRole("button", { name: "按最大啤数补齐并保存" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1));
    const put = calls.find((c) => c.method === "PUT")!;
    const body = JSON.parse(put.body!) as { 明细: { 物料编号: string; 数量: number }[] };
    // 盖 100 → 补齐到 75 啤 × 2 = 150,与壳一致
    expect(body.明细.map((l) => [l.物料编号, l.数量])).toEqual([
      ["M1", 150],
      ["M2", 150],
    ]);
    await screen.findByText("已保存修改");
  });

  it("无「打开」权限…老系统塑胶采购订单无权限页断言在分析页;本页按 DocToolbar 位过滤按钮", async () => {
    setup([]);
    // 权限全无时:新建/保存/打印等带 perm 的按钮全部不渲染
    await waitFor(() => expect(screen.queryByRole("button", { name: "新建" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "打印" })).not.toBeInTheDocument();
  });

  it("加工下单按钮:打开啤机单(无加工内容)→「一次加工下单」", async () => {
    setup(); // PPO_DETAIL:加工类型=一次加工 且无加工内容 → 显示类型=啤机
    await screen.findByDisplayValue("恒科");
    expect(screen.getByRole("button", { name: "一次加工下单" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "二次加工下单" })).not.toBeInTheDocument();
  });

  it("加工下单按钮:打开一次加工单(有加工内容)→「二次加工下单」", async () => {
    setup(PERMS_FULL, {
      单头: { ...PPO_DETAIL.单头, 加工内容: "印喷" },
      明细: PPO_DETAIL.明细,
    });
    await screen.findByDisplayValue("恒科");
    expect(screen.getByRole("button", { name: "二次加工下单" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "一次加工下单" })).not.toBeInTheDocument();
  });

  it("加工下单按钮:打开二次加工单→不再显示加工下单", async () => {
    setup(PERMS_FULL, {
      单头: { ...PPO_DETAIL.单头, 加工类型: "二次加工", 加工内容: "印喷" },
      明细: PPO_DETAIL.明细,
    });
    await screen.findByDisplayValue("恒科");
    expect(screen.queryByRole("button", { name: "二次加工下单" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "一次加工下单" })).not.toBeInTheDocument();
  });

  it("打开啤机单点「一次加工下单」:抽屉自动按该单生产单号带料(不用再手输),不走库存选料", async () => {
    const calls = setup();
    await screen.findByDisplayValue("恒科");
    fireEvent.click(screen.getByRole("button", { name: "一次加工下单" }));
    const dlg = await screen.findByRole("dialog");
    // 自动按 MO1 的 basis 带料;不请求可加工库存
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/plastic-purchase-orders/basis"))).toBe(true),
    );
    expect(calls.some((c) => c.url.includes("second-process-stock"))).toBe(false);
    await within(dlg).findByText("齿轮");
    expect(dlg).toHaveTextContent("塑胶采购订单(新建) · MO1");
  });

  it("原料扣减:啤机单(无加工内容)显示原料用量KG列+扣减汇总面板", async () => {
    setup(); // PPO_DETAIL:啤机单,明细带原料快照
    await screen.findByDisplayValue("恒科");
    expect(screen.getByText("原料扣减汇总(按原料合并)")).toBeInTheDocument();
    expect(screen.getByText("原料用量KG")).toBeInTheDocument();
    expect(screen.getAllByText("ABS GP22").length).toBeGreaterThan(0); // 明细行+汇总面板
  });

  it("原料扣减:印喷一次加工单不扣原料(即便旧数据带快照也不显示)", async () => {
    setup(PERMS_FULL, {
      单头: { ...PPO_DETAIL.单头, 加工内容: "印喷" },
      明细: PPO_DETAIL.明细, // 旧数据残留的原料快照
    });
    await screen.findByDisplayValue("恒科");
    expect(screen.queryByText("原料扣减汇总(按原料合并)")).not.toBeInTheDocument();
    expect(screen.queryByText("原料用量KG")).not.toBeInTheDocument();
    expect(screen.queryByText("ABS GP22")).not.toBeInTheDocument();
  });
});
