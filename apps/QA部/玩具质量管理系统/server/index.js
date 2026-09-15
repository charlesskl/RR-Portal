// ToyQMS API server — Fastify + SQLite (node:sqlite).
// Run: npm install && npm start   (default http://127.0.0.1:4313)
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as repo from "./repository.js";
import * as auth from "./auth.js";
import * as ai from "./ai.js";

const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
await app.register(cors, { origin: true });

const serverRoot = path.dirname(fileURLToPath(import.meta.url));

const TOKEN_HEADER = /^Bearer\s+(.+)$/i;

function sessionUser(request) {
  const token = TOKEN_HEADER.exec(request.headers.authorization || "")?.[1];
  return auth.userForToken(token);
}
function requireUser(request, reply) {
  const user = sessionUser(request);
  if (!user) {
    reply.code(401).send({ error: "未登录或会话已过期。" });
    return null;
  }
  return user;
}
function requirePermission(request, reply, permission) {
  const user = requireUser(request, reply);
  if (!user) return null;
  if (!auth.hasPermission(user, permission)) {
    reply.code(403).send({ error: "当前账户没有执行此操作的权限。" });
    return null;
  }
  return user;
}
const handle = (fn) => async (request, reply) => {
  try {
    return await fn(request, reply);
  } catch (error) {
    reply.code(400).send({ error: error instanceof Error ? error.message : "请求失败。" });
  }
};

app.get("/api/health", () => ({ ok: true, product: "ToyQMS", version: "0.4.0" }));

// ---------- auth & users ----------

app.post("/api/auth/login", handle(async (request) => {
  const { loginName, password } = request.body || {};
  const user = await auth.login(String(loginName || ""), String(password || ""));
  const token = auth.createSession(user.id);
  return { token, user: auth.publicUser(user) };
}));

app.post("/api/auth/logout", handle(async (request) => {
  const token = TOKEN_HEADER.exec(request.headers.authorization || "")?.[1];
  if (token) auth.destroySession(token);
  return { ok: true };
}));

app.get("/api/auth/me", handle(async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  return { user: auth.publicUser(user) };
}));

app.post("/api/auth/change-password", handle(async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const { currentPassword, newPassword } = request.body || {};
  await auth.changeOwnPassword(user, String(currentPassword || ""), String(newPassword || ""));
  return { ok: true };
}));

app.get("/api/users", handle(async (request, reply) => {
  if (!requireUser(request, reply)) return;
  return auth.listUsers();
}));

app.post("/api/users", handle(async (request, reply) => {
  if (!requirePermission(request, reply, "manage_users")) return;
  return auth.createUser(request.body || {});
}));

app.patch("/api/users/:id", handle(async (request, reply) => {
  const actor = requirePermission(request, reply, "manage_users");
  if (!actor) return;
  return auth.updateUser(request.params.id, request.body || {}, actor.id);
}));

app.post("/api/users/:id/reset-password", handle(async (request, reply) => {
  if (!requirePermission(request, reply, "manage_users")) return;
  await auth.resetPassword(request.params.id);
  return { ok: true };
}));

app.delete("/api/users/:id", handle(async (request, reply) => {
  const actor = requirePermission(request, reply, "manage_users");
  if (!actor) return;
  auth.deleteUser(request.params.id, actor.id);
  return { ok: true };
}));

// Bulk import of full local user records (with password digests) when
// migrating from browser storage to the backend. Upserts by login name and
// invalidates all sessions afterwards.
app.post("/api/users/import", handle(async (request, reply) => {
  if (!requirePermission(request, reply, "manage_users")) return;
  const { users } = request.body || {};
  return { imported: auth.importUsers(users) };
}));

// ---------- complaints ----------

app.get("/api/complaints", handle(async (request, reply) => {
  if (!requireUser(request, reply)) return;
  return repo.getAll();
}));

app.post("/api/complaints/import", handle(async (request, reply) => {
  if (!requirePermission(request, reply, "import_data")) return;
  const { records, summary } = request.body || {};
  return { imported: repo.importNew(records || [], summary || {}) };
}));

