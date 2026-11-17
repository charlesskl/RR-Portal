import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
const state = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: (name: string) => state.cookies.has(name) ? { value: state.cookies.get(name) } : undefined }) }));
import { getSession } from "../../../src/lib/session";
beforeEach(() => { state.cookies.clear(); vi.stubEnv("JWT_SECRET", "factory-session-test-only-32-characters"); vi.stubEnv("JWT_ISSUER", "factory-session-tests"); });
afterEach(() => vi.unstubAllEnvs());
async function login(role: string, factoryId: string) {
  const token = await new SignJWT({ userId: "1", factoryId, "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": role })
    .setProtectedHeader({ alg: "HS256" }).setIssuer("factory-session-tests").setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
  state.cookies.set("sprayplan_session", token);
}
it("管理员未选择厂区时，页面与后端均沿用华登账号默认厂区", async () => {
  await login("admin", "HUADENG"); expect((await getSession()).factoryId).toBe("HUADENG");
});
it("管理员明确选择兴信会覆盖账号默认华登", async () => {
  await login("admin", "HUADENG"); state.cookies.set("sprayplan_factory", "XINGXIN"); expect((await getSession()).factoryId).toBe("XINGXIN");
});
it("文员的厂区不受伪造的选择 cookie 影响", async () => {
  await login("clerk", "XINGXIN"); state.cookies.set("sprayplan_factory", "HUADENG"); expect((await getSession()).factoryId).toBe("XINGXIN");
});
