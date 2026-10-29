'use strict';

// This report reads verification sections, never quote-section snapshots or the
// global costing basis. The supplied workbook owns column order and order qty.
const Excel = require('../../frontend/excel-formulas');
const template = require('./verificationSummaryTemplate.json');
const { buildQuoteSummary } = require('./quoteSummary');
const { resolveWorkshop } = require('./verificationWorkshops');
const columns = template.columns;
const verificationCustomers=require('../../frontend/verification-customers');
const normalize = value => String(value ?? '').replace(/\s/g, '').replace(/（/g, '(').replace(/）/g, ')').toUpperCase();
const label = value => normalize(value).replace(/[()]/g, '');
const customerKey = value => ({ 'ZANZOON(嘉苏)': 'ZANZOON' }[normalize(value)] || normalize(value));
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const statusLabels = { drafting:'填写中', in_review:'审核中', ready:'待完成', completed:'已完成', cancelled:'已取消' };

function quantityFor(quote, quantities = template.quantities, fx = null) {
  const baseSku=s=>normalize(s).replace(/\(+汇率[\d.]+\)*$/,'');
  const candidates=quantities.filter(q=>customerKey(q.customer)===customerKey(quote.customer)&&baseSku(q.sku)===baseSku(quote.quote_no));
  let matches = candidates.filter(q => normalize(q.sku) === normalize(quote.quote_no));
  if(!matches.length&&candidates.length){
    matches=candidates.filter(q=>{const rate=normalize(q.sku).match(/\(+汇率([\d.]+)\)*$/);return rate&&numeric(fx)&&Math.abs(Number(rate[1])-fx)<1e-8;});
    if(!matches.length)return {value:null,issue:`附件货号按汇率分行；当前核价表头汇率 ${fx??'未提供'}，无唯一对应行，未合并数量`};
  }
  if (matches.length !== 1) return { value:null, issue:matches.length ? '接单数量多条匹配，需确认' : '附件未匹配到客户＋货号的接单数量' };
  return { value:matches[0].qty, source:`${template.source} / ${matches[0].source}` };
}

const fields = {
  E:['货价','货价HK$'], F:['总成本','成本含人工'], G:['不含人工成本','成本不含人工'],
  H:['啤工'], L:['装配工','装工'], P:['喷油工','喷印工'], T:['进口料','料价进口料'], U:['国内料','料价国内料'],
  Y:['ABS料价成本'], Z:['ABS占货价%'], AA:['总采购价'], AB:['彩盒/内咭','彩盒+说明书','彩盒、说明书','彩盒','彩盒/内咭/贴纸/说明书','收缩膜、说明书、纸袋','收缩膜/说明书/纸袋'],
  AF:['利宝','贴纸'], AJ:['吸塑'], AN:['纸箱'], AR:['电镀'], AS:['电子','电子+IC','电子（不含税）'], AW:['电池'], BA:['五金'],
  BE:['搪胶'], BI:['车发'], BM:['车衣','车缝'], BQ:['油漆'], BU:['其他外购'], BY:['杂项'], CC:['运费'], CD:['吊柜费'],
  CH:['附加税0.4%'], CI:['人民币外购件成本'], CK:['毛利'], CL:['毛利率'], CM:['利润'], CN:['利润率'],
  CO:['未减税前码数'], CS:['含税13%类成本'], DA:['减税后码数'], DC:['减税后人工合计'], DD:['减税后不含人工成本'],
};
const metricKeys = { E:'price', F:'total', G:'no_labor', CY:'deduction', CZ:'after_cost', DE:'after_gross', DF:'gross_pct', DG:'after_profit', DH:'profit_pct' };
const componentKeys = { H:'injection_labor', L:'assembly_labor', P:'painting_labor', T:'imp_mat', U:'dom_mat',
  AB:'color_box', AF:'libao', AJ:'suction', AN:'carton', AR:'plating', AS:'electronic', AW:'battery', BA:'hardware',
  BE:'slush', BI:'sewing_hair', BM:'sewing_cloth', BQ:'paint_material', BU:'other_buy', BY:'misc', CC:'freight', CD:'cabinet' };
