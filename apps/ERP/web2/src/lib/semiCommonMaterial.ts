// 半成品共用物料表筛选纯函数(照抄老系统 web/src/utils/semiFinishedCommonMaterials.ts):
// 筛选 -> 后端查询参数(「全部」不下发);筛选状态 sessionStorage 持久化(跳详情后返回还原);
// 库存单价按「单价」权限位遮蔽;双击跳装配物料设置带 款号+return。
import type { SemiCommonMaterialQuery } from "@/api/types";

export const SEMI_COMMON_MATERIAL_FILTER_KEY = "semi-finished-common-materials.filters";

export interface SemiCommonMaterialFilterState {
  field?: string;
  keyword?: string;
  exact?: boolean;
  duplicate?: string;
  pending?: string;
  audit?: string;
  page?: number;
  size?: number;
}

const clean = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed && trimmed !== "全部" ? trimmed : undefined;
};

const pageValue = (value: number | undefined, fallback: number) =>
  Number.isFinite(value) ? Math.max(1, Math.trunc(value as number)) : fallback;

export function buildSemiCommonMaterialParams(
  input: SemiCommonMaterialFilterState = {},
): SemiCommonMaterialQuery {
  const params: SemiCommonMaterialQuery = {
    page: pageValue(input.page, 1),
    size: Math.min(pageValue(input.size, 50), 200),
    精确: input.exact ?? false,
  };
  const duplicate = clean(input.duplicate);
  const pending = clean(input.pending);
  const audit = clean(input.audit);
  const field = clean(input.field);
  const keyword = clean(input.keyword);
  if (duplicate) params.重复内容 = duplicate;
  if (pending) params.待操作物料 = pending;
  if (audit) params.审核情况 = audit;
  if (field) params.查询字段 = field;
  if (keyword) params.keyword = keyword;
  return params;
}

// 双击行跳装配物料设置(对照老系统 buildAssemblyMaterialDetailUrl)
export function buildAssemblyMaterialDetailUrl(
  产品货号: string,
  returnTo = "/semi-finished-common-materials",
) {
  return `/assembly-material-setup?款号=${encodeURIComponent(产品货号)}&return=${encodeURIComponent(returnTo)}`;
}

export function maskSemiCommonMaterialPrice(
  price: number | null | undefined,
  canSeePrice: boolean,
): number | "***" {
  return !canSeePrice || price == null ? "***" : price;
}

type FilterStorage = Pick<Storage, "getItem" | "setItem">;

function defaultFilterStorage(): FilterStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function saveSemiCommonMaterialFilters(
  filters: SemiCommonMaterialFilterState,
  storage: FilterStorage | undefined = defaultFilterStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(SEMI_COMMON_MATERIAL_FILTER_KEY, JSON.stringify(filters));
  } catch {
    // storage 不可用/已满时忽略,列表跳转不受影响
  }
}

export function loadSemiCommonMaterialFilters(
  storage: FilterStorage | undefined = defaultFilterStorage(),
): SemiCommonMaterialFilterState {
  if (!storage) return {};
  try {
    const value = storage.getItem(SEMI_COMMON_MATERIAL_FILTER_KEY);
    if (!value) return {};
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const source = parsed as Record<string, unknown>;
    const filters: SemiCommonMaterialFilterState = {};
    for (const key of ["field", "keyword", "duplicate", "pending", "audit"] as const) {
      if (typeof source[key] === "string") filters[key] = source[key];
    }
    if (typeof source.exact === "boolean") filters.exact = source.exact;
    for (const key of ["page", "size"] as const) {
      if (typeof source[key] === "number" && Number.isFinite(source[key])) filters[key] = source[key];
    }
    return filters;
  } catch {
    return {};
  }
}
