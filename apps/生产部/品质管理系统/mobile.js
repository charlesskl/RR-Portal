/* ══════════════════════════════════════════════════════════════
   兴信 QMS · 移动端交互 + 检测  mobile.js
   ────────────────────────────────────────────────────────────
   1) 检测是否手机/平板 → 给 <html> 加 .qc-mobile / .qc-narrow
      （触发 mobile.css）。判断综合「触摸能力 + 物理屏幕短边 + matchMedia」，
      不依赖 viewport 宽度，规避「电脑版网站」模式伪装宽屏导致 @media 失效。
   2) 手机端侧边栏「抽屉」开合（默认收起、点导航/遮罩关闭），不改 app.js。
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var html = document.documentElement;

  /* ── 1. 设备检测 → 打类 ── */
  function isTouch() {
    return (navigator.maxTouchPoints > 0) || ('ontouchstart' in window) ||
      (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  }
  function shortSide() {
    var w = (window.screen && window.screen.width) || 9999;
    var h = (window.screen && window.screen.height) || 9999;
    return Math.min(w, h);
  }
  function mq(q) { return window.matchMedia && window.matchMedia(q).matches; }

  function evalClasses() {
    var touch = isTouch();
    var ss = shortSide();
    // 手机/平板：媒体查询命中(普通移动浏览器) 或 触摸且物理短边<=820(桌面模式兜底)
    var isPhone  = mq('(max-width: 768px)') || (touch && ss <= 820);
    // 窄屏：媒体查询<=480 或 触摸且物理短边<=480(绝大多数手机)
    var isNarrow = mq('(max-width: 480px)') || (touch && ss <= 480);
    html.classList.toggle('qc-mobile', !!isPhone);
    html.classList.toggle('qc-narrow', !!isNarrow);
    return !!isPhone;
  }

  // 尽早打类，减少布局闪烁（mobile.js 在 body 末尾，<html> 已存在）
  evalClasses();

  /* ── 2. 侧边栏抽屉 ── */
  var sidebar, mainWrap, backdrop;

  function isMobileNow() { return html.classList.contains('qc-mobile'); }

  function closeSidebar() {
    if (!sidebar) return;
    sidebar.classList.add('collapsed');
    document.body.classList.remove('qc-sidebar-open');
  }
  function syncBackdrop() {
    if (!sidebar) return;
    if (!sidebar.classList.contains('collapsed') && isMobileNow()) {
      document.body.classList.add('qc-sidebar-open');
    } else {
      document.body.classList.remove('qc-sidebar-open');
    }
  }

  function init() {
    sidebar = document.getElementById('sidebar');
    mainWrap = document.querySelector('.main-wrap');
    if (!sidebar) return;

    backdrop = document.createElement('div');
    backdrop.className = 'qc-mobile-backdrop';
    backdrop.addEventListener('click', closeSidebar);
    document.body.appendChild(backdrop);

    if (isMobileNow()) closeSidebar();

    var navItems = sidebar.querySelectorAll('.nav-item');
    for (var i = 0; i < navItems.length; i++) {
      navItems[i].addEventListener('click', function () {
        if (isMobileNow()) closeSidebar();
      });
    }

    // ☰ 用 app.js 的 toggleSidebar()（切 .collapsed）；观察 class 变化同步遮罩
    var mo = new MutationObserver(syncBackdrop);
    mo.observe(sidebar, { attributes: true, attributeFilter: ['class'] });

    // 屏幕尺寸/方向变化时重算
    function onResize() {
      var phone = evalClasses();
      if (phone) { closeSidebar(); }
      else {
        sidebar.classList.remove('collapsed');
        if (mainWrap) mainWrap.classList.remove('full');
        document.body.classList.remove('qc-sidebar-open');
      }
    }
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
