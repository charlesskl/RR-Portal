import * as XLSX from "xlsx";
import type { ComplaintRecord, DuplicateImportRow, ImportPreview, InvalidImportRow, RawExcelRow } from "./types";

const required = ["Contact Date", "Product SKU", "Complaint Message", "Country"] as const;
const fieldNames:Record<string,string>={"Contact Date":"联络日期","Product SKU":"产品 SKU","Complaint Message":"投诉内容","Country":"国家"};
const text = (v:unknown) => v == null ? "" : String(v).trim();
const normalized = (v:unknown) => text(v).normalize("NFKC").toLocaleLowerCase().replace(/\s+/g," ");
const value = (row:RawExcelRow, ...names:string[]) => { for (const n of names) if (row[n] != null) return row[n]; return null; };
const importedTranslation = (row:RawExcelRow) => {
  const entry=Object.entries(row).find(([key,item])=>/(chinese|translation|translated|中文|译文)/i.test(key)&&typeof item==="string"&&item.trim());
  return typeof entry?.[1]==="string"?entry[1].trim():null;
};

export function translationSourceHashOf(message:string){let hash=2166136261;for(let index=0;index<message.length;index++){hash^=message.charCodeAt(index);hash=Math.imul(hash,16777619)}return (hash>>>0).toString(16).padStart(8,"0")}

function isoDate(v:unknown):string {
  if (v instanceof Date && !Number.isNaN(v.valueOf())) return v.toISOString().slice(0,10);
  if (typeof v === "number") { const d=XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}` : ""; }
  const s=text(v); if (!s) return "";
  const direct=s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/); if(direct) return `${direct[1]}-${direct[2].padStart(2,"0")}-${direct[3].padStart(2,"0")}`;
  const parsed=new Date(s); return Number.isNaN(parsed.valueOf()) ? "" : parsed.toISOString().slice(0,10);
}

export function duplicateKeyOf(input:Pick<ComplaintRecord,"contactDate"|"productSku"|"complaintMessageOriginal"|"country"|"store"|"batchCode"|"primarySeries">) {
  return [input.contactDate,input.productSku,input.complaintMessageOriginal,input.country,input.store,input.batchCode,input.primarySeries].map(normalized).join("¦");
}

export async function parseExcelFile(file:File, existing:ComplaintRecord[]):Promise<ImportPreview> {
  const workbook=XLSX.read(await file.arrayBuffer(), {type:"array", cellDates:true});
  const batchId=crypto.randomUUID(); const now=new Date().toISOString();
  const known=new Map(existing.map(r=>[r.duplicateKey,r])); const withinFile=new Map<string,ComplaintRecord>();
  const newRows:ComplaintRecord[]=[]; const duplicateRows:DuplicateImportRow[]=[]; const invalidRows:InvalidImportRow[]=[];
  let totalRows=0;
  for (const worksheet of workbook.SheetNames) {
    const rows=XLSX.utils.sheet_to_json<RawExcelRow>(workbook.Sheets[worksheet], {defval:null, raw:true});
    rows.forEach((rawData,index)=>{
      if (!Object.values(rawData).some(v=>text(v))) return; totalRows++;
      const reasons:string[]=[];
      for(const field of required) if(!text(value(rawData,field))) reasons.push(`${fieldNames[field]}为必填字段`);
      const contactDate=isoDate(value(rawData,"Contact Date")); if(text(value(rawData,"Contact Date"))&&!contactDate) reasons.push("联络日期格式无效");
      if(reasons.length){ invalidRows.push({worksheet,rowNumber:index+2,reasons,rawData}); return; }
      const existingTranslation=importedTranslation(rawData);
      const originalMessage=text(value(rawData,"Complaint Message"));
      const record:ComplaintRecord={
        id:crypto.randomUUID(), sourceSubmissionId:text(value(rawData,"Submission ID"))||null, sourceFileName:file.name,
        sourceWorksheetName:worksheet, sourceRowNumber:index+2, importBatchId:batchId, primarySeries:worksheet,
        secondarySeries:text(value(rawData,"Range Name","rangeName"))||null, contactDate,
        productSku:text(value(rawData,"Product SKU")), productName:text(value(rawData,"Product Name"))||null,
        complaintMessageOriginal:originalMessage, sourceLanguage:"en", complaintMessageZhMachine:existingTranslation,
        complaintMessageZhFinal:null, translationStatus:existingTranslation?"translated":"pending", translationSourceHash:translationSourceHashOf(originalMessage),
        translationProvider:existingTranslation?"excel-import":null, translationModel:null, translatedAt:existingTranslation?now:null, reviewedAt:null, country:text(value(rawData,"Country")),
        store:text(value(rawData,"Store"))||null, batchCode:text(value(rawData,"Batch Code"))||null,
        issueType:text(value(rawData,"Issue"))||null, status:text(value(rawData,"Issue"))?"Imported":"Needs classification",
        capIds:[], duplicateKey:"", importedAt:now, updatedAt:now, rawData
      };
      record.duplicateKey=duplicateKeyOf(record);
      const match=known.get(record.duplicateKey)||withinFile.get(record.duplicateKey);
      if(match) duplicateRows.push({incoming:record,existing:match}); else {newRows.push(record);withinFile.set(record.duplicateKey,record);}
    });
  }
  return {fileName:file.name,batchId,worksheets:workbook.SheetNames,totalRows,newRows,duplicateRows,invalidRows};
}
