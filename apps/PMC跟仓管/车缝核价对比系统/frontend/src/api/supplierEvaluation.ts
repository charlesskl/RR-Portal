import { http, unwrap } from './client';

export interface EvaluationRow {
  supplierId: number;
  supplierName: string;
  qualityScore?: number | null; // 质量分(0-100)
  priceScore?: number | null; // 价格分(0-100)
  deliveryScore?: number | null; // 交付分(0-100)
  totalScore?: number | null; // 综合分 = 质量×40%+价格×40%+交付×20%
  grade: string; // A 优秀 / B 良好 / C 限单 / D 预警 / 未评级
  advice: string; // 处理建议
  isNewThisMonth: boolean;
  orderCount: number;
  pricedLineCount: number;
  inspectionCount: number;
  deliveredCount: number;
  dataCoverage: number;
  overPriceCount: number;
}

export interface EvaluationSettings {
  targetSaving: number;
  qualityWeight: number;
  priceWeight: number;
  deliveryWeight: number;
  gradeA: number;
  gradeB: number;
  gradeC: number;
}

export interface EvaluationDetail {
  profile: {
    supplierId: number;
    supplierCode: string;
    supplierName: string;
    deptName: string;
    contact?: string | null;
    phone?: string | null;
    address?: string | null;
    location?: string | null;
    mainProcess?: string | null;
    monthlyCapacity?: string | null;
    equipmentCount?: number | null;
    machinesForUs?: number | null;
    employeeCount?: number | null;
    qualification?: string | null;
    scope?: string | null;
    remark?: string | null;
  };
  evaluation: EvaluationRow;
  price: {
    orderCount: number;
    pricedLineCount: number;
    internalAmount: number;
    outsourceAmount: number;
    savingAmount: number;
    savingRate?: number | null;
    overPriceLineCount: number;
  };
  delivery: {
    pendingPricingCount: number;
    orderedCount: number;
    producingCount: number;
    deliveredCount: number;
    onTimeCount: number;
    delayedCount: number;
    onTimeRate?: number | null;
    averageDelayDays?: number | null;
  };
  quality: {
    inspectionCount: number;
    receivedQty: number;
    qcQty: number;
    stockInQty: number;
    defectQty: number;
    defectRate?: number | null;
    mainDefect?: string | null;
  };
}

export const evaluationApi = {
  list: () => unwrap<EvaluationRow[]>(http.get('/api/supplier-evaluation')),
  detail: (supplierId: number) =>
    unwrap<EvaluationDetail>(http.get(`/api/supplier-evaluation/${supplierId}`)),
  settings: (deptId: number) =>
    unwrap<EvaluationSettings>(http.get('/api/supplier-evaluation/settings', { params: { deptId } })),
  updateSettings: (deptId: number, body: EvaluationSettings) =>
    unwrap<EvaluationSettings>(http.put('/api/supplier-evaluation/settings', body, { params: { deptId } })),
};
