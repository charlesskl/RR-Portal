// 消息中心(审批流承载页):照抄老系统 web/src/pages/MessagesPage.tsx 行为
//  - 列表分页(20/页,可换 10/50)、只看未读/全部、刷新;与顶栏铃铛弹层同一 messagesApi 数据源
//  - 查看=未读先标记已读,再按消息类型分流(老系统弹抽屉,新版跳对应单据页):
//    反审核审批/BOM反审核审批 -> 审批弹窗:经理可「同意反审核/拒绝」(老系统抽屉行为,
//      同意=一步到位回未审核,拒绝=退回申请);弹窗内可跳单据页查看
//    反审核结果(生产制单) -> /production?mo=单号 直开该单
//    领料审批 -> /material-issues?doc=单号 直开该领料单
//    补料审批(单号 BUL 前缀) -> /replenishments;BOM反审核结果 -> /bom-setup
//    目标页未注册按 MENU_PATHS 裁决:toast 提示并记下关键参数,不静默断链(Task 9 裁决模式)
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  Checks,
  Eye,
} from "@phosphor-icons/react";
import {
  messagesApi,
  productionApi,
  stylesApi,
} from "@/api/endpoints";
import type { MessageRow } from "@/api/types";
import { MENU_PATHS } from "@/nav/menu";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DocToast } from "@/components/doc/DocToast";
import { SearchSelect } from "@/components/doc/SearchSelect";

// 消息类型分流:与老系统 MessagesPage.tsx 顶部注释一致
const isReplenishment = (r: MessageRow) =>
  r.类型 === "补料审批" || (r.单号 ?? "").startsWith("BUL");
const isBomUnapprove = (r: MessageRow) => (r.类型 ?? "").startsWith("BOM反审核");
const isProdUnapprove = (r: MessageRow) =>
  r.类型 === "反审核审批" || r.类型 === "反审核结果";

const rowId = (m: MessageRow) => m.ID ?? m.id ?? 0;
const isUnread = (m: MessageRow) => m.已读 !== "1";
// 审批类消息(反审核申请):经理在审批弹窗处理;结果类消息只读,跳单据页
const isApprovalRequest = (r: MessageRow) =>
  r.类型 === "反审核审批" || r.类型 === "BOM反审核审批";

// 时间列:照抄老系统 slice(0,19).replace("T"," ")
const fmtTime = (v?: string) => (v ? v.slice(0, 19).replace("T", " ") : "-");

const PAGE_SIZES = [10, 20, 50];
const errMsg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

