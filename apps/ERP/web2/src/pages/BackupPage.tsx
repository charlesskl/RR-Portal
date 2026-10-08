// 备份数据(/system/backup;老系统 web/src/pages/system/BackupPage.tsx 重写):
// 触发服务端 BACKUP DATABASE;备份目录由 系统配置表[备份.目录] 或环境变量 ERP_BACKUP_DIR 配置;
// 成功后展示备份文件路径(服务端绝对路径)。权限菜单=备份数据(MenuCatalog.cs:103 实证),控「功能」位。
import { useEffect, useState } from "react";
import { Database, Info, Warning } from "@phosphor-icons/react";
import { adminToolsApi } from "@/api/endpoints";
import type { BackupResult } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { DocToast } from "@/components/doc/DocToast";

const MENU = "备份数据";

export default function BackupPage() {
  const { can } = usePerms();
  const allowed = can(MENU, "功能");
  const [running, setRunning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<BackupResult | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const run = async () => {
    setConfirmOpen(false);
    setRunning(true);
    setResult(null);
    try {
      const r = await adminToolsApi.backup();
      setResult(r);
      setToast({ text: r.消息 ?? "备份完成", tone: "ok" });
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : "备份失败", tone: "err" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="f-page mx-auto max-w-3xl space-y-4 p-5">
      <h1 className="px-1 text-2xl font-bold text-[#1a2330]">备份数据</h1>
      <div className="f-panel space-y-4 p-6">
        <div className="flex gap-2.5 rounded-lg border border-[#2563eb]/25 bg-[#2563eb]/6 px-4 py-3 text-sm text-[#3d4a5c]">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#2563eb]" />
          <div>
            <div className="font-semibold text-[#1d4ed8]">备份在 SQL Server 服务端执行</div>
            <p className="mt-1 leading-relaxed">
              备份文件写入数据库服务器上的备份目录(由系统配置表键 [备份.目录] 或环境变量
              ERP_BACKUP_DIR 指定,需为服务端绝对路径)。备份期间请勿关机或重启数据库服务。
            </p>
          </div>
        </div>
        {allowed ? (
          <button
            type="button"
            className="f-btn f-btn-cyan h-10 px-5 text-sm"
            disabled={running}
            onClick={() => setConfirmOpen(true)}
          >
            <Database className="h-4 w-4" />
            {running ? "正在备份..." : "立即备份"}
          </button>
        ) : (
          <div className="flex gap-2.5 rounded-lg border border-[#b45309]/25 bg-[#b45309]/6 px-4 py-3 text-sm text-[#b45309]">
            <Warning className="mt-0.5 h-4 w-4 shrink-0" />
            当前账号无「备份数据·功能」权限
          </div>
        )}
        {result?.文件 && (
          <div className="rounded-lg border border-black/8 bg-black/[0.03] px-4 py-3 text-sm">
            备份文件:
            <span className="f-mono font-semibold break-all text-[#15803d]">{result.文件}</span>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="确认立即备份数据库?"
        confirmLabel="立即备份"
        onConfirm={() => void run()}
      />
      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
