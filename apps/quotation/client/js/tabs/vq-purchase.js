/* Tab: vq-purchase — C. Purchase Parts Cost (VQ read-only summary) */
const tab_vq_purchase = {
  render(versionData) {
    const elecItems   = versionData.electronic_items   || [];
    const elecSummary = versionData.electronic_summary || null;
    const params      = versionData.params || {};
    const markup      = parseFloat(params.markup_body) || 0;
    const rmb_hkd     = parseFloat(params.rmb_hkd) || 0.85;

    // 1. Electronic Components (HKD)
    const elecSubHkd = elecSummary
      ? (parseFloat(elecSummary.final_price_usd) || 0)
      : elecItems.reduce((s, e) => s + (parseFloat(e.total_usd) || 0), 0);

    const elecRows = elecItems.map(e => `
      <tr>
        <td>${escapeHtml(e.part_name || '')}${e.eng_name && e.eng_name.toLowerCase() !== (e.part_name || '').toLowerCase() ? `<br><span style="color:#888;font-size:11px">${escapeHtml(e.eng_name)}</span>` : ''}</td>
        <td>${escapeHtml(e.spec || '')}</td>
        <td class="num">${e.quantity != null ? e.quantity : ''}</td>
        <td class="num">${formatNumber(e.unit_price_usd, 4)}</td>
        <td class="num">${formatNumber(e.total_usd, 4)}</td>
      </tr>
    `).join('');

    const elecSummaryRow = elecSummary ? `
      <tr style="background:#f0f4ff;font-weight:bold">
        <td colspan="4">Electronic Summary (Final Price)</td>
        <td class="num">${formatNumber(elecSummary.final_price_usd, 2)} HK$</td>
      </tr>
    ` : '';

    // 2. Sewing Accessories
    const sewingDetails = versionData.sewing_details || [];
    const sewingItems   = sewingDetails.filter(s => !s.position && s.position !== '__labor__');
    const sewingSub = sewingItems.reduce((s, sw) => {
      return s + (rmb_hkd > 0 ? (parseFloat(sw.total_price_rmb) || 0) / rmb_hkd : 0);
    }, 0);

    const sewingRows = sewingItems.map(sw => {
      const hkd = rmb_hkd > 0 ? (parseFloat(sw.total_price_rmb) || 0) / rmb_hkd : 0;
      return `
        <tr>
          <td>${escapeHtml(sw.fabric_name || '')}</td>
          <td style="color:#888;font-style:italic">${escapeHtml(sw.eng_name || '')}</td>
          <td class="num">${formatNumber(sw.usage_amount, 4)}</td>
          <td class="num">${formatNumber(sw.material_price_rmb, 4)}</td>
          <td class="num">${formatNumber(hkd, 4)}</td>
        </tr>
      `;
    }).join('');

    // 3. Other Components (外购件)
    const bodyAccs = versionData.body_accessories || [];
    const otherSub = bodyAccs.reduce((s, b) => s + (parseFloat(b.usage_qty) || 0) * (parseFloat(b.unit_price) || 0), 0);

    const otherRows = bodyAccs.map(b => {
      const amount = (parseFloat(b.usage_qty) || 0) * (parseFloat(b.unit_price) || 0);
      const descCell = b.eng_name
        ? `${escapeHtml(b.description || '')}<br><span style="color:#888;font-size:11px">${escapeHtml(b.eng_name)}</span>`
        : escapeHtml(b.description || '');
      return `
        <tr>
          <td>${escapeHtml(b.category || '五金')}</td>
          <td>${escapeHtml(b.part_no || '')}</td>
          <td>${descCell}</td>
          <td class="num">${b.moq != null ? b.moq : ''}</td>
          <td class="num">${formatNumber(b.usage_qty, 4)}</td>
          <td class="num">${formatNumber(b.unit_price, 4)}</td>
          <td class="num"><b>${formatNumber(amount, 4)}</b></td>
        </tr>
      `;
    }).join('');

    const grandTotal = elecSubHkd + sewingSub + otherSub;
    const amount     = grandTotal * (1 + markup);

    return `
      <div class="toolbar">
        <span class="toolbar-title">C. Purchase Parts Cost</span>
        <span class="toolbar-spacer"></span>
        <span class="toolbar-stats">
          Sub Total: <b>${formatNumber(grandTotal, 2)}</b> &nbsp;|&nbsp;
          Mark Up: <b>${(markup * 100).toFixed(1)}%</b> &nbsp;|&nbsp;
          Amount: <b>${formatNumber(amount, 2)}</b>
        </span>
      </div>

      <div style="margin-top:16px">
        <div class="toolbar">
          <span class="toolbar-title">1. 电子零件 Electronic Components</span>
          <span class="toolbar-spacer"></span>
          <span class="toolbar-stats">Sub Total: <b>${formatNumber(elecSubHkd, 2)} HK$</b></span>
        </div>
        <div class="data-table-wrap">
          <table class="data-table">
            <thead><tr>
              <th>零件名称 Part Name</th><th>规格 Spec</th><th>数量 Qty</th><th>单价 Unit Price (HK$)</th><th>合计 Total (HK$)</th>
            </tr></thead>
            <tbody>
              ${elecRows || '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:10px">暂无电子零件</td></tr>'}
              ${elecSummaryRow}
            </tbody>
          </table>
        </div>
      </div>

      <div style="margin-top:16px">
        <div class="toolbar">
          <span class="toolbar-title">2. 车缝布料 Sewing Accessories</span>
          <span class="toolbar-spacer"></span>
          <span class="toolbar-stats">Sub Total: <b>${formatNumber(sewingSub, 2)} HK$</b></span>
        </div>
        <div class="data-table-wrap">
          <table class="data-table">
            <thead><tr>
              <th>中文名称</th><th>English Name</th><th>用量 Usage</th><th>物料价 (RMB)</th><th>金额 (HK$)</th>
            </tr></thead>
            <tbody>
              ${sewingRows || '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:10px">暂无布料</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div style="margin-top:16px">
        <div class="toolbar">
          <span class="toolbar-title">3. 外购件 Other Components</span>
          <button class="btn btn-primary" id="otherAutoTranslate">自动翻译英文</button>
          <span class="toolbar-spacer"></span>
          <span class="toolbar-stats">Sub Total: <b>${formatNumber(otherSub, 2)} HK$</b></span>
        </div>
        <div class="data-table-wrap">
          <table class="data-table">
            <thead><tr>
              <th>分类</th><th>零件编号 Part No.</th><th>描述 Description</th><th>MOQ</th><th>用量 Usage/Toy</th><th>单价 Unit Price (HK$)</th><th>金额 Amount</th>
            </tr></thead>
            <tbody>
              ${otherRows || '<tr><td colspan="7" style="text-align:center;color:#aaa;padding:10px">暂无外购件</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
      <p style="margin:12px 0 0;font-size:12px;color:#888">* 明细请在 BD → C. Purchase Parts 标签编辑</p>
    `;
  },

  init(container, versionData, versionId) {
    container.querySelector('#otherAutoTranslate')?.addEventListener('click', async () => {
      try {
        showToast('正在翻译...', 'info');
        const r = await fetch(`${api.BASE}/api/versions/${versionId}/translate-all`, { method: 'POST' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        showToast(`已翻译 ${d.translated} 条`, 'success');
        app.refresh();
      } catch (e) { showToast('翻译失败: ' + e.message, 'error'); }
    });
  },
};
