/* ══════════════════════════════════════════════════════════════
   兴信 QMS · 前端 ↔ 后端同步层  (qc-backend.js)
   ────────────────────────────────────────────────────────────
   必须在 app.js 之前加载（这样本文件的 DOMContentLoaded 处理器先执行）。

   做两件事：
     1【开机预加载】app.js 的 init 之前，同步拉取后端全量数据写入 localStorage，
        使 initData / initUsers / initDefectLib 直接读到服务器数据（多浏览器共享）。
     2【写穿透】劫持 persist / _saveUsers / _saveDefectLib 三个写入咽喉，
        本地写完后把全量推回后端落库。

   后端不可用时自动回退到本地 localStorage，离线也能用（只是不共享）。
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var PREFIX = 'xingxin_qms_';
  var KEY = {
    records:   PREFIX + 'records',
    users:     PREFIX + 'users',
    defectLib: PREFIX + 'defect_library',
  };

  /* API 基址：从当前页面路径推导，兼容根部署(/) 与子路径部署(/qc/)。
     根: '' → /api/...   子路径: '/qc' → /qc/api/...（nginx 会剥掉 /qc/ 前缀） */
  var API_BASE = (function () {
    var p = location.pathname.replace(/[^/]*$/, ''); // 取目录部分 '/qc/' 或 '/'
    return p.replace(/\/$/, '');                      // → '/qc' 或 ''
  })();

  window.__QC_BACKEND_OK = false;
  window.__QC_LAST_SYNC = null;

  /* ── 开机：同步 XHR 拉全量（必须同步，才能赶在 app.js 的 init 之前写好 localStorage）── */
  function syncBootstrap() {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', API_BASE + '/api/bootstrap', false); // 同步请求
      xhr.send(null);
      if (xhr.status !== 200) throw new Error('HTTP ' + xhr.status);
      var data = JSON.parse(xhr.responseText);

      // records → app.js 的 state 形态 { records, nextId }
      localStorage.setItem(KEY.records, JSON.stringify({
        records: Array.isArray(data.records) ? data.records : [],
        nextId:  data.nextId || 31,
      }));
      if (Array.isArray(data.users))     localStorage.setItem(KEY.users,     JSON.stringify(data.users));
      if (Array.isArray(data.defectLib)) localStorage.setItem(KEY.defectLib, JSON.stringify(data.defectLib));

      window.__QC_BACKEND_OK = true;
      console.log('[QC后端] 预加载成功：记录', (data.records || []).length,
        '账号', (data.users || []).length, '不良库', (data.defectLib || []).length);
    } catch (e) {
      window.__QC_BACKEND_OK = false;
      console.warn('[QC后端] 预加载失败，回退本地缓存（离线模式）：', e.message);
    }
  }

  /* ── 写穿透：把本地写入推回后端 ── */
  function post(url, body) {
    if (window.__QC_BACKEND_OK !== true) return Promise.resolve(false); // 后端不可用时不尝试，避免拖慢
    try {
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(function (r) {
        window.__QC_LAST_SYNC = { url: url, ok: r.ok, status: r.status, time: new Date().toISOString() };
        if (!r.ok) console.warn('[QC后端] 写回非200:', url, r.status);
        return r.ok;
      }).catch(function (err) {
        window.__QC_LAST_SYNC = { url: url, ok: false, error: err && err.message, time: new Date().toISOString() };
        console.warn('[QC后端] 写回失败:', url, err && err.message);
        return false;
      });
    } catch (e) {
      window.__QC_LAST_SYNC = { url: url, ok: false, error: e && e.message, time: new Date().toISOString() };
      console.warn('[QC后端] 写回异常:', url, e && e.message);
      return Promise.resolve(false);
    }
  }

  function pushRecords() {
    try {
      var st = JSON.parse(localStorage.getItem(KEY.records) || '{}');
      return post(API_BASE + '/api/records', { records: st.records || [] });
    } catch (e) { console.warn('[QC后端] 读本地记录失败', e); }
    return Promise.resolve(false);
  }
  function pushUsers(users) {
    var u = users;
    if (!Array.isArray(u)) { try { u = JSON.parse(localStorage.getItem(KEY.users) || '[]'); } catch (e) { u = []; } }
    return post(API_BASE + '/api/users', { users: u });
  }
  function pushDefects(lib) {
    var l = lib;
    if (!Array.isArray(l)) { try { l = JSON.parse(localStorage.getItem(KEY.defectLib) || '[]'); } catch (e) { l = []; } }
    return post(API_BASE + '/api/defects', { defectLib: l });
  }

  /* ── 劫持 app.js 的三个写入函数（此时 app.js 已解析，函数已挂到 window）── */
  function patchWriters() {
    var patched = false;
    if (typeof window.persist === 'function' && !window.persist.__qcPatched) {
      var origPersist = window.persist;
      window.persist = function () {
        var ret = origPersist.apply(this, arguments);
        pushRecords();
        return ret;
      };
      window.persist.__qcPatched = true;
      patched = true;
    }
    if (typeof window._saveUsers === 'function' && !window._saveUsers.__qcPatched) {
      var origUsers = window._saveUsers;
      window._saveUsers = function (users) {
        var ret = origUsers.apply(this, arguments);
        pushUsers(users);
        return ret;
      };
      window._saveUsers.__qcPatched = true;
      patched = true;
    }
    if (typeof window._saveDefectLib === 'function' && !window._saveDefectLib.__qcPatched) {
      var origDef = window._saveDefectLib;
      window._saveDefectLib = function (lib) {
        var ret = origDef.apply(this, arguments);
        pushDefects(lib);
        return ret;
      };
      window._saveDefectLib.__qcPatched = true;
      patched = true;
    }
    if (patched) console.log('[QC后端] 写入函数已接管');
    return patched;
  }

  function schedulePatchWriters() {
    patchWriters();
    setTimeout(patchWriters, 0);
    setTimeout(patchWriters, 300);
    setTimeout(patchWriters, 1000);
    setTimeout(patchWriters, 2500);
  }

  window.__QC_SYNC_NOW = function () {
    patchWriters();
    return pushRecords();
  };

  /* 本文件早于 app.js 加载：立即预加载，确保 app.js 初始化前 localStorage 已是服务器数据 */
  syncBootstrap();

  /* app.js 解析完成后反复接管写入函数，避免线上脚本时序导致只改本地不写服务器 */
  document.addEventListener('DOMContentLoaded', function () {
    schedulePatchWriters();
  });
})();
