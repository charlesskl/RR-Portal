import type { AppConfig, DirEntry, DocTypeItem, Overview, ProjectInfo, TrashItem, WalkItem } from "@/types";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `请求失败 (${res.status})`);
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  config: () => req<AppConfig>("/api/config"),

  list: (path: string) => req<{ path: string; entries: DirEntry[] }>(`/api/list?path=${enc(path)}`),

  overview: () => req<Overview>("/api/overview"),

  search: (q: string, path = "") =>
    req<{ q: string; count: number; results: WalkItem[] }>(
      `/api/search?q=${enc(q)}&path=${enc(path)}`,
    ),

  recent: (limit = 30) => req<{ results: WalkItem[] }>(`/api/recent?limit=${limit}`),

  projects: (client: string, year: string) =>
    req<{ base: string; projects: ProjectInfo[] }>(
      `/api/projects?client=${enc(client)}&year=${enc(year)}`,
    ),

  doctypes: (project = "") =>
    req<{ items: DocTypeItem[]; templatesDir: string }>(`/api/doctypes?project=${enc(project)}`),

  copyTemplate: (src: string, destDir: string, newName: string) =>
    req<{ ok: true; path: string }>("/api/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ src, destDir, newName }),
    }),

  mkdir: (path: string) =>
    req<{ ok: true }>("/api/mkdir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }),

  createProject: (client: string, year: string, name: string) =>
    req<{ ok: true; path: string }>("/api/project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client, year, name }),
    }),

  rename: (path: string, newName: string) =>
    req<{ ok: true }>("/api/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, newName }),
    }),

  remove: (path: string) => req<{ ok: true }>(`/api/item?path=${enc(path)}`, { method: "DELETE" }),

  batchDelete: (paths: string[]) =>
    req<{ ok: true; deleted: number; failed: { path: string; error: string }[] }>("/api/batch-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths }),
    }),

  stat: (path: string) => req<{ mtime: number; size: number }>(`/api/stat?path=${enc(path)}`),

  trash: () => req<{ items: TrashItem[] }>("/api/trash"),

  restore: (trashName: string) =>
    req<{ ok: true; restoredTo: string }>("/api/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashName }),
    }),

  purge: (trashName: string) =>
    req<{ ok: true }>("/api/purge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashName }),
    }),

  fileUrl: (path: string, download = false) =>
    `/api/file?path=${enc(path)}${download ? "&download=1" : ""}`,

  /** 单文件上传（原始二进制流，支持大文件），带进度回调；可指定覆盖与冲突检测 */
  upload(
    dirPath: string,
    file: File,
    onProgress?: (pct: number) => void,
    opts?: { overwrite?: boolean; baseMtime?: number },
  ): Promise<{ ok: true; name: string }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const params = [`path=${enc(dirPath)}`, `name=${enc(file.name)}`];
      if (opts?.overwrite) params.push("overwrite=1");
      if (opts?.baseMtime) params.push(`baseMtime=${opts.baseMtime}`);
      xhr.open("POST", `/api/upload?${params.join("&")}`);
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
};