app.get("/api/import-history", handle(async (request, reply) => {
  if (!requireUser(request, reply)) return;
  return repo.getImportHistory();
}));

app.patch("/api/complaints/:id/issue", handle(async (request, reply) => {
  if (!requirePermission(request, reply, "manage_classification")) return;
  repo.updateComplaintIssue(request.params.id, request.body?.issueType ?? null);
  return { ok: true };
}));

app.patch("/api/complaints/:id", handle(async (request, reply) => {
  if (!requirePermission(request, reply, "manage_complaints")) return;
  repo.updateComplaint(request.params.id, request.body || {});
  return { ok: true };
}));

app.post("/api/complaints/status", handle(async (request, reply) => {
  if (!requirePermission(request, reply, "manage_complaints")) return;
  const { ids, status } = request.body || {};
  return repo.updateComplaintStatuses(ids || [], status);
}));

app.post("/api/complaints/delete", handle(async (request, reply) => {
  if (!requirePermission(request, reply, "delete_complaints")) return;
  return { deleted: repo.deleteComplaints(request.body?.ids || []) };
}));

// ---------- translations ----------

app.patch("/api/complaints/:id/translation", handle(async (request, reply) => {
  if (!requirePermission(request, reply, "manage_translation")) return;
  repo.updateComplaintTranslation(request.params.id, request.body || {});
  return { ok: true };
}));

app.post("/api/translations/import", handle(async (request, reply) => {
  if (!requirePermission(request, reply, "manage_translation")) return;
  const { rows, invalidRows } = request.body || {};
  return repo.importTranslations(rows || [], invalidRows || 0);
}));

app.post("/api/translations/confirm", handle(async (request, reply) => {
  if (!requirePermission(request, reply, "manage_translation")) return;
  return { confirmed: repo.confirmTranslations(request.body?.ids || []) };
}));

app.post("/api/translations/reset-offline", handle(async (request, reply) => {
  if (!requirePermission(request, reply, "manage_translation")) return;
  return { reset: repo.resetOfflineTranslations() };
}));

// ---------- AI (Moonshot / Kimi) ----------
// All AI output is a draft: translations land as 待审核, classifications are
// returned as suggestions and only persisted when a human confirms them.

app.get("/api/ai/status", handle(async (request, reply) => {
  if (!requireUser(request, reply)) return;
  return { configured: ai.aiConfigured() };
}));

app.post("/api/ai/translate", handle(async (request, reply) => {
  if (!requirePermission(request, reply, "manage_translation")) return;
  const ids = Array.isArray(request.body?.ids) ? request.body.ids.map(String) : [];
  if (!ids.length) throw new Error("请先选择要翻译的记录。");
  if (ids.length > 100) throw new Error("单次最多翻译 100 条，请分批操作。");
  if (!ai.aiConfigured()) throw new Error("AI 功能未配置：请在服务器环境变量中设置 MOONSHOT_API_KEY 后重启服务。");
  const wanted = new Set(ids);
  const targets = repo.getAll().filter((record) =>
    wanted.has(record.id) &&
    (record.translationStatus === "pending" || record.translationStatus === "failed") &&
    record.complaintMessageOriginal?.trim());
  if (!targets.length) return { translated: 0, failed: 0, skipped: ids.length };
  const results = await ai.translateBatch(targets);
  let translated = 0, failed = 0;
  for (const record of targets) {
    const result = results.get(record.id);
    if (result?.translation) {
      repo.updateComplaintTranslation(record.id, {
        complaintMessageZhMachine: result.translation,
        complaintMessageZhFinal: null,
        translationStatus: "translated",
        translationProvider: "moonshot",
        translationModel: ai.modelName(),
      });
      translated += 1;
    } else {
      failed += 1;
    }
  }
  return { translated, failed, skipped: ids.length - targets.length };
}));

