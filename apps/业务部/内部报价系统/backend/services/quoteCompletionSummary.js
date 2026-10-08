const ExcelJS = require('exceljs');

function aggregateCompletion(rows, date = new Date()) {
  const groups = new Map();
  for (const row of rows) {
    const customer = String(row.customer || '').trim() || '未填写客户';
    const group = groups.get(customer) || { customer, total: 0, incomplete: 0, completed: 0, note: '' };
    group.total++;
    if (Number(row.completed) === 1) group.completed++; else group.incomplete++;
    groups.set(customer, group);
  }
  const result = [...groups.values()].sort((a,b) => a.customer.localeCompare(b.customer, 'zh-CN'));
  const totals = result.reduce((s,r) => ({ total:s.total+r.total, incomplete:s.incomplete+r.incomplete, completed:s.completed+r.completed }), {total:0,incomplete:0,completed:0});
  const asOf = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai'}).format(date);
  return { title:`各客报价完成情况汇总（截止${asOf.replaceAll('-', '/')}）`, as_of:asOf, rows:result, totals };
}

function buildCompletionWorkbook(report) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('报价完成情况', {views:[{state:'frozen', ySplit:2}]});
  sheet.columns = [{width:36},{width:18},{width:18},{width:18},{width:32}];
  sheet.mergeCells('A1:E1'); sheet.getCell('A1').value = report.title;
  sheet.addRow(['客户','新建报价','未完成报价','已完成报价','备注']);
  report.rows.forEach((r,i) => sheet.addRow([r.customer,r.total,r.incomplete,{formula:`B${i+3}-C${i+3}`,result:r.completed},r.note]));
  const end = report.rows.length+2;
  sheet.addRow(['共计', ...['total','incomplete','completed'].map((key,i) => report.rows.length ? {formula:`SUM(${String.fromCharCode(66+i)}3:${String.fromCharCode(66+i)}${end})`, result:report.totals[key]} : 0), '']);
  sheet.eachRow((row,index) => {
    row.height = index === 1 ? 34 : 30;
    for (let c=1;c<=5;c++) {
      const cell=row.getCell(c);
      cell.alignment={vertical:'middle',horizontal:c===1||c===5?'left':'center',wrapText:true};
      cell.border=Object.fromEntries(['top','bottom','left','right'].map(k=>[k,{style:'thin',color:{argb:'FFCBD5E1'}}]));
      cell.font={name:'微软雅黑',size:11,bold:index<=2||index===end+1};
      if(index<=2||index===end+1)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE2EFF9'}};
    }
  });
  sheet.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0};
  return workbook;
}
module.exports={aggregateCompletion,buildCompletionWorkbook};
