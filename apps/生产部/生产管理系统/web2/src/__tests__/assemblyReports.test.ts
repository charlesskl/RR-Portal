// 装配部报表群查询参数构建与进度映射(对照老系统 web/src/__tests__/assemblyMaterialTracking.test.ts、
// assemblyFactoryInventory.test.ts、assemblyRequiredMaterials.test.ts、assemblyFactoryCategoryMonthly.test.ts;
// 双击跳转路径为 web2 单据路由 /assembly-purchases,旧系统为 /assembly-purchase-orders,路径不同语义一致)。
import { describe, expect, it } from "vitest";
import {
  assemblyOrderPath,
  buildFactoryCategoryMonthlyQuery,
  buildFactoryInventoryQuery,
  buildMaterialTrackingQuery,
  buildRequiredMaterialQuery,
  dueWithin3Days,
  filterAssemblyProgress,
  shiftRange,
  toAssemblyProgressRow,
  wideRange,
} from "@/lib/assemblyReports";

describe("装配物料跟踪表参数与跳转", () => {
  it("归一化查询条件:全部/空值不下发,关键字 trim,截止统计透传", () => {
    expect(
      buildMaterialTrackingQuery({
        起: "2026-07-01",
        止: "2026-07-31",
        keyword: " DS241204-01 ",
        收货仓库: "全部",
        截止统计: true,
      }),
    ).toEqual({
      起: "2026-07-01",
      止: "2026-07-31",
      keyword: "DS241204-01",
      收货仓库: undefined,
      截止统计: true,
    });

    expect(
      buildMaterialTrackingQuery({
        起: "2026-07-01",
        止: "2026-07-31",
        keyword: "   ",
        收货仓库: "半成品仓",
      }),
    ).toEqual({
      起: "2026-07-01",
      止: "2026-07-31",
      keyword: undefined,
      收货仓库: "半成品仓",
      截止统计: false,
    });
  });

  it("双击行跳转到对应装配加工采购单(web2 路由)", () => {
    expect(assemblyOrderPath("ZP 12/3")).toBe("/assembly-purchases?单号=ZP%2012%2F3");
    expect(assemblyOrderPath(undefined)).toBeUndefined();
  });
});

describe("加工厂库存汇总表查询参数", () => {
  it("全部和空值不下发,日期不选择时不下发起止日期", () => {
    expect(
      buildFactoryInventoryQuery({
        启用日期: false,
        起: "2026-07-01",
        止: "2026-07-31",
        截止日期: "2026-07-08",
        加工厂: "全部",
        物料分类: "全部",
        收货仓库: "全部",
        keyword: " 01223 ",
      }),
    ).toEqual({
      启用日期: false,
      起: undefined,
      止: undefined,
      截止日期: "2026-07-08",
      加工厂: undefined,
      物料分类: undefined,
      收货仓库: undefined,
      keyword: "01223",
    });
  });

  it("日期选择时下发起止日期,具体筛选项保留", () => {
    expect(
      buildFactoryInventoryQuery({
        启用日期: true,
        起: "2026-07-01",
        止: "2026-07-31",
        截止日期: "2026-07-08",
        加工厂: "0126 邵阳市华登塑胶制品有限公司",
        物料分类: "PET",
        收货仓库: "半成品仓",
      }),
    ).toEqual({
      启用日期: true,
      起: "2026-07-01",
      止: "2026-07-31",
      截止日期: "2026-07-08",
      加工厂: "0126 邵阳市华登塑胶制品有限公司",
      物料分类: "PET",
      收货仓库: "半成品仓",
      keyword: undefined,
    });
  });
});

describe("装配需领明细表查询参数", () => {
  it("全部和空值不下发,关键字 trim,具体筛选保留", () => {
    expect(
      buildRequiredMaterialQuery({
        起: "2026-07-01",
        止: "2026-07-31",
        keyword: " SLB2601122 ",
        收货仓库: "全部",
        类型: "全部",
        审核情况: "已审核",
      }),
    ).toEqual({
      起: "2026-07-01",
      止: "2026-07-31",
      keyword: "SLB2601122",
      收货仓库: undefined,
      类型: undefined,
      审核情况: "已审核",
    });

    expect(
      buildRequiredMaterialQuery({
        起: "2026-07-01",
        止: "2026-07-31",
        keyword: "   ",
        收货仓库: "半成品仓",
        类型: "未包装半成品",
        审核情况: "全部",
      }),
    ).toEqual({
      起: "2026-07-01",
      止: "2026-07-31",
      keyword: undefined,
      收货仓库: "半成品仓",
      类型: "未包装半成品",
      审核情况: undefined,
    });
  });
});

