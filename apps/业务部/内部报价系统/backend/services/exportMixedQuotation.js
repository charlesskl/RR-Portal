'use strict';
const ExcelJS = require('exceljs');
const { calculateMixedQuote } = require('./mixedQuotation');
const labels = { injection_labor: '啤工', assembly_labor: '装配人工', painting_labor: '喷油人工', paint_material: '油料', imp_mat: '进口塑胶', dom_mat: '国产塑胶', blow: '吹气', slush: '搪胶', sewing_hair: '车发', sewing_cloth: '车衣', hardware: '五金', electronic: '电子', motor: '马达', suction: '吸塑', glue_bag: '胶袋', color_box: '彩盒/内咭', battery: '电池', libao: '利宝', plating: '电镀', flocking: '植绒', other_buy: '其他外购', carton: '纸箱', freight: '运费', cabinet: '吊柜', misc: '印尼运费', abs_material: '其中 ABS（不重复相加）' };
const deptKeys = {
  engineering: ['hardware', 'motor', 'suction', 'glue_bag', 'color_box', 'battery', 'libao', 'plating', 'flocking', 'other_buy', 'carton'],
  molding: ['injection_labor', 'imp_mat', 'dom_mat', 'blow'], blow: ['blow'],
  electronic: ['electronic'], painting: ['painting_labor', 'paint_material'],
  slush: ['slush'], sewing: ['sewing_hair', 'sewing_cloth'], assembly: ['assembly_labor'],
};
async function buildMixedWorkbook({ quote, sections, dept, customerOnly = false, consolidate = true }) {
  const result = calculateMixedQuote(quote, sections, { strict: !dept });
  if (!result?.pricing) throw new Error(result?.errors?.join('；') || '混装报价配置不完整');
  const wb = new ExcelJS.Workbook(); wb.creator = '内部报价系统';
  const add = (name, rows) => {
    const ws = wb.addWorksheet(name); ws.addRows(rows); ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.columns.forEach((col, i) => { col.width = i === 1 ? 30 : 24; });
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF163B66' } };
    ws.eachRow(row => { row.height = 25; row.eachCell(cell => { cell.alignment = { vertical: 'middle', wrapText: true }; if (typeof cell.value === 'number' || cell.value?.formula) cell.numFmt = '0.0000'; }); });
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    return ws;
  };
  if (!dept) {
    const ws = add(customerOnly ? '混装报客价' : '混装报价汇总', [
      ['货号', '小产品', 'NA比例', '每款报价 HKD', '每款报价 USD'],
      ...result.products.map(p => [p.code, p.name, p.weight, p.price_hkd, p.price_usd]),
    ]);
    const last = result.products.length + 1, averageRow = last + 2;
    ws.addRow([]);
    ws.addRow(['小产品平均报价 USD', { formula: `SUMPRODUCT(C2:C${last},E2:E${last})`, result: result.average_usd }]);
    ws.addRow([result.config.na_direct ? 'NA合计计入倍数' : '每包装小产品数量', result.cost_units ?? result.units_per_pack]);
    ws.addRow(['每包装共有费用及摊费 USD', result.common_usd]);
    ws.addRow(['附加费 USD', { formula: `(B${averageRow}*B${averageRow + 1}+B${averageRow + 2})*${result.pricing.surtax_pct}/100*${result.pricing.surtax_markup}/${result.pricing.divisor}`, result: result.surcharge_usd }]);
    ws.addRow(['每包装最终报价 USD', { formula: `B${averageRow}*B${averageRow + 1}+B${averageRow + 2}+B${averageRow + 3}`, result: result.final_usd }]);
    ws.addRow(['每包装最终报价 HKD', { formula: `B${averageRow + 4}*${result.pricing.fx}`, result: result.final_hkd }]);
    ws.addRow(['主货号 / 产品', `${quote.quote_no} / ${quote.product_name}`]);
    ws.addRow(['客户', quote.customer || '']);
    ws.addRow(['平均方式', result.config.mode === 'equal' ? '等量平均' : '按比例平均']);
    ws.addRow(['报价除数 / HKD→USD 汇率', `${result.pricing.divisor} / ${result.pricing.fx}`]);
    ws.getColumn(3).numFmt = '0.00%'; ws.getColumn(2).numFmt = '0.0000';
  }
  if (!customerOnly) {
    const keys = dept ? deptKeys[dept] || [] : Object.keys(labels);
    add(dept ? '部门成本汇总' : '小产品完整成本', [
      ['小产品货号', '小产品名称', ...keys.map(k => labels[k] + ' HKD')],
      ...result.products.map(p => [p.code, p.name, ...keys.map(k => p.components[k])]),
      ['共有费用', '每销售包装计一次', ...keys.map(k => result.common_components[k])],
    ]);
    if (!dept) {
      const costKeys = Object.keys(labels).filter(k => k !== 'abs_material');
      const values = result.products.map(p => costKeys.map(k => (p.components[k] || 0) * p.weight));
      const allocation = add('NA比例分摊成本', [
        ['货号', '小产品', 'NA比例', ...costKeys.map(k => labels[k] + ' HKD'), '合计 HKD'],
        ...result.products.map((p, i) => [p.code, p.name, p.weight, ...values[i], values[i].reduce((a,b) => a+b, 0)]),
        ['分类平均价', '共有费用另计', result.products.reduce((sum, p) => sum + p.weight, 0), ...costKeys.map((_, i) => values.reduce((sum, row) => sum + row[i], 0)), values.flat().reduce((a,b) => a+b, 0)],
      ]);
      const costSheet=wb.getWorksheet('小产品完整成本');
      result.products.forEach((p,i)=>{
        const row=i+2;
        allocation.getCell(row,3).value={formula:`'混装报价汇总'!C${row}`,result:p.weight};
        costKeys.forEach((key,j)=>{const col=costSheet.getColumn(Object.keys(labels).indexOf(key)+3).letter;allocation.getCell(row,j+4).value={formula:`'小产品完整成本'!${col}${row}*$C${row}`,result:values[i][j]};});
        const end=allocation.getColumn(costKeys.length+3).letter;
        allocation.getCell(row,costKeys.length+4).value={formula:`SUM(D${row}:${end}${row})`,result:values[i].reduce((a,b)=>a+b,0)};
      });
      const endRow=result.products.length+1,totalRow=endRow+1;
      for(let col=3;col<=costKeys.length+4;col++){const cell=allocation.getCell(totalRow,col),letter=allocation.getColumn(col).letter;cell.value={formula:`SUM(${letter}2:${letter}${endRow})`,result:cell.value};}
    }
    if (!dept || dept === 'molding') {
      add('共模啤价分摊', [['模号', '小产品', '零件', '出模数（件/啤）', '每款用量', '零件需求量', '啤工 HKD/零件', '计入小产品啤价 HKD', '分摊总额 HKD'],
        ...result.molds.flatMap(m => m.parts.map(p => [m.mold_no, result.products.find(x => x.id === p.product_id).code, p.name || '', p.cavity, p.usage, p.demand, p.unit_labor, p.product_labor, p.labor_total]))]);
      add('共模生产阶段', [['模号', '阶段', '啤次', '有效穴数', '每啤成本 HKD', '阶段成本 HKD'],
        ...result.molds.flatMap(m => m.stages.map((s, i) => [m.mold_no, i + 1, s.cycles, s.cavities, m.shot_cost, s.cost]))]);
    }
  }
  if (!dept && !customerOnly) {
    await require('./exportMixedTemplate').addTemplateDetails(wb, { quote, sections }, result);
    require('./exportMixedOverview').addMixedOverview(wb, quote, result, sections);
    if (consolidate) require('./consolidateMixedWorkbook').consolidateMixedWorkbook(wb,quote);
  }
  wb.calcProperties = { fullCalcOnLoad: true };
  return wb;
}
module.exports = { buildMixedWorkbook, labels, deptKeys };
