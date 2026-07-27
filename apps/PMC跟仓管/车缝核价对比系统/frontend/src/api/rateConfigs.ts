import { http, unwrap } from './client';

export type RateType = 'exchange' | 'tax';

export interface RateConfigDto {
  configId: number;
  rateType: RateType;
  rateValue: number;
  effectiveDate: string;
  isCurrent: boolean;
  deptId: number;
  remark?: string | null;
}

export interface RateConfigCreate {
  rateType: RateType;
  rateValue: number;
  effectiveDate: string;
  deptId: number;
  remark?: string | null;
}

export const rateConfigApi = {
  current: (rateType: RateType, deptId: number) =>
    unwrap<RateConfigDto>(http.get('/api/rate-configs/current', { params: { rateType, deptId } })),
  create: (body: RateConfigCreate) =>
    unwrap<RateConfigDto>(http.post('/api/rate-configs', body)),
};

export async function loadSystemRates(deptId: number): Promise<{ exchangeRate: number; taxRate: number }> {
  const [exchange, tax] = await Promise.allSettled([
    rateConfigApi.current('exchange', deptId),
    rateConfigApi.current('tax', deptId),
  ]);
  return {
    exchangeRate: exchange.status === 'fulfilled' ? exchange.value.rateValue : 0.9,
    taxRate: tax.status === 'fulfilled' ? tax.value.rateValue : 0.13,
  };
}
