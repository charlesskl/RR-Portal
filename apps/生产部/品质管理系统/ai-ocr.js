/* 兴信 QMS - AI OCR 接入
   加载在 app.js 之后。稳定接管“开始识别”按钮：
   - 后端 AI 就绪时使用 /api/ai/ocr-extract
   - AI 未配置时才回退到原本 Tesseract
   - 线上脚本加载顺序变化时也会重复尝试挂载
*/
(function () {
  'use strict';

  var aiReady = false;
  var aiStatus = null;
  var statusPromise = null;
  var patchTimer = null;

  var API_BASE = (function () {
    var p = location.pathname.replace(/[^/]*$/, '');
    return p.replace(/\/$/, '');
  })();

  function setV(id, v) {
    var el = document.getElementById(id);
    if (el && v != null) el.value = v;
  }

  function setT(id, v) {
    var el = document.getElementById(id);
    if (el) el.textContent = v;
  }

  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }

  function checkAiStatus(force) {
    if (statusPromise && !force) return statusPromise;
    statusPromise = fetch(API_BASE + '/api/ai/status', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (s) {
        aiStatus = s || {};
        aiReady = !!(s && s.ready);
        updateHint();
        return aiReady;
      })
      .catch(function (err) {
        aiStatus = { ready: false, error: err && err.message };
        aiReady = false;
        updateHint();
        return false;
      });
    return statusPromise;
  }

  function updateHint() {
    var el = document.getElementById('ocrStatus');
    if (!el) return;
    var text = el.textContent || '';
    if (!text || text === '未上传图片' || text.indexOf('AI OCR') === 0 || text.indexOf('本地 OCR') === 0) {
      el.textContent = aiReady
        ? 'AI OCR 已就绪(' + ((aiStatus && aiStatus.ocrModel) || '百炼') + ')'
        : 'AI OCR 未就绪，将回退本地 OCR';
    }
  }

  function shrinkDataUrl(dataUrl, maxEdge) {
    return new Promise(function (resolve) {
      try {
        var img = new Image();
        img.onload = function () {
          var w = img.width;
          var h = img.height;
          var long = Math.max(w, h);
          if (long <= maxEdge) {
            resolve(dataUrl);
            return;
          }
          var scale = maxEdge / long;
          var cv = document.createElement('canvas');
          cv.width = Math.round(w * scale);
          cv.height = Math.round(h * scale);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL('image/jpeg', 0.9));
        };
        img.onerror = function () { resolve(dataUrl); };
        img.src = dataUrl;
      } catch (e) {
        resolve(dataUrl);
      }
    });
  }

  function applyFields(fields) {
    fields = fields || {};
    var items = Array.isArray(fields.items) ? fields.items : [];
    var first = items[0] || {};

    if (fields.date) setV('ocrDate', fields.date);
    if (fields.supplier) setV('ocrSupplier', fields.supplier);
    if (fields.deliveryNo) setV('ocrDeliveryNo', fields.deliveryNo);
    if (fields.orderNo) setV('ocrOrderNo', fields.orderNo);
    if (fields.type) setV('ocrType', fields.type || '来料');
    if (first.productNo) setV('ocrProductNo', first.productNo);
    if (first.productName) setV('ocrProductName', first.productName);
    if (first.qty) setV('ocrQty', String(first.qty).replace(/[^\d.]/g, ''));

    var lines = [];
    if (fields.supplier) lines.push('供应商：' + fields.supplier);
    if (fields.date) lines.push('日期：' + fields.date);
    if (fields.deliveryNo) lines.push('送货单号：' + fields.deliveryNo);
    if (fields.orderNo) lines.push('订单号：' + fields.orderNo);
    if (items.length) {
      lines.push('货品明细：');
      items.forEach(function (it, i) {
        lines.push('  ' + (i + 1) + '. ' + [it.productNo, it.productName, (it.qty || '') + (it.unit || '')].filter(Boolean).join(' / '));
      });
    }
    setV('ocrRawText', lines.join('\n'));

    window.__qcAiResult = {
      common: {
        date: fields.date || '',
        supplier: fields.supplier || '',
        deliveryNo: fields.deliveryNo || '',
        orderNo: fields.orderNo || '',
        type: fields.type || '来料',
      },
      items: items,
    };

    var applyBtn = document.getElementById('btnApplyOcrToForm');
    if (applyBtn) {
      applyBtn.textContent = items.length > 1
        ? ('应用 ' + items.length + ' 条（逐条录入）')
        : '应用到单条录入';
    }
    return items.length;
  }

  function aiStartOcr() {
    var imgEl = document.getElementById('ocrPreview');
    var dataUrl = imgEl && imgEl.src && imgEl.src.indexOf('data:image') === 0 ? imgEl.src : '';
    if (!dataUrl) {
      toast('请先上传图片', 'error');
      return Promise.resolve();
    }

    var btn = document.getElementById('btnStartOcr');
    if (btn) btn.disabled = true;
    setT('ocrStatus', 'AI 识别中，请稍候...');
    window.__qcAiResult = null;

    return shrinkDataUrl(dataUrl, 2000)
      .then(function (small) {
        return fetch(API_BASE + '/api/ai/ocr-extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: small }),
        });
      })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          return { ok: r.ok, status: r.status, j: j };
        });
      })
      .then(function (res) {
        if (!res.ok || !res.j || !res.j.ok) {
          throw new Error((res.j && res.j.error) || ('HTTP ' + res.status));
        }
        var n = applyFields(res.j.fields || {});
        setT('ocrStatus', 'AI 识别完成' + (n > 1 ? ('（共 ' + n + ' 行货品，已填第 1 行）') : ''));
        toast(n > 1 ? ('识别完成，共 ' + n + ' 行，已填第 1 行') : 'AI 识别完成，请核对字段', 'success');
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : '未知错误';
        console.warn('[AI-OCR]', msg, err);
        setT('ocrStatus', 'AI 识别失败：' + msg);
        toast('AI 识别失败：' + msg, 'error');
      })
      .finally(function () {
        if (btn) btn.disabled = false;
      });
  }

  function loadQueueItem(q) {
    if (!q || q.idx >= q.items.length) return;
    var it = q.items[q.idx];
    var c = q.common || {};
    if (typeof window.openAddModal === 'function') window.openAddModal();
    setV('f_date', c.date || '');
    setV('f_supplier', c.supplier || '');
    setV('f_deliveryNo', c.deliveryNo || '');
    setV('f_orderNo', c.orderNo || '');
    if (c.type) setV('f_type', c.type);
    setV('f_productNo', it.productNo || '');
    setV('f_productName', it.productName || '');
    setV('f_qty', String(it.qty == null ? '' : it.qty).replace(/[^\d.]/g, ''));
    if (typeof window.onQtyChange === 'function') window.onQtyChange();
    if (typeof window.onProductNoChange === 'function') window.onProductNoChange();
    setT('modalTitle', '新增验货记录（第 ' + (q.idx + 1) + '/' + q.items.length + ' 条）');
  }

  function startQueue(common, items) {
    window.__qcQueue = { common: common, items: items, idx: 0 };
    loadQueueItem(window.__qcQueue);
    toast('共 ' + items.length + ' 条货品，逐条录入', 'info');
  }

  function runOriginalOcr() {
    if (typeof window.__origStartOcr === 'function') return window.__origStartOcr();
    toast('本地 OCR 入口未就绪，请刷新页面后重试', 'error');
  }

  function aiDispatch() {
    return checkAiStatus(true).then(function (ready) {
      if (ready) return aiStartOcr();
      setT('ocrStatus', 'AI OCR 未就绪，正在改用本地 OCR...');
      return runOriginalOcr();
    });
  }

  function patch() {
    if (typeof window.startOcr === 'function' && window.startOcr !== aiDispatch && window.startOcr !== window.__origStartOcr) {
      window.__origStartOcr = window.startOcr;
    }
    window.startOcr = aiDispatch;

    var btn = document.getElementById('btnStartOcr');
    if (btn && !btn.__qcAiClickPatched) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        aiDispatch();
      }, true);
      btn.__qcAiClickPatched = true;
    }

    if (typeof window.applyOcrToForm === 'function' && !window.applyOcrToForm.__qcWrapped) {
      var origApply = window.applyOcrToForm;
      window.applyOcrToForm = function () {
        var r = window.__qcAiResult;
        if (r && r.items && r.items.length > 1) return startQueue(r.common, r.items);
        return origApply.apply(this, arguments);
      };
      window.applyOcrToForm.__qcWrapped = true;
    }

    if (typeof window.saveRecord === 'function' && !window.saveRecord.__qcQueueWrapped) {
      var origSave = window.saveRecord;
      window.saveRecord = function () {
        var q = window.__qcQueue;
        var overlay = document.getElementById('modalOverlay');
        var ret = origSave.apply(this, arguments);
        if (q && overlay && !overlay.classList.contains('show')) {
          q.idx++;
          if (q.idx < q.items.length) {
            window.__qcQueue = q;
            loadQueueItem(q);
          } else {
            window.__qcQueue = null;
            toast(q.items.length + ' 条货品已全部录入完成', 'success');
          }
        }
        return ret;
      };
      window.saveRecord.__qcQueueWrapped = true;
    }

    if (typeof window.closeModalDirect === 'function' && !window.closeModalDirect.__qcQueueWrapped) {
      var origClose = window.closeModalDirect;
      window.closeModalDirect = function () {
        var ret = origClose.apply(this, arguments);
        window.__qcQueue = null;
        return ret;
      };
      window.closeModalDirect.__qcQueueWrapped = true;
    }
  }

  function schedulePatch() {
    patch();
    if (patchTimer) clearTimeout(patchTimer);
    patchTimer = setTimeout(patch, 300);
    setTimeout(patch, 1000);
    setTimeout(patch, 2500);
  }

  checkAiStatus(false);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedulePatch);
  else schedulePatch();
})();
