/* 未完成订单单独暂存，不进入正式订单流程。 */
(() => {
  const source = location.pathname.endsWith('/assembly.html') ? 'assembly' : 'engineering';
  const types = { injection: ['啤办单', 'injModal', 'inj'], slush: ['搪胶单', 'slushModal', 'slush'], spray: ['喷油单', 'sprayModal', 'spray'], assembly: ['夹具申请单', 'asmModal', 'asm'] };
  window.activeOrderDraftId = null;
  window.activeOrderDraftVersion = null;
  let restoring = false;

  const toolbar = source === 'engineering' ? document.getElementById('newOrderBtn')?.parentElement : document.querySelector('.container-fluid .no-print .d-flex.gap-2.align-items-center');
  if (!toolbar) return;
  const listButton = document.createElement('button');
  listButton.className = 'btn btn-outline-primary';
  listButton.type = 'button';
  listButton.innerHTML = '<i class="bi bi-journal-text me-1"></i>继续录入草稿';
  listButton.onclick = showDrafts;
  toolbar.insertBefore(listButton, toolbar.querySelector('button[onclick="openNewModal()"]'));

  const listEl = document.createElement('div');
  listEl.className = 'modal';
  listEl.id = 'draftListModal';
  listEl.tabIndex = -1;
  listEl.innerHTML = '<div class="modal-dialog modal-lg"><div class="modal-content"><div class="modal-header"><h5 class="modal-title">继续录入草稿</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><p class="text-muted small">草稿尚未提交审核或生产。打开后可继续录入，完成后点击“保存”。</p><div id="draftListContent"></div></div></div></div>';
  document.body.appendChild(listEl);

  for (const [type, [, modalId]] of Object.entries(types)) {
    if (source === 'assembly' && type !== 'assembly') continue;
    const modal = document.getElementById(modalId);
    if (!modal) continue;
    modal.addEventListener('show.bs.modal', () => { if (!restoring) { window.activeOrderDraftId = null; window.activeOrderDraftVersion = null; } });
    modal.addEventListener('hide.bs.modal', event => { if (modal._savingDraft) event.preventDefault(); });
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-outline-primary';
    button.innerHTML = '<i class="bi bi-journal-check me-1"></i>保存并继续录入';
    button.onclick = () => saveDraft(type, modal, button);
    const footer = modal.querySelector('.modal-footer');
    footer.insertBefore(button, footer.lastElementChild);
  }

  function inputs(root) { return Array.from(root.querySelectorAll('input:not([type=file]), select, textarea')); }
  function values(root) { return inputs(root).map(el => ({value: el.value, checked: el.checked})); }
  function restoreValues(root, saved) {
    const elements = inputs(root);
    if (!Array.isArray(saved) || elements.length !== saved.length) throw new Error('草稿表单结构已变化，无法自动恢复');
    elements.forEach((el, i) => {
      const v = saved[i];
      if (el.tagName === 'SELECT' && v.value && !Array.from(el.options).some(o => o.value === v.value)) el.add(new Option(v.value, v.value));
      el.value = v.value;
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!v.checked;
    });
  }
  function capture(modal, type) {
    const tbody = modal.querySelector('tbody');
    return {
      version: 1,
      headers: inputs(modal.querySelector('.modal-body')).filter(el => !el.closest('tbody')).map(el => ({id:el.id, value:el.value, checked:el.checked})),
      rows: Array.from(tbody?.querySelectorAll('tr') || []).map(tr => ({
        values: values(tr),
        mixed: !!tr.querySelector('.mat-row-2:not(.d-none)'),
        sub: !!tr.querySelector('[name="mold_id"][style*="background"]'),
        img: tr._img || null, quote: tr._quote || null
      })),
      images: source === 'assembly' && type === 'assembly' ? asmImages : null
    };
  }
  async function saveDraft(type, modal, button) {
    if (button.disabled) return;
    if (type === 'assembly' && ((source === 'assembly' && asmImagesPending > 0) || Array.from(modal.querySelectorAll('tbody tr')).some(tr => tr._imgPending || tr._imgError))) { showToast('图片正在处理或处理失败，请处理后再保存草稿', 'warning'); return; }
    const user = source === 'engineering' ? currentUser : (document.getElementById('asm-applicant')?.value.trim() || '夹具部');
    if (!user) { showLoginModal(); return; }
    modal._savingDraft = true;
    const footerButtons = Array.from(modal.querySelectorAll('.modal-footer button'));
    const disabledStates = footerButtons.map(el => el.disabled);
    footerButtons.forEach(el => { el.disabled = true; });
    try {
      const prefix = types[type][2];
      const number = document.getElementById(`${prefix}-order_number`)?.value.trim() || '';
      const product = document.getElementById(`${prefix}-product_name`)?.value.trim() || '';
      const orderId = document.getElementById(`${prefix}-id`)?.value || null;
      const response = await apiFetch('/api/order-drafts', {method:'POST', headers:{'Content-Type':'application/json', 'X-User':encodeURIComponent(user)}, body:JSON.stringify({id:window.activeOrderDraftId, base_version:window.activeOrderDraftVersion, type, source, order_id:orderId, title:[number, product].filter(Boolean).join(' / '), base_updated_at: modal.dataset.orderUpdatedAt || null, payload:capture(modal, type)})});
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || '保存失败');
      window.activeOrderDraftId = data.id;
      window.activeOrderDraftVersion = data.version;
      showToast('草稿已保存，可以继续录入或稍后打开', 'success');
    } catch (e) { showToast(e.message || '草稿保存失败，请重试', 'danger'); }
    finally {
      modal._savingDraft = false;
      footerButtons.forEach((el, i) => { el.disabled = disabledStates[i]; });
      if (type === 'assembly' && source === 'engineering') updateAsmSaveButton();
    }
  }
  async function showDrafts() {
    bootstrap.Modal.getOrCreateInstance(listEl).show();
    await refreshDrafts();
  }
  async function refreshDrafts() {
    const container = document.getElementById('draftListContent');
    container.textContent = '加载中…';
    try {
      const response = await apiFetch('/api/order-drafts?source=' + source);
      const drafts = await response.json();
      if (!response.ok) throw new Error(drafts.error || '加载失败');
      container.innerHTML = '';
      if (!drafts.length) { container.textContent = '暂无草稿'; return; }
      for (const draft of drafts) {
        const row = document.createElement('div');
        row.className = 'border rounded p-3 mb-2 d-flex align-items-center justify-content-between gap-2';
        const text = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = `${types[draft.type]?.[0] || '单据'}：${draft.title || '未填写名称'}`;
        const time = document.createElement('div');
        time.className = 'text-muted small';
        time.textContent = '保存时间：' + new Date(draft.updated_at).toLocaleString('zh-CN');
        text.append(title, time);
        const actions = document.createElement('div');
        actions.className = 'd-flex gap-2';
        const open = document.createElement('button');
        open.className = 'btn btn-primary btn-sm'; open.textContent = '继续录入';
        open.onclick = () => resumeDraft(draft.id);
        const del = document.createElement('button');
        del.className = 'btn btn-outline-danger btn-sm'; del.textContent = '删除';
        del.onclick = async () => {
          if (!confirm('确定删除这份草稿吗？')) return;
          try { const user = source === 'engineering' ? currentUser : '夹具部'; if (!user) { showLoginModal(); return; } const r = await apiFetch('/api/order-drafts/' + draft.id, {method:'DELETE', headers:{'Content-Type':'application/json','X-User':encodeURIComponent(user)},body:JSON.stringify({base_version:draft.version})}); const result = await r.json(); if (!r.ok) throw new Error(result.error || '删除失败，请重试'); await refreshDrafts(); }
          catch (e) { showToast(e.message || '删除失败，请重试', 'danger'); }
        };
        actions.append(open, del); row.append(text, actions); container.appendChild(row);
      }
    } catch (e) { container.textContent = '草稿加载失败，请重试'; }
  }
  async function resumeDraft(id) {
    try {
      const r = await apiFetch('/api/order-drafts/' + id);
      const draft = await r.json();
      if (!r.ok || draft.error || draft.source !== source) throw new Error(draft.error || '草稿不可用');
      const [name, modalId, prefix] = types[draft.type];
      if (draft.order_id) {
        const currentResponse = await apiFetch(`/api/${draft.type}/${draft.order_id}`);
        const current = await currentResponse.json();
        if (!currentResponse.ok) throw new Error('原单据已不存在，无法继续编辑该草稿');
        if (source === 'engineering' && !(draft.type === 'assembly' ? ['未报价','已驳回'].includes(current.status) : (!lockedStatuses.includes(current.status) || isManager()))) throw new Error('原单据当前状态不允许修改');
        if (source === 'assembly' && !['未报价','已驳回'].includes(current.status)) throw new Error('原单据当前状态不允许修改');
      }
      if (source === 'engineering') {
        const tab = document.querySelector(`.type-tabs a[onclick*="'${draft.type}'"]`);
        if (tab) switchTab(draft.type, tab);
        if (draft.type === 'injection' && _matPrices.length === 0) {
          const prices = await apiFetch('/api/material-prices');
          if (!prices.ok) throw new Error('原料列表加载失败');
          _matPrices = await prices.json();
        }
      }
      const modal = document.getElementById(modalId);
      modal.dataset.orderUpdatedAt = draft.base_updated_at || '';
      const tbody = modal.querySelector('tbody');
      const body = modal.querySelector('.modal-body');
      if (draft.payload.version !== 1 || !Array.isArray(draft.payload.headers) || !Array.isArray(draft.payload.rows)) throw new Error('草稿格式不兼容');
      const headerInputs = inputs(body).filter(el => !el.closest('tbody'));
      if (headerInputs.length !== draft.payload.headers.length || headerInputs.some((el, i) => el.id !== draft.payload.headers[i].id)) throw new Error('草稿表单结构已变化，无法自动恢复');
      headerInputs.forEach((el, i) => {
        const v = draft.payload.headers[i];
        if (el.tagName === 'SELECT' && v.value && !Array.from(el.options).some(o => o.value === v.value)) el.add(new Option(v.value, v.value));
        el.value = v.value;
        if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!v.checked;
      });
      tbody.innerHTML = '';
      if (draft.type === 'assembly') { if (source === 'assembly') _rowSeq = 0; else _asmRowSeq = 0; }
      draft.payload.rows.forEach(row => {
        if (draft.type === 'injection') addInjRow({}, !!row.sub);
        else if (draft.type === 'slush') addSlushRow();
        else if (draft.type === 'spray') addSprayRow();
        else addAsmRow();
        const tr = tbody.lastElementChild;
        if (draft.type === 'injection' && row.mixed) matToggleMixed(tr.querySelector('.mat-toggle'));
        restoreValues(tr, row.values);
        const img = row.img || {};
        if ((img.name && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(img.name)) || (img.dataUrl && !/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(img.dataUrl))) throw new Error('草稿图片格式无效');
        tr._img = img; tr._quote = row.quote || {};
        if (draft.type === 'assembly') renderAsmRowImage(tr);
      });
      if (draft.type === 'assembly') {
        if (source === 'assembly') { _rowSeq = tbody.querySelectorAll('tr').length; asmImages = (draft.payload.images || []).map(im => { if (im.isNew) { if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(im.dataUrl || '')) throw new Error('草稿图片格式无效'); return {isNew:true,dataUrl:im.dataUrl}; } if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(im.name || '')) throw new Error('草稿图片格式无效'); return {name:im.name,dataUrl:asmImgUrl(draft.order_id, im.name)}; }); renderAsmImages(); }
        else _asmRowSeq = tbody.querySelectorAll('tr').length;
      }
      if (draft.type === 'injection') refreshMatSummary();
      if (draft.type === 'assembly' && source === 'engineering') updateAsmSaveButton();
      document.getElementById(prefix + 'ModalTitle').textContent = '继续录入' + name + '（草稿）';
      const listInstance = bootstrap.Modal.getInstance(listEl);
      if (listInstance) await new Promise(resolve => { listEl.addEventListener('hidden.bs.modal', resolve, {once:true}); listInstance.hide(); });
      restoring = true;
      bootstrap.Modal.getOrCreateInstance(modal).show();
      restoring = false;
      window.activeOrderDraftId = id;
      window.activeOrderDraftVersion = draft.version;
    } catch (e) { restoring = false; showToast(e.message || '打开草稿失败', 'danger'); }
  }
})();
