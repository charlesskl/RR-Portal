/* Tab: spin-labor — SPIN Labor Misc (工时数据) */
const tab_spin_labor = {
  render(versionData) {
    const all = versionData.sewing_details || [];
    const activeSub = versionData._activeSub;
    const subProducts = [...new Set(all.map(d => d.sub_product || d.product_name || '').filter(Boolean))];
    const filtered = subProducts.length > 1 && activeSub
      ? all.filter(d => (d.sub_product || d.product_name || '') === activeSub)
      : all;

    const params  = versionData.params || {};
    const hkd_usd = parseFloat(params.hkd_usd) || 7.75;
    const rmb_hkd = parseFloat(params.rmb_hkd) || 0.85;
    const rmbUsdRate = rmb_hkd * hkd_usd;

    // ── Sewing Labor ─────────────────────────────────────────────────────────
    const LABOR_NAMES = /^(半成品人工|裁床人工|车缝人工|手工人工)/;
    const laborItems = filtered.filter(d => d.position === '__labor__' && LABOR_NAMES.test(d.fabric_name || ''));
    const laborTotal = laborItems.reduce((s, d) => {
      const rateUsd = (parseFloat(d.material_price_rmb) || 0) / rmbUsdRate;
      return s + rateUsd * (parseFloat(d.usage_amount) || 0);
    }, 0);

    const laborRows = laborItems.map(d => {
      const rateUsd = (parseFloat(d.material_price_rmb) || 0) / rmbUsdRate;
      const amount  = rateUsd * (parseFloat(d.usage_amount) || 0);
      return `
        <tr>
          <td class="center"><input type="checkbox" class="row-check-labor" data-id="${d.id}"></td>
          <td class="editable-labor" data-id="${d.id}" data-field="fabric_name" data-type="text">${escapeHtml(d.fabric_name || '')}</td>
          <td class="editable-labor num" data-id="${d.id}" data-field="material_price_rmb" data-type="number">${formatNumber(rateUsd, 4)}</td>
          <td class="editable-labor num" data-id="${d.id}" data-field="usage_amount" data-type="number">${formatNumber(d.usage_amount, 4)}</td>
          <td class="num">${formatNumber(amount, 4)}</td>
        </tr>
      `;
    }).join('');

    // ── Electronics Assembly ─────────────────────────────────────────────────
    const elecSummary = versionData.electronic_summary || {};
    const elecLaborUsd = parseFloat(elecSummary.labor_cost) || 0;

    return `
      <div class="spin-section">
        <div class="spin-section-header">
          <div class="spin-section-accent" style="background:#e74c3c"></div>
          <span class="spin-section-title">Labor Misc <span class="spin-section-subtitle">工时数据</span></span>
          <button class="btn btn-primary" id="spinLaborAdd">+ 添加</button>
          <button class="btn btn-danger" id="spinLaborDel">删除</button>
          <span class="spin-section-total">Sub Total: ${formatNumber(laborTotal, 4)} USD</span>
        </div>
        <div class="spin-section-body">
          <div class="data-table-wrap">
            <table class="data-table">
              <thead><tr>
                <th style="width:30px"><input type="checkbox" id="spinLaborAll"></th>
                <th>Description</th><th>Labor rate (US$/hr)</th><th>Standard Hour</th><th>US$ per toy</th>
              </tr></thead>
              <tbody>${laborRows || '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:12px">暂无数据，点击 + 添加</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="spin-section">
        <div class="spin-section-header">
          <div class="spin-section-accent" style="background:#2980b9"></div>
          <span class="spin-section-title">Electronics Assembly <span class="spin-section-subtitle">电子装配工时</span></span>
          <span class="spin-section-total">Sub Total: ${formatNumber(elecLaborUsd, 4)} USD</span>
        </div>
        <div class="spin-section-body">
          <div class="data-table-wrap">
            <table class="data-table">
              <thead><tr>
                <th>Description</th><th>Labor rate (US$/hr)</th><th>Standard Hour</th><th>US$ per toy</th>
              </tr></thead>
              <tbody>
                <tr>
                  <td>Electronics Assembly</td>
                  <td class="num">3.2260</td>
                  <td class="num">${formatNumber(elecLaborUsd / 3.226, 4)}</td>
                  <td class="num">${formatNumber(elecLaborUsd, 4)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  },

  init(container, versionData, versionId) {
    const all = versionData.sewing_details || [];
    const activeSub = versionData._activeSub;
    const subProducts = [...new Set(all.map(d => d.sub_product || d.product_name || '').filter(Boolean))];
    const filtered = subProducts.length > 1 && activeSub
      ? all.filter(d => (d.sub_product || d.product_name || '') === activeSub)
      : all;
    const LABOR_NAMES = /^(半成品人工|裁床人工|车缝人工|手工人工)/;
    const laborItems = filtered.filter(d => d.position === '__labor__' && LABOR_NAMES.test(d.fabric_name || ''));

    const params     = versionData.params || {};
    const hkd_usd   = parseFloat(params.hkd_usd) || 7.75;
    const rmb_hkd   = parseFloat(params.rmb_hkd) || 0.85;
    const rmbUsdRate = rmb_hkd * hkd_usd;

    container.querySelector('#spinLaborAll')?.addEventListener('change', e => {
      container.querySelectorAll('.row-check-labor').forEach(c => c.checked = e.target.checked);
    });

    container.querySelector('#spinLaborAdd')?.addEventListener('click', async () => {
      try {
        const sub = activeSub || '';
        await api.addSectionItem(versionId, 'sewing-detail', { fabric_name: '', position: '__labor__', usage_amount: 0, material_price_rmb: 0, sub_product: sub, product_name: sub });
        app.refresh();
      } catch (e) { showToast('添加失败: ' + e.message, 'error'); }
    });

    container.querySelector('#spinLaborDel')?.addEventListener('click', async () => {
      const ids = [...container.querySelectorAll('.row-check-labor:checked')].map(c => c.dataset.id);
      if (!ids.length) return showToast('请先选择要删除的行', 'info');
      if (!confirm(`确定删除 ${ids.length} 行？`)) return;
      try {
        await Promise.all(ids.map(id => api.deleteSectionItem(versionId, 'sewing-detail', id)));
        app.refresh();
      } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
    });

    container.querySelectorAll('td.editable-labor').forEach(td => {
      const id = td.dataset.id, field = td.dataset.field, type = td.dataset.type;
      const item = laborItems.find(m => String(m.id) === id);
      if (!item) return;
      // Display value: convert RMB rate → USD for material_price_rmb field
      const displayVal = field === 'material_price_rmb'
        ? (parseFloat(item[field]) || 0) / rmbUsdRate
        : item[field];
      makeEditable(td, {
        type, value: displayVal,
        onSave: async (val) => {
          try {
            // Store back as RMB
            const saveVal = field === 'material_price_rmb'
              ? parseFloat(val) * rmbUsdRate
              : val;
            await api.updateSectionItem(versionId, 'sewing-detail', id, { [field]: saveVal });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });
  },
};
