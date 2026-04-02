/* Tab: bd-others — E. Others (Assembly labor, sewing labor) */
const tab_bd_others = {
  render(versionData) {
    const params = versionData.params || {};
    const markup = parseFloat(params.markup_body) || 0;
    const rmb_hkd = parseFloat(params.rmb_hkd) || 0.85;

    // Sewing labor rows (position = '__labor__')
    const sewingDetails = versionData.sewing_details || [];
    const laborItems = sewingDetails.filter(s => s.position === '__labor__');

    const laborRows = laborItems.map(s => {
      const hkd = rmb_hkd > 0 ? (parseFloat(s.total_price_rmb) || 0) / rmb_hkd : 0;
      return `
        <tr>
          <td>车缝人工</td>
          <td class="editable num" data-table="sewing-detail" data-id="${s.id}" data-field="material_price_rmb" data-type="number">${formatNumber(s.material_price_rmb, 2)} RMB</td>
          <td class="num">${formatNumber(hkd, 2)}</td>
        </tr>
      `;
    }).join('');

    const laborSub = laborItems.reduce((sum, s) => {
      return sum + (rmb_hkd > 0 ? (parseFloat(s.total_price_rmb) || 0) / rmb_hkd : 0);
    }, 0);

    const subTotal = laborSub;
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
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>项目</th><th>物料价 (RMB)</th><th>金额 (HK$)</th></tr>
          </thead>
          <tbody>
            ${laborRows || '<tr><td colspan="3" style="text-align:center;color:#aaa;padding:20px">暂无人工项目</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  },

  init(container, versionData, versionId) {
    const sewingDetails = versionData.sewing_details || [];
    const laborItems = sewingDetails.filter(s => s.position === '__labor__');
    container.querySelectorAll('td.editable[data-table="sewing-detail"]').forEach(td => {
      const id    = td.dataset.id;
      const field = td.dataset.field;
      const item  = laborItems.find(s => String(s.id) === id) || {};
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
