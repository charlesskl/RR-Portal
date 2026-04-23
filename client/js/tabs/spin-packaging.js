/* Tab: spin-packaging — SPIN Packaging (包装物料) */
const tab_spin_packaging = {
  render(versionData) {
    const allItems = versionData.packaging_items || [];
    const activeSub = versionData._activeSub;
    const subProducts = [...new Set(allItems.map(i => i.sub_product || '').filter(Boolean))];
    const items = subProducts.length > 1 && activeSub
      ? allItems.filter(i => (i.sub_product || '') === activeSub)
      : allItems;
    const retailItems = items.filter(i => !i.pkg_section || i.pkg_section === 'retail');
    const cartonItems = items.filter(i => i.pkg_section === 'carton');

    const totalRetail = retailItems.reduce((s, i) => s + (parseFloat(i.quantity) || 0) * (parseFloat(i.unit_price != null ? i.unit_price : i.new_price) || 0), 0);
    const totalCarton = cartonItems.reduce((s, i) => s + (parseFloat(i.quantity) || 0) * (parseFloat(i.unit_price != null ? i.unit_price : i.new_price) || 0), 0);

    function renderRows(list) {
      if (!list.length) return '<tr><td colspan="6" style="text-align:center;color:#aaa;padding:8px">暂无数据</td></tr>';
      return list.map(item => {
        const unitPrice = item.unit_price != null ? item.unit_price : item.new_price;
        const amount = (parseFloat(item.quantity) || 0) * (parseFloat(unitPrice) || 0);
        return `
          <tr>
            <td class="center"><input type="checkbox" class="row-check" data-id="${item.id}"></td>
            <td class="editable" data-id="${item.id}" data-field="name" data-type="text">${escapeHtml(item.name || '')}</td>
            <td class="editable" data-id="${item.id}" data-field="eng_name" data-type="text">${escapeHtml(item.eng_name || '')}</td>
            <td class="editable num" data-id="${item.id}" data-field="quantity" data-type="number">${formatNumber(item.quantity, 3)}</td>
            <td class="editable num" data-id="${item.id}" data-field="new_price" data-type="number">${formatNumber(unitPrice, 4)}</td>
            <td class="num">${formatNumber(amount, 2)}</td>
          </tr>
        `;
      }).join('');
    }

    const accentColors = { retail: '#9b59b6', carton: '#16a085' };
    function renderSection(title, subtitle, list, total, addSection) {
      return `
        <div class="spin-section" style="margin-bottom:16px">
          <div class="spin-section-header">
            <div class="spin-section-accent" style="background:${accentColors[addSection]}"></div>
            <span class="spin-section-title">${title} <span class="spin-section-subtitle">${subtitle}</span></span>
            <button class="btn btn-primary" data-pkg-add="${addSection}">+ 添加</button>
            <button class="btn btn-danger" data-pkg-del="${addSection}">删除</button>
            <span class="spin-section-total">Sub Total: ${formatNumber(total, 4)} USD</span>
          </div>
          <div class="spin-section-body">
            <div class="data-table-wrap">
              <table class="data-table">
                <thead><tr>
                  <th style="width:30px"><input type="checkbox" class="pkg-check-all" data-section="${addSection}"></th>
                  <th>名称</th><th>英文名</th><th>数量/toy</th><th>单价(USD)</th><th>金额(USD)</th>
                </tr></thead>
                <tbody>${renderRows(list)}</tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    return renderSection('Retail Box', '零售包装', retailItems, totalRetail, 'retail')
         + renderSection('Master Carton', '外箱', cartonItems, totalCarton, 'carton');
  },

  init(container, versionData, versionId) {
    const items = versionData.packaging_items || [];

    // Check-all per section
    container.querySelectorAll('.pkg-check-all').forEach(chk => {
      const section = chk.dataset.section;
      chk.addEventListener('change', e => {
        const sectionItems = items.filter(i => !i.pkg_section || i.pkg_section === section || (section === 'retail' && !i.pkg_section));
        const ids = new Set(sectionItems.map(i => String(i.id)));
        container.querySelectorAll('.row-check').forEach(c => {
          if (ids.has(c.dataset.id)) c.checked = e.target.checked;
        });
      });
    });

    // Add buttons
    container.querySelectorAll('[data-pkg-add]').forEach(btn => {
      const section = btn.dataset.pkgAdd;
      btn.addEventListener('click', async () => {
        try {
          const sub = versionData._activeSub || '';
          await api.addSectionItem(versionId, 'packaging', { name: '新包装件', eng_name: '', quantity: 1, new_price: 0, pkg_section: section, sub_product: sub });
          app.refresh();
        } catch (e) { showToast('添加失败: ' + e.message, 'error'); }
      });
    });

    // Delete buttons
    container.querySelectorAll('[data-pkg-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ids = [...container.querySelectorAll('.row-check:checked')].map(c => c.dataset.id);
        if (!ids.length) return showToast('请先选择要删除的行', 'info');
        if (!confirm(`确定删除 ${ids.length} 行？`)) return;
        try {
          await Promise.all(ids.map(id => api.deleteSectionItem(versionId, 'packaging', id)));
          app.refresh();
        } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
      });
    });

    // Editable cells
    container.querySelectorAll('td.editable').forEach(td => {
      const id = td.dataset.id, field = td.dataset.field, type = td.dataset.type;
      const item = items.find(i => String(i.id) === id) || {};
      makeEditable(td, {
        type, value: item[field],
        onSave: async (val) => {
          try {
            await api.updateSectionItem(versionId, 'packaging', id, { [field]: val });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });
  },
};
