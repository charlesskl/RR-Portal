'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const XLSX=require('xlsx');
const Excel=require('../../frontend/excel-formulas');
const clean=v=>String(v??'').replace(/[\s（）()]/g,'').toUpperCase();
const num=v=>typeof v==='number'&&Number.isFinite(v);
const equal=(a,b)=>num(a)&&num(b)?Math.abs(a-b)<=Math.max(0.000001,Math.abs(b)*1e-9):(a??null)===(b??null);

// Read-only extraction. Keep original coordinates, formulas and saved values;
// never resolve a missing external workbook with today's global price basis.
function readSummarySource(file){
  const workbook=XLSX.readFile(file,{cellFormula:true,cellNF:true,cellStyles:true});
  const sheetName=workbook.SheetNames.find(n=>['总表','總表'].includes(n));
  if(!sheetName)throw new Error(`${path.basename(file)} 未找到总表`);
  const sheet=workbook.Sheets[sheetName],rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:null});
  const headerIndex=rows.findIndex(r=>r.some(v=>clean(v)==='货号')&&r.some(v=>clean(v)==='客名'));
  if(headerIndex<0)throw new Error('总表缺少客名、货号表头');
  const header=rows[headerIndex],skuColumn=header.findIndex(v=>clean(v)==='货号');
  const columns=header.map((v,i)=>({key:XLSX.utils.encode_col(i),label:v??'',hidden:!!sheet['!cols']?.[i]?.hidden}));
  const dataRows=rows.flatMap((r,i)=>i>headerIndex&&r[skuColumn]!=null&&clean(r[skuColumn])!=='货号'&&clean(r[skuColumn])!=='0'
    ?[{row:i+1,sku:String(r[skuColumn]),product:r[2]??null}]:[]);
  const cells={},queue=[];
  function include(id){
    if(Object.hasOwn(cells,id))return;
    const [name,address]=Excel.split(id),c=workbook.Sheets[name]?.[address];
    cells[id]=c?{v:c.v??null,t:c.t,...(c.f?{f:c.f}:{}),...(c.z?{z:c.z}:{})}:{v:null,...(!workbook.Sheets[name]?{missing_sheet:true}:{})};
    queue.push(id);
  }
  for(const row of dataRows)for(const c of columns)include(Excel.key(sheetName,`${c.key}${row.row}`));
  for(let i=0;i<queue.length;i++){
    const id=queue[i],cell=cells[id];if(!cell.f)continue;
    try{
      const refs=Excel.references(cell.f,Excel.split(id)[0]);refs.forEach(include);
      if(refs.some(r=>cells[r]?.missing_sheet))cell.external_input=true;
    }catch(e){cell.parse_error=e.message;}
  }
  return {fingerprint:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),sheet:sheetName,
    columns,header_row:headerIndex+1,rows:dataRows,cells};
}
let registry;
function sources(){
  if(!registry){const file=path.join(__dirname,'../db/verification-source-summaries.json');registry=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];}
  return registry;
}
function matchRow(source,quote,legacy){
  if(legacy.source_summary_row)return source.rows.find(r=>r.row===legacy.source_summary_row)||null;
  const names=[quote.quote_no,legacy.source_item,legacy.source_detail_sheet].map(clean);
  const matches=source.rows.filter(r=>names.includes(clean(r.sku)));
  if(matches.length===1)return matches[0];
  // Known naming differences from the original Sky Castle workbook only.
  const aliases={'SR460（无CDU':'SR460-无CDU','SR8003-CDU-24 ':'SR8003CDU-24'};
  const alias=aliases[legacy.source_detail_sheet];
  return alias?source.rows.find(r=>clean(r.sku)===clean(alias))||null:null;
}
function buildSourceRow(quote,sections,available=sources()){
  const payloads=sections.map(s=>JSON.parse(s.payload_json||'{}'));
  const sales=sections.findIndex(s=>s.dept==='sales'),legacy=payloads[sales]?.legacy_import,model=legacy?.excel_model;
  if(!model)return null;
  const source=available.find(s=>s.fingerprint===legacy.source_fingerprint);
  if(!source)return {available:false,issue:'尚未提取对应导入文件的原总表'};
  const row=matchRow(source,quote,legacy);
  if(!row)return {available:false,issue:'原文件总表没有该货号，当前明细仍保留',file:legacy.source_file};
  const overrides=Object.assign({},...payloads.map(p=>p.excel_native?.inputs||{}));
  const cells={...source.cells};
  // The summary's own definitions must not be replaced by detail snapshots.
  // Existing imported detail cells and edits remain the live calculation source.
  for(const [id,cell] of Object.entries(model.cells))if(Excel.split(id)[0]!==source.sheet&&!cell.missing_sheet)cells[id]=cell;
  const evaluator=Excel.createEvaluator({cells},overrides);
  const baseline=Excel.createEvaluator({cells:source.cells});
  // Exclude scratch calculations to the right of the last actual header;
  // retain interior blank columns because they are part of the source layout.
  const columns=source.columns.slice(0,source.columns.findLastIndex(c=>String(c.label).trim())+1);
  const original={},current={},formulas={},formats={},differences=[],errors=[],inputs=[],external=[];
  let compared=0;
  for(const column of columns){
    const id=Excel.key(source.sheet,`${column.key}${row.row}`),saved=source.cells[id]||{v:null};
    const cell={...evaluator.cell(id),v:saved.v};
    original[column.key]=cell.t==='e'?({7:'#DIV/0!',15:'#VALUE!',23:'#REF!',29:'#NAME?',42:'#N/A'}[cell.v]||'#ERROR!'):cell.v;
    formulas[column.key]=cell.f||'';formats[column.key]=cell.z||'';
    if(cell.t==='e'){current[column.key]=null;errors.push({column:column.key,label:column.label,cell:id,original:original[column.key],message:'原文件已有错误',formula:cell.f||''});continue;}
    if(!cell.f){current[column.key]=cell.v;if(cell.v!=null)inputs.push(column.key);continue;}
    try{
      const deps=[id,...evaluator.dependencies(id,true)];
      if(deps.some(k=>cells[k]?.external_input))external.push(column.key);
      const result=evaluator.value(id),value=result==null?0:result;
      if(deps.some(k=>evaluator.fallback(k))&&!external.includes(column.key))external.push(column.key);
      current[column.key]=value;compared++;
      if(!equal(value,cell.v)){
        let sourceRecalculated=null;try{sourceRecalculated=baseline.value(id)??0;}catch{}
        differences.push({column:column.key,label:column.label,cell:id,original:cell.v,current:value,sourceRecalculated,
          reason:equal(value,sourceRecalculated)?'原文件现有公式重算也与保存值不一致':'系统导入数据或修改导致差异',
          delta:num(value)&&num(cell.v)?value-cell.v:null,formula:cell.f});
      }
    }catch(e){current[column.key]=null;errors.push({column:column.key,label:column.label,cell:id,original:cell.v,message:e.message,formula:cell.f});}
  }
  return {available:true,file:legacy.source_file,sheet:source.sheet,row:row.row,columns,
    original,current,formulas,formats,differences,errors,inputs,external,compared,
    period:source.columns.find(c=>/接单/.test(c.label))?.label||'原总表数量'};
}

