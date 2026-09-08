import type { CAPInput, CAPRecord, ComplaintRecord, ComplaintUpdate, ComplaintWorkflowStatus, ImportSummary, IssueTypeDefinition, LocalDataBackup, SeriesDefinition, SystemConfig, TranslationImportRow, TranslationImportSummary, TranslationUpdate } from "./types";
import { duplicateKeyOf, translationSourceHashOf } from "./excel";
import { getBackendSettings } from "./backend";
import { RemoteComplaintRepository } from "./remote-repository";

export interface ComplaintRepository {
  getAll(): Promise<ComplaintRecord[]>;
  importNew(records: ComplaintRecord[], summary: ImportSummary): Promise<number>;
  getImportHistory(): Promise<ImportSummary[]>;
  getIssueTypes(): Promise<string[]>;
  getIssueTypeDefinitions(): Promise<IssueTypeDefinition[]>;
  saveIssueType(name: string): Promise<string[]>;
  updateIssueTypeChineseName(name: string, chineseName: string): Promise<void>;
  getSeriesDefinitions(): Promise<{primary:SeriesDefinition[];secondary:SeriesDefinition[]}>;
  updateSeriesChineseName(kind:"primary"|"secondary", name:string, chineseName:string, primarySeriesName?:string|null): Promise<void>;
  updateComplaintIssue(id: string, issueType: string | null): Promise<void>;
  updateComplaint(id:string, changes:ComplaintUpdate):Promise<void>;
  updateComplaintStatuses(ids:string[], status:ComplaintWorkflowStatus):Promise<{updated:number;skipped:number}>;
  updateComplaintTranslation(id:string, changes:TranslationUpdate):Promise<void>;
  importTranslations(rows:TranslationImportRow[], invalidRows:number):Promise<TranslationImportSummary>;
  confirmTranslations(ids:string[]):Promise<number>;
  resetOfflineTranslations():Promise<number>;
  deleteComplaints(ids:string[]):Promise<number>;
  getCAPs(): Promise<CAPRecord[]>;
  saveCAP(input:CAPInput, id?:string):Promise<CAPRecord>;
  deleteCAP(id:string):Promise<void>;
  exportLocalData(): Promise<LocalDataBackup>;
  restoreLocalData(backup:LocalDataBackup): Promise<void>;
  clear(): Promise<void>;
}

const RECORDS_KEY = "toyqms.complaints.v1";
const HISTORY_KEY = "toyqms.import-history.v1";
const ISSUE_TYPES_KEY = "toyqms.issue-types.v1";
const ISSUE_TYPE_NAMES_KEY = "toyqms.issue-type-names.zh.v1";
const PRIMARY_SERIES_NAMES_KEY = "toyqms.primary-series-names.zh.v1";
const SECONDARY_SERIES_NAMES_KEY = "toyqms.secondary-series-names.zh.v1";
const CAPS_KEY = "toyqms.cap-records.v1";
const CONFIG_KEY = "toyqms.system-config.v1";
const defaultConfig:SystemConfig={preserveOriginalText:true,requireHumanReview:true,recalculateStatistics:true};

const commonChineseNames:Record<string,string>={
  "missing parts":"零件缺失","missing part":"零件缺失","parts missing":"零件缺失","functional failure":"功能故障","function failure":"功能故障","functionality":"功能故障","appearance":"外观缺陷","cosmetic":"外观缺陷","packaging":"包装问题","damaged":"产品损坏","damage":"产品损坏","safety":"安全问题","instructions":"说明书问题","instruction":"说明书问题","wrong item":"商品错误","quality":"质量问题","delivery":"配送问题"
};
export function defaultChineseIssueName(name:string){
  if(/[\u3400-\u9fff]/.test(name))return name;
  const normalized=name.trim().toLowerCase();
  if(commonChineseNames[normalized])return commonChineseNames[normalized];
  const match=Object.entries(commonChineseNames).find(([key])=>normalized.includes(key));
  return match?.[1]||"未设置中文类型";
}

