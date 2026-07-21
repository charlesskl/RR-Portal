"use client";
import { apiFetch } from "@/lib/apiFetch";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      const body = await res.json();
      setError(body.error || "登录失败");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-app-bg-page">
      <form onSubmit={handleSubmit} className="w-80 bg-white p-8 rounded-card shadow border border-app-border">
        <h1 className="text-xl font-bold text-mint-700 mb-1">🎨 SprayPlan</h1>
        <p className="text-sm text-text-tertiary mb-6">印喷部生产排期系统 V1</p>

        <label className="block text-sm text-text-secondary mb-1" htmlFor="username">用户名</label>
        <input
          id="username"
          type="text" value={username} onChange={(e) => setUsername(e.target.value)} required
          className="w-full border border-app-border rounded-btn px-3 py-2 mb-4 focus:outline-none focus:border-mint-400"
        />

        <label className="block text-sm text-text-secondary mb-1" htmlFor="password">密码</label>
        <input
          id="password"
          type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
          className="w-full border border-app-border rounded-btn px-3 py-2 mb-4 focus:outline-none focus:border-mint-400"
        />

        {error && <p className="text-rose text-sm mb-3">{error}</p>}

        <button
          type="submit" disabled={loading}
          className="w-full bg-mint-400 hover:bg-mint-700 text-white py-2 rounded-btn disabled:opacity-60"
        >
          {loading ? "登录中..." : "登录"}
        </button>

        <div className="mt-6 text-xs text-text-tertiary">
          默认账号：admin/admin123 · clerk/clerk123 · viewer/viewer123
        </div>
      </form>
    </main>
  );
}
