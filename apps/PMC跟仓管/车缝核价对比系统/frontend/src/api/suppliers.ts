import { http, unwrap } from './client';

export interface SupplierDto {
  supplierId: number;
  supplierCode: string;
  supplierName: string;
  contact?: string | null; // 联系人
  mainProcess?: string | null; // 加工类型
  deptId: number;
  isActive: boolean;
  extMainId?: string | null;
  location?: string | null; // 所在地
  remark?: string | null;
  // 加工厂信息统计表字段
  phone?: string | null; // 联系电话
  address?: string | null; // 工厂地址
  equipmentCount?: number | null; // 设备台数
  machinesForUs?: number | null; // 帮我们生产的机台
  employeeCount?: number | null; // 员工人数
  monthlyCapacity?: string | null; // 月产能
  qualification?: string | null; // 资质
  scope?: string | null; // 所属范围
}

export interface SupplierUpsert {
  supplierCode?: string | null; // 留空用名称当编码
  supplierName: string;
  contact?: string | null;
  mainProcess?: string | null;
  deptId: number;
  isActive: boolean;
  extMainId?: string | null;
  location?: string | null;
  remark?: string | null;
  phone?: string | null;
  address?: string | null;
  equipmentCount?: number | null;
  machinesForUs?: number | null;
  employeeCount?: number | null;
  monthlyCapacity?: string | null;
  qualification?: string | null;
  scope?: string | null;
}

export interface SupplierImportRowInput {
  rowNo: number;
  supplierName?: string | null;
  contact?: string | null;
  phone?: string | null;
  address?: string | null;
  equipmentCount?: number | null;
  machinesForUs?: number | null;
  employeeCount?: number | null;
  monthlyCapacity?: string | null;
  mainProcess?: string | null;
  qualification?: string | null;
  scope?: string | null;
}

export interface SupplierImportPreviewRow extends SupplierImportRowInput {
  supplierName: string;
  status: 'ok' | 'conflict' | 'duplicate' | 'error';
  reason?: string | null;
  existingSupplierId?: number | null;
}

export interface SupplierImportPreviewResult {
  rows: SupplierImportPreviewRow[];
  createCount: number;
  conflictCount: number;
  duplicateCount: number;
  errorCount: number;
}

export interface SupplierImportCommitRow extends SupplierImportRowInput {
  overwrite: boolean;
}

export interface SupplierImportCommitResult {
  created: number;
  overwritten: number;
  keptOld: number;
  skipped: number;
}

export const supplierApi = {
  list: (deptId?: number) =>
    unwrap<SupplierDto[]>(http.get('/api/suppliers', { params: { deptId, includeInactive: true } })),
  create: (body: SupplierUpsert) => unwrap<SupplierDto>(http.post('/api/suppliers', body)),
  update: (id: number, body: SupplierUpsert) => unwrap<SupplierDto>(http.put(`/api/suppliers/${id}`, body)),
  remove: (id: number) => unwrap<boolean>(http.delete(`/api/suppliers/${id}`)),
  importPreview: (deptId: number, rows: SupplierImportRowInput[]) =>
    unwrap<SupplierImportPreviewResult>(http.post('/api/suppliers/import/preview', { deptId, rows })),
  importCommit: (deptId: number, rows: SupplierImportCommitRow[]) =>
    unwrap<SupplierImportCommitResult>(http.post('/api/suppliers/import/commit', { deptId, rows })),
};
