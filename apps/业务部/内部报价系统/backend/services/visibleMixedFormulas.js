'use strict';
const {relocateFormula}=require('./groupMixedSheets');
// Move calculation ownership to visible cells before removing private sources.
function visibleMixedFormulas(wb){
 const hidden=new Map(wb.worksheets.filter(s=>s.state!=='visible').map(s=>[s.name,s]));
 const quote=n=>"'"+n.replace(/'/g,"''")+"'";
 const id=(s,a)=>s+'!'+a.replace(/\$/g,'');
 const owners=new Map(),originals=new Map();
 const ref=/^(?:'((?:[^']|'')+)'|([\p{L}_][\p{L}\p{N}_.]*))!(\$?[A-Z]+\$?\d+)$/u;
 const simple=f=>{let t=f;while(t.startsWith('(')&&t.endsWith(')'))t=t.slice(1,-1);return t.match(ref);};
 for(const s of wb.worksheets.filter(s=>s.state==='visible'))s.eachRow(r=>r.eachCell(c=>{
  if(!c.formula)return;originals.set(c,c.formula);
  const m=simple(c.formula),name=m&&(m[1]?.replace(/''/g,"'")||m[2]);
  if(m&&hidden.has(name)&&!owners.has(id(name,m[3])))owners.set(id(name,m[3]),{sheet:s.name,address:c.address,cell:c});
 }));
 const rangeRefs=(s,a,b)=>{
  const ws=wb.getWorksheet(s),first=ws.getCell(a.replace(/\$/g,'')),last=ws.getCell(b.replace(/\$/g,'')),out=[];
  for(let r=first.row;r<=last.row;r++)for(let col=first.col;col<=last.col;col++)out.push(quote(s)+'!'+ws.getCell(r,col).address);
  return out;
 };
 const range="'((?:[^']|'')+)'!(\\$?[A-Z]+\\$?\\d+):(\\$?[A-Z]+\\$?\\d+)";
 function expandRanges(f){
  f=f.replace(new RegExp('SUMPRODUCT\\('+range+','+range+'\\)','g'),(all,s,a,b,t,c,d)=>{
   s=s.replace(/''/g,"'");t=t.replace(/''/g,"'");if(!hidden.has(s)&&!hidden.has(t))return all;
   const x=rangeRefs(s,a,b),y=rangeRefs(t,c,d);if(x.length!==y.length)throw Error('NA计算范围不一致');
   return '('+x.map((v,i)=>`(${v}*${y[i]})`).join('+')+')';
  });
  f=f.replace(new RegExp('SUMIF\\('+range+',("[<>=]+"&[^,()]+),'+range+'\\)','g'),(all,s,a,b,criterion,t,c,d)=>{
   s=s.replace(/''/g,"'");t=t.replace(/''/g,"'");if(!hidden.has(s)&&!hidden.has(t))return all;
   const x=rangeRefs(s,a,b),y=rangeRefs(t,c,d),m=criterion.match(/^"([<>=]+)"&(.+)$/);if(x.length!==y.length)throw Error('啤工计算范围不一致');
   return '('+x.map((v,i)=>`IF(${v}${m[1]}${m[2]},${y[i]},0)`).join('+')+')';
  });
  f=f.replace(new RegExp('COUNTIF\\('+range+',([^,()]+)\\)','g'),(all,s,a,b,c)=>{
   s=s.replace(/''/g,"'");if(!hidden.has(s))return all;
   return '('+rangeRefs(s,a,b).map(v=>`IF(${v}=${c},1,0)`).join('+')+')';
  });
  return f.replace(new RegExp('SUM\\('+range+'\\)','g'),(all,s,a,b)=>{
   s=s.replace(/''/g,"'");return hidden.has(s)?'('+rangeRefs(s,a,b).join('+')+')':all;
  });
 }
 const tokens=/"(?:[^"]|"")*"|(?:'((?:[^']|'')+)'|([\p{L}_][\p{L}\p{N}_.]*))!(\$?[A-Z]+\$?\d+)(?::(\$?[A-Z]+\$?\d+))?/gu;
 function compact(f){
  let previous;
  do{previous=f;
   // Charges multiplied by a saved zero rate contribute zero; remove their
   // unused expression instead of repeating it once for every product.
   f=f.replace(/\*0\/100/g,'*0');
   for(let end=f.indexOf(')*0');end>=0;end=f.indexOf(')*0',end+1)){
    if(/[\d.]/.test(f[end+3]||''))continue;
    let depth=1,start=end-1;for(;start>=0;start--){if(f[start]===')')depth++;if(f[start]==='(')depth--;if(!depth)break;}
    if(start>=0&&!/[A-Z]/.test(f[start-1]||'')){f=f.slice(0,start)+'0'+f.slice(end+3);end=start;}
   }
   f=f.replace(/\(([\d. +*/-]+)\)/g,(all,expression)=>{
   // Only literal numeric arithmetic is folded; live cell references stay live.
   try{const n=Function('return ('+expression+')')();return Number.isFinite(n)?String(n):all;}catch{return all;}
  });}while(f!==previous);
  return f;
 }
 function rewrite(f,stack=new Set()){
  return compact(expandRanges(f).replace(tokens,(all,q,p,a,b)=>{
   if(all.startsWith('"'))return all;const s=q?.replace(/''/g,"'")||p;if(!hidden.has(s))return all;
   if(b)throw Error('尚未展开的计算范围：'+all);
   const key=id(s,a),owner=owners.get(key);if(owner)return quote(owner.sheet)+'!'+owner.address;
   return '('+expand(s,a,stack)+')';
  }));
 }
 function expand(s,a,stack){
  const key=id(s,a);if(stack.has(key))throw Error('计算源循环引用：'+key);
  const next=new Set(stack);next.add(key);const cell=hidden.get(s).getCell(a.replace(/\$/g,''));
  if(cell.formula)return rewrite(relocateFormula(cell.formula,{name:s,offset:0,qualifyLocal:true},new Map()),next);
  if(cell.value==null)return '0';if(typeof cell.value==='number')return String(cell.value);
  if(typeof cell.value==='boolean')return cell.value?'TRUE':'FALSE';
  return '"'+String(cell.value).replace(/"/g,'""')+'"';
 }
 for(const [cell,formula] of originals){
  const m=simple(formula),s=m&&(m[1]?.replace(/''/g,"'")||m[2]);
  const f=m&&hidden.has(s)?expand(s,m[3],new Set()):rewrite(formula);
  if(f.length>8192)throw Error('展开后的公式超出Excel长度限制：'+cell.address);
  cell.value={formula:f,result:cell.result};
 }
 for(const s of hidden.values())wb.removeWorksheet(s.id);
}
module.exports={visibleMixedFormulas};
