/* Tab: bd-sewing — F. Sewing Detail (车缝明细) */
const tab_bd_sewing = {
  render(versionData) {
    const items = versionData.sewing_details || [];
    const subTotal = items.reduce((s, d) => s + (parseFloat(d.total_price_rmb) || 0), 0);

    const rows = items.map(d => `
      <tr>
        <td class="center"><input type="checkbox" class="row-check" data-id="${d.id}"></td>
        <td class="editable" data-id="${d.id}" data-field="fabric_name" data-type="text">${escapeHtml(d.fabric_name || '')}</td>
        <td class="editable" data-id="${d.id}" data-field="position" data-type="text">${escapeHtml(d.position || '')}</td>
        <td class="editable num" data-id="${d.id}" data-field="cut_pieces" data-type="number">${d.cut_pieces != null ? d.cut_pieces : ''}</td>
        <td class="editable num" data-id="${d.id}" data-field="usage_amount" data-type="number">${formatNumber(d.usage_amount, 6)}</td>
        <td class="editable num" data-id="${d.id}" data-field="material_price_rmb" data-type="number">${formatNumber(d.material_price_rmb, 2)}</td>
        <td class="editable num" data-id="${d.id}" data-field="price_rmb" data-type="number">${formatNumber(d.price_rmb, 4)}</td>
        <td class="editable num" data-id="${d.id}" data-field="markup_point" data-type="number">${formatNumber(d.markup_point, 2)}</td>
        <td class="num">${formatNumber(d.total_price_rmb, 4)}</td>
      </tr>
    `).join('');

    return `
      <div class="toolbar">
        <span class="toolbar-title">F. Sewing Detail (车缝明细)</span>
        <button class="btn btn-primary" id="bdSewAdd">+ 添加行</button>
        <button class="btn btn-danger" id="bdSewDel">删除选中</button>
        <span class="toolbar-spacer"></span>
        <span class="toolbar-stats">Total: <b>${formatNumber(subTotal, 2)} RMB</b></span>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead><tr>
            <th style="width:30px"><input type="checkbox" id="bdSewAll"></th>
            <th>布料名称</th>
            <th>部位</th>
            <th>裁片数</th>
            <th>用量</th>
            <th>物料价(RMB)</th>
            <th>价钱(RMB)</th>
            <th>码点</th>
            <th>总价(RMB)</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="9" style="text-align:center;color:#aaa;padding:12px">暂无数据，点击 + 添加</td></tr>'}</tbody>
        </table>
      </div>
    `;
  },

  init(container, versionData, versionId) {
    const items = versionData.sewing_details || [];

    const allCb = container.querySelector('#bdSewAll');
    if (allCb) allCb.addEventListener('change', e => {
      container.querySelectorAll('.row-check').forEach(c => c.checked = e.target.checked);
    });

    const addBtn = container.querySelector('#bdSewAdd');
    if (addBtn) addBtn.addEventListener('click', async () => {
      try {
        await api.addSectionItem(versionId, 'sewing-detail', { fabric_name: '', position: '', markup_point: 1.15 });
        app.refresh();
      } catch (e) { showToast('添加失败: ' + e.message, 'error'); }
    });

    const delBtn = container.querySelector('#bdSewDel');
    if (delBtn) delBtn.addEventListener('click', async () => {
      const ids = [...container.querySelectorAll('.row-check:checked')].map(c => c.dataset.id);
      if (!ids.length) return showToast('请先选择要删除的行', 'info');
      if (!confirm(`确定删除 ${ids.length} 行？`)) return;
      try {
        await Promise.all(ids.map(id => api.deleteSectionItem(versionId, 'sewing-detail', id)));
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
            await api.updateSectionItem(versionId, 'sewing-detail', id, { [field]: val });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });
  },
};
