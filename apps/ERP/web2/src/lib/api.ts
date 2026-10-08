import { clearToken, getToken } from "./auth";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** 站点根路径(dev 为 '/',云端为 '/erp/'),用于拼 API 与整页跳转 */
export const base = import.meta.env.BASE_URL;

/** fetch 封装:自动带 token,401 清令牌并跳登录;错误消息取后端 {消息} 字段 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${base}api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401) {
    clearToken();
    if (!location.pathname.endsWith("/login")) location.assign(`${base}login`);
    throw new ApiError(401, "登录已过期，请重新登录");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: { 消息?: string; message?: string } | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // 后端 500 等异常返回 text/plain(如 SqlException 原文),按状态码给干净文案,不抛 JSON 解析错
    if (res.ok) throw new ApiError(res.status, "响应格式异常");
  }
  if (!res.ok) {
    const msg = data?.消息 ?? data?.message ?? `请求失败 (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

/** 组装 query string,跳过空值 */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
