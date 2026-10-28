export interface DirEntry {
  name: string;
  kind: "dir" | "file";
  size: number;
  mtime: number;
  ext: string;
}

export interface ClientStat {
  name: string;
  years: number;
  projects: number;
}

export interface Overview {
  clients: ClientStat[];
  totals: { clients: number; years: number; projects: number };
}

export interface WalkItem {
  rel: string;
  name: string;
  size: number;
  mtime: number;
  ext: string;
}

export interface TrashItem {
  trashName: string;
  name: string;
  kind: "dir" | "file";
  size: number;
  originalPath: string;
  deletedAt: number;
}

export interface AppConfig {
  root: string;
  mounted: boolean;
  smbBase?: string;
}

export type View =
  | { type: "dashboard" }
  | { type: "clients" }
  | { type: "client"; client: string }
  | { type: "project"; client: string; year: string; project: string }
  | { type: "explorer"; path: string }
  | { type: "editor"; path: string; name: string }
  | { type: "workbench"; client: string; year: string; project: string }
  | { type: "search" }
  | { type: "recent" }
  | { type: "trash" };

export interface DocTypeItem {
  name: string;
  dir: string;
  template: string | null;
  existing: string | null;
}

export interface ProjectInfo {
  name: string;
  path: string;
  subdirs: string[];
  fileCount: number;
  mtime: number;
}

export interface DashboardProject {
  client: string;
  year: string;
  project: string;
  path: string;
  done: number;
  total: number;
  docs: Record<string, boolean>;
  mtime: number;
}

export interface Dashboard {
  projects: DashboardProject[];
  stats: { projects: number; readiness: number; incomplete: number; complete: number };
}

export interface EpmsRecordPublic {
  status: "none" | "draft" | "pending" | "approved";
  data?: unknown;
  by?: string;
  updatedAt?: number;
  docNo?: string;
  lock?: { by: string; at: number } | null;
  lockTtl?: number;
  history?: { at: number; by: string; action: string }[];
}
