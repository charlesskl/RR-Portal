/** Single-process EPMS store; identity and capabilities come only from a server resolver. */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";

export interface VerifiedEpmsActor {
  id: string; name: string; canRead: boolean; canEdit: boolean; canReview: boolean;
}
export type EpmsIdentity = Pick<VerifiedEpmsActor, "id" | "name">;
export interface EpmsArtifact { path: string; bytes: number; sha256: string }
export interface EpmsSnapshot { dataSHA256: string; files: EpmsArtifact[] }
export interface EpmsRecord {
  schemaVersion: 1; version: number; status: "draft" | "pending" | "approved"; data: unknown;
  by: string; byId: string; createdBy: EpmsIdentity; updatedAt: number; docNo: string;
  lock: { by: string; actorId: string; at: number; tokenHash: string } | null;
  submittedBy?: EpmsIdentity; submittedSnapshot?: EpmsSnapshot;
  approvedBy?: EpmsIdentity; approvedSnapshot?: EpmsSnapshot;
  history: { at: number; by: string; actorId: string; action: string }[];
}
export class EpmsError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export const EPMS_LOCK_TTL = 15 * 60 * 1000;
const DOCS = new Set(["排模表", "排模图", "外购件清单", "作业指导书"]);
const MAX_RECORD = 4 * 1024 * 1024;
const queues = new Map<string, Promise<void>>();
const digest = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const identity = (a: VerifiedEpmsActor): EpmsIdentity => ({ id: a.id, name: a.name });
const error = (status: number, message: string): never => { throw new EpmsError(status, message); };
const hasControl = (value: string) => Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

/** Resolve existing ancestors, including aliases, before applying any legacy file policy. */
export async function canonicalDocumentPath(root: string, raw: string): Promise<string> {
  if (typeof raw !== "string" || raw.includes("\\") || hasControl(raw)) return error(400, "非法资料路径");
  const internal = (p: string) => p.split(path.sep).some(n => n.toLowerCase() === ".epms" || n.toLowerCase().startsWith(".epms-"));
  if (internal(raw)) return error(403, "制单状态目录不允许通过文件接口访问");
  const base = await fsp.realpath(path.resolve(root));
  const lexical = path.resolve(base, raw.replace(/^\/+/, ""));
  if (lexical !== base && !lexical.startsWith(base + path.sep)) return error(400, "资料路径超出根目录");
  let existing = lexical; const suffix: string[] = [];
  for (;;) {
    try { await fsp.lstat(existing); break; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT" || existing === base) return error(400, "资料路径不可用");
      suffix.unshift(path.basename(existing)); existing = path.dirname(existing);
    }
  }
  let resolved: string;
  try { resolved = path.join(await fsp.realpath(existing), ...suffix); } catch { return error(400, "资料链接目标不可用"); }
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return error(400, "资料链接目标超出根目录");
  const relative = path.relative(base, resolved);
  if (internal(relative)) return error(403, "制单状态目录不允许通过文件接口访问");
  return relative;
}

