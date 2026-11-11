/* ══════════════════════════════════════════════════════════════
   兴信 QMS · 前端 ↔ 后端同步层  (qc-backend.js)
   ────────────────────────────────────────────────────────────
   必须在 app.js 之前加载（这样本文件的 DOMContentLoaded 处理器先执行）。

   做两件事：
     1【开机预加载】app.js 的 init 之前，同步拉取后端全量数据写入 localStorage，
        使 initData / initUsers / initDefectLib 直接读到服务器数据（多浏览器共享）。
     2【数据同步】记录、名单及不良库写入后排队同步；账号操作等服务器确认。

   服务器会话决定登录及权限；本地缓存不能建立会话。写入失败保留本地草稿并明确提示。
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 多厂区/子公司：当前子公司决定 localStorage 命名空间与 API 目标库 ──
     每家子公司一套独立数据（服务端 server/data/<companyId>/qc.db）。
     选择结果存在固定 key（不带公司前缀），切换子公司 = 改这个 key + 刷新页面 */
  var COMPANY_KEY = 'xingxin_qms_company';
  var COMPANY = 'dg-xingxin';
  /* 旧版兼容：早期按厂区名存的值映射到该厂区默认子公司 */
  var LEGACY = { dongguan: 'dg-xingxin', heyuan: 'hy-huakang-a', hunan: 'sy-huadeng' };
  try {
    COMPANY = localStorage.getItem(COMPANY_KEY) || 'dg-xingxin';
    if (LEGACY[COMPANY]) { COMPANY = LEGACY[COMPANY]; localStorage.setItem(COMPANY_KEY, COMPANY); }
  } catch (e) {}
  window.__QC_COMPANY = COMPANY;
  window.__QC_COMPANY_KEY = COMPANY_KEY;
  window.__QC_STORAGE_PREFIX = 'xingxin_qms_' + COMPANY + '_';

  var PREFIX = window.__QC_STORAGE_PREFIX;
  var KEY = {
    records:   PREFIX + 'records',
    users:     PREFIX + 'users',
    defectLib: PREFIX + 'defect_library',
    partners:  PREFIX + 'partners',
  };

  /* API 基址：从当前页面路径推导，兼容根部署(/) 与子路径部署(/qc/)。
     根: '' → /api/...   子路径: '/qc' → /qc/api/...（nginx 会剥掉 /qc/ 前缀） */
  var API_BASE = (function () {
    var p = location.pathname.replace(/[^/]*$/, ''); // 取目录部分 '/qc/' 或 '/'
    return p.replace(/\/$/, '');                      // → '/qc' 或 ''
  })();

  window.__QC_BACKEND_OK = false;
  window.__QC_AUTH = null;
  window.__QC_LAST_SYNC = null;
  var failedWrites = Object.create(null);

  function publicUser(user) {
    var copy = Object.assign({}, user);
    delete copy.password;
    delete copy.newPassword;
    return copy;
  }
  function notice(message, error) {
    if (blockedRecovery && recoveryIsCurrent() && message && message.indexOf('草稿') === -1) { message = recoveryMessage(); error = true; }
    window.__QC_SYNC_NOTICE = message;
    /* 例行成功不弹 toast：应用自身已有「记录已添加 ✓」等提示，
       同步层的「服务器已保存修改」会把它覆盖掉。错误状态照常提示。 */
    if (error && typeof window.showToast === 'function') window.showToast(message, 'error');
    var banner = document.getElementById('qcSyncNotice');
    if (!banner && document.body && document.createElement) {
      banner = document.createElement('div');
      banner.id = 'qcSyncNotice';
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      banner.style.cssText = 'position:fixed;bottom:12px;left:12px;right:12px;z-index:99990;padding:12px 16px;border-radius:8px;background:var(--bg-card,#fff);color:var(--text-hi,#18212f);border:1px solid var(--border,#b7c0cc);font:14px/1.5 sans-serif;';
      document.body.appendChild(banner);
    }
    if (banner) {
      banner.textContent = message;
      /* 例行「服务器已保存修改」不占用底部横幅：全宽横幅会盖住右下角的操作提示（toast）。
         横幅只留给错误/草稿等需要用户处理的状态。 */
      banner.style.display = (message && error) ? '' : 'none';
      var hasRecordFailure = Object.keys(failedWrites).some(function (url) { return url.indexOf('/api/records') !== -1; });
      if (error && blockedRecovery && document.createElement) {
        ['下载原草稿', '放弃待恢复草稿'].forEach(function (label, index) {
          var button = document.createElement('button');
          button.type = 'button'; button.textContent = label; button.className = 'btn-secondary'; button.style.marginLeft = '12px';
          button.onclick = index ? discardBlockedDraft : downloadBlockedDraft;
          banner.appendChild(button);
        });
      } else if (error && hasRecordFailure && document.createElement) {
        var retry = document.createElement('button');
        retry.type = 'button'; retry.textContent = '重试同步'; retry.className = 'btn-primary'; retry.style.marginLeft = '12px';
        retry.onclick = function () { window.__QC_SYNC_NOW(); };
        banner.appendChild(retry);
      }
    }
  }
  function clearAuth(message) {
    window.__QC_AUTH = null;
    window.__QC_BACKEND_OK = false;
    notice('', false);
    try { localStorage.removeItem(PREFIX + 'session'); localStorage.removeItem('xingxin_qms_switch_ticket'); } catch (_) {}
    window.__QC_AUTH_NOTICE = message || '请使用当前公司的品质账号登录';
    if (typeof window._showLogin === 'function') window._showLogin();
  }
  function acceptAuth(data) {
    if (!data || !data.user || typeof data.user.username !== 'string' || data.user.enabled !== true ||
        !Array.isArray(data.companies) || data.companies.indexOf(COMPANY) === -1 ||
        typeof data.csrfToken !== 'string' || !data.csrfToken) throw new Error('服务器会话无效，请重新登录');
    window.__QC_AUTH = { user: publicUser(data.user), companies: data.companies.slice(), csrfToken: data.csrfToken, company: COMPANY };
    window.__QC_BACKEND_OK = true;
    window.__QC_AUTH_NOTICE = '';
    try { localStorage.removeItem(PREFIX + 'session'); } catch (_) {}
    return window.__QC_AUTH;
  }
  function apiUrl(path) {
    return API_BASE + path + (path.indexOf('?') === -1 ? '?' : '&') + 'company=' + encodeURIComponent(COMPANY);
  }
  window.__QC_ACCEPT_AUTH = acceptAuth;
  window.__QC_CLEAR_AUTH = clearAuth;
  window.__QC_API_URL = apiUrl;
  window.__QC_REQUEST = function (path, options) {
    if (window.__QC_MAINTENANCE && window.__QC_MAINTENANCE.blocked) return Promise.reject(new Error(window.__QC_MAINTENANCE.message || '系统修复中，暂时无法操作'));
    options = Object.assign({}, options || {});
    options.credentials = 'same-origin';
    options.cache = 'no-store';
    options.headers = Object.assign({}, options.headers || {});
    if (window.__QC_AUTH) options.headers['X-QC-CSRF'] = window.__QC_AUTH.csrfToken;
    if (options.method && !/^(GET|HEAD)$/i.test(options.method)) {
      if (!window.__QC_AUTH) return Promise.reject(new Error('请先登录当前公司'));
      options.headers['X-QC-CSRF'] = window.__QC_AUTH.csrfToken;
    }
    var requestAuth = window.__QC_AUTH;
    return fetch(apiUrl(path), options).then(function (res) {
      if (res.headers && res.headers.get('X-QC-Maintenance') === '1' && window.__QC_MAINTENANCE) window.__QC_MAINTENANCE.activate();
      if (window.__QC_AUTH === requestAuth && res.status === 401) clearAuth('登录已失效，请重新登录');
      return res;
    });
  };
  window.__QC_REFRESH_SESSION = function () {
    var requestAuth = window.__QC_AUTH;
    return window.__QC_REQUEST('/api/session').then(function (res) {
      if (!res.ok) throw new Error('会话验证失败');
      return res.json();
    }).then(function (data) { return window.__QC_AUTH === requestAuth ? acceptAuth(data) : window.__QC_AUTH; })
      .catch(function (err) { if (window.__QC_AUTH === requestAuth) clearAuth(err.message); throw err; });
  };
  window.__QC_LOGIN = function (username, password) {
    return fetch(apiUrl('/api/login'), { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: username, password: password })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || (res.status === 429 ? '登录尝试过多，请稍后重试' : '用户名或密码错误'));
        acceptAuth(data);
        if (!syncBootstrap()) throw new Error('登录后数据加载失败，请重试登录');
        return window.__QC_AUTH;
      });
    }).catch(function (err) { clearAuth(); throw err; });
  };
  window.__QC_LOGOUT = function () {
    return window.__QC_REQUEST('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (res) { if (!res.ok && res.status !== 401) throw new Error('退出失败，请重试'); clearAuth('已退出，请使用品质账号登录'); });
  };

  /* 待删除记录 id 队列：app.js 删除记录时标记，下次推送时带给服务端按 id 删除。
     （服务端已改为按 id 合并写入，不再全量替换，删除必须显式告知） */
  window.__QC_PENDING_DELETES = [];
  var deleteRevisions = Object.create(null);
  var nextDeleteRevision = 0;
  var recordPushQueue = Promise.resolve();
  var recordRevision = 0;
  var recordToken = null;
  function newRecordToken() { return window.crypto && typeof window.crypto.randomUUID === 'function' ? window.crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2); }
  var recordQueueEpoch = 0;
  var draftOwner = null;
  var recordBaseline = null;
  var recordBaselineSignatures = Object.create(null);
  var blockedRecovery = null;
  window.__QC_DRAFT_RECOVERY_BLOCKED = false;
  function baselineOf(st) {
    var versions = Object.create(null);
    (st.records || []).forEach(function (r) { versions[r.id] = r.updatedAt == null ? null : r.updatedAt; });
    return { versions: versions, nextId: st.nextId };
  }
  // Match the persisted columns, including SQLite's numeric and nullable values.
  function recordSignature(record, creation, ignoreVersion) {
    var fields = ['id','date','inspDate','supplier','client','processType','productNo','productName',
      'deliveryNo','orderNo','type','qty','sampleQty','pass','fail','defectRate','result','result2',
      'defect','defects','measurements','qc','confirmBy','remark','orderQty','updatedAt',
      'status','reviewBy','reviewAt','rejectReason','rejectBy','rejectAt','aqlLevel'];
    var numeric = ['id','qty','sampleQty','pass','fail','orderQty'];
    return JSON.stringify(fields.map(function (key) {
      var value = record[key];
      if (key === 'updatedAt' && ignoreVersion) return null;
      if (key === 'status' && creation) return value || 'pending';
      if (creation && (!record.status || record.status === 'pending') &&
          ['reviewBy','reviewAt','rejectReason','rejectBy','rejectAt'].indexOf(key) !== -1) return value == null ? '' : String(value);
      if (key === 'defects' || key === 'measurements') return Array.isArray(value) ? value : value ? [value] : [];
      if (numeric.indexOf(key) !== -1) return value == null || value === '' ? null : Number(value);
      return value == null ? null : String(value);
    }), function (key, value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      var sorted = Object.create(null);
      Object.keys(value).sort().forEach(function (name) { sorted[name] = value[name]; });
      return sorted;
    });
  }
  function committedReviewRetry(record, current) {
    if (!current || ['approved', 'rejected'].indexOf(record.status) === -1 || record.status !== current.status ||
        typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt)) ||
        record.updatedAt !== current.updatedAt) return false;
    var actorField = record.status === 'approved' ? 'reviewBy' : 'rejectBy';
    var timeField = record.status === 'approved' ? 'reviewAt' : 'rejectAt';
    var user = window.__QC_AUTH && window.__QC_AUTH.user;
    var actor = user && (user.name || user.username);
    if (!actor || record[actorField] !== actor || current[actorField] !== actor ||
        typeof record[timeField] !== 'string' || !Number.isFinite(Date.parse(record[timeField])) ||
        typeof current[timeField] !== 'string' || !Number.isFinite(Date.parse(current[timeField])) ||
        record[timeField] === current[timeField]) return false;
    var expected = Object.assign({}, record);
    expected[timeField] = current[timeField];
    return recordSignature(expected) === recordSignature(current);
  }
  function pendingRecordChanges(st) {
    var versions = recordBaseline && recordBaseline.versions || Object.create(null);
    return (st.records || []).filter(function (row) {
      return !Object.prototype.hasOwnProperty.call(versions, row.id) ||
        versions[row.id] !== (row.updatedAt == null ? null : row.updatedAt) ||
        recordBaselineSignatures[row.id] !== recordSignature(row);
    });
  }
  function sameBaseline(baseline, st, replacement) {
    if (!baseline || !baseline.versions || typeof baseline.versions !== 'object') return false;
    var current = baselineOf(st), ids = Object.keys(baseline.versions);
    if (replacement && (ids.length !== Object.keys(current.versions).length || baseline.nextId !== st.nextId)) return false;
    return ids.every(function (id) { return Object.prototype.hasOwnProperty.call(current.versions, id) && current.versions[id] === baseline.versions[id]; });
  }
  function recoveryMessage() {
    return '当前公司、账号「' + (blockedRecovery ? blockedRecovery.owner : '') + '」的验货草稿与服务器记录存在冲突或缺少原始断点，已显示服务器最新数据并保留原草稿；验货修改和重试已暂停。请先下载原草稿核对，或明确放弃待恢复草稿；不会覆盖或恢复已删除记录。' +
      (blockedRecovery && !blockedRecovery.backupKey ? ' 独立备份未写入，原草稿仍保留，请勿清理浏览器数据。' : '');
  }
  function recoveryIsCurrent() {
    return blockedRecovery && window.__QC_AUTH && window.__QC_AUTH.company === COMPANY && window.__QC_AUTH.user.username === blockedRecovery.owner;
  }
  function blockDraftRecovery(draft, originalRaw) {
    var raw = originalRaw || JSON.stringify(draft), key = draftKey(draft.owner) + '_conflict_' + encodeURIComponent(draft.token || newRecordToken());
    blockedRecovery = { owner: draft.owner, raw: raw, backupKey: null };
    // Backups are immutable. Keep the original pending key too until an explicit discard.
    try {
      var previous = localStorage.getItem(key);
      if (previous && previous !== raw) key += '_' + newRecordToken();
      if (!localStorage.getItem(key)) localStorage.setItem(key, raw);
      if (localStorage.getItem(key) === raw) blockedRecovery.backupKey = key;
    } catch (_) {}
    window.__QC_DRAFT_RECOVERY_BLOCKED = true;
    notice(recoveryMessage(), true);
  }
  function draftDownloadPackage(raw) {
    var draft = JSON.parse(raw.replace(/^\uFEFF/, ''));
    if (!draft || !draft.state || !Array.isArray(draft.state.records) ||
        !blockedRecovery || draft.owner !== blockedRecovery.owner || draft.company !== COMPANY) {
      throw new Error('原草稿的公司、账号或记录格式无效');
    }
    // 顶层 records 与普通 JSON 备份一致，旧版“导入 JSON”也能识别。
    // 完整原文另存，断点和删除队列只供核对，不在人工导入时执行。
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      source: '兴信 QMS 未同步验货草稿',
      backupType: 'pending-records',
      company: COMPANY,
      owner: draft.owner,
      count: draft.state.records.length,
      records: draft.state.records,
      draftRecovery: { originalRaw: raw }
    };
  }
  function downloadBlockedDraft() {
    if (!recoveryIsCurrent()) return false;
    try {
      var content = blockedRecovery.raw, converted = false;
      try {
        content = JSON.stringify(draftDownloadPackage(content), null, 2);
        converted = true;
      } catch (_) { /* 损坏草稿仍须允许下载原文，不影响已有备份保护。 */ }
      var blob = new Blob([content], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = '品质未同步草稿-' + COMPANY + '-' + blockedRecovery.owner + '.json';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      if (!converted) notice(recoveryMessage() + ' 已下载原始草稿；内容不完整，暂不能作为备份导入。', true);
      return true;
    } catch (_) { notice(recoveryMessage() + ' 下载失败，请保留此页面并联系管理员。', true); return false; }
  }
  function discardBlockedDraft() {
    if (!recoveryIsCurrent() || !window.confirm('确定放弃当前公司、账号「' + blockedRecovery.owner + '」的这份待恢复草稿？服务器记录不会改变。请先下载并核对原草稿。')) return false;
    var recovery = blockedRecovery, key = draftKey(recovery.owner), volatile = volatileRecordDrafts[recovery.owner];
    try {
      var stored = localStorage.getItem(key);
      if (volatile && JSON.stringify(volatile.draft) !== recovery.raw) throw new Error('draft changed');
      if (!volatile && stored !== recovery.raw) throw new Error('draft changed');
      // A newer draft from another tab must never be cleared by this page.
      if (stored && stored !== recovery.raw) {
        var prior = JSON.parse(stored);
        if (!volatile || prior.token !== volatile.previousToken || prior.revision !== volatile.previousRevision) throw new Error('draft changed');
      }
      if (stored) localStorage.removeItem(key);
      delete volatileRecordDrafts[recovery.owner]; updateUnloadGuard();
      blockedRecovery = null; window.__QC_DRAFT_RECOVERY_BLOCKED = false;
      location.reload(); return true;
    } catch (_) { notice(recoveryMessage() + ' 草稿已在其他页面变化，未清除；请重新加载后核对。', true); return false; }
  }
  window.__QC_DOWNLOAD_BLOCKED_DRAFT = downloadBlockedDraft;
  window.__QC_DISCARD_BLOCKED_DRAFT = discardBlockedDraft;
  // Storage quota failures still need an owner-bound copy during this page's life.
  // This is not durable storage: leaving the page must warn until it is saved.
  var volatileRecordDrafts = Object.create(null);
  var unloadGuardInstalled = false;
  function warnUnprotectedDraft(event) {
    if (!Object.keys(volatileRecordDrafts).length) return;
    event.preventDefault(); event.returnValue = '';
    return '';
  }
  function updateUnloadGuard() {
    var needed = Object.keys(volatileRecordDrafts).length > 0;
    if (needed && !unloadGuardInstalled) {
      window.addEventListener('beforeunload', warnUnprotectedDraft);
      unloadGuardInstalled = true;
    } else if (!needed && unloadGuardInstalled) {
      window.removeEventListener('beforeunload', warnUnprotectedDraft);
      unloadGuardInstalled = false;
    }
  }
  function currentVolatileDraft() {
    var owner = window.__QC_AUTH && window.__QC_AUTH.user.username;
    return owner && volatileRecordDrafts[owner];
  }
  function draftKey(owner) { return PREFIX + 'pending_records_' + encodeURIComponent(owner); }
  function saveRecordDraft(owner) {
    if (!owner || !window.__QC_AUTH || window.__QC_AUTH.user.username !== owner) return false;
    var draft, previous;
    try {
      var state = JSON.parse(localStorage.getItem(KEY.records) || '{}');
      draft = { owner: owner, company: COMPANY, revision: recordRevision, token: recordToken,
        state: state, baseline: recordBaseline, changedIds: pendingRecordChanges(state).map(function (row) { return row.id; }), deletedIds: window.__QC_PENDING_DELETES.slice(),
        deleteRevisions: Object.assign({}, deleteRevisions), nextDeleteRevision: nextDeleteRevision, replacement: window.__QC_FORCE_REPLACE || false };
      try { previous = JSON.parse(localStorage.getItem(draftKey(owner)) || 'null'); } catch (_) {}
      localStorage.setItem(draftKey(owner), JSON.stringify(draft));
      delete volatileRecordDrafts[owner]; updateUnloadGuard();
      return true;
    } catch (_) {
      if (draft) {
        volatileRecordDrafts[owner] = { draft: draft, previousToken: previous && previous.token, previousRevision: previous && previous.revision };
        updateUnloadGuard();
      }
      notice('本地草稿备份失败，未同步记录仅保留在当前页面；请勿关闭或刷新，并检查浏览器存储空间。', true);
      return false;
    }
  }
  function restoreRecordDraft(serverState) {
    recordQueueEpoch++;
    var owner = window.__QC_AUTH.user.username;
    var changedOwner = draftOwner !== owner;
    draftOwner = owner;
    blockedRecovery = null; window.__QC_DRAFT_RECOVERY_BLOCKED = false;
    if (changedOwner) { failedWrites = Object.create(null); notice('', false); }
    window.__QC_PENDING_DELETES = []; deleteRevisions = Object.create(null); nextDeleteRevision = 0;
    window.__QC_FORCE_REPLACE = false; recordRevision = 0; recordToken = null;
    try {
      var volatile = volatileRecordDrafts[owner];
      var originalRaw = volatile ? JSON.stringify(volatile.draft) : localStorage.getItem(draftKey(owner));
      var draft = originalRaw ? JSON.parse(originalRaw) : null;
      recordBaseline = baselineOf(serverState);
      recordBaselineSignatures = Object.create(null);
      serverState.records.forEach(function (row) { recordBaselineSignatures[row.id] = recordSignature(row); });
      if (!draft || draft.owner !== owner || draft.company !== COMPANY) return;
      if (!draft.state || !Array.isArray(draft.state.records)) { blockDraftRecovery(draft, originalRaw); return; }
      var serverById = Object.create(null), indexOfId = Object.create(null), merged = serverState.records.slice();
      merged.forEach(function (r, i) { serverById[r.id] = r; indexOfId[r.id] = i; });
      var conflict = !draft.baseline || !draft.baseline.versions ||
        typeof draft.baseline.versions !== 'object' || Array.isArray(draft.baseline.versions);
      if (draft.replacement && !sameBaseline(draft.baseline, serverState, true)) conflict = true;
      var baseline = draft.baseline && draft.baseline.versions || Object.create(null);
      var changedIds = draft.changedIds === undefined ? [] : draft.changedIds;
      if (!Array.isArray(changedIds) || changedIds.some(function (id) { return !Number.isSafeInteger(id) || id <= 0; })) {
        conflict = true; changedIds = [];
      }
      var deleted = (Array.isArray(draft.deletedIds) ? draft.deletedIds : []).filter(function (id) { return Number.isSafeInteger(id) && id > 0; });
      var changes = [];
      var seen = new Set();
      draft.state.records.forEach(function (r) {
        if (!Number.isSafeInteger(r.id) || r.id <= 0 || seen.has(r.id)) { conflict = true; return; }
        seen.add(r.id);
        if (draft.replacement || deleted.indexOf(r.id) !== -1) return;
        var hasBaseline = Object.prototype.hasOwnProperty.call(baseline, r.id);
        var current = serverById[r.id];
        var changed = !hasBaseline || baseline[r.id] !== (r.updatedAt == null ? null : r.updatedAt) || changedIds.indexOf(r.id) !== -1;
        if (!changed) {
          // Old drafts have only timestamps. A same-version content difference
          // cannot safely be interpreted as either a saved row or a local edit.
          if (current && baseline[r.id] === (current.updatedAt == null ? null : current.updatedAt) &&
              recordSignature(r) !== recordSignature(current)) conflict = true;
          return;
        }
        // Keep the submitted review pending until the API rechecks permissions
        // and confirms the canonical server audit; bootstrap alone is not an ACK.
        if (committedReviewRetry(r, current)) { changes.push(r); return; }
        if (current && recordSignature(r, !hasBaseline, true) === recordSignature(current, false, true)) return;
        if (hasBaseline && (!current || baseline[r.id] !== (current.updatedAt == null ? null : current.updatedAt)) ||
            !hasBaseline && current) { conflict = true; return; }
        changes.push(r);
      });
      if (changedIds.some(function (id) { return !seen.has(id); })) conflict = true;
      if (!draft.replacement) deleted.forEach(function (id) {
        var current = serverById[id];
        if (current && (!Object.prototype.hasOwnProperty.call(baseline, id) ||
            baseline[id] !== (current.updatedAt == null ? null : current.updatedAt))) conflict = true;
      });
      if (conflict) { blockDraftRecovery(draft, originalRaw); return; }
      // Baseline IDs and exact server revisions prove these edits are still applicable.
      // An absent baseline row is never interpreted as a new unsynced record.
      if (draft.replacement) merged = draft.state.records.slice();
      else {
        changes.forEach(function (r) {
          if (Object.prototype.hasOwnProperty.call(indexOfId, r.id)) merged[indexOfId[r.id]] = r;
          else merged.push(r);
        });
        merged = merged.filter(function (r) { return deleted.indexOf(r.id) === -1; });
      }
      localStorage.setItem(KEY.records, JSON.stringify({ records: merged,
        nextId: Math.max(Number(serverState.nextId) || 31, Number(draft.state.nextId) || 31, merged.reduce(function (n, r) { return Math.max(n, r.id + 1); }, 31)) }));
      recordToken = typeof draft.token === 'string' ? draft.token : newRecordToken();
      recordRevision = Number.isSafeInteger(draft.revision) && draft.revision > 0 ? draft.revision : 1;
      nextDeleteRevision = Number.isSafeInteger(draft.nextDeleteRevision) ? draft.nextDeleteRevision : 0;
      deleted.forEach(function (id) {
        window.__QC_PENDING_DELETES.push(id);
        var rev = draft.deleteRevisions && draft.deleteRevisions[id];
        deleteRevisions[id] = Number.isSafeInteger(rev) ? rev : ++nextDeleteRevision;
        nextDeleteRevision = Math.max(nextDeleteRevision, deleteRevisions[id]);
      });
      window.__QC_FORCE_REPLACE = draft.replacement || false;
      failedWrites[apiUrl('/api/records')] = true;
      notice(volatile
        ? '当前账号有未同步验货记录，仅保留在当前页面，本地草稿备份不可用。请勿关闭或刷新，核对后点击“重试同步”；系统不会自动重发。'
        : '当前账号有未同步的本地验货草稿，已保留。请核对后点击“重试同步”，系统不会自动重发。', true);
    } catch (_) {
      if (originalRaw) blockDraftRecovery(draft || { owner: owner }, originalRaw);
      else notice('本地草稿读取失败，请保留浏览器数据并联系管理员。', true);
    }
  }
  window.__QC_MARK_DELETED = function (ids) {
    if (!Array.isArray(ids)) return;
    var previous = [];
    for (var i = 0; i < ids.length; i++) {
      var n = Number(ids[i]) || 0;
      if (!n) continue;
      previous.push({ id: n, revision: deleteRevisions[n], marked: nextDeleteRevision + 1 });
      deleteRevisions[n] = ++nextDeleteRevision;
      if (window.__QC_PENDING_DELETES.indexOf(n) === -1) window.__QC_PENDING_DELETES.push(n);
    }
    /* 主记录持久化失败时撤回本轮标记，不撤销此前或后来操作的删除请求。 */
    return function () {
      previous.reverse().forEach(function (entry) {
        if (deleteRevisions[entry.id] !== entry.marked) return;
        if (entry.revision !== undefined) deleteRevisions[entry.id] = entry.revision;
        else {
          delete deleteRevisions[entry.id];
          window.__QC_PENDING_DELETES = window.__QC_PENDING_DELETES.filter(function (id) { return id !== entry.id; });
        }
      });
    };
  };

  /* ── 开机：同步 XHR 拉全量（必须同步，才能赶在 app.js 的 init 之前写好 localStorage）── */
  function syncBootstrap() {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', apiUrl('/api/bootstrap'), false);
      xhr.send(null);
      if (xhr.status === 503 && xhr.getResponseHeader && xhr.getResponseHeader('X-QC-Maintenance') === '1') {
        if (window.__QC_MAINTENANCE) window.__QC_MAINTENANCE.activate();
        return false;   /* 不清会话、不覆盖本地草稿。 */
      }
      if (xhr.status !== 200) throw new Error(xhr.status === 401 ? '请使用当前公司的品质账号登录' : '数据加载失败，请重新登录');
      var data = JSON.parse(xhr.responseText);
      acceptAuth(data);
      if (!Array.isArray(data.records)) throw new Error('服务器数据格式不正确');
      var serverState = { records: data.records, nextId: data.nextId || 31 };
      localStorage.setItem(KEY.records, JSON.stringify(serverState));
      localStorage.setItem(KEY.users, JSON.stringify(Array.isArray(data.users) ? data.users.map(publicUser) : []));
      if (Array.isArray(data.defectLib)) localStorage.setItem(KEY.defectLib, JSON.stringify(data.defectLib));
      if (Array.isArray(data.partners)) localStorage.setItem(KEY.partners, JSON.stringify(data.partners));
      restoreRecordDraft(serverState);
      return true;
    } catch (e) {
      clearAuth(e.message);
      console.warn('[QC后端] 会话数据未加载:', e.message);
      return false;
    }
  }
  window.__QC_BOOTSTRAP = syncBootstrap;

  /* ── 写穿透：把本地写入推回后端 ── */
  function post(url, body, confirmResponse) {
    if (window.__QC_MAINTENANCE && window.__QC_MAINTENANCE.blocked) return Promise.resolve(false);
    function completed(ok, status, error) {
      window.__QC_LAST_SYNC = { url: url, ok: ok, status: status, error: error, time: new Date().toISOString() };
      if (ok) {
        delete failedWrites[url];
        if (url.indexOf('/api/records') !== -1) { delete failedWrites[apiUrl('/api/records')]; delete failedWrites[apiUrl('/api/records/replace')]; }
      } else failedWrites[url] = true;
      if (Object.keys(failedWrites).length) notice('服务器尚未保存部分修改。请保留此页面，检查连接和权限后重新保存；验货记录可重试同步。' +
        (currentVolatileDraft() ? ' 本地草稿备份不可用，请勿关闭或刷新。' : ''), true);
      else if (currentVolatileDraft()) notice('验货记录正在确认同步，本地草稿备份不可用，请保留此页面。', true);
      else notice('服务器已保存修改', false);
      return ok;
    }
    if (!window.__QC_AUTH || window.__QC_BACKEND_OK !== true) return Promise.resolve(completed(false, 401));
    notice(currentVolatileDraft() ? '正在同步服务器，本地草稿备份不可用，请保留此页面。' : '修改已在本地暂存，正在同步服务器…', !!currentVolatileDraft());
    var requestAuth = window.__QC_AUTH;
    try {
      return fetch(url, { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-QC-CSRF': window.__QC_AUTH.csrfToken }, body: JSON.stringify(body)
      }).then(function (r) {
        if (r.headers && r.headers.get('X-QC-Maintenance') === '1' && window.__QC_MAINTENANCE) window.__QC_MAINTENANCE.activate();
        if (window.__QC_AUTH !== requestAuth) return false;
        if (r.status === 401) clearAuth('登录已失效，请重新登录；未同步修改仍保留在本地');
        if (r.ok && confirmResponse) {
          if (typeof r.json !== 'function') return completed(false, r.status, '服务器未返回逐条保存确认');
          return r.json().then(function (data) {
            if (window.__QC_AUTH !== requestAuth) return false;
            var confirmed = confirmResponse(data);
            return completed(confirmed, r.status, confirmed ? undefined : '服务器未确认全部修改，草稿已保留');
          });
        }
        return completed(r.ok, r.status);
      }).catch(function () { return window.__QC_AUTH === requestAuth ? completed(false, 0, '网络连接失败') : false; });
    } catch (_) { return Promise.resolve(completed(false, 0, '网络连接失败')); }
  }
  window.__QC_SAVE_USERS = function (users) {
    return pushUsers(users).then(function (ok) {
      if (!ok) return false;
      localStorage.setItem(KEY.users, JSON.stringify(users.map(publicUser)));
      return window.__QC_REFRESH_SESSION().then(function () { return true; }, function () { return true; });
    });
  };

  function pushRecords() {
    if (window.__QC_MAINTENANCE && window.__QC_MAINTENANCE.blocked) return Promise.resolve(false);
    var owner = window.__QC_AUTH && window.__QC_AUTH.user.username;
    if (!owner) return Promise.resolve(false);
    if (recoveryIsCurrent()) { notice(recoveryMessage(), true); return Promise.resolve(false); }
    var epoch = recordQueueEpoch;
    recordRevision++; recordToken = newRecordToken();
    /* 草稿备份失败（如浏览器存储满）只降级为「无草稿保护」，绝不能因此中止发送：
       中止会让记录只留在本地，下次刷新被服务器数据覆盖后无声丢失。 */
    saveRecordDraft(owner);
    // Each queued write is bound to the authenticated actor that created it.
    recordPushQueue = recordPushQueue.then(function () { return sendRecords(owner, epoch); }, function () { return sendRecords(owner, epoch); });
    return recordPushQueue;
  }
  function sendRecords(owner, epoch) {
    if (window.__QC_MAINTENANCE && window.__QC_MAINTENANCE.blocked) return Promise.resolve(false);
    if (!window.__QC_AUTH || window.__QC_AUTH.user.username !== owner || draftOwner !== owner || epoch !== recordQueueEpoch) return Promise.resolve(false);
    try {
      var st = JSON.parse(localStorage.getItem(KEY.records) || '{}');
      var sentRevision = recordRevision;
      var sentToken = recordToken;
      var sentDeleteRevision = nextDeleteRevision;
      var deleted = window.__QC_PENDING_DELETES.slice();
      var revisions = deleted.map(function (id) { return deleteRevisions[id]; });
      var replacement = window.__QC_FORCE_REPLACE;
      var baselineVersions = recordBaseline && recordBaseline.versions || Object.create(null);
      var changes = pendingRecordChanges(st).filter(function (row) { return deleted.indexOf(row.id) === -1; });
      var createdIds = changes.filter(function (row) {
        return !Object.prototype.hasOwnProperty.call(baselineVersions, row.id);
      }).map(function (row) { return row.id; });
      var baseVersions = Object.create(null);
      changes.forEach(function (row) {
        if (createdIds.indexOf(row.id) === -1) baseVersions[row.id] = baselineVersions[row.id];
      });
      deleted.forEach(function (id) { baseVersions[id] = Object.prototype.hasOwnProperty.call(baselineVersions, id) ? baselineVersions[id] : null; });
      var confirmation = null;
      var requestAuth = window.__QC_AUTH;
      function confirmRows(data) {
        if (!data || data.ok !== true || !Array.isArray(data.confirmedRecords) || !Array.isArray(data.confirmedDeletedIds)) return false;
        var rowIds = data.confirmedRecords.map(function (row) { return row && row.id; });
        var deleteIds = data.confirmedDeletedIds;
        if (rowIds.length !== changes.length || new Set(rowIds).size !== rowIds.length ||
            changes.some(function (row) { return rowIds.indexOf(row.id) === -1; }) ||
            data.confirmedRecords.some(function (row) { return !row || typeof row !== 'object' || Array.isArray(row); }) ||
            deleteIds.length !== deleted.length || new Set(deleteIds).size !== deleteIds.length ||
            deleted.some(function (id) { return deleteIds.indexOf(id) === -1; })) return false;
        confirmation = data;
        return true;
      }
      function acknowledge(ok) {
        // A response from an old actor/session must never clear another actor's draft.
        if (!ok || window.__QC_AUTH !== requestAuth || !window.__QC_AUTH || window.__QC_AUTH.user.username !== owner || draftOwner !== owner || epoch !== recordQueueEpoch) return false;
        if (replacement) {
          recordBaseline = baselineOf(st);
          recordBaselineSignatures = Object.create(null);
          (st.records || []).forEach(function (row) { recordBaselineSignatures[row.id] = recordSignature(row); });
        }
        else {
          var confirmed = Object.create(null), sent = Object.create(null);
          confirmation.confirmedRecords.forEach(function (row) { confirmed[row.id] = row; });
          changes.forEach(function (row) { sent[row.id] = row; });
          function applyConfirmedRows(rows) {
            return rows.map(function (row) {
              return confirmed[row.id] && recordSignature(row) === recordSignature(sent[row.id]) ? confirmed[row.id] : row;
            });
          }
          try {
            var current = JSON.parse(localStorage.getItem(KEY.records) || '{}');
            var updated = applyConfirmedRows(current.records || []);
            if (JSON.stringify(updated) !== JSON.stringify(current.records)) {
              current.records = updated;
              localStorage.setItem(KEY.records, JSON.stringify(current));
            }
            if (typeof state !== 'undefined' && state && Array.isArray(state.records)) state.records = applyConfirmedRows(state.records);
          } catch (_) {
            failedWrites[apiUrl('/api/records')] = true;
            notice('服务器已确认保存，本地状态尚未更新，草稿已保留；请保留页面后重试同步。', true);
            return false;
          }
          // Only confirmed rows advance the baseline. Unrelated rows and later
          // local edits retain their own versions while this request completes.
          confirmation.confirmedRecords.forEach(function (row) {
            recordBaseline.versions[row.id] = row.updatedAt == null ? null : row.updatedAt;
            recordBaselineSignatures[row.id] = recordSignature(row);
          });
          confirmation.confirmedDeletedIds.forEach(function (id) {
            delete recordBaseline.versions[id]; delete recordBaselineSignatures[id];
          });
          var pendingVolatile = volatileRecordDrafts[owner];
          if (pendingVolatile && pendingVolatile.draft.token === recordToken && pendingVolatile.draft.revision === recordRevision) {
            pendingVolatile.draft.state.records = applyConfirmedRows(pendingVolatile.draft.state.records);
          }
        }
        window.__QC_PENDING_DELETES = window.__QC_PENDING_DELETES.filter(function (id) {
          var index = deleted.indexOf(id);
          return index === -1 || deleteRevisions[id] !== revisions[index];
        });
        if (replacement && window.__QC_FORCE_REPLACE === replacement) window.__QC_FORCE_REPLACE = false;
        var volatile = volatileRecordDrafts[owner];
        var acknowledgedVolatile = volatile && volatile.draft.token === sentToken && volatile.draft.revision === sentRevision &&
          recordToken === sentToken && recordRevision === sentRevision && nextDeleteRevision === sentDeleteRevision;
        var draftCleanupFailed = false;
        try {
          var stored = JSON.parse(localStorage.getItem(draftKey(owner)) || 'null');
          if (stored && stored.token === sentToken && recordToken === sentToken && stored.revision === sentRevision && recordRevision === sentRevision && nextDeleteRevision === sentDeleteRevision) localStorage.removeItem(draftKey(owner));
          else if (acknowledgedVolatile && stored && stored.owner === owner && stored.company === COMPANY && stored.token === volatile.previousToken && stored.revision === volatile.previousRevision) localStorage.removeItem(draftKey(owner));
          else if (stored && stored.token === recordToken) saveRecordDraft(owner);
        } catch (_) { draftCleanupFailed = true; notice('服务器已保存，但本地草稿标记未清除；请核对后刷新。', true); }
        if (acknowledgedVolatile) {
          delete volatileRecordDrafts[owner]; updateUnloadGuard();
          if (!draftCleanupFailed && !Object.keys(failedWrites).length) notice('服务器已保存修改', false);
        }
        return ok;
      }
      if (replacement) return post(apiUrl('/api/records/replace'), { records: st.records || [] }).then(acknowledge);
      return post(apiUrl('/api/records'), { records: changes, deletedIds: deleted, newIds: createdIds, baseVersions: baseVersions }, confirmRows).then(acknowledge);
    } catch (e) { console.warn('[QC后端] 读本地记录失败', e); }
    return Promise.resolve(false);
  }
  function pushUsers(users) {
    var u = users;
    if (!Array.isArray(u)) { try { u = JSON.parse(localStorage.getItem(KEY.users) || '[]'); } catch (e) { u = []; } }
    return post(API_BASE + '/api/users?company=' + COMPANY, { users: u });
  }
  function pushPartners(list) {
    var l = list;
    if (!Array.isArray(l)) { try { l = JSON.parse(localStorage.getItem(KEY.partners) || '[]'); } catch (e) { l = []; } }
    return post(API_BASE + '/api/partners?company=' + COMPANY, { partners: l });
  }
  function pushDefects(lib) {
    var l = lib;
    if (!Array.isArray(l)) { try { l = JSON.parse(localStorage.getItem(KEY.defectLib) || '[]'); } catch (e) { l = []; } }
    return post(API_BASE + '/api/defects?company=' + COMPANY, { defectLib: l });
  }

  /* ── 劫持 app.js 的三个写入函数（此时 app.js 已解析，函数已挂到 window）── */
  function patchWriters() {
    var patched = false;
    if (typeof window.persist === 'function' && !window.persist.__qcPatched) {
      var origPersist = window.persist;
      window.persist = function () {
        if (window.__QC_MAINTENANCE && window.__QC_MAINTENANCE.blocked) { notice(window.__QC_MAINTENANCE.message || '系统修复中，记录未提交，请保留当前页面。', true); return false; }
        if (!window.__QC_AUTH) { notice('请先登录当前公司，记录尚未保存。', true); return false; }
        if (recoveryIsCurrent()) { notice(recoveryMessage(), true); return false; }
        var ret = origPersist.apply(this, arguments);
        if (ret !== false) pushRecords();
        return ret;
      };
      window.persist.__qcPatched = true;
      patched = true;
    }
    if (typeof window._savePartners === 'function' && !window._savePartners.__qcPatched) {
      var origP = window._savePartners;
      window._savePartners = function (list) {
        if (window.__QC_MAINTENANCE && window.__QC_MAINTENANCE.blocked) return false;
        var ret = origP.apply(this, arguments);
        pushPartners(list);
        return ret;
      };
      window._savePartners.__qcPatched = true;
      patched = true;
    }
    if (typeof window._saveDefectLib === 'function' && !window._saveDefectLib.__qcPatched) {
      var origDef = window._saveDefectLib;
      window._saveDefectLib = function (lib) {
        if (window.__QC_MAINTENANCE && window.__QC_MAINTENANCE.blocked) return false;
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
  try {
    var cachedUsers = JSON.parse(localStorage.getItem(KEY.users) || '[]');
    if (Array.isArray(cachedUsers)) localStorage.setItem(KEY.users, JSON.stringify(cachedUsers.map(publicUser)));
  } catch (_) {}
  syncBootstrap();

  /* app.js 解析完成后反复接管写入函数，避免线上脚本时序导致只改本地不写服务器 */
  document.addEventListener('DOMContentLoaded', function () {
    schedulePatchWriters();
  });
})();
