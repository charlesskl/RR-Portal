import type { AppConfig, DirEntry, DocTypeItem, Overview, ProjectInfo, TrashItem, WalkItem } from "@/types";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  const headers = new Headers(init?.headers);
  if (method !== "GET" && method !== "HEAD") headers.set("X-EPMS-Request", "1");
  if (method !== "GET" && method !== "HEAD" && !url.startsWith("api/epms/")) requireEdit();
  const res = await fetch(url, { ...init, headers, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error((data as { error?: string }).error || "请求失败 (" + res.status + ")");
    Object.assign(error, { status: res.status });
    throw error;
  }
  return data as T;
}

const enc = encodeURIComponent;
let verifiedSession: EpmsSession | null = null;
export function setApiSession(value: EpmsSession | null) { verifiedSession = value; }
function requireEdit() {
  if (!verifiedSession?.canEdit) throw new Error("当前账号只读；请使用具有资料编辑权限的核心账号登录");
}

export const api = {
  config: () => req<AppConfig>("api/config"),

  list: (path: string) => req<{ path: string; entries: DirEntry[] }>(`api/list?path=${enc(path)}`),

  overview: () => req<Overview>("api/overview"),

  search: (q: string, path = "") =>
    req<{ q: string; count: number; results: WalkItem[] }>(
      `api/search?q=${enc(q)}&path=${enc(path)}`,
    ),

  recent: (limit = 30) => req<{ results: WalkItem[] }>(`api/recent?limit=${limit}`),

  projects: (client: string, year: string) =>
    req<{ base: string; projects: ProjectInfo[] }>(
      `api/projects?client=${enc(client)}&year=${enc(year)}`,
    ),

  doctypes: (project = "") =>
    req<{ items: DocTypeItem[]; templatesDir: string }>(`api/doctypes?project=${enc(project)}`),

  copyTemplate: (src: string, destDir: string, newName: string) =>
    req<{ ok: true; path: string }>("api/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ src, destDir, newName }),
    }),

  mkdir: (path: string) =>
    req<{ ok: true }>("api/mkdir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }),

  createProject: (client: string, year: string, name: string) =>
    req<{ ok: true; path: string }>("api/project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client, year, name }),
    }),

  rename: (path: string, newName: string) =>
    req<{ ok: true }>("api/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, newName }),
    }),

  remove: (path: string) => req<{ ok: true }>(`api/item?path=${enc(path)}`, { method: "DELETE" }),

  batchDelete: (paths: string[]) =>
    req<{ ok: true; deleted: number; failed: { path: string; error: string }[] }>("api/batch-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths }),
    }),

  stat: (path: string) => req<{ mtime: number; size: number }>(`api/stat?path=${enc(path)}`),

  trash: () => req<{ items: TrashItem[] }>("api/trash"),

  restore: (trashName: string) =>
    req<{ ok: true; restoredTo: string }>("api/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashName }),
    }),

  purge: (trashName: string) =>
    req<{ ok: true }>("api/purge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashName }),
    }),

  fileUrl: (path: string, download = false) =>
    `api/file?path=${enc(path)}${download ? "&download=1" : ""}`,

  /** 单文件上传（原始二进制流，支持大文件），带进度回调；可指定覆盖与冲突检测 */
  upload(
    dirPath: string,
    file: File,
    onProgress?: (pct: number) => void,
    opts?: { overwrite?: boolean; baseMtime?: number; lockToken?: string },
  ): Promise<{ ok: true; name: string }> {
    try { requireEdit(); } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const params = [`path=${enc(dirPath)}`, `name=${enc(file.name)}`];
      if (opts?.overwrite) params.push("overwrite=1");
      if (opts?.baseMtime) params.push(`baseMtime=${opts.baseMtime}`);
      xhr.open("POST", `api/upload?${params.join("&")}`);
      xhr.setRequestHeader("X-EPMS-Request", "1");
      if (opts?.lockToken) xhr.setRequestHeader("X-EPMS-Lock-Token", opts.lockToken);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) resolve(data);
          else reject(new Error(data.error || `上传失败 (${xhr.status})`));
        } catch {
          reject(new Error("上传响应解析失败"));
        }
      };
      xhr.onerror = () => reject(new Error("网络错误，上传中断"));
      xhr.send(file);
    });
  },

  /* ---------- Server-verified core account + EPMS ---------- */
  epmsSession: () => req<EpmsSession>("api/epms/session"),
  epmsLogin: (username: string, password: string) =>
    req<EpmsSession>("api/epms/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) }),
  epmsLogout: () => req<{ ok: true }>("api/epms/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
  epmsGet: (path: string, doc: string) =>
    req<EpmsRecordPublic>("api/epms?path=" + enc(path) + "&doc=" + enc(doc)),
  epmsSave: (path: string, doc: string, data: unknown, lockToken: string, version: number) =>
    req<EpmsRecordPublic>("api/epms/save", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, doc, data, lockToken, version }),
    }),
  epmsLock: (path: string, doc: string, lockToken?: string) =>
    req<EpmsRecordPublic>("api/epms/lock", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, doc, lockToken }),
    }),
  epmsUnlock: (path: string, doc: string, lockToken: string) =>
    req<{ ok: true }>("api/epms/unlock", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, doc, lockToken }),
    }),
  epmsStatus: (path: string, doc: string, action: "submit" | "approve" | "return", lockToken: string, version: number) =>
    req<EpmsRecordPublic>("api/epms/status", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, doc, action, lockToken, version }),
    }),
};

export interface EpmsSession {
  id: string;
  name: string;
  canRead: boolean;
  canEdit: boolean;
  canReview: boolean;
}
export interface EpmsRecordPublic {
  status: "none" | "draft" | "pending" | "approved";
  version: number;
  data?: unknown;
  by?: string;
  byId?: string;
  createdBy?: { id: string; name: string };
  submittedBy?: { id: string; name: string };
  updatedAt?: number;
  docNo?: string;
  lock?: { by: string; actorId: string; at: number } | null;
  lockTtl?: number;
  lockToken?: string;
  integrityStatus?: "verified" | "changed" | "unavailable";
  integrityChanged?: boolean | null;
  history?: { at: number; by: string; action: string }[];
}
export interface EditorLease {
  projectPath: string;
  doc: string;
  token: string;
  readOnly?: boolean;
}
