import { apiFetch } from "@/lib/apiFetch";

type CacheEntry<T> = { expiresAt: number; value: T };

const memory = new Map<string, CacheEntry<unknown>>();

function read<T>(key: string): CacheEntry<T> | null {
  const inMemory = memory.get(key) as CacheEntry<T> | undefined;
  if (inMemory && inMemory.expiresAt > Date.now()) return inMemory;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`sprayplan:${key}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (entry.expiresAt <= Date.now()) return null;
    memory.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

function readStale<T>(key: string): CacheEntry<T> | null {
  const inMemory = memory.get(key) as CacheEntry<T> | undefined;
  if (inMemory) return inMemory;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`sprayplan:${key}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    memory.set(key, entry);
    return entry;
  } catch { return null; }
}

function write<T>(key: string, entry: CacheEntry<T>) {
  memory.set(key, entry);
  if (typeof window === "undefined") return;
  try { window.sessionStorage.setItem(`sprayplan:${key}`, JSON.stringify(entry)); } catch { /* storage full */ }
}

/** Short-lived per-browser cache for read-only page data. */
export async function cachedJson<T>(url: string, ttlMs: number): Promise<T> {
  const hit = read<T>(url);
  if (hit) return hit.value;
  const response = await apiFetch(url);
  if (!response.ok) throw new Error(await response.text());
  const value = await response.json() as T;
  write(url, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

/** Show the last successful value immediately, while always refreshing it in the background. */
export async function staleWhileRevalidate<T>(url: string, ttlMs: number, onFresh: (value: T) => void): Promise<T | null> {
  const stale = readStale<T>(url)?.value ?? null;
  apiFetch(url).then(async (response) => {
    if (!response.ok) throw new Error(await response.text());
    const value = await response.json() as T;
    write(url, { value, expiresAt: Date.now() + ttlMs });
    onFresh(value);
  }).catch(() => { /* keep the last successful value */ });
  return stale;
}

export function invalidateClientCache(prefix: string) {
  for (const key of Array.from(memory.keys())) if (key.startsWith(prefix)) memory.delete(key);
  if (typeof window === "undefined") return;
  for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
    const key = window.sessionStorage.key(i);
    if (key?.startsWith(`sprayplan:${prefix}`)) window.sessionStorage.removeItem(key);
  }
}

export function clearClientCache() {
  memory.clear();
  if (typeof window === "undefined") return;
  for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
    const key = window.sessionStorage.key(i);
    if (key?.startsWith("sprayplan:")) window.sessionStorage.removeItem(key);
  }
}
