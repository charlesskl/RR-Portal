// Backend connection settings for ToyQMS.
// The app ALWAYS talks to the Fastify/SQLite backend - there is no
// browser-local (localStorage) mode anymore. The only setting is the
// backend address; empty means "same origin" (the backend serves the
// page itself: single-container / nginx reverse-proxy deployment).
export type BackendMode = "remote";
export interface BackendSettings { mode: BackendMode; url: string; }

const SETTINGS_KEY = "toyqms.backend.v1";
const TOKEN_KEY = "toyqms.remote.session.v1";

export const DEFAULT_BACKEND_URL = "http://127.0.0.1:4313";

export function getBackendSettings(): BackendSettings {
  if (typeof window === "undefined") return { mode: "remote", url: "" };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "") as Partial<BackendSettings>;
    return { mode: "remote", url: (saved.url ?? "").replace(/\/+$/, "") };
  } catch {
    return { mode: "remote", url: "" };
  }
}

export function saveBackendSettings(settings: BackendSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ mode: "remote", url: settings.url.replace(/\/+$/, "") }));
}

// Remove any manually saved backend address (back to same origin).
export function resetBackendUrl() {
  if (typeof window !== "undefined") localStorage.removeItem(SETTINGS_KEY);
}

async function probe(base: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`${base}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    const data = await response.json().catch(() => null);
    return response.ok && data?.product === "ToyQMS";
  } catch {
    return false;
  }
}

// A stale manually-saved backend address (e.g. pointing at a server this
// device cannot reach right now) must not brick the login page: probe it,
// and when it fails while the same-origin API works, fall back to same origin.
export async function ensureReachableBackend(): Promise<void> {
  if (typeof window === "undefined") return;
  const { url } = getBackendSettings();
  if (!url) return;
  if (await probe(url)) return;
  if (await probe(window.location.origin)) resetBackendUrl();
}

// Effective base URL for API calls: explicit url, otherwise same origin.
export function getBackendBaseUrl(): string {
  const { url } = getBackendSettings();
  if (url) return url;
  if (typeof window !== "undefined") return window.location.origin;
  return DEFAULT_BACKEND_URL;
}

export function isRemoteMode() {
  return true;
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
    throw new ApiError(0, `无法连接后端服务（${base}）。请确认后端已启动且网络可达，然后刷新页面。`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) setRemoteToken(null);
    throw new ApiError(response.status, (data as { error?: string }).error || "请求失败。");
  }
  return data as T;
}
