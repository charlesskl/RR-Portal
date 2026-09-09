// ToyQMS always talks to the Fastify/SQLite backend at the SAME ORIGIN as
// the page (single-container or nginx reverse-proxy deployment). There is
// no configurable address and no browser-local mode. In local development
// (`npm run dev`), next.config.ts proxies /api to the backend on 4313.
const TOKEN_KEY = "toyqms.remote.session.v1";

export function getBackendBaseUrl(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return "http://127.0.0.1:4313";
}

export function getRemoteToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setRemoteToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function apiFetch<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const base = getBackendBaseUrl();
  const token = getRemoteToken();
  let response: Response;
  try {
    response = await fetch(`${base}/api${path}`, {
      method: options.method || "GET",
      headers: {
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  } catch {
    throw new ApiError(0, "无法连接后端服务。请确认服务已启动且网络可达，然后刷新页面。");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) setRemoteToken(null);
    throw new ApiError(response.status, (data as { error?: string }).error || "请求失败。");
  }
  return data as T;
}
