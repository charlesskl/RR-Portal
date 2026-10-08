// 用户修改密码(/change-password;老系统 web/src/pages/ChangePasswordPage.tsx 重写):
// POST /auth/change-password {原密码,新密码};前端校验:必填/新密码至少 6 位/不能与原密码相同/两次一致;
// 成功后清空表单。任何登录用户可用,无权限菜单(MenuCatalog 未收录,老系统同)。
import { useEffect, useState } from "react";
import { authApi } from "@/api/endpoints";
import { DocToast } from "@/components/doc/DocToast";

export default function ChangePasswordPage() {
  const [原密码, set原密码] = useState("");
  const [新密码, set新密码] = useState("");
  const [确认新密码, set确认新密码] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const submit = async () => {
    if (!原密码) {
      setToast({ text: "请输入原密码", tone: "err" });
      return;
    }
    if (!新密码) {
      setToast({ text: "请输入新密码", tone: "err" });
      return;
    }
    if (新密码.length < 6) {
      setToast({ text: "新密码长度至少 6 位", tone: "err" });
      return;
    }
    if (新密码 === 原密码) {
      setToast({ text: "新密码不能与原密码相同", tone: "err" });
      return;
    }
    if (确认新密码 !== 新密码) {
      setToast({ text: "两次输入的新密码不一致", tone: "err" });
      return;
    }
    setSaving(true);
    try {
      const r = await authApi.changePassword(原密码, 新密码);
      setToast({ text: r.消息 ?? "密码修改成功", tone: "ok" });
      set原密码("");
      set新密码("");
      set确认新密码("");
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : "密码修改失败", tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="f-page mx-auto max-w-md space-y-4 p-5">
      <h1 className="px-1 text-2xl font-bold text-[#1a2330]">用户修改密码</h1>
      <div className="f-panel space-y-4 p-6">
        <label className="block">
          <span className="f-label">原密码</span>
          <input
            aria-label="原密码"
            type="password"
            className="f-input f-input-slim mt-1.5"
            placeholder="请输入原密码"
            autoFocus
            value={原密码}
            onChange={(e) => set原密码(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="f-label">新密码</span>
          <input
            aria-label="新密码"
            type="password"
            className="f-input f-input-slim mt-1.5"
            placeholder="至少 6 位"
            value={新密码}
            onChange={(e) => set新密码(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="f-label">确认新密码</span>
          <input
            aria-label="确认新密码"
            type="password"
            className="f-input f-input-slim mt-1.5"
            placeholder="请再次输入新密码"
            value={确认新密码}
            onChange={(e) => set确认新密码(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="f-btn f-btn-cyan h-10 w-full text-sm font-bold"
          disabled={saving}
          onClick={() => void submit()}
        >
          保存
        </button>
      </div>
      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
