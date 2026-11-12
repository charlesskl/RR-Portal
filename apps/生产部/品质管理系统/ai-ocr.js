/* 兴信 QMS - AI OCR 接入
   加载在 app.js 之后。稳定接管“开始识别”按钮：
   - 后端 AI 就绪时使用 /api/ai/ocr-extract
   - AI 未就绪或连接失败时保留内容，停止识别，不回退浏览器引擎
   - 线上脚本加载顺序变化时也会重复尝试挂载
*/
(function () {
  'use strict';

  var aiReady = false;
  var aiStatus = null;
  var statusPromise = null;
  var patchTimer = null;
  var activeOperation = null;
  var textRevision = 0;
  window.__qcOcrTextNeedsParsing = false;

  function imageApi() { return window.__QC_OCR_IMAGE; }
  function stillCurrent(op) {
    return activeOperation === op && imageApi() && imageApi().current(op.snapshot);
  }
  function controlsBusy(busy) {
    ['btnStartOcr', 'btnRotateOcr', 'btnApplyOcrToForm', 'btnParseOcrText'].forEach(function (id) {
      var button = document.getElementById(id);
      if (button) button.disabled = busy;
    });
  }
  function cancelOperation() {
    textRevision++;
    // Invalidate pending image and text operations together.
    if (imageApi() && typeof imageApi().invalidatePending === 'function') imageApi().invalidatePending();
    var previous = activeOperation;
    activeOperation = null;
    if (previous && previous.controller) previous.controller.abort();
    controlsBusy(false);
  }
  window.__QC_OCR_CANCEL = cancelOperation;

  function beginOperation() {
    if (activeOperation && stillCurrent(activeOperation)) return null;
    cancelOperation();
    var snapshot = imageApi() && imageApi().snapshot();
    if (!snapshot) { toast('请先上传图片', 'error'); return null; }
    if (!window.__QC_AUTH) { toast('请先登录当前公司的品质账号', 'error'); return null; }
    var op = { snapshot: snapshot,
      controller: typeof AbortController === 'function' ? new AbortController() : null };
    activeOperation = op;
    controlsBusy(true);
    return op;
  }
  function endOperation(op) {
    if (activeOperation === op) { activeOperation = null; controlsBusy(false); }
  }
  function obsolete() { var e = new Error('图片或登录已改变'); e.name = 'AbortError'; return e; }
  function requireCurrent(op) { if (!stillCurrent(op)) throw obsolete(); }

  function actorContext() {
    var auth = window.__QC_AUTH;
    return { authenticated: !!auth, username: auth && auth.user && auth.user.username,
      csrfToken: auth && auth.csrfToken, authCompany: auth && auth.company, company: window.__QC_COMPANY };
  }
  function sameActor(context) {
    var current = actorContext();
    return !context || ['authenticated','username','csrfToken','authCompany','company'].every(function (key) { return context[key] === current[key]; });
  }
  function canSaveOcr(context) {
    if (sameActor(context)) return true;
    toast('登录或公司已改变，旧 OCR 资料已暂停，请用原身份重新核对后录入', 'error');
    return false;
  }
  window.__QC_OCR_CAN_SAVE = canSaveOcr;


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

  /* 识别出的公司全称 → 名单简称（app.js 提供 matchManagedName） */
  function canonName(type, v) {
    if (!v) return v;
    return (typeof window.matchManagedName === 'function') ? window.matchManagedName(type, v) : v;
  }

  function checkAiStatus(force, op) {
    if (!window.__QC_AUTH || typeof window.__QC_REQUEST !== 'function') return Promise.resolve(false);
    if (statusPromise && !force) return statusPromise;
    var actor = actorContext();
    statusPromise = window.__QC_REQUEST('/api/ai/status', op && op.controller ? { signal: op.controller.signal } : undefined)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (s) {
        if (!sameActor(actor) || (op && !stillCurrent(op))) return false;
        if (!s || typeof s.ready !== 'boolean') throw new Error('识别服务状态返回无效');
        aiStatus = s || {};
        aiReady = !!(s && s.ready);
        updateHint();
        return aiReady;
      })
      .catch(function (err) {
        if (!sameActor(actor) || (op && !stillCurrent(op))) return false;
        aiStatus = { ready: false, error: err && err.message };
        aiReady = false;
        updateHint();
        return false;
      });
    return statusPromise;
  }

  function updateHint() {
    var el = document.getElementById('ocrStatus');
    if (!el || activeOperation) return;
    var text = el.textContent || '';
    if (!text || text === '未上传图片' || text.indexOf('AI OCR') === 0 || text.indexOf('本地 OCR') === 0) {
      el.textContent = aiReady
        ? 'AI OCR 已就绪(' + ((aiStatus && aiStatus.ocrModel) || '百炼') + ')'
        : aiStatus && aiStatus.error ? 'AI OCR 连接失败，请稍后重试' : '识别服务暂不可用，请稍后重试';
    }
  }

  /* 每个候选都从不可变原图生成，画布最多 2000 × 2000，失败不冒充旋转成功。 */
  function renderImage(dataUrl, angle, op) {
    return new Promise(function (resolve, reject) {
      var timer;
      function fail(error) { clearTimeout(timer); reject(error); }
      try {
        if (!/^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(dataUrl) || dataUrl.length > 14 * 1024 * 1024) {
          throw new Error('图片编码无效或过大，请重新上传');
        }
        var img = new Image();
        timer = setTimeout(function () { fail(new Error('图片解码超时，请重新上传')); }, 15000);
        img.onload = function () {
          try {
            requireCurrent(op);
            var w = img.naturalWidth === undefined ? img.width : img.naturalWidth;
            var h = img.naturalHeight === undefined ? img.height : img.naturalHeight;
            if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new Error('图片尺寸无效');
            var scale = Math.min(1, 2000 / Math.max(w, h));
            var sw = Math.max(1, Math.round(w * scale)), sh = Math.max(1, Math.round(h * scale));
            var d = ((angle % 360) + 360) % 360;
            if ([0, 90, 180, 270].indexOf(d) === -1) throw new Error('图片旋转方向无效');
            var cv = document.createElement('canvas');
            cv.width = d === 90 || d === 270 ? sh : sw;
            cv.height = d === 90 || d === 270 ? sw : sh;
            var ctx = cv.getContext('2d');
            if (!ctx) throw new Error('浏览器无法处理图片');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, cv.width, cv.height);
            ctx.translate(cv.width / 2, cv.height / 2);
            ctx.rotate(d * Math.PI / 180);
            ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
            var result = cv.toDataURL('image/jpeg', 0.92);
            if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/i.test(result) || result.length > 14 * 1024 * 1024) throw new Error('图片处理失败，请重新上传');
            clearTimeout(timer);
            resolve(result);
          } catch (error) { fail(error); }
        };
        img.onerror = function () { fail(new Error('图片解码失败，请重新上传')); };
        img.src = dataUrl;
      } catch (error) { fail(error); }
    });
  }

  function weightRemark(item) {
    if (!item || !/^(?:KG|千克|公斤)$/i.test(String(item.unit || '').trim()) || !item.quantityNeedsReview) return '';
    return '送货单重量：' + String(item.qty || '') + ' ' + item.unit + (item.sourceRemark ? '；原单备注：' + item.sourceRemark : '') + '；请确认并填写验货数量';
  }

  function applyFields(fields) {
    fields = fields || {};
    window.__qcOcrTextNeedsParsing = false;
    window.__qcOcrTextActor = null;
    if (fields.supplier) {
      var matched = canonName('supplier', fields.supplier);
      if (matched !== fields.supplier) {
        toast('供应商全称已自动匹配为名单中的「' + matched + '」', 'info');
        fields.supplier = matched;
      }
    }
    var items = Array.isArray(fields.items) ? fields.items : [];
    var first = items[0] || {};

    /* 每次识别整组替换；缺失字段不能继承上一张图片的日期、货号或PO。 */
    setV('ocrDate', fields.date || '');
    setV('ocrSupplier', fields.supplier || '');
    setV('ocrClient', fields.customer ? canonName('customer', fields.customer) : '');
    setV('ocrDeliveryNo', fields.deliveryNo || '');
    setV('ocrOrderNo', first.orderNo || fields.orderNo || '');
    setV('ocrType', fields.type || '来料');
    setV('ocrProductNo', first.productNo || '');
    setV('ocrProductName', /^待核对原(?:文|行)[：:]/.test(first.productName || '') ? '' : first.productName || '');
    setV('ocrRemark', weightRemark(first) || [['型号',first.model],['颜色',first.color],['原单送货/欠数',first.deliveryBalance],['箱数',first.cartons],['原单备注',first.remark]].filter(function (pair) { return pair[1]; }).map(function (pair) { return pair[0]+'：'+pair[1]; }).join('；'));
    setV('ocrQty', weightRemark(first) ? '' : String(first.qty == null ? '' : first.qty).replace(/[^\d.]/g, ''));

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
        customer: fields.customer ? canonName('customer', fields.customer) : '',
        deliveryNo: fields.deliveryNo || '',
        orderNo: fields.orderNo || '',
        type: fields.type || '来料',
      },
      items: items,
    };
    var preview = document.getElementById('ocrItemsPreview');
    if (preview) {
      var escape = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
      preview.hidden = !items.length;
      preview.innerHTML = '<table class="batch-preview-table"><thead><tr>' + ['订单号（PO）','货号','型号','配件名称','颜色','数量','单位','本单送货数/本单欠数','箱数','备注'].map(function (v) { return '<th>'+v+'</th>'; }).join('') + '</tr></thead><tbody>' + items.map(function (it) {
        return '<tr>'+[it.orderNo || fields.orderNo,it.productNo,it.model,/^待核对原(?:文|行)[：:]/.test(it.productName || '') ? '待核对原文' : it.productName,it.color,it.qty,it.unit,it.deliveryBalance,it.cartons,it.remark].map(function (v) { return '<td>'+escape(v || '—')+'</td>'; }).join('')+'</tr>';
      }).join('')+'</tbody></table>';
    }

    var applyBtn = document.getElementById('btnApplyOcrToForm');
    if (applyBtn) {
      applyBtn.textContent = items.length > 1
        ? ('应用 ' + items.length + ' 条（逐条录入）')
        : '应用到单条录入';
    }
    return items.length;
  }

  function usableItems(fields) {
    return fields && Array.isArray(fields.items) && fields.items.length > 0 && fields.items.every(function (item) {
      return item && typeof item === 'object' &&
        (item.quantityNeedsReview === true || String(item.productNo || '').trim() ||
         String(item.productName || '').trim() || String(item.qty == null ? '' : item.qty).trim());
    });
  }

  function hasQuantity(fields) {
    return usableItems(fields) && fields.items.some(function (item) {
      return String(item.qty == null ? '' : item.qty).trim();
    });
  }

  function aiStartOcr(op) {
    var baseAngle = op.snapshot.angle;
    var attempted = [baseAngle], candidates = null, pendingFallback = null;
    function attempt(angle) {
      requireCurrent(op);
      return renderImage(op.snapshot.original, angle, op).then(function (small) {
        requireCurrent(op);
        return window.__QC_REQUEST('/api/ai/ocr-extract', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: small }),
          signal: op.controller ? op.controller.signal : undefined,
        }).then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (body) {
            requireCurrent(op);
            if (!response.ok || !body || !body.ok) throw new Error((body && body.error) || ('HTTP ' + response.status));
            var rotatedPending = usableItems(body.fields) && !hasQuantity(body.fields) &&
              [90, 180, 270].indexOf(body.needRotate) !== -1;
            if (!usableItems(body.fields) || rotatedPending) {
              /* 有内容但解析不出明细（待核对原文）：留底，转正尝试全部失败后回退到它，不丢原文 */
              if (!pendingFallback && usableItems(body.fields)) {
                pendingFallback = { fields: body.fields, rawText: body.rawText, image: small, angle: angle };
              }
              if ([90, 180, 270].indexOf(body.needRotate) !== -1 && !candidates) {
                var correction = body.needRotate === 180 ? 180 : (body.needRotate === 270 ? 90 : 270);
                candidates = [(baseAngle + correction) % 360];
                if (correction !== 180) candidates.push((baseAngle + 360 - correction) % 360);
              }
              var next = candidates && candidates.find(function (candidate) { return attempted.indexOf(candidate) === -1; });
              if (next !== undefined && next !== null) {
                attempted.push(next);
                setT('ocrStatus', '检测到图片旋转，自动转正重试（第 ' + (attempted.length - 1) + ' 次）...');
                return attempt(next);
              }
              if (pendingFallback) {
                body = { ok: true, fields: pendingFallback.fields, rawText: pendingFallback.rawText, needsManualReview: true };
                small = pendingFallback.image;
                angle = pendingFallback.angle;
              } else {
                throw new Error('未识别到货品明细，请核对图片方向或手动录入；原有更正已保留');
              }
            }
            var committed = imageApi().commit(op.snapshot, small, angle);
            if (!committed) throw obsolete();
            op.snapshot = committed;
            var n = applyFields(body.fields);
            window.__qcOcrResultContext = committed;
            if (body.rawText) setV('ocrRawText', body.rawText);
            var manual = body.needsManualReview || body.fields.items.some(function (item) { return item && item.quantityNeedsReview; });
            setT('ocrStatus', manual ? '识别结果需要人工核对，请逐行确认数量和单位后保存' :
              'AI 识别完成' + (n > 1 ? ('（共 ' + n + ' 行货品，已填第 1 行）') : ''));
            toast(manual ? '原文已保留，请人工核对货品与数量' :
              (n > 1 ? ('识别完成，共 ' + n + ' 行，已填第 1 行') : 'AI 识别完成，请核对字段'), manual ? 'info' : 'success');
          });
        });
      });
    }
    setT('ocrStatus', 'AI 识别中，请稍候...');
    return attempt(baseAngle);
  }

  function operationFailure(op, error, prefix) {
    if (!stillCurrent(op) || error && error.name === 'AbortError') return;
    var msg = error && error.message ? error.message : '未知错误';
    if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(msg)) {
      msg = '无法连接识别服务，请检查网络后重试；图片与已填内容已保留';
    }
    setT('ocrStatus', prefix + '：' + msg);
    toast(prefix + '：' + msg, 'error');
  }

  function manualRotate() {
    var op = beginOperation();
    if (!op) return Promise.resolve();
    var angle = (op.snapshot.angle + 90) % 360;
    setT('ocrStatus', '正在旋转图片...');
    return renderImage(op.snapshot.original, angle, op).then(function (dataUrl) {
      requireCurrent(op);
      var committed = imageApi().commit(op.snapshot, dataUrl, angle);
      if (!committed) throw obsolete();
      op.snapshot = committed;
      setT('ocrStatus', '图片已旋转 90°，点击"开始识别"重新识别');
    }).catch(function (error) { operationFailure(op, error, '图片旋转失败'); })
      .finally(function () { endOperation(op); });
  }

  function loadQueueItem(q) {
    if (!q || q.idx >= q.items.length) return;
    if (!canSaveOcr(q.context)) return false;
    var it = q.items[q.idx];
    var c = q.common || {};
    if (typeof window.openAddModal === 'function') window.openAddModal();
    window.__qcOcrFormContext = q.context;
    /* 公共日期为空时回退今天（openAddModal 的默认值），不要把今天清成空 */
    var date = String(c.date || '').trim();
    if (date) setV('f_date', date);
    setV('f_supplier', c.supplier || '');
    if (c.customer) setV('f_client', c.customer);
    setV('f_deliveryNo', c.deliveryNo || '');
    setV('f_orderNo', it.orderNo || c.orderNo || '');   /* 多 PO 单：用本条自己的 PO 号 */
    if (c.type) setV('f_type', c.type);
    setV('f_productNo', it.productNo || '');
    setV('f_productName', /^待核对原(?:文|行)[：:]/.test(it.productName || '') ? '' : it.productName || '');
    setV('f_remark', weightRemark(it) || [['型号',it.model],['颜色',it.color],['原单送货/欠数',it.deliveryBalance],['箱数',it.cartons],['原单备注',it.remark]].filter(function (pair) { return pair[1]; }).map(function (pair) { return pair[0]+'：'+pair[1]; }).join('；'));
    setV('f_qty', weightRemark(it) ? '' : String(it.qty == null ? '' : it.qty).replace(/[^\d.]/g, ''));
    if (typeof window._markOcrQuantity === 'function') window._markOcrQuantity(it.quantityNeedsReview ? '待核对' : it.qty);
    if (typeof window.onQtyChange === 'function') window.onQtyChange();
    if (typeof window.onProductNoChange === 'function') window.onProductNoChange();
    setT('modalTitle', '新增验货记录（第 ' + (q.idx + 1) + '/' + q.items.length + ' 条）');
  }

  function startQueue(common, items) {
    window.__qcQueue = { common: common, items: items, idx: 0, context: actorContext() };
    toast('共 ' + items.length + ' 条货品，逐条录入', 'info');
    loadQueueItem(window.__qcQueue);
  }

  window.invalidateOcrText = function () {
    cancelOperation(); window.__qcOcrTextNeedsParsing = true;
    var preview = document.getElementById('ocrItemsPreview'); if (preview) preview.hidden = true;
    setT('ocrStatus', '原文已修改，请点击“按原文重新提取”后再应用');
  };
  window.reparseOcrText = function () {
    var input = document.getElementById('ocrRawText'), raw = input && input.value;
    if (!raw || !raw.trim()) { toast('请先填写识别原文', 'error'); return Promise.resolve(false); }
    if (!window.__QC_AUTH || typeof window.__QC_REQUEST !== 'function') { toast('请先登录当前公司', 'error'); return Promise.resolve(false); }
    cancelOperation(); var revision = textRevision, actor = actorContext();
    controlsBusy(true); window.__qcOcrTextNeedsParsing = true;
    setT('ocrStatus', '正在按表头重新提取原文…');
    return window.__QC_REQUEST('/api/ai/ocr-parse', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:raw})})
      .then(function (res) { return res.json().then(function (body) { if (!res.ok || !body.ok) throw new Error(body.error || '原文解析失败'); return body; }); })
      .then(function (body) {
        if (revision !== textRevision || !sameActor(actor) || input.value !== raw) return false;
        if (!usableItems(body.fields)) throw new Error('原文没有可核对的货品明细，请检查表头和行内容');
        applyFields(body.fields); setV('ocrRawText', raw); window.__qcOcrTextActor = actor;
        window.__qcOcrResultContext = imageApi() && imageApi().snapshot();
        setT('ocrStatus', body.needsManualReview ? '部分明细需核对，请查看下方对应表' : '原文提取完成，请核对下方列对应后应用');
        return true;
      }).catch(function (err) { if (revision === textRevision && sameActor(actor)) { setT('ocrStatus', '原文提取失败：'+err.message); toast(err.message,'error'); } return false; })
      .finally(function () { if (revision === textRevision) controlsBusy(false); });
  };

  /* A stalled status, model response or response body must release the UI.
     Invalidate via the existing operation context so late replies cannot apply. */
  function boundedOperation(op, work) {
    return new Promise(function (resolve, reject) {
      var settled = false, timer;
      var signal = op.controller && op.controller.signal;
      function finish(callback, value) {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', aborted);
        callback(value);
      }
      function aborted() { finish(reject, obsolete()); }
      if (signal) signal.addEventListener('abort', aborted, { once: true });
      timer = setTimeout(function () {
        finish(reject, new Error('识别等待超时，请重试；图片与已填内容已保留'));
        if (op.controller) op.controller.abort();
      }, 90000);
      try {
        requireCurrent(op);
        Promise.resolve(work()).then(function (value) { finish(resolve, value); }, function (error) { finish(reject, error); });
      } catch (error) { finish(reject, error); }
    });
  }

  function aiDispatch() {
    var op = beginOperation();
    if (!op) return Promise.resolve();
    setT('ocrStatus', '正在检查识别服务...');
    return boundedOperation(op, function () { return checkAiStatus(true, op).then(function (ready) {
      requireCurrent(op);
      if (ready) return aiStartOcr(op);
      if (!aiStatus || aiStatus.error) throw new Error('无法检查 AI 识别服务状态，请稍后重试；已填内容已保留');
      throw new Error('识别服务暂不可用，请稍后重试；图片与已填内容已保留');
    }); }).catch(function (error) { operationFailure(op, error, 'AI 识别失败'); })
      .finally(function () { endOperation(op); });
  }

  function patch() {
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

    /* 手动旋转按钮：横拍/倒置的单据转正后再识别 */
    var rotBtn = document.getElementById('btnRotateOcr');
    if (rotBtn && !rotBtn.__qcRotPatched) {
      rotBtn.addEventListener('click', function (e) {
        e.preventDefault();
        return manualRotate();
      });
      rotBtn.__qcRotPatched = true;
    }

    if (typeof window.applyOcrToForm === 'function' && !window.applyOcrToForm.__qcWrapped) {
      var origApply = window.applyOcrToForm;
      window.applyOcrToForm = function () {
        if (window.__qcOcrTextNeedsParsing) { toast('请先按原文重新提取，再应用到表单', 'error'); return false; }
        if (window.__qcOcrTextActor && !canSaveOcr(window.__qcOcrTextActor)) return false;
        if (activeOperation && stillCurrent(activeOperation)) { toast('请等待图片处理完成后再应用', 'info'); return false; }
        var context = window.__qcOcrResultContext;
        var current = imageApi() && imageApi().snapshot();
        if (context && (!current || context.original !== current.original || !sameActor(context.actor))) {
          toast('图片或登录已改变，请重新识别后应用', 'error'); return false;
        }
        var r = window.__qcAiResult;
        if (!r && ['ocrDate','ocrSupplier','ocrProductNo','ocrProductName','ocrDeliveryNo','ocrOrderNo','ocrQty','ocrType','ocrRemark'].every(function (id) {
          var input = document.getElementById(id);
          return !input || !String(input.value || '').trim();
        })) { toast('尚无可应用的识别结果，请先识别或填写核对字段', 'info'); return false; }
        if (r && r.items && r.items.length > 1) return startQueue(r.common, r.items);
        var ret = origApply.apply(this, arguments);
        window.__qcOcrFormContext = actorContext();
        if (r && r.common && r.common.customer) {
          var previewClient = document.getElementById('ocrClient');
          setV('f_client', previewClient ? previewClient.value : r.common.customer);
        }
        /* number 输入可能把多点原文清空，仍以原识别值标记待人工核对。 */
        if (r && r.items && r.items.length === 1 && typeof window._markOcrQuantity === 'function') {
          var quantity = r.items[0].quantityNeedsReview ? '待核对' : r.items[0].qty;
          var previewQty = document.getElementById('ocrQty');
          if (r.items[0].quantityNeedsReview) {
            var previewNo = document.getElementById('ocrProductNo');
            var previewOrder = document.getElementById('ocrOrderNo');
            setV('f_productNo', previewNo ? previewNo.value : '');
            setV('f_orderNo', previewOrder ? previewOrder.value : '');
            if (typeof window._syncOrderNoNA === 'function') window._syncOrderNoNA();
          }
          if (quantity && typeof window._isIntegerCountText === 'function' && !window._isIntegerCountText(String(quantity)) && !(previewQty && previewQty.value.trim())) setV('f_qty', '');
          window._markOcrQuantity(quantity);
        }
        return ret;
      };
      window.applyOcrToForm.__qcWrapped = true;
    }

    if (typeof window.saveRecord === 'function' && !window.saveRecord.__qcQueueWrapped) {
      var origSave = window.saveRecord;
      window.saveRecord = function () {
        var q = window.__qcQueue;
        var context = window.__qcOcrFormContext || q && q.context;
        if (!canSaveOcr(context)) return false;
        var ret = origSave.apply(this, arguments);
        /* 普通保存可能已关闭弹窗并清理全局状态，仍核对保存前捕获的身份。 */
        if (!sameActor(context)) {
          if (q) window.__qcQueue = q;
          window.__qcOcrFormContext = context;
          canSaveOcr(context);
          return false;
        }
        /* 两种保存按钮共用明确的保存结果；校验取消或本地写入失败时保留当前项。 */
        if (!q || ret !== true) return ret;
        q.idx++;
        if (q.idx < q.items.length) {
          window.__qcQueue = q;
          loadQueueItem(q);
        } else {
          window.__qcQueue = null;
          toast(q.items.length + ' 条货品已在本地录入，等待服务器同步', 'info');
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
        window.__qcOcrFormContext = null;
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
