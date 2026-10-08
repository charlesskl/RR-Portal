import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { LockKey, User } from "@phosphor-icons/react";
import { authApi } from "@/api/endpoints";
import { setToken, setUser } from "@/lib/auth";
import { ApiError } from "@/lib/api";

// 登录页:浅色全屏 aurora + 网格纹理 + 居中玻璃登录卡;主按钮实心绿。
export default function LoginPage() {
  const navigate = useNavigate();
  const [user, setUserVal] = useState("");
  const [pwd, setPwd] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError("");
    if (!user.trim()) {
      setError("请输入用户名");
      return;
    }
    if (!pwd) {
      setError("请输入密码");
      return;
    }
    setLoading(true);
    try {
      const r = await authApi.login(user.trim(), pwd);
      if (!r.成功 || !r.令牌) {
        setError(r.消息 || "用户名或密码不正确");
        return;
      }
      setToken(r.令牌);
      setUser(user.trim());
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "无法连接服务器,请稍后再试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      data-theme="future"
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f7faf8] px-6"
    >
      <div className="f-aurora" />
      <div className="f-grid-tex absolute inset-0" />

      <div className="relative z-10 w-full max-w-md">
        {/* 品牌行 */}
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#16a34a] shadow-[inset_0_1px_0_rgb(255_255_255/0.4)]">
            <span className="text-xl font-bold text-[#ffffff]">W</span>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#1a2330]">WebpageERP 生产管理系统</h1>
            <p className="f-label mt-2">生产 · 仓储 · 船务 一体化控制台</p>
          </div>
        </div>

        {/* 玻璃登录卡 */}
        <div className="f-panel p-8">
          <form onSubmit={onSubmit} noValidate className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="f-user" className="f-label block">
                用户名
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-[#5f6b7d]" />
                <input
                  id="f-user"
                  autoComplete="username"
                  placeholder="请输入用户名"
                  className="f-input f-input-icon"
                  value={user}
                  disabled={loading}
                  onChange={(e) => setUserVal(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="f-pwd" className="f-label block">
                密码
              </label>
              <div className="relative">
                <LockKey className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-[#5f6b7d]" />
                <input
                  id="f-pwd"
                  type="password"
                  autoComplete="current-password"
                  placeholder="请输入密码"
                  className="f-input f-input-icon"
                  value={pwd}
                  disabled={loading}
                  onChange={(e) => setPwd(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <p className="text-sm text-[#dc2626]" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="f-btn f-btn-cyan h-12 w-full justify-center text-base font-bold"
            >
              {loading ? "登录中..." : "登录"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-disabled">
          WebpageERP 内部系统,仅限授权员工使用
        </p>
      </div>
    </div>
  );
}
