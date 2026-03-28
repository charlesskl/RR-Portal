/* Tab: bd-purchase — C. Purchase Parts Cost (Breakdown) */
const tab_bd_purchase = {
  render(versionData) {
    const items = versionData.hardware_items || [];
    const params = versionData.params || {};
    const markup = parseFloat(params.markup_body) || 0;

    const subTotal = items.reduce((s, h) => s + (parseFloat(h.new_price) || 0), 0);
    const amount = subTotal * (1 + markup);

    const rows = items.map((h, i) => `
      <tr data-idx="${i}">
        <td class="center"><input type="checkbox" class="row-check" data-id="${h.id}"></td>
        <td class="editable" data-id="${h.id}" data-field="name" data-type="text">${escapeHtml(h.name || '')}</td>
        <td class="editable num" data-id="${h.id}" data-field="quantity" data-type="number">${h.quantity != null ? h.quantity : ''}</td>
        <td class="editable num" data-id="${h.id}" data-field="old_price" data-type="number">${formatNumber(h.old_price, 2)}</td>
        <td class="editable num" data-id="${h.id}" data-field="new_price" data-type="number">${formatNumber(h.new_price, 2)}</td>
        <td class="num ${(h.difference || 0) >= 0 ? '' : 'text-danger'}">${formatNumber(h.difference, 2)}</td>
        <td class="center">${escapeHtml(h.tax_type || '')}</td>
      </tr>
    `).join('');

    return `
      <div class="toolbar">
        <span class="toolbar-title">C. Purchase Parts Cost</span>
        <button class="btn btn-primary" id="bdPurAdd">+ 添加行</button>
        <button class="btn btn-danger" id="bdPurDelete">删除选中</button>
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
            <tr>
              <th><input type="checkbox" id="bdPurAll"></th>
              <th>名称</th><th>用量</th><th>开模报价</th><th>样板报价</th><th>差额</th><th>含税</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <style>.text-danger{color:#e74c3c}</style>
    `;
  },

  init(container, versionData, versionId) {
    container.querySelector('#bdPurAll')?.addEventListener('change', e => {
      container.querySelectorAll('.row-check').forEach(cb => cb.checked = e.target.checked);
    });

    container.querySelector('#bdPurAdd')?.addEventListener('click', async () => {
      try {
        await api.addSectionItem(versionId, 'hardware', { name: '新零件', quantity: 1, new_price: 0 });
        app.refresh();
      } catch (e) { showToast('添加失败: ' + e.message, 'error'); }
    });

    container.querySelector('#bdPurDelete')?.addEventListener('click', async () => {
      const ids = [...container.querySelectorAll('.row-check:checked')].map(cb => cb.dataset.id);
      if (!ids.length) return showToast('请先选择要删除的行', 'info');
      if (!confirm(`确定删除 ${ids.length} 行？`)) return;
      try {
        await Promise.all(ids.map(id => api.deleteSectionItem(versionId, 'hardware', id)));
        app.refresh();
      } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
    });

    container.querySelectorAll('td.editable').forEach(td => {
      const id = td.dataset.id;
      const field = td.dataset.field;
      const type = td.dataset.type;
      const item = versionData.hardware_items.find(h => String(h.id) === id) || {};
      makeEditable(td, {
        type,
        value: item[field],
        onSave: async (val) => {
          const update = { [field]: val };
          // Auto-calc difference when old/new price changes
          if (field === 'new_price' || field === 'old_price') {
            const newP = field === 'new_price' ? val : item.new_price;
            const oldP = field === 'old_price' ? val : item.old_price;
            update.difference = (parseFloat(newP) || 0) - (parseFloat(oldP) || 0);
          }
          try {
            await api.updateSectionItem(versionId, 'hardware', id, update);
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });
  },
};
