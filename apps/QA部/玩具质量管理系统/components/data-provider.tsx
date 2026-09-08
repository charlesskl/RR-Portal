"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { complaintRepository } from "@/lib/repository";
import type { CAPInput, CAPRecord, ComplaintRecord, ComplaintUpdate, ComplaintWorkflowStatus, ImportPreview, ImportSummary, IssueTypeDefinition, LocalDataBackup, SeriesDefinition, TranslationImportRow, TranslationImportSummary, TranslationUpdate } from "@/lib/types";
import { useAuth } from "@/components/auth-provider";

type DataContextValue={
  records:ComplaintRecord[];capRecords:CAPRecord[];issueTypes:string[];issueTypeDefinitions:IssueTypeDefinition[];
  primarySeriesDefinitions:SeriesDefinition[];secondarySeriesDefinitions:SeriesDefinition[];
  issueTypeLabel:(name:string|null|undefined)=>string;primarySeriesLabel:(name:string|null|undefined)=>string;
  secondarySeriesLabel:(name:string|null|undefined,primarySeriesName?:string|null)=>string;loading:boolean;refresh:()=>Promise<void>;
  confirmImport:(preview:ImportPreview)=>Promise<ImportSummary>;setComplaintIssue:(id:string,issueType:string|null)=>Promise<void>;
  updateComplaint:(id:string,changes:ComplaintUpdate)=>Promise<void>;updateComplaintTranslation:(id:string,changes:TranslationUpdate)=>Promise<void>;
  updateComplaintStatuses:(ids:string[],status:ComplaintWorkflowStatus)=>Promise<{updated:number;skipped:number}>;
  importTranslations:(rows:TranslationImportRow[],invalidRows:number)=>Promise<TranslationImportSummary>;confirmTranslations:(ids:string[])=>Promise<number>;
  resetOfflineTranslations:()=>Promise<number>;deleteComplaints:(ids:string[])=>Promise<number>;saveCAP:(input:CAPInput,id?:string)=>Promise<void>;
  deleteCAP:(id:string)=>Promise<void>;addIssueType:(name:string)=>Promise<void>;setIssueTypeChineseName:(name:string,chineseName:string)=>Promise<void>;
  setSeriesChineseName:(kind:"primary"|"secondary",name:string,chineseName:string,primarySeriesName?:string|null)=>Promise<void>;
  exportLocalData:()=>Promise<LocalDataBackup>;restoreLocalData:(backup:LocalDataBackup)=>Promise<void>;clearData:()=>Promise<void>;
};
const DataContext=createContext<DataContextValue|null>(null);
export function DataProvider({children}:{children:React.ReactNode}){
  const {requirePermission}=useAuth();
  const [records,setRecords]=useState<ComplaintRecord[]>([]);const [capRecords,setCAPRecords]=useState<CAPRecord[]>([]);
  const [issueTypes,setIssueTypes]=useState<string[]>([]);const [issueTypeDefinitions,setIssueTypeDefinitions]=useState<IssueTypeDefinition[]>([]);
  const [primarySeriesDefinitions,setPrimarySeriesDefinitions]=useState<SeriesDefinition[]>([]);const [secondarySeriesDefinitions,setSecondarySeriesDefinitions]=useState<SeriesDefinition[]>([]);
  const [loading,setLoading]=useState(true);
  const refresh=useCallback(async()=>{try{const [nextRecords,nextCAPs,nextTypes,nextDefinitions,nextSeries]=await Promise.all([complaintRepository.getAll(),complaintRepository.getCAPs(),complaintRepository.getIssueTypes(),complaintRepository.getIssueTypeDefinitions(),complaintRepository.getSeriesDefinitions()]);setRecords(nextRecords);setCAPRecords(nextCAPs);setIssueTypes(nextTypes);setIssueTypeDefinitions(nextDefinitions);setPrimarySeriesDefinitions(nextSeries.primary);setSecondarySeriesDefinitions(nextSeries.secondary)}catch(error){console.error("数据加载失败",error)}finally{setLoading(false)}},[]);
  const pathname=usePathname();
  useEffect(()=>{
    const normalized=pathname!=="/"?pathname.replace(/\/+$/,""):pathname;
    if(normalized==="/login"){setLoading(false);return} // 登录页未鉴权，不拉取业务数据
    void refresh();
  },[refresh,pathname]);
  const confirmImport=useCallback(async(p:ImportPreview)=>{requirePermission("import_data");const summary:ImportSummary={totalRows:p.totalRows,newRows:p.newRows.length,duplicateRows:p.duplicateRows.length,invalidRows:p.invalidRows.length,importedRows:0,batchId:p.batchId,fileName:p.fileName};summary.importedRows=await complaintRepository.importNew(p.newRows,summary);await refresh();return summary},[refresh,requirePermission]);
  const setComplaintIssue=useCallback(async(id:string,issueType:string|null)=>{requirePermission("manage_classification");await complaintRepository.updateComplaintIssue(id,issueType);await refresh()},[refresh,requirePermission]);
  const updateComplaint=useCallback(async(id:string,changes:ComplaintUpdate)=>{requirePermission("manage_complaints");await complaintRepository.updateComplaint(id,changes);await refresh()},[refresh,requirePermission]);
  const updateComplaintStatuses=useCallback(async(ids:string[],status:ComplaintWorkflowStatus)=>{requirePermission("manage_complaints");const result=await complaintRepository.updateComplaintStatuses(ids,status);await refresh();return result},[refresh,requirePermission]);
  const updateComplaintTranslation=useCallback(async(id:string,changes:TranslationUpdate)=>{requirePermission("manage_translation");await complaintRepository.updateComplaintTranslation(id,changes);await refresh()},[refresh,requirePermission]);
  const importTranslations=useCallback(async(rows:TranslationImportRow[],invalidRows:number)=>{requirePermission("manage_translation");const summary=await complaintRepository.importTranslations(rows,invalidRows);await refresh();return summary},[refresh,requirePermission]);
  const confirmTranslations=useCallback(async(ids:string[])=>{requirePermission("manage_translation");const count=await complaintRepository.confirmTranslations(ids);await refresh();return count},[refresh,requirePermission]);
  const resetOfflineTranslations=useCallback(async()=>{requirePermission("manage_translation");const count=await complaintRepository.resetOfflineTranslations();await refresh();return count},[refresh,requirePermission]);
  const deleteComplaints=useCallback(async(ids:string[])=>{requirePermission("delete_complaints");const count=await complaintRepository.deleteComplaints(ids);await refresh();return count},[refresh,requirePermission]);
  const saveCAP=useCallback(async(input:CAPInput,id?:string)=>{requirePermission("manage_cap");await complaintRepository.saveCAP(input,id);await refresh()},[refresh,requirePermission]);
  const deleteCAP=useCallback(async(id:string)=>{requirePermission("manage_cap");await complaintRepository.deleteCAP(id);await refresh()},[refresh,requirePermission]);
  const addIssueType=useCallback(async(name:string)=>{requirePermission("manage_classification");await complaintRepository.saveIssueType(name);await refresh()},[refresh,requirePermission]);
  const setIssueTypeChineseName=useCallback(async(name:string,chineseName:string)=>{requirePermission("manage_classification");await complaintRepository.updateIssueTypeChineseName(name,chineseName);await refresh()},[refresh,requirePermission]);
  const setSeriesChineseName=useCallback(async(kind:"primary"|"secondary",name:string,chineseName:string,primarySeriesName?:string|null)=>{requirePermission("manage_classification");await complaintRepository.updateSeriesChineseName(kind,name,chineseName,primarySeriesName);await refresh()},[refresh,requirePermission]);
  const exportLocalData=useCallback(()=>complaintRepository.exportLocalData(),[]);
  const restoreLocalData=useCallback(async(backup:LocalDataBackup)=>{requirePermission("manage_settings");await complaintRepository.restoreLocalData(backup);await refresh()},[refresh,requirePermission]);
  const clearData=useCallback(async()=>{requirePermission("manage_settings");await complaintRepository.clear();await refresh()},[refresh,requirePermission]);
  const issueTypeLabel=useCallback((name:string|null|undefined)=>name?issueTypeDefinitions.find(item=>item.name===name)?.chineseName||name:"未分类",[issueTypeDefinitions]);
  const primarySeriesLabel=useCallback((name:string|null|undefined)=>name?primarySeriesDefinitions.find(item=>item.name===name)?.chineseName||name:"未指定系列",[primarySeriesDefinitions]);
  const secondarySeriesLabel=useCallback((name:string|null|undefined,primary?:string|null)=>name?secondarySeriesDefinitions.find(item=>item.name===name&&(!primary||item.primarySeriesName===primary))?.chineseName||name:"无次要系列",[secondarySeriesDefinitions]);
  const value=useMemo(()=>({records,capRecords,issueTypes,issueTypeDefinitions,primarySeriesDefinitions,secondarySeriesDefinitions,issueTypeLabel,primarySeriesLabel,secondarySeriesLabel,loading,refresh,confirmImport,setComplaintIssue,updateComplaint,updateComplaintStatuses,updateComplaintTranslation,importTranslations,confirmTranslations,resetOfflineTranslations,deleteComplaints,saveCAP,deleteCAP,addIssueType,setIssueTypeChineseName,setSeriesChineseName,exportLocalData,restoreLocalData,clearData}),[records,capRecords,issueTypes,issueTypeDefinitions,primarySeriesDefinitions,secondarySeriesDefinitions,issueTypeLabel,primarySeriesLabel,secondarySeriesLabel,loading,refresh,confirmImport,setComplaintIssue,updateComplaint,updateComplaintStatuses,updateComplaintTranslation,importTranslations,confirmTranslations,resetOfflineTranslations,deleteComplaints,saveCAP,deleteCAP,addIssueType,setIssueTypeChineseName,setSeriesChineseName,exportLocalData,restoreLocalData,clearData]);
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
export function useComplaintData(){const value=useContext(DataContext);if(!value)throw new Error("useComplaintData must be used inside DataProvider");return value}
