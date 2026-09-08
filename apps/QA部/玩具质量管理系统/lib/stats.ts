import type { ComplaintRecord } from "./types";

export const MISSING = "未设置";
export const RISK_RULES = {
  repeatedWindowDays: 90,
  repeatedCount: 3,
  highCount: 5,
  growthWarning: 0.25,
  growthHigh: 0.5,
} as const;

export type ComplaintFilters = {
  q:string;from:string;to:string;customer:string;series:string;sku:string;
  issue:string;status:string;classified:string;sort:string;
};

export const emptyFilters:ComplaintFilters={q:"",from:"",to:"",customer:"",series:"",sku:"",issue:"",status:"",classified:"",sort:"date-desc"};
const clean=(value:unknown)=>typeof value==="string"?value.trim():"";
export function safeLabel(value:unknown,fallback=MISSING){return clean(value)||fallback}
export function validDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00`))}
export function customerOf(record:ComplaintRecord){
  const raw=Object.entries(record.rawData||{}).find(([key,value])=>/(customer|client|retailer|buyer|account|客户|客戶)/i.test(key)&&clean(value));
  return clean(raw?.[1])||clean(record.store)||MISSING;
}
export function statusOf(record:ComplaintRecord){
  if(!record.issueType||record.status==="Needs classification")return "待分类";
  if(record.workflowStatus)return record.workflowStatus;
  const raw=Object.entries(record.rawData||{}).find(([key,value])=>/(status|状态|狀態)/i.test(key)&&clean(value));
  const value=clean(raw?.[1]).toLowerCase();
  if(!value)return "未设置状态";
  if(/closed|resolved|complete|已关闭|已解決|已解决|完成/.test(value))return "已关闭";
  if(/progress|processing|处理中|處理中|in process/.test(value))return "处理中";
  if(/pending|open|待处理|待處理|imported/.test(value))return "待处理";
  return "未设置状态";
}
export const STATUS_COLORS:Record<string,string>={"待分类":"#f36b21","待处理":"#f59e0b","处理中":"#3b82f6","已关闭":"#10b981","未设置状态":"#a3a3a3"};
export function groupCount(records:ComplaintRecord[],pick:(r:ComplaintRecord)=>string|null|undefined){
  const map=new Map<string,number>();
  for(const record of records){const key=safeLabel(pick(record),MISSING);map.set(key,(map.get(key)||0)+1)}
  return [...map.entries()].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,"zh-CN"));
}
export function percent(value:number,total:number,digits=1){return total?`${(value/total*100).toFixed(digits)}%`:`${(0).toFixed(digits)}%`}
export function parseFilters(search:string){
  const params=new URLSearchParams(search);
  const next={...emptyFilters};
  (Object.keys(next) as (keyof ComplaintFilters)[]).forEach(key=>{const value=params.get(key);if(value!==null)next[key]=value});
  return next;
}
export function queryFor(filters:Partial<ComplaintFilters>){
  const params=new URLSearchParams();
  for(const [key,value] of Object.entries(filters)){if(value&&value!=="date-desc")params.set(key,value)}
  const text=params.toString();return text?`?${text}`:"";
}
export function filterComplaints(records:ComplaintRecord[],filters:ComplaintFilters){
  const q=filters.q.trim().toLocaleLowerCase("zh-CN");
  const result=records.filter(record=>{
    const issue=safeLabel(record.issueType,"未分类");
    const customer=customerOf(record);
    const haystack=[record.sourceSubmissionId,record.productSku,record.productName,record.primarySeries,record.secondarySeries,issue,customer,record.store,record.country,record.batchCode,record.complaintMessageOriginal,record.complaintMessageZhFinal,record.complaintMessageZhMachine].map(value=>clean(value).toLocaleLowerCase("zh-CN"));
    return (!q||haystack.some(value=>value.includes(q)))
      &&(!filters.from||record.contactDate>=filters.from)
      &&(!filters.to||record.contactDate<=filters.to)
      &&(!filters.customer||customer===filters.customer)
      &&(!filters.series||(filters.series===MISSING?!clean(record.primarySeries):record.primarySeries===filters.series))
      &&(!filters.sku||record.productSku===filters.sku)
      &&(!filters.issue||issue===filters.issue)
      &&(!filters.status||statusOf(record)===filters.status)
      &&(!filters.classified||(filters.classified==="yes"?Boolean(record.issueType):!record.issueType));
  });
  return result.sort((a,b)=>{
    if(filters.sort==="date-asc")return a.contactDate.localeCompare(b.contactDate)||a.id.localeCompare(b.id);
    if(filters.sort==="series")return a.primarySeries.localeCompare(b.primarySeries,"zh-CN")||b.contactDate.localeCompare(a.contactDate);
    if(filters.sort==="sku")return a.productSku.localeCompare(b.productSku,"zh-CN")||b.contactDate.localeCompare(a.contactDate);
    return b.contactDate.localeCompare(a.contactDate)||b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id);
  });
}
export function monthKey(date:Date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`}
export type DashboardRange="month"|"prev-month"|"3m"|"6m"|"year"|"custom";
const dateKey=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const atDate=(value:string)=>new Date(`${value}T00:00:00`);
export function latestDataDate(records:ComplaintRecord[]){return records.map(record=>record.contactDate).filter(validDate).sort().at(-1)||dateKey(new Date())}
export function dashboardDateRange(records:ComplaintRecord[],range:DashboardRange,customFrom="",customTo=""){
  const anchor=atDate(latestDataDate(records));let from:Date;let to=new Date(anchor);
  if(range==="prev-month"){const today=new Date();from=new Date(today.getFullYear(),today.getMonth()-1,1);to=new Date(today.getFullYear(),today.getMonth(),0)}
  else if(range==="month"){const today=new Date();from=new Date(today.getFullYear(),today.getMonth(),1);to=today}
  else if(range==="3m"){from=new Date(anchor.getFullYear(),anchor.getMonth()-2,1)}
  else if(range==="year"){from=new Date(anchor.getFullYear(),0,1)}
  else if(range==="custom"&&validDate(customFrom)&&validDate(customTo)){from=atDate(customFrom);to=atDate(customTo);if(from>to)[from,to]=[to,from]}
  else{from=new Date(anchor.getFullYear(),anchor.getMonth()-5,1)}
  const days=Math.max(1,Math.round((to.getTime()-from.getTime())/86400000)+1);
  const previousTo=new Date(from);previousTo.setDate(previousTo.getDate()-1);const previousFrom=new Date(previousTo);previousFrom.setDate(previousFrom.getDate()-days+1);
  return {from:dateKey(from),to:dateKey(to),previousFrom:dateKey(previousFrom),previousTo:dateKey(previousTo),days,grain:days<=45?"day":days<=150?"week":"month" as "day"|"week"|"month"};
}
export type TrendPoint={label:string;value:number;from:string;to:string};
export function trendForRange(records:ComplaintRecord[],from:string,to:string,grain:"day"|"week"|"month"):TrendPoint[]{
  if(!validDate(from)||!validDate(to))return [];
  const counts=(start:string,end:string)=>records.filter(record=>record.contactDate>=start&&record.contactDate<=end).length;
  const points:TrendPoint[]=[];let cursor=atDate(from);const end=atDate(to);
  while(cursor<=end){
    const start=new Date(cursor);let finish=new Date(cursor);
    if(grain==="week")finish.setDate(finish.getDate()+6);
    if(grain==="month")finish=new Date(cursor.getFullYear(),cursor.getMonth()+1,0);
    if(finish>end)finish=end;
    const startKey=dateKey(start),finishKey=dateKey(finish);
    points.push({label:grain==="day"?`${start.getMonth()+1}/${start.getDate()}`:grain==="week"?`${start.getMonth()+1}/${start.getDate()}周`:`${start.getMonth()+1}月`,value:counts(startKey,finishKey),from:startKey,to:finishKey});
    cursor=new Date(finish);cursor.setDate(cursor.getDate()+1);
  }
  return points;
}
export function lastMonths(records:ComplaintRecord[],count=12){
  const latest=records.map(record=>record.contactDate).filter(validDate).sort().at(-1);
  const anchor=latest?new Date(`${latest}T00:00:00`):new Date();
  const counts=new Map<string,number>();records.forEach(record=>{const key=record.contactDate.slice(0,7);counts.set(key,(counts.get(key)||0)+1)});
  return Array.from({length:count},(_,index)=>{const date=new Date(anchor.getFullYear(),anchor.getMonth()-(count-1-index),1);const key=monthKey(date);return {label:key,value:counts.get(key)||0,key}});
}
export function monthlyTrend(records:ComplaintRecord[]){return lastMonths(records,8)}
export function currentMonthMetrics(records:ComplaintRecord[]){
  const latest=records.map(record=>record.contactDate).filter(validDate).sort().at(-1);
  const anchor=latest?new Date(`${latest}T00:00:00`):new Date();const current=monthKey(anchor);
  const previous=monthKey(new Date(anchor.getFullYear(),anchor.getMonth()-1,1));
  const currentCount=records.filter(record=>record.contactDate.startsWith(current)).length;
  const previousCount=records.filter(record=>record.contactDate.startsWith(previous)).length;
  const change=previousCount?(currentCount-previousCount)/previousCount:null;
  return {current,previous,currentCount,previousCount,change};
}
export function recurrentRecords(records:ComplaintRecord[]){
  const groups=new Map<string,ComplaintRecord[]>();
  for(const record of records){if(!record.issueType)continue;const key=`${record.productSku||record.primarySeries}\u0000${record.issueType}`;groups.set(key,[...(groups.get(key)||[]),record])}
  const recurring=new Set<string>();
  for(const items of groups.values()){
    const sorted=items.filter(item=>validDate(item.contactDate)).sort((a,b)=>a.contactDate.localeCompare(b.contactDate));
    for(let i=0;i<sorted.length;i++){const end=new Date(`${sorted[i].contactDate}T00:00:00`);const window=sorted.filter(item=>{const day=new Date(`${item.contactDate}T00:00:00`);const delta=(end.getTime()-day.getTime())/86400000;return delta>=0&&delta<=RISK_RULES.repeatedWindowDays});if(window.length>=RISK_RULES.repeatedCount)window.forEach(item=>recurring.add(item.id))}
  }
  return records.filter(record=>recurring.has(record.id));
}
export type RepeatGroup={key:string;strategy:"sku"|"series";sku:string;series:string;issue:string;count:number;recordIds:string[]};
export function repeatSummary(records:ComplaintRecord[],windowEnd?:string){
  const valid=records.filter(record=>record.issueType&&validDate(record.contactDate));const end=atDate(windowEnd&&validDate(windowEnd)?windowEnd:latestDataDate(valid));const start=new Date(end);start.setDate(start.getDate()-RISK_RULES.repeatedWindowDays+1);
  const groups=new Map<string,{strategy:"sku"|"series";items:ComplaintRecord[]}>();
  for(const record of valid){const date=atDate(record.contactDate);if(date<start||date>end)continue;const strategy=clean(record.productSku)?"sku":"series";const subject=strategy==="sku"?record.productSku:record.primarySeries;const key=`${strategy}\u0000${subject}\u0000${record.issueType}`;const current=groups.get(key);groups.set(key,{strategy,items:[...(current?.items||[]),record]})}
  const repeated:RepeatGroup[]=[];
  for(const [key,group] of groups){if(group.items.length<RISK_RULES.repeatedCount)continue;const first=group.items[0];repeated.push({key,strategy:group.strategy,sku:first.productSku,series:first.primarySeries,issue:first.issueType||MISSING,count:group.items.length,recordIds:group.items.map(item=>item.id)})}
  repeated.sort((a,b)=>b.count-a.count||a.key.localeCompare(b.key));const ids=new Set(repeated.flatMap(group=>group.recordIds));
  return {groups:repeated,records:records.filter(record=>ids.has(record.id)),skuGroups:repeated.filter(group=>group.strategy==="sku").length,seriesFallbackGroups:repeated.filter(group=>group.strategy==="series").length};
}
export type RiskRow={key:string;series:string;sku:string;issue:string;count:number;previous:number;growth:number|null;level:"高"|"中";recordIds:string[];customers:string[];lastDate:string;strategy:"sku"|"series";triggerRules:string[]};
export function riskRows(records:ComplaintRecord[]){
  const groups=new Map<string,ComplaintRecord[]>();for(const record of records){if(!record.issueType)continue;const key=`${record.primarySeries}\u0000${record.productSku}\u0000${record.issueType}`;groups.set(key,[...(groups.get(key)||[]),record])}
  const rows:RiskRow[]=[];
  for(const [key,items] of groups){const dates=items.map(item=>item.contactDate).filter(validDate).sort();if(!dates.length)continue;const end=new Date(`${dates.at(-1)}T00:00:00`);const start=new Date(end);start.setDate(start.getDate()-RISK_RULES.repeatedWindowDays+1);const priorStart=new Date(start);priorStart.setDate(priorStart.getDate()-RISK_RULES.repeatedWindowDays);const currentItems=items.filter(item=>{const date=new Date(`${item.contactDate}T00:00:00`);return date>=start&&date<=end});const previous=items.filter(item=>{const date=new Date(`${item.contactDate}T00:00:00`);return date>=priorStart&&date<start}).length;const growth=previous?(currentItems.length-previous)/previous:currentItems.length?null:0;if(currentItems.length<RISK_RULES.repeatedCount&&!(growth!==null&&growth>=RISK_RULES.growthWarning))continue;const level=currentItems.length>=RISK_RULES.highCount||(growth!==null&&growth>=RISK_RULES.growthHigh)?"高":"中";const triggerRules:string[]=[];if(currentItems.length>=RISK_RULES.highCount)triggerRules.push(`近 ${RISK_RULES.repeatedWindowDays} 天达到 ${RISK_RULES.highCount} 条`);if(growth!==null&&growth>=RISK_RULES.growthHigh)triggerRules.push(`较上期增长 ${(growth*100).toFixed(1)}%`);else if(growth!==null&&growth>=RISK_RULES.growthWarning)triggerRules.push(`较上期增长 ${(growth*100).toFixed(1)}%`);if(!triggerRules.length&&currentItems.length>=RISK_RULES.repeatedCount)triggerRules.push(`近 ${RISK_RULES.repeatedWindowDays} 天重复 ${currentItems.length} 条`);rows.push({key,series:items[0].primarySeries,sku:items[0].productSku,issue:items[0].issueType||MISSING,count:currentItems.length,previous,growth,level,recordIds:currentItems.map(item=>item.id),customers:[...new Set(currentItems.map(customerOf))].sort((a,b)=>a.localeCompare(b,"zh-CN")),lastDate:dates.at(-1)||"",strategy:clean(items[0].productSku)?"sku":"series",triggerRules})}
  return rows.sort((a,b)=>(a.level==="高"?0:1)-(b.level==="高"?0:1)||b.count-a.count||a.key.localeCompare(b.key));
}