export class LocalStorageComplaintRepository implements ComplaintRepository {
  async getAll() { return this.read<ComplaintRecord[]>(RECORDS_KEY, []).map(record=>this.withTranslationFields(record)); }
  async getImportHistory() { return this.read<ImportSummary[]>(HISTORY_KEY, []); }
  async getIssueTypes() {
    const saved=this.read<string[]>(ISSUE_TYPES_KEY,[]); const records=await this.getAll();
    return [...new Set([...saved,...records.map(r=>r.issueType).filter((v):v is string=>Boolean(v))])].sort((a,b)=>a.localeCompare(b,"zh-CN"));
  }
  async getIssueTypeDefinitions(){const types=await this.getIssueTypes();const saved=this.read<Record<string,string>>(ISSUE_TYPE_NAMES_KEY,{});return types.map(name=>({name,chineseName:saved[name]?.trim()||defaultChineseIssueName(name)}));}
  async saveIssueType(name:string){const clean=name.trim();const types=await this.getIssueTypes();const next=clean?[...new Set([...types,clean])].sort((a,b)=>a.localeCompare(b,"zh-CN")):types;localStorage.setItem(ISSUE_TYPES_KEY,JSON.stringify(next));return next;}
  async updateIssueTypeChineseName(name:string,chineseName:string){const saved=this.read<Record<string,string>>(ISSUE_TYPE_NAMES_KEY,{});const clean=chineseName.trim();localStorage.setItem(ISSUE_TYPE_NAMES_KEY,JSON.stringify({...saved,[name]:clean||defaultChineseIssueName(name)}));}
  async getSeriesDefinitions(){const records=await this.getAll();const primaryNames=this.read<Record<string,string>>(PRIMARY_SERIES_NAMES_KEY,{});const secondaryNames=this.read<Record<string,string>>(SECONDARY_SERIES_NAMES_KEY,{});const primary=[...new Set(records.map(record=>record.primarySeries).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"zh-CN")).map(name=>({name,chineseName:primaryNames[name]?.trim()||name,kind:"primary" as const,primarySeriesName:null}));const pairs=new Map<string,{name:string;primarySeriesName:string}>();for(const record of records){if(!record.secondarySeries)continue;const key=`${record.primarySeries}\u0000${record.secondarySeries}`;pairs.set(key,{name:record.secondarySeries,primarySeriesName:record.primarySeries})}const secondary=[...pairs.entries()].map(([key,item])=>({name:item.name,chineseName:secondaryNames[key]?.trim()||item.name,kind:"secondary" as const,primarySeriesName:item.primarySeriesName})).sort((a,b)=>a.primarySeriesName.localeCompare(b.primarySeriesName,"zh-CN")||a.name.localeCompare(b.name,"zh-CN"));return {primary,secondary};}
  async updateSeriesChineseName(kind:"primary"|"secondary",name:string,chineseName:string,primarySeriesName?:string|null){const storageKey=kind==="primary"?PRIMARY_SERIES_NAMES_KEY:SECONDARY_SERIES_NAMES_KEY;const saved=this.read<Record<string,string>>(storageKey,{});const key=kind==="primary"?name:`${primarySeriesName||""}\u0000${name}`;localStorage.setItem(storageKey,JSON.stringify({...saved,[key]:chineseName.trim()||name}));}
  async updateComplaintIssue(id:string,issueType:string|null){const records=await this.getAll();const now=new Date().toISOString();const next=records.map(r=>r.id===id?{...r,issueType,status:issueType?"Imported" as const:"Needs classification" as const,updatedAt:now}:r);localStorage.setItem(RECORDS_KEY,JSON.stringify(next));if(issueType)await this.saveIssueType(issueType);}
  async updateComplaint(id:string,changes:ComplaintUpdate){const records=await this.getAll();const current=records.find(record=>record.id===id);if(!current)throw new Error("投诉记录不存在或已被删除。");const cleanChanges={...changes,productName:changes.productName===undefined?current.productName:changes.productName?.trim()||null,secondarySeries:changes.secondarySeries===undefined?current.secondarySeries:changes.secondarySeries?.trim()||null,store:changes.store===undefined?current.store:changes.store?.trim()||null,batchCode:changes.batchCode===undefined?current.batchCode:changes.batchCode?.trim()||null,issueType:changes.issueType===undefined?current.issueType:changes.issueType?.trim()||null};const updated:ComplaintRecord={...current,...cleanChanges,status:cleanChanges.issueType?"Imported":"Needs classification",updatedAt:new Date().toISOString()};updated.duplicateKey=duplicateKeyOf(updated);if(records.some(record=>record.id!==id&&record.duplicateKey===updated.duplicateKey))throw new Error("编辑后的记录与现有投诉重复，无法保存。");localStorage.setItem(RECORDS_KEY,JSON.stringify(records.map(record=>record.id===id?updated:record)));if(updated.issueType)await this.saveIssueType(updated.issueType);}
  async updateComplaintStatuses(ids:string[],workflowStatus:ComplaintWorkflowStatus){const selected=new Set(ids);const records=await this.getAll();const now=new Date().toISOString();let updated=0,skipped=0;const next=records.map(record=>{if(!selected.has(record.id))return record;if(!record.issueType){skipped+=1;return record}updated+=1;return {...record,workflowStatus,updatedAt:now}});localStorage.setItem(RECORDS_KEY,JSON.stringify(next));return {updated,skipped};}
  async updateComplaintTranslation(id:string,changes:TranslationUpdate){const records=await this.getAll();const current=records.find(record=>record.id===id);if(!current)throw new Error("投诉记录不存在或已被删除。");const now=new Date().toISOString();const machine=changes.complaintMessageZhMachine===undefined?current.complaintMessageZhMachine:changes.complaintMessageZhMachine?.trim()||null;const finalText=changes.complaintMessageZhFinal===undefined?current.complaintMessageZhFinal:changes.complaintMessageZhFinal?.trim()||null;let status=changes.translationStatus??current.translationStatus;if(status==="reviewed"&&!finalText)throw new Error("确认译文前必须填写最终中文译文。");if(status==="translated"&&!machine)status="pending";const updated:ComplaintRecord={...current,...changes,complaintMessageZhMachine:machine,complaintMessageZhFinal:finalText,translationStatus:status,translationSourceHash:translationSourceHashOf(current.complaintMessageOriginal),translatedAt:status==="translated"||status==="reviewed"?current.translatedAt||now:null,reviewedAt:status==="reviewed"?now:null,updatedAt:now};localStorage.setItem(RECORDS_KEY,JSON.stringify(records.map(record=>record.id===id?updated:record)));}
  async importTranslations(rows:TranslationImportRow[],invalidRows:number){
    const records=await this.getAll();const now=new Date().toISOString();let importedRows=0;let unmatchedRows=0;
    const byKey=new Map(records.map(record=>[record.duplicateKey,record]));
    const bySubmission=new Map(records.filter(record=>record.sourceSubmissionId).map(record=>[record.sourceSubmissionId as string,record]));
    const byOriginal=new Map(records.map(record=>[translationSourceHashOf(record.complaintMessageOriginal),record]));
    const updates=new Map<string,string>();
    for(const row of rows){
      const target=(row.duplicateKey&&byKey.get(row.duplicateKey))||(row.sourceSubmissionId&&bySubmission.get(row.sourceSubmissionId))||(row.complaintMessageOriginal&&byOriginal.get(translationSourceHashOf(row.complaintMessageOriginal)));
      if(!target){unmatchedRows+=1;continue}updates.set(target.id,row.complaintMessageZh);importedRows+=1;
    }
    const next=records.map(record=>{const translation=updates.get(record.id);return translation?{...record,complaintMessageZhMachine:translation,complaintMessageZhFinal:null,translationStatus:"translated" as const,translationSourceHash:translationSourceHashOf(record.complaintMessageOriginal),translationProvider:"excel-translation-import",translationModel:null,translatedAt:now,reviewedAt:null,updatedAt:now}:record});
    localStorage.setItem(RECORDS_KEY,JSON.stringify(next));
    return {totalRows:rows.length+invalidRows,importedRows,unmatchedRows,invalidRows};
  }
  async confirmTranslations(ids:string[]){
    const idSet=new Set(ids);if(!idSet.size)return 0;const records=await this.getAll();const now=new Date().toISOString();let confirmed=0;
    const next=records.map(record=>{if(!idSet.has(record.id))return record;const translation=(record.complaintMessageZhFinal||record.complaintMessageZhMachine||"").trim();if(!translation)return record;confirmed+=1;return {...record,complaintMessageZhFinal:translation,translationStatus:"reviewed" as const,reviewedAt:now,updatedAt:now}});
    localStorage.setItem(RECORDS_KEY,JSON.stringify(next));return confirmed;
  }
  async resetOfflineTranslations(){
    const records=await this.getAll();const now=new Date().toISOString();let reset=0;
    const next=records.map(record=>{if(record.translationProvider!=="codex-offline"||record.translationModel!=="argos-en-zh")return record;reset+=1;return {...record,complaintMessageZhMachine:null,complaintMessageZhFinal:null,translationStatus:"pending" as const,translationProvider:null,translationModel:null,translatedAt:null,reviewedAt:null,translationSourceHash:translationSourceHashOf(record.complaintMessageOriginal),updatedAt:now}});
    localStorage.setItem(RECORDS_KEY,JSON.stringify(next));return reset;
  }
  async deleteComplaints(ids:string[]){const idSet=new Set(ids);if(!idSet.size)return 0;const records=await this.getAll();const next=records.filter(record=>!idSet.has(record.id));localStorage.setItem(RECORDS_KEY,JSON.stringify(next));const caps=(await this.getCAPs()).map(cap=>({...cap,complaintIds:cap.complaintIds.filter(id=>!idSet.has(id)),updatedAt:new Date().toISOString()}));localStorage.setItem(CAPS_KEY,JSON.stringify(caps));return records.length-next.length;}
  async getCAPs(){return this.read<CAPRecord[]>(CAPS_KEY,[]).map(cap=>({...cap,complaintIds:Array.isArray(cap.complaintIds)?cap.complaintIds:[]}));}
  async saveCAP(input:CAPInput,id?:string){
    const caps=await this.getCAPs();const records=await this.getAll();const now=new Date().toISOString();const current=id?caps.find(cap=>cap.id===id):undefined;
    if(id&&!current)throw new Error("CAP 记录不存在或已被删除。");
    const allowedIds=new Set(records.map(record=>record.id));const complaintIds=[...new Set(input.complaintIds)].filter(item=>allowedIds.has(item));
    const capNumber=current?.capNumber||this.nextCAPNumber(caps);
    const saved:CAPRecord={...input,complaintIds,id:current?.id||crypto.randomUUID(),capNumber,createdAt:current?.createdAt||now,updatedAt:now};
    const nextCaps=current?caps.map(cap=>cap.id===current.id?saved:cap):[saved,...caps];
    const oldIds=new Set(current?.complaintIds||[]);const newIds=new Set(complaintIds);
    const nextRecords=records.map(record=>{if(!oldIds.has(record.id)&&!newIds.has(record.id))return record;const capIds=new Set(record.capIds||[]);if(newIds.has(record.id))capIds.add(saved.id);else capIds.delete(saved.id);return {...record,capIds:[...capIds],updatedAt:now}});
    localStorage.setItem(CAPS_KEY,JSON.stringify(nextCaps));localStorage.setItem(RECORDS_KEY,JSON.stringify(nextRecords));return saved;
  }
  async deleteCAP(id:string){const caps=await this.getCAPs();if(!caps.some(cap=>cap.id===id))return;const records=await this.getAll();const now=new Date().toISOString();localStorage.setItem(CAPS_KEY,JSON.stringify(caps.filter(cap=>cap.id!==id)));localStorage.setItem(RECORDS_KEY,JSON.stringify(records.map(record=>record.capIds?.includes(id)?{...record,capIds:record.capIds.filter(capId=>capId!==id),updatedAt:now}:record)));}
  async importNew(records: ComplaintRecord[], summary: ImportSummary) {
    const existing = await this.getAll();
    const keys = new Set(existing.map(r => r.duplicateKey));
    const safe = records.filter(r => !keys.has(r.duplicateKey));
    localStorage.setItem(RECORDS_KEY, JSON.stringify([...existing, ...safe]));
    const history = await this.getImportHistory();
    localStorage.setItem(HISTORY_KEY, JSON.stringify([{...summary, importedRows:safe.length}, ...history].slice(0, 30)));
    return safe.length;
  }
  async exportLocalData():Promise<LocalDataBackup>{return {schemaVersion:2,product:"ToyQMS",exportedAt:new Date().toISOString(),complaintRecords:await this.getAll(),capRecords:await this.getCAPs(),importHistory:await this.getImportHistory(),issueTypes:this.read<string[]>(ISSUE_TYPES_KEY,[]),issueTypeChineseNames:this.read<Record<string,string>>(ISSUE_TYPE_NAMES_KEY,{}),primarySeriesChineseNames:this.read<Record<string,string>>(PRIMARY_SERIES_NAMES_KEY,{}),secondarySeriesChineseNames:this.read<Record<string,string>>(SECONDARY_SERIES_NAMES_KEY,{}),systemConfig:this.read<SystemConfig>(CONFIG_KEY,defaultConfig)};}
  async restoreLocalData(backup:LocalDataBackup){if(!backup||backup.product!=="ToyQMS"||![1,2].includes(backup.schemaVersion)||!Array.isArray(backup.complaintRecords)||!Array.isArray(backup.importHistory)||!Array.isArray(backup.issueTypes))throw new Error("备份文件格式不正确或版本不受支持。");const maps=[backup.issueTypeChineseNames,backup.primarySeriesChineseNames,backup.secondarySeriesChineseNames];if(maps.some(item=>!item||typeof item!=="object"||Array.isArray(item)))throw new Error("备份文件中的名称映射无效。");const current=await this.exportLocalData();localStorage.setItem(`toyqms.pre-restore.${Date.now()}`,JSON.stringify(current));const caps=Array.isArray(backup.capRecords)?backup.capRecords:[];const capIds=new Set(caps.map(cap=>cap.id));const complaintIds=new Set(backup.complaintRecords.map(record=>record.id));const cleanCaps=caps.map(cap=>({...cap,complaintIds:(cap.complaintIds||[]).filter(id=>complaintIds.has(id))}));const capComplaintMap=new Map<string,Set<string>>();for(const cap of cleanCaps)for(const complaintId of cap.complaintIds){const ids=capComplaintMap.get(complaintId)||new Set<string>();ids.add(cap.id);capComplaintMap.set(complaintId,ids)}const cleanRecords=backup.complaintRecords.map(record=>({...record,capIds:[...new Set([...(record.capIds||[]).filter(id=>capIds.has(id)),...(capComplaintMap.get(record.id)||[])])]}));localStorage.setItem(RECORDS_KEY,JSON.stringify(cleanRecords));localStorage.setItem(CAPS_KEY,JSON.stringify(cleanCaps));localStorage.setItem(HISTORY_KEY,JSON.stringify(backup.importHistory));localStorage.setItem(ISSUE_TYPES_KEY,JSON.stringify(backup.issueTypes));localStorage.setItem(ISSUE_TYPE_NAMES_KEY,JSON.stringify(backup.issueTypeChineseNames));localStorage.setItem(PRIMARY_SERIES_NAMES_KEY,JSON.stringify(backup.primarySeriesChineseNames));localStorage.setItem(SECONDARY_SERIES_NAMES_KEY,JSON.stringify(backup.secondarySeriesChineseNames));localStorage.setItem(CONFIG_KEY,JSON.stringify(backup.systemConfig||defaultConfig));}
  async clear() { localStorage.removeItem(RECORDS_KEY); localStorage.removeItem(CAPS_KEY); localStorage.removeItem(HISTORY_KEY); localStorage.removeItem(ISSUE_TYPES_KEY); localStorage.removeItem(ISSUE_TYPE_NAMES_KEY); localStorage.removeItem(PRIMARY_SERIES_NAMES_KEY); localStorage.removeItem(SECONDARY_SERIES_NAMES_KEY); }
  private withTranslationFields(record:ComplaintRecord):ComplaintRecord {const rawTranslation=Object.entries(record.rawData||{}).find(([key,item])=>/(chinese|translation|translated|中文|译文)/i.test(key)&&typeof item==="string"&&item.trim())?.[1];const imported=typeof rawTranslation==="string"?rawTranslation.trim():null;const machine=record.complaintMessageZhMachine??imported;const finalText=record.complaintMessageZhFinal??null;const status=record.translationStatus??(finalText?"reviewed":machine?"translated":"pending");return {...record,capIds:Array.isArray(record.capIds)?record.capIds:[],duplicateKey:record.duplicateKey||duplicateKeyOf(record),sourceLanguage:record.sourceLanguage||"en",complaintMessageZhMachine:machine,complaintMessageZhFinal:finalText,translationStatus:status,translationSourceHash:record.translationSourceHash||translationSourceHashOf(record.complaintMessageOriginal),translationProvider:record.translationProvider??(imported?"excel-import":null),translationModel:record.translationModel??null,translatedAt:record.translatedAt??(machine?record.importedAt:null),reviewedAt:record.reviewedAt??null};}
  private read<T>(key:string, fallback:T):T { if (typeof window === "undefined") return fallback; try { return JSON.parse(localStorage.getItem(key) || "") as T; } catch { return fallback; } }
  private nextCAPNumber(caps:CAPRecord[]){const year=new Date().getFullYear();const prefix=`CAP-${year}-`;const max=caps.filter(cap=>cap.capNumber.startsWith(prefix)).reduce((value,cap)=>Math.max(value,Number(cap.capNumber.slice(prefix.length))||0),0);return `${prefix}${String(max+1).padStart(3,"0")}`;}
}

const localRepository = new LocalStorageComplaintRepository();
let remoteRepository: ComplaintRepository | null = null;

/** Pick local (localStorage) or remote (HTTP backend) storage based on the settings page toggle. */
export function getComplaintRepository(): ComplaintRepository {
  if (getBackendSettings().mode === "remote") {
    remoteRepository ??= new RemoteComplaintRepository();
    return remoteRepository;
  }
  return localRepository;
}

// Backward-compatible handle: existing imports of `complaintRepository` keep
// working, but every call is routed through getComplaintRepository().
export const complaintRepository: ComplaintRepository = new Proxy({} as ComplaintRepository, {
  get(_target, property) {
    const active = getComplaintRepository() as unknown as Record<string | symbol, unknown>;
    const value = active[property];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(active) : value;
  }
});
