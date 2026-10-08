// 物料档案 Excel 导入解析:二维数组(XLSX sheet_to_json header:1,或 CSV 切分) → 导入行（纯函数，可单测）
// 与后端约定:前端按表头列名映射、解析数字列、把未映射列打包进备注;后端只做兜底校验。

export interface MaterialImportSpec {
  // 归一化表头 → 数据字段名（按表头名列映射,不按位置）
  columns: Record<string, string>;
  // 按数字解析的数据字段:空 → undefined,非数字 → 错误行
  numeric: ReadonlySet<string>;
  // Excel 无此列时的固定默认值（如塑胶 单位=个 货币=HKD）;映射到同名列时以列为准
  defaults?: Record<string, string>;
}

export interface MaterialImportParsedRow {
  行号: number;
  数据: Record<string, string | number | undefined>;
  错误?: string;
}

export interface MaterialImportParseResult {
  hasHeader: boolean;
  rows: MaterialImportParsedRow[];
}

// 表头归一化:去半角/全角空格,全角括号转半角
const normHeader = (s: string) =>
  s.replace(/[\s\u3000]/g, "").replace(/（/g, "(").replace(/）/g, ")");
// 不参与"未映射列打包备注"的系统列（空表头列、序号列）
const SKIP_PACK_HEADERS = new Set(["", "序号"]);

const CODE_FIELD = "物料编号";

// 单元格 → 文本(数字按原样转字符串,字符串 Trim)
const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v).trim();
};

// 数字列解析:空 → undefined;非数字 → null(由调用方转错误行)
const parseNum = (v: unknown): number | undefined | null => {
  const t = cellText(v);
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const isEmptyRow = (cells: unknown[]) => cells.every(c => cellText(c) === "");

// 在二维数组里定位含"物料编号"的表头行(跳过第 1 行合并标题等前置行)
export function findHeaderRowIndex(grid: unknown[][]): number {
  return grid.findIndex(cells => cells.some(c => normHeader(cellText(c)) === CODE_FIELD));
}

// 解析二维数组:按表头名列映射;空行跳过;未映射且非空的列以 "列名:值" 空格连接追加进备注(备注内容最前)
export function parseMaterialGrid(grid: unknown[][], spec: MaterialImportSpec): MaterialImportParseResult {
  const h = findHeaderRowIndex(grid);
  if (h < 0) return { hasHeader: false, rows: [] };
  const headerCells = grid[h].map(c => cellText(c));
  const normCells = headerCells.map(normHeader);
  // 列号 → 数据字段名(仅映射列)
  const fieldAt = normCells.map(n => spec.columns[n]);
  const rows: MaterialImportParsedRow[] = [];
  for (let i = h + 1; i < grid.length; i++) {
    const cells = grid[i];
    if (isEmptyRow(cells)) continue;
    const 行号 = i + 1; // 与 Excel 行号一致
    const 数据: Record<string, string | number | undefined> = { ...(spec.defaults ?? {}) };
    let 错误: string | undefined;
    const pack: string[] = [];
    for (let c = 0; c < headerCells.length; c++) {
      const field = fieldAt[c];
      const v = cells[c];
      if (field) {
        if (spec.numeric.has(field)) {
          const n = parseNum(v);
          if (n === null) { 错误 ??= `${headerCells[c]}不是数字`; continue; }
          if (n !== undefined) 数据[field] = n;
        } else {
          const t = cellText(v);
          if (t) 数据[field] = t;
        }
      } else if (!SKIP_PACK_HEADERS.has(normCells[c])) {
        const t = cellText(v);
        if (t) pack.push(`${headerCells[c]}:${t}`);
      }
    }
    // 备注打包:备注列内容最前,有追加项时用 ";" 连接,追加项之间空格连接
    const tail = pack.join(" ");
    const remark = typeof 数据.备注 === "string" ? 数据.备注 : "";
    const packed = remark ? (tail ? `${remark};${tail}` : remark) : tail;
    if (packed) 数据.备注 = packed;
    else delete 数据.备注;
    const code = cellText(typeof 数据.物料编号 === "string" || typeof 数据.物料编号 === "number" ? 数据.物料编号 : "");
    if (code) 数据.物料编号 = code;
    else { delete 数据.物料编号; 错误 ??= "物料编号为空"; }
    rows.push(错误 ? { 行号, 数据, 错误 } : { 行号, 数据 });
  }
  return { hasHeader: true, rows };
}

// 来料物料档案(表 [物料资料])列映射:材料等未映射列自动打包进备注
export const MATERIAL_IMPORT_SPEC: MaterialImportSpec = {
  columns: {
    物料编号: "物料编号",
    货号: "货号",
    物料名称: "物料名称",
    规格: "规格",
    颜色: "颜色",
    单位: "单位",
    单价: "单价",
    仓库位置: "仓库位置",
    备注: "备注",
    最低库存: "最低库存",
    货币: "货币",
  },
  numeric: new Set(["单价", "最低库存"]),
};

// 塑胶物料资料(表 [塑胶物料资料])列映射:塑胶货号→款号,原胶件单价→单价;
// 工模/重量/用量/价格等列直落真实列(见 db/63);仍无法映射的列才打包进备注
export const PLASTIC_IMPORT_SPEC: MaterialImportSpec = {
  columns: {
    物料编号: "物料编号",
    客户: "客户",
    塑胶货号: "款号",
    工模编号: "工模编号",
    物料名称: "物料名称",
    颜色: "颜色",
    色粉号: "色粉号",
    原料名称: "原料名称",
    用料名称: "用料名称",
    加工内容: "加工内容",
    "加工总单价(HKD)": "加工总单价",
    二次加工: "二次加工",
    二次加工价: "二次加工价",
    整啤净重: "整啤净重",
    原胶件单净重: "原胶件单净重",
    整啤模腔数: "整啤模腔数",
    套数: "套数",
    出模数: "出模数",
    用量: "用量",
    啤机机型: "啤机机型",
    模具日产量: "模具日产量",
    啤机价钱: "啤机价钱",
    胶件啤工价: "胶件啤工价",
    原料单价: "原料单价",
    胶件料价: "胶件料价",
    原胶件单价: "单价",
    备注: "备注",
    其他成本: "其他成本",
  },
  numeric: new Set([
    "单价", "二次加工价", "加工总单价", "整啤净重", "原胶件单净重", "整啤模腔数",
    "套数", "出模数", "用量", "模具日产量", "啤机价钱", "胶件啤工价", "原料单价", "胶件料价", "其他成本",
  ]),
  defaults: { 单位: "个", 货币: "HKD" },
};
