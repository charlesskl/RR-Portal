/* 维护状态仅由同源服务决定；保留当前表单与草稿，恢复后由用户核对并刷新。 */
(function () {
  'use strict';
  var activated = false, inFlight = false, pending = null;
  var base = location.pathname.replace(/[^/]*$/, '').replace(/\/$/, '');
  var guard = window.__QC_MAINTENANCE = { blocked: true, message: '正在检查连接，暂未提交，请稍后重试', activate: activate };
  function updatePageLock() {
    var overlay = document.getElementById('qcMaintenance');
    if (overlay) overlay.hidden = !activated;
    ['appWrapper', 'loginScreen'].forEach(function (id) {
      var el = document.getElementById(id); if (el) el.inert = activated;
    });
  }
  function render(title, message, refresh) {
    document.getElementById('qcMaintenanceTitle').textContent = title;
    document.getElementById('qcMaintenanceMessage').textContent = message;
    document.getElementById('qcMaintenanceRefresh').hidden = !refresh;
    updatePageLock();
  }
  function activate() {
    activated = true; guard.blocked = true;
    guard.message = '系统修复中，暂时无法操作';
    if (typeof window.__QC_OCR_CANCEL === 'function') window.__QC_OCR_CANCEL();
    render('系统修复中', '请稍后再试。', false);
  }
  function check() {
    if (inFlight || document.hidden) return;
    inFlight = true;
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var operation = { controller: controller, suspended: false, reason: 'network', startedAt: Date.now() };
    pending = operation;
    var timer = operation.timer = setTimeout(function () { operation.reason = 'timeout'; if (controller) controller.abort(); }, 10000);
    fetch(base + '/api/maintenance', { credentials: 'same-origin', cache: 'no-store', signal: controller ? controller.signal : undefined })
      .then(function (response) {
        // 网关切换容器时返回维护 HTML；不要把它当作连接故障或解析 JSON。
        if (response.status === 503 && response.headers &&
            (response.headers.get('X-QC-Maintenance') === '1' || response.headers.get('Retry-After'))) return { enabled: true };
        if (!response.ok) { operation.reason = 'http-' + response.status; throw new Error('status'); }
        return response.json().catch(function (error) { operation.reason = 'invalid-response'; throw error; });
      })
      .then(function (state) {
        // 响应正文可能在 abort 后才完成；主动取消的成功结果也必须丢弃。
        if (operation.suspended) return;
        if (!state || typeof state.enabled !== 'boolean') { operation.reason = 'invalid-status'; throw new Error('invalid status'); }
        if (state.enabled) activate();
        else if (activated) render('修复已完成', '请核对未保存内容后刷新。', true);
        else if (guard.blocked) {
          guard.blocked = false;
          guard.message = '';
          if (typeof window.applyPermissions === 'function') window.applyPermissions();
        }
      })
      .catch(function () {
        // 切到后台主动取消的检查不代表断线，不能改变当前保护或表单状态。
        if (operation.suspended) return;
        if (typeof console !== 'undefined' && console.warn) console.warn('[QMS status]', operation.reason, base + '/api/maintenance', Date.now() - operation.startedAt + 'ms');
        guard.blocked = true;
        // 状态查询失败时继续后台检查，用户主动保存时才说明暂未提交。
        if (!activated) guard.message = '连接中断，保存已暂停，请稍后重试';
      })
      .finally(function () {
        clearTimeout(timer); inFlight = false;
        if (pending === operation) pending = null;
        if (operation.suspended && !document.hidden) check();
      });
  }
  ['click', 'submit', 'keydown'].forEach(function (event) {
    document.addEventListener(event, function (e) {
      var overlay = document.getElementById('qcMaintenance');
      if (activated && overlay && !overlay.contains(e.target)) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (event === 'keydown' && e.key === 'Tab') {
          var button = document.getElementById('qcMaintenanceRefresh');
          if (button && !button.hidden && !button.disabled) button.focus();
        }
      }
    }, true);
  });
  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('qcMaintenanceRefresh').onclick = function () { location.reload(); };
    updatePageLock();
    check();
  });
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { check(); return; }
    if (pending) {
      pending.suspended = true; clearTimeout(pending.timer);
      if (pending.controller) pending.controller.abort();
    }
  });
  setInterval(check, 5000);
  // 缓存的旧页面可能没有给遮罩设置 hidden。
  updatePageLock();
  check();
})();
