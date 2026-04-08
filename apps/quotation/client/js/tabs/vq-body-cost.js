/* Tab: vq-body-cost — A. Body Cost (VQ Summary of BD breakdown + accessories) */
const tab_vq_body_cost = {
  render(versionData) {
    const parts = versionData.mold_parts || [];
    const hw = versionData.hardware_items || [];
    const pd = versionData.painting_detail || {};
    const params = versionData.params || {};
    const accessories = versionData.vq_supplements || [];
    const markup = parseFloat(params.markup_body) || 0;

    const hkdUsd  = parseFloat(params.hkd_usd) || 0.1291;
    const rmb_hkd = parseFloat(params.rmb_hkd) || 0.85;
    const rawMats = versionData.raw_materials || [];
    const bodyAccs = versionData.body_accessories || [];
    const sewingDetails = versionData.sewing_details || [];
    const elecItems = versionData.electronic_items || [];
    const elecSummary = versionData.electronic_summary || null;

    // A. Raw Material — same as bd-material.js
    const rawSub = rawMats.reduce((s, m) => {
      const w = parseFloat(m.weight_g) || 0;
      const p = parseFloat(m.unit_price_per_kg) || 0;
      return s + w * p / (m.category === 'fabric' ? 1 : 1000);
    }, 0);

    // B. Molding Labour — same as bd-molding.js (molding_labor × 1.08)
    const moldSub = parts.reduce((s, p) => {
      const sets = parseFloat(p.sets_per_toy) || 1;
      const shotPerToy = sets > 0 ? 1 / sets : 0;
      const moldingLabor = parseFloat(p.molding_labor) || 0;
      const costPerShot = shotPerToy > 0 ? (moldingLabor * 1.08) / shotPerToy : 0;
      return s + costPerShot * shotPerToy;
    }, 0);

    // C. Purchase Parts — same as bd-purchase.js
    const elecSubHkd = elecSummary
      ? (parseFloat(elecSummary.final_price_usd) || 0)
      : elecItems.reduce((s, e) => s + (parseFloat(e.total_usd) || 0), 0);
    const sewingItems = sewingDetails.filter(s => !s.position && s.position !== '__labor__');
    const sewingSub = sewingItems.reduce((s, sw) => s + (rmb_hkd > 0 ? (parseFloat(sw.total_price_rmb) || 0) / rmb_hkd : 0), 0);
    const otherSub = bodyAccs.reduce((s, b) => s + (parseFloat(b.usage_qty) || 0) * (parseFloat(b.unit_price) || 0), 0);
    const purSub = elecSubHkd + sewingSub + otherSub;

    // D. Decoration — quoted_price_hkd = (labor + paint) × 1.08
    const decSub = parseFloat(pd.quoted_price_hkd) || ((parseFloat(pd.labor_cost_hkd) || 0) + (parseFloat(pd.paint_cost_hkd) || 0)) * 1.08;

    // E. Others — assembly quoted (×1.08) + sewing labor
    const assemblyItems = hw.filter(h => h.part_category === 'labor_assembly' && !/(喷油|油漆|包装人工)/.test(h.name || ''));
    const assemblySub = assemblyItems.reduce((s, h) => s + (parseFloat(h.new_price) || 0), 0);
    const sewingLaborItems = sewingDetails.filter(s => s.position === '__labor__');
    const sewingLaborSub = sewingLaborItems.reduce((s, sl) => s + (rmb_hkd > 0 ? (parseFloat(sl.total_price_rmb) || 0) / rmb_hkd : 0), 0);
    const othSub = assemblySub * 1.08 + sewingLaborSub;

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
    const accessories = versionData.vq_supplements || [];

    container.querySelector('#accAll')?.addEventListener('change', e => {
      container.querySelectorAll('.acc-check').forEach(cb => cb.checked = e.target.checked);
    });

    container.querySelector('#accAdd')?.addEventListener('click', async () => {
      try {
        await api.addSectionItem(versionId, 'vq-supplement', { part_no: '', description: '新配件', moq: 2500, usage_qty: 1, unit_price: 0 });
        app.refresh();
      } catch (e) { showToast('添加失败: ' + e.message, 'error'); }
    });

    container.querySelector('#accDelete')?.addEventListener('click', async () => {
      const ids = [...container.querySelectorAll('.acc-check:checked')].map(cb => cb.dataset.id);
      if (!ids.length) return showToast('请先选择要删除的行', 'info');
      if (!confirm(`确定删除 ${ids.length} 行？`)) return;
      try {
        await Promise.all(ids.map(id => api.deleteSectionItem(versionId, 'vq-supplement', id)));
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
            await api.updateSectionItem(versionId, 'vq-supplement', id, { [field]: val });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });
  },
};
