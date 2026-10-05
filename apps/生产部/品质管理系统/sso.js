/* ══════════════════════════════════════════════════════════════
   员工门户 SSO 免登（2026-09 新增，多厂区版）
   URL 带 ?sso_ticket=<JWT> 时：
     1. 调用后端 /api/sso-verify 验票（HS256 + 有效期 + app 匹配）
     2. 验票通过：票据里的 companies 是该账号可访问厂区清单
        - 当前选中厂区不在清单内 → 切到第一个可访问厂区重来一次
        - 账号和会话写入每个可访问厂区的命名空间（切厂区不掉线）
     3. 失败：提示后回到正常账号密码登录
   必须在 qc-backend.js / app.js 之前加载。
══════════════════════════════════════════════════════════════ */
(function () {
  var ticket = new URLSearchParams(location.search).get('sso_ticket');
  if (!ticket) return;

  var COMPANY_KEY = 'xingxin_qms_company';
  var DEFAULT_COMPANY = 'dg-xingxin';

  /* 遮罩，避免登录页在验票期间闪现 */
  var mask = document.createElement('div');
  mask.style.cssText =
    'position:fixed;inset:0;background:#f4f6f8;z-index:99999;' +
    'display:flex;align-items:center;justify-content:center;' +
    'font:14px/1.6 -apple-system,"PingFang SC",sans-serif;color:#555;';
  mask.textContent = '门户免登中…';
  document.addEventListener('DOMContentLoaded', function () {
    if (document.body) document.body.appendChild(mask);
  });

  function done() {
    history.replaceState(null, '', location.pathname); /* 从地址栏移除票据 */
    if (mask.parentNode) mask.parentNode.removeChild(mask);
  }
  function fail(msg) {
    done();
    alert('门户免登失败：' + msg + '。请使用账号密码登录。');
  }
  function prefixOf(companyId) {
    return 'xingxin_qms_' + companyId + '_';
  }
  /* 把门户账号和会话写进指定厂区的命名空间 */
  function writeCompanySession(companyId, u, companies) {
    var prefix = prefixOf(companyId);
    var now = new Date().toISOString();
    var users = [];
    try { users = JSON.parse(localStorage.getItem(prefix + 'users')) || []; } catch (e) {}
    var rec = null;
    for (var i = 0; i < users.length; i++) {
      if (users[i].username === u.username) { rec = users[i]; break; }
    }
    if (!rec) {
      rec = { username: u.username, createdAt: now };
      users.push(rec);
    }
    rec.password = null; /* 密码置空：该账号只能从门户进入 */
    rec.role = u.role;
    rec.enabled = true;
    rec.name = u.name;
    rec.dept = u.dept;
    rec.perms = u.perms;
    rec.lastLoginAt = now;
    localStorage.setItem(prefix + 'users', JSON.stringify(users));
    localStorage.setItem(prefix + 'session', JSON.stringify({
      username: u.username,
      role: u.role,
      loginTime: now,
      companies: companies, /* 厂区选择器按此过滤（app.js companiesOf） */
    }));
  }

  window.addEventListener('load', function () {
    fetch('/api/sso-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: ticket }),
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok || !res.user) throw new Error((res && res.error) || '验票失败');
        var u = res.user;
        var companies = Array.isArray(res.companies) && res.companies.length
          ? res.companies
          : [DEFAULT_COMPANY];

        /* 当前选中厂区必须在授权清单内，否则切到第一个可访问厂区并重来 */
        var current = DEFAULT_COMPANY;
        try { current = localStorage.getItem(COMPANY_KEY) || DEFAULT_COMPANY; } catch (e) {}
        if (companies.indexOf(current) === -1) {
          localStorage.setItem(COMPANY_KEY, companies[0]);
          location.replace(location.pathname + '?sso_ticket=' + encodeURIComponent(ticket));
          return;
        }

        /* 每个可访问厂区都写入账号+会话：系统内切换厂区不会掉线 */
        companies.forEach(function (cid) { writeCompanySession(cid, u, companies); });

        done();
        if (typeof window._showApp === 'function') window._showApp();
      })
      .catch(function (e) { fail(e && e.message ? e.message : String(e)); });
  });
})();
