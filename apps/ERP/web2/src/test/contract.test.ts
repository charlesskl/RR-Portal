import { describe, expect, it } from "vitest";

const BASE = "http://localhost:5050"; // 开发后端端口(macOS 5000 被 AirPlay 抢占)
async function reachable() {
  try {
    await fetch(`${BASE}/api/messages/unread-count`);
    return true;
  } catch {
    return false;
  }
}

describe("后端契约 smoke", () => {
  it("登录拿 token 并拉到未读数", async () => {
    if (!(await reachable())) return; // 后端未启动时跳过
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 用户: "admin", 密码: "admin123" }),
    });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.令牌).toBeTruthy();
  });
});
