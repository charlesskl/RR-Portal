// Backend connection settings for ToyQMS.
// Default stays fully local (localStorage); switching to "remote" routes all
// data + auth through the Fastify/SQLite server in server/.
export type BackendMode = "local" | "remote";
export interface BackendSettings { mode: BackendMode; url: string; }

const SETTINGS_KEY = "toyqms.backend.v1";
const TOKEN_KEY = "toyqms.remote.session.v1";

export const DEFAULT_BACKEND_URL = "http://127.0.0.1:4313";

// Empty url means "same origin": the page was served by the ToyQMS backend
// itself (single-container / nginx /api proxy deployment).
export function getBackendSettings(): BackendSettings {
  if (typeof window === "undefined") return { mode: "local", url: DEFAULT_BACKEND_URL };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw === null) return { mode: "local", url: "" };
    const saved = JSON.parse(raw) as Partial<BackendSettings>;
    return { mode: saved.mode === "remote" ? "remote" : "local", url: (saved.url ?? "").replace(/\/+$/, "") };
  } catch {
    return { mode: "local", url: "" };
  }
}

export function hasExplicitBackendSettings(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(SETTINGS_KEY) !== null;
}

// Effective base URL for API calls: explicit url, otherwise same origin.
export function getBackendBaseUrl(): string {
  const { url } = getBackendSettings();
  if (url) return url;
  if (typeof window !== "undefined") return window.location.origin;
  return DEFAULT_BACKEND_URL;
}

// When the page is served by the ToyQMS backend (Docker / nginx deployment),
// probe the same-origin API once and switch to remote mode automatically so
// every device opening the site shares the same accounts and data.
export async function autoDetectBackend(): Promise<boolean> {
  if (typeof window === "undefined" || hasExplicitBackendSettings()) return false;
  try {
    const response = await fetch("/api/health");
    const data = await response.json().catch(() => null);
    if (response.ok && data?.product === "ToyQMS") {
      saveBackendSettings({ mode: "remote", url: "" });
      return true;
    }
  } catch { /* no same-origin backend */ }
  return false;
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
    throw new ApiError(0, `无法连接后端服务（${base}）。请确认 server 已启动，或在系统设置中切回本地模式。`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) setRemoteToken(null);
    throw new ApiError(response.status, (data as { error?: string }).error || "请求失败。");
  }
  return data as T;
}
