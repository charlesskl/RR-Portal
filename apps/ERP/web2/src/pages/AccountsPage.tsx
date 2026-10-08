import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CaretDown,
  Key,
  LockSimple,
  LockSimpleOpen,
  MagnifyingGlass,
  Trash,
  UserPlus,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { accountApi, userPermApi } from "@/api/endpoints";
import type { MenuPermRow } from "@/api/types";
import { ApiError } from "@/lib/api";
import { fmtDate, txt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

// 账号权限管理(/accounts):功能对齐旧版 web/src/pages/admin/AccountPage.tsx
// 列表/搜索/注册/重置密码/停用启用/删除 + 按组分组的 9 位菜单权限矩阵(侧拉面板)。
const PERM_BITS = ["打开", "保存", "删除", "打印", "单价", "金额", "审核", "反审核", "功能"] as const;
type PermBit = (typeof PERM_BITS)[number];

const errMsg = (e: unknown, fallback: string) =>
  e instanceof ApiError ? e.message : fallback;

// ---------- 轻提示 ----------

function Toast({ text, tone }: { text: string; tone: "ok" | "err" }) {
  return (
    <div
      className={cn(
        "fixed right-6 bottom-6 z-[70] rounded-xl border px-4 py-2.5 text-sm font-medium shadow-[0_12px_32px_-8px_rgb(26_35_48/0.2)]",
        tone === "ok"
          ? "border-[#16a34a]/30 bg-white text-[#15803d]"
          : "border-[#dc2626]/30 bg-white text-[#dc2626]",
      )}
    >
      {text}
    </div>
  );
}

// ---------- 权限侧拉面板 ----------

function PermDrawer({
  用户,
  onClose,
  notify,
}: {
  用户: string | null;
  onClose: () => void;
  notify: (text: string, tone?: "ok" | "err") => void;
}) {
  const [rows, setRows] = useState<MenuPermRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!用户) return;
    setLoading(true);
    userPermApi
      .get(用户)
      .then(setRows)
      .catch((e) => notify(errMsg(e, "加载权限失败"), "err"))
      .finally(() => setLoading(false));
  }, [用户]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc 关闭
  useEffect(() => {
    if (!用户) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [用户, onClose]);

  const setBit = (菜单: string, bit: PermBit, v: boolean) =>
    setRows((prev) => prev.map((r) => (r.菜单 === 菜单 ? { ...r, [bit]: v } : r)));

  const setRowAll = (菜单: string, v: boolean) =>
    setRows((prev) =>
      prev.map((r) => {
        if (r.菜单 !== 菜单) return r;
        const next = { ...r };
        for (const b of PERM_BITS) next[b] = v;
        return next;
      }),
    );

  const save = async () => {
    if (!用户) return;
    setSaving(true);
    try {
      await userPermApi.save(用户, rows);
      notify("权限已保存");
      onClose();
    } catch (e) {
      notify(errMsg(e, "保存失败"), "err");
    } finally {
      setSaving(false);
    }
  };

  // 按组聚合,保持后端返回顺序
  const groups: { 组: string; 菜单行: MenuPermRow[] }[] = [];
  for (const r of rows) {
    const g = r.组 || "(未分组)";
    const found = groups.find((x) => x.组 === g);
    if (found) found.菜单行.push(r);
    else groups.push({ 组: g, 菜单行: [r] });
  }

  if (!用户) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      {/* 面板:不透明白底,限制在视口内,头部/底部固定,矩阵区可滚 */}
      <div className="absolute top-0 right-0 flex h-full w-[800px] max-w-[92vw] flex-col border-l border-[#e3eae4] bg-white shadow-[-16px_0_40px_-20px_rgb(26_35_48/0.3)]">
        <div className="flex shrink-0 items-center gap-3 border-b border-black/8 px-6 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold text-[#1a2330]">权限设置</div>
            <div className="mt-0.5 text-sm text-[#5f6b7d]">
              账号:<span className="f-mono font-semibold text-[#1a2330]">{用户}</span>
              ,按菜单勾选可操作的功能位
            </div>
          </div>
          <button
            type="button"
            onClick={save}
            disabled={saving || loading}
            className="f-btn f-btn-cyan h-11 px-5"
          >
            {saving ? "保存中..." : "保存"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-[#5f6b7d] transition-colors hover:bg-black/5"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full bg-black/5" />
              ))}
            </div>
          ) : (
            groups.map((g) => {
              const isCollapsed = collapsed[g.组] ?? false;
              return (
                <div
                  key={g.组}
                  className="mb-3 overflow-hidden rounded-xl border border-[#e3eae4]"
                >
                  <button
                    type="button"
                    onClick={() => setCollapsed((p) => ({ ...p, [g.组]: !isCollapsed }))}
                    className="flex h-11 w-full items-center gap-2 bg-black/[0.03] px-4 text-sm font-semibold text-[#1a2330] transition-colors hover:bg-black/[0.05]"
                  >
                    <span className="flex-1 text-left">
                      {g.组}
                      <span className="ml-2 text-xs font-normal text-[#5f6b7d]">
                        {g.菜单行.length} 项
                      </span>
                    </span>
                    <CaretDown
                      className={cn(
                        "h-4 w-4 text-[#5f6b7d] transition-transform",
                        isCollapsed && "-rotate-90",
                      )}
                    />
                  </button>
                  {!isCollapsed && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-[#5f6b7d]">
                            <th className="border-b border-black/8 bg-white px-3 py-2 text-left font-medium whitespace-nowrap">
                              菜单
                            </th>
                            {PERM_BITS.map((b) => (
                              <th
                                key={b}
                                className="border-b border-black/8 bg-white px-2 py-2 text-center font-medium whitespace-nowrap"
                              >
                                {b}
                              </th>
                            ))}
                            <th className="border-b border-black/8 bg-white px-2 py-2 text-center font-medium whitespace-nowrap">
                              全选
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.菜单行.map((r) => {
                            const allOn = PERM_BITS.every((b) => r[b]);
                            return (
                              <tr
                                key={r.菜单}
                                className="border-b border-black/6 last:border-0 hover:bg-black/[0.02]"
                              >
                                <td className="px-3 py-2 font-medium whitespace-nowrap text-[#1a2330]">
                                  {r.菜单}
                                </td>
                                {PERM_BITS.map((b) => (
                                  <td key={b} className="px-2 py-2 text-center">
                                    <input
                                      type="checkbox"
                                      checked={!!r[b]}
                                      onChange={(e) => setBit(r.菜单, b, e.target.checked)}
                                      className="h-4.5 w-4.5 accent-[#16a34a]"
                                    />
                                  </td>
                                ))}
                                <td className="px-2 py-2 text-center">
                                  <input
                                    type="checkbox"
                                    checked={allOn}
                                    onChange={(e) => setRowAll(r.菜单, e.target.checked)}
                                    className="h-4.5 w-4.5 accent-[#16a34a]"
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="shrink-0 border-t border-black/8 px-6 py-3 text-xs text-disabled">
          共 {rows.length} 个菜单项;勾选后点右上角「保存」生效
        </div>
      </div>
    </div>
  );
}

// ---------- 页面 ----------

export default function AccountsPage() {
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [applied, setApplied] = useState("");
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const [regOpen, setRegOpen] = useState(false);
  const [regUser, setRegUser] = useState("");
  const [regPwd, setRegPwd] = useState("");
  const [regBusy, setRegBusy] = useState(false);

  const [pwdUser, setPwdUser] = useState<string | null>(null);
  const [newPwd, setNewPwd] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);

  const [confirm, setConfirm] = useState<
    { action: "lock" | "unlock" | "delete"; user: string } | null
  >(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const [permUser, setPermUser] = useState<string | null>(null);

  const notify = useCallback((text: string, tone: "ok" | "err" = "ok") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, tone });
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const listQuery = useQuery({
    queryKey: ["accounts", applied],
    queryFn: () => accountApi.list(applied),
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: ["accounts"] });

  const register = async () => {
    if (!regUser.trim()) return notify("请输入用户名", "err");
    if (!regPwd.trim()) return notify("请输入初始密码", "err");
    setRegBusy(true);
    try {
      await accountApi.register({ 用户名: regUser.trim(), 初始密码: regPwd });
      notify("已注册");
      setRegOpen(false);
      setRegUser("");
      setRegPwd("");
      reload();
    } catch (e) {
      notify(errMsg(e, "注册失败"), "err");
    } finally {
      setRegBusy(false);
    }
  };

  const resetPassword = async () => {
    if (!pwdUser) return;
    if (!newPwd.trim()) return notify("请输入新密码", "err");
    setPwdBusy(true);
    try {
      await accountApi.resetPassword(pwdUser, { 新密码: newPwd });
      notify("已重置密码");
      setPwdUser(null);
      setNewPwd("");
    } catch (e) {
      notify(errMsg(e, "重置失败"), "err");
    } finally {
      setPwdBusy(false);
    }
  };

  const doConfirm = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      if (confirm.action === "lock") await accountApi.lock(confirm.user);
      else if (confirm.action === "unlock") await accountApi.unlock(confirm.user);
      else await accountApi.remove(confirm.user);
      notify(confirm.action === "delete" ? "已删除" : confirm.action === "lock" ? "已停用" : "已启用");
      setConfirm(null);
      reload();
    } catch (e) {
      notify(errMsg(e, "操作失败"), "err");
    } finally {
      setConfirmBusy(false);
    }
  };

  const rows = listQuery.data ?? [];
  const noPerm =
    listQuery.error instanceof ApiError && listQuery.error.status === 403;

  return (
    <div className="flex h-full flex-col gap-4 p-5">
      {/* 页头 */}
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">账号权限管理</h1>
        <span className="rounded-full bg-black/6 px-2.5 py-1 text-xs font-medium text-[#5f6b7d] tabular-nums">
          {listQuery.isSuccess ? `${rows.length} 个账号` : "加载中"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setApplied(keyword.trim());
            }}
          >
            <Input
              className="h-11 w-56 border-black/10 bg-white text-[15px]"
              placeholder="用户名(空=全部)"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </form>
          <Button
            variant="outline"
            className="h-11 px-4 text-[15px]"
            onClick={() => setApplied(keyword.trim())}
          >
            <MagnifyingGlass className="h-4.5 w-4.5" />
            查询
          </Button>
          <button type="button" className="f-btn f-btn-cyan h-11 px-4" onClick={() => setRegOpen(true)}>
            <UserPlus className="h-5 w-5" />
            注册账号
          </button>
        </div>
      </div>

      {/* 用户列表 */}
      <div className="f-panel flex min-h-0 flex-1 flex-col overflow-hidden">
        {listQuery.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full bg-black/5" />
            ))}
          </div>
        ) : noPerm ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
            <LockSimple className="h-8 w-8 text-disabled" />
            <div className="text-sm font-medium text-[#3d4a5c]">无权限访问</div>
            <p className="text-sm text-[#5f6b7d]">账号权限管理仅管理员可用</p>
          </div>
        ) : listQuery.isError ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
            <div className="text-sm font-medium text-[#dc2626]">加载失败</div>
            <button
              type="button"
              className="f-btn mt-2 h-10 text-sm"
              onClick={() => listQuery.refetch()}
            >
              重试
            </button>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full text-[15px]">
              <thead>
                <tr className="text-[13px] text-[#5f6b7d]">
                  {["用户", "登录状态", "上次登录", "状态", "操作"].map((t, i) => (
                    <th
                      key={t}
                      className={cn(
                        "sticky top-0 z-10 border-b border-black/8 bg-white px-4 py-3 font-medium whitespace-nowrap",
                        i === 4 ? "text-right" : "text-left",
                      )}
                    >
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.用户}
                    className="h-14 border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.02]"
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#16a34a]/10 text-sm font-bold text-[#15803d]">
                          {(r.用户 ?? "?").slice(0, 1)}
                        </span>
                        <span className="f-mono font-semibold text-[#1a2330]">
                          {txt(r.用户)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-[#3d4a5c]">
                      {r.登录状态 || "-"}
                    </td>
                    <td className="f-mono px-4 py-2 whitespace-nowrap text-[#3d4a5c]">
                      {r.上次登录 ? fmtDate(r.上次登录) : r.日期 ? fmtDate(r.日期) : "-"}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {r.已锁定 ? (
                        <span className="inline-flex rounded-full bg-[#dc2626]/10 px-2.5 py-1 text-xs font-semibold text-[#dc2626]">
                          已锁定
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-[#16a34a]/10 px-2.5 py-1 text-xs font-semibold text-[#15803d]">
                          正常
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                        <OpButton label="权限" onClick={() => setPermUser(r.用户!)} />
                        <OpButton
                          label="重置密码"
                          icon={<Key className="h-4 w-4" />}
                          onClick={() => {
                            setPwdUser(r.用户!);
                            setNewPwd("");
                          }}
                        />
                        {r.已锁定 ? (
                          <OpButton
                            label="启用"
                            icon={<LockSimpleOpen className="h-4 w-4" />}
                            onClick={() => setConfirm({ action: "unlock", user: r.用户! })}
                          />
                        ) : (
                          <OpButton
                            label="停用"
                            icon={<LockSimple className="h-4 w-4" />}
                            onClick={() => setConfirm({ action: "lock", user: r.用户! })}
                          />
                        )}
                        <OpButton
                          label="删除"
                          danger
                          icon={<Trash className="h-4 w-4" />}
                          onClick={() => setConfirm({ action: "delete", user: r.用户! })}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
                <UsersThree className="h-8 w-8 text-disabled" />
                <div className="text-sm text-[#5f6b7d]">暂无账号</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 注册账号 */}
      <Dialog open={regOpen} onOpenChange={setRegOpen}>
        <DialogContent className="border-black/10 bg-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg">注册账号</DialogTitle>
            <DialogDescription className="text-sm">
              新账号默认无任何菜单权限,注册后在「权限」中分配
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm">用户名</Label>
              <Input
                className="h-11 text-[15px]"
                placeholder="登录用户名"
                value={regUser}
                onChange={(e) => setRegUser(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">初始密码</Label>
              <Input
                type="password"
                className="h-11 text-[15px]"
                placeholder="初始密码"
                value={regPwd}
                onChange={(e) => setRegPwd(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="h-10" onClick={() => setRegOpen(false)}>
                取消
              </Button>
              <button
                type="button"
                className="f-btn f-btn-cyan h-10 px-4 text-sm"
                disabled={regBusy}
                onClick={register}
              >
                {regBusy ? "注册中..." : "注册"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 重置密码 */}
      <Dialog open={!!pwdUser} onOpenChange={(v) => !v && setPwdUser(null)}>
        <DialogContent className="border-black/10 bg-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg">重置密码</DialogTitle>
            <DialogDescription className="text-sm">
              账号:<span className="f-mono font-semibold">{pwdUser}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm">新密码</Label>
              <Input
                type="password"
                className="h-11 text-[15px]"
                placeholder="新密码"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="h-10" onClick={() => setPwdUser(null)}>
                取消
              </Button>
              <button
                type="button"
                className="f-btn f-btn-cyan h-10 px-4 text-sm"
                disabled={pwdBusy}
                onClick={resetPassword}
              >
                {pwdBusy ? "提交中..." : "重置密码"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 停用/启用/删除确认 */}
      <Dialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <DialogContent className="border-black/10 bg-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg">
              {confirm?.action === "delete" ? "删除账号" : confirm?.action === "lock" ? "停用账号" : "启用账号"}
            </DialogTitle>
            <DialogDescription className="text-sm">
              {confirm?.action === "delete"
                ? `确认删除账号 ${confirm.user}?删除后不可恢复。`
                : confirm?.action === "lock"
                  ? `确认停用账号 ${confirm?.user}?停用后该账号无法登录。`
                  : `确认启用账号 ${confirm?.user}?`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="h-10" onClick={() => setConfirm(null)}>
              取消
            </Button>
            <button
              type="button"
              className={cn(
                "f-btn h-10 px-4 text-sm",
                confirm?.action === "unlock" ? "f-btn-cyan" : "border-transparent bg-[#dc2626] text-white hover:bg-[#b91c1c]",
              )}
              disabled={confirmBusy}
              onClick={doConfirm}
            >
              {confirmBusy ? "处理中..." : "确认"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 权限侧拉面板 */}
      <PermDrawer 用户={permUser} onClose={() => setPermUser(null)} notify={notify} />

      {toast && <Toast text={toast.text} tone={toast.tone} />}
    </div>
  );
}

function OpButton({
  label,
  icon,
  danger,
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition-colors",
        danger
          ? "text-[#dc2626] hover:bg-[#dc2626]/8"
          : "text-[#3d4a5c] hover:bg-black/5 hover:text-[#15803d]",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
