/* Tab: vq-body-cost — A. Body Cost (VQ Summary of BD breakdown + accessories) */
const tab_vq_body_cost = {
  render(versionData) {
    const parts = versionData.mold_parts || [];
    const hw = versionData.hardware_items || [];
    const pd = versionData.painting_detail || {};
    const params = versionData.params || {};
    const accessories = versionData.body_accessories || [];
    const markup = parseFloat(params.markup_body) || 0;

    const rawSub = parts.reduce((s, p) => s + (parseFloat(p.material_cost_hkd) || 0), 0);
    const moldSub = parts.reduce((s, p) => s + (parseFloat(p.molding_labor) || 0), 0);
    const purSub  = hw.reduce((s, h) => s + (parseFloat(h.new_price) || 0), 0);
    const decSub  = (parseFloat(pd.labor_cost_hkd) || 0) + (parseFloat(pd.paint_cost_hkd) || 0);
    const othSub  = 0;

    const rawAmt  = rawSub * (1 + markup);
    const moldAmt = moldSub * (1 + markup);
    const purAmt  = purSub * (1 + markup);
    const decAmt  = decSub * (1 + markup);
    const othAmt  = othSub * (1 + markup);
    const total   = rawAmt + moldAmt + purAmt + decAmt + othAmt;

    function pct(amt) {
      return total > 0 ? (amt / total * 100).toFixed(1) + '%' : '—';
    }

    const sections = [
      { label: 'A. Raw Material',      sub: rawSub,  amt: rawAmt,  pct: pct(rawAmt) },
      { label: 'B. Molding Labour',    sub: moldSub, amt: moldAmt, pct: pct(moldAmt) },
      { label: 'C. Purchase Parts',    sub: purSub,  amt: purAmt,  pct: pct(purAmt) },
      { label: 'D. Decoration (喷油)', sub: decSub,  amt: decAmt,  pct: pct(decAmt) },
      { label: 'E. Others',            sub: othSub,  amt: othAmt,  pct: pct(othAmt) },
    ];

    const sectionRows = sections.map(s => `
      <tr>
        <td>${s.label}</td>
        <td class="num">${formatNumber(s.sub, 2)}</td>
        <td class="num">${(markup * 100).toFixed(1)}%</td>
        <td class="num">${formatNumber(s.amt, 2)}</td>
        <td class="num">${s.pct}</td>
      </tr>
    `).join('');

    // Accessories table
    const accRows = accessories.map(a => `
      <tr>
        <td class="center"><input type="checkbox" class="acc-check" data-id="${a.id}"></td>
        <td class="editable" data-id="${a.id}" data-field="part_no" data-type="text">${escapeHtml(a.part_no || '')}</td>
        <td class="editable" data-id="${a.id}" data-field="description" data-type="text">${escapeHtml(a.description || '')}</td>
        <td class="editable num" data-id="${a.id}" data-field="moq" data-type="number">${a.moq != null ? a.moq : ''}</td>
        <td class="editable num" data-id="${a.id}" data-field="usage_qty" data-type="number">${a.usage_qty != null ? a.usage_qty : ''}</td>
        <td class="editable num" data-id="${a.id}" data-field="unit_price" data-type="number">${formatNumber(a.unit_price, 2)}</td>
        <td class="num">${formatNumber((parseFloat(a.usage_qty) || 0) * (parseFloat(a.unit_price) || 0), 2)}</td>
      </tr>
    `).join('');

    return `
      <div class="toolbar">
        <span class="toolbar-title">A. Body Cost</span>
        <span class="toolbar-spacer"></span>
        <span class="toolbar-stats">
          Total Body Cost: <b>${formatNumber(total, 2)}</b> HKD
        </span>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Section</th>
              <th>Sub Total HKD</th>
              <th>Mark Up</th>
              <th>Amount HKD</th>
              <th>% of Body</th>
            </tr>
          </thead>
          <tbody>
            ${sectionRows}
            <tr style="font-weight:bold;background:#f0f4fa">
              <td>合计 Total</td>
              <td class="num">—</td>
              <td class="num">—</td>
              <td class="num">${formatNumber(total, 2)}</td>
              <td class="num">100%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style="margin-top:20px">
        <div class="toolbar">
          <span class="toolbar-title">补充项 (Accessories)</span>
          <button class="btn btn-primary" id="accAdd">+ 添加</button>
          <button class="btn btn-danger" id="accDelete">删除选中</button>
          <span class="toolbar-spacer"></span>
        </div>
        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th><input type="checkbox" id="accAll"></th>
                <th>编号</th><th>描述</th><th>MOQ</th><th>用量</th><th>单价 HKD</th><th>金额 HKD</th>
              </tr>
            </thead>
            <tbody>
              ${accRows || '<tr><td colspan="7" style="text-align:center;color:#aaa;padding:16px">暂无补充项，点击 + 添加</td></tr>'}
            </tbody>
          </table>
        </div>
        <p style="margin:8px 0 0;font-size:12px;color:#888">
          * 补充项会导出到 VQ 的 Section A 行 12–16
        </p>
      </div>
    `;
  },

  init(container, versionData, versionId) {
    const accessories = versionData.body_accessories || [];

    container.querySelector('#accAll')?.addEventListener('change', e => {
      container.querySelectorAll('.acc-check').forEach(cb => cb.checked = e.target.checked);
    });

    container.querySelector('#accAdd')?.addEventListener('click', async () => {
      try {
        await api.addSectionItem(versionId, 'body-accessory', { part_no: '', description: '新配件', moq: 2500, usage_qty: 1, unit_price: 0 });
        app.refresh();
      } catch (e) { showToast('添加失败: ' + e.message, 'error'); }
    });

    container.querySelector('#accDelete')?.addEventListener('click', async () => {
      const ids = [...container.querySelectorAll('.acc-check:checked')].map(cb => cb.dataset.id);
      if (!ids.length) return showToast('请先选择要删除的行', 'info');
      if (!confirm(`确定删除 ${ids.length} 行？`)) return;
      try {
        await Promise.all(ids.map(id => api.deleteSectionItem(versionId, 'body-accessory', id)));
        app.refresh();
      } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
    });

    container.querySelectorAll('td.editable').forEach(td => {
      const id = td.dataset.id;
      const field = td.dataset.field;
      const type = td.dataset.type;
      const item = accessories.find(a => String(a.id) === id);
      if (!item) return;
      makeEditable(td, {
        type,
        value: item[field],
        onSave: async (val) => {
          try {
            await api.updateSectionItem(versionId, 'body-accessory', id, { [field]: val });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });
  },
};
