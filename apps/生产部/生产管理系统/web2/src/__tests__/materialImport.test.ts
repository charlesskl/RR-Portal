import { describe, expect, it } from "vitest";
import {
  findHeaderRowIndex, parseMaterialGrid, MATERIAL_IMPORT_SPEC, PLASTIC_IMPORT_SPEC,
} from "@/lib/materialImport";

// 模拟 sheet_to_json(header:1, raw:true) 的二维数组
const 来料表头 = ["", "物料编号", "货号", "物料名称", "规格", "材料", "颜色", "单位", "单价", "仓库位置", "备注", "最低库存", "货币"];
const 塑胶表头 = ["", "物料编号", "客户", "塑胶货号", "工模编号", "物料名称", "颜色", "色粉号", "原料名称", "用料名称", "加工内容", "加工总单价(HKD)", "二次加工", "二次加工价", "整啤净重", "原胶件单净重", "整啤模腔数", "套数", "出模数", "用量", "啤机机型", "模具日产量", "啤机价钱", "胶件啤工价", "原料单价", "胶件料价", "原胶件单价", "备注", "其他成本"];

describe("findHeaderRowIndex", () => {
  it("跳过第 1 行合并标题,定位含物料编号的表头行", () => {
    const grid = [["物 料 档 案 资 料"], 来料表头, [1, "01030008"]];
    expect(findHeaderRowIndex(grid)).toBe(1);
  });

  it("没有表头行返回 -1", () => {
    expect(findHeaderRowIndex([["a", "b"], ["c", "d"]])).toBe(-1);
  });
});

describe("parseMaterialGrid 来料", () => {
  it("按表头列名映射,材料合并进备注,数字列解析", () => {
    const grid = [
      ["物 料 档 案 资 料"],
      来料表头,
      [1, "01030008", "", "PB螺丝", "2.6*6PB", "铁", "镀兰锌", "PCS", 0.0045, "", "", "", ""],
      [2, "01030026", "H-01", "PWB螺丝", "2.6*8PWB", "铁", "镀兰锌", "PCS", "0.0125", "A01", "常用", 100, "HKD"],
    ];
    const { hasHeader, rows } = parseMaterialGrid(grid, MATERIAL_IMPORT_SPEC);
    expect(hasHeader).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      行号: 3,
      数据: {
        物料编号: "01030008", 物料名称: "PB螺丝", 规格: "2.6*6PB", 颜色: "镀兰锌",
        单位: "PCS", 单价: 0.0045, 备注: "材料:铁",
      },
    });
    expect(rows[1].数据).toMatchObject({
      物料编号: "01030026", 货号: "H-01", 单价: 0.0125, 仓库位置: "A01",
      最低库存: 100, 货币: "HKD", 备注: "常用;材料:铁",
    });
  });

  it("表头乱序/缺列仍按列名映射", () => {
    const grid = [
      ["物料名称", "物料编号", "单价"],
      ["彩盒", "MAT-1", 1.5],
    ];
    const { rows } = parseMaterialGrid(grid, MATERIAL_IMPORT_SPEC);
    expect(rows[0].数据).toEqual({ 物料名称: "彩盒", 物料编号: "MAT-1", 单价: 1.5 });
  });

  it("物料编号为空(合计行)标记错误行", () => {
    const grid = [来料表头, [289, "", "", "合 计", "", "", "", "", "", "", "", "", ""]];
    const { rows } = parseMaterialGrid(grid, MATERIAL_IMPORT_SPEC);
    expect(rows[0]).toMatchObject({ 行号: 2, 错误: "物料编号为空" });
  });

  it("单价非数字标记错误行", () => {
    const grid = [来料表头, [1, "A1", "", "名", "", "", "", "PCS", "abc", "", "", "", ""]];
    const { rows } = parseMaterialGrid(grid, MATERIAL_IMPORT_SPEC);
    expect(rows[0]).toMatchObject({ 错误: "单价不是数字", 数据: { 物料编号: "A1" } });
  });

  it("整行空白跳过", () => {
    const grid = [来料表头, [1, "A1"], Array(13).fill(""), [2, "A2"]];
    const { rows } = parseMaterialGrid(grid, MATERIAL_IMPORT_SPEC);
    expect(rows.map(r => r.数据.物料编号)).toEqual(["A1", "A2"]);
  });
});

describe("parseMaterialGrid 塑胶", () => {
  const 数据行 = [
    1, "57001896", "ZURU", "77772", "MNVN-05M-01", "唱盘CD", "黑色", "7726", "ABS", "ABS GP22",
    "", "", "", "", 12.9, 1.6, 8, 8, 8, 1, "10A", 3400, 1160, 0.0426, 0.0163, 0.0261, 0.0687, "", "",
  ];

  it("表头映射到真实字段,塑胶货号→款号,原胶件单价→单价,默认 单位/货币", () => {
    const grid = [["塑 胶 物 料 资 料"], 塑胶表头, 数据行];
    const { rows } = parseMaterialGrid(grid, PLASTIC_IMPORT_SPEC);
    expect(rows).toHaveLength(1);
    expect(rows[0].行号).toBe(3);
    expect(rows[0].错误).toBeUndefined();
    expect(rows[0].数据).toEqual({
      物料编号: "57001896", 客户: "ZURU", 款号: "77772", 工模编号: "MNVN-05M-01",
      物料名称: "唱盘CD", 颜色: "黑色", 色粉号: "7726", 原料名称: "ABS", 用料名称: "ABS GP22",
      整啤净重: 12.9, 原胶件单净重: 1.6, 整啤模腔数: 8, 套数: 8, 出模数: 8, 用量: 1,
      啤机机型: "10A", 模具日产量: 3400, 啤机价钱: 1160, 胶件啤工价: 0.0426,
      原料单价: 0.0163, 胶件料价: 0.0261, 单价: 0.0687,
      单位: "个", 货币: "HKD",
    });
  });

  it("加工总单价(HKD) 表头归一化后映射到 加工总单价", () => {
    const with加工 = [...数据行];
    with加工[11] = 0.09;
    const { rows } = parseMaterialGrid([塑胶表头, with加工], PLASTIC_IMPORT_SPEC);
    expect(rows[0].数据.加工总单价).toBe(0.09);
  });

  it("备注列与仍无法映射的列维持打包(备注内容最前)", () => {
    const 表头 = [...塑胶表头, "批次"];
    const with备注 = [...数据行, "B-01"];
    with备注[27] = "急单";
    const { rows } = parseMaterialGrid([表头, with备注], PLASTIC_IMPORT_SPEC);
    expect(rows[0].数据.备注).toBe("急单;批次:B-01");
  });

  it("序号列与空表头列不参与打包,无未映射非空列时备注为空", () => {
    const grid = [["序号", "物料编号", "客户"], [1, "P1", "ZURU"]];
    const { rows } = parseMaterialGrid(grid, PLASTIC_IMPORT_SPEC);
    expect(rows[0].数据.客户).toBe("ZURU");
    expect(rows[0].数据.备注).toBeUndefined();
  });
});
