// 排期导入纯函数:逐条移植老系统 web/src/__tests__/schedulingImport.test.ts 场景,
// 被测实现 web2/src/lib/schedulingImport.ts(照抄 web/src/utils/schedulingImport.ts)
import { describe, expect, it } from "vitest";
import {
  cellToDate,
  findScheduleHeaderRowIndex,
  guessScheduleCustomer,
  normScheduleHeader,
  parseScheduleGrid,
  statusFromSheetName,
} from "@/lib/schedulingImport";

describe("排期导入:表头归一化与别名", () => {
  it("去空白/换行/全角括号/#/.,转小写", () => {
    expect(normScheduleHeader("PO数量\n(pcs)")).toBe("po数量(pcs)");
    expect(normScheduleHeader("Cust. PO NO.")).toBe("custpono");
    expect(normScheduleHeader("货号#")).toBe("货号");
    expect(normScheduleHeader("ZURU验货\n日期")).toBe("zuru验货日期");
  });

  it("客PO期 是走货期别名,不会误判为客PO", () => {
    const grid = [
      ["接单期", "国家/客名", "Customer", "PO号", "货号", "数量", "客PO期", "计划验货期"],
      ["2026-06-23", "ROSS", "60308543", "1053032", "18060", "6000", "2026-09-25", "2026-09-18"],
    ];
    const r = parseScheduleGrid(grid, "排期");
    expect(r.hasHeader).toBe(true);
    expect(r.rows[0].客PO).toBe("60308543");
    expect(r.rows[0].PO号).toBe("1053032");
    expect(r.rows[0].走货期).toBe("2026-09-25");
    expect(r.rows[0].验货期).toBe("2026-09-18");
  });
});

describe("排期导入:工作表名推定状态", () => {
  it("取消→已取消,走货→已走货,其余→在排", () => {
    expect(statusFromSheetName("取消单")).toBe("已取消");
    expect(statusFromSheetName("取消订单")).toBe("已取消");
    expect(statusFromSheetName("已走货")).toBe("已走货");
    expect(statusFromSheetName("总排期")).toBe("在排");
    expect(statusFromSheetName("总接单")).toBe("在排");
  });
});

describe("排期导入:表头定位", () => {
  it("跳过压在表头之上的标题行(TOMY 总接单格式)", () => {
    const grid = [
      ["产品名称", "", "", "", "", "", ""],
      ["接单日期", "国家", "Tomy PO", "Cust. PO NO.", "货号", "数量", "PO走货期"],
      ["2025-11-06", "比利时", "10114426", "4500031933", "47280A", "290", "2026-01-21"],
    ];
    expect(findScheduleHeaderRowIndex(grid)).toBe(1);
    const r = parseScheduleGrid(grid, "总接单");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].接单日期).toBe("2025-11-06");
    expect(r.rows[0].PO号).toBe("10114426");
    expect(r.rows[0].客PO).toBe("4500031933");
    expect(r.rows[0].货号).toBe("47280A");
    expect(r.rows[0].数量).toBe(290);
    expect(r.rows[0].走货期).toBe("2026-01-21");
    expect(r.rows[0].错误).toBeUndefined();
  });

  it("命中别名不足 3 列的工作表不当作排期表", () => {
    const grid = [
      ["货号", "产品名称", "外箱", "车间"],
      ["47329", "收割车", "2", "A"],
    ];
    expect(findScheduleHeaderRowIndex(grid)).toBe(-1);
    expect(parseScheduleGrid(grid, "名称").hasHeader).toBe(false);
  });
});

