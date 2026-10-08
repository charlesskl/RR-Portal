// 还原数据(/system/restore;老系统 web/src/pages/system/RestorePage.tsx 重写):
// 危险操作,本系统不提供在线还原,仅展示操作指引,须由 DBA 在服务端执行(老系统同样无接口调用)。
// 无权限菜单(MenuCatalog 未收录,老系统 menuTree 该项也无权限键)。
import { Warning } from "@phosphor-icons/react";

const STEPS: { title: string; desc: string }[] = [
  { title: "备份当前库", desc: "先在「备份数据」页或直接用 BACKUP DATABASE 留存当前状态,防还原错文件。" },
  { title: "确认备份文件", desc: "从备份目录选取目标 .bak 文件,核对生成时间(文件名格式:库名_yyyyMMdd_HHmmss.bak)。" },
  { title: "踢出在线连接", desc: "停止 ERP API 与前端访问,或将库设为 SINGLE_USER WITH ROLLBACK IMMEDIATE。" },
  { title: "执行 RESTORE", desc: "RESTORE DATABASE [库名] FROM DISK = '备份文件路径' WITH REPLACE, RECOVERY;" },
  { title: "验证并恢复服务", desc: "抽查关键表数据无误后,恢复 MULTI_USER 并重启 ERP API。" },
];

export default function RestorePage() {
  return (
    <div className="f-page mx-auto max-w-3xl space-y-4 p-5">
      <h1 className="px-1 text-2xl font-bold text-[#1a2330]">还原数据</h1>
      <div className="f-panel space-y-5 p-6">
        <div className="flex gap-2.5 rounded-lg border border-[#dc2626]/25 bg-[#dc2626]/6 px-4 py-3 text-sm text-[#3d4a5c]">
          <Warning className="mt-0.5 h-4 w-4 shrink-0 text-[#dc2626]" />
          <div>
            <div className="font-semibold text-[#dc2626]">还原会覆盖当前全部业务数据,且不可逆</div>
            <p className="mt-1 leading-relaxed">
              为防止误操作,本系统不提供在线还原功能。如需还原,请联系数据库管理员(DBA)在数据库服务器上执行,操作前务必先对当前库做一次备份。
            </p>
          </div>
        </div>
        <div className="rounded-lg border border-black/8 p-5">
          <div className="mb-4 text-sm font-semibold text-[#1a2330]">DBA 服务端还原指引</div>
          <ol className="space-y-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3">
                <span className="f-mono flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#16a34a]/12 text-xs font-semibold text-[#15803d]">
                  {i + 1}
                </span>
                <div>
                  <div className="text-sm font-medium text-[#1a2330]">{s.title}</div>
                  <p className="mt-0.5 text-sm leading-relaxed text-[#5f6b7d]">{s.desc}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-[#5f6b7d]">
            还原后建议立即核对库存汇总与最近单据;如有差异以备份文件为准排查。
          </p>
        </div>
      </div>
    </div>
  );
}
