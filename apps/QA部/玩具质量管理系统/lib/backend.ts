// Backend connection settings for ToyQMS.
// Default stays fully local (localStorage); switching to "remote" routes all
// data + auth through the Fastify/SQLite server in server/.
export type BackendMode = "local" | "remote";
export interface BackendSettings { mode: BackendMode; url: string; }

const SETTINGS_KEY = "toyqms.backend.v1";
const TOKEN_KEY = "toyqms.remote.session.v1";

export const DEFAULT_BACKEND_URL = "http://127.0.0.1:4313";

export function getBackendSettings(): BackendSettings {
  if (typeof window === "undefined") return { mode: "local", url: DEFAULT_BACKEND_URL };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "") as Partial<BackendSettings>;
    return { mode: saved.mode === "remote" ? "remote" : "local", url: (saved.url || DEFAULT_BACKEND_URL).replace(/\/+$/, "") };
  } catch {
    return { mode: "local", url: DEFAULT_BACKEND_URL };
  }
}

export function saveBackendSettings(settings: BackendSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ mode: settings.mode, url: settings.url.replace(/\/+$/, "") }));
}

export function isRemoteMode() {
  return getBackendSettings().mode === "remote";
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
  const { url } = getBackendSettings();
  const token = getRemoteToken();
  let response: Response;
  try {
    response = await fetch(`${url}/api${path}`, {
      method: options.method || "GET",
      headers: {
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  } catch {
    throw new ApiError(0, `无法连接后端服务（${url}）。请确认 server 已启动，或在系统设置中切回本地模式。`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) setRemoteToken(null);
    throw new ApiError(response.status, (data as { error?: string }).error || "请求失败。");
  }
  return data as T;
}
