// User accounts, sessions and permission checks for the ToyQMS backend.
// Password hashing matches the browser implementation exactly:
// PBKDF2 / SHA-256 / 120000 iterations / 256-bit key, base64 salt+hash.
import { db, now } from "./db.js";

const DEFAULT_PASSWORD = "12345678";
const encoder = new TextEncoder();
const bytesToBase64 = (bytes) => Buffer.from(bytes).toString("base64");
const base64ToBytes = (value) => new Uint8Array(Buffer.from(value, "base64"));

export const allPermissions = [
  "view_dashboard", "view_complaints", "manage_complaints", "delete_complaints",
  "view_analysis", "manage_classification", "manage_translation", "import_data",
  "view_cap", "manage_cap", "view_reports", "export_reports", "manage_users", "manage_settings", "view_audit"
];
export const defaultPermissions = {
  all: [...allPermissions],
  partial: ["view_dashboard", "view_complaints", "manage_complaints", "view_analysis", "manage_classification", "manage_translation", "import_data", "view_cap", "manage_cap", "view_reports", "export_reports"],
  viewer: ["view_dashboard", "view_complaints", "view_analysis", "view_cap", "view_reports"]
};

export const normalizeLoginName = (value) => value.trim().toLocaleLowerCase("zh-CN");

async function hashPassword(password, salt) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: base64ToBytes(salt), iterations: 120000, hash: "SHA-256" }, material, 256);
  return bytesToBase64(new Uint8Array(bits));
}
async function passwordFields(password) {
  const salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
  return { passwordSalt: salt, passwordHash: await hashPassword(password, salt) };
}

// ---------- row access ----------

function readUsers() {
  return db.prepare("SELECT data FROM users ORDER BY rowid").all().map((row) => JSON.parse(row.data));
}
function writeUser(user) {
  db.prepare(`INSERT INTO users (id, login_name_norm, enabled, data) VALUES (?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET login_name_norm=excluded.login_name_norm, enabled=excluded.enabled, data=excluded.data`)
    .run(user.id, normalizeLoginName(user.loginName), user.enabled ? 1 : 0, JSON.stringify(user));
}
export const publicUser = (user) => {
  const { passwordHash, passwordSalt, ...safe } = user;
  return safe;
};
export const hasPermission = (user, permission) => Boolean(user?.enabled && user.permissions.includes(permission));

// ---------- seeding ----------

export async function ensureSeedUser() {
  if (readUsers().length) return;
  const timestamp = now();
  const credentials = await passwordFields(DEFAULT_PASSWORD);
  writeUser({
    id: crypto.randomUUID(), name: "JC", responsibility: "质量总监", loginName: "JC",
    category: "all", permissions: [...defaultPermissions.all], enabled: true, mustChangePassword: true,
    ...credentials, createdAt: timestamp, updatedAt: timestamp, isPrimary: true
  });
}

// ---------- sessions ----------

export function createSession(userId) {
  const token = crypto.randomUUID();
  db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)").run(token, userId, now());
  return token;
}
export function destroySession(token) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}
export function userForToken(token) {
  if (!token) return null;
  const row = db.prepare("SELECT user_id FROM sessions WHERE token = ?").get(token);
  if (!row) return null;
  const user = readUsers().find((item) => item.id === row.user_id);
  return user?.enabled ? user : null;
}

// ---------- auth operations (mirror components/auth-provider.tsx) ----------

export async function login(loginName, password) {
  const match = readUsers().find((item) => normalizeLoginName(item.loginName) === normalizeLoginName(loginName));
  if (!match || !match.enabled || await hashPassword(password, match.passwordSalt) !== match.passwordHash) {
    throw new Error("登录名称或密码不正确，或账户已被停用。");
  }
  return match;
}

export async function changeOwnPassword(user, currentPassword, newPassword) {
  if (newPassword.length < 8) throw new Error("新密码至少需要 8 个字符。");
  if (await hashPassword(currentPassword, user.passwordSalt) !== user.passwordHash) throw new Error("当前密码不正确。");
  const credentials = await passwordFields(newPassword);
  writeUser({ ...user, ...credentials, mustChangePassword: false, updatedAt: now() });
}

export function listUsers() { return readUsers().map(publicUser); }

export async function createUser(input) {
  const stored = readUsers();
  const loginName = (input.loginName || "").trim();
  if (!input.name?.trim() || !input.responsibility?.trim() || !loginName) throw new Error("请填写名称、职责和登录名称。");
  if (!defaultPermissions[input.category]) throw new Error("账户类别无效。");
  if (stored.some((item) => normalizeLoginName(item.loginName) === normalizeLoginName(loginName))) throw new Error("登录名称已存在。");
  const timestamp = now();
  const credentials = await passwordFields(DEFAULT_PASSWORD);
  const user = {
    id: crypto.randomUUID(), name: input.name.trim(), responsibility: input.responsibility.trim(), loginName,
    category: input.category, permissions: [...(input.permissions ?? defaultPermissions[input.category])],
    enabled: true, mustChangePassword: true, ...credentials, createdAt: timestamp, updatedAt: timestamp, isPrimary: false
  };
  writeUser(user);
  return publicUser(user);
}