describe("排期导入:行解析", () => {
  const zuru = [
    ["接单期", "第三方客户名称", "走货国家", "PO号", "客PO", "SKU", "系统货号", "中文名",
     "PO数量\n(pcs)", "内箱装箱数量(pcs)", "外箱装箱数量(pcs)", "总箱数", "ZURU订单走货日期", "ZURU验货\n日期", "第三方客户公证行验货"],
    ["2024-11-05", "THE ENTERTAINER", "英国", "4500150146", "FB12137", "4500150146-1", "77625GQ1-S00", "迷你车仔",
     "8008", "0", "52", "154", "2025-01-06", "2025-01-02", ""],
  ];

  it("ZURU 总排期整行映射", () => {
    const r = parseScheduleGrid(zuru, "总排期");
    expect(r.hasHeader).toBe(true);
    const row = r.rows[0];
    expect(row.状态).toBe("在排");
    expect(row.来源工作表).toBe("总排期");
    expect(row.接单日期).toBe("2024-11-05");
    expect(row.客户名称).toBe("THE ENTERTAINER");
    expect(row.国家).toBe("英国");
    expect(row.PO号).toBe("4500150146");
    expect(row.客PO).toBe("FB12137");
    expect(row.SKU).toBe("4500150146-1");
    expect(row.货号).toBe("77625GQ1-S00");
    expect(row.品名).toBe("迷你车仔");
    expect(row.数量).toBe(8008);
    expect(row.内箱).toBe(0);
    expect(row.外箱).toBe(52);
    expect(row.总箱数).toBe(154);
    expect(row.走货期).toBe("2025-01-06");
    expect(row.验货期).toBe("2025-01-02");
    expect(row.错误).toBeUndefined();
  });

  it("标识列全空 → 错误行(多为合计/备注行);数量等列解析失败不报错,原值打包进备注", () => {
    const bad = parseScheduleGrid([zuru[0], ["2024-11-05", "", "", "", "", "", "", "无名", "10"]], "总排期");
    expect(bad.rows[0].错误).toBe("货号/PO号/客PO 不能都为空");
    const soft = parseScheduleGrid([zuru[0], ["2024-11-05", "", "", "PO1", "", "", "H1", "", "若干"]], "总排期");
    expect(soft.rows[0].错误).toBeUndefined();
    expect(soft.rows[0].数量).toBeUndefined();
    expect(soft.rows[0].备注).toContain("PO数量");
    expect(soft.rows[0].备注).toContain("若干");
  });

  it("取消订单表的别名表头(香港接单日期/ZURU PO NO#/第三方客户 PO NO#)", () => {
    const grid = [
      ["香港接单日期", "第三方客户名称", "走货国家", "ZURU PO NO#", "第三方客户\n PO NO#", "系统货号", "PO数量\n(pcs)", "总箱数", "ZURU订单走货日期"],
      ["2021-11-09", "Amazon CA", "加拿大", "ZP123", "1SYDZSII", "7759GQ2-S00", "2400", "已取消", "2021-12-14"],
    ];
    const r = parseScheduleGrid(grid, "取消订单");
    expect(r.状态).toBe("已取消");
    const row = r.rows[0];
    expect(row.错误).toBeUndefined();
    expect(row.接单日期).toBe("2021-11-09");
    expect(row.PO号).toBe("ZP123");
    expect(row.客PO).toBe("1SYDZSII");
    expect(row.数量).toBe(2400);
    expect(row.总箱数).toBeUndefined(); // "已取消"不是数字 -> 打包进备注
    expect(row.备注).toContain("总箱数:已取消");
  });

  it("临时/筛选副本工作表直接跳过", () => {
    const r = parseScheduleGrid(zuru, "Sheet4");
    expect(r.hasHeader).toBe(false);
    expect(r.跳过).toBe(true);
    expect(parseScheduleGrid(zuru, "导出筛选结果").跳过).toBe(true);
  });

  it("老式 xls 表头(订单PO.NO/ITEM NO/客户名称(第三方…)/第三方验货期)与已出货状态", () => {
    const grid = [
      ["香港接单日期", "客户名称\n（第三方客户）", "国家", "订单PO.NO", "ITEM NO", "名称", "数量", "装箱数", "总箱数", "客PO期", "计划验货期", "第三方\n验货期"],
      ["Tue Jul 07", "", "US", "CF20260707", "A001", "欧姆灯", "4200", "1", "4200", "Fri Sep 04", "", ""],
    ];
    const r = parseScheduleGrid(grid, "已出货", 2026);
    expect(r.hasHeader).toBe(true);
    expect(r.状态).toBe("已走货");
    const row = r.rows[0];
    expect(row.错误).toBeUndefined();
    expect(row.接单日期).toBe("2026-07-07");
    expect(row.PO号).toBe("CF20260707");
    expect(row.货号).toBe("A001");
    expect(row.品名).toBe("欧姆灯");
    expect(row.数量).toBe(4200);
    expect(row.走货期).toBe("2026-09-04");
  });

  it("空行跳过;未映射列打包进备注(换行压缩为空格)", () => {
    const grid = [
      ["接单期", "PO号", "货号", "数量", "走货期", "柜型"],
      ["", "", "", "", "", ""],
      ["2026-01-01", "P1\nA", "H1", "100", "2026-03-01", "40HQ"],
    ];
    const r = parseScheduleGrid(grid, "排期");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].PO号).toBe("P1 A");
    expect(r.rows[0].备注).toBe("柜型:40HQ");
  });

  it("万全兜底:整行原始数据全量保留(含未映射列与空表头列)", () => {
    const grid = [
      ["接单期", "货号", "数量", "柜型", ""],
      ["2026-01-01", "H1", "100", "40HQ", "尾列值"],
    ];
    const r = parseScheduleGrid(grid, "排期");
    const raw = r.rows[0].原始数据!;
    expect(raw["柜型"]).toBe("40HQ"); // 未映射列
    expect(raw["货号"]).toBe("H1"); // 已映射列也在原文里
    expect(raw["列5"]).toBe("尾列值"); // 空表头列
  });

  it("日期单元格:Date 对象 / 序列号 / 斜杠串", () => {
    expect(cellToDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(cellToDate(46027)).toBe("2026-01-05"); // Excel 序列号
    expect(cellToDate("2026/1/5")).toBe("2026-01-05");
    expect(cellToDate("2026-01-05 0:00:00")).toBe("2026-01-05");
    expect(cellToDate("")).toBeUndefined();
    expect(cellToDate("待定")).toBeUndefined();
  });

  it("英文日期:带年份 / 无年份用默认年份 / 无效月份日界线拒绝", () => {
    expect(cellToDate("Wed Apr 01 2026 23:59")).toBe("2026-04-01");
    expect(cellToDate("Tue Jul 07", 2026)).toBe("2026-07-07");
    expect(cellToDate("Fri Sep 04", 2026)).toBe("2026-09-04");
    expect(cellToDate("Wed Apr 01 2026 23:59")).not.toBe("2026-23-59"); // 不误配末尾时间
    expect(cellToDate("Foo Xx 99", 2026)).toBeUndefined();
  });

  it("中英双写表头(Just Play/SPIN 格式):最长前缀匹配", () => {
    const grid = [
      ["来单日期\nOrder", "客名 \nCustom", "PO客人\n", "客PO", "订单PO.NO（合同号）", "货号\n(Item no)", "产品名称 \nProd", "数量 \nQuantity", "计划PO出货期\nPlanned", "计划验货期Planned"],
      ["Fri Apr 17", "Spin Master", "DOM USMS", "4500696480", "4500697416", "31771/1098", "5寸懒蛋蛋", "1488", "Thu Sep 10", "Thu Sep 03"],
    ];
    const r = parseScheduleGrid(grid, "接单总排期", 2026);
    expect(r.hasHeader).toBe(true);
    const row = r.rows[0];
    expect(row.错误).toBeUndefined();
    expect(row.接单日期).toBe("2026-04-17");
    expect(row.客户名称).toBe("DOM USMS");
    expect(row.客PO).toBe("4500696480");
    expect(row.PO号).toBe("4500697416");
    expect(row.货号).toBe("31771/1098");
    expect(row.品名).toBe("5寸懒蛋蛋");
    expect(row.数量).toBe(1488);
    expect(row.走货期).toBe("2026-09-10");
    expect(row.验货期).toBe("2026-09-03");
  });

  it("精确匹配优先:客PO期不会被前缀规则误判为客PO", () => {
    const grid = [
      ["接单期", "货号", "数量", "客PO期"],
      ["2026-06-23", "18060", "6000", "2026-09-25"],
    ];
    const r = parseScheduleGrid(grid, "排期");
    expect(r.rows[0].客PO).toBeUndefined();
    expect(r.rows[0].走货期).toBe("2026-09-25");
  });

  it("Lifelines/Tokidos 格式:描述=客户名、Cust. PO N、ITEM、货名、计划走货期", () => {
    const grid = [
      ["接单日期", "客户名称（第三方）", "国家", "描述", "Cust. PO N", "ITEM", "货名", "数量", "内箱数量", "总装箱数", "总箱数", "计划验货期", "确定验货期", "船期SO", "计划走货期"],
      ["Thu Dec 25", "", "美国", "FlowCrafts", "VPO2025105", "167006", "玻璃灯", "5004", "4", "12", "417", "Thu Feb 05", "", "", "Sun Feb 08"],
    ];
    const r = parseScheduleGrid(grid, "总排期", 2026);
    expect(r.hasHeader).toBe(true);
    const row = r.rows[0];
    expect(row.错误).toBeUndefined();
    expect(row.接单日期).toBe("2026-12-25"); // 无年份日期取文件年份(跨年末行的接单年可能偏差一年,走货/验货期不受影响)
    expect(row.客户名称).toBe("FlowCrafts");
    expect(row.客PO).toBe("VPO2025105");
    expect(row.货号).toBe("167006");
    expect(row.品名).toBe("玻璃灯");
    expect(row.数量).toBe(5004);
    expect(row.内箱).toBe(4);
    expect(row.外箱).toBe(12);
    expect(row.总箱数).toBe(417);
    expect(row.验货期).toBe("2026-02-05");
    expect(row.走货期).toBe("2026-02-08");
  });
});

describe("排期导入:从文件名猜排期客户", () => {
  it("去年份/排期/日期尾缀", () => {
    expect(guessScheduleCustomer("2026年ZURU总生产排期.xlsx1.xlsx")).toBe("ZURU");
    expect(guessScheduleCustomer("2026年TOMY东莞排期8-15.xlsx")).toBe("TOMY东莞");
    expect(guessScheduleCustomer("2026年接单John Adams排期表8-15.xls")).toBe("John Adams");
    expect(guessScheduleCustomer("2026年MOOSE排期8-15.xlsx")).toBe("MOOSE");
  });
});
