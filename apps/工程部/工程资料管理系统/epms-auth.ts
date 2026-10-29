/** Fixed internal-core identity verification. JWT signing secrets never enter this app. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { EpmsError, type VerifiedEpmsActor } from "./epms-store";

const CORE = "http://core:8000/api/auth";
const COOKIE = "rr_epms_session";
const COOKIE_PATH = "/gongcheng-ziliao/";
const TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
type FetchLike = typeof fetch;
export interface CoreEpmsAuth {
  authenticate(req: IncomingMessage): Promise<VerifiedEpmsActor | null>;
  login(req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>): Promise<VerifiedEpmsActor>;
  logout(req: IncomingMessage, res: ServerResponse): Promise<{ ok: true }>;
}
function oneHeader(req: IncomingMessage, name: string): string {
  const value = req.headers[name]; return typeof value === "string" ? value : "";
}
function secure(req: IncomingMessage): boolean {
  return oneHeader(req, "x-forwarded-proto") === "https" || !!(req.socket as { encrypted?: boolean } | undefined)?.encrypted;
}
export function requireEpmsWriteOrigin(req: IncomingMessage): void {
  if (oneHeader(req, "x-epms-request") !== "1") throw new EpmsError(403, "缺少受控写入标记");
  const host = oneHeader(req, "host"), origin = oneHeader(req, "origin");
  if (!host || host.length > 300 || /[\s/\\@]/.test(host) || !origin) throw new EpmsError(403, "请求来源不合法");
  try {
    const incoming = new URL(origin);
    const expected = new URL((secure(req) ? "https://" : "http://") + host).origin;
    if (incoming.origin !== expected || origin !== incoming.origin) throw new Error("origin");
  } catch { throw new EpmsError(403, "仅允许本站发起受控制单写入"); }
}
function cookie(req: IncomingMessage): string | null {
  const raw = oneHeader(req, "cookie"); if (raw.length > 32768) return null;
  const found = raw.split(";").map(s => s.trim()).filter(s => s.startsWith(COOKIE + "="));
  if (found.length !== 1) return null;
  const token = found[0].slice(COOKIE.length + 1);
  return token.length <= 8192 && TOKEN.test(token) ? token : null;
}
function setCookie(req: IncomingMessage, res: ServerResponse, token: string, clear = false): void {
  res.setHeader("Set-Cookie", COOKIE + "=" + token + "; Path=" + COOKIE_PATH + "; HttpOnly; SameSite=Strict" + (secure(req) ? "; Secure" : "") + (clear ? "; Max-Age=0" : ""));
}
export function coreUserCapabilities(value: unknown): VerifiedEpmsActor {
  const u = value as Record<string, unknown>;
  if (!u || typeof u !== "object" || !Number.isSafeInteger(u.id) || (u.id as number) < 1 || typeof u.username !== "string" || !u.username
    || u.is_active !== true || typeof u.role !== "string" || !["admin", "manager", "user"].includes(u.role) || !Array.isArray(u.permissions) || !u.permissions.every(p => typeof p === "string")
    || !(u.department == null || typeof u.department === "string") || !(u.full_name == null || typeof u.full_name === "string")) throw new EpmsError(401, "账号不可用，请重新登录");
  const department = String(u.department ?? "").normalize("NFKC").trim().toLowerCase();
  const engineering = department === "工程部" || department === "engineering";
  const permissions = u.permissions as string[]; const fullname = String(u.full_name ?? "").trim();
  return { id: String(u.id), name: fullname || u.username, canRead: true, canEdit: engineering && permissions.includes("epms:edit"), canReview: u.role === "admin" || permissions.includes("epms:approve") };
}
export function createCoreEpmsAuth(fetchCore: FetchLike = fetch): CoreEpmsAuth {
  async function request(route: "login" | "me", token?: string, credentials?: { username: string; password: string }): Promise<unknown> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetchCore(CORE + "/" + route, {
        method: route === "login" ? "POST" : "GET", redirect: "error", signal: controller.signal,
        headers: route === "login" ? { "Content-Type": "application/json" } : { Authorization: "Bearer " + token },
        ...(credentials ? { body: JSON.stringify(credentials) } : {}),
      });
      if (response.status === 401 || response.status === 403) { await response.body?.cancel().catch(() => {}); throw new EpmsError(401, "账号或登录凭据无效"); }
      if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new EpmsError(503, "账号服务暂不可用，请稍后重试"); }
      if (!response.body) throw new EpmsError(503, "账号服务响应无效");
      const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
      try {
        for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 64 * 1024) throw new EpmsError(503, "账号服务响应无效"); parts.push(chunk.value); }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      try { return JSON.parse(Buffer.concat(parts).toString("utf8")); } catch { throw new EpmsError(503, "账号服务响应无效"); }
    } catch (e) { if (e instanceof EpmsError) throw e; throw new EpmsError(503, "账号服务暂不可用，请稍后重试"); }
    finally { clearTimeout(timer); }
  }
  return {
    async authenticate(req) {
      if (!["GET", "HEAD"].includes(req.method ?? "")) requireEpmsWriteOrigin(req);
      const token = cookie(req); if (!token) return null;
      return coreUserCapabilities(await request("me", token));
    },
    async login(req, res, body) {
      requireEpmsWriteOrigin(req);
      if (typeof body.username !== "string" || !body.username.trim() || body.username.length > 200 || typeof body.password !== "string" || !body.password || body.password.length > 4096) throw new EpmsError(400, "请输入账号和密码");
      const value = await request("login", undefined, { username: body.username.trim(), password: body.password }) as Record<string, unknown>;
      const token = value?.access_token; if (typeof token !== "string" || token.length > 8192 || !TOKEN.test(token)) throw new EpmsError(503, "账号服务登录响应无效");
      const actor = coreUserCapabilities(await request("me", token)); setCookie(req, res, token); return actor;
    },
    async logout(req, res) { requireEpmsWriteOrigin(req); setCookie(req, res, "", true); return { ok: true }; },
  };
}
