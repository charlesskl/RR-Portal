import { describe, expect, it } from "vitest";
import {
  cleanMaterialCode, decodeCsvBuffer, parseBomImport, splitDelimited, validateBomImportRows,
} from "@/lib/bomImport";

describe("splitDelimited", () => {
  it("首行含 Tab 按 TSV 解析", () => {
    expect(splitDelimited("a\tb\nc\td")).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("逗号 CSV 支持引号包裹与转义", () => {
    expect(splitDelimited('"a,b","c""d"')).toEqual([["a,b", 'c"d']]);
  });

  it("引号内换行属于同一字段", () => {
    expect(splitDelimited('"x\ny",2')).toEqual([["x\ny", "2"]]);
  });

  it("CRLF 行尾正常切分", () => {
    expect(splitDelimited("a,b\r\nc,d\r\n")).toEqual([["a", "b"], ["c", "d"]]);
  });
});

describe("parseBomImport 表头映射", () => {
  it("按表头列名映射全部字段", () => {
    const text = "物料编号\t物料名称\t规格\t颜色\t单位\t使用数量\nMAT-1\t彩盒\tS\t白\t盒\t1.5";
    const { hasHeader, rows } = parseBomImport(text);
    expect(hasHeader).toBe(true);
    expect(rows).toEqual([
      { 行号: 2, 物料编号: "MAT-1", 使用数量: 1.5, 物料名称: "彩盒", 规格: "S", 颜色: "白", 单位: "盒" },
    ]);
  });

  it("兼容别名：编号/料号/物料 + 用量/用量(每PCS)/数量", () => {
    for (const [codeHead, qtyHead] of [
      ["编号", "用量"],
      ["料号", "用量(每PCS)"],
      ["物料", "数量"],
      ["物料编号", "用量（每PCS）"], // 全角括号
    ]) {
      const { hasHeader, rows } = parseBomImport(`${codeHead},${qtyHead}\nMAT-9,3`);
      expect(hasHeader).toBe(true);
      expect(rows[0]).toMatchObject({ 物料编号: "MAT-9", 使用数量: 3 });
    }
  });

  it("表头缺少使用数量列时逐行报错", () => {
    const { rows } = parseBomImport("物料编号,物料名称\nMAT-1,彩盒");
    expect(rows[0]).toMatchObject({ 物料编号: "MAT-1", 错误: "缺少使用数量列" });
  });

  it("使用数量支持分数写法(1/6=一张料出6个)", () => {
    const { rows } = parseBomImport("物料编号\t使用数量\n07020464\t1/6");
    expect(rows[0].使用数量).toBeCloseTo(1 / 6, 10);
    expect(rows[0].错误).toBeUndefined();
  });
});

describe("parseBomImport 无表头位置列", () => {
  it("第1列=物料编号、第2列=使用数量", () => {
    const { hasHeader, rows } = parseBomImport("MAT-1\t2\nMAT-2\t0.5");
    expect(hasHeader).toBe(false);
    expect(rows).toEqual([
      { 行号: 1, 物料编号: "MAT-1", 使用数量: 2 },
      { 行号: 2, 物料编号: "MAT-2", 使用数量: 0.5 },
    ]);
  });

  it("缺第2列时报数量错误", () => {
    const { rows } = parseBomImport("MAT-1");
    expect(rows[0]).toMatchObject({ 物料编号: "MAT-1", 错误: "使用数量必须为正数" });
  });
});

describe("parseBomImport 校验与清洗", () => {
  it.each(["0", "-1", "abc", ""])("使用数量 %s 无效", qty => {
    const { rows } = parseBomImport(`MAT-1\t${qty}`);
    expect(rows[0].使用数量).toBeUndefined();
    expect(rows[0].错误).toBe("使用数量必须为正数");
  });

  it("空行跳过且保留原始行号", () => {
    const { rows } = parseBomImport("MAT-1,1\n\n   \nMAT-2,2");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ 行号: 4, 物料编号: "MAT-2" });
  });

  it("物料编号去半角/全角空格", () => {
    const { rows } = parseBomImport("　MAT - 1　,2");
    expect(rows[0]).toMatchObject({ 物料编号: "MAT-1", 使用数量: 2 });
  });

  it("物料编号为空的行报错", () => {
    const { rows } = parseBomImport(",2");
    expect(rows[0].错误).toBe("物料编号为空");
  });

  it("全空文本返回空结果", () => {
    expect(parseBomImport(" \n\t\n")).toEqual({ hasHeader: false, rows: [] });
  });
});

describe("cleanMaterialCode", () => {
  it("去除所有半角/全角空白", () => {
    expect(cleanMaterialCode(" A B　C\t")).toBe("ABC");
  });
});

describe("decodeCsvBuffer", () => {
  it("UTF-8（含 BOM）正常解码", () => {
    const utf8 = new TextEncoder().encode("\uFEFF物料编号,使用数量\nMAT-1,2");
    expect(decodeCsvBuffer(utf8.buffer as ArrayBuffer)).toBe("物料编号,使用数量\nMAT-1,2");
  });

  it("非法 UTF-8 按 GBK 解码", () => {
    // "物料编号" 的 GBK 字节：物 CE EF / 料 C1 CF / 编 B1 E0 / 号 BA C5
    // "使用数量" 的 GBK 字节：使 CA B9 / 用 D3 C3 / 数 CA FD / 量 C1 BF
    const gbk = new Uint8Array([
      0xCE, 0xEF, 0xC1, 0xCF, 0xB1, 0xE0, 0xBA, 0xC5, 0x2C,
      0xCA, 0xB9, 0xD3, 0xC3, 0xCA, 0xFD, 0xC1, 0xBF, 0x0D, 0x0A,
      0x4D, 0x41, 0x54, 0x2D, 0x31, 0x2C, 0x32,
    ]);
    const text = decodeCsvBuffer(gbk.buffer as ArrayBuffer);
    expect(text).toBe("物料编号,使用数量\r\nMAT-1,2");
    const { hasHeader, rows } = parseBomImport(text);
    expect(hasHeader).toBe(true);
    expect(rows[0]).toMatchObject({ 物料编号: "MAT-1", 使用数量: 2 });
  });
});

describe("validateBomImportRows", () => {
  const master = new Map([
    ["MAT-1", { 物料编号: "MAT-1", 物料名称: "彩盒", 规格: "S", 颜色: "白", 单位: "盒" }],
  ]);
  const parsed = parseBomImport("MAT-1,1\nMAT-X,2\nMAT-BAD,0").rows;

  it("存在的行带出档案资料，不存在的行标物料不存在", () => {
    const checked = validateBomImportRows(parsed, master);
    expect(checked[0].错误).toBeUndefined();
    expect(checked[0].material).toMatchObject({ 物料名称: "彩盒", 单位: "盒" });
    expect(checked[1]).toMatchObject({ 物料编号: "MAT-X", 错误: "物料不存在" });
  });

  it("解析已出错的行保持原错误，不再覆盖", () => {
    const checked = validateBomImportRows(parsed, master);
    expect(checked[2]).toMatchObject({ 物料编号: "MAT-BAD", 错误: "使用数量必须为正数" });
  });
});