// Header-based alignment, never positional alignment across customer files.
// In particular ZANZOON has an extra unlabelled price column before 货价.
function unifiedFromSource(native,columns){
  const canonical=v=>clean(v).replace(/減/g,'减').replace(/退税/g,'减税').replace(/码点/g,'码数').replace(/占比%$/,'占比').replace(/2026年1–7月|2026年1-7月份/g,'');
  const values={},sourceColumns={};
  for(const c of columns){
    let candidates=native.columns.filter(s=>s.label&&canonical(s.label)===canonical(c.label));
    if(c.key==='D')candidates=native.columns.filter(s=>/接单.*数量|接单数/.test(s.label));
    // Some templates repeat a label for unit cost and quantity-weighted total.
    // Align occurrences only when both layouts have exactly the same count.
    const targetMatches=columns.filter(t=>canonical(t.label)===canonical(c.label));
    if(candidates.length>1&&candidates.length===targetMatches.length)candidates=[candidates[targetMatches.findIndex(t=>t.key===c.key)]];
    if(candidates.length===1){const key=candidates[0].key;values[c.key]=native.current[key]??null;sourceColumns[c.key]=key;}
    else values[c.key]=null;
  }
  return {values,sourceColumns};
}
function sourceQuantity(quote,sections){
  const legacy=JSON.parse(sections.find(s=>s.dept==='sales')?.payload_json||'{}').legacy_import;
  if(!legacy)return null;
  const source=sources().find(s=>s.fingerprint===legacy.source_fingerprint);
  const row=source&&matchRow(source,quote,legacy);
  const cols=source?.columns.filter(c=>/接单.*数量|接单数/.test(c.label))||[];
  if(!row||cols.length!==1)return [];
  const id=Excel.key(source.sheet,`${cols[0].key}${row.row}`),cell=source.cells[id];
  if(!num(cell?.v))return [];
  return [{customer:quote.customer,sku:quote.quote_no,qty:cell.v,source:`${legacy.source_file} / ${id}（${cols[0].label}）`}];
}
module.exports={readSummarySource,buildSourceRow,unifiedFromSource,matchRow,equal,sourceQuantity};