describe("加工厂分类月报表查询参数", () => {
  it("全部和空值不下发,日期和关键字保留", () => {
    expect(
      buildFactoryCategoryMonthlyQuery({
        起: "2026-07-01",
        止: "2026-07-31",
        加工厂: "全部",
        keyword: "  华登 ",
      }),
    ).toEqual({
      起: "2026-07-01",
      止: "2026-07-31",
      加工厂: undefined,
      keyword: "华登",
    });

    expect(
      buildFactoryCategoryMonthlyQuery({
        起: "2026-07-01",
        止: "2026-07-31",
        加工厂: "0126 邵阳市华登塑胶制品有限公司",
        keyword: "   ",
      }),
    ).toEqual({
      起: "2026-07-01",
      止: "2026-07-31",
      加工厂: "0126 邵阳市华登塑胶制品有限公司",
      keyword: undefined,
    });
  });
});

describe("装配采购进度表映射与客户端过滤", () => {
  it("明细行映射为进度行:入仓数量 0,相差=订货,出货情况 未到/已到", () => {
    const owed = toAssemblyProgressRow({ 单号: "ZP1", 数量: 100, 产品装配名称: "恐龙套装" });
    expect(owed.订货数量).toBe(100);
    expect(owed.入仓数量).toBe(0);
    expect(owed.相差数量).toBe(100);
    expect(owed.出货情况).toBe("未到");
    expect(owed.订单单号).toBe("ZP1");
    expect(owed.产品名称).toBe("恐龙套装");

    const zero = toAssemblyProgressRow({ 单号: "ZP2", 数量: 0 });
    expect(zero.出货情况).toBe("已到");
  });

  it("到货情况过滤:未到/已到/全部", () => {
    const rows = [
      toAssemblyProgressRow({ 单号: "A", 数量: 10 }),
      toAssemblyProgressRow({ 单号: "B", 数量: 0 }),
    ];
    expect(filterAssemblyProgress(rows, "未到", false).map((r) => r.订单单号)).toEqual(["A"]);
    expect(filterAssemblyProgress(rows, "已到", false).map((r) => r.订单单号)).toEqual(["B"]);
    expect(filterAssemblyProgress(rows, "全部", false)).toHaveLength(2);
  });

  it("只显示3天内交货:完成日期在 [今天, 今天+3] 内", () => {
    const now = new Date(2026, 8, 17); // 2026-09-17
    expect(dueWithin3Days("2026-09-17", now)).toBe(true);
    expect(dueWithin3Days("2026-09-20", now)).toBe(true);
    expect(dueWithin3Days("2026-09-21", now)).toBe(false);
    expect(dueWithin3Days("2026-09-16", now)).toBe(false);
    expect(dueWithin3Days(undefined, now)).toBe(false);

    const rows = [
      { ...toAssemblyProgressRow({ 单号: "A", 数量: 1 }), 完成日期: "2026-09-19" },
      { ...toAssemblyProgressRow({ 单号: "B", 数量: 1 }), 完成日期: "2026-10-01" },
    ];
    expect(filterAssemblyProgress(rows, "全部", true, now).map((r) => r.订单单号)).toEqual(["A"]);
  });

  it("不选择日期的宽区间:2000-01-01 起,今天+1年 止", () => {
    const r = wideRange();
    expect(r.起).toBe("2000-01-01");
    expect(Number(r.止.slice(0, 4))).toBe(new Date().getFullYear() + 1);
  });
});

describe("日期区间工具", () => {
  it("shiftRange 整体平移月份(对照老系统 上月/下月 subtract/add 1 month)", () => {
    expect(shiftRange({ 起: "2026-08-17", 止: "2026-09-17" }, -1)).toEqual({
      起: "2026-07-17",
      止: "2026-08-17",
    });
    expect(shiftRange({ 起: "2026-08-17", 止: "2026-09-17" }, 1)).toEqual({
      起: "2026-09-17",
      止: "2026-10-17",
    });
  });
});
