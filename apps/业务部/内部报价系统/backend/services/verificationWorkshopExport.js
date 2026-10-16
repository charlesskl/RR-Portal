'use strict';
const ExcelJS=require('exceljs');
const G=require('../../frontend/verification-report-groups');
const quoteSheet=name=>`'${name.replace(/'/g,"''")}'`;
function localFormula(expression,row){
  const refs=[...new Set(expression.match(/\b[A-Z]+1\b/g)||[])].map(ref=>ref.replace(/1$/,row));
  const formula=expression.replace(/([A-Z]+)1\b/g,`$1${row}`);
  // An empty quantity or cost is not zero, including after Excel edits.
  return refs.length?`IF(COUNT(${refs.join(',')})=${refs.length},${formula},"")`:formula;
}
function buildWorkbook(rows,columns){
  const wb=new ExcelJS.Workbook();wb.creator='内部报价系统';wb.calcProperties.fullCalcOnLoad=true;
  const plans=[
    ['总表分车间',G.reportRows(rows,'workshop-summary')],
    ['打印',G.reportRows(rows,'workshop-summary')],
    ['截图',G.reportRows(rows,'workshop-summary')],
    ['总表不分车间',G.reportRows(rows,'customer-summary')],
    ['不分车间 打印',G.reportRows(rows,'customer-summary')],
    ['不分车间核价明细',G.reportRows(rows,'all-details')]
  ];
  const used=new Set(plans.map(p=>p[0].toLowerCase()).concat('生成提示'));
  for(const [customer,items] of G.group(rows,r=>r.values.A)){
    const base=String(customer||'未填写客户').replace(/[\\/*?:\[\]]/g,'_').slice(0,26);let name=base,i=1;
    while(used.has(name.toLowerCase()))name=`${base}_${i++}`;
    used.add(name.toLowerCase());plans.push([name,G.reportRows(items,'customer-detail')]);
  }
  for(const [name] of plans)wb.addWorksheet(name,{properties:{tabColor:{argb:plans.findIndex(p=>p[0]===name)<6?'FF83D32D':'FF4472C4'}}});
  const customerRows=new Map();
  for(const [name,items] of plans.slice(6))items.forEach((r,i)=>{if(!r.kind)customerRows.set(r,{name,row:i+4});});
  const subtotalRefs=new Map();
  for(const [name,items] of plans.slice(6))items.forEach((r,i)=>{if(r.kind==='total')subtotalRefs.set(`${r.values.A}\u0000${r.workshop}`,{name,row:i+4});});
  for(const [name,items] of plans){
    const ws=wb.getWorksheet(name);
    const isCustomer=plans.slice(6).some(p=>p[0]===name);
    const localRows=new Map(items.flatMap((r,i)=>!r.kind?[[r,i+4]]:[]));
    ws.addRow([name]);ws.mergeCells('A1:L1');
    ws.addRow(['当前核价明细生成。单价栏合计为各款单价之和；金额按接单数量计算，占比由合计重算。数量期间沿用原文件，缺项留空。']);ws.mergeCells('A2:L2');
    ws.addRow([...columns.map(c=>c.key==='D'?'接单数量（原文件期间）':c.label),'车间','核价版本','审核状态','生成提示','数量来源','车间来源']);
    items.forEach((r,i)=>{
      const n=i+4;
      if(r.kind==='heading'){ws.addRow([r.title]);ws.mergeCells(`A${n}:EE${n}`);return;}
      const row=columns.map(c=>{
        const v=r.values[c.key];
        if(['A','B','C'].includes(c.key)||v!=null&&!G.numeric(v))return v??null;
        if(r.kind==='total'){
          if(G.ratios[c.key])return {formula:localFormula(r.formulas[c.key],n),result:v??''};
          const subtotal=subtotalRefs.get(`${r.values.A}\u0000${r.workshop}`);
          if(subtotal&&plans.slice(0,5).some(p=>p[0]===name)){
            const ref=`${quoteSheet(subtotal.name)}!${c.key}${subtotal.row}`;
            return {formula:`IF(ISNUMBER(${ref}),${ref},"")`,result:v??''};
          }
          const refs=plans.slice(0,5).some(p=>p[0]===name)
            ?[...new Set(r.members.map(m=>{const s=subtotalRefs.get(`${m.values.A}\u0000${G.workshop(m)}`);return `${quoteSheet(s.name)}!${c.key}${s.row}`;}))]
            :r.members.map(m=>{if(localRows.has(m))return `${c.key}${localRows.get(m)}`;const s=customerRows.get(m);return `${quoteSheet(s.name)}!${c.key}${s.row}`;});
          return {formula:`IF(COUNT(${refs.join(',')})=${refs.length},SUM(${refs.join(',')}),"")`,result:v??''};
        }
        // Customer sheets own inputs and calculations. Green detail sheets
        // consume their results; no customer formula may reference a green tab.
        if(!isCustomer){const s=customerRows.get(r),ref=`${quoteSheet(s.name)}!${c.key}${s.row}`;return {formula:`IF(ISNUMBER(${ref}),${ref},"")`,result:v??''};}
        if(r.formulas[c.key])return {formula:localFormula(r.formulas[c.key],n),result:v??''};
        return v??null;
      });
      ws.addRow([...row,r.workshop||G.pending,r.version||'',r.status_label||'',r.kind==='total'?`${r.quantity_count}/${r.count}款有数量`:(r.issues||[]).join('；'),r.sources.D||'',r.workshop_source||'']);
    });
    columns.forEach((c,i)=>{const col=ws.getColumn(i+1);col.width=i===0?23:i===1?25:i===2?30:16;col.hidden=c.hidden;col.numFmt=i<3?'@':i===3?'#,##0':c.percent?'0.00%':'#,##0.00';});
    [18,14,14,65,55,65].forEach((width,i)=>ws.getColumn(136+i).width=width);
    ws.views=[{state:'frozen',xSplit:3,ySplit:3,showGridLines:false}];
    ws.eachRow((row,n)=>{
      row.height=n===2?42:n===3?66:28;
      const item=items[n-4],heading=item?.kind==='heading',total=item?.kind==='total';
      row.eachCell({includeEmpty:true},(cell,c)=>{
        cell.font={name:'Arial',size:10,bold:n===1||n===3||heading||total,color:{argb:total?'FF174E91':'FF203047'}};
        cell.alignment={vertical:'middle',horizontal:n===3?'center':c>3?'right':'left',wrapText:n<=3||c<=3};
        if(n>=3)cell.border={bottom:{style:'thin',color:{argb:'FFD5DEEA'}},right:{style:'thin',color:{argb:'FFD5DEEA'}}};
        if(n===3||heading||total)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:total?'FFBDD7EE':heading?'FFE2EFDA':'FFD9E2F3'}};
      });
    });
    ws.pageSetup={orientation:'landscape',paperSize:8,scale:80,fitToPage:false,printTitlesRow:'1:3',printTitlesColumn:'A:C',printArea:`A1:EE${Math.max(3,ws.rowCount)}`};
    ws.headerFooter.oddFooter='第 &P 页 / 共 &N 页';
  }
  const notes=wb.addWorksheet('生成提示');notes.addRow(['客户','货号','车间','提示']);
  for(const r of rows){if(G.workshop(r)===G.pending)notes.addRow([r.values.A,r.values.B,G.pending,r.workshop_source||'未明确分配']);for(const issue of r.issues||[])notes.addRow([r.values.A,r.values.B,G.workshop(r),issue]);}
  [24,28,18,100].forEach((w,i)=>notes.getColumn(i+1).width=w);notes.getRow(1).font={bold:true};notes.views=[{state:'frozen',ySplit:1}];
  return wb;
}
module.exports={buildWorkbook,localFormula};
