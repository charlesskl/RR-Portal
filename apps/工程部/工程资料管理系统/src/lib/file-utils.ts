/** 文件展示相关的通用工具 */

export function formatSize(bytes: number): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type FileCategory =
  | "excel"
  | "word"
  | "ppt"
  | "pdf"
  | "image"
  | "design"
  | "archive"
  | "video"
  | "text"
  | "other";

export function fileCategory(ext: string): FileCategory {
  switch (ext) {
    case ".xls":
    case ".xlsx":
    case ".xlsm":
    case ".csv":
      return "excel";
    case ".doc":
    case ".docx":
      return "word";
    case ".ppt":
    case ".pptx":
      return "ppt";
    case ".pdf":
      return "pdf";
    case ".jpg":
    case ".jpeg":
    case ".png":
    case ".gif":
    case ".webp":
    case ".bmp":
      return "image";
    case ".ai":
    case ".psd":
    case ".eps":
    case ".cdr":
    case ".step":
    case ".stp":
    case ".igs":
    case ".dwg":
    case ".dxf":
      return "design";
    case ".zip":
    case ".rar":
    case ".7z":
      return "archive";
    case ".mp4":
    case ".mov":
    case ".avi":
      return "video";
    case ".txt":
    case ".md":
      return "text";
    default:
      return "other";
  }
}

export const CATEGORY_STYLE: Record<FileCategory, { label: string; className: string }> = {
  excel: { label: "表格", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  word: { label: "文档", className: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  ppt: { label: "演示", className: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300" },
  pdf: { label: "PDF", className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
  image: { label: "图片", className: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" },
  design: { label: "图纸", className: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300" },
  archive: { label: "压缩包", className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  video: { label: "视频", className: "bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300" },
  text: { label: "文本", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  other: { label: "文件", className: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" },
};

/** 可在浏览器内直接预览的类型 */
export function canPreview(ext: string): boolean {
  return ["image", "pdf", "text", "video"].includes(fileCategory(ext));
}
