import * as XLSX from "xlsx";
import type { TranslationImportPreview, TranslationImportRow } from "./types";

const text=(value:unknown)=>String(value??"").trim();
const pick=(row:Record<string,unknown>,keys:string[])=>{
  const entry=Object.entries(row).find(([key])=>keys.some(candidate=>key.trim().toLowerCase()===candidate.toLowerCase()));
  return entry?.[1];
};

export async function previewTranslationWorkbook(file:File):Promise<TranslationImportPreview>{
  const workbook=XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:true});
  const validRows:TranslationImportRow[]=[];
  let totalRows=0;let invalidRows=0;
  for(const sheetName of workbook.SheetNames){
    const sheet=workbook.Sheets[sheetName];
    const rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet,{defval:"",raw:false});
    for(const row of rows){
      totalRows+=1;
      const translation=text(pick(row,["中文译文","Chinese Translation","Translation"]));
      const duplicateKey=text(pick(row,["匹配键","Duplicate Key","duplicateKey"]))||null;
      const submissionId=text(pick(row,["来源编号","Submission ID","Source Submission ID"]))||null;
      const original=text(pick(row,["英文原文","English Complaint","Complaint Message"]))||null;
      const worksheet=text(pick(row,["来源工作表","Source Worksheet","Worksheet"]))||null;
      const rowNumber=Number(text(pick(row,["原始行号","Source Row","Row Number"])))||null;
      if(!translation||(!duplicateKey&&!submissionId&&!original)){invalidRows+=1;continue}
      validRows.push({duplicateKey,sourceSubmissionId:submissionId,complaintMessageOriginal:original,complaintMessageZh:translation,sourceWorksheetName:worksheet,sourceRowNumber:rowNumber});
    }
  }
  return {fileName:file.name,totalRows,validRows,invalidRows};
}
