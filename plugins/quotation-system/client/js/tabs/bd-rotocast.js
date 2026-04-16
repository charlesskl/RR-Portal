/* Tab: bd-rotocast — G. Rotocast Items (搪胶件) */
const tab_bd_rotocast = {
  render(versionData) {
    const items = versionData.rotocast_items || [];
    const subTotal = items.reduce((s, r) => s + (parseFloat(r.total_hkd) || 0), 0);

    const rows = items.map(r => `
      <tr>
        <td class="center"><input type="checkbox" class="row-check" data-id="${r.id}"></td>
        <td class="editable" data-id="${r.id}" data-field="mold_no" data-type="text">${escapeHtml(r.mold_no || '')}</td>
        <td class="editable" data-id="${r.id}" data-field="name" data-type="text">${escapeHtml(r.name || '')}</td>
        <td class="editable num" data-id="${r.id}" data-field="output_qty" data-type="number">${r.output_qty != null ? r.output_qty : ''}</td>
        <td class="editable num" data-id="${r.id}" data-field="usage_pcs" data-type="number">${r.usage_pcs != null ? r.usage_pcs : ''}</td>
        <td class="editable num" data-id="${r.id}" data-field="unit_price_hkd" data-type="number">${formatNumber(r.unit_price_hkd, 2)}</td>
        <td class="num">${formatNumber(r.total_hkd, 2)}</td>
        <td class="editable" data-id="${r.id}" data-field="remark" data-type="text">${escapeHtml(r.remark || '')}</td>
      </tr>
    `).join('');

    return `
      <div class="toolbar">
        <span class="toolbar-title">G. Rotocast Items (搪胶件)</span>
        <button class="btn btn-primary" id="bdRotoAdd">+ 添加行</button>
        <button class="btn btn-danger" id="bdRotoDel">删除选中</button>
        <span class="toolbar-spacer"></span>
        <span class="toolbar-stats">Total: <b>${formatNumber(subTotal, 2)} HK$</b></span>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead><tr>
            <th style="width:30px"><input type="checkbox" id="bdRotoAll"></th>
            <th>模号</th>
            <th>名称</th>
            <th>出数</th>
            <th>用量(pcs)</th>
            <th>单价(HK$)</th>
            <th>合计(HK$)</th>
            <th>备注</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:#aaa;padding:12px">暂无数据，点击 + 添加</td></tr>'}</tbody>
        </table>
      </div>
    `;
  },

  init(container, versionData, versionId) {
    const items = versionData.rotocast_items || [];

    const allCb = container.querySelector('#bdRotoAll');
    if (allCb) allCb.addEventListener('change', e => {
      container.querySelectorAll('.row-check').forEach(c => c.checked = e.target.checked);
    });

    const addBtn = container.querySelector('#bdRotoAdd');
    if (addBtn) addBtn.addEventListener('click', async () => {
      try {
        await api.addSectionItem(versionId, 'rotocast', { mold_no: '', name: '', usage_pcs: 1 });
        app.refresh();
      } catch (e) { showToast('添加失败: ' + e.message, 'error'); }
    });

    const delBtn = container.querySelector('#bdRotoDel');
    if (delBtn) delBtn.addEventListener('click', async () => {
      const ids = [...container.querySelectorAll('.row-check:checked')].map(c => c.dataset.id);
      if (!ids.length) return showToast('请先选择要删除的行', 'info');
      if (!confirm(`确定删除 ${ids.length} 行？`)) return;
      try {
        await Promise.all(ids.map(id => api.deleteSectionItem(versionId, 'rotocast', id)));
        app.refresh();
      } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
    });

    container.querySelectorAll('td.editable').forEach(td => {
      const id = td.dataset.id, field = td.dataset.field, type = td.dataset.type;
      const item = items.find(m => String(m.id) === id);
      if (!item) return;
      makeEditable(td, {
        type, value: item[field],
        onSave: async (val) => {
          try {
            await api.updateSectionItem(versionId, 'rotocast', id, { [field]: val });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });
  },
};
