/* ══════════════════════════════════════════════════════════════
   兴信 QMS · AI 识别接入（阿里百炼 qwen-vl）  ai-ocr.js
   ────────────────────────────────────────────────────────────
   在 app.js 之后加载。劫持 startOcr()：
     · 后端 AI 就绪(/api/ai/status.ready) → 用 AI 视觉模型只提取系统需要的字段
     · 未就绪或调用失败 → 自动回退到原 Tesseract 流程
   不改 app.js。图片从 #ocrPreview 的 dataURL 取，必要时压缩后发后端。
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var aiReady = false;
  // API 基址：兼容根部署与 /qc/ 子路径部署（与 qc-backend.js 一致）
  var API_BASE = (function () {
    var p = location.pathname.replace(/[^/]*$/, '');
    return p.replace(/\/$/, '');
  })();
  // 启动时查询 AI 是否可用
  fetch(API_BASE + '/api/ai/status').then(function (r) { return r.json(); })
    .then(function (s) { aiReady = !!(s && s.ready); updateHint(s); })
    .catch(function () { aiReady = false; });

  function updateHint(s) {
    var el = document.getElementById('ocrStatus');
    if (el && (!el.textContent || /未上传图片/.test(el.textContent))) {
      el.textContent = aiReady ? ('AI识别已就绪(' + (s.ocrModel || '百炼') + ')，上传图片后点开始识别')
                               : '未上传图片（AI未配置，将用本地OCR）';
    }
  }

  /* 把 dataURL 压到长边 ≤2000px，控制上传体积、保留清晰度 */
  function shrinkDataUrl(dataUrl, maxEdge) {
    return new Promise(function (resolve) {
      try {
        var img = new Image();
        img.onload = function () {
          var w = img.width, h = img.height;
          var long = Math.max(w, h);
          if (long <= maxEdge) { resolve(dataUrl); return; }
          var scale = maxEdge / long;
          var cv = document.createElement('canvas');
          cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL('image/jpeg', 0.9));
        };
        img.onerror = function () { resolve(dataUrl); };
        img.src = dataUrl;
      } catch (e) { resolve(dataUrl); }
    });
  }

  function setV(id, v) { var el = document.getElementById(id); if (el && v != null) el.value = v; }
  function setT(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }

  /* 把 AI 返回的结构化字段填进 OCR 预览字段 + 原文框 */
  function applyFields(fields) {
    var items = Array.isArray(fields.items) ? fields.items : [];
    var first = items[0] || {};

    if (fields.date)        setV('ocrDate', fields.date);
    if (fields.supplier)    setV('ocrSupplier', fields.supplier);
    if (fields.deliveryNo)  setV('ocrDeliveryNo', fields.deliveryNo);
    if (fields.type)        setV('ocrType', fields.type || '来料');
    if (first.productNo)    setV('ocrProductNo', first.productNo);
    if (first.productName)  setV('ocrProductName', first.productName);
    if (first.qty)          setV('ocrQty', String(first.qty).replace(/[^\d.]/g, ''));

    // 把完整识别结果（含订单号、所有行）写进原文框，避免信息丢失
    var lines = [];
    if (fields.supplier)   lines.push('供应商：' + fields.supplier);
    if (fields.date)       lines.push('日期：' + fields.date);
    if (fields.deliveryNo) lines.push('送货单号：' + fields.deliveryNo);
    if (fields.orderNo)    lines.push('订单号：' + fields.orderNo);
    if (items.length) {
      lines.push('货品明细：');
      items.forEach(function (it, i) {
        lines.push('  ' + (i + 1) + '. ' + [it.productNo, it.productName, (it.qty || '') + (it.unit || '')].filter(Boolean).join(' / '));
      });
    }
    setV('ocrRawText', lines.join('\n'));

    // 暂存结构化结果，供"应用"按钮判断走单条还是多行批量
    window.__qcAiResult = {
      common: {
        date: fields.date || '', supplier: fields.supplier || '',
        deliveryNo: fields.deliveryNo || '', orderNo: fields.orderNo || '',
        type: fields.type || '来料',
      },
      items: items,
    };
    var applyBtn = document.getElementById('btnApplyOcrToForm');
    if (applyBtn) {
      applyBtn.textContent = items.length > 1
        ? ('✓ 应用 ' + items.length + ' 条到批量录入')
        : '✓ 应用到单条录入';
    }
    return items.length;
  }

  function aiStartOcr() {
    var imgEl = document.getElementById('ocrPreview');
    var dataUrl = imgEl && imgEl.src && imgEl.src.indexOf('data:image') === 0 ? imgEl.src : '';
    if (!dataUrl) {
      if (typeof window.showToast === 'function') window.showToast('请先上传图片', 'error');
      return;
    }
    var btn = document.getElementById('btnStartOcr');
    if (btn) btn.disabled = true;
    setT('ocrStatus', 'AI 识别中，请稍候…');
    window.__qcAiResult = null;   // 清掉上一次结果

    shrinkDataUrl(dataUrl, 2000).then(function (small) {
      return fetch(API_BASE + '/api/ai/ocr-extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: small }),
      });
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j || !res.j.ok) {
          throw new Error((res.j && res.j.error) || 'AI 识别失败');
        }
        var n = applyFields(res.j.fields || {});
        setT('ocrStatus', 'AI 识别完成' + (n > 1 ? ('（共 ' + n + ' 行货品，已填第 1 行）') : ''));
        if (typeof window.showToast === 'function') {
          window.showToast(n > 1 ? ('✓ 识别完成，共 ' + n + ' 行，已填第1行，其余见原文框') : '✓ AI 识别完成，请核对字段', 'success');
        }
      })
      .catch(function (err) {
        console.warn('[AI-OCR] 失败，回退本地 OCR：', err && err.message);
        setT('ocrStatus', 'AI 识别失败，改用本地 OCR…');
        if (typeof window.__origStartOcr === 'function') {
          window.__origStartOcr();   // 回退 Tesseract
        } else if (typeof window.showToast === 'function') {
          window.showToast('AI 识别失败：' + (err && err.message || ''), 'error');
        }
      })
      .finally(function () { if (btn) btn.disabled = false; });
  }

  /* 劫持：AI 就绪走 AI，否则走原 Tesseract */
  function patch() {
    if (typeof window.startOcr === 'function' && window.startOcr !== aiDispatch) {
      window.__origStartOcr = window.startOcr;
      window.startOcr = aiDispatch;
    }
    // 应用按钮：多行货品(AI识别)时改走批量创建，单行/Tesseract 仍走原单条录入
    if (typeof window.applyOcrToForm === 'function' && !window.applyOcrToForm.__qcWrapped) {
      var origApply = window.applyOcrToForm;
      window.applyOcrToForm = function () {
        var r = window.__qcAiResult;
        if (r && r.items && r.items.length > 1 && typeof window.applyAiOcrItems === 'function') {
          return window.applyAiOcrItems(r.common, r.items);
        }
        return origApply.apply(this, arguments);
      };
      window.applyOcrToForm.__qcWrapped = true;
    }
  }
  function aiDispatch() {
    if (aiReady) return aiStartOcr();
    if (typeof window.__origStartOcr === 'function') return window.__origStartOcr();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patch);
  else patch();
})();