const derivedKeys = { Y:'abs_material_cost',Z:'abs_material_share',AA:'total_purchase_price',CH:'surtax_04',CI:'rmb_purchase_cost',
  CK:'gross_before_tax',CL:'gross_before_tax_rate',CM:'profit_before_tax',CN:'profit_before_tax_rate',CO:'markup_before_tax',
  CP:'tax_1_cost',CQ:'labor_13_cost',CR:'freight_9_cost',CS:'tax_13_cost',CT:'carton_13_cost',CU:'slush_3_cost',CV:'hair_13_cost',CW:'cloth_13_cost',CX:'suction_6_cost',
  CY:'rebate_reduction',CZ:'cost_after_rebate',DA:'markup_after_tax',DB:'raw_cost_after_tax',DC:'labor_cost_after_tax',DD:'no_labor_cost_after_tax',
  DE:'gross_after_tax',DF:'gross_after_tax_rate',DG:'profit_after_tax',DH:'profit_after_tax_rate' };

function buildVerificationRow(quote, version, sections, quantities) {
  const values = Object.fromEntries(columns.map(c => [c.key,null]));
  const sources = {}, formulas = {}, issues = [];
  const payloads = Object.fromEntries(sections.map(s => [s.dept, JSON.parse(s.payload_json || '{}')]));
  const manualQty = payloads.sales?.summary_order_quantity;
  const qty = manualQty && Object.prototype.hasOwnProperty.call(manualQty,'value')
    ? {value:manualQty.value,source:'手动填写的接单数量',...(manualQty.value===null?{issue:'接单数量已手动留空'}:{})}
    : quantityFor(quote, quantities, payloads.sales?.header?.fx_hkd_usd);
  Object.assign(values,{ A:quote.customer,B:quote.quote_no,C:quote.product_name,D:qty.value });
  if (qty.issue) issues.push(qty.issue); else sources.D = qty.source;
  const model = payloads.sales?.legacy_import?.excel_model;
  const overrides = Object.assign({}, ...Object.values(payloads).map(p => p.excel_native?.inputs || {}));
  // Formula expressions use Excel column names with row 1, shared by the web
  // preview and the XLSX export. Null dependencies stay unavailable, not zero.
  function calc(key, expression, dependencies, fn) {
    if (values[key] !== null) return;
    formulas[key] = expression;
    if (!dependencies.every(k => numeric(values[k]))) return;
    const result = fn(...dependencies.map(k => values[k]));
    if (!numeric(result)) return;
    values[key] = result;
  }
  const subtract = (out,a,b) => calc(out,`${a}1-${b}1`,[a,b],(x,y)=>x-y);
  const divide = (out,a,b) => calc(out,`IF(${b}1=0,0,${a}1/${b}1)`,[a,b],(x,y)=>y===0?0:x/y);
  const sum = (out, keys) => calc(out,keys.map(k=>`${k}1`).join('+'),keys,(...ns)=>ns.reduce((a,b)=>a+b,0));
  if (model) {
    const evaluator = Excel.createEvaluator(model,overrides);
    const groups = model.groups.slice(0,4);
    const read = id => {
      if (!id) return null;
      const cell = evaluator.cell(id);
      if (!cell || cell.missing_sheet) return null;
      if (!cell.f && (cell.v == null || cell.v === '')) return null;
      try { const v = evaluator.value(id); return numeric(v) ? v : cell.f && (v == null || v === '') ? 0 : null; }
      catch (e) { issues.push(`${id}：${e.message}`); return null; }
    };
    const tax = groups.find(g => g.title === '减税与税后结果');
    const costs = groups.filter(g => g !== tax).slice(0,3);
    // Recognise the current product's horizontal cost summary, not arbitrary
    // same-name cells elsewhere in a multi-product worksheet or tax-rate block.
    const owned = costs.flatMap(g=>g.rows.flat()).map(id=>Excel.split(id));
    const sheets = new Set(owned.map(([s])=>s));
    const bounds = groups.flatMap(g=>g.rows.flat()).map(id=>Number(Excel.split(id)[1].match(/\d+$/)?.[0]));
    const firstRow = Math.min(...bounds), lastRow = Math.max(...bounds)+10;
    const rowHeaders = new Map();
    for(const [id,c] of Object.entries(model.cells)) {
      const [sheet,address]=Excel.split(id), row=Number(address.match(/\d+$/)?.[0]);
      if(!sheets.has(sheet)||row<firstRow||row>lastRow||typeof c.v!=='string')continue;
      const key=Excel.key(sheet,String(row));
      if(!rowHeaders.has(key))rowHeaders.set(key,[]);
      rowHeaders.get(key).push(id);
    }
    const componentLabels=new Set(Object.keys(componentKeys).flatMap(k=>fields[k]).map(label));
    const summaryGroups=[...rowHeaders.values()].filter(ids=>
      ids.some(id=>label(model.cells[id].v)==='总采购价') &&
      new Set(ids.map(id=>label(model.cells[id].v)).filter(v=>componentLabels.has(v))).size>=8
    ).map(ids=>({rows:[ids]}));
    function find(names, selected = costs) {
      const wanted = names.map(label);
      for (const name of wanted) {
        const matches=[];
        for (const group of selected) for (const row of group.rows) for (const header of row) {
          if(label(model.cells[header]?.v)!==name)continue;
          const [sheet,address]=Excel.split(header);
          matches.push(Excel.key(sheet,address.replace(/\d+$/,n=>Number(n)+1)));
        }
        const unique=[...new Set(matches)];
        if(unique.length>1){
          const ns=unique.map(read);
          if(!ns.every(v=>v===ns[0]||(numeric(v)&&numeric(ns[0])&&Math.abs(v-ns[0])<1e-8))){
            issues.push(`${names[0]}有多个不同金额来源（${unique.join('、')}），未擅自合并`);
            return null;
          }
        }
        if(unique.length)return unique[0];
      }
      return null;
    }
    const put = (key,id) => { if (!id) return; sources[key]=id; values[key]=read(id); };
    Object.entries(fields).forEach(([key,names]) => {
      const selected=['CI','CS'].includes(key)?(tax?[tax]:[]):costs;
      const issueStart=issues.length;
      const primary=find(names,selected);
      // Preserve established detail sources. Only repair unresolved mappings;
      // a later summary can intentionally use a different cost definition.
      if(primary)put(key,primary);
      else if(selected===costs){
        const fallback=find(names,summaryGroups);
        if(fallback){issues.splice(issueStart);put(key,fallback);}
      }
    });
    Object.entries(metricKeys).forEach(([key,metric]) => put(key,model.metrics[metric]));
    // Optional blank cost cells with an identified source are genuine blank
    // Excel inputs (arithmetic zero), unlike an unrecognised/missing column.
    for (const key of Object.keys(componentKeys)) if (sources[key]) {
      const c=evaluator.cell(sources[key]);
      if (!c?.f && (c?.v == null || c?.v === '')) values[key]=0;
    }
    const taxEntry = names => {
      if (!tax) return null;
      const i=tax.rows[0].findIndex(id=>names.map(label).includes(label(model.cells[id]?.v)));
      if(i<0)return null;
      // The deduction row is the first numeric result below the rate row;
      // do not read later product blocks or unrelated shipping calculations.
      const id=tax.rows[2]?.[i];
      return {rate:read(tax.rows[1]?.[i]),deduction:read(id),id};
    };
    const reductions = { AN:['纸箱类'],AR:['含税1%'],BE:['搪胶类3%'],BI:['车发类13%','车发'],BM:['车衣类13%'],AJ:['吸塑类6%','吸塑料'],CC:['运费含税9%'] };
    const after = {};
    Object.entries(reductions).forEach(([key,names])=>{
      const t=taxEntry(names);
      if (numeric(values[key]) && numeric(t?.deduction)) after[key]=values[key]-t.deduction;
    });
    const generalTax=taxEntry(['含税13%类']);
    // A component gets the pooled 13%-class deduction only if the original
    // tax-base formula actually depends on that component's summary cell.
    // This preserves ZURU's tax-free electronic/sewing and Cepia exceptions.
    let taxable = new Set();
    const hasTaxFormula = Boolean(generalTax?.id && evaluator.cell(generalTax.id)?.f && !evaluator.cell(generalTax.id)?.external_input);
    if(hasTaxFormula) { try{taxable=new Set(evaluator.dependencies(generalTax.id,true));}catch{} }
    for(const key of ['U','AB','AF','AS','AW','BA','BQ','BU','BY']) {
      if(!numeric(values[key]))continue;
      if(values[key]===0){after[key]=0;continue;}
      if(!sources[key] || !hasTaxFormula || !numeric(generalTax?.deduction))continue;
      if(taxable.has(sources[key])) {
        // Use the actual source formula, including partial taxable bases and
        // customer-specific factors, rather than assuming full cost × rate.
        try {
          const without = Excel.createEvaluator(model,{...overrides,[sources[key]]:{v:0,f:null,t:'n'}}).value(generalTax.id);
          if(numeric(without))after[key]=values[key]-(generalTax.deduction-without);
        }catch{}
      }
      else {
        // Not being a direct dependency does not prove tax exemption: aliases
        // may refer to the same detail cells. Leave ambiguous allocations blank.
        let refs=[];try{refs=evaluator.dependencies(sources[key],true);}catch{}
        if(!refs.some(id=>taxable.has(id))) after[key]=values[key];
      }
    }
    for(const key of ['H','L','P']) if(numeric(values[key])) after[key]=values[key]; // template component columns are pre-allocation; DC owns labor rebate
    const pairs={H:'I',L:'M',P:'Q',AB:'AC',AF:'AG',AJ:'AK',AN:'AO',AS:'AT',AW:'AX',BA:'BB',BE:'BF',BI:'BJ',BM:'BN',BQ:'BR',BU:'BV',BY:'BZ'};
    for(const [key,out] of Object.entries(pairs)) if(numeric(after[key])) {values[out]=after[key];sources[out]=`${sources[key] || ''} / 原表减税分项`;}
    if(numeric(values.T)&&numeric(after.U)) values.V=values.T+after.U;
    if(numeric(after.CC)&&numeric(values.CD)) values.CE=after.CC+values.CD;
    // Tax-class bases other than the explicit pooled base cannot be guessed
    // from a label alone (the source may use only part of a cost category).
    for(const [out,names] of Object.entries({CP:['含税1%'],CQ:['人工类13%'],CR:['运费含税9%'],CT:['纸箱类'],CU:['搪胶类3%'],CV:['车发类13%','车发'],CW:['车衣类13%'],CX:['吸塑类6%','吸塑料']})) {
      const t=taxEntry(names);
      if(numeric(t?.deduction)&&numeric(t?.rate)&&t.rate!==0) {values[out]=t.deduction/t.rate;sources[out]=`${t.id} / 原表税率`;}
      else if(t?.deduction===0&&t?.rate===0){values[out]=0;sources[out]=`${t.id} / 原表不减税`;}
    }
    // Match the requested template's procurement subtotal, but only when every
    // participating category was identified. Do not guess absent categories.
    const purchaseKeys=['AB','AF','AJ','AN','AR','AS','AW','BA','BE','BI','BM','BQ','BU','BY'];
    if(purchaseKeys.every(k=>numeric(values[k]))){values.AA=null;delete sources.AA;}
    sum('AA',purchaseKeys);
    const external=Object.values(model.cells).filter(c=>c.external_input&&c.f).length;
    if(external)issues.push(`${external}项外部引用沿用原表保存值`);
    // Report original errors and changed calculations, not just displayed cells.
    let errors=0,differences=0;
    for(const [id,c] of Object.entries(model.cells)) if(c.f&&!c.external_input){try{
      const v=evaluator.value(id);
      if(!Object.keys(overrides).length&&numeric(c.v)&&numeric(v)&&Math.abs(c.v-v)>Math.max(1e-8,Math.abs(c.v)*1e-9))differences++;
    }catch{errors++;}}
    if(errors)issues.push(`${errors}项原表公式错误，受影响结果留空`);
    if(differences)issues.push(`${differences}项重算与原表保存值不一致`);
  } else {
    const ordinary=buildQuoteSummary(quote,sections), s=ordinary.summary_values;
    Object.entries(componentKeys).forEach(([k,name])=>values[k]=ordinary.components_before_tax[name]??null);
    Object.entries(derivedKeys).forEach(([k,name])=>values[k]=s[name]??null);
    values.E=ordinary.quoted_price; values.F=Object.values(ordinary.components_before_tax).reduce((a,b)=>a+b,0);
    values.G=values.F-values.H-values.L-values.P;
    for(const [key,out] of Object.entries({H:'I',L:'M',P:'Q',AB:'AC',AF:'AG',AJ:'AK',AN:'AO',AS:'AT',AW:'AX',BA:'BB',BE:'BF',BI:'BJ',BM:'BN',BQ:'BR',BU:'BV',BY:'BZ'}))values[out]=s[`${componentKeys[key]}_after_tax`]??null;
    values.V=s.raw_material_after_tax;values.CE=s.freight_after_tax;
    issues.push('部门核价：按系统既有计算口径');
  }
  const sewingSection=(sections || []).find(section=>section.dept==='sewing');
  const sewingPayload=JSON.parse(sewingSection?.payload_json || '{}');
  const sewingTax=require('../../frontend/sewing-tax');
  if(sewingTax.hasSetting(sewingPayload, quote.customer)) {
    const shares=sewingTax.fractions(sewingPayload, quote.customer);
    let oldDeduction=0,newDeduction=0;
    const changedTaxTerms=[];
    for(const [input,out,tax,key] of [['BI','BJ','CV','sewing_hair'],['BM','BN','CW','sewing_cloth']]) {
      if(!numeric(values[input]) || !numeric(values[out])) continue;
      oldDeduction+=values[input]-values[out];
      values[tax]=values[input]*shares[key];
      formulas[tax]=`${input}1*${shares[key]}`;delete sources[tax];
      values[out]=values[input]-values[tax]*0.115;
      formulas[out]=`${input}1-${tax}1*11.5%`;delete sources[out];
      newDeduction+=values[tax]*0.115;
      changedTaxTerms.push(`${tax}1*11.5%`);
    }
    // Adjust only categories with a confirmed old deduction. A missing sibling
    // stays unknown and must not suppress the known category's tax correction.
    if(changedTaxTerms.length&&numeric(values.CY)) {
      const otherDeduction=values.CY-oldDeduction;
      values.CY=otherDeduction+newDeduction;
      formulas.CY=`${otherDeduction}+${changedTaxTerms.join('+')}`;delete sources.CY;
    }
  }
  // Apply the confirmed carton rule before totals. For an original workbook,
  // replace only its known carton deduction and retain all other deductions.
  const previousCartonDeduction=model&&numeric(values.AN)&&numeric(values.AO) ? values.AN-values.AO : null;
  values.AO=null;delete sources.AO;delete formulas.AO;
  calc('AO','AN1-AN1/1.1*11.5%',['AN'],x=>x-x/1.1*0.115);
  if(numeric(previousCartonDeduction)&&numeric(values.CY)) {
    const previousFormula=formulas.CY || String(values.CY);
    values.CY=values.CY-previousCartonDeduction+values.AN/1.1*0.115;
    formulas.CY=`(${previousFormula})-(${previousCartonDeduction})+AN1/1.1*11.5%`;delete sources.CY;
  }
  // Recalculate report relationships from verification inputs, using the
  // same field meanings as the confirmed quote summary. Source results must
  // not bypass these expressions merely because a cached value exists.
  for (const key of ['G','CH','CJ','CK','CL','CM','CN','CO','CZ','DA','DB','DD','DE','DF','DG','DH','CE','Z']) {
    values[key]=null; delete sources[key]; delete formulas[key];
  }
  calc('G','F1-SUM(H1,L1,P1)',['F','H','L','P'],(f,h,l,p)=>f-h-l-p);
  calc('CH','E1*0.4%',['E'],e=>e*0.004);
  calc('CE','CC1*(1-8.26%)+CD1',['CC','CD'],(freight,cabinet)=>freight*(1-0.0826)+cabinet);
  subtract('CZ','F','CY');
  // Derived summary relationships, independent of customer-specific tax rules.
  // User-confirmed labor columns directly reference the original unit costs.
  for(const [out,input] of [['I','H'],['M','L'],['Q','P']]) {
    values[out]=null;delete sources[out];delete formulas[out];
    calc(out,`${input}1`,[input],x=>x);
  }
  subtract('CK','E','G');subtract('CM','E','F');divide('CL','CK','E');divide('CN','CM','E');divide('CO','E','F');
  divide('Z','Y','E');divide('CJ','CI','E');divide('DA','E','CZ');
  subtract('DD','CZ','DC');subtract('DE','E','DD');subtract('DG','E','CZ');divide('DF','DE','E');divide('DH','DG','E');
  for(const [out,a,b,title] of [['CK','E','G','税前毛利'],['CM','E','F','税前利润'],['CZ','F','CY','减税后成本'],['DE','E','DD','减税后毛利'],['DG','E','CZ','减税后利润']]) {
    if([out,a,b].every(k=>numeric(values[k]))&&Math.abs(values[out]-(values[a]-values[b]))>0.005)
      issues.push(`${title}原表结果 ${values[out].toFixed(4)} 与汇总关系 ${ (values[a]-values[b]).toFixed(4)} 不一致；保留原表结果待核对`);
  }
  calc('DB','V1',['V'],x=>x);
  const amounts={J:'I',N:'M',R:'Q',W:'V',AD:'AC',AH:'AG',AL:'AK',AP:'AO',AU:'AT',AY:'AX',BC:'BB',BG:'BF',BK:'BJ',BO:'BN',BS:'BR',BW:'BV',CA:'BZ',CF:'CE',
    DI:'E',DJ:'F',DK:'CK',DM:'CM',DS:'CI',DU:'CY',DV:'DD',DX:'DE',DZ:'DG',EB:'DB',ED:'DC'};
  for(const [key,unit] of Object.entries(amounts))calc(key,`${unit}1*D1`,[unit,'D'],(x,y)=>x*y);
  calc('DO','(T1+U1)*D1',['T','U','D'],(a,b,q)=>(a+b)*q);
  // Correct template DQ's shifted D reference: quantity × all three labor costs.
  calc('DQ','(H1+L1+P1)*D1',['H','L','P','D'],(a,b,c,q)=>(a+b+c)*q);
  const ratios={K:'J',O:'N',S:'R',X:'W',AE:'AD',AI:'AH',AM:'AL',AQ:'AP',AV:'AU',AZ:'AY',BD:'BC',BH:'BG',BL:'BK',BP:'BO',BT:'BS',BX:'BW',CB:'CA',CG:'CF',DL:'DK',DN:'DM',DP:'DO',DR:'DQ',DT:'DS',DW:'DV',DY:'DX',EA:'DZ',EC:'EB',EE:'ED'};
  for(const [key,amount] of Object.entries(ratios))divide(key,amount,'DI');
  values.A=verificationCustomers.display(quote.customer);
  const missing=columns.slice(4).filter(c=>values[c.key]===null).map(c=>c.label);
  if(missing.length)issues.push(`${missing.length}个栏目缺少可确认的来源或计算参数`);
  return {id:quote.id,version_id:version.id,version:version.label||`V${version.version_no}`,status:version.status,status_label:statusLabels[version.status]||version.status,
    values,formulas,sources,issues:[...new Set(issues)],missing,...resolveWorkshop(quote,sections),source_type:model?'原表公式核价':'部门核价'};
}

