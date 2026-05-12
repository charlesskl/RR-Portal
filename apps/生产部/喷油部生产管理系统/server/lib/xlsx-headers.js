// 把表头行数组识别成列索引映射
// 规则:
//  - 「货号」→ code
//  - 「货名」→ name(独立列)
//  - 「位置」→ part_name(优先)
//  - 「工序」→ 若已有 part_name,则当 technique;否则当 part_name
//  - 「工艺」→ technique
//  - 「目标数」「人数」「工价」「核价」「油漆价」「总核价」「报价」「备注」→ 同名字段
function detectColumns(headerRow) {
  const cols = {};
  for (let i = 0; i < headerRow.length; i++) {
    const h = String(headerRow[i] || '').trim();
    if (!h) continue;
    if (h.includes('货号')) cols.code = i;
    else if (h.includes('货名')) cols.name = i;
    else if (h.includes('位置')) cols.part_name = i;
    else if (h.includes('工艺')) cols.technique = i;
    else if (h.includes('工序')) {
      if (cols.part_name === undefined) cols.part_name = i;
      else if (cols.technique === undefined) cols.technique = i;
    }
    else if (h.includes('目标数')) cols.target_qty = i;
    else if (h.includes('人数')) cols.worker_count = i;
    else if (h.includes('工价')) cols.unit_wage = i;
    else if (h.includes('总核价')) cols.total_price = i;
    else if (h.includes('油漆价')) cols.paint_price = i;
    else if (h.includes('核价')) cols.calc_price = i;
    else if (h.includes('报价')) cols.quote_price = i;
    else if (h.includes('备注')) cols.remarks = i;
  }
  return cols;
}

module.exports = { detectColumns };
