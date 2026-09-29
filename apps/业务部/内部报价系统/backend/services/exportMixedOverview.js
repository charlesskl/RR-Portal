'use strict';
const { labels } = require('./exportMixedQuotation');
const { addMixedClassification } = require('./exportMixedClassification');
const ref = (sheet, address) => `'${sheet.replace(/'/g,"''")}'!${address}`;
function addMixedOverview(wb, quote, result, sections) {
  const sales = JSON.parse(sections.find(s=>s.dept==='sales')?.payload_json || '{}');
  const cost = wb.getWorksheet('小产品完整成本'), summary=wb.getWorksheet('混装报价汇总');
  const ws = wb.addWorksheet('总报价表');
  // Put the main quotation first; the per-product matrix remains the NA input owner.
  wb.worksheets.forEach((s,i)=>{ s.orderNo=i+1; }); ws.orderNo=0;
  ws.columns=[{width:39},{width:18},{width:22},{width:22},{width:22}];
  ws.addRows([['混装总报价表'],['报价单',quote.quote_no||'', '产品',quote.product_name||''],['客户',quote.customer||''],
    ['说明','小产品按NA加权，共有费用计一次；金额保留4位小数。'],[]]);
  ws.mergeCells('A1:E1');ws.mergeCells('D2:E2');ws.mergeCells('B4:E4');
  const available=result.freight_scenarios.filter(s=>s.key!=='factory'&&s.valid);
  const selected=available.find(s=>s.key===result.selected_container);
  const chosen=[result.freight_scenarios.find(s=>s.key==='factory'),...([selected,...available].filter(Boolean).filter((s,i,a)=>a.findIndex(x=>x.key===s.key)===i).slice(0,2))];
  ws.addRow(['项目','参数',...chosen.map(s=>s.name+(s.key===result.selected_container?'（报客方案）':''))]);
  const row=(label,param)=>ws.addRow([label,param??null]).number;
  const rows={};
  for(const [key,label,param] of [
    ['main','主体小计 HKD（不含车缝、电子）'],['freight','运费 HKD'],['cabinet','吊柜费 HKD'],['withFreight','含运 HKD'],
    ['marked','主体码点 ×',{formula:ref('混装算价参数','B4'),result:result.pricing.markup}],
    ['sewing','车缝 HKD'],['sewMarked','车缝码点 ×',{formula:ref('混装算价参数','B5'),result:sales.shipping?.sew_markup_x??result.pricing.markup}],
    ['electronic','电子 HKD'],['elecMarked','电子码点 ×',{formula:ref('混装算价参数','B6'),result:sales.shipping?.elec_markup_x??result.pricing.markup}],
    ['markedTotal','码点后合计 HKD'],['hkd','统一找数 ÷',{formula:ref('混装算价参数','B7'),result:result.pricing.divisor}],
    ['usd','TOTAL USD（HKD ÷ 汇率）',{formula:ref('混装算价参数','B8'),result:result.pricing.fx}],
    ['amort','模具、手办及测试摊费 USD'],['extra','额外摊费 USD',{formula:ref('混装算价参数','B12'),result:Number(sales.mixed_pricing?.amortization_usd||0)}],
    ['before','TOTAL USD'],['taxBase','附加税 %',{formula:ref('混装算价参数','B9'),result:result.pricing.surtax_pct}],
    ['taxMarked','附加税码点 ×',{formula:ref('混装算价参数','B4'),result:result.pricing.markup}],
    ['surcharge','附加税找数 ÷',{formula:ref('混装算价参数','B7'),result:result.pricing.divisor}],['final','TOTAL 报客价 USD'],
  ]) rows[key]=row(label,param);
  const last=result.products.length+1, common=last+1;
  const weights=ref(summary.name,`$C$2:$C$${last}`);
  const multiplier=result.config.na_direct?'1':ref('混装算价参数','$B$3');
  const keys=Object.keys(labels);
  const classificationRefs=addMixedClassification(wb,quote,result,keys,sections);
  const componentFormula=key=>classificationRefs[key];
  wb.getWorksheet('内部分类汇总').orderNo=0.5;
  const weightedValue=key=>result.common_components[key]+result.products.reduce((v,p)=>v+(p.components[key]||0)*p.weight*result.cost_units,0);
  const mainKeys=keys.filter(k=>!['abs_material','freight','cabinet','sewing_hair','sewing_cloth','electronic'].includes(k));
  const main=mainKeys.reduce((n,k)=>n+weightedValue(k),0),sewing=weightedValue('sewing_hair')+weightedValue('sewing_cloth'),electronic=weightedValue('electronic');
  const amortCol=cost.getColumn(keys.length+3).letter;
  const amortFormula=`SUMPRODUCT(${ref(cost.name,`${amortCol}2:${amortCol}${last}`)},${weights})*${multiplier}+${ref(cost.name,`${amortCol}${common}`)}`;
  const amort=result.products.reduce((v,p)=>v+p.amortization_usd*p.weight*result.cost_units,0)+result.amortization_usd-Number(sales.mixed_pricing?.amortization_usd||0);
  chosen.forEach((scenario,index)=>{
    const col=index+3,letter=ws.getColumn(col).letter;
    const addr=key=>letter+rows[key];
    const set=(key,formula,value)=>ws.getCell(rows[key],col).value={formula,result:value};
    const markup=result.pricing.markup,div=result.pricing.divisor,fx=result.pricing.fx;
    set('main',mainKeys.map(k=>'('+componentFormula(k)+')').join('+'),main);
    // The two scenario inputs are explicitly editable and feed the entire quote column.
    ws.getCell(rows.freight,col).value=scenario.freight;
    ws.getCell(rows.cabinet,col).value=scenario.cabinet;
    const withFreight=main+scenario.freight+scenario.cabinet;
    set('withFreight',`SUM(${addr('main')}:${addr('cabinet')})`,withFreight);
    set('marked',`${addr('withFreight')}*$B$${rows.marked}`,withFreight*markup);
    set('sewing',`(${componentFormula('sewing_hair')})+(${componentFormula('sewing_cloth')})`,sewing);
    const sewMarked=sewing*(sales.shipping?.sew_markup_x??markup);
    set('sewMarked',`${addr('sewing')}*$B$${rows.sewMarked}`,sewMarked);
    set('electronic',componentFormula('electronic'),electronic);
    const elecMarked=electronic*(sales.shipping?.elec_markup_x??markup);
    set('elecMarked',`${addr('electronic')}*$B$${rows.elecMarked}`,elecMarked);
    const marked=withFreight*markup+sewMarked+elecMarked;
    set('markedTotal',`${addr('marked')}+${addr('sewMarked')}+${addr('elecMarked')}`,marked);
    set('hkd',`${addr('markedTotal')}/$B$${rows.hkd}`,marked/div);
    set('usd',`${addr('hkd')}/$B$${rows.usd}`,marked/div/fx);
    set('amort',amortFormula,amort);set('extra',`$B$${rows.extra}`,Number(sales.mixed_pricing?.amortization_usd||0));
    const before=marked/div/fx+amort+Number(sales.mixed_pricing?.amortization_usd||0);
    set('before',`SUM(${addr('usd')}:${addr('extra')})`,before);
    const tax=before*result.pricing.surtax_pct/100;
    set('taxBase',`${addr('before')}*$B$${rows.taxBase}/100`,tax);
    set('taxMarked',`${addr('taxBase')}*$B$${rows.taxMarked}`,tax*markup);
    set('surcharge',`${addr('taxMarked')}/$B$${rows.surcharge}`,tax*markup/div);
    set('final',`${addr('before')}+${addr('surcharge')}`,before+tax*markup/div);
  });
  ws.addRow([]);ws.addRow(['输入位置','NA比例在“混装报价汇总”，码点/除数/汇率/附加税在“混装算价参数”；本表运费与吊柜费可调整。']);ws.mergeCells(ws.rowCount,2,ws.rowCount,5);ws.lastRow.height=42;
  ws.eachRow(row=>{row.height=row.height||26;row.eachCell(c=>{c.font={name:'Microsoft YaHei',size:11};c.alignment={vertical:'middle',wrapText:true};c.numFmt='0.0000';c.border={bottom:{style:'thin',color:{argb:'FFD6DFEA'}}};});});
  for(const r of [1,6]){ws.getRow(r).height=30;ws.getRow(r).font={name:'Microsoft YaHei',size:12,bold:true,color:{argb:'FFFFFFFF'}};ws.getRow(r).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF234E70'}};}
  for(const key of ['withFreight','markedTotal','hkd','before','final','taxBase']){ws.getRow(rows[key]).fill={type:'pattern',pattern:'solid',fgColor:{argb:key==='taxBase'?'FFFFF2CC':'FFE5EFF9'}};ws.getRow(rows[key]).font={name:'Microsoft YaHei',size:11,bold:true,color:{argb:'FF234E70'}};}
  ws.views=[{state:'frozen',ySplit:6}];ws.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:1};
  const selectedColumn=ws.getColumn(chosen.findIndex(s=>s.key===result.selected_container)+3).letter;
  const allocation=wb.getWorksheet('NA比例分摊成本');
  const miscCol=allocation.getRow(1).values.findIndex(v=>v==='印尼运费 HKD');
  if(miscCol<1)throw new Error('缺少印尼运费分摊列');
  const miscTotal=allocation.getColumn(miscCol).letter+(result.products.length+2);
  const commonMisc=ref(cost.name,cost.getColumn(keys.indexOf('misc')+3).letter+common);
  require('./exportMixedTax').addMixedTax(ws,result,classificationRefs,`${selectedColumn}${rows.final}*$B$${rows.usd}`,{
    freightRef:`${selectedColumn}${rows.freight}`,
    cabinetRef:`${selectedColumn}${rows.cabinet}`,
    miscFormula:`${ref(allocation.name,miscTotal)}*${multiplier}+${commonMisc}+${selectedColumn}${rows.taxBase}*$B$${rows.usd}`,
    surtaxHkd:result.before_surtax_usd*result.pricing.surtax_pct/100*result.pricing.fx,
  });
  // Place the freight comparison beside the pricing table, like the single-product template.
  ws.mergeCells('G6:H6');ws.getCell('G6').value='运输方案';
  ws.getCell('I6').value='运费 HKD';ws.getCell('J6').value='吊柜费 HKD';
  ws.mergeCells('K6:L6');ws.getCell('K6').value='合计 HKD / 包装';
  result.freight_scenarios.filter(s=>s.key!=='factory').slice(0,8).forEach((s,i)=>{
    const r=7+i;ws.mergeCells(r,7,r,8);ws.getCell(r,7).value=s.name;
    ws.mergeCells(r,11,r,12);
    if(s.valid){
      const chosenIndex=chosen.findIndex(x=>x.key===s.key);
      for(const [c,key] of [[9,'freight'],[10,'cabinet']])ws.getCell(r,c).value=chosenIndex>=0?{formula:ws.getColumn(chosenIndex+3).letter+rows[key],result:s[key]}:s[key];
      ws.getCell(r,11).value={formula:`SUM(I${r}:J${r})`,result:s.freight+s.cabinet};
    }else ws.getCell(r,11).value='参数未齐';
  });
  ws.mergeCells('G17:L17');ws.getCell('G17').value='费用摊分（USD / 包装）';
  for(const [r,label,key] of [[18,'模具、手办及测试摊费','amort'],[19,'额外摊费','extra']]){
    ws.mergeCells(r,7,r,10);ws.getCell(r,7).value=label;
    ws.mergeCells(r,11,r,12);const original=ws.getCell(rows[key],3);
    ws.getCell(r,11).value={formula:`C${rows[key]}`,result:original.result};
  }
  return ws;
}
module.exports={addMixedOverview};
