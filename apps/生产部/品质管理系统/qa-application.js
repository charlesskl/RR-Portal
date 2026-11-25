/* QA 申请表：从验货记录带入基础资料，样板信息在导出前填写。 */
(function () {
  'use strict';
  const baseURL = new URL('.', document.currentScript?.src || location.href);
  let session = null;
  let busy = false;
  let previewFit = true;
  let previewObserver = null;
  const pendingWrites = new Map();
  const closingWrites = new Map();
  const reliability = [
    ['Aesthetics','外观检查'],['Functional Test','功能测试'],['Transit Test','运输测试'],
    ['Carton compressive','压箱测试'],['Aging Test','老化测试'],['Low Temperature','低温测试'],
    ['Humidity Test','湿度测试'],['Pre-conditioning','高/低电压'],['Current Test','电流测试'],
    ['Drop Test','跌落测试'],['Torque Test','扭力测试'],['Tension Test','拉力测试'],
    ['Compression Test','压力测试'],['Impact Test','冲击测试'],['Bite Test','咬力测试'],
    ['Operation Force','操作力度'],['Salt Spray Test','盐水测试'],['Adhesion Test','粘油测试'],
    ['Abrasion Test','擦油测试'],['Impact Test','冲击测试'],['Crocking Test','干湿磨'],
  ];
  const rightTests = [
    ['LUX','光强度'],['Magnetic Field','磁场强度'],['Label Test','贴纸测试'],['PVC Curing','搪胶生熟度'],
    ['Hardness','硬度测试'],['Hang the load','悬挂吊重'],['Life Test','寿命测试'],['Other Test','其它测试'],
    null,
    ['Sharp Point Test','尖点测试'],['Sharp Edge Test','利边测试'],['Small Part/Ball','小物件/小球'],
    ['Sound Level','声压水平'],['Cord','绳索测试'],['Projectile','凸出物'],['Projectile Toys','弹射玩具'],
    ['Polybag','胶袋'],['Bite Test','咬力测试'],['Battery box assessed','电池箱评估'],
    ['Flammability','燃烧测试'],['Other Test','其它测试'],
  ];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const value = key => document.getElementById('qa_' + key)?.value || '';
  const checked = key => [...document.querySelectorAll('[name="qa_' + key + '"]:checked')].map(el => el.value);
  const box = checked => `<span class="qa-check${checked ? ' checked' : ''}"></span>`;
  const field = (key, label, type = 'text', extra = '') => `<label class="form-group"><span>${label}</span><input class="form-input" id="qa_${key}" type="${type}" ${extra}></label>`;

  function actor() {
    const auth = window.__QC_AUTH;
    const company = typeof getCompany === 'function' ? getCompany() : '';
    if (!auth?.user?.enabled || auth.company !== company || !canView('records')) throw new Error('请登录当前公司的品质账号后再生成申请表');
    const info = typeof QC_COMPANIES !== 'undefined' && QC_COMPANIES.find(c => c.id === company);
    if (!info) throw new Error('无法确认当前子公司');
    return { auth, user:auth.user, username:auth.user.username, csrfToken:auth.csrfToken, company, info,
      editable:typeof effPerms === 'function' && !!effPerms(auth.user)?.records?.e };
  }
  function checkActor(expected) {
    const now = actor();
    if (now.auth !== expected.auth || now.user !== expected.user || now.username !== expected.username ||
        now.csrfToken !== expected.csrfToken || now.company !== expected.company) throw new Error('登录或子公司已切换，请重新打开申请表');
  }
  function generationDate() {
    return typeof todayStr === 'function' ? todayStr() : _todayStr();
  }
  function syncGenerationDate(context = session) {
    if (!context) return false;
    const date = generationDate();
    const input = document.getElementById('qa_receivedDate');
    const changed = input.value !== date;
    context.generationDate = date;
    input.value = date;
    return changed;
  }
  function singleNameInDescription(data, context = session) {
    if (context?.recordIds || !data || typeof data.productName !== 'string' || !data.productName.trim()) return data;
    const name = data.productName.trim();
    const description = typeof data.description === 'string' ? data.description : '';
    const listed = description.split('\n').some(line => line.trim().replace(/^\d+[.、．]\s*/, '') === name);
    const numbered = listed ? description : '1. ' + name + (description ? '\n' + description : '');
    // Keep valid legacy forms saveable when moving the name would exceed the server limit.
    // Neither the original name nor notes may be truncated to force the new layout.
    if (numbered.length > 2000) return data;
    return { ...data, productName:'', description:numbered };
  }
  function sameEditableValues(left, right) {
    const normalize = data => ({ ...singleNameInDescription(data), receivedDate:'',
      requester:typeof data?.requester === 'string' && data.requester.trim() ? data.requester : session?.defaults?.requester || '',
      supplier:typeof data?.supplier === 'string' ? data.supplier : session?.defaults?.supplier || '',
      deliveryNo:typeof data?.deliveryNo === 'string' ? data.deliveryNo : session?.defaults?.deliveryNo || '' });
    return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
  }
  function formValues() {
    const result = {};
    ['customer','productName','productNo','department','requester','ageGrade','source','receivedDate',
      'sampleQty','description','reportNo','stage','purpose','language'].forEach(key => { result[key] = value(key); });
    result.standards = checked('standard').sort();
    result.tests = checked('test').sort();
    result.supplier = value('supplier');
    result.deliveryNo = value('deliveryNo');
    return result;
  }
  function draftKey(context) {
    return 'xingxin_qms_qa_application_draft:' + context.company + ':' + encodeURIComponent(context.username) + ':' + context.record.id;
  }
  function readDraft(context) {
    try {
      const raw = localStorage.getItem(draftKey(context));
      if (!raw || raw.length > (context.recordIds ? 100000 : 16000)) return null;
      const item = JSON.parse(raw);
      return item && item.company === context.company && item.username === context.username && String(item.recordId) === String(context.record.id) &&
        (item.baseVersion === null || Number.isSafeInteger(item.baseVersion) && item.baseVersion >= 0) && item.data && typeof item.data === 'object' ? item : null;
    } catch (_) { return null; }
  }
  function keepDraft(context, data) {
    context.lastModel = data;
    try {
      localStorage.setItem(draftKey(context),JSON.stringify({ company:context.company,username:context.username,
        recordId:context.record.id,baseVersion:context.version ?? null,data,updatedAt:new Date().toISOString() }));
      context.localKept = true;
    } catch (_) { context.localKept = false; }
  }
  function removeMatchingDraft(context, json) {
    const draft = readDraft(context);
    if (draft && JSON.stringify(draft.data) === json) {
      try { localStorage.removeItem(draftKey(context)); } catch (_) {}
    }
  }
  function applyValues(data) {
    data = singleNameInDescription(data);
    for (const key of ['customer','productName','productNo','department','requester','ageGrade','source','receivedDate','sampleQty','description','reportNo','stage','purpose','language','supplier','deliveryNo']) {
      if (key !== 'receivedDate' && typeof data[key] === 'string') document.getElementById('qa_' + key).value = data[key];
    }
    if (typeof data.requester !== 'string' || !data.requester.trim()) document.getElementById('qa_requester').value = session?.defaults?.requester || '';
    document.getElementById('qa_receivedDate').value = session?.generationDate || generationDate();
    document.querySelectorAll('[name="qa_standard"],[name="qa_test"]').forEach(el => {
      const list = el.name === 'qa_standard' ? data.standards : data.tests;
      el.checked = Array.isArray(list) && list.includes(el.value);
    });
  }
  function saveStatus(context, message, error = false) {
    if (session !== context) return;
    const status = document.getElementById('qaSaveStatus');
    status.textContent = message;
    status.classList.toggle('is-error',error);
    const reload = document.getElementById('qaReload');
    reload.hidden = !context.conflicted && !context.loadFailed;
    reload.textContent = context.conflicted ? '采用已保存版本' : '重试读取';
  }
  function savedMessage(application) {
    return '已保存 · ' + new Date(application.updatedAt).toLocaleString('zh-CN') + ' · ' + application.updatedBy;
  }
  function updateControls(context) {
    if (session !== context) return;
    document.querySelectorAll('#qaApplicationForm input,#qaApplicationForm select,#qaApplicationForm textarea').forEach(el => {
      el.disabled = context.loading || busy || !context.editable;
    });
    document.getElementById('qaSave').disabled = !context.editable || context.loading || busy || !context.loaded || context.conflicted;
    document.getElementById('qaExport').disabled = context.loading || busy || !context.loaded;
    document.getElementById('qaPreviewTab').disabled = context.loading || busy;
    document.getElementById('qaReload').disabled = context.loading || busy;
  }
  async function requestApplication(context, method = 'GET', body) {
    checkActor(context);
    if (typeof window.__QC_REQUEST !== 'function') throw new Error('保存服务未加载，请刷新页面后重试');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(),12000);
    try {
      const query = context.recordIds ? 'recordIds=' + encodeURIComponent(context.recordIds.join(',')) : 'recordId=' + encodeURIComponent(context.record.id);
      const response = await window.__QC_REQUEST('/api/qa-application?' + query + '&sourceFields=1',
        { method,signal:controller.signal,...(body ? { headers:{'Content-Type':'application/json'},body:JSON.stringify(body) } : {}) });
      const result = await response.json();
      checkActor(context);
      if (!response.ok || result.ok !== true) { const error = new Error(result.error || '读取或保存失败'); error.status = response.status; throw error; }
      const application = result.application;
      if (application && (String(application.recordId) !== String(context.record.id) || !Number.isSafeInteger(application.version) || application.version < 1 || !application.data)) throw new Error('QA申请返回格式不正确');
      return application;
    } finally { clearTimeout(timeout); }
  }
  async function loadApplication(context, preferSaved = false) {
    if (session !== context) return;
    context.loading = true;
    updateControls(context);
    saveStatus(context,'正在读取已保存申请…');
    try {
      await (closingWrites.get(draftKey(context)) || pendingWrites.get(draftKey(context)) || Promise.resolve());
      if (session !== context) return;
      const application = await requestApplication(context);
      if (session !== context) return;
      context.version = application?.version || 0;
      context.savedJSON = JSON.stringify(application?.data || context.defaults);
      context.loaded = true;
      context.loadFailed = false;
      context.conflicted = false;
      applyValues(application?.data || context.defaults);
      const draft = readDraft(context);
      let restoredDraft = false;
      if (preferSaved) {
        if (draft) removeMatchingDraft(context,JSON.stringify(draft.data));
      } else if (draft && !sameEditableValues(draft.data, application?.data || context.defaults)) {
        applyValues(draft.data);
        restoredDraft = true;
        if (draft.baseVersion !== context.version && !(draft.baseVersion === null && context.version === 0)) context.conflicted = true;
      } else if (application && draft) removeMatchingDraft(context,JSON.stringify(draft.data));
      context.loading = false;
      context.dirty = JSON.stringify(formValues()) !== context.savedJSON;
      updateControls(context);
      if (context.conflicted) saveStatus(context,'本机未保存内容与已保存版本不同，已保留本机内容；请核对后再选择采用已保存版本。',true);
      else if (context.dirty && context.editable) { keepDraft(context,formValues()); saveStatus(context,restoredDraft ? '已恢复本机暂存内容，等待自动保存…' : '申请表已按当前规则更新，等待自动保存…'); scheduleSave(context); }
      else if (context.dirty) saveStatus(context,'已读取申请，按当前填写规则显示（当前账号只读）');
      else saveStatus(context,application ? savedMessage(application) : '尚未保存，填写后会自动保存' + (context.editable ? '' : '（当前账号只读）'));
    } catch (error) {
      if (session !== context) return;
      context.loaded = false; context.loadFailed = true; context.loading = false;
      const draft = readDraft(context); if (draft) applyValues(draft.data);
      saveStatus(context,'暂未读取到已保存申请，填写内容会在本机暂存；请重试读取。' + error.message,true);
      updateControls(context);
    }
  }
  function scheduleSave(context) {
    clearTimeout(context.timer);
    if (!context.editable || !context.loaded || context.conflicted) return;
    context.timer = setTimeout(() => { void saveApplication(context); },700);
  }
  function changedApplication() {
    const context = session;
    if (!context || context.loading || !context.editable || busy) return;
    syncGenerationDate(context);
    const data = formValues();
    const previous = context.lastModel;
    context.lastModel = data;
    // A pending write may still commit the value that the user just reverted.
    context.dirty = !!context.pending || JSON.stringify(data) !== context.savedJSON;
    if (!context.dirty) {
      clearTimeout(context.timer);
      if (previous) removeMatchingDraft(context,JSON.stringify(previous));
      saveStatus(context,context.version > 0 ? '内容与已保存版本一致' : '尚未保存，填写后会自动保存');
      return;
    }
    keepDraft(context,data);
    if (context.conflicted) { saveStatus(context,'申请存在版本冲突，当前填写内容已保留，请核对已保存版本。',true); return; }
    saveStatus(context,context.localKept ? (context.loaded ? '本机已暂存，等待自动保存…' : '本机已暂存，请点击「重试读取」后继续保存。') : '本机暂存失败，请复制填写内容后重试保存。',!context.localKept || !context.loaded);
    scheduleSave(context);
  }
  async function saveApplication(context, supplied) {
    if (!context || !context.editable || !context.loaded || context.conflicted) return false;
    if (context.pending) return context.pending;
    const data = supplied || (session === context ? formValues() : context.lastModel);
    if (!data) return false;
    const json = JSON.stringify(data);
    if (context.version > 0 && json === context.savedJSON) {
      context.lastModel = data;
      removeMatchingDraft(context,json);
      return true;
    }
    keepDraft(context,data);
    saveStatus(context,'正在保存申请…');
    const operation = (async () => {
      try {
        const application = await requestApplication(context,'POST',{baseVersion:context.version,data});
        if (!application) throw new Error('保存响应缺少确认信息');
        context.version = application.version;
        context.savedJSON = JSON.stringify(application.data);
        removeMatchingDraft(context,json);
        if (session === context) {
          context.dirty = JSON.stringify(formValues()) !== context.savedJSON;
          if (context.dirty) { keepDraft(context,formValues()); saveStatus(context,'新修改已暂存，等待继续保存…'); scheduleSave(context); }
          else saveStatus(context,savedMessage(application));
        }
        return true;
      } catch (error) {
        context.conflicted = error.status === 409;
        saveStatus(context,(context.localKept ? '未保存到服务，本机已暂存。' : '保存失败，本机暂存也未成功，请先复制填写内容。') + error.message,true);
        return false;
      } finally {
        context.pending = null;
        if (pendingWrites.get(draftKey(context)) === operation) pendingWrites.delete(draftKey(context));
        updateControls(context);
      }
    })();
    context.pending = operation;
    pendingWrites.set(draftKey(context),operation);
    return operation;
  }
  async function flushApplication(context) {
    if (!context || !context.editable) return !!context?.loaded;
    clearTimeout(context.timer);
    for (let attempt = 0; attempt < 4; attempt++) {
      if (context.pending && !await context.pending) return false;
      const data = session === context ? formValues() : context.lastModel;
      if (!data) return false;
      if (context.version > 0 && JSON.stringify(data) === context.savedJSON) return true;
      if (!await saveApplication(context,data)) return false;
    }
    return false;
  }

  function ensureDialog() {
    let overlay = document.getElementById('qaApplicationOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'qaApplicationOverlay';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<section class="modal qa-application-modal" role="dialog" aria-modal="true" aria-labelledby="qaApplicationTitle">
      <div class="modal-header"><span id="qaApplicationTitle">QA 申请表</span><button type="button" class="modal-close" id="qaClose" aria-label="关闭申请表">✕</button></div>
      <div class="qa-form-tabs"><button type="button" class="mode-tab active" id="qaEditTab">填写申请</button><button type="button" class="mode-tab" id="qaPreviewTab">预览表格</button></div>
      <div class="qa-save-bar"><span id="qaSaveStatus" class="qa-save-status" role="status" aria-live="polite"></span><button type="button" class="btn-secondary" id="qaReload" hidden>重试读取</button></div>
      <div class="modal-body qa-application-body">
        <div id="qaApplicationForm">
          <p class="qa-record-info" id="qaRecordInfo"></p>
          <div class="qa-form-grid">
            ${field('customer','客户', 'text', 'maxlength="120"')}${field('productName','产品名称', 'text', 'maxlength="180"')}${field('productNo','产品编号', 'text', 'maxlength="100"')}
            ${field('department','申请部门', 'text', 'maxlength="80"')}${field('requester','申请人（默认检验员）', 'text', 'maxlength="80" placeholder="自动带入检验员，可修改"')}${field('ageGrade','年龄（选填）', 'text', 'maxlength="40" list="qa_age_options" placeholder="选择或手动填写年龄"')}<datalist id="qa_age_options">${['3+','6+','6M+','18M+'].map(v => `<option value="${v}"></option>`).join('')}</datalist>
            ${field('source','样板来源', 'text', 'maxlength="80"')}${field('receivedDate','到板日期（生成当天）', 'date', 'readonly')}${field('sampleQty','样板数量', 'text', 'maxlength="60" list="qa_quantity_options" placeholder="选择或手动填写数量"')}<datalist id="qa_quantity_options">${['6PCS','12PCS','24PCS'].map(v => `<option value="${v}"></option>`).join('')}</datalist>
            <label class="form-group qa-form-wide"><span>样板描述</span><textarea class="form-input" id="qa_description" rows="5" maxlength="2000" placeholder="填写样板状态、测试要求或需要说明的内容"></textarea></label>
            <div class="qa-form-wide qa-source-fields">${field('supplier','供应商（描述栏底部）','text','maxlength="2000"')}${field('deliveryNo','送货单号（描述栏底部）','text','maxlength="4000"')}</div>
            ${field('reportNo','报告编号（可修改）', 'text', 'maxlength="100"')}
            <label class="form-group"><span>报告语言</span><select class="form-input" id="qa_language"><option value="zh">中文报告</option><option value="en">ENG.REP</option></select></label>
            <label class="form-group"><span>测试阶段（选填）</span><select class="form-input" id="qa_stage"><option value="">未选择</option>${['ES/EP','FEP','PP','PS','Others'].map(v => `<option>${v}</option>`).join('')}</select></label>
            <label class="form-group qa-form-wide"><span>测试目的（选填）</span><input class="form-input" id="qa_purpose" maxlength="180"></label>
          </div>
          <details class="qa-test-options"><summary>测试标准及测试项目（选填）</summary>
            <div class="qa-check-options">${['ASTM F963','EN71','EN62115','Customer Requirement 客户要求'].map((v,i) => `<label><input type="checkbox" name="qa_standard" value="${i}">${esc(v)}</label>`).join('')}</div>
            <div class="qa-test-grid">${reliability.map((v,i) => `<label><input type="checkbox" name="qa_test" value="L${i}">${esc(v[1])} / ${esc(v[0])}</label>`).join('')}${rightTests.map((v,i) => v ? `<label><input type="checkbox" name="qa_test" value="R${i}">${esc(v[1])} / ${esc(v[0])}</label>` : '').join('')}</div>
          </details>
          <p class="qa-record-info">测试结果、结论及签名留空，供测试后填写。</p>
        </div>
        <div id="qaApplicationPreview" class="qa-preview-panel" hidden>
          <div class="qa-preview-toolbar">
            <button type="button" class="btn-secondary" id="qaFitWidth" aria-pressed="true">适应宽度</button>
            <button type="button" class="btn-secondary" id="qaOriginalSize" aria-pressed="false">原尺寸</button>
            <span id="qaPreviewScale" role="status"></span>
          </div>
          <p class="qa-preview-warning" id="qaPreviewWarning" role="status" hidden></p>
          <div id="qaPreviewViewport" class="qa-preview-scroll"></div>
        </div>
      </div>
      <div class="modal-footer"><button type="button" class="btn-secondary" id="qaCancel">关闭</button><button type="button" class="btn-secondary" id="qaSave">保存申请</button><button type="button" class="btn-primary" id="qaExport">导出 QA 申请表 PDF</button></div>
    </section>`;
    overlay.querySelector('#qaClose').onclick = () => closeQAApplication();
    overlay.querySelector('#qaCancel').onclick = () => closeQAApplication();
    overlay.querySelector('#qaEditTab').onclick = () => showPanel(false);
    overlay.querySelector('#qaPreviewTab').onclick = () => showPanel(true);
    overlay.querySelector('#qaExport').onclick = exportQAApplicationPDF;
    overlay.querySelector('#qaSave').onclick = () => { syncGenerationDate(); void flushApplication(session); };
    overlay.querySelector('#qaReload').onclick = () => { if (session) void loadApplication(session,session.conflicted); };
    overlay.querySelector('#qaApplicationForm').addEventListener('input',changedApplication);
    overlay.querySelector('#qaApplicationForm').addEventListener('change',changedApplication);
    overlay.querySelector('#qaFitWidth').onclick = () => { previewFit = true; resizePreview(); };
    overlay.querySelector('#qaOriginalSize').onclick = () => { previewFit = false; resizePreview(); };
    if (typeof ResizeObserver === 'function') {
      previewObserver = new ResizeObserver(resizePreview);
      previewObserver.observe(overlay.querySelector('#qaPreviewViewport'));
    } else window.addEventListener('resize', resizePreview);
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); closeQAApplication(); }
      if (event.key !== 'Tab') return;
      const focusable = [...overlay.querySelectorAll('button,input,select,textarea,summary')].filter(el => !el.disabled && el.getClientRects().length);
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
      if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0]?.focus(); }
    });
    document.getElementById('appWrapper')?.appendChild(overlay) || document.body.appendChild(overlay);
    return overlay;
  }

  function sourceDefaults(records) {
    const groups = new Map();
    for (const record of records) {
      const supplier = String(record.supplier ?? '').trim();
      if (!groups.has(supplier)) groups.set(supplier,new Set());
      groups.get(supplier).add(String(record.deliveryNo ?? '').trim());
    }
    const supplier = [...groups.keys()].map(name => name || (groups.size > 1 ? '未填写供应商' : '')).join('、');
    const deliveries = values => [...values].map(value => value || (values.size > 1 ? '未填写' : '')).join('、');
    const deliveryNo = groups.size === 1 ? deliveries([...groups.values()][0])
      : [...groups].map(([name,values]) => (name || '未填写供应商') + '：' + (deliveries(values) || '未填写')).join('；');
    if (supplier.length > 2000 || deliveryNo.length > 4000) throw new Error('所选来源资料过多，请减少记录后再生成申请');
    return { supplier,deliveryNo };
  }
  function applicationSelection(recordId, data, today) {
    const combined = Array.isArray(recordId);
    const ids = combined ? recordId : [recordId];
    if (!ids.length || combined && (ids.length < 2 || ids.length > 100) ||
        ids.some(id => !Number.isSafeInteger(Number(id)) || Number(id) < 1) || new Set(ids.map(Number)).size !== ids.length) {
      throw new Error('合并申请请选择 2 至 100 条有效记录');
    }
    const records = ids.map(id => data.find(r => String(r.id) === String(id)));
    if (records.some(record => !record)) throw new Error('找不到所选的验货记录，请刷新后重新选择');
    const unique = key => [...new Set(records.map(record => String(record[key] ?? '').trim()).filter(Boolean))];
    const productNos = unique('productNo');
    const requester = unique('qc').filter(name => !['0','-','—'].includes(name)).join('、');
    if (requester.length > 80) throw new Error('所选检验员姓名过多，请减少记录后再生成申请');
    const recordIds = combined ? ids.map(Number).sort((a,b) => a-b) : null;
    const record = combined ? { id:'group:' + recordIds.join(','), supplier:unique('supplier').join('、') } : { ...records[0] };
    const defaults = {
      customer:unique('client').join('、').length <= 120 ? unique('client').join('、') : '',
      productName:'',
      productNo:productNos.join('、').length <= 100 ? productNos.join('、') : '',
      department:'品质部', requester, ageGrade:'', source:'来料',
      receivedDate:today, sampleQty:'',
      description:records.map((item,index) => (index+1) + '. ' + (item.productName || '未填写款式名称') +
        (productNos.length > 1 ? '（货号：' + (item.productNo || '未填写') + '）' : '')).join('\n'),
      reportNo:'QA-' + today.replace(/-/g,'') + '-' + (combined ? 'M' + Date.now() : record.id),
      language:'zh', stage:'', purpose:'', ...sourceDefaults(records),
    };
    return { record,recordIds,records,defaults };
  }
  async function openQAApplication(recordId, trigger = null) {
    try {
      if (busy) return;
      const identity = actor();
      const data = typeof state !== 'undefined' ? state.records : _getData();
      const today = generationDate();
      const selection = applicationSelection(recordId,data,today);
      // Finish the previous form before another selection can replace its fields.
      if (session) closeQAApplication();
      const overlay = ensureDialog();
      session = { ...identity,...selection,trigger,generationDate:today,loading:true,loaded:false,version:null,conflicted:false };
      previewFit = true;
      document.getElementById('qa_description').maxLength = selection.recordIds ? 24000 : 2000;
      for (const [key, v] of Object.entries(selection.defaults)) document.getElementById('qa_' + key).value = String(v);
      overlay.querySelectorAll('input[type="checkbox"]').forEach(el => { el.checked = false; });
      session.defaults = formValues();
      session.savedJSON = JSON.stringify(session.defaults);
      document.getElementById('qaApplicationTitle').textContent = selection.recordIds ? 'QA 申请表（合并 ' + selection.records.length + ' 条）' : 'QA 申请表';
      document.getElementById('qaRecordInfo').textContent = selection.recordIds
        ? '已合并 ' + selection.records.length + ' 条记录，款式名称已按序填入样板描述；再次勾选相同记录可继续编辑此申请。'
        : '来源记录：' + [selection.record.supplier, selection.record.productNo, selection.record.productName].filter(Boolean).join(' · ');
      showPanel(false);
      overlay.classList.add('show');
      const context = session;
      document.getElementById('qaClose').focus();
      await loadApplication(context);
      if (session === context && context.editable) document.getElementById('qa_sampleQty').focus();
    } catch (error) { showToast(error.message, 'error'); }
  }
  function closeQAApplication(force = false) {
    if (busy && !force) return;
    const context = session;
    const trigger = context?.trigger;
    if (context) {
      clearTimeout(context.timer);
      const data = formValues();
      if (!context.loading && (context.pending || JSON.stringify(data) !== context.savedJSON) && context.editable) {
        keepDraft(context,data);
        if (!force) {
          const pending = flushApplication(context);
          closingWrites.set(draftKey(context),pending);
          void pending.finally(() => { if (closingWrites.get(draftKey(context)) === pending) closingWrites.delete(draftKey(context)); });
        }
      }
    }
    document.getElementById('qaApplicationOverlay')?.classList.remove('show');
    document.getElementById('qaPreviewViewport')?.replaceChildren();
    document.querySelectorAll('#qaApplicationForm input,#qaApplicationForm textarea').forEach(el => { if (el.type === 'checkbox') el.checked = false; else el.value = ''; });
    session = null;
    if (!force && trigger?.isConnected) trigger.focus();
  }
  function showPanel(preview) {
    if (!session) return;
    try {
      checkActor(session);
      document.getElementById('qaApplicationForm').hidden = preview;
      document.getElementById('qaApplicationPreview').hidden = !preview;
      if (preview) {
        const dateChanged = syncGenerationDate();
        if (dateChanged && session.loaded && session.editable) changedApplication();
        const wrap = document.getElementById('qaPreviewViewport');
        const stage = document.createElement('div');
        stage.className = 'qa-preview-stage';
        stage.appendChild(buildPaper(formValues(), session));
        wrap.replaceChildren(stage);
        wrap.scrollTop = 0;
        wrap.scrollLeft = 0;
      }
      document.getElementById('qaApplicationForm').hidden = preview;
      document.getElementById('qaApplicationPreview').hidden = !preview;
      document.getElementById('qaEditTab').classList.toggle('active', !preview);
      document.getElementById('qaPreviewTab').classList.toggle('active', preview);
      if (preview) {
        fitDescription(document.querySelector('#qaPreviewViewport .qa-paper'));
        resizePreview();
      }
    } catch (error) { showToast(error.message, 'error'); }
  }

  function descriptionFits(description) {
    return description.scrollHeight <= description.clientHeight+1 && description.scrollWidth <= description.clientWidth+1;
  }
  function fillDescriptionRows(description, lineHeight, columns) {
    const maxRows = Math.floor(description.clientHeight/lineHeight) * columns;
    const source = description.querySelector('.qa-description-source');
    for (let index=0; index<maxRows; index++) {
      const row = document.createElement('div');
      row.className = 'qa-description-line qa-description-empty';
      row.setAttribute('aria-hidden','true');
      if (source) description.insertBefore(row,source);
      else description.appendChild(row);
      if (!descriptionFits(description)) { row.remove(); break; }
    }
  }
  function fitDescription(paper) {
    const description = paper.querySelector('.qa-description-content');
    description.querySelectorAll('.qa-description-empty').forEach(row => row.remove());
    // 单条和合并申请统一使用两栏，资料始终补位到右栏底部。
    const layouts = [[10,14,2],[9,13,2],[9,12,2]];
    for (const [size,lineHeight,columns] of layouts) {
      Object.assign(description.style,{ fontSize:size+'px',
        columnCount:String(columns),columnGap:'12px',columnFill:'auto' });
      description.style.setProperty('line-height',lineHeight+'px','important');
      description.style.setProperty('--qa-description-line-height',lineHeight+'px');
      const rules = paper.querySelector('.qa-ruled-lines');
      if (rules) rules.hidden = true;
      if (descriptionFits(description)) {
        fillDescriptionRows(description,lineHeight,columns);
        return true;
      }
    }
    return false;
  }
  function resizePreview() {
    const viewport = document.getElementById('qaPreviewViewport');
    const stage = viewport?.querySelector('.qa-preview-stage');
    const paper = stage?.querySelector('.qa-paper');
    if (!paper || !viewport.clientWidth) return;
    const styles = getComputedStyle(viewport);
    const available = viewport.clientWidth - parseFloat(styles.paddingLeft || 0) - parseFloat(styles.paddingRight || 0);
    if (available <= 0) return;
    const scale = previewFit ? Math.min(1, available / 794) : 1;
    stage.style.width = (794 * scale) + 'px';
    stage.style.height = (1123 * scale) + 'px';
    paper.style.transform = 'scale(' + scale + ')';
    if (previewFit) viewport.scrollLeft = 0;
    document.getElementById('qaPreviewScale').textContent = Math.round(scale * 100) + '%';
    document.getElementById('qaFitWidth').setAttribute('aria-pressed', String(previewFit));
    document.getElementById('qaOriginalSize').setAttribute('aria-pressed', String(!previewFit));
    const warning = document.getElementById('qaPreviewWarning');
    const description = paper.querySelector('.qa-description-content');
    const overflow = paper.scrollHeight > 1124 || paper.scrollWidth > 795 ||
      description.scrollHeight > description.clientHeight+1 || description.scrollWidth > description.clientWidth+1;
    warning.hidden = !overflow;
    warning.textContent = overflow ? '内容超出单页可用空间，请精简样板描述或减少合并记录后再导出；不会续页或截断内容。' : '';
  }

  function buildPaper(model, context) {
    const paper = document.createElement('article');
    paper.className = 'qa-paper' + (context.recordIds ? ' qa-combined-paper' : '');
    const companyName = context.info.name.replace(/[A-D]$/, '') + '塑胶制品有限公司';
    const xingxin = context.company === 'dg-xingxin';
    const e = key => esc(model[key]);
    const label = (en,zh) => `${esc(en)}<br>${esc(zh)}`;
    const testRow = (item,index,side) => !item ? `<tr class="qa-safety-heading"><td colspan="6">2) Safety Test 安全性测试</td></tr>`
      : `<tr><td class="qa-test-name">${box(model.tests.includes(side+index))}${esc(item[0])}</td><td class="qa-test-cn">${esc(item[1])}</td><td><span class="qa-ss"></span></td>${Array.from({length:3},() => `<td class="qa-result-box">${box(false)}</td>`).join('')}</tr>`;
    const tests = (items,side) => `<table class="qa-tests"><colgroup><col style="width:35%"><col style="width:27%"><col style="width:14%"><col style="width:8%"><col style="width:8%"><col style="width:8%"></colgroup><thead><tr><th colspan="2">${side==='L'?'1) Reliability Test 可靠性测试':''}</th><th>S/S</th><th>PASS</th><th>FAIL</th><th>INF.</th></tr></thead><tbody>${items.map((item,index) => testRow(item,index,side)).join('')}</tbody></table>`;
    paper.innerHTML = `<header class="qa-paper-header">
      ${xingxin ? `<img class="qa-template-logo" src="${new URL('assets/qa-template-logo.png',baseURL).href}" alt="">` : ''}
      <div class="qa-company-en">${xingxin ? 'DONGGUAN HANSON PLASTIC PRODUCT LTD' : ''}</div>
      <div class="qa-company-cn">${esc(companyName)}</div><div class="qa-document-title">PRODUCT TEST REPORT 产品测试报告</div>
      </header>
      <div class="qa-report-meta"><span>${box(model.language==='zh')}中文报告　${box(model.language==='en')}ENG.REP</span><span>Report No 报告编号: <b>${e('reportNo')}</b></span></div>
      <table class="qa-form-table"><colgroup><col style="width:17.5%"><col style="width:12.5%"><col style="width:23%"><col style="width:18%"><col style="width:17%"><col style="width:12%"></colgroup><tbody>
        <tr class="qa-data-row"><th>${label('Customer','客户')}</th><td>${e('customer')}</td><th>${label('Product Name','产品名称')}</th><td>${e('productName')}</td><th>${label('Product No','产品编号')}</th><td>${e('productNo')}</td></tr>
        <tr class="qa-data-row"><th>${label('Request Department','申请部门')}</th><td>${e('department')}</td><th>${label('Requester','申请人')}</th><td>${e('requester')}</td><th>${label('Age Grade','年龄')}</th><td>${e('ageGrade')}</td></tr>
        <tr class="qa-data-row"><th>${label('Sample Source','样板来源')}</th><td>${e('source')}</td><th>${label('Sample Received Date','到板日期')}</th><td>${e('receivedDate')}</td><th>${label('Sample Quantity','样板数量')}</th><td>${e('sampleQty')}</td></tr>
        <tr class="qa-stage-row"><th>Test Stage 测试阶段</th><td colspan="5">${['ES/EP','FEP','PP','PS','Others'].map(stage => `<span class="qa-choice">${box(model.stage===stage)}${esc(stage==='Others'?'Others 其它':stage)}</span>`).join('')}</td></tr>
        <tr><th class="qa-description-label">Sample Description<br>样板描述</th><td colspan="5" class="qa-description-cell"><div class="qa-description-heading">Product Status or Improvement 产品状态或改进方法/Packing Method 包装方法:</div><div class="qa-description-body"><div class="qa-ruled-lines" aria-hidden="true">${Array.from({length:6},()=>'<span></span>').join('')}</div><div class="qa-description-content qa-description-rows">${String(model.description || '').split('\n').map(line => `<div class="qa-description-line">${esc(line)}</div>`).join('\n')}<div class="qa-description-source"><div class="qa-description-source-line">供应商：${e('supplier')}</div><div class="qa-description-source-line">送货单号：${e('deliveryNo')}</div></div></div></div></td></tr>
        <tr class="qa-purpose-row"><th>${label('Test Purpose','测试目的')}</th><td colspan="5">${e('purpose')}</td></tr>
        <tr class="qa-standard-row"><th>${label('Test Standard','测试标准')}</th><td colspan="5">${['ASTM F963','EN71','EN62115','Customer Requirement 客户要求'].map((standard,i) => `<span class="qa-choice">${box(model.standards.includes(String(i)))}${esc(standard)}</span>`).join('')}</td></tr>
        <tr><td colspan="6" class="qa-tests-cell"><div class="qa-test-columns">${tests(reliability,'L')}${tests(rightTests,'R')}</div></td></tr>
        <tr class="qa-conclusion-row"><td colspan="6">Conclusion 结论：　${box(false)}PASSED 合格　　${box(false)}FAILED 不合格　　${box(false)}INF.ONLY 仅供参考</td></tr>
        <tr class="qa-detail-row"><td colspan="6">Detail Result 详细结果：See Attachment 见附页</td></tr>
        <tr><th>Comments 评论</th><td colspan="5" class="qa-comments"><div class="qa-comment-lines">${Array.from({length:4},()=>'<span></span>').join('')}</div></td></tr>
        <tr class="qa-sign-row"><td colspan="3">Tested By/Date 测试员/日期:</td><td colspan="3">Checked By/Date 审核/日期:</td></tr>
        <tr class="qa-distribution-row"><td colspan="6">Report Distribution：　${['工程部','生产部','PMC','品质部','跟客','其它'].map(v=>box(false)+esc(v)).join('　')}</td></tr>
      </tbody></table><footer class="qa-paper-footer"><span>HSQR0017</span><span>Page:　1　OF　1</span></footer>`;
    return paper;
  }

  async function exportQAApplicationPDF() {
    if (busy || !session) return;
    let host = null;
    const context = session;
    try {
      checkActor(context);
      const missing = _rptCheckDeps();
      if (missing.length) throw new Error('PDF 库未加载，请刷新后重试');
      if (!context.loaded) throw new Error('请先读取已保存申请，避免覆盖其他窗口的内容');
      syncGenerationDate(context);
      if (!value('requester').trim()) { document.getElementById('qa_requester').focus(); throw new Error('请填写实际申请人姓名'); }
      busy = true;
      updateControls(context);
      if (context.editable && !await flushApplication(context)) throw new Error('申请尚未成功保存，请查看保存提示并重试');
      const model = formValues();
      _rptShowOverlay('正在生成 QA 申请表…', '按模板排版');
      const paper = buildPaper(model,context);
      host = document.createElement('div');
      host.className = 'qa-export-host';
      host.appendChild(paper);
      document.body.appendChild(host);
      await document.fonts.ready;
      await Promise.all([...paper.querySelectorAll('img')].map(img => img.decode()));
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (!fitDescription(paper)) throw new Error('样板描述超出单页容量，请精简描述或减少合并记录后再导出');
      if ([...paper.querySelectorAll('.qa-data-row td')].some(td => td.scrollWidth > td.clientWidth+1)) throw new Error('基础资料内容过长，请调整文字后再导出');
      if (paper.scrollHeight > 1124 || paper.scrollWidth > 795) throw new Error('申请表内容超出单页，请精简基础资料后再导出');
      const canvas = await html2canvas(paper,{scale:2,backgroundColor:'#ffffff',logging:false,useCORS:true,windowWidth:794,windowHeight:1123,scrollX:0,scrollY:0});
      const PDF = window.jspdf ? window.jspdf.jsPDF : jsPDF;
      const pdf = new PDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});
      const ratio = Math.min(210/canvas.width,297/canvas.height);
      const width = canvas.width*ratio, height = canvas.height*ratio;
      pdf.addImage(canvas.toDataURL('image/png'),'PNG',(210-width)/2,0,width,height,undefined,'FAST');
      checkActor(context);
      if (session !== context) throw new Error('申请表已关闭，请重新打开后导出');
      const safe = value => String(value || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'').slice(0,60);
      pdf.save('QA申请表_' + safe(context.record.supplier || '供应商') + '_' + safe(model.productNo || '样板') + '_' + model.receivedDate.replace(/-/g,'') + '.pdf');
      showToast('QA 申请表 PDF 已生成','success');
    } catch (error) { showToast('QA申请表生成失败：' + error.message,'error'); }
    finally {
      host?.remove();
      busy = false;
      _rptHideOverlay();
      const button = document.getElementById('qaExport');
      if (session) updateControls(session);
      else if (button) button.disabled = false;
    }
  }
  window.addEventListener('pagehide',() => {
    if (session && session.editable && !session.loading && JSON.stringify(formValues()) !== session.savedJSON) keepDraft(session,formValues());
  });
  window.openQAApplication = openQAApplication;
  window.closeQAApplication = closeQAApplication;
  window.exportQAApplicationPDF = exportQAApplicationPDF;
})();
