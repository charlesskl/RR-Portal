"use client";
import { apiFetch } from "@/lib/apiFetch";
// 用户编辑页（仅主管 admin 可访问，路由级鉴权由 API 层兜底）
// 功能：修改显示名 / 角色 / 启用状态 / 重置密码 / 删除用户
// 设计意图：用户名作为登录主键不可改（避免破坏审计日志一致性），其余字段可改
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";

export default function EditUserPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const [form, setForm] = useState({ displayName: "", role: "clerk", isActive: true, newPassword: "" });
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // 挂载时拉取用户当前数据填充表单
  useEffect(() => {
    apiFetch(`/api/users/${id}`)
      .then(r => r.json())
      .then(u => {
        if (u.error) { setError(u.error); setLoading(false); return; }
        setUsername(u.username);
        setForm({ displayName: u.displayName, role: u.role, isActive: u.isActive, newPassword: "" });
        setLoading(false);
      });
  }, [id]);

  // 保存修改：PATCH 整个表单（API 端只更新有变化的字段，newPassword 留空则不改密码）
  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const res = await apiFetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      router.push("/users");
      router.refresh();
    } else {
      setError((await res.json()).error || "保存失败");
    }
  }

  // 删除用户：浏览器原生 confirm 二次确认，防误操作
  async function handleDelete() {
    if (!confirm(`确认删除用户 ${username}？此操作不可撤销。`)) return;
    const res = await apiFetch(`/api/users/${id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/users");
      router.refresh();
    } else {
      setError((await res.json()).error || "删除失败");
    }
  }

  if (loading) return <div className="text-text-secondary">加载中...</div>;

  return (
    <div className="max-w-md">
      <h1 className="text-2xl font-bold text-text mb-1">👥 编辑用户</h1>
      <p className="text-sm text-text-tertiary mb-6">用户名 (不可改): <span className="font-mono">{username}</span></p>

      <form onSubmit={handleSave} className="bg-white p-6 rounded-card border border-app-border space-y-4">
        <div>
          <label className="block text-sm text-text-secondary mb-1" htmlFor="displayName">显示名</label>
          <input id="displayName" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required
            className="w-full border border-app-border rounded-btn px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm text-text-secondary mb-1" htmlFor="role">角色</label>
          <select id="role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
            className="w-full border border-app-border rounded-btn px-3 py-2">
            <option value="admin">主管 admin</option>
            <option value="clerk">文员/拉长 clerk</option>
            <option value="viewer">统计组 viewer</option>
          </select>
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            账号启用
          </label>
        </div>
        <div>
          <label className="block text-sm text-text-secondary mb-1" htmlFor="newPassword">新密码（留空表示不改）</label>
          <input id="newPassword" type="password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
            className="w-full border border-app-border rounded-btn px-3 py-2" placeholder="留空不修改" />
        </div>
        {error && <p className="text-rose text-sm">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={handleDelete}
            className="bg-rose hover:opacity-90 text-white px-4 py-2 rounded-btn text-sm">🗑️ 删除</button>
          <button type="button" onClick={() => router.push("/users")}
            className="px-4 py-2 border border-app-border rounded-btn text-sm">取消</button>
          <button type="submit"
            className="bg-mint-400 hover:bg-mint-700 text-white px-4 py-2 rounded-btn text-sm">💾 保存</button>
        </div>
      </form>
    </div>
  );
}
