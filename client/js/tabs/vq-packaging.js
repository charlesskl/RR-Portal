/* Tab: vq-packaging — B. Packaging (VQ) */
const tab_vq_packaging = {
  render(versionData) {
    const items = versionData.packaging_items || [];
    const params = versionData.params || {};
    const markup = parseFloat(params.markup_packaging) || 0;
    const boxPrice = parseFloat(params.box_price_hkd) || 0;

    const itemsTotal = items.reduce((s, i) => s + (parseFloat(i.new_price) || 0), 0);
    const subTotal = itemsTotal + boxPrice;
    const amount = subTotal * (1 + markup);

    const rows = items.map((item, i) => `
      <tr data-idx="${i}">
        <td class="center"><input type="checkbox" class="row-check" data-id="${item.id}"></td>
        <td class="editable" data-id="${item.id}" data-field="name" data-type="text">${escapeHtml(item.name || '')}</td>
        <td class="editable num" data-id="${item.id}" data-field="quantity" data-type="number">${item.quantity != null ? item.quantity : ''}</td>
        <td class="editable num" data-id="${item.id}" data-field="old_price" data-type="number">${formatNumber(item.old_price, 2)}</td>
        <td class="editable num" data-id="${item.id}" data-field="new_price" data-type="number">${formatNumber(item.new_price, 2)}</td>
        <td class="num ${(item.difference || 0) >= 0 ? '' : 'text-danger'}">${formatNumber(item.difference, 2)}</td>
        <td class="center">${escapeHtml(item.tax_type || '')}</td>
      </tr>
    `).join('');

    return `
      <div class="toolbar">
        <span class="toolbar-title">B. Packaging</span>
        <button class="btn btn-primary" id="vqPkgAdd">+ 添加行</button>
        <button class="btn btn-danger" id="vqPkgDelete">删除选中</button>
        <span class="toolbar-spacer"></span>
        <span class="toolbar-stats">
          Items: <b>${formatNumber(itemsTotal, 2)}</b> &nbsp;+&nbsp;
          Box: <b>${formatNumber(boxPrice, 2)}</b> &nbsp;|&nbsp;
          Sub Total: <b>${formatNumber(subTotal, 2)}</b> &nbsp;|&nbsp;
          Mark Up: <b>${(markup * 100).toFixed(1)}%</b> &nbsp;|&nbsp;
          Amount: <b>${formatNumber(amount, 2)}</b>
        </span>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th><input type="checkbox" id="vqPkgAll"></th>
              <th>名称</th><th>用量</th><th>开模报价</th><th>样板报价</th><th>差额</th><th>含税</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#aaa;padding:20px">暂无包装项目</td></tr>'}</tbody>
        </table>
      </div>
      <div style="margin-top:8px;font-size:12px;color:#666">
        * 纸箱 (Box) 价格在参数面板中设置 (box_price_hkd = ${formatNumber(boxPrice, 2)} HKD)
      </div>
      <style>.text-danger{color:#e74c3c}</style>
    `;
  },

  init(container, versionData, versionId) {
    container.querySelector('#vqPkgAll')?.addEventListener('change', e => {
      container.querySelectorAll('.row-check').forEach(cb => cb.checked = e.target.checked);
    });

    container.querySelector('#vqPkgAdd')?.addEventListener('click', async () => {
      try {
        await api.addSectionItem(versionId, 'packaging', { name: '新包装件', quantity: 1, new_price: 0 });
        app.refresh();
      } catch (e) { showToast('添加失败: ' + e.message, 'error'); }
    });

    container.querySelector('#vqPkgDelete')?.addEventListener('click', async () => {
      const ids = [...container.querySelectorAll('.row-check:checked')].map(cb => cb.dataset.id);
      if (!ids.length) return showToast('请先选择要删除的行', 'info');
      if (!confirm(`确定删除 ${ids.length} 行？`)) return;
      try {
        await Promise.all(ids.map(id => api.deleteSectionItem(versionId, 'packaging', id)));
        app.refresh();
      } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
    });

    container.querySelectorAll('td.editable').forEach(td => {
      const id = td.dataset.id;
      const field = td.dataset.field;
      const type = td.dataset.type;
      const item = versionData.packaging_items.find(i => String(i.id) === id) || {};
      makeEditable(td, {
        type,
        value: item[field],
        onSave: async (val) => {
          const update = { [field]: val };
          if (field === 'new_price' || field === 'old_price') {
            const newP = field === 'new_price' ? val : item.new_price;
            const oldP = field === 'old_price' ? val : item.old_price;
            update.difference = (parseFloat(newP) || 0) - (parseFloat(oldP) || 0);
          }
          try {
            await api.updateSectionItem(versionId, 'packaging', id, update);
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });
  },
};
