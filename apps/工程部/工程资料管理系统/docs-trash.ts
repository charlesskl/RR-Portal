/** Recycle-bin operations. Call only under the EPMS writer queue; never repair unknown state silently. */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { canonicalDocumentPath, EpmsError } from "./epms-store";

const DIR = ".回收站";
const MANIFEST = "manifest.json";
interface Entry { trashName: string; originalPath: string; deletedAt: number }
interface Context { root: string; dir: string; identity: string; rows: Entry[]; raw: Buffer | null; manifestIdentity: string | null }
const fail = (status: number, message: string): never => { throw new EpmsError(status, message); };
const identity = (s: fs.Stats) => [s.dev, s.ino, s.mode, s.uid, s.gid].join(":");
const fileIdentity = (s: fs.Stats) => [identity(s), s.size, s.mtimeMs, s.ctimeMs].join(":");
const internal = (p: string) => p.split(/[\\/]/).some(n => n.toLowerCase() === ".epms" || n.toLowerCase().startsWith(".epms-"));
const hasControl = (value: string) => Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

export function validateTrashName(raw: unknown): string {
  if (typeof raw !== "string" || !raw || raw === "." || raw === ".." || raw.startsWith(".") || raw === MANIFEST
    || Buffer.byteLength(raw) > 255 || /[\\/]/.test(raw) || hasControl(raw)) return fail(400, "回收站选择无效，资料已保留");
  return raw;
}
function originalPath(raw: unknown): string {
  if (typeof raw !== "string" || !raw || raw.length > 4096 || raw.startsWith("/") || raw.includes("\\") || hasControl(raw)
    || raw.split("/").some(p => !p || p === "." || p === "..") || internal(raw) || raw.split("/")[0] === DIR) return fail(409, "回收站原路径记录异常，资料已保留");
  return raw;
}
async function regularDirectory(p: string): Promise<fs.Stats> {
  const s = await fsp.lstat(p);
  if (!s.isDirectory() || s.isSymbolicLink()) return fail(409, "回收站目录异常，资料已保留");
  return s;
}
async function unchangedDirectory(c: Context): Promise<void> {
  if (identity(await regularDirectory(c.dir)) !== c.identity || await fsp.realpath(c.dir) !== c.dir) return fail(409, "回收站目录已变化，资料已保留");
}
async function safeTree(p: string, inside: string, depth = 0, count = { n: 0 }): Promise<fs.Stats> {
  const s = await fsp.lstat(p);
  if (++count.n > 30000 || depth > 16) return fail(413, "资料目录过大，不能可靠处理");
  if (s.isSymbolicLink() || (!s.isDirectory() && !s.isFile())) return fail(409, "资料包含异常链接或文件类型，资料已保留");
  const real = await fsp.realpath(p);
  if (real !== inside && !real.startsWith(inside + path.sep)) return fail(409, "资料实际路径越界，资料已保留");
  if (internal(path.basename(p))) return fail(409, "含制单状态记录的资料不能用旧回收接口处理");
  if (s.isDirectory()) for (const n of await fsp.readdir(p)) await safeTree(path.join(p, n), inside, depth + 1, count);
  return s;
}
async function manifestBytes(dir: string): Promise<{ raw: Buffer | null; stamp: string | null }> {
  const file = path.join(dir, MANIFEST); let fd: fsp.FileHandle;
  try { fd = await fsp.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return { raw: null, stamp: null }; return fail(409, "回收站记录文件异常，资料已保留"); }
  try {
    const before = await fd.stat(); if (!before.isFile() || before.size > 8 * 1024 * 1024) return fail(409, "回收站记录文件异常，资料已保留");
    const raw = await fd.readFile(); const after = await fd.stat(); const named = await fsp.lstat(file);
    if (fileIdentity(before) !== fileIdentity(after) || fileIdentity(before) !== fileIdentity(named) || raw.length !== before.size) return fail(409, "回收站记录读取期间已变化，资料已保留");
    return { raw, stamp: fileIdentity(before) };
  } finally { await fd.close(); }
}
async function context(root: string, create: boolean): Promise<Context | null> {
  const rootAbs = path.resolve(root); await regularDirectory(rootAbs); const actualRoot = await fsp.realpath(rootAbs); const dir = path.join(actualRoot, DIR);
  try { await fsp.lstat(dir); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    if (!create) return null;
    await fsp.mkdir(dir, { mode: 0o700 });
  }
  const s = await regularDirectory(dir); if (await fsp.realpath(dir) !== dir) return fail(409, "回收站实际目录异常，资料已保留");
  const names = await fsp.readdir(dir);
  if (names.some(n => n.startsWith(".recovery-") || n.startsWith(".manifest-") || n.startsWith(".purge-"))) return fail(409, "回收站有未完成操作，资料已保留，请联系管理员");
  const data = await manifestBytes(dir); let rows: Entry[] = [];
  if (data.raw) {
    try { const value: unknown = JSON.parse(data.raw.toString("utf8")); if (!Array.isArray(value) || value.length > 30000) return fail(409, "回收站记录损坏，资料已保留"); rows = value; }
    catch (e) { if (e instanceof EpmsError) throw e; return fail(409, "回收站记录损坏，资料已保留"); }
  }
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object" || !Number.isFinite(row.deletedAt) || row.deletedAt < 0) return fail(409, "回收站记录格式异常，资料已保留");
    try { validateTrashName(row.trashName); originalPath(row.originalPath); } catch { return fail(409, "回收站记录格式异常，资料已保留"); }
    if (seen.has(row.trashName)) return fail(409, "回收站记录重复，资料已保留"); seen.add(row.trashName);
    let member: fs.Stats; try { member = await fsp.lstat(path.join(dir, row.trashName)); } catch { return fail(409, "回收站记录与资料不一致，资料已保留"); }
    if (member.isSymbolicLink() || (!member.isFile() && !member.isDirectory())) return fail(409, "回收站资料类型异常，资料已保留");
  }
  if (names.some(n => !n.startsWith(".") && n !== MANIFEST && !seen.has(n))) return fail(409, "回收站有未登记资料，已保留，请联系管理员");
  return { root: actualRoot, dir, identity: identity(s), rows, raw: data.raw, manifestIdentity: data.stamp };
}
async function checkManifest(c: Context): Promise<void> {
  await unchangedDirectory(c); const current = await manifestBytes(c.dir);
  if (current.stamp !== c.manifestIdentity || (current.raw === null ? c.raw !== null : !c.raw || !current.raw.equals(c.raw))) return fail(409, "回收站记录已变化，资料已保留");
}
async function writeManifest(c: Context, rows: Entry[]): Promise<void> {
  await checkManifest(c); const temp = path.join(c.dir, ".manifest-" + randomUUID() + ".tmp"); let fd: fsp.FileHandle | undefined;
  const raw = Buffer.from(JSON.stringify(rows, null, 2)); if (raw.length > 8 * 1024 * 1024) return fail(413, "回收站记录达到上限，资料已保留");
  let committed = false;
  try {
    fd = await fsp.open(temp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    if (c.raw) { const old = await fsp.lstat(path.join(c.dir, MANIFEST)); await fd.chmod(old.mode & 0o7777); await fd.chown(old.uid, old.gid); }
    await fd.writeFile(raw); await fd.sync(); await fd.close(); fd = undefined; await checkManifest(c);
    await fsp.rename(temp, path.join(c.dir, MANIFEST)); committed = true; const parent = await fsp.open(c.dir, fs.constants.O_RDONLY);
    try { await parent.sync(); } finally { await parent.close(); }
    c.rows = rows; c.raw = raw; c.manifestIdentity = fileIdentity(await fsp.lstat(path.join(c.dir, MANIFEST)));
  } catch (e) {
    // A manifest rename followed by fsync failure is ambiguous; the caller must not undo a committed file move.
    if (committed) throw new EpmsError(503, "回收站记录提交状态需管理员核对，资料已保留");
    throw e;
  } finally { if (fd) await fd.close(); await fsp.unlink(temp).catch(e => { if (e.code !== "ENOENT") throw e; }); }
}
async function recovery(c: Context, action: string, from: string, to: string): Promise<never> {
  const file = path.join(c.dir, ".recovery-" + randomUUID() + ".json");
  await fsp.writeFile(file, JSON.stringify({ action, from: path.relative(c.root, from), to: path.relative(c.root, to), at: Date.now() }), { flag: "wx", mode: 0o600 }).catch(() => {});
  return fail(503, "回收站操作未完成，剩余资料已保留，请联系管理员，勿重复操作");
}
async function undoRename(c: Context, from: string, to: string, own: fs.Stats): Promise<void> {
  await unchangedDirectory(c);
  const now = await fsp.lstat(from); if (identity(now) !== identity(own)) return recovery(c, "rollback-source-changed", from, to);
  try { await fsp.lstat(to); return recovery(c, "rollback-destination-exists", from, to); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  await fsp.rename(from, to);
}
async function renameWithManifest(c: Context, from: string, to: string, own: fs.Stats, rows: Entry[]): Promise<void> {
  await checkManifest(c); await fsp.rename(from, to);
  try { await writeManifest(c, rows); }
  catch (e) {
    if (e instanceof EpmsError && e.status === 503) return recovery(c, "manifest-commit-uncertain", from, to);
    try { await undoRename(c, to, from, own); } catch { return recovery(c, "rename-rollback-failed", from, to); }
    throw e;
  }
}
function selected(c: Context | null, raw: unknown): { c: Context; row: Entry; source: string } {
  const name = validateTrashName(raw); if (!c) return fail(404, "回收站不存在");
  const row = c.rows.find(r => r.trashName === name); if (!row) return fail(404, "回收站记录不存在，资料已保留");
  return { c, row, source: path.join(c.dir, name) };
}
export async function verifyTrashForMove(root: string): Promise<void> { await context(root, false); }
export async function trashRestoreTarget(root: string, raw: unknown): Promise<string> {
  validateTrashName(raw); const item = selected(await context(root, false), raw); await safeTree(item.source, item.c.dir);
  await canonicalDocumentPath(root, item.row.originalPath); return item.row.originalPath;
}
export async function verifyTrashForPurge(root: string, raw: unknown): Promise<void> { await trashRestoreTarget(root, raw); }
export async function moveToTrashSafe(root: string, rel: string): Promise<string> {
  const relative = await canonicalDocumentPath(root, rel); if (!relative) return fail(400, "不能将资料根目录移入回收站");
  if (relative.split("/")[0] === DIR) return fail(400, "不能再次回收回收站内容");
  const c = (await context(root, true))!; const source = path.join(c.root, relative); const own = await safeTree(source, c.root);
  let short = path.basename(source); while (Buffer.byteLength(short) > 180) short = Array.from(short).slice(0, -1).join("");
  const name = new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID() + "__" + short; validateTrashName(name); const target = path.join(c.dir, name);
  const rows = [...c.rows, { trashName: name, originalPath: relative, deletedAt: Date.now() }];
  await renameWithManifest(c, source, target, own, rows); return name;
}
export async function restoreTrashSafe(root: string, raw: unknown): Promise<string> {
  validateTrashName(raw); const item = selected(await context(root, false), raw); const { c, row, source } = item; const own = await safeTree(source, c.dir);
  const rel = await canonicalDocumentPath(root, row.originalPath); let target = path.join(c.root, rel); const dir = path.dirname(target); await fsp.mkdir(dir, { recursive: true });
  const base = path.basename(target, path.extname(target)), ext = path.extname(target); let n = 0;
  while (fs.existsSync(target)) { if (++n > 1000) return fail(409, "恢复位置重名过多，资料已保留"); target = path.join(dir, base + " (" + n + ")" + ext); }
  await canonicalDocumentPath(root, path.relative(c.root, target));
  await renameWithManifest(c, source, target, own, c.rows.filter(r => r.trashName !== row.trashName)); return path.relative(c.root, target);
}
export async function purgeTrashSafe(root: string, raw: unknown): Promise<void> {
  validateTrashName(raw); const item = selected(await context(root, false), raw); const { c, row, source } = item; const own = await safeTree(source, c.dir);
  const oldRows = [...c.rows]; const quarantine = path.join(c.dir, ".purge-" + randomUUID());
  await renameWithManifest(c, source, quarantine, own, c.rows.filter(r => r.trashName !== row.trashName));
  try { await fsp.rm(quarantine, { recursive: true, force: false }); }
  catch {
    try { await undoRename(c, quarantine, source, own); await writeManifest(c, oldRows); }
    catch { return recovery(c, "purge-cleanup-incomplete", quarantine, source); }
    return fail(503, "清理未完成，资料已回到回收站，请稍后重试");
  }
}
export async function listTrashSafe(root: string) {
  const c = await context(root, false); if (!c) return [];
  return Promise.all(c.rows.map(async row => { const s = await fsp.lstat(path.join(c.dir, row.trashName)); return { ...row, name: path.basename(row.originalPath), kind: s.isDirectory() ? "dir" as const : "file" as const, size: s.isFile() ? s.size : 0 }; }));
}
