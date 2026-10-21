/* 浏览器门户旧票据不再授予品质系统会话或权限。 */
(function () {
  'use strict';
  try { localStorage.removeItem('xingxin_qms_switch_ticket'); } catch (_) {}
  var query = new URLSearchParams(location.search);
  if (!query.has('sso_ticket')) return;
  query.delete('sso_ticket');
  var rest = query.toString();
  history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + (location.hash || ''));
  window.__QC_LEGACY_SSO_NOTICE = '门户链接已打开，请使用当前公司的品质账号登录。';
})();