export async function updateUser(id, input, actorId) {
  const stored = readUsers();
  const current = stored.find((item) => item.id === id);
  if (!current) throw new Error("用户不存在。");
  const loginName = input.loginName?.trim() ?? current.loginName;
  if (stored.some((item) => item.id !== id && normalizeLoginName(item.loginName) === normalizeLoginName(loginName))) {
    throw new Error("登录名称已存在。");
  }
  const category = input.category ?? current.category;
  const permissions = input.permissions ?? (input.category && input.category !== current.category ? defaultPermissions[category] : current.permissions);
  const enabled = input.enabled ?? current.enabled;
  const candidate = { ...current, ...input, loginName, category, permissions: [...permissions], enabled, updatedAt: now() };
  const next = stored.map((item) => (item.id === id ? candidate : item));
  if (!next.some((item) => item.enabled && defaultPermissions.all.every((permission) => item.permissions.includes(permission)))) {
    throw new Error("系统必须保留至少一个启用中的所有权限账户。");
  }
  if (id === actorId && !enabled) throw new Error("不能停用当前登录账户。");
  writeUser(candidate);
  return publicUser(candidate);
}

export async function resetPassword(id) {
  const stored = readUsers();
  const current = stored.find((item) => item.id === id);
  if (!current) throw new Error("用户不存在。");
  const credentials = await passwordFields(DEFAULT_PASSWORD);
  writeUser({ ...current, ...credentials, mustChangePassword: true, updatedAt: now() });
}

export function deleteUser(id, actorId) {
  if (id === actorId) throw new Error("不能删除当前登录账户。");
  const stored = readUsers();
  if (!stored.some((item) => item.id === id)) throw new Error("用户不存在。");
  const next = stored.filter((item) => item.id !== id);
  if (!next.some((item) => item.enabled && defaultPermissions.all.every((permission) => item.permissions.includes(permission)))) {
    throw new Error("系统必须保留至少一个启用中的所有权限账户。");
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
}

// ---------- bulk import (local -> remote migration) ----------
// Accepts full local user objects (including passwordHash/passwordSalt) so
// accounts keep their existing passwords after moving to the backend.
// Upserts by normalized login name; existing ids/createdAt/isPrimary survive.

export function importUsers(users) {
  if (!Array.isArray(users) || users.length === 0) throw new Error("没有可导入的用户。");
  if (users.length > 200) throw new Error("一次最多导入 200 个用户。");
  const timestamp = now();
  const finalById = new Map(readUsers().map((user) => [user.id, user]));
  const byNorm = new Map([...finalById.values()].map((user) => [normalizeLoginName(user.loginName), user.id]));
  const seen = new Set();
  for (const raw of users) {
    const loginName = String(raw?.loginName || "").trim();
    const name = String(raw?.name || "").trim();
    if (!loginName || !name) throw new Error("导入数据无效：用户缺少名称或登录名称。");
    const norm = normalizeLoginName(loginName);
    if (seen.has(norm)) throw new Error(`导入数据中登录名称重复：${loginName}`);
    seen.add(norm);
    if (typeof raw?.passwordHash !== "string" || !raw.passwordHash || typeof raw?.passwordSalt !== "string" || !raw.passwordSalt) {
      throw new Error(`用户 ${loginName} 缺少密码摘要，无法导入。`);
    }
    const permissions = Array.isArray(raw?.permissions) ? raw.permissions.filter((item) => allPermissions.includes(item)) : [];
    if (!permissions.length) throw new Error(`用户 ${loginName} 的权限无效。`);
    const existingId = byNorm.get(norm);
    if (existingId) {
      const existing = finalById.get(existingId);
      finalById.set(existingId, {
        ...existing,
        name, responsibility: String(raw?.responsibility || "").trim() || existing.responsibility,
        loginName, category: defaultPermissions[raw?.category] ? raw.category : existing.category,
        permissions, enabled: raw?.enabled !== false,
        mustChangePassword: Boolean(raw?.mustChangePassword),
        passwordHash: raw.passwordHash, passwordSalt: raw.passwordSalt,
        updatedAt: timestamp,
      });
    } else {
      const id = crypto.randomUUID();
      byNorm.set(norm, id);
      finalById.set(id, {
        id, name, responsibility: String(raw?.responsibility || "").trim() || "成员",
        loginName, category: defaultPermissions[raw?.category] ? raw.category : "partial",
        permissions, enabled: raw?.enabled !== false,
        mustChangePassword: Boolean(raw?.mustChangePassword),
        passwordHash: raw.passwordHash, passwordSalt: raw.passwordSalt,
        createdAt: typeof raw?.createdAt === "string" && raw.createdAt ? raw.createdAt : timestamp,
        updatedAt: timestamp, isPrimary: false,
      });
    }
  }
  const finalUsers = [...finalById.values()];
  if (!finalUsers.some((user) => user.enabled && defaultPermissions.all.every((permission) => user.permissions.includes(permission)))) {
    throw new Error("导入后系统必须保留至少一个启用中的所有权限账户。");
  }
  for (const user of finalUsers) writeUser(user);
  // Passwords may have changed -> invalidate every session and force re-login.
  db.prepare("DELETE FROM sessions").run();
  return users.length;
}
