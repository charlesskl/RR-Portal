/**
 * 网页版资料编辑器：在浏览器里直接编辑 xlsx（Luckysheet），保存回系统服务器。
 * 每个人在自己电脑的浏览器里编辑，不会调用任何电脑上的 Excel。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ensureLuckysheet } from "@/lib/luckysheet-loader";
import { luckyToXlsx } from "@/lib/lucky-to-xlsx";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, Loader2, Save } from "lucide-react";

const CONTAINER_ID = "luckysheet-editor-container";

export default function DocEditor({
  path,
  name,
  onClose,
  onSaved,
}: {
  path: string;
  name: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [baseMtime, setBaseMtime] = useState(0);
  const dirtyRef = useRef(false);
  const destroyedRef = useRef(false);
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const fileName = path.split("/").pop() || name;

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setDirty(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!/\.xlsx$/i.test(fileName)) {
          throw new Error("旧版 .xls 文件暂不支持网页编辑，请下载后用 Excel 打开编辑");
        }
        await ensureLuckysheet();
        // 记录打开时的修改时间，用于保存冲突检测
        try {
          const st = await api.stat(path);
          if (!cancelled) setBaseMtime(st.mtime);
        } catch {
          /* 拿不到就跳过冲突检测 */
        }
        const res = await fetch(api.fileUrl(path));
        if (!res.ok) throw new Error(`读取文件失败 (${res.status})`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        window.LuckyExcel.transformExcelToLucky(
          buf,
          (exportJson: { sheets?: unknown[]; info?: { name?: string } }) => {
            if (cancelled || destroyedRef.current) return;
            if (!exportJson?.sheets?.length) {
              setError("文件内容为空或格式无法识别");
              setPhase("error");
              return;
            }
            window.luckysheet.create({
              container: CONTAINER_ID,
              data: exportJson.sheets,
              title: fileName,
              lang: "zh",
              allowEdit: true,
              showtoolbar: true,
              showinfobar: false,
              showsheetbar: true,
              showstatisticBar: true,
              allowCopy: true,
              enableAddRow: true,
              enableAddBackTop: true,
            });
            setPhase("ready");
            // 任何键盘/鼠标操作都标记为未保存
            const el = document.getElementById(CONTAINER_ID);
            el?.addEventListener("keydown", markDirty);
            el?.addEventListener("mousedown", markDirty);
          },
          (err: unknown) => {
            if (cancelled) return;
            setError(`文件解析失败：${String(err)}`);
            setPhase("error");
          },
        );
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
      destroyedRef.current = true;
      try {
        window.luckysheet?.destroy?.();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // 关闭页面前提示未保存
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const doSave = useCallback(async () => {
    if (saving || phase !== "ready") return;
    setSaving(true);
    try {
      const sheets = window.luckysheet.getAllSheets();
      const blob = await luckyToXlsx(sheets, fileName);
      const file = new File([blob], fileName, { type: blob.type });
      await api.upload(dir, file, undefined, { overwrite: true, baseMtime });
      dirtyRef.current = false;
      setDirty(false);
      const st = await api.stat(path).catch(() => null);
      if (st) setBaseMtime(st.mtime);
      toast.success("已保存到系统");
      onSaved();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("409") || msg.includes("已被")) {
        toast.error("保存失败：这份资料刚被别人改过了。请下载当前内容备用，然后重新打开再改。");
      } else {
        toast.error(`保存失败：${msg}`);
      }
    } finally {
      setSaving(false);
    }
  }, [saving, phase, dir, fileName, baseMtime, path, onSaved]);

  // Ctrl+S 保存
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        doSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [doSave]);

  const doDownload = useCallback(async () => {
    try {
      const sheets = window.luckysheet.getAllSheets();
      const blob = await luckyToXlsx(sheets, fileName);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(`导出失败：${(e as Error).message}`);
    }
  }, [fileName]);

  const handleBack = useCallback(() => {
    if (dirtyRef.current && !window.confirm("有未保存的修改，确定不保存就离开吗？")) return;
    onClose();
  }, [onClose]);

  return (
    <div className="flex h-full flex-col">
      {/* 工具条 */}
      <div className="flex shrink-0 items-center gap-2 border-b bg-white px-3 py-2">
        <Button variant="ghost" size="sm" onClick={handleBack}>
          <ArrowLeft className="mr-1 h-4 w-4" /> 返回
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{name}</div>
          <div className="truncate text-xs text-slate-400">{path}</div>
        </div>
        <span className={`text-xs ${dirty ? "text-amber-600" : "text-slate-400"}`}>
          {saving ? "保存中…" : dirty ? "有未保存的修改" : phase === "ready" ? "已保存" : ""}
        </span>
        <Button variant="outline" size="sm" onClick={doDownload} disabled={phase !== "ready"}>
          <Download className="mr-1 h-4 w-4" /> 下载
        </Button>
        <Button size="sm" onClick={doSave} disabled={saving || phase !== "ready"}>
          {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
          保存 (Ctrl+S)
        </Button>
      </div>

      {/* 编辑区 */}
      <div className="relative min-h-0 flex-1 bg-white">
        {phase === "loading" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            <p className="text-sm text-slate-500">正在加载编辑器…</p>
          </div>
        )}
        {phase === "error" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white p-6">
            <p className="text-sm text-red-600">{error}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleBack}>
                返回
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(api.fileUrl(path, true), "_blank")}
              >
                <Download className="mr-1 h-4 w-4" /> 下载文件
              </Button>
            </div>
          </div>
        )}
        <div id={CONTAINER_ID} className="absolute inset-0" />
      </div>
    </div>
  );
}
