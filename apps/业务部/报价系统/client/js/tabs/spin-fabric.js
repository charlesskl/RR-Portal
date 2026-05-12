/* Tab: spin-fabric — SPIN Purchased Part (Fabric Cost + Other Cost), character filtered by shared switcher */
const tab_spin_fabric = {

  render(versionData) {
    const all = versionData.sewing_details || [];
    const activeSub = versionData._activeSub;

    const { keys: subProducts, keyFn } = getSewingGroups(all);
    const hasMultiple = subProducts.length > 1;

    const filtered = hasMultiple && activeSub
      ? all.filter(d => keyFn(d) === activeSub)
      : all;

    // 检查同一 sub_product 下是否有多个 product_name（需要显示产品名列）
    const productNames = [...new Set(filtered.map(d => d.product_name || '').filter(Boolean))];
    const showProductCol = productNames.length > 1;
    const colSpan = showProductCol ? 7 : 6;

    const fabricItems = filtered.filter(d => d.position === '__fabric__');
    const otherItems  = filtered.filter(d =>
      (d.position === '__other__' || d.position === '__embroidery__') &&
      !(d.fabric_name || '').includes('人工')
    );

    function toUsd(priceRmb, position) {
      const rmb = parseFloat(priceRmb) || 0;
      if (position === '__embroidery__') return rmb / 0.85 / 7.75;
      return rmb / 0.85 / 7.75 * 1.06;
    }

    function calcTotal(list) {
      return list.reduce((s, d) => s + (parseFloat(d.usage_amount) || 0) * toUsd(d.material_price_rmb, d.position), 0);
    }

    // 按 product_name 分组排序
    function sortByProduct(list) {
      if (!showProductCol) return list;
      return [...list].sort((a, b) => (a.product_name || '').localeCompare(b.product_name || ''));
    }

    function renderRows(list) {
      if (!list.length) return `<tr><td colspan="${colSpan}" style="text-align:center;color:#aaa;padding:12px">暂无数据，点击 + 添加</td></tr>`;
      return sortByProduct(list).map(d => {
        const unitUsd = toUsd(d.material_price_rmb, d.position);
        const amount = (parseFloat(d.usage_amount) || 0) * unitUsd;
        return `
          <tr>
            <td class="center"><input type="checkbox" class="row-check" data-id="${d.id}"></td>
            <td class="editable" data-id="${d.id}" data-field="fabric_name" data-type="text">${escapeHtml(d.fabric_name || '')}</td>
            ${showProductCol ? `<td style="color:#8e44ad;font-size:11px">${escapeHtml(d.product_name || '')}</td>` : ''}
            <td class="editable" data-id="${d.id}" data-field="eng_name" data-type="text" style="color:#1976d2">${escapeHtml(d.eng_name || '')}</td>
            <td class="editable num" data-id="${d.id}" data-field="usage_amount" data-type="number">${formatNumber(d.usage_amount, 4)}</td>
            <td class="num">${formatNumber(unitUsd, 4)}</td>
            <td class="num">${formatNumber(amount, 4)}</td>
          </tr>
        `;
      }).join('');
    }

    // ── Metal Parts Cost ──────────────────────────────────────────────────────
    const hkd_usd = parseFloat((versionData.params || {}).hkd_usd) || 7.75;
    const rmb_hkd = parseFloat((versionData.params || {}).rmb_hkd) || 0.85;
    const metalItems = (versionData.hardware_items || []).filter(
      h => !h.part_category || !['electronic', 'labor_assembly'].includes(h.part_category.toLowerCase())
    );
    function metalTotal() {
      return metalItems.reduce((s, h) => s + (parseFloat(h.quantity) || 0) * ((parseFloat(h.new_price) || 0) / rmb_hkd / hkd_usd * 1.06), 0);
    }
    function renderMetalRows() {
      if (!metalItems.length) return `<tr><td colspan="6" style="text-align:center;color:#aaa;padding:12px">暂无数据，点击 + 添加</td></tr>`;
      return metalItems.map(h => {
        const unitUsd = (parseFloat(h.new_price) || 0) / rmb_hkd / hkd_usd * 1.06;
        const amount  = (parseFloat(h.quantity) || 0) * unitUsd;
        return `
          <tr>
            <td class="center"><input type="checkbox" class="row-check-metal" data-id="${h.id}"></td>
            <td class="editable-metal" data-id="${h.id}" data-field="name" data-type="text">${escapeHtml(h.name || '')}</td>
            <td class="editable-metal" data-id="${h.id}" data-field="eng_name" data-type="text" style="color:#1976d2">${escapeHtml(h.eng_name || '')}</td>
            <td class="editable-metal num" data-id="${h.id}" data-field="quantity" data-type="number">${formatNumber(h.quantity, 4)}</td>
            <td class="editable-metal num" data-id="${h.id}" data-field="new_price" data-type="number">${formatNumber(unitUsd, 4)}</td>
            <td class="num">${formatNumber(amount, 4)}</td>
          </tr>
        `;
      }).join('');
    }

    // ── Electronic Parts Cost ─────────────────────────────────────────────────
    const elecItems = versionData.electronic_items || [];
    function elecTotal() {
      return elecItems.reduce((s, e) => s + (parseFloat(e.total_usd) || (parseFloat(e.quantity) || 0) * (parseFloat(e.unit_price_usd) || 0)), 0);
    }
    function renderElecRows() {
      if (!elecItems.length) return `<tr><td colspan="7" style="text-align:center;color:#aaa;padding:12px">暂无数据，点击 + 添加</td></tr>`;
      return elecItems.map(e => {
        const total = parseFloat(e.total_usd) || (parseFloat(e.quantity) || 0) * (parseFloat(e.unit_price_usd) || 0);
        return `
          <tr>
            <td class="center"><input type="checkbox" class="row-check-elec" data-id="${e.id}"></td>
            <td class="editable-elec" data-id="${e.id}" data-field="part_name" data-type="text">${escapeHtml(e.part_name || '')}</td>
            <td class="editable-elec" data-id="${e.id}" data-field="eng_name" data-type="text" style="color:#1976d2">${escapeHtml(e.eng_name || '')}</td>
            <td class="editable-elec" data-id="${e.id}" data-field="spec" data-type="text">${escapeHtml(e.spec || '')}</td>
            <td class="editable-elec num" data-id="${e.id}" data-field="quantity" data-type="number">${formatNumber(e.quantity, 0)}</td>
            <td class="editable-elec num" data-id="${e.id}" data-field="unit_price_usd" data-type="number">${formatNumber(e.unit_price_usd, 4)}</td>
            <td class="num">${formatNumber(total, 4)}</td>
          </tr>
        `;
      }).join('');
    }

    return `
      <div class="spin-section" id="spinFabricSection">
        <div class="spin-section-header">
          <div class="spin-section-accent" style="background:#4a90d9"></div>
          <span class="spin-section-title">Fabric Cost <span class="spin-section-subtitle">布料明细</span></span>
          <button class="btn btn-primary" id="spinFabricAdd">+ 添加</button>
          <button class="btn btn-danger" id="spinFabricDel">删除</button>
          <span class="spin-section-total">Sub Total: ${formatNumber(calcTotal(fabricItems), 4)} USD</span>
        </div>
        <div class="spin-section-body">
          <div class="data-table-wrap">
            <table class="data-table">
              <thead><tr>
                <th style="width:30px"><input type="checkbox" id="spinFabricAll"></th>
                <th>布料名称</th>${showProductCol ? '<th>款式</th>' : ''}<th>英文名</th><th>用量/toy</th><th>单价(USD)</th><th>金额(USD)</th>
              </tr></thead>
              <tbody>${renderRows(fabricItems)}</tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="spin-section" id="spinOtherSection">
        <div class="spin-section-header">
          <div class="spin-section-accent" style="background:#e67e22"></div>
          <span class="spin-section-title">Other Cost <span class="spin-section-subtitle">其他材料</span></span>
          <button class="btn btn-primary" id="spinOtherAdd">+ 添加</button>
          <button class="btn btn-danger" id="spinOtherDel">删除</button>
          <span class="spin-section-total">Sub Total: ${formatNumber(calcTotal(otherItems), 4)} USD</span>
        </div>
        <div class="spin-section-body">
          <div class="data-table-wrap">
            <table class="data-table">
              <thead><tr>
                <th style="width:30px"><input type="checkbox" id="spinOtherAll"></th>
                <th>名称</th>${showProductCol ? '<th>款式</th>' : ''}<th>英文名</th><th>用量/toy</th><th>单价(USD)</th><th>金额(USD)</th>
              </tr></thead>
              <tbody>${renderRows(otherItems)}</tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="spin-section" id="spinMetalSection">
        <div class="spin-section-header">
          <div class="spin-section-accent" style="background:#7b68ee"></div>
          <span class="spin-section-title">Metal Parts Cost <span class="spin-section-subtitle">五金件</span></span>
          <button class="btn btn-primary" id="spinMetalAdd">+ 添加</button>
          <button class="btn btn-danger" id="spinMetalDel">删除</button>
          <span class="spin-section-total">Sub Total: ${formatNumber(metalTotal(), 4)} USD</span>
        </div>
        <div class="spin-section-body">
          <div class="data-table-wrap">
            <table class="data-table">
              <thead><tr>
                <th style="width:30px"><input type="checkbox" id="spinMetalAll"></th>
                <th>名称</th><th>英文名</th><th>用量/toy</th><th>单价(USD)</th><th>金额(USD)</th>
              </tr></thead>
              <tbody>${renderMetalRows()}</tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="spin-section" id="spinElecSection">
        <div class="spin-section-header">
          <div class="spin-section-accent" style="background:#27ae60"></div>
          <span class="spin-section-title">Electronic Parts Cost <span class="spin-section-subtitle">电子元件</span></span>
          <button class="btn btn-primary" id="spinElecAdd">+ 添加</button>
          <button class="btn btn-danger" id="spinElecDel">删除</button>
          <span class="spin-section-total">Sub Total: ${formatNumber(elecTotal(), 4)} USD</span>
        </div>
        <div class="spin-section-body">
          <div class="data-table-wrap">
            <table class="data-table">
              <thead><tr>
                <th style="width:30px"><input type="checkbox" id="spinElecAll"></th>
                <th>零件名</th><th>英文名</th><th>规格</th><th>用量</th><th>单价(USD)</th><th>金额(USD)</th>
              </tr></thead>
              <tbody>${renderElecRows()}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  },

  init(container, versionData, versionId) {
    const all = versionData.sewing_details || [];
    const activeSub = versionData._activeSub;
    const { keys: subProducts, keyFn } = getSewingGroups(all);
    const filtered = subProducts.length > 1 && activeSub
      ? all.filter(d => keyFn(d) === activeSub)
      : all;

    const fabricItems = filtered.filter(d => d.position === '__fabric__');
    const otherItems  = filtered.filter(d =>
      d.position !== '__fabric__' && d.position !== '__labor__' &&
      !(d.fabric_name || '').includes('人工')
    );

    // Check-all
    container.querySelector('#spinFabricAll')?.addEventListener('change', e => {
      const ids = new Set(fabricItems.map(d => String(d.id)));
      container.querySelectorAll('.row-check').forEach(c => { if (ids.has(c.dataset.id)) c.checked = e.target.checked; });
    });
    container.querySelector('#spinOtherAll')?.addEventListener('change', e => {
      const ids = new Set(otherItems.map(d => String(d.id)));
      container.querySelectorAll('.row-check').forEach(c => { if (ids.has(c.dataset.id)) c.checked = e.target.checked; });
    });

    // Add
    container.querySelector('#spinFabricAdd')?.addEventListener('click', async () => {
      try {
        const sub = activeSub || '';
        await api.addSectionItem(versionId, 'sewing-detail', { fabric_name: '', position: '__fabric__', usage_amount: 0, material_price_rmb: 0, sub_product: sub, product_name: sub });
        app.refresh();
      } catch (e) { showToast('添加失败: ' + e.message, 'error'); }
    });
    container.querySelector('#spinOtherAdd')?.addEventListener('click', async () => {
      try {
        const sub = activeSub || '';
        await api.addSectionItem(versionId, 'sewing-detail', { fabric_name: '', position: '', usage_amount: 0, material_price_rmb: 0, sub_product: sub, product_name: sub });
        app.refresh();
      } catch (e) { showToast('添加失败: ' + e.message, 'error'); }
    });

    // Delete
    const delSelected = async () => {
      const ids = [...container.querySelectorAll('.row-check:checked')].map(c => c.dataset.id);
      if (!ids.length) return showToast('请先选择要删除的行', 'info');
      if (!confirm(`确定删除 ${ids.length} 行？`)) return;
      try {
        await Promise.all(ids.map(id => api.deleteSectionItem(versionId, 'sewing-detail', id)));
        app.refresh();
      } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
    };
    container.querySelector('#spinFabricDel')?.addEventListener('click', delSelected);
    container.querySelector('#spinOtherDel')?.addEventListener('click', delSelected);

    // Editable cells — sewing
    container.querySelectorAll('td.editable').forEach(td => {
      const id = td.dataset.id, field = td.dataset.field, type = td.dataset.type;
      const item = all.find(m => String(m.id) === id);
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

    // ── Metal Parts ───────────────────────────────────────────────────────────
    const metalItems = (versionData.hardware_items || []).filter(
      h => !h.part_category || !['electronic', 'labor_assembly'].includes(h.part_category.toLowerCase())
    );
    container.querySelector('#spinMetalAll')?.addEventListener('change', e => {
      container.querySelectorAll('.row-check-metal').forEach(c => c.checked = e.target.checked);
    });
    container.querySelector('#spinMetalAdd')?.addEventListener('click', async () => {
      try {
        await api.addSectionItem(versionId, 'hardware', { name: '', eng_name: '', quantity: 1, new_price: 0 });
        app.refresh();
      } catch (e) { showToast('添加失败: ' + e.message, 'error'); }
    });
    container.querySelector('#spinMetalDel')?.addEventListener('click', async () => {
      const ids = [...container.querySelectorAll('.row-check-metal:checked')].map(c => c.dataset.id);
      if (!ids.length) return showToast('请先选择要删除的行', 'info');
      if (!confirm(`确定删除 ${ids.length} 行？`)) return;
      try {
        await Promise.all(ids.map(id => api.deleteSectionItem(versionId, 'hardware', id)));
        app.refresh();
      } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
    });
    container.querySelectorAll('td.editable-metal').forEach(td => {
      const id = td.dataset.id, field = td.dataset.field, type = td.dataset.type;
      const item = metalItems.find(m => String(m.id) === id);
      if (!item) return;
      makeEditable(td, {
        type, value: item[field],
        onSave: async (val) => {
          try {
            await api.updateSectionItem(versionId, 'hardware', id, { [field]: val });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });

    // ── Electronic Parts ──────────────────────────────────────────────────────
    const elecItems = versionData.electronic_items || [];
    container.querySelector('#spinElecAll')?.addEventListener('change', e => {
      container.querySelectorAll('.row-check-elec').forEach(c => c.checked = e.target.checked);
    });
    container.querySelector('#spinElecAdd')?.addEventListener('click', async () => {
      try {
        await api.addSectionItem(versionId, 'electronics', { part_name: '', eng_name: '', spec: '', quantity: 1, unit_price_usd: 0, total_usd: 0 });
        app.refresh();
      } catch (e) { showToast('添加失败: ' + e.message, 'error'); }
    });
    container.querySelector('#spinElecDel')?.addEventListener('click', async () => {
      const ids = [...container.querySelectorAll('.row-check-elec:checked')].map(c => c.dataset.id);
      if (!ids.length) return showToast('请先选择要删除的行', 'info');
      if (!confirm(`确定删除 ${ids.length} 行？`)) return;
      try {
        await Promise.all(ids.map(id => api.deleteSectionItem(versionId, 'electronics', id)));
        app.refresh();
      } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
    });
    container.querySelectorAll('td.editable-elec').forEach(td => {
      const id = td.dataset.id, field = td.dataset.field, type = td.dataset.type;
      const item = elecItems.find(m => String(m.id) === id);
      if (!item) return;
      makeEditable(td, {
        type, value: item[field],
        onSave: async (val) => {
          try {
            await api.updateSectionItem(versionId, 'electronics', id, { [field]: val });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });
  },
};
