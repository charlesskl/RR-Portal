// 登录态读取（全系统统一鉴权入口）
// 迁移后：登录由 .NET 后端处理，成功后签发一个 JWT 存到 HttpOnly Cookie `sprayplan_session` 里。
// 这里用 jose 验证该 JWT 的签名与有效期，解出 { userId, username, role }。
// 所有 SSR 页面 / 布局 / 路由守卫(guard) 都只通过 getSession() 读登录态，
// 无需感知底层是 JWT 还是别的——换实现只动这一个文件。
import { cookies } from "next/headers";
import { jwtVerify } from "jose";

// 会话里关心的字段（只读，最小化）
export interface SessionData {
  userId?: number;
  username?: string;
  role?: string;
}

// Cookie 名（与 .NET 后端 AuthController 写入的名字保持一致）
const COOKIE_NAME = "sprayplan_session";

// .NET 用标准的 Microsoft ClaimTypes.Role，序列化后是这个长 URI（值=角色字符串）
const ROLE_CLAIM = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";

// jose 验签需要 Uint8Array 形式的密钥（必须与 .NET appsettings.json 的 Jwt:Secret 一致）
function secretKey() {
  return new TextEncoder().encode(process.env.JWT_SECRET!);
}

// 统一入口：读取当前请求的登录态。
// 未登录 / 令牌缺失 / 验签失败 / 已过期 → 一律返回空对象 {}（调用方判 session.userId 即可）。
export async function getSession(): Promise<SessionData> {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return {};
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: process.env.JWT_ISSUER,
    });
    return {
      // .NET 把 userId 存成字符串，这里转回数字，跟旧代码的 number 类型保持一致
      userId: payload.userId != null ? Number(payload.userId) : undefined,
      username: typeof payload.username === "string" ? payload.username : undefined,
      role: typeof payload[ROLE_CLAIM] === "string" ? (payload[ROLE_CLAIM] as string) : undefined,
    };
  } catch {
    // 验签失败 / 过期 / 被篡改 → 当作未登录
    return {};
  }
}
