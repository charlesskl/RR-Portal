/* Tab: spin-transport — SPIN Transportation */
const tab_spin_transport = {
  render(versionData) {
    const rows = versionData.spin_transport_rows || [];
    const tc   = versionData.transport_config || {};
    const hkd_usd  = parseFloat((versionData.params || {}).hkd_usd) || 7.75;
    const pcsBox   = parseFloat(tc.pcs_per_box) || 1;
    const cuft     = parseFloat(tc.cuft_per_box) || 0;

    // Auto-calculate from TransportConfig if SpinTransportRow is empty
    function autoRows() {
      if (!cuft || !pcsBox) return [];
      const c40   = parseFloat(tc.container_40_cuft) || 1980;
      const c20   = parseFloat(tc.container_20_cuft) || 883;
      const t10   = parseFloat(tc.truck_10t_cuft)    || 1166;
      const pcs40 = Math.floor(c40 / cuft * pcsBox);
      const pcs20 = Math.floor(c20 / cuft * pcsBox);
      const lcl1pcs = Math.floor(t10 * 0.25 / cuft * pcsBox);
      const lcl2pcs = Math.floor(t10 * 0.50 / cuft * pcsBox);
      const lcl3pcs = Math.floor(t10 * 0.75 / cuft * pcsBox);
      const yt40cost = parseFloat(tc.yt_40_cost) || 0;
      const hk40cost = parseFloat(tc.hk_40_cost) || 0;
      const yt10cost = parseFloat(tc.yt_10t_cost) || 0;
      return [
        { description: 'CHINA FCL', qty_20: pcs20, qty_40: pcs40, usd_per_toy: pcs40 ? +(yt40cost / pcs40 / hkd_usd).toFixed(4) : null },
        { description: 'HK FCL',    qty_20: pcs20, qty_40: pcs40, usd_per_toy: pcs40 ? +(hk40cost / pcs40 / hkd_usd).toFixed(4) : null },
        { description: 'CHINA LCL 1 (≤25%)',   qty_20: null, qty_40: lcl1pcs, usd_per_toy: lcl1pcs ? +(yt10cost / lcl1pcs / hkd_usd).toFixed(4) : null },
        { description: 'CHINA LCL 2 (25-50%)', qty_20: null, qty_40: lcl2pcs, usd_per_toy: lcl2pcs ? +(yt10cost / lcl2pcs / hkd_usd).toFixed(4) : null },
        { description: 'CHINA LCL 3 (50-75%)', qty_20: null, qty_40: lcl3pcs, usd_per_toy: lcl3pcs ? +(yt10cost / lcl3pcs / hkd_usd).toFixed(4) : null },
      ];
    }

    const displayRows = rows.length ? rows : autoRows();
    const isAuto = rows.length === 0;

    const tableRows = displayRows.map((r, i) => `
      <tr>
        <td class="center">${isAuto ? '' : `<input type="checkbox" class="row-check-tr" data-id="${r.id}">`}</td>
        <td class="${isAuto ? '' : 'editable-tr'}" data-id="${r.id}" data-field="description" data-type="text">${escapeHtml(r.description || '')}</td>
        <td class="${isAuto ? 'num' : 'editable-tr num'}" data-id="${r.id}" data-field="qty_20" data-type="number">${r.qty_20 != null ? r.qty_20.toLocaleString() : '—'}</td>
        <td class="${isAuto ? 'num' : 'editable-tr num'}" data-id="${r.id}" data-field="qty_40" data-type="number">${r.qty_40 != null ? r.qty_40.toLocaleString() : '—'}</td>
        <td class="${isAuto ? 'num' : 'editable-tr num'}" data-id="${r.id}" data-field="usd_per_toy" data-type="number">${r.usd_per_toy != null ? '$' + r.usd_per_toy.toFixed(4) : '—'}</td>
      </tr>
    `).join('');

    return `
      <div class="spin-section">
        <div class="spin-section-header">
          <div class="spin-section-accent" style="background:#8e44ad"></div>
          <span class="spin-section-title">Transportation <span class="spin-section-subtitle">${isAuto ? '（从运输设置自动计算）' : '运输费用'}</span></span>
          <button class="btn btn-primary" id="trAdd">+ 添加</button>
          ${!isAuto ? `<button class="btn btn-danger" id="trDel">删除</button>` : ''}
        </div>
        <div class="spin-section-body">
          <div class="data-table-wrap">
            <table class="data-table">
              <thead><tr>
                <th style="width:30px"></th>
                <th>Description</th>
                <th>Qty for 20'</th>
                <th>Qty for 40'</th>
                <th>US$ per toy</th>
              </tr></thead>
              <tbody>${tableRows || '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:10px">暂无数据，请先配置运输参数</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  },

  init(container, versionData, versionId) {
    const rows   = versionData.spin_transport_rows || [];
    const isAuto = rows.length === 0;

    // Save auto-calculated rows as editable DB rows
    container.querySelector('#trSaveAuto')?.addEventListener('click', async () => {
      const tc      = versionData.transport_config || {};
      const hkd_usd = parseFloat((versionData.params || {}).hkd_usd) || 7.75;
      const pcsBox  = parseFloat(tc.pcs_per_box) || 1;
      const cuft    = parseFloat(tc.cuft_per_box) || 0;
      if (!cuft) return showToast('请先配置运输参数（箱体CBM/PCS）', 'info');
      const c40     = parseFloat(tc.container_40_cuft) || 1980;
      const c20     = parseFloat(tc.container_20_cuft) || 883;
      const t10     = parseFloat(tc.truck_10t_cuft)    || 1166;
      const pcs40   = Math.floor(c40 / cuft * pcsBox);
      const pcs20   = Math.floor(c20 / cuft * pcsBox);
      const lcl1pcs = Math.floor(t10 * 0.25 / cuft * pcsBox);
      const lcl2pcs = Math.floor(t10 * 0.50 / cuft * pcsBox);
      const lcl3pcs = Math.floor(t10 * 0.75 / cuft * pcsBox);
      const yt40 = parseFloat(tc.yt_40_cost) || 0;
      const hk40 = parseFloat(tc.hk_40_cost) || 0;
      const yt10 = parseFloat(tc.yt_10t_cost) || 0;
      const toSave = [
        { description: 'CHINA FCL',            qty_20: pcs20, qty_40: pcs40,   usd_per_toy: pcs40   ? +(yt40 / pcs40   / hkd_usd).toFixed(4) : 0 },
        { description: 'HK FCL',               qty_20: pcs20, qty_40: pcs40,   usd_per_toy: pcs40   ? +(hk40 / pcs40   / hkd_usd).toFixed(4) : 0 },
        { description: 'CHINA LCL 1 (≤25%)',   qty_20: null,  qty_40: lcl1pcs, usd_per_toy: lcl1pcs ? +(yt10 / lcl1pcs / hkd_usd).toFixed(4) : 0 },
        { description: 'CHINA LCL 2 (25-50%)', qty_20: null,  qty_40: lcl2pcs, usd_per_toy: lcl2pcs ? +(yt10 / lcl2pcs / hkd_usd).toFixed(4) : 0 },
        { description: 'CHINA LCL 3 (50-75%)', qty_20: null,  qty_40: lcl3pcs, usd_per_toy: lcl3pcs ? +(yt10 / lcl3pcs / hkd_usd).toFixed(4) : 0 },
      ];
      try {
        await Promise.all(toSave.map((r, i) =>
          api.addSectionItem(versionId, 'spin-transport', { ...r, sort_order: i })
        ));
        app.refresh();
      } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
    });

    // Add (always available)
    container.querySelector('#trAdd')?.addEventListener('click', async () => {
      try {
        await api.addSectionItem(versionId, 'spin-transport', { description: '', qty_20: null, qty_40: null, usd_per_toy: 0 });
        app.refresh();
      } catch (e) { showToast('添加失败: ' + e.message, 'error'); }
    });

    if (!isAuto) {
      // Delete
      container.querySelector('#trDel')?.addEventListener('click', async () => {
        const ids = [...container.querySelectorAll('.row-check-tr:checked')].map(c => c.dataset.id);
        if (!ids.length) return showToast('请先选择要删除的行', 'info');
        if (!confirm(`确定删除 ${ids.length} 行？`)) return;
        try {
          await Promise.all(ids.map(id => api.deleteSectionItem(versionId, 'spin-transport', id)));
          app.refresh();
        } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
      });

      // Editable cells
      container.querySelectorAll('td.editable-tr').forEach(td => {
        const id = td.dataset.id, field = td.dataset.field, type = td.dataset.type;
        const item = rows.find(r => String(r.id) === id);
        if (!item) return;
        makeEditable(td, {
          type, value: item[field],
          onSave: async (val) => {
            try {
              await api.updateSectionItem(versionId, 'spin-transport', id, { [field]: val });
              app.refresh();
            } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
          },
        });
      });
    }
  },
};
