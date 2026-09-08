export type RawExcelRow = Record<string, unknown>;
export type TranslationStatus = "pending" | "translated" | "reviewed" | "failed";
export type ComplaintWorkflowStatus = "待处理" | "处理中" | "已关闭" | "未设置状态";

export interface ComplaintRecord {
  id: string;
  sourceSubmissionId: string | null;
  sourceFileName: string;
  sourceWorksheetName: string;
  sourceRowNumber: number;
  importBatchId: string;
  primarySeries: string;
  secondarySeries: string | null;
  contactDate: string;
  productSku: string;
  productName: string | null;
  complaintMessageOriginal: string;
  sourceLanguage: string;
  complaintMessageZhMachine: string | null;
  complaintMessageZhFinal: string | null;
  translationStatus: TranslationStatus;
  translationSourceHash: string;
  translationProvider: string | null;
  translationModel: string | null;
  translatedAt: string | null;
  reviewedAt: string | null;
  country: string;
  store: string | null;
  batchCode: string | null;
  issueType: string | null;
  status: "Imported" | "Needs classification";
  workflowStatus?: ComplaintWorkflowStatus | null;
  capIds: string[];
  duplicateKey: string;
  importedAt: string;
  updatedAt: string;
  rawData: RawExcelRow;
}

export interface IssueTypeDefinition {
  name: string;
  chineseName: string;
}

export interface SeriesDefinition {
  name: string;
  chineseName: string;
  kind: "primary" | "secondary";
  primarySeriesName: string | null;
}

export type CAPStage = "草稿" | "原因分析" | "措施执行" | "等待验证" | "已关闭";

export interface CAPRecord {
  id: string;
  capNumber: string;
  problemDescription: string;
  issueType: string;
  owner: string;
  stage: CAPStage;
  dueDate: string;
  rootCauseAnalysis: string;
  correctiveAction: string;
  preventiveAction: string;
  effectivenessVerification: string;
  complaintIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type CAPInput = Omit<CAPRecord, "id" | "capNumber" | "createdAt" | "updatedAt">;

export interface SystemConfig {
  preserveOriginalText: boolean;
  requireHumanReview: boolean;
  recalculateStatistics: boolean;
}

export type ComplaintUpdate = Partial<Pick<ComplaintRecord,"contactDate"|"productSku"|"productName"|"primarySeries"|"secondarySeries"|"country"|"store"|"batchCode"|"issueType"|"workflowStatus">>;
export type TranslationUpdate = Partial<Pick<ComplaintRecord,"complaintMessageZhMachine"|"complaintMessageZhFinal"|"translationStatus"|"translationProvider"|"translationModel">>;

export interface TranslationImportRow {
  duplicateKey: string | null;
  sourceSubmissionId: string | null;
  complaintMessageOriginal: string | null;
  complaintMessageZh: string;
  sourceWorksheetName: string | null;
  sourceRowNumber: number | null;
}

export interface TranslationImportPreview {
  fileName: string;
  totalRows: number;
  validRows: TranslationImportRow[];
  invalidRows: number;
}

export interface TranslationImportSummary {
  totalRows: number;
  importedRows: number;
  unmatchedRows: number;
  invalidRows: number;
}

export interface InvalidImportRow { worksheet: string; rowNumber: number; reasons: string[]; rawData: RawExcelRow; }
export interface DuplicateImportRow { incoming: ComplaintRecord; existing: ComplaintRecord; }
export interface ImportPreview {
  fileName: string;
  batchId: string;
  worksheets: string[];
  totalRows: number;
  newRows: ComplaintRecord[];
  duplicateRows: DuplicateImportRow[];
  invalidRows: InvalidImportRow[];
}
export interface ImportSummary { totalRows:number; newRows:number; duplicateRows:number; invalidRows:number; importedRows:number; batchId:string; fileName:string; }

export interface LocalDataBackup {
  schemaVersion: 1 | 2;
  product: "ToyQMS";
  exportedAt: string;
  complaintRecords: ComplaintRecord[];
  capRecords?: CAPRecord[];
  importHistory: ImportSummary[];
  issueTypes: string[];
  issueTypeChineseNames: Record<string,string>;
  primarySeriesChineseNames: Record<string,string>;
  secondarySeriesChineseNames: Record<string,string>;
  systemConfig?: SystemConfig;
}