export default function MessagesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [onlyUnread, setOnlyUnread] = useState(false);

  // 反审核审批弹窗:当前处理的申请消息 + 提交中标记
  const [approvalMsg, setApprovalMsg] = useState<MessageRow | null>(null);
  const [acting, setActing] = useState(false);

  // 审批入口无前端门(终审裁决,对齐老系统):按钮只看消息类型,不看权限位;
  // 有经理职称但无「生产制单·审核」位的账号不能被挡在门外,后端 IsManagerAsync 兜底拒绝

  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const listQuery = useQuery({
    queryKey: ["messages-page", page, size, onlyUnread],
    queryFn: () => messagesApi.list(page, size, onlyUnread),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000, // 与铃铛未读数同节奏轮询
  });
  // 与铃铛弹层同 queryKey:未读数一处刷新两处同源
  const countQuery = useQuery({
    queryKey: ["messages-unread-count"],
    queryFn: () => messagesApi.unreadCount(),
    refetchInterval: 60_000,
  });

  const rows = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const unread = countQuery.data?.count ?? 0;

  // 刷新列表 + 未读数 + 铃铛弹层(同源三个 queryKey)
  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ["messages-page"] });
    void qc.invalidateQueries({ queryKey: ["messages-unread-count"] });
    void qc.invalidateQueries({ queryKey: ["messages-panel"] });
  };

  // 跳单据页:未注册路由不跳断链,toast 记下关键参数(Task 9 裁决模式)
  const jump = (path: string, url: string, fallback: string) => {
    if (MENU_PATHS.has(path)) navigate(url);
    else setToast({ text: fallback, tone: "ok" });
  };

  // 查看:未读先标记已读(刷新列表与铃铛),再按类型分流跳对应单据页
  const view = async (r: MessageRow) => {
    const id = rowId(r);
    try {
      if (isUnread(r) && id) await messagesApi.markRead(id);
      refreshAll();
    } catch (e) {
      setToast({ text: errMsg(e, "标记已读失败"), tone: "err" });
      return;
    }
    const no = (r.单号 ?? "").trim();
    if (!no) return;
    // 审批类消息(反审核申请):开审批弹窗,经理同意/拒绝(老系统抽屉行为)
    if (isApprovalRequest(r)) {
      setApprovalMsg(r);
      return;
    }
    const enc = encodeURIComponent(no);
    if (isBomUnapprove(r)) {
      // /bom-setup 已注册(Batch 1):直跳 BOM物料设置 并打开该货号
      jump("/bom-setup", `/bom-setup?款号=${enc}`, `BOM物料设置页未注册,请记下款号:${no}`);
    } else if (isProdUnapprove(r)) {
      jump("/production", `/production?mo=${enc}`, `生产通知单页未注册,请记下生产单号:${no}`);
    } else if (isReplenishment(r)) {
      // /replenishments 已注册(Batch 3):直跳补料单并打开该单明细
      jump("/replenishments", `/replenishments?doc=${enc}`, `补料单页未注册,请记下单号:${no}`);
    } else {
      jump(
        "/material-issues",
        `/material-issues?doc=${enc}`,
        `来料领料单页未注册,请记下单号:${no}`,
      );
    }
  };

  // 经理处理反审核申请:同意=一步到位回未审核;拒绝=退回申请。BOM 类走 stylesApi(单号位=款号)
  // 成功文案照抄老系统 MessagesPage handleUnapprove
  const decide = async (kind: "approve" | "reject") => {
    const m = approvalMsg;
    const no = (m?.单号 ?? "").trim();
    if (!m || !no) return;
    const bom = isBomUnapprove(m);
    setActing(true);
    try {
      if (kind === "approve") {
        await (bom
          ? stylesApi.approveBomReverseAuditRequest(no)
          : productionApi.approveUnapproveRequest(no));
      } else {
        await (bom
          ? stylesApi.rejectBomReverseAuditRequest(no)
          : productionApi.rejectUnapproveRequest(no));
      }
      setToast({
        text: kind === "approve" ? "已同意反审核,已回到未审核" : "已拒绝该反审核申请",
        tone: "ok",
      });
      setApprovalMsg(null);
      refreshAll();
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : "操作失败", tone: "err" });
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 p-5">
      {/* 页头 + 操作 */}
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">消息中心</h1>
        {unread > 0 && (
          <span className="rounded-full bg-[#16a34a]/10 px-2.5 py-1 text-xs font-semibold text-[#15803d]">
            未读 <span className="f-mono">{unread}</span> 条
          </span>
        )}
        <div className="ml-auto flex items-center gap-2.5">
          {/* 只看未读/全部 切换(老系统 Switch,新版分段控件) */}
          <div className="flex items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
            {(
              [
                { key: false, label: "全部" },
                { key: true, label: "只看未读" },
              ] as const
            ).map((v) => (
              <button
                key={v.label}
                type="button"
                onClick={() => {
                  setPage(1);
                  setOnlyUnread(v.key);
                }}
                className={cn(
                  "h-9 rounded-lg px-4 text-sm transition-colors",
                  onlyUnread === v.key
                    ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                    : "text-[#5f6b7d] hover:text-[#3d4a5c]",
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="f-btn h-10 px-4"
            onClick={refreshAll}
          >
            <ArrowClockwise className="h-4.5 w-4.5" />
            刷新
          </button>
        </div>
      </div>

      {/* 消息列表 */}
      <div className="f-panel flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[900px] text-[15px]">
            <thead>
              <tr className="border-b border-black/8 bg-black/[0.03]">
                <th className="f-label sticky top-0 z-10 w-20 bg-[#f7faf8] px-4 py-3 text-left font-medium whitespace-nowrap">
                  状态
                </th>
                <th className="f-label sticky top-0 z-10 w-32 bg-[#f7faf8] px-4 py-3 text-left font-medium whitespace-nowrap">
                  类型
                </th>
                <th className="f-label sticky top-0 z-10 bg-[#f7faf8] px-4 py-3 text-left font-medium whitespace-nowrap">
                  标题
                </th>
                <th className="f-label sticky top-0 z-10 bg-[#f7faf8] px-4 py-3 text-left font-medium whitespace-nowrap">
                  内容
                </th>
                <th className="f-label sticky top-0 z-10 w-40 bg-[#f7faf8] px-4 py-3 text-left font-medium whitespace-nowrap">
                  单号
                </th>
                <th className="f-label sticky top-0 z-10 w-44 bg-[#f7faf8] px-4 py-3 text-left font-medium whitespace-nowrap">
                  时间
                </th>
                <th className="f-label sticky top-0 z-10 w-20 bg-[#f7faf8] px-4 py-3 text-left font-medium whitespace-nowrap">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {listQuery.isLoading ? (
                <tr>
                  <td colSpan={7} className="p-4">
                    <div className="space-y-2">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-11 w-full bg-black/5" />
                      ))}
                    </div>
                  </td>
                </tr>
              ) : listQuery.isError ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <div className="text-sm font-medium text-[#dc2626]">加载消息失败</div>
                    <button
                      type="button"
                      className="f-btn mt-3 h-10 px-4 text-sm"
                      onClick={() => listQuery.refetch()}
                    >
                      重试
                    </button>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <Checks className="mx-auto mb-2 h-6 w-6 text-disabled" />
                    <div className="text-sm text-disabled">
                      {onlyUnread ? "没有未读消息" : "暂无消息"}
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((m) => {
                  const un = isUnread(m);
                  return (
                    <tr
                      key={rowId(m)}
                      className="border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
                    >
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {un ? (
                          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#dc2626]">
                            <span className="h-2 w-2 rounded-full bg-[#dc2626]" />
                            未读
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-black/6 px-2.5 py-1 text-xs font-medium text-[#5f6b7d]">
                            已读
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {m.类型 ? (
                          <span className="inline-flex rounded-full bg-black/6 px-2.5 py-1 text-xs font-medium text-[#5f6b7d]">
                            {m.类型}
                          </span>
                        ) : (
                          <span className="text-disabled">-</span>
                        )}
                      </td>
                      <td
                        className={cn(
                          "max-w-56 truncate px-4 py-2.5",
                          un ? "font-semibold text-[#1a2330]" : "text-[#3d4a5c]",
                        )}
                      >
                        {m.标题 || "(无标题)"}
                      </td>
                      <td className="max-w-72 truncate px-4 py-2.5 text-[#5f6b7d]">
                        {m.内容 ?? ""}
                      </td>
                      <td className="f-mono px-4 py-2.5 whitespace-nowrap text-[#3d4a5c]">
                        {m.单号 ?? ""}
                      </td>
                      <td className="f-mono px-4 py-2.5 whitespace-nowrap text-[#5f6b7d]">
                        {fmtTime(m.创建时间)}
                      </td>
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-sm font-medium whitespace-nowrap text-[#15803d] hover:underline"
                          onClick={() => view(m)}
                        >
                          <Eye className="h-4 w-4" />
                          查看
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {/* 分页底栏 */}
        <div className="f-mono flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-black/8 bg-black/[0.03] px-4 py-2.5 text-sm text-[#5f6b7d]">
          <span>共 {total} 条</span>
          <div className="flex items-center gap-2">
            {/* f-input 无层叠 width:100%/height:44px 会压扁同行按钮且与 h-9 按钮不齐,
                定宽容器 + f-input-slim 修饰类(同 .f-input-icon 修法) */}
            <div className="w-24">
              <SearchSelect
                ariaLabel="每页条数"
                value={String(size)}
                options={PAGE_SIZES.map((s) => ({ value: String(s), label: `${s} 条/页` }))}
                onChange={(v) => {
                  setPage(1);
                  setSize(Number(v));
                }}
              />
            </div>
            <button
              type="button"
              className="f-btn h-9 px-3 text-sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <CaretLeft className="h-4 w-4" />
              上一页
            </button>
            <span>
              第 {page} / {totalPages} 页
            </span>
            <button
              type="button"
              className="f-btn h-9 px-3 text-sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
              <CaretRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 反审核申请审批弹窗(老系统抽屉行为):经理同意=一步到位回未审核,拒绝=退回申请;
          结果消息不在此(只读,直接跳单据页)。BOM 类消息的 单号位=款号 */}
      <Dialog
        open={approvalMsg !== null}
        onOpenChange={(o) => {
          if (!o) setApprovalMsg(null);
        }}
      >
        <DialogContent className="border-black/10 bg-white text-[#1a2330] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{approvalMsg?.标题 ?? "反审核"}</DialogTitle>
            <DialogDescription className="text-[#5f6b7d]">
              同意后立即回到未审核状态(一步到位),申请人可修改后重新保存审核;拒绝则保持已审核。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2.5 text-sm">
            <div className="flex gap-3">
              <span className="f-label w-20 shrink-0 pt-0.5">
                {approvalMsg && isBomUnapprove(approvalMsg) ? "款号" : "生产单号"}
              </span>
              <span className="f-mono font-semibold text-[#1a2330]">{approvalMsg?.单号}</span>
            </div>
            <div className="flex gap-3">
              <span className="f-label w-20 shrink-0 pt-0.5">内容</span>
              <span className="leading-relaxed text-[#3d4a5c]">{approvalMsg?.内容}</span>
            </div>
            <div className="flex gap-3">
              <span className="f-label w-20 shrink-0 pt-0.5">时间</span>
              <span className="f-mono text-[#5f6b7d]">{fmtTime(approvalMsg?.创建时间)}</span>
            </div>
          </div>
          <DialogFooter>
            {/* 生产单类可在单据页查看;BOM 类在 BOM物料设置页查看(Batch 1 起可用) */}
            {approvalMsg && !isBomUnapprove(approvalMsg) && MENU_PATHS.has("/production") && (
              <button
                type="button"
                className="f-btn h-10 px-4"
                onClick={() => {
                  const no = (approvalMsg.单号 ?? "").trim();
                  setApprovalMsg(null);
                  navigate(`/production?mo=${encodeURIComponent(no)}`);
                }}
              >
                查看单据
              </button>
            )}
            {/* 审批按钮只看消息类型(对齐老系统,无前端权限门);后端拒绝时 toast 报错 */}
            <button
              type="button"
              className="f-btn h-10 px-4 text-[#dc2626]"
              disabled={acting}
              onClick={() => decide("reject")}
            >
              拒绝
            </button>
            <button
              type="button"
              className="f-btn f-btn-cyan h-10 px-4"
              disabled={acting}
              onClick={() => decide("approve")}
            >
              同意反审核
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
