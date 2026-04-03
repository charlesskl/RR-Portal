/* Tab: bd-others — E. Others (Assembly labor + Sewing labor) */
const tab_bd_others = {
  render(versionData) {
    const params = versionData.params || {};
    const markup = parseFloat(params.markup_body) || 0;
    const rmb_hkd = parseFloat(params.rmb_hkd) || 0.85;

    // ASSEMBLY — HardwareItem with part_category='labor_assembly'
    const hwItems = versionData.hardware_items || [];
    const assemblyItems = hwItems.filter(h => h.part_category === 'labor_assembly');
    const assemblyRows = assemblyItems.map(h => `
      <tr>
        <td>${escapeHtml(h.name || '')}</td>
        <td class="editable num" data-table="hardware-labor" data-id="${h.id}" data-field="new_price" data-type="number">${formatNumber(h.new_price, 2)}</td>
      </tr>
    `).join('');
    const assemblySub = assemblyItems.reduce((s, h) => s + (parseFloat(h.new_price) || 0), 0);

    // 4 SEWING — SewingDetail with position='__labor__'
    const sewingDetails = versionData.sewing_details || [];
    const sewingLaborItems = sewingDetails.filter(s => s.position === '__labor__');
    const sewingLaborRows = sewingLaborItems.map(s => {
      const hkd = rmb_hkd > 0 ? (parseFloat(s.total_price_rmb) || 0) / rmb_hkd : 0;
      return `
        <tr>
          <td>车缝人工 Sewing Labour</td>
          <td class="editable num" data-table="sewing-labor" data-id="${s.id}" data-field="material_price_rmb" data-type="number">${formatNumber(s.material_price_rmb, 2)} RMB ≈ ${formatNumber(hkd, 2)} HK$</td>
        </tr>
      `;
    }).join('');
    const sewingLaborSub = sewingLaborItems.reduce((sum, s) => {
      return sum + (rmb_hkd > 0 ? (parseFloat(s.total_price_rmb) || 0) / rmb_hkd : 0);
    }, 0);

    const subTotal = assemblySub + sewingLaborSub;
    const amount = subTotal * (1 + markup);

    return `
      <div class="toolbar">
        <span class="toolbar-title">E. Others</span>
        <span class="toolbar-spacer"></span>
        <span class="toolbar-stats">
          Sub Total: <b>${formatNumber(subTotal, 2)}</b> &nbsp;|&nbsp;
          Mark Up: <b>${(markup * 100).toFixed(1)}%</b> &nbsp;|&nbsp;
          Amount: <b>${formatNumber(amount, 2)}</b>
        </span>
      </div>

      <div class="pur-section" style="margin-top:8px;">
        <div class="toolbar"><span class="toolbar-title">ASSEMBLY &nbsp;<span style="font-weight:normal;color:#888">Sub: ${formatNumber(assemblySub, 2)} HK$</span></span></div>
        <div class="data-table-wrap">
          <table class="data-table">
            <thead><tr><th>项目</th><th>金额 (HK$)</th></tr></thead>
            <tbody>
              ${assemblyRows || '<tr><td colspan="2" style="text-align:center;color:#aaa;padding:10px">暂无</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="pur-section" style="margin-top:16px;">
        <div class="toolbar"><span class="toolbar-title">OTHER LABOUR - 4 SEWING &nbsp;<span style="font-weight:normal;color:#888">Sub: ${formatNumber(sewingLaborSub, 2)} HK$</span></span></div>
        <div class="data-table-wrap">
          <table class="data-table">
            <thead><tr><th>项目</th><th>金额</th></tr></thead>
            <tbody>
              ${sewingLaborRows || '<tr><td colspan="2" style="text-align:center;color:#aaa;padding:10px">暂无</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  init(container, versionData, versionId) {
    // Assembly labor editable
    const hwItems = versionData.hardware_items || [];
    const assemblyItems = hwItems.filter(h => h.part_category === 'labor_assembly');
    container.querySelectorAll('td.editable[data-table="hardware-labor"]').forEach(td => {
      const id    = td.dataset.id;
      const field = td.dataset.field;
      const item  = assemblyItems.find(h => String(h.id) === id) || {};
      makeEditable(td, {
        type: 'number',
        value: item[field],
        onSave: async (val) => {
          try {
            await api.updateSectionItem(versionId, 'hardware', id, { [field]: val });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });

    // Sewing labor editable
    const sewingDetails = versionData.sewing_details || [];
    const sewingLaborItems = sewingDetails.filter(s => s.position === '__labor__');
    container.querySelectorAll('td.editable[data-table="sewing-labor"]').forEach(td => {
      const id    = td.dataset.id;
      const field = td.dataset.field;
      const item  = sewingLaborItems.find(s => String(s.id) === id) || {};
      makeEditable(td, {
        type: 'number',
        value: item[field],
        onSave: async (val) => {
          try {
            await api.updateSectionItem(versionId, 'sewing-detail', id, { [field]: val });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });
  },
};
