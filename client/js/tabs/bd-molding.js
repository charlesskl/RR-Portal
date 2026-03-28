/* Tab: bd-molding — B. Molding Labour Cost (Breakdown) */
const tab_bd_molding = {
  render(versionData) {
    const parts = versionData.mold_parts || [];
    const machPrices = versionData.machine_prices || [];
    const params = versionData.params || {};
    const markup = parseFloat(params.markup_body) || 0;

    const subTotal = parts.reduce((s, p) => s + (parseFloat(p.molding_labor) || 0), 0);
    const amount = subTotal * (1 + markup);

    const rows = parts.map((p, i) => `
      <tr data-idx="${i}">
        <td class="center"><input type="checkbox" class="row-check" data-id="${p.id}"></td>
        <td>${escapeHtml(p.part_no || '')}</td>
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.description || '')}</td>
        <td class="editable" data-id="${p.id}" data-field="machine_type" data-type="select">${escapeHtml(p.machine_type || '')}</td>
        <td class="editable num" data-id="${p.id}" data-field="cavity_count" data-type="number">${p.cavity_count != null ? p.cavity_count : ''}</td>
        <td class="editable num" data-id="${p.id}" data-field="sets_per_toy" data-type="number">${p.sets_per_toy != null ? p.sets_per_toy : ''}</td>
        <td class="editable num" data-id="${p.id}" data-field="target_qty" data-type="number">${p.target_qty != null ? p.target_qty : ''}</td>
        <td class="num">${formatNumber(p.molding_labor, 2)}</td>
      </tr>
    `).join('');

    return `
      <div class="toolbar">
        <span class="toolbar-title">B. Molding Labour Cost</span>
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
              <th><input type="checkbox" id="bdMoldAll"></th>
              <th>模号</th><th>名称</th><th>机型</th>
              <th>出模件数</th><th>出模套数</th><th>目标数</th><th>啤工HKD</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  },

  init(container, versionData, versionId) {
    const machOptions = (versionData.machine_prices || []).map(m => m.machine_type).filter(Boolean);

    container.querySelector('#bdMoldAll')?.addEventListener('change', e => {
      container.querySelectorAll('.row-check').forEach(cb => cb.checked = e.target.checked);
    });

    container.querySelectorAll('td.editable').forEach(td => {
      const id = td.dataset.id;
      const field = td.dataset.field;
      const type = td.dataset.type;
      const part = versionData.mold_parts.find(p => String(p.id) === id) || {};
      makeEditable(td, {
        type,
        choices: type === 'select' ? machOptions : [],
        value: part[field],
        onSave: async (val) => {
          try {
            await api.updateSectionItem(versionId, 'mold-parts', id, { [field]: val });
            await api.calculate(versionId);
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });
  },
};
