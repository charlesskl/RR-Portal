import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, setApiSession, type EpmsSession } from "@/lib/api";
import { AccessContext, useEpmsAccess } from "@/lib/epms-access";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";


export function EpmsAccountProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<EpmsSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const accept = useCallback((value: EpmsSession | null) => { setApiSession(value); setSession(value); }, []);
  useEffect(() => {
    let alive = true;
    api.epmsSession().then((value) => { if (alive) accept(value); }).catch((cause) => {
      if (alive) { accept(null); if (cause.code !== "EPMS_AUTH_REQUIRED") setError(cause.message); }
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; setApiSession(null); };
  }, [accept]);
  const login = async (username: string, password: string) => {
    const value = await api.epmsLogin(username, password, session || undefined);
    accept(value); setError(""); setRevision((value) => value + 1);
  };
  const logout = async () => { await api.epmsLogout(); accept(null); setRevision((value) => value + 1); };
  return <AccessContext.Provider value={{ session, loading, error, revision, login, logout }}>{children}</AccessContext.Provider>;
}

export function CoreAccountControl({ beforeLogout }: { beforeLogout?: () => Promise<void> }) {
  const { session, loading, error, login, logout } = useEpmsAccess();
  const [open, setOpen] = useState(false), [username, setUsername] = useState(""), [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState("");
  return (
    <div className="flex max-w-full flex-wrap items-center gap-2 text-xs">
      {session ? <>
        <span>{session.name} · {session.canEdit ? "可编辑" : "只读"}</span>
        <button type="button" disabled={busy} className="min-h-11 px-2 underline" onClick={() => { setFailure(""); setOpen(true); }}>重新登录</button>
        <button type="button" disabled={busy} className="min-h-11 px-2 underline" onClick={async () => {
          setBusy(true); setFailure("");
          try { await beforeLogout?.(); await logout(); } catch (cause) { setFailure((cause as Error).message); }
          finally { setBusy(false); }
        }}>退出账号</button>
      </> : <button type="button" disabled={loading} className="min-h-11 px-2 underline" onClick={() => setOpen(true)}>
        {loading ? "正在验证账号…" : "核心账号登录"}
      </button>}
      {(error || failure) && <span role="status" className="text-destructive">{failure || error}</span>}
      <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) setPassword(""); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>使用核心系统个人账号登录</DialogTitle><DialogDescription>{session
            ? "请重新验证当前个人账号，未保存的资料会保留。切换账号前请先保存或下载资料，再退出账号。"
            : "使用门户个人账号，姓名、部门和权限以账号资料为准。"}</DialogDescription></DialogHeader>
          <form className="space-y-3" onSubmit={async (event) => {
            event.preventDefault(); setBusy(true); setFailure("");
            try { await login(username, password); setOpen(false); }
            catch (cause) { setFailure((cause as Error).message); }
            finally { setPassword(""); setBusy(false); }
          }}>
            <label className="block">账号<input className="mt-1 w-full rounded border bg-background p-2" autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} /></label>
            <label className="block">密码<input className="mt-1 w-full rounded border bg-background p-2" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            {failure && <p role="alert" className="text-destructive">{failure}</p>}
            <button type="submit" disabled={busy} className="min-h-11 w-full rounded bg-secondary p-2 text-secondary-foreground">{busy ? "正在验证…" : "登录"}</button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