function checkActor(actor: VerifiedEpmsActor | null | undefined): VerifiedEpmsActor {
  if (!actor || typeof actor.id !== "string" || !actor.id || actor.id.length > 200 || typeof actor.name !== "string" || !actor.name || actor.name.length > 200
    || ![actor.canRead, actor.canEdit, actor.canReview].every(x => typeof x === "boolean")) return error(401, "请先通过受信任账号登录");
  if (!actor.canRead) return error(403, "没有工程制单台访问权限");
  return actor;
}
function docName(raw: unknown): string {
  const name = raw === "外购清单" ? "外购件清单" : raw;
  if (typeof name !== "string" || !DOCS.has(name)) return error(400, "非法单据类型");
  return name;
}
function components(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.length > 600 || raw.includes("\\")) return error(400, "非法项目路径");
  const parts = raw.split("/");
  if (parts.length !== 3 || parts.some(p => !p || p === "." || p === ".." || p.startsWith(".") || hasControl(p) || p.length > 200)) return error(400, "必须使用现有客户/年度/项目路径");
  return parts;
}
async function realDirectory(p: string, missing = false): Promise<boolean> {
  try { const s = await fsp.lstat(p); if (!s.isDirectory() || s.isSymbolicLink()) return error(400, "项目资料目录不允许符号链接"); return true; }
  catch (e) { if (missing && (e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; }
}
async function projectPath(root: string, raw: unknown): Promise<string> {
  const parts = components(raw); let current = path.resolve(root); await realDirectory(current);
  for (const p of parts) { current = path.join(current, p); if (!(await realDirectory(current, true))) return error(404, "项目不存在"); }
  return current;
}
async function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.then(fn, fn); const tail = result.then(() => undefined, () => undefined); queues.set(key, tail);
  try { return await result; } finally { if (queues.get(key) === tail) queues.delete(key); }
}
function validateData(doc: string, value: unknown): unknown {
  if (doc !== "排模表") { if (value != null) return error(400, "文件单据不能提交任意表单内容"); return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return error(400, "排模表内容格式错误");
  const data = value as Record<string, unknown>; const fields = ["moldNo", "cavities", "tonnage", "material", "shrinkage", "cycle", "weight"];
  if (Object.keys(data).some(k => ![...fields, "rows"].includes(k)) || fields.some(k => data[k] !== undefined && (typeof data[k] !== "string" || (data[k] as string).length > 2000))
    || !Array.isArray(data.rows) || data.rows.length > 1000) return error(400, "排模表内容格式错误");
  const rowFields = ["cavity", "partName", "partNo", "gate", "eject", "note"];
  for (const row of data.rows) if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).some(k => !rowFields.includes(k))
    || rowFields.some(k => (row as Record<string, unknown>)[k] !== undefined && (typeof (row as Record<string, unknown>)[k] !== "string" || ((row as Record<string, unknown>)[k] as string).length > 2000))) return error(400, "穴位明细格式错误");
  return JSON.parse(JSON.stringify(data));
}
function validateRecord(value: unknown): EpmsRecord {
  const r = value as EpmsRecord;
  if (!r || typeof r !== "object" || r.schemaVersion !== 1 || !Number.isSafeInteger(r.version) || r.version < 0
    || !["draft", "pending", "approved"].includes(r.status) || typeof r.docNo !== "string" || typeof r.byId !== "string" || typeof r.by !== "string"
    || !r.createdBy || typeof r.createdBy.id !== "string" || typeof r.createdBy.name !== "string" || !Number.isFinite(r.updatedAt) || !Array.isArray(r.history)
    || (r.lock !== null && (!r.lock || typeof r.lock.actorId !== "string" || typeof r.lock.by !== "string" || !Number.isFinite(r.lock.at) || typeof r.lock.tokenHash !== "string" || !/^[a-f0-9]{64}$/.test(r.lock.tokenHash)))) return error(409, "单据记录损坏或格式尚未迁移，原资料已保留，请联系管理员");
  return r;
}
async function readRecord(project: string, doc: string): Promise<EpmsRecord | null> {
  const dir = path.join(project, ".epms"); if (!(await realDirectory(dir, true))) return null;
  const file = path.join(dir, doc + ".json"); let fd: fsp.FileHandle;
  try { fd = await fsp.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  try {
    const s = await fd.stat(); if (!s.isFile() || s.size > MAX_RECORD) return error(409, "单据记录异常，原资料已保留");
    const raw = await fd.readFile("utf8"); const after = await fd.stat();
    if (s.size !== after.size || s.mtimeMs !== after.mtimeMs || s.ctimeMs !== after.ctimeMs) return error(409, "单据读取期间已变化，请重试");
    try { return validateRecord(JSON.parse(raw)); } catch (e) { if (e instanceof EpmsError) throw e; return error(409, "单据记录损坏，原资料已保留，请联系管理员"); }
  } finally { await fd.close(); }
}
async function writeRecord(project: string, doc: string, record: EpmsRecord): Promise<void> {
  const dir = path.join(project, ".epms");
  try { await fsp.mkdir(dir, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  await realDirectory(dir); const body = JSON.stringify(record, null, 2); if (Buffer.byteLength(body) > MAX_RECORD) return error(413, "单据已达到存储上限，原资料已保留");
  const target = path.join(dir, doc + ".json"); const temp = path.join(dir, ".epms-" + randomUUID() + ".tmp"); let fd: fsp.FileHandle | undefined;
  try {
    fd = await fsp.open(temp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    await fd.writeFile(body, "utf8"); await fd.sync(); await fd.close(); fd = undefined;
    await realDirectory(dir); await fsp.rename(temp, target); const parent = await fsp.open(dir, fs.constants.O_RDONLY); try { await parent.sync(); } finally { await parent.close(); }
  } finally { if (fd) await fd.close(); await fsp.unlink(temp).catch(e => { if (e.code !== "ENOENT") throw e; }); }
}
const active = (r: EpmsRecord) => r.lock && Date.now() - r.lock.at <= EPMS_LOCK_TTL;
function ownLock(r: EpmsRecord, a: VerifiedEpmsActor, token: unknown): void {
  if (!active(r) || r.lock!.actorId !== a.id || typeof token !== "string" || digest(token) !== r.lock!.tokenHash) return error(409, "编辑锁已失效或属于其他窗口，请重新读取并获取锁");
}
function version(r: EpmsRecord, supplied: unknown): void { if (!Number.isSafeInteger(supplied) || supplied !== r.version) return error(409, "单据已被更新，请保留草稿并重新读取后处理"); }
function history(r: EpmsRecord, a: VerifiedEpmsActor, action: string): void {
  r.by = a.name; r.byId = a.id; r.updatedAt = Date.now(); r.version++;
  r.history = [...r.history, { at: r.updatedAt, by: a.name, actorId: a.id, action }];
}
function publicRecord(r: EpmsRecord, token?: string) {
  const { lock, ...rest } = r; const visible = active(r) ? { by: lock!.by, actorId: lock!.actorId, at: lock!.at } : null;
  return { ...rest, lock: visible, lockTtl: EPMS_LOCK_TTL, ...(token && lock?.tokenHash === digest(token) ? { lockToken: token } : {}) };
}
export type EpmsSnapshotCapture = (project: string, doc: string, data: unknown) => Promise<EpmsSnapshot>;
export class EpmsStore {
  private root: string; private capture?: EpmsSnapshotCapture;
  constructor(root: string, capture?: EpmsSnapshotCapture) { this.root = root; this.capture = capture; }
  async session(actor: VerifiedEpmsActor | null) { return { ...checkActor(actor) }; }
  private async withRecord<T>(project: unknown, doc: unknown, actor: VerifiedEpmsActor | null, fn: (p: string, d: string, a: VerifiedEpmsActor, r: EpmsRecord | null) => Promise<T>): Promise<T> {
    const a = checkActor(actor); const p = await projectPath(this.root, project); const d = docName(doc);
    return serial(path.resolve(this.root), async () => fn(p, d, a, await readRecord(p, d)));
  }
  async get(project: unknown, doc: unknown, actor: VerifiedEpmsActor | null) {
    return this.withRecord(project, doc, actor, async (p, d, _a, r) => {
      if (!r) return { status: "none", version: 0, lock: null, lockTtl: EPMS_LOCK_TTL };
      if (r.status !== "approved") return publicRecord(r);
      let integrityStatus: "verified" | "changed" | "unavailable" = "unavailable";
      try {
        const current = await this.snapshot(p, d, r.data);
        if (r.approvedSnapshot) integrityStatus = JSON.stringify(current) === JSON.stringify(r.approvedSnapshot) ? "verified" : "changed";
      } catch { /* A read failure is unknown integrity, never proof of an unchanged file. */ }
      return { ...publicRecord(r), integrityStatus, integrityChanged: integrityStatus === "unavailable" ? null : integrityStatus === "changed" };
    });
  }
  async lock(project: unknown, doc: unknown, actor: VerifiedEpmsActor | null, token?: unknown) {
    return this.withRecord(project, doc, actor, async (p, d, a, old) => {
      if (old?.status === "approved") return error(409, "已归档单据不可重新编辑");
      if (old?.status === "pending" ? !a.canReview : !a.canEdit) return error(403, "没有当前单据的编辑或审核权限");
      // A supplied token is a renewal, never implicit permission to acquire a new lease.
      if (token !== undefined && (!old || !active(old))) return error(409, "操作锁已过期，请保留当前输入并重新打开单据");
      if (old && active(old)) ownLock(old, a, token);
      const now = Date.now(); const r: EpmsRecord = old ?? { schemaVersion: 1, version: 0, status: "draft", data: null, by: a.name, byId: a.id, createdBy: identity(a), updatedAt: now, docNo: "DOC-" + randomUUID(), lock: null, history: [] };
      const nextToken = old && active(old) ? token as string : randomUUID();
      r.lock = { by: a.name, actorId: a.id, at: now, tokenHash: digest(nextToken) };
      await writeRecord(p, d, r); return publicRecord(r, nextToken);
    });
  }
  async unlock(project: unknown, doc: unknown, actor: VerifiedEpmsActor | null, token: unknown) {
    return this.withRecord(project, doc, actor, async (p, d, a, r) => { if (r?.lock) { ownLock(r, a, token); r.lock = null; await writeRecord(p, d, r); } return { ok: true as const }; });
  }
  async save(project: unknown, doc: unknown, actor: VerifiedEpmsActor | null, data: unknown, expectedVersion: unknown, token: unknown) {
    return this.withRecord(project, doc, actor, async (p, d, a, r) => {
      if (!a.canEdit) return error(403, "没有制单权限"); if (!r) return error(409, "请先读取单据并获取编辑锁");
      if (r.status !== "draft") return error(409, "审核中或已归档单据不可修改，请先按流程退回");
      ownLock(r, a, token); version(r, expectedVersion); r.data = validateData(d, data); r.lock!.at = Date.now(); history(r, a, "保存草稿");
      await writeRecord(p, d, r); return publicRecord(r, token as string);
    });
  }
  private async snapshot(p: string, d: string, data: unknown): Promise<EpmsSnapshot> {
    if (this.capture) return this.capture(p, d, data);
    return captureEpmsSnapshot(p, d, data);
  }
  async status(project: unknown, doc: unknown, actor: VerifiedEpmsActor | null, action: unknown, expectedVersion: unknown, token: unknown) {
    return this.withRecord(project, doc, actor, async (p, d, a, r) => {
      if (!r) return error(404, "单据不存在"); if (typeof action !== "string" || !["submit", "approve", "return"].includes(action)) return error(400, "非法操作");
      ownLock(r, a, token); version(r, expectedVersion);
      if (action === "submit") {
        if (!a.canEdit) return error(403, "没有制单权限"); if (r.status !== "draft") return error(409, "只能提交草稿单据");
        r.submittedSnapshot = await this.snapshot(p, d, r.data); r.submittedBy = identity(a); r.status = "pending";
      } else {
        if (!a.canReview) return error(403, "没有工程师审核权限"); if (r.status !== "pending") return error(409, "只能审核待审核单据");
        if (action === "approve") {
          const current = await this.snapshot(p, d, r.data); if (JSON.stringify(current) !== JSON.stringify(r.submittedSnapshot)) return error(409, "提交后的资料已变化，请驳回后重新提交");
          r.status = "approved"; r.approvedBy = identity(a); r.approvedSnapshot = current;
        } else { r.status = "draft"; delete r.submittedBy; delete r.submittedSnapshot; }
      }
      r.lock = null; history(r, a, action === "submit" ? "提交工程师审核" : action === "approve" ? "审核通过并归档" : "审核驳回");
      await writeRecord(p, d, r); return publicRecord(r);
    });
  }
  async withFileMutation<T>(targets: string[] | (() => Promise<string[]>), actor: () => Promise<VerifiedEpmsActor | null>, token: unknown, perform: () => Promise<T>): Promise<T> {
    const root = path.resolve(this.root);
    return serial(root, async () => {
      const selected = typeof targets === "function" ? await targets() : targets;
      const relative = await Promise.all(selected.map(raw => canonicalDocumentPath(root, raw)));
      const projects: string[] = [];
      const entries = async (p: string) => (await fsp.readdir(p, { withFileTypes: true })).filter(e => e.isDirectory() && !e.isSymbolicLink() && !e.name.startsWith("."));
      for (const c of await entries(root)) {
        if (c.name === "系统模板库") continue;
        for (const y of await entries(path.join(root, c.name))) for (const p of await entries(path.join(root, c.name, y.name))) {
          const rel = [c.name, y.name, p.name].join("/");
          if (relative.some(t => t === rel || t.startsWith(rel + "/") || rel.startsWith(t + "/"))) projects.push(rel);
          if (projects.length > 5000) return error(413, "本次资料操作涉及过多项目");
        }
      }
      let verified: VerifiedEpmsActor | undefined;
      for (const project of projects) {
        const full = await projectPath(root, project);
        for (const doc of DOCS) {
          const r = await readRecord(full, doc); if (!r) continue;
          const affected = relative.some(t => {
            if (t === project || project.startsWith(t + "/")) return true;
            if (!t.startsWith(project + "/")) return false;
            const within = t.slice(project.length + 1);
            return docAliases(doc).some(n => path.basename(t).includes(n))
              || [...(r.submittedSnapshot?.files ?? []), ...(r.approvedSnapshot?.files ?? [])].some(f => f.path === within || f.path.startsWith(within + "/"))
              || fs.existsSync(path.join(root, t)) && fs.lstatSync(path.join(root, t)).isDirectory();
          });
          if (!affected) continue;
          if (r.status !== "draft") return error(409, "审核中或已归档资料不可通过文件接口改写、改名或删除");
          if (relative.some(t => t === project || project.startsWith(t + "/"))) return error(409, "含制单记录的项目不能通过旧文件接口移动或删除");
          verified ??= checkActor(await actor()); if (!verified.canEdit) return error(403, "没有资料编辑权限"); ownLock(r, verified, token);
        }
      }
      return perform();
    });
  }
}

function docAliases(doc: string): string[] { return doc === "外购件清单" ? ["外购件清单", "外购清单"] : [doc]; }
/** Hash the actual revision submitted for review; no copy or modification of document bodies. */
export async function captureEpmsSnapshot(project: string, doc: string, data: unknown): Promise<EpmsSnapshot> {
  const form = doc === "排模表" ? validateData(doc, data) : null; const files: EpmsArtifact[] = []; let visited = 0, total = 0;
  async function walk(dir: string, rel: string, depth: number): Promise<void> {
    if (depth > 4) return;
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      if (++visited > 5000) return error(413, "项目资料过多，不能可靠封存");
      const name = rel ? rel + "/" + e.name : e.name; const abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) return error(400, "受控资料不允许符号链接");
      if (e.isDirectory()) { await walk(abs, name, depth + 1); continue; }
      if (!e.isFile() || !docAliases(doc).some(n => e.name.includes(n))) continue;
      const fd = await fsp.open(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const before = await fd.stat(); total += before.size; if (!before.isFile() || total > 512 * 1024 * 1024) return error(413, "受控资料过大，不能可靠封存");
        const hash = createHash("sha256"); const buffer = Buffer.alloc(1024 * 1024); let bytes = 0;
        for (;;) { const read = await fd.read(buffer, 0, buffer.length, null); if (!read.bytesRead) break; bytes += read.bytesRead; hash.update(buffer.subarray(0, read.bytesRead)); }
        const after = await fd.stat(); const named = await fsp.lstat(abs);
        if (before.ino !== named.ino || before.dev !== named.dev || before.size !== bytes || after.size !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) return error(409, "提交读取期间资料已改变，请重试");
        files.push({ path: name, bytes, sha256: hash.digest("hex") });
      } finally { await fd.close(); }
    }
  }
  await walk(project, "", 0); files.sort((a, b) => a.path.localeCompare(b.path));
  if (doc !== "排模表" && files.length === 0) return error(409, "请先上传该单据的资料文件再提交");
  return { dataSHA256: digest(JSON.stringify(form)), files };
}
