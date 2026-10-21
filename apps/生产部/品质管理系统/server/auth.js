'use strict';
const crypto = require('node:crypto');

const MENUS = ['dashboard', 'records', 'review', 'analysis', 'suppliers', 'daily', 'weekly',
  'monthly', 'yearly', 'supplier-report', 'defectlib', 'import', 'users'];
const COLUMNS = ['v', 'e', 'a', 'm'];
class AuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new AuthError(status, message); };
const bit = v => v === true || v === 1;
function permissions(user) {
  const result = {};
  let override = user && user.perms;
  if (typeof override === 'string') { try { override = JSON.parse(override); } catch (_) { override = null; } }
  for (const menu of MENUS) {
    const role = user && user.role;
    let row = { v: 0, e: 0, a: 0, m: 0 };
    if (role === 'admin') row = { v: 1, e: 1, a: 1, m: 1 };
    if (role === 'manager') row = { v: 1,
      e: +['records', 'suppliers', 'defectlib', 'import'].includes(menu),
      a: +['records', 'review'].includes(menu), m: +['defectlib', 'import'].includes(menu) };
    if (role === 'viewer') row = {
      v: +['dashboard', 'records', 'review', 'analysis', 'suppliers', 'daily', 'weekly', 'monthly', 'yearly', 'supplier-report'].includes(menu),
      e: +(menu === 'records'), a: 0, m: 0 };
    if (role && ['admin', 'manager', 'viewer'].includes(role) && !(user.username === 'jc' && role === 'admin') &&
        override && !Array.isArray(override) && override[menu] && typeof override[menu] === 'object') {
      for (const col of COLUMNS) if (Object.hasOwn(override[menu], col)) row[col] = +bit(override[menu][col]);
    }
    result[menu] = row;
  }
  return result;
}
function can(user, menu, col) { return permissions(user)[menu]?.[col] === 1; }
function requirePermission(user, menu, col) {
  if (!can(user, menu, col)) fail(403, '当前账号无权限执行此操作');
}
function publicUser(user) {
  let source = user.perms;
  if (typeof source === 'string') { try { source = JSON.parse(source); } catch (_) { source = null; } }
  let overrides = null;
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    overrides = {};
    for (const menu of MENUS) if (Object.hasOwn(source, menu) && source[menu] && typeof source[menu] === 'object') {
      overrides[menu] = {};
      for (const col of COLUMNS) if (Object.hasOwn(source[menu], col)) overrides[menu][col] = +bit(source[menu][col]);
    }
  }
  if (!['admin', 'manager', 'viewer'].includes(user.role)) overrides = permissions(user);
  return { username: user.username, role: user.role, enabled: !!user.enabled,
    name: user.name || '', dept: user.dept || '', createdAt: user.createdAt || null,
    lastLoginAt: user.lastLoginAt || null, perms: overrides };
}
function equalSecret(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.length > 0 && b.length > 0 &&
    crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest());
}
function legacyHash(value) {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h) ^ value.charCodeAt(i);
  return (h >>> 0).toString(16);
}
function hashPassword(password, minimum = 6) {
  if (typeof password !== 'string' || password.length < minimum || password.length > 1024) fail(400, '密码长度须为6至1024个字符');
  const salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + crypto.scryptSync(password, salt, 32).toString('hex');
}
function checkPassword(password, stored) {
  if (typeof password !== 'string' || !password || password.length > 1024 || typeof stored !== 'string') return false;
  if (/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(stored)) {
    const [, salt, hash] = stored.split('$');
    return equalSecret(crypto.scryptSync(password, salt, 32).toString('hex'), hash);
  }
  return /^[a-f0-9]{1,8}$/.test(stored) && equalSecret(legacyHash(password), stored);
}
function validJSONRequest(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail(415, '请求须使用JSON格式');
  if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, '请求来源不允许');
  if (req.headers.origin) {
    let origin;
    try { origin = new URL(req.headers.origin); } catch (_) { fail(403, '请求来源不允许'); }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) fail(403, '请求来源不允许');
  }
}
function createSessions({ now = Date.now, lifetime = 12 * 60 * 60 * 1000 } = {}) {
  const sessions = new Map(), failures = new Map();
  const digest = s => crypto.createHash('sha256').update(s).digest('hex');
  function prune(map) { for (const [key, value] of map) if (value.expires <= now()) map.delete(key); }
  function cookieName(company) { return 'rr_qms_session_' + company.replace(/-/g, '_'); }
  function token(req, company) {
    const matches = String(req.headers.cookie || '').split(';').map(s => s.trim()).filter(s => s.startsWith(cookieName(company) + '='));
    if (matches.length !== 1) return null;
    const value = matches[0].slice(cookieName(company).length + 1);
    return /^[a-f0-9]{64}$/.test(value) ? value : null;
  }
  function cookie(res, req, company, value, age) {
    // The cookie is scoped by company name; no credentials are placed in localStorage.
    res.setHeader('Set-Cookie', cookieName(company) + '=' + value + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + age + (req.socket.encrypted ? '; Secure' : ''));
  }
  function clear(req, res, company) {
    const value = token(req, company); if (value) sessions.delete(digest(value));
    cookie(res, req, company, '', 0);
  }
  return {
    login(req, res, company, user) {
      prune(sessions); if (sessions.size >= 4096) fail(503, '登录会话繁忙，请稍后重试');
      const old = token(req, company); if (old) sessions.delete(digest(old));
      const value = crypto.randomBytes(32).toString('hex'), csrfToken = crypto.randomBytes(32).toString('hex');
      sessions.set(digest(value), { username: user.username, company, password: digest(user.password), expires: now() + lifetime, csrfToken });
      cookie(res, req, company, value, Math.floor(lifetime / 1000)); return csrfToken;
    },
    authenticate(req, company, lookup) {
      prune(sessions); const value = token(req, company), session = value && sessions.get(digest(value));
      if (!session || session.company !== company) fail(401, '请登录品质系统');
      const user = lookup(session.username);
      if (!user || !user.enabled || typeof user.password !== 'string' || !equalSecret(session.password, digest(user.password))) {
        sessions.delete(digest(value)); fail(401, '登录已失效，请重新登录');
      }
      return { user, csrfToken: session.csrfToken };
    },
    requireCSRF(req, session) { validJSONRequest(req); if (!equalSecret(req.headers['x-qc-csrf'], session.csrfToken)) fail(403, '请刷新页面后重试'); },
    revoke(company, username) {
      for (const [key, value] of sessions) if (value.company === company && value.username === username) sessions.delete(key);
    },
    clear,
    loginAttempt(req, company, username) {
      prune(failures); const key = digest(String(req.socket.remoteAddress) + '\0' + company + '\0' + username);
      const value = failures.get(key) || { count: 0, expires: now() + 15 * 60 * 1000 };
      if (value.count >= 10 || failures.size >= 10000 && !failures.has(key)) fail(429, '登录尝试过多，请稍后重试');
      value.count++; failures.set(key, value); return () => failures.delete(key);
    },
  };
}
module.exports = { MENUS, COLUMNS, AuthError, fail, can, permissions, publicUser, requirePermission,
  equalSecret, legacyHash, hashPassword, checkPassword, validJSONRequest, createSessions };
