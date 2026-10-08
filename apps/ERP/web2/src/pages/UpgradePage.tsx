// 网上升级(/system/upgrade;老系统 web/src/pages/system/UpgradePage.tsx 重写):
// 显示当前系统版本(GET /admin/version);升级本身由运维在服务端部署发布包完成(参考 docs/deploy-windows-task.md)。
// 无权限菜单(MenuCatalog 未收录,老系统 menuTree 该项也无权限键)。
import { useEffect, useState } from "react";
import { Info } from "@phosphor-icons/react";
import { adminToolsApi } from "@/api/endpoints";
import type { VersionInfo } from "@/api/types";
import { DocToast } from "@/components/doc/DocToast";

const FIELDS: { key: keyof VersionInfo; label: string }[] = [
  { key: "版本", label: "程序集版本" },
  { key: "信息版本", label: "构建信息" },
  { key: "框架", label: "运行时" },
  { key: "环境", label: "环境" },
];

const errMsg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

export default function UpgradePage() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    void Promise.resolve().then(async () => {
      try {
        setInfo(await adminToolsApi.version());
      } catch (e) {
        setToast({ text: errMsg(e, "获取系统版本失败"), tone: "err" });
      } finally {
        setLoading(false);
      }
    });
  }, []);

  return (
    <div className="f-page mx-auto max-w-3xl space-y-4 p-5">
      <h1 className="px-1 text-2xl font-bold text-[#1a2330]">网上升级</h1>
      <div className="f-panel space-y-5 p-6">
        <div className="flex gap-2.5 rounded-lg border border-[#2563eb]/25 bg-[#2563eb]/6 px-4 py-3 text-sm text-[#3d4a5c]">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#2563eb]" />
          <div>
            <div className="font-semibold text-[#1d4ed8]">系统升级由运维在服务端执行</div>
            <p className="mt-1 leading-relaxed">
              新版本发布包由运维部署到服务器(参考 docs/deploy-windows-task.md),本页用于查看当前运行版本,便于与发布版本比对。
            </p>
          </div>
        </div>
        {loading ? (
          <div className="py-8 text-center text-sm text-disabled">加载中...</div>
        ) : info ? (
          <div className="overflow-hidden rounded-lg border border-black/8">
            <table className="w-full text-sm">
              <tbody>
                {FIELDS.map((f) => (
                  <tr key={f.key} className="border-b border-black/6 last:border-b-0">
                    <th className="f-label w-36 bg-black/[0.03] px-4 py-2.5 text-left font-medium whitespace-nowrap normal-case">
                      {f.label}
                    </th>
                    <td className="f-mono px-4 py-2.5 break-all">{info[f.key] || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
