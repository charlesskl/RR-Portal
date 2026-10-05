/**
 * 工程资料管理系统 — 本地文件 API（Vite 中间件插件）
 *
 * 在 `npm run dev` 启动的同一个进程内提供 /api/* REST 接口，
 * 直接读写工程资料根目录（默认 /Volumes/XX/工程部/工程资料，
 * 可在项目根目录 docs.config.json 的 root 字段或环境变量 DOCS_ROOT 修改）。
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { preserveImagesOnOverwrite } from "./vite-plugin-xlsx-images";
import type { Plugin, Connect } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

const TRASH_DIRNAME = ".回收站";
const TEMPLATE_DIRS = ["工程放产资料", "模具图/2D排位图", "模具图/3D模具图", "包装印刷最终文件"];
const SKIP_DIRS = new Set([TRASH_DIRNAME, "node_modules", ".git", ".DS_Store"]);

function loadRoot(projectRoot: string): string {
  if (process.env.DOCS_ROOT) return process.env.DOCS_ROOT;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, "docs.config.json"), "utf-8"));
    if (cfg.root) return cfg.root;
  } catch {
    /* use default */
  }
  return path.join(projectRoot, "资料库存储");
}

/* ---------- 工具函数 ---------- */

function json(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function fail(res: ServerResponse, status: number, message: string) {
  json(res, status, { error: message });
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/** 将相对路径安全解析到 root 内，越界返回 null */
function resolveSafe(root: string, rel: string): string | null {
  const cleaned = (rel || "").replace(/^\/+/, "");
  const abs = path.resolve(root, cleaned);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

/** 冲突时自动生成 "name (1).ext" 形式的新名字 */
async function uniquePath(absPath: string): Promise<string> {
  if (!fs.existsSync(absPath)) return absPath;
  const dir = path.dirname(absPath);
  const ext = path.extname(absPath);
  const base = path.basename(absPath, ext);
  for (let i = 1; i < 1000; i++) {
    const candidate = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error("无法生成唯一文件名");
}

const MIME: Record<string, string> = {  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".mp4": "video/mp4",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
  ".rar": "application/vnd.rar",
  ".ai": "application/postscript",
};

interface WalkItem {
  rel: string;
  name: string;
  size: number;
  mtime: number;
  ext: string;
}

/** 受限递归遍历：限制深度与总条目数，跳过隐藏目录与回收站 */
async function walk(root: string, opts: { maxDepth: number; maxVisit: number }): Promise<WalkItem[]> {
  const out: WalkItem[] = [];
  let visited = 0;
  async function visit(dirAbs: string, rel: string, depth: number) {
    if (depth > opts.maxDepth || visited >= opts.maxVisit) return;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (visited >= opts.maxVisit) return;
      if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
      visited++;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const childAbs = path.join(dirAbs, e.name);
      if (e.isDirectory()) {
        await visit(childAbs, childRel, depth + 1);
      } else if (e.isFile()) {
        try {
          const st = await fsp.stat(childAbs);
          out.push({
            rel: childRel,
            name: e.name,
            size: st.size,
            mtime: st.mtimeMs,
            ext: path.extname(e.name).toLowerCase(),
          });
        } catch {
          /* ignore */
        }
      }
    }
  }
  await visit(root, "", 0);
  return out;
}

/* ---------- 路由处理 ---------- */

/** 把 root 内的某个路径移入回收站并记录 manifest，返回回收站条目名 */
async function moveToTrash(root: string, rel: string): Promise<string> {
  const abs = resolveSafe(root, rel);
  if (!abs || abs === root || !fs.existsSync(abs)) throw new Error(`路径不存在: ${rel}`);
  const trashAbs = path.join(root, TRASH_DIRNAME);
  await fsp.mkdir(trashAbs, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const trashName = `${stamp}__${path.basename(abs)}`;
  await fsp.rename(abs, path.join(trashAbs, trashName));
  const manifestPath = path.join(trashAbs, "manifest.json");
  let manifest: { trashName: string; originalPath: string; deletedAt: number }[] = [];
  try {
    manifest = JSON.parse(await fsp.readFile(manifestPath, "utf-8"));
  } catch {
    /* fresh */
  }
  manifest.push({ trashName, originalPath: rel, deletedAt: Date.now() });
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return trashName;
}

type Handler = (ctx: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  root: string;
  projectRoot: string;
}) => Promise<void>;

const routes: Record<string, { method: string; handler: Handler }> = {
  "/api/config": {
    method: "GET",
    handler: async ({ res, root, projectRoot }) => {
      const mounted = fs.existsSync(root);
      let smbBase = "smb://NAS/XX";
      try {
        const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, "docs.config.json"), "utf-8"));
        if (cfg.smbBase) smbBase = cfg.smbBase;
      } catch {
        /* default */
      }
      json(res, 200, { root, mounted, smbBase });
    },
  },

  "/api/list": {
    method: "GET",
    handler: async ({ res, url, root }) => {
      const rel = url.searchParams.get("path") || "";
      const abs = resolveSafe(root, rel);
      if (!abs) return fail(res, 400, "非法路径");
      let dirents: fs.Dirent[];
      try {
        dirents = await fsp.readdir(abs, { withFileTypes: true });
      } catch (e) {
        return fail(res, 404, `目录不存在或不可读: ${(e as Error).message}`);
      }
      const entries = await Promise.all(
        dirents
          .filter((d) => !d.name.startsWith("."))
          .map(async (d) => {
            const p = path.join(abs, d.name);
            try {
              const st = await fsp.stat(p);
              return {
                name: d.name,
                kind: d.isDirectory() ? ("dir" as const) : ("file" as const),
                size: d.isDirectory() ? 0 : st.size,
                mtime: st.mtimeMs,
                ext: d.isDirectory() ? "" : path.extname(d.name).toLowerCase(),
              };
            } catch {
              return null;
            }
          }),
      );
      const list = entries
        .filter(Boolean)
        .sort((a, b) =>
          a!.kind !== b!.kind ? (a!.kind === "dir" ? -1 : 1) : a!.name.localeCompare(b!.name, "zh-CN"),
        );
      json(res, 200, { path: rel, entries: list });
    },
  },

  "/api/overview": {
    method: "GET",
    handler: async ({ res, root }) => {
      if (!fs.existsSync(root)) return fail(res, 503, "资料根目录不可用（网络盘未挂载？）");
      const clients: { name: string; years: number; projects: number }[] = [];
      const top = await fsp.readdir(root, { withFileTypes: true });
      for (const c of top) {
        if (!c.isDirectory() || c.name.startsWith(".") || SKIP_DIRS.has(c.name) || c.name === "系统模板库") continue;
        let years = 0;
        let projects = 0;
        try {
          const yearDirs = await fsp.readdir(path.join(root, c.name), { withFileTypes: true });
          for (const y of yearDirs) {
            if (!y.isDirectory() || y.name.startsWith(".")) continue;
            if (/^\d{4}$/.test(y.name)) {
              years++;
              const projDirs = await fsp.readdir(path.join(root, c.name, y.name), { withFileTypes: true });
              projects += projDirs.filter((p) => p.isDirectory() && !p.name.startsWith(".")).length;
            }
          }
        } catch {
          /* ignore */
        }
        clients.push({ name: c.name, years, projects });
      }
      clients.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
      json(res, 200, {
        clients,
        totals: {
          clients: clients.length,
          years: clients.reduce((s, c) => s + c.years, 0),
          projects: clients.reduce((s, c) => s + c.projects, 0),
        },
      });
    },
  },

  "/api/search": {
    method: "GET",
    handler: async ({ res, url, root }) => {
      const q = (url.searchParams.get("q") || "").trim().toLowerCase();
      if (!q) return fail(res, 400, "缺少搜索关键词");
      const baseRel = url.searchParams.get("path") || "";
      const baseAbs = resolveSafe(root, baseRel);
      if (!baseAbs || !fs.existsSync(baseAbs)) return fail(res, 400, "搜索范围不存在");
      const items = await walk(baseAbs, { maxDepth: 8, maxVisit: 30000 });
      const results = items
        .filter((it) => it.name.toLowerCase().includes(q))
        .slice(0, 200)
        .map((it) => ({ ...it, rel: baseRel ? `${baseRel}/${it.rel}` : it.rel }));
      json(res, 200, { q, count: results.length, results });
    },
  },

  "/api/recent": {
    method: "GET",
    handler: async ({ res, url, root }) => {
      const limit = Math.min(Number(url.searchParams.get("limit")) || 30, 100);
      if (!fs.existsSync(root)) return fail(res, 503, "资料根目录不可用");
      const items = await walk(root, { maxDepth: 6, maxVisit: 30000 });
      items.sort((a, b) => b.mtime - a.mtime);
      json(res, 200, { results: items.slice(0, limit) });
    },
  },

  "/api/projects": {
    method: "GET",
    handler: async ({ res, url, root }) => {
      const client = url.searchParams.get("client") || "";
      const year = url.searchParams.get("year") || "";
      const baseRel = year ? `${client}/${year}` : client;
      const baseAbs = resolveSafe(root, baseRel);
      if (!baseAbs || !fs.existsSync(baseAbs)) return fail(res, 404, "目录不存在");
      const dirents = await fsp.readdir(baseAbs, { withFileTypes: true });
      const projects = await Promise.all(
        dirents
          .filter((d) => d.isDirectory() && !d.name.startsWith("."))
          .map(async (d) => {
            const projAbs = path.join(baseAbs, d.name);
            const projRel = `${baseRel}/${d.name}`;
            let subdirs: string[] = [];
            let fileCount = 0;
            let mtime = 0;
            try {
              const st = await fsp.stat(projAbs);
              mtime = st.mtimeMs;
              const subs = await fsp.readdir(projAbs, { withFileTypes: true });
              subdirs = subs.filter((s) => s.isDirectory() && !s.name.startsWith(".")).map((s) => s.name);
              // 浅扫描（深度 2）统计文件数
              for (const s of subs) {
                if (!s.isDirectory() || s.name.startsWith(".")) continue;
                const inner = await fsp.readdir(path.join(projAbs, s.name), { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
                for (const f of inner) {
                  if (f.isFile() && !f.name.startsWith(".")) fileCount++;
                  else if (f.isDirectory() && !f.name.startsWith(".")) {
                    const deep = await fsp
                      .readdir(path.join(projAbs, s.name, f.name), { withFileTypes: true })
                      .catch(() => [] as fs.Dirent[]);
                    fileCount += deep.filter((x) => x.isFile() && !x.name.startsWith(".")).length;
                  }
                }
              }
            } catch {
              /* ignore */
            }
            return { name: d.name, path: projRel, subdirs, fileCount, mtime };
          }),
      );
      projects.sort((a, b) => b.mtime - a.mtime);
      json(res, 200, { base: baseRel, projects });
    },
  },

  "/api/doctypes": {
    method: "GET",
    handler: async ({ res, url, root, projectRoot }) => {
      // 资料类型清单：docs.config.json 可配 docTypes: [{name, dir}]，默认用 ZURU 项目实测的五类
      let docTypes: { name: string; dir: string }[] = [
        { name: "作业指导书", dir: "工程放产资料" },
        { name: "外购件清单", dir: "工程放产资料" },
        { name: "排模表", dir: "工程放产资料" },
        { name: "排模图", dir: "工程放产资料" },
        { name: "生产注意事项", dir: "工程放产资料" },
      ];
      try {
        const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, "docs.config.json"), "utf-8"));
        if (Array.isArray(cfg.docTypes) && cfg.docTypes.length) docTypes = cfg.docTypes;
      } catch {
        /* defaults */
      }
      // 模板库：根目录下「系统模板库」文件夹，文件名包含资料名即视为该资料的模板
      const templatesDir = path.join(root, "系统模板库");
      const templates: string[] = [];
      if (fs.existsSync(templatesDir)) {
        const walkTpl = async (dir: string, rel: string) => {
          const ents = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
          for (const e of ents) {
            if (e.name.startsWith(".")) continue;
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) await walkTpl(path.join(dir, e.name), r);
            else templates.push(r);
          }
        };
        await walkTpl(templatesDir, "");
      }
      // 若指定了项目（client/year/name），同时检测每份资料是否已存在
      const project = url.searchParams.get("project") || "";
      let projectFiles: WalkItem[] = [];
      if (project) {
        const projAbs = resolveSafe(root, project);
        if (projAbs && fs.existsSync(projAbs)) {
          projectFiles = await walk(projAbs, { maxDepth: 4, maxVisit: 2000 });
        }
      }
      const items = docTypes.map((dt) => ({
        name: dt.name,
        dir: dt.dir,
        template:
          templates.find((t) => path.basename(t).includes(dt.name)) != null
            ? `系统模板库/${templates.find((t) => path.basename(t).includes(dt.name))}`
            : null,
        existing:
          project && projectFiles.length
            ? (projectFiles.find((f) => f.name.includes(dt.name))?.rel ?? null)
            : null,
      }));
      json(res, 200, { items, templatesDir: "系统模板库" });
    },
  },

  "/api/copy": {
    method: "POST",
    handler: async ({ req, res, root }) => {
      const body = JSON.parse(await readBody(req));
      const srcRel = String(body.src || "");
      const destDirRel = String(body.destDir || "");
      const newName = path.basename(String(body.newName || ""));
      const srcAbs = resolveSafe(root, srcRel);
      const destDirAbs = resolveSafe(root, destDirRel);
      if (!srcAbs || !fs.existsSync(srcAbs) || !fs.statSync(srcAbs).isFile()) {
        return fail(res, 404, "模板文件不存在");
      }
      if (!destDirAbs || !newName) return fail(res, 400, "目标目录或文件名非法");
      if (!fs.existsSync(destDirAbs)) await fsp.mkdir(destDirAbs, { recursive: true });
      // 保留模板扩展名
      const ext = path.extname(srcAbs);
      const finalName = newName.endsWith(ext) ? newName : `${newName}${ext}`;
      const destAbs = await uniquePath(path.join(destDirAbs, finalName));
      await fsp.copyFile(srcAbs, destAbs);
      json(res, 200, { ok: true, path: path.relative(root, destAbs) });
    },
  },

  "/api/mkdir": {
    method: "POST",
    handler: async ({ req, res, root }) => {
      const body = JSON.parse(await readBody(req));
      const abs = resolveSafe(root, String(body.path || ""));
      if (!abs || abs === root) return fail(res, 400, "非法路径");
      await fsp.mkdir(abs, { recursive: true });
      json(res, 200, { ok: true });
    },
  },

  "/api/project": {
    method: "POST",
    handler: async ({ req, res, root }) => {
      const body = JSON.parse(await readBody(req));
      const client = String(body.client || "").trim();
      const year = String(body.year || "").trim();
      const name = String(body.name || "").trim();
      if (!client || !/^\d{4}$/.test(year) || !name) {
        return fail(res, 400, "客户、年份（4位数字）、项目名称均必填");
      }
      if (/[/\\]|\.\./.test(client + year + name)) return fail(res, 400, "名称含非法字符");
      const projAbs = resolveSafe(root, `${client}/${year}/${name}`);
      if (!projAbs) return fail(res, 400, "非法路径");
      if (fs.existsSync(projAbs)) return fail(res, 409, "该项目已存在");
      for (const sub of TEMPLATE_DIRS) {
        await fsp.mkdir(path.join(projAbs, sub), { recursive: true });
      }
      json(res, 200, { ok: true, path: `${client}/${year}/${name}`, template: TEMPLATE_DIRS });
    },
  },

  "/api/rename": {
    method: "POST",
    handler: async ({ req, res, root }) => {
      const body = JSON.parse(await readBody(req));
      const abs = resolveSafe(root, String(body.path || ""));
      const newName = String(body.newName || "").trim();
      if (!abs || abs === root) return fail(res, 400, "非法路径");
      if (!newName || /[/\\]/.test(newName)) return fail(res, 400, "新名称非法");
      const target = path.join(path.dirname(abs), newName);
      if (fs.existsSync(target)) return fail(res, 409, "同名文件已存在");
      await fsp.rename(abs, target);
      json(res, 200, { ok: true });
    },
  },

  "/api/stat": {
    method: "GET",
    handler: async ({ res, url, root }) => {
      const rel = url.searchParams.get("path") || "";
      const abs = resolveSafe(root, rel);
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return fail(res, 404, "文件不存在");
      }
      const st = await fsp.stat(abs);
      json(res, 200, { mtime: st.mtimeMs, size: st.size });
    },
  },

  "/api/upload": {
    method: "POST",
    handler: async ({ req, res, url, root }) => {
      const dirRel = url.searchParams.get("path") || "";
      const rawName = url.searchParams.get("name") || "未命名文件";
      const name = path.basename(decodeURIComponent(rawName));
      const overwrite = url.searchParams.get("overwrite") === "1";
      const baseMtime = Number(url.searchParams.get("baseMtime")) || 0;
      const dirAbs = resolveSafe(root, dirRel);
      if (!dirAbs || !fs.existsSync(dirAbs)) return fail(res, 400, "目标目录不存在");
      try {
        // 覆盖保存时做冲突检测：文件在他人处被更新过则拒绝
        if (overwrite && baseMtime) {
          const cur = path.join(dirAbs, name);
          if (fs.existsSync(cur)) {
            const curMtime = fs.statSync(cur).mtimeMs;
            if (curMtime > baseMtime + 1000) {
              return fail(res, 409, "文件已被他人修改，保存冲突");
            }
          }
        }
        // 覆盖保存 xlsx 前备份旧文件（用于还原模板里的嵌入图片）
        const target = overwrite ? path.join(dirAbs, name) : await uniquePath(path.join(dirAbs, name));
        let bakPath = "";
        if (overwrite && /\.xlsx$/i.test(name) && fs.existsSync(target)) {
          bakPath = `${target}.imgbak`;
          await fsp.copyFile(target, bakPath);
        }
        await new Promise<void>((resolve, reject) => {
          const ws = fs.createWriteStream(target);
          req.pipe(ws);
          ws.on("finish", () => resolve());
          ws.on("error", reject);
          req.on("error", reject);
        });
        // 写回后把旧文件中的嵌入图片移植到新文件
        if (bakPath) {
          await preserveImagesOnOverwrite(bakPath, target).catch(() => {});
          await fsp.rm(bakPath, { force: true });
        }
        json(res, 200, { ok: true, name: path.basename(target) });
      } catch (e) {
        fail(res, 500, `上传失败: ${(e as Error).message}`);
      }
    },
  },

  "/api/file": {
    method: "GET",
    handler: async ({ res, url, root }) => {
      const rel = url.searchParams.get("path") || "";
      const abs = resolveSafe(root, rel);
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return fail(res, 404, "文件不存在");
      }
      const ext = path.extname(abs).toLowerCase();
      const mime = MIME[ext] || "application/octet-stream";
      const download = url.searchParams.get("download") === "1";
      const filename = encodeURIComponent(path.basename(abs));
      res.writeHead(200, {
        "Content-Type": mime,
        "Content-Length": fs.statSync(abs).size,
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${filename}`,
      });
      fs.createReadStream(abs).pipe(res);
    },
  },

  "/api/item": {
    method: "DELETE",
    handler: async ({ res, url, root }) => {
      const rel = url.searchParams.get("path") || "";
      try {
        const trashName = await moveToTrash(root, rel);
        json(res, 200, { ok: true, trashName });
      } catch (e) {
        fail(res, 404, (e as Error).message);
      }
    },
  },

  "/api/trash": {
    method: "GET",
    handler: async ({ res, root }) => {
      const trashAbs = path.join(root, TRASH_DIRNAME);
      if (!fs.existsSync(trashAbs)) return json(res, 200, { items: [] });
      let manifest: { trashName: string; originalPath: string; deletedAt: number }[] = [];
      try {
        manifest = JSON.parse(await fsp.readFile(path.join(trashAbs, "manifest.json"), "utf-8"));
      } catch {
        /* ignore */
      }
      const entries = await fsp.readdir(trashAbs, { withFileTypes: true });
      const items = await Promise.all(
        entries
          .filter((e) => e.name !== "manifest.json" && !e.name.startsWith(".") || e.name.includes("__"))
          .map(async (e) => {
            const st = await fsp.stat(path.join(trashAbs, e.name));
            const meta = manifest.find((m) => m.trashName === e.name);
            return {
              trashName: e.name,
              name: e.name.split("__").slice(1).join("__") || e.name,
              kind: e.isDirectory() ? ("dir" as const) : ("file" as const),
              size: e.isDirectory() ? 0 : st.size,
              originalPath: meta?.originalPath ?? "",
              deletedAt: meta?.deletedAt ?? st.mtimeMs,
            };
          }),
      );
      items.sort((a, b) => b.deletedAt - a.deletedAt);
      json(res, 200, { items });
    },
  },

  "/api/restore": {
    method: "POST",
    handler: async ({ req, res, root }) => {
      const body = JSON.parse(await readBody(req));
      const trashName = path.basename(String(body.trashName || ""));
      const trashAbs = path.join(root, TRASH_DIRNAME);
      const src = path.join(trashAbs, trashName);
      if (!fs.existsSync(src)) return fail(res, 404, "回收站中不存在该项");
      const manifestPath = path.join(trashAbs, "manifest.json");
      let manifest: { trashName: string; originalPath: string; deletedAt: number }[] = [];
      try {
        manifest = JSON.parse(await fsp.readFile(manifestPath, "utf-8"));
      } catch {
        /* ignore */
      }
      const meta = manifest.find((m) => m.trashName === trashName);
      const originalName = trashName.split("__").slice(1).join("__") || trashName;
      const destRel = meta?.originalPath || originalName;
      const destAbs = resolveSafe(root, destRel);
      if (!destAbs) return fail(res, 400, "原路径非法");
      await fsp.mkdir(path.dirname(destAbs), { recursive: true });
      const finalDest = await uniquePath(destAbs);
      await fsp.rename(src, finalDest);
      manifest = manifest.filter((m) => m.trashName !== trashName);
      await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      json(res, 200, { ok: true, restoredTo: path.relative(root, finalDest) });
    },
  },

  "/api/purge": {
    method: "POST",
    handler: async ({ req, res, root }) => {
      const body = JSON.parse(await readBody(req));
      const trashName = path.basename(String(body.trashName || ""));
      const target = path.join(root, TRASH_DIRNAME, trashName);
      if (!fs.existsSync(target)) return fail(res, 404, "不存在");
      await fsp.rm(target, { recursive: true, force: true });
      const manifestPath = path.join(root, TRASH_DIRNAME, "manifest.json");
      try {
        const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf-8"));
        await fsp.writeFile(
          manifestPath,
          JSON.stringify(manifest.filter((m: { trashName: string }) => m.trashName !== trashName), null, 2),
        );
      } catch {
        /* ignore */
      }
      json(res, 200, { ok: true });
    },
  },

  "/api/batch-delete": {
    method: "POST",
    handler: async ({ req, res, root }) => {
      const body = JSON.parse(await readBody(req));
      const paths: string[] = Array.isArray(body.paths) ? body.paths.map(String) : [];
      if (!paths.length) return fail(res, 400, "没有要删除的路径");
      if (paths.length > 500) return fail(res, 400, "单次最多删除 500 项");
      const ok: string[] = [];
      const failed: { path: string; error: string }[] = [];
      for (const rel of paths) {
        try {
          await moveToTrash(root, rel);
          ok.push(rel);
        } catch (e) {
          failed.push({ path: rel, error: (e as Error).message });
        }
      }
      json(res, 200, { ok: true, deleted: ok.length, failed });
    },
  },
};

/* ---------- 插件入口 ---------- */

export function docsApi(): Plugin {
  let root = "";
  let projectRoot = "";
  const middleware = (req: Connect.IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url || "/", "http://localhost");
    const route = routes[url.pathname];
    if (!route) return next();
    if (req.method !== route.method) return fail(res, 405, "方法不允许");
    route
      .handler({ req, res, url, root, projectRoot })
      .catch((e) => fail(res, 500, (e as Error).message || "服务器内部错误"));
  };
  return {
    name: "docs-api",
    configResolved(config) {
      projectRoot = config.root;
      root = loadRoot(config.root);
    },
    // 开发模式（npm run dev）
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    // 生产模式（npm run preview，服务 dist/ 打包产物）
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
