/** 与后端 DTO 对应的前端类型。 */

export interface UserInfo {
  userId: number;
  username: string;
  displayName: string;
  deptId: number;
  userbqrpower?: string;
  role?: string;
}

export interface LoginResponse {
  token: string;
  expires: string;
  user: UserInfo;
}

export interface Dept {
  deptId: number;
  deptCode: string;
  deptName: string;
  isActive: boolean;
  extMainId?: string | null;
}

export interface Product {
  productId: number;
  productCode: string;
  productName: string;
  spec?: string | null;
  deptId: number;
  isActive: boolean;
  extMainId?: string | null;
  seriesCode?: string | null;
  styleNo?: string | null;
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
