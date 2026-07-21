"use client";
import { apiFetch } from "@/lib/apiFetch";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewUserPage() {
  const router = useRouter();
  const [form, setForm] = useState({ username: "", password: "", displayName: "", role: "clerk" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await apiFetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      router.push("/users");
      router.refresh();
    } else {
      const body = await res.json();
      setError(body.error || "创建失败");
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md">
      <h1 className="text-2xl font-bold text-text mb-6">👥 新建用户</h1>

      <form onSubmit={handleSubmit} className="bg-white p-6 rounded-card border border-app-border space-y-4">
        <Field label="用户名"   value={form.username}    onChange={(v) => setForm({ ...form, username: v })} required />
        <Field label="密码"     value={form.password}    onChange={(v) => setForm({ ...form, password: v })} type="password" required />
        <Field label="显示名"   value={form.displayName} onChange={(v) => setForm({ ...form, displayName: v })} required />
        <div>
          <label className="block text-sm text-text-secondary mb-1" htmlFor="role">角色</label>
          <select
            id="role"
            value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
            className="w-full border border-app-border rounded-btn px-3 py-2"
          >
            <option value="admin">主管 admin</option>
            <option value="clerk">文员/拉长 clerk</option>
            <option value="viewer">统计组 viewer</option>
          </select>
        </div>
        {error && <p className="text-rose text-sm">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={() => router.push("/users")}
            className="px-4 py-2 border border-app-border rounded-btn text-sm">取消</button>
          <button type="submit" disabled={loading}
            className="bg-mint-400 hover:bg-mint-700 text-white px-4 py-2 rounded-btn text-sm">
            {loading ? "创建中..." : "💾 创建"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", required = false }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean;
}) {
  const id = label.replace(/\s/g, "-").toLowerCase();
  return (
    <div>
      <label className="block text-sm text-text-secondary mb-1" htmlFor={id}>{label}</label>
      <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required}
        className="w-full border border-app-border rounded-btn px-3 py-2 focus:outline-none focus:border-mint-400" />
    </div>
  );
}