function customerTotals(rows) {
  const customers=[...new Set(rows.map(r=>r.values.A))];
  const keys=['D','DI','DJ','DK','DM','DU','DX','DZ'];
  return customers.map(customer=>{
    const group=rows.filter(r=>r.values.A===customer), totals={};
    // A partial total is not a customer total. Missing any contributor leaves
    // that measure unavailable; the coverage column explains why.
    for(const key of keys)totals[key]=group.every(r=>numeric(r.values[key]))?group.reduce((n,r)=>n+r.values[key],0):null;
    return {customer,count:group.length,quantity_count:group.filter(r=>numeric(r.values.D)).length,totals};
  });
}

function buildVerificationWorkbook(rows) {
  const wb=require('./verificationWorkshopExport').buildWorkbook(rows,columns);
  if(!rows.some(r=>r.native))return wb;
  const blue='FFD9E2F3',border={style:'thin',color:{argb:'FF8091A5'}};
  function style(ws,count) {
    ws.views=[{state:'frozen',xSplit:3,ySplit:3,showGridLines:false}];
    ws.getRow(1).height=30;ws.getRow(2).height=38;ws.getRow(3).height=64;
    ws.autoFilter={from:{row:3,column:1},to:{row:Math.max(3,ws.rowCount),column:count}};
    ws.eachRow((row,n)=>row.eachCell({includeEmpty:true},(cell,c)=>{
      cell.font={name:'Arial',size:10,bold:n===1||n===3,color:{argb:n===3?'FF143455':'FF1F2937'}};
      cell.alignment={vertical:'middle',wrapText:n<=3||c<=3};
      if(n>=3)cell.border={top:border,bottom:border,left:border,right:border};
      if(n===3)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:blue}};
    }));
    ws.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:0,fitToHeight:0,printTitlesRow:'1:3'};
  }
  const audit=wb.addWorksheet('原总表核对');
  audit.addRow(['客户','货号','文件','原单元格','栏目','原表值','系统重算值','差额','核对结果','原公式（文本，供追溯）']);
  const groups=new Map();
  for(const r of rows){
    const n=r.native;if(!n)continue;
    if(!n.available){audit.addRow([r.values.A,r.values.B,n.file||'','','','','','',n.issue]);continue;}
    const key=n.file;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);
    for(const c of n.columns){
      if(n.original[c.key]==null&&!n.formulas[c.key])continue;
      const d=n.differences.find(x=>x.column===c.key),e=n.errors.find(x=>x.column===c.key);
      audit.addRow([r.values.A,r.values.B,n.file,`${n.sheet}!${c.key}${n.row}`,c.label,n.original[c.key],n.current[c.key],d?.delta??null,
        e?e.message:d?d.reason:n.external.includes(c.key)?'依赖外部缓存，未独立验证':n.formulas[c.key]?'公式重算一致':'原总表输入，未独立验证',n.formulas[c.key]?'='+n.formulas[c.key]:'']);
    }
  }
  let groupIndex=0;
  for(const [file,group] of groups){
    const n=group[0].native,ws=wb.addWorksheet(`原总表_${++groupIndex}`);
    ws.addRow([file]);ws.addRow(['原布局栏目；数值为系统重算结果。原公式保留在单元格批注及核对页，不写入缺少依赖的 Excel 公式。']);
    ws.addRow(n.columns.map(c=>c.label||c.key));
    for(const r of group){const nr=r.native,row=ws.addRow(n.columns.map(c=>nr.current[c.key]));n.columns.forEach((c,i)=>{
      const cell=row.getCell(i+1);cell.numFmt=nr.formats[c.key]||'General';
      cell.note=`${nr.sheet}!${c.key}${nr.row}\n原值：${nr.original[c.key]??'空白'}\n原公式：${nr.formulas[c.key]||'无（直接输入）'}`;
      if(nr.differences.some(d=>d.column===c.key)||nr.errors.some(e=>e.column===c.key))cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFE4B5'}};
    });}
    n.columns.forEach((c,i)=>{ws.getColumn(i+1).width=i<3?24:15;ws.getColumn(i+1).hidden=c.hidden;});style(ws,n.columns.length);
  }
  audit.views=[{state:'frozen',xSplit:2,ySplit:1}];audit.autoFilter=`A1:J${Math.max(audit.rowCount,1)}`;
  [20,25,55,26,26,20,20,20,36,60].forEach((w,i)=>audit.getColumn(i+1).width=w);
  audit.getRow(1).font={bold:true};
  const exceptions=wb.addWorksheet('差异与错误');exceptions.addRow(audit.getRow(1).values.slice(1));
  audit.eachRow((row,i)=>{if(i>1&&!['公式重算一致','原总表输入，未独立验证','依赖外部缓存，未独立验证'].includes(row.getCell(9).value))exceptions.addRow(row.values.slice(1));});
  [20,25,55,26,26,20,20,20,36,60].forEach((w,i)=>exceptions.getColumn(i+1).width=w);
  exceptions.views=[{state:'frozen',xSplit:2,ySplit:1}];exceptions.autoFilter=`A1:J${exceptions.rowCount}`;exceptions.getRow(1).font={bold:true};
  return wb;
}

module.exports={columns,template,quantityFor,buildVerificationRow,customerTotals,buildVerificationWorkbook,numeric,statusLabels};