app.post("/api/ai/classify", handle(async (request, reply) => {
  if (!requirePermission(request, reply, "manage_classification")) return;
  const ids = Array.isArray(request.body?.ids) ? request.body.ids.map(String) : [];
  if (!ids.length) throw new Error("请先选择要分类的记录。");
  if (ids.length > 100) throw new Error("单次最多分类 100 条，请分批操作。");
  if (!ai.aiConfigured()) throw new Error("AI 功能未配置：请在服务器环境变量中设置 MOONSHOT_API_KEY 后重启服务。");
  const wanted = new Set(ids);
  const targets = repo.getAll().filter((record) => wanted.has(record.id) && !record.issueType && record.complaintMessageOriginal?.trim());
  if (!targets.length) return { suggestions: [] };
  const results = await ai.classifyBatch(targets, repo.getIssueTypeDefinitions());
  return {
    suggestions: targets.map((record) => ({ id: record.id, ...(results.get(record.id) || { error: "分类失败。" }) })),
  };
}));

// ---------- issue types & series ----------

app.get("/api/issue-types", handle(async (request, reply) => {
  if (!requireUser(request, reply)) return;
  return repo.getIssueTypes();
}));

app.get("/api/issue-type-definitions", handle(async (request, reply) => {
  if (!requireUser(request, reply)) return;
  return repo.getIssueTypeDefinitions();
}));

app.post("/api/issue-types", handle(async (request, reply) => {
  if (!requirePermission(request, reply, "manage_classification")) return;
  return repo.saveIssueType(String(request.body?.name || ""));
}));

app.put("/api/issue-types/chinese-name", handle(async (request, reply) => {
  if (!requirePermission(request, reply, "manage_classification")) return;
  repo.updateIssueTypeChineseName(String(request.body?.name || ""), String(request.body?.chineseName || ""));
  return { ok: true };
}));

app.get("/api/series-definitions", handle(async (request, reply) => {
  if (!requireUser(request, reply)) return;
  return repo.getSeriesDefinitions();
}));

app.put("/api/series-definitions/chinese-name", handle(async (request, reply) => {
  if (!requirePermission(request, reply, "manage_classification")) return;
  const { kind, name, chineseName, primarySeriesName } = request.body || {};
  repo.updateSeriesChineseName(kind, String(name || ""), String(chineseName || ""), primarySeriesName ?? null);
  return { ok: true };
}));

// ---------- CAP ----------

app.get("/api/caps", handle(async (request, reply) => {
  if (!requireUser(request, reply)) return;
  return repo.getCAPs();
}));

app.put("/api/caps", handle(async (request, reply) => {
  if (!requirePermission(request, reply, "manage_cap")) return;
  const { input, id } = request.body || {};
  return repo.saveCAP(input, id || undefined);
}));

app.delete("/api/caps/:id", handle(async (request, reply) => {
  if (!requirePermission(request, reply, "manage_cap")) return;
  repo.deleteCAP(request.params.id);
  return { ok: true };
}));

// ---------- backup / maintenance ----------

app.get("/api/backup", handle(async (request, reply) => {
  if (!requireUser(request, reply)) return;
  return repo.exportLocalData();
}));

app.post("/api/backup/restore", handle(async (request, reply) => {
  if (!requirePermission(request, reply, "manage_settings")) return;
  repo.restoreLocalData(request.body);
  return { ok: true };
}));

app.post("/api/clear", handle(async (request, reply) => {
  if (!requirePermission(request, reply, "manage_settings")) return;
  repo.clear();
  return { ok: true };
}));

// ---------- static frontend (production: single container serves out/) ----------

const staticDir = path.resolve(serverRoot, process.env.TOYQMS_STATIC_DIR || path.join(serverRoot, "..", "out"));
if (fs.existsSync(path.join(staticDir, "index.html"))) {
  await app.register(fastifyStatic, { root: staticDir, index: ["index.html"] });
  app.setNotFoundHandler((request, reply) => {
    if (request.method === "GET" && !request.url.startsWith("/api/")) {
      return reply.code(404).sendFile("404.html");
    }
    reply.code(404).send({ error: "接口不存在。" });
  });
}

// ---------- start ----------

const port = Number(process.env.PORT || process.env.TOYQMS_PORT || 4313);
const host = process.env.HOST || "127.0.0.1";

await auth.ensureSeedUser();
await app.listen({ port, host });
