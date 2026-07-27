import { http, unwrap } from './client';
import type { PagedResult, Product } from './types';

export interface ProductQuery {
  keyword?: string;
  deptId?: number;
  page?: number;
  pageSize?: number;
  archived?: boolean;
}

export interface ProductUpsert {
  productCode: string;
  productName: string;
  spec?: string | null;
  deptId: number;
  isActive: boolean;
  extMainId?: string | null;
}

/** 产品库列表行：一个货号(系列)一行。 */
export interface ProductSeriesRow {
  code: string; // 货号
  styleCount: number; // 款数
  isActive: boolean;
  lastModified: string; // 修改日期(ISO)
  lastModifiedBy?: string | null; // 修改人
}

export interface ProductSeriesDeleteResult {
  productCount: number;
  quoteCount: number;
  aliasCount: number;
}

/** 新建货号：一个货号一次建多个款。 */
export interface SeriesCreateItem {
  productName: string;
  spec?: string | null;
}
export interface SeriesCreate {
  seriesCode: string;
  deptId: number;
  isActive: boolean;
  items: SeriesCreateItem[];
}

export const productApi = {
  list: (query: ProductQuery) =>
    unwrap<PagedResult<Product>>(http.get('/api/products', { params: query })),
  seriesSummary: (query: ProductQuery) =>
    unwrap<PagedResult<ProductSeriesRow>>(http.get('/api/products/series-summary', { params: query })),
  createSeries: (body: SeriesCreate) =>
    unwrap<number>(http.post('/api/products/series', body)),
  create: (body: ProductUpsert) =>
    unwrap<Product>(http.post('/api/products', body)),
  update: (id: number, body: ProductUpsert) =>
    unwrap<Product>(http.put(`/api/products/${id}`, body)),
  removeSeries: (code: string) =>
    unwrap<ProductSeriesDeleteResult>(http.delete(`/api/products/series/${encodeURIComponent(code)}`)),
};
