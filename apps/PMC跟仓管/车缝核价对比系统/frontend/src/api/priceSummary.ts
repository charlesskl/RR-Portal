import { http, unwrap } from './client';

export interface StyleSummaryDto {
  productId: number;
  styleNo?: string | null;
  productName: string;
  selfCost: number;
  adoptedCost: number;
  saving: number;
  savingRate?: number | null;
  isCompliant: boolean;
}

export interface SeriesSummaryDto {
  seriesCode: string;
  selfCost: number;
  adoptedCost: number;
  saving: number;
  savingRate?: number | null;
  isCompliant: boolean;
  styles: StyleSummaryDto[];
}

export const priceSummaryApi = {
  getSeries: (seriesCode: string, deptId?: number) =>
    unwrap<SeriesSummaryDto>(http.get('/api/price-summary', { params: { seriesCode, deptId } })),
};
