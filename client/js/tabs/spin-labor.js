/* Tab: spin-labor — SPIN Labor Misc (工时数据) */
const tab_spin_labor = {
  render(versionData) {
    const all = versionData.sewing_details || [];
    const activeSub = versionData._activeSub;
    const { keys: subProducts, keyFn } = getSewingGroups(all);
    const filtered = subProducts.length > 1 && activeSub
      ? all.filter(d => keyFn(d) === activeSub)
      : all;

    const params  = versionData.params || {};
    const hkd_usd = parseFloat(params.hkd_usd) || 7.75;
    const rmb_hkd = parseFloat(params.rmb_hkd) || 0.85;
    const rmbUsdRate = rmb_hkd * hkd_usd;

    // ── Sewing Labor ─────────────────────────────────────────────────────────
    const LABOR_NAMES = /^(裁床人工|车缝人工|手工人工)/;
    const laborItems = filtered.filter(d => d.position === '__labor__' && LABOR_NAMES.test(d.fabric_name || ''));
    const laborTotal = laborItems.reduce((s, d) => {
      // US$/toy = price_rmb (stored as HKD) × rmb_hkd / hkd_usd
      const usdPerToy = (parseFloat(d.price_rmb) || 0) / rmb_hkd / hkd_usd;
      return s + usdPerToy;
    }, 0);

    // Fixed labor rate from params: labor_hkd / 11hr / hkd_usd (e.g. 275/11/7.75 = 3.226)
    const laborHkd = parseFloat(params.labor_hkd) || 0;
    const LABOR_RATE_USD = laborHkd ? Math.round(laborHkd / 11 / hkd_usd * 1000) / 1000 : 3.226;

    const laborRows = laborItems.map(d => {
      const rateUsd = LABOR_RATE_USD;
      const usdPerToy = (parseFloat(d.price_rmb) || 0) / rmb_hkd / hkd_usd;
      const stdHour = rateUsd > 0 ? usdPerToy / rateUsd : 0;                // standard hour
      return `
        <tr>
          <td class="center"><input type="checkbox" class="row-check-labor" data-id="${d.id}"></td>
          <td class="editable-labor" data-id="${d.id}" data-field="fabric_name" data-type="text">${escapeHtml(d.fabric_name || '')}</td>
          <td class="editable-labor num" data-id="${d.id}" data-field="material_price_rmb" data-type="number">${formatNumber(rateUsd, 4)}</td>
          <td class="num">${formatNumber(stdHour, 4)}</td>
          <td class="num">${formatNumber(usdPerToy, 4)}</td>
        </tr>
      `;
    }).join('');

    // ── Electronics Assembly ─────────────────────────────────────────────────
    const elecSummary = versionData.electronic_summary || {};
    // Sum: 贴片成本 + 人工成本 + 测试费用 + 包装运输 (RMB), formula: ÷0.85÷7.75×1.06×1.1
    const elecLaborRmb = (parseFloat(elecSummary.smt_cost) || 0)
                       + (parseFloat(elecSummary.labor_cost) || 0)
                       + (parseFloat(elecSummary.test_cost) || 0)
                       + (parseFloat(elecSummary.packaging_transport) || 0);
    const elecLaborUsd = elecLaborRmb / rmb_hkd / hkd_usd * 1.06 * 1.1;

    const hkdUsdGrand = parseFloat((versionData.params || {}).hkd_usd) || 7.75;
    const PACKING_NAMES = /半成品人工|包装人工|查货/;
    const packingGrandTotal = (versionData.hardware_items || [])
      .filter(h => h.part_category === 'labor_assembly' && PACKING_NAMES.test(h.name || ''))
      .reduce((s, h) => s + (parseFloat(h.new_price) || 0) / hkdUsdGrand, 0);
    const grandTotal = laborTotal + packingGrandTotal + elecLaborUsd;

    return `
      <div class="spin-section" style="border:2px solid #2c3e50;margin-bottom:16px">
        <div class="spin-section-header" style="background:#2c3e50;color:#fff">
          <div class="spin-section-accent" style="background:#f39c12"></div>
          <span class="spin-section-title" style="color:#fff">Grand Total <span class="spin-section-subtitle" style="color:#ccc">所有人工合计</span></span>
          <span class="spin-section-total" style="color:#f39c12">${formatNumber(grandTotal, 4)} USD</span>
        </div>
      </div>

      <div class="spin-section">
        <div class="spin-section-header">
          <div class="spin-section-accent" style="background:#e74c3c"></div>
          <span class="spin-section-title">Labor Misc <span class="spin-section-subtitle">工时数据</span></span>
          <button class="btn btn-primary" id="spinLaborAdd">+ 添加</button>
          <button class="btn btn-danger" id="spinLaborDel">删除</button>
          <span class="spin-section-total">Sub Total: ${formatNumber(laborTotal, 4)} USD</span>
        </div>
        <div class="spin-section-body">
          <div class="data-table-wrap">
            <table class="data-table">
              <thead><tr>
                <th style="width:30px"><input type="checkbox" id="spinLaborAll"></th>
                <th>Description</th><th>Labor rate (US$/hr)</th><th>Standard Hour</th><th>US$ per toy</th>
              </tr></thead>
              <tbody>${laborRows || '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:12px">暂无数据，点击 + 添加</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="spin-section">
        <div class="spin-section-header">
          <div class="spin-section-accent" style="background:#e67e22"></div>
          <span class="spin-section-title">Packing Labor <span class="spin-section-subtitle">包装人工</span></span>
          <span class="spin-section-total">Sub Total: ${formatNumber((() => {
            const hkdUsd = parseFloat((versionData.params || {}).hkd_usd) || 7.75;
            const NAMES = /半成品人工|包装人工|查货/;
            return (versionData.hardware_items || [])
              .filter(h => h.part_category === 'labor_assembly' && NAMES.test(h.name || ''))
              .reduce((s, h) => s + (parseFloat(h.new_price) || 0) / hkdUsd, 0);
          })(), 4)} USD</span>
        </div>
        <div class="spin-section-body">
          <div class="data-table-wrap">
            <table class="data-table">
              <thead><tr>
                <th>Description</th><th>Labor rate (US$/hr)</th><th>Standard Hour</th><th>US$ per toy</th>
              </tr></thead>
              <tbody>${(() => {
                const PACKING_LABOR_RATE = LABOR_RATE_USD;
                const hkdUsd = parseFloat((versionData.params || {}).hkd_usd) || 7.75;
                const NAMES = /半成品人工|包装人工|查货/;
                const items = (versionData.hardware_items || [])
                  .filter(h => h.part_category === 'labor_assembly' && NAMES.test(h.name || ''));
                if (!items.length) return '<tr><td colspan="4" style="text-align:center;color:#aaa;padding:8px">暂无数据</td></tr>';
                const rows = items.map(h => {
                  const usdPerToy = (parseFloat(h.new_price) || 0) / hkdUsd;
                  const stdHour = PACKING_LABOR_RATE > 0 ? usdPerToy / PACKING_LABOR_RATE : 0;
                  return `<tr>
                    <td>${escapeHtml(h.name || '')}</td>
                    <td class="num">${formatNumber(PACKING_LABOR_RATE, 4)}</td>
                    <td class="num">${formatNumber(stdHour, 4)}</td>
                    <td class="num">${formatNumber(usdPerToy, 4)}</td>
                  </tr>`;
                });
                const totalUsd = items.reduce((s, h) => s + (parseFloat(h.new_price) || 0) / hkdUsd, 0);
                const totalHrs = PACKING_LABOR_RATE > 0 ? totalUsd / PACKING_LABOR_RATE : 0;
                rows.push(`<tr style="font-weight:600;border-top:2px solid #ddd">
                  <td>Total</td><td></td>
                  <td class="num">${formatNumber(totalHrs, 4)}</td>
                  <td class="num">${formatNumber(totalUsd, 4)}</td>
                </tr>`);
                return rows.join('');
              })()}</tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="spin-section">
        <div class="spin-section-header">
          <div class="spin-section-accent" style="background:#2980b9"></div>
          <span class="spin-section-title">Electronics Assembly <span class="spin-section-subtitle">电子装配工时</span></span>
          <span class="spin-section-total">Sub Total: ${formatNumber(elecLaborUsd, 4)} USD</span>
        </div>
        <div class="spin-section-body">
          <div class="data-table-wrap">
            <table class="data-table">
              <thead><tr>
                <th>Description</th><th>Labor rate (US$/hr)</th><th>Standard Hour</th><th>US$ per toy</th>
              </tr></thead>
              <tbody>
                ${(() => {
                  const ELEC_RATE = LABOR_RATE_USD;
                  const items = [
                    { label: 'SMT (贴片成本)',         rmb: parseFloat(elecSummary.smt_cost) || 0 },
                    { label: 'Labor (人工成本)',        rmb: parseFloat(elecSummary.labor_cost) || 0 },
                    { label: 'Test (测试费用)',         rmb: parseFloat(elecSummary.test_cost) || 0 },
                    { label: 'Packing & Transport (包装运输)', rmb: parseFloat(elecSummary.packaging_transport) || 0 },
                  ];
                  const rows = items.map(it => {
                    const usd = it.rmb / rmb_hkd / hkd_usd * 1.06 * 1.1;
                    const hrs = ELEC_RATE > 0 ? usd / ELEC_RATE : 0;
                    return `<tr>
                      <td>${it.label}</td>
                      <td class="num">${formatNumber(ELEC_RATE, 4)}</td>
                      <td class="num">${formatNumber(hrs, 4)}</td>
                      <td class="num">${formatNumber(usd, 4)}</td>
                    </tr>`;
                  });
                  rows.push(`<tr style="font-weight:600;border-top:2px solid #ddd">
                    <td>Total</td><td></td>
                    <td class="num">${formatNumber(elecLaborUsd / ELEC_RATE, 4)}</td>
                    <td class="num">${formatNumber(elecLaborUsd, 4)}</td>
                  </tr>`);
                  return rows.join('');
                })()}
              </tbody>
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
    const LABOR_NAMES = /^(裁床人工|车缝人工|手工人工)/;
    const laborItems = filtered.filter(d => d.position === '__labor__' && LABOR_NAMES.test(d.fabric_name || ''));

    const params     = versionData.params || {};
    const hkd_usd   = parseFloat(params.hkd_usd) || 7.75;
    const rmb_hkd   = parseFloat(params.rmb_hkd) || 0.85;
    const rmbUsdRate = rmb_hkd * hkd_usd;

    container.querySelector('#spinLaborAll')?.addEventListener('change', e => {
      container.querySelectorAll('.row-check-labor').forEach(c => c.checked = e.target.checked);
    });

    container.querySelector('#spinLaborAdd')?.addEventListener('click', async () => {
      try {
        const sub = activeSub || '';
        await api.addSectionItem(versionId, 'sewing-detail', { fabric_name: '', position: '__labor__', usage_amount: 0, material_price_rmb: 0, sub_product: sub, product_name: sub });
        app.refresh();
      } catch (e) { showToast('添加失败: ' + e.message, 'error'); }
    });

    container.querySelector('#spinLaborDel')?.addEventListener('click', async () => {
      const ids = [...container.querySelectorAll('.row-check-labor:checked')].map(c => c.dataset.id);
      if (!ids.length) return showToast('请先选择要删除的行', 'info');
      if (!confirm(`确定删除 ${ids.length} 行？`)) return;
      try {
        await Promise.all(ids.map(id => api.deleteSectionItem(versionId, 'sewing-detail', id)));
        app.refresh();
      } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
    });

    container.querySelectorAll('td.editable-labor').forEach(td => {
      const id = td.dataset.id, field = td.dataset.field, type = td.dataset.type;
      const item = laborItems.find(m => String(m.id) === id);
      if (!item) return;
      // Display value: convert RMB rate → USD for material_price_rmb field
      const displayVal = field === 'material_price_rmb'
        ? (parseFloat(item[field]) || 0) / rmbUsdRate
        : item[field];
      makeEditable(td, {
        type, value: displayVal,
        onSave: async (val) => {
          try {
            // Store back as RMB
            const saveVal = field === 'material_price_rmb'
              ? parseFloat(val) * rmbUsdRate
              : val;
            await api.updateSectionItem(versionId, 'sewing-detail', id, { [field]: saveVal });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });
  },
};
