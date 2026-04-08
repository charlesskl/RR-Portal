/* Tab: bd-molding — B. Molding Labour Cost (Breakdown) */
const tab_bd_molding = {
  render(versionData) {
    const parts = versionData.mold_parts || [];
    // Only show real rotocast mold items: mold_no matches alphanumeric code (e.g. S01, M01)
    const rotoItems = (versionData.rotocast_items || []).filter(r =>
      r.mold_no && /^[A-Za-z]+\d+/.test(r.mold_no.trim())
    );
    const params = versionData.params || {};
    const markup = parseFloat(params.markup_body) || 0;

    // ── 1. Injection Molding ──────────────────────────────────────────────────
    const injSubTotal = parts.reduce((s, p) => {
      const sets = parseFloat(p.sets_per_toy) || 1;
      const shotPerToy = sets > 0 ? 1 / sets : 0;
      const moldingLabor = parseFloat(p.molding_labor) || 0;
      const costPerShot = shotPerToy > 0 ? (moldingLabor * 1.08) / shotPerToy : 0;
      return s + costPerShot * shotPerToy;
    }, 0);

    const injRows = parts.map((p, i) => {
      const setsPerToy = parseFloat(p.sets_per_toy) || 1;
      const shotPerToy = setsPerToy > 0 ? 1 / setsPerToy : 0;
      const moldingLabor = parseFloat(p.molding_labor) || 0;
      const costPerShot = shotPerToy > 0 ? (moldingLabor * 1.08) / shotPerToy : 0;
      const amt = costPerShot * shotPerToy;
      return `
        <tr data-idx="${i}">
          <td class="center"><input type="checkbox" class="row-check inj-check" data-id="${p.id}"></td>
          <td>${escapeHtml(p.part_no || '')}</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${escapeHtml(p.description || '')}
            ${p.eng_name && p.eng_name.toLowerCase() !== (p.description || '').toLowerCase() ? `<br><span style="color:#888;font-size:11px">${escapeHtml(p.eng_name)}</span>` : ''}
          </td>
          <td class="editable" data-table="mold" data-id="${p.id}" data-field="machine_type" data-type="select">${escapeHtml(p.machine_type || '')}</td>
          <td class="num">${formatNumber(shotPerToy, 3)}</td>
          <td class="editable num" data-table="mold" data-id="${p.id}" data-field="molding_labor" data-shot="${shotPerToy}" data-type="number">${formatNumber(costPerShot, 2)}</td>
          <td class="num"><b>${formatNumber(amt, 2)}</b></td>
        </tr>
      `;
    }).join('');

    // ── 2. Blow Molding (搪胶) ────────────────────────────────────────────────
    const blowSubTotal = rotoItems.reduce((s, r) =>
      s + (parseFloat(r.unit_price_hkd) || 0) * 1.08 * (parseInt(r.usage_pcs) || 1), 0);

    const blowRows = rotoItems.map(r => `
      <tr>
        <td class="center"><input type="checkbox" class="row-check roto-check" data-id="${r.id}"></td>
        <td class="editable" data-table="roto" data-id="${r.id}" data-field="mold_no" data-type="text">${escapeHtml(r.mold_no || '')}</td>
        <td class="editable" data-table="roto" data-id="${r.id}" data-field="name" data-type="text">${escapeHtml(r.name || '')}${r.eng_name && r.eng_name.toLowerCase() !== (r.name || '').toLowerCase() ? `<br><span style="color:#888;font-size:11px">${escapeHtml(r.eng_name)}</span>` : ''}</td>
        <td class="editable num" data-table="roto" data-id="${r.id}" data-field="output_qty" data-type="number">${r.output_qty != null ? r.output_qty : ''}</td>
        <td class="editable num" data-table="roto" data-id="${r.id}" data-field="usage_pcs" data-type="number">${r.usage_pcs != null ? r.usage_pcs : ''}</td>
        <td class="editable num" data-table="roto" data-id="${r.id}" data-field="unit_price_hkd" data-type="number">${formatNumber((parseFloat(r.unit_price_hkd) || 0) * 1.08, 2)}</td>
        <td class="num"><b>${formatNumber((parseFloat(r.unit_price_hkd) || 0) * 1.08 * (parseInt(r.usage_pcs) || 1), 2)}</b></td>
        <td class="editable" data-table="roto" data-id="${r.id}" data-field="remark" data-type="text">${escapeHtml(r.remark || '')}</td>
      </tr>
    `).join('');

    const grandTotal = injSubTotal + blowSubTotal;
    const amount = grandTotal * (1 + markup);

    return `
      <div class="toolbar">
        <span class="toolbar-title">B. Molding Labour Cost</span>
        <button class="btn btn-primary" id="bdMoldRecalc">重新计算</button>
        <span class="toolbar-spacer"></span>
        <span class="toolbar-stats">
          Sub Total: <b>${formatNumber(grandTotal, 2)}</b> &nbsp;|&nbsp;
          Mark Up: <b>${(markup * 100).toFixed(1)}%</b> &nbsp;|&nbsp;
          Amount: <b>${formatNumber(amount, 2)}</b>
        </span>
      </div>

      <div style="margin-top:12px">
        <div class="toolbar" style="background:#f0f4ff;border-radius:4px;padding:6px 12px">
          <span class="toolbar-title" style="font-size:13px">1. INJECTION MOLDING</span>
          <span class="toolbar-spacer"></span>
          <span class="toolbar-stats">Sub Total: <b>${formatNumber(injSubTotal, 2)}</b></span>
        </div>
        <div class="data-table-wrap">
          <table class="data-table">
            <thead><tr>
              <th><input type="checkbox" id="bdMoldAll"></th>
              <th>Mold Type</th><th>名称</th><th>M/C Size</th>
              <th>Shot/Toy</th><th>Cost/Shot (HK$)</th><th>Amount</th>
            </tr></thead>
            <tbody>${injRows || '<tr><td colspan="7" style="text-align:center;color:#aaa;padding:10px">暂无注塑件</td></tr>'}</tbody>
          </table>
        </div>
      </div>

      <div style="margin-top:16px">
        <div class="toolbar" style="background:#f0f4ff;border-radius:4px;padding:6px 12px">
          <span class="toolbar-title" style="font-size:13px">2. BLOW MOLDING (搪胶)</span>
          <button class="btn btn-primary" id="bdRotoAdd">+ 添加行</button>
          <button class="btn btn-danger" id="bdRotoDel">删除选中</button>
          <span class="toolbar-spacer"></span>
          <span class="toolbar-stats">Sub Total: <b>${formatNumber(blowSubTotal, 2)}</b></span>
        </div>
        <div class="data-table-wrap">
          <table class="data-table">
            <thead><tr>
              <th style="width:30px"><input type="checkbox" id="bdRotoAll"></th>
              <th>模号</th><th>名称</th><th>出数</th><th>用量(pcs)</th><th>单价(HK$)</th><th>合计(HK$)</th><th>备注</th>
            </tr></thead>
            <tbody>${blowRows || '<tr><td colspan="8" style="text-align:center;color:#aaa;padding:10px">暂无搪胶件，点击 + 添加</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `;
  },

  init(container, versionData, versionId) {
    const machOptions = (versionData.machine_prices || []).map(m => m.machine_type).filter(Boolean);
    const rotoItems = (versionData.rotocast_items || []).filter(r =>
      (r.mold_no && r.mold_no.trim()) || (parseFloat(r.unit_price_hkd) > 0)
    );

    container.querySelector('#bdMoldAll')?.addEventListener('change', e => {
      container.querySelectorAll('.inj-check').forEach(cb => cb.checked = e.target.checked);
    });

    container.querySelector('#bdRotoAll')?.addEventListener('change', e => {
      container.querySelectorAll('.roto-check').forEach(cb => cb.checked = e.target.checked);
    });

    container.querySelector('#bdMoldRecalc')?.addEventListener('click', async () => {
      try {
        await api.calculate(versionId);
        app.refresh();
        showToast('重新计算完成', 'success');
      } catch (e) { showToast('计算失败: ' + e.message, 'error'); }
    });

    container.querySelector('#bdRotoAdd')?.addEventListener('click', async () => {
      try {
        await api.addSectionItem(versionId, 'rotocast', { mold_no: '', name: '', usage_pcs: 1 });
        app.refresh();
      } catch (e) { showToast('添加失败: ' + e.message, 'error'); }
    });

    container.querySelector('#bdRotoDel')?.addEventListener('click', async () => {
      const ids = [...container.querySelectorAll('.roto-check:checked')].map(c => c.dataset.id);
      if (!ids.length) return showToast('请先选择要删除的行', 'info');
      if (!confirm(`确定删除 ${ids.length} 行？`)) return;
      try {
        await Promise.all(ids.map(id => api.deleteSectionItem(versionId, 'rotocast', id)));
        app.refresh();
      } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
    });

    container.querySelectorAll('td.editable[data-table="mold"]').forEach(td => {
      const id = td.dataset.id, field = td.dataset.field, type = td.dataset.type;
      const part = versionData.mold_parts.find(p => String(p.id) === id) || {};
      // For molding_labor, display and edit as Cost/Shot (user enters cost/shot, we reverse to molding_labor)
      const shotPerToy = parseFloat(td.dataset.shot) || 1;
      const displayValue = field === 'molding_labor'
        ? (shotPerToy > 0 ? ((parseFloat(part.molding_labor) || 0) * 1.08) / shotPerToy : 0)
        : part[field];
      makeEditable(td, {
        type,
        choices: type === 'select' ? machOptions : [],
        value: displayValue,
        onSave: async (val) => {
          try {
            let saveVal = val;
            if (field === 'molding_labor') {
              // user entered costPerShot → reverse: molding_labor = costPerShot * shotPerToy / 1.08
              saveVal = shotPerToy > 0 ? (parseFloat(val) * shotPerToy / 1.08) : parseFloat(val);
            }
            await api.updateSectionItem(versionId, 'mold-parts', id, { [field]: saveVal });
            await api.calculate(versionId);
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });

    container.querySelectorAll('td.editable[data-table="roto"]').forEach(td => {
      const id = td.dataset.id, field = td.dataset.field, type = td.dataset.type;
      const item = rotoItems.find(r => String(r.id) === id) || {};
      // For unit_price_hkd, display and edit as ×1.08 value; store back as /1.08
      const displayValue = field === 'unit_price_hkd'
        ? (parseFloat(item.unit_price_hkd) || 0) * 1.08
        : item[field];
      makeEditable(td, {
        type,
        value: displayValue,
        onSave: async (val) => {
          try {
            let saveVal = val;
            if (field === 'unit_price_hkd') {
              saveVal = parseFloat(val) / 1.08;
            }
            await api.updateSectionItem(versionId, 'rotocast', id, { [field]: saveVal });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });
  },
};
