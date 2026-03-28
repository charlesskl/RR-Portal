/* Tab: bd-material — A. Raw Material Costs (3 categories: Plastic, Alloy, Fabric) */
const tab_bd_material = {
  _categories: [
    { key: 'plastic', label: '1. Plastic / Resin', unit: 'KG', weightLabel: 'Gram/Toy', priceLabel: 'HK$/KG' },
    { key: 'alloy',   label: '2. Alloy',           unit: 'KG', weightLabel: 'Gram/Toy', priceLabel: 'HK$/KG' },
    { key: 'fabric',  label: '3. Fabric',           unit: 'YD', weightLabel: 'YD/Toy',   priceLabel: 'HK$/YD' },
  ],

  render(versionData) {
    const rawMats = versionData.raw_materials || [];
    const params = versionData.params || {};
    const markup = parseFloat(params.markup_body) || 0;

    let grandTotal = 0;

    const sections = this._categories.map(cat => {
      const items = rawMats.filter(m => m.category === cat.key);
      const isFabricCalc = cat.key === 'fabric';
      const subTotal = items.reduce((s, m) => {
        const w = parseFloat(m.weight_g) || 0;
        const p = parseFloat(m.unit_price_per_kg) || 0;
        return s + w * p / (isFabricCalc ? 1 : 1000);
      }, 0);
      grandTotal += subTotal;

      const isFabric = cat.key === 'fabric';
      // Fabric: amount = weight * price (YD * HK$/YD); Plastic/Alloy: amount = weight * price / 1000 (g * HK$/KG)
      const divisor = isFabric ? 1 : 1000;

      const rows = items.map(m => {
        const amt = (parseFloat(m.weight_g) || 0) * (parseFloat(m.unit_price_per_kg) || 0) / divisor;
        return `
          <tr>
            <td class="center"><input type="checkbox" class="mat-check" data-id="${m.id}" data-cat="${cat.key}"></td>
            <td class="editable" data-id="${m.id}" data-field="material_name" data-type="text">${escapeHtml(m.material_name || '')}</td>
            ${isFabric ? `<td class="editable" data-id="${m.id}" data-field="spec" data-type="text">${escapeHtml(m.spec || '')}</td>` : ''}
            <td class="editable num" data-id="${m.id}" data-field="weight_g" data-type="number">${m.weight_g != null ? m.weight_g : ''}</td>
            <td class="editable num" data-id="${m.id}" data-field="unit_price_per_kg" data-type="number">${formatNumber(m.unit_price_per_kg, 2)}</td>
            <td class="num">${formatNumber(amt, 2)}</td>
          </tr>
        `;
      }).join('');

      return `
        <div class="mat-section" data-cat="${cat.key}">
          <div class="toolbar" style="margin-top:12px">
            <span class="toolbar-title">${cat.label}</span>
            <button class="btn btn-primary mat-add" data-cat="${cat.key}">+ 添加</button>
            <button class="btn btn-danger mat-del" data-cat="${cat.key}">删除选中</button>
            <span class="toolbar-spacer"></span>
            <span class="toolbar-stats">Sub Total: <b>${formatNumber(subTotal, 2)}</b></span>
          </div>
          <div class="data-table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width:30px"><input type="checkbox" class="mat-all" data-cat="${cat.key}"></th>
                  <th>Material</th>
                  ${isFabric ? '<th>Position</th>' : ''}
                  <th>${cat.weightLabel}</th>
                  <th>${cat.priceLabel}</th>
                  <th>Amount (HK$)</th>
                </tr>
              </thead>
              <tbody>
                ${rows || `<tr><td colspan="${isFabric ? 6 : 5}" style="text-align:center;color:#aaa;padding:12px">暂无数据，点击 + 添加</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }).join('');

    const amount = grandTotal * (1 + markup);

    return `
      <div class="toolbar">
        <span class="toolbar-title">A. Raw Material Costs</span>
        <span class="toolbar-spacer"></span>
        <span class="toolbar-stats">
          Sub Total: <b>${formatNumber(grandTotal, 2)}</b> &nbsp;|&nbsp;
          Mark Up: <b>${(markup * 100).toFixed(1)}%</b> &nbsp;|&nbsp;
          Amount: <b>${formatNumber(amount, 2)}</b>
        </span>
      </div>
      ${sections}
    `;
  },

  init(container, versionData, versionId) {
    const rawMats = versionData.raw_materials || [];

    // Select all per category
    container.querySelectorAll('.mat-all').forEach(cb => {
      cb.addEventListener('change', e => {
        const cat = cb.dataset.cat;
        container.querySelectorAll(`.mat-check[data-cat="${cat}"]`).forEach(c => c.checked = e.target.checked);
      });
    });

    // Add
    container.querySelectorAll('.mat-add').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cat = btn.dataset.cat;
        try {
          await api.addSectionItem(versionId, 'raw-material', { category: cat, material_name: '', weight_g: 0, unit_price_per_kg: 0 });
          app.refresh();
        } catch (e) { showToast('添加失败: ' + e.message, 'error'); }
      });
    });

    // Delete
    container.querySelectorAll('.mat-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cat = btn.dataset.cat;
        const ids = [...container.querySelectorAll(`.mat-check[data-cat="${cat}"]:checked`)].map(cb => cb.dataset.id);
        if (!ids.length) return showToast('请先选择要删除的行', 'info');
        if (!confirm(`确定删除 ${ids.length} 行？`)) return;
        try {
          await Promise.all(ids.map(id => api.deleteSectionItem(versionId, 'raw-material', id)));
          app.refresh();
        } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
      });
    });

    // Editable cells
    container.querySelectorAll('td.editable').forEach(td => {
      const id = td.dataset.id;
      const field = td.dataset.field;
      const type = td.dataset.type;
      const item = rawMats.find(m => String(m.id) === id);
      if (!item) return;
      makeEditable(td, {
        type,
        value: item[field],
        onSave: async (val) => {
          try {
            await api.updateSectionItem(versionId, 'raw-material', id, { [field]: val });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });
  },
};
