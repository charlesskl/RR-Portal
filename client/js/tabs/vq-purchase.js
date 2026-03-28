/* Tab: vq-purchase — C. Purchase Parts Cost (VQ read-only view) */
const tab_vq_purchase = {
  render(versionData) {
    const items = versionData.hardware_items || [];
    const params = versionData.params || {};
    const markup = parseFloat(params.markup_body) || 0;

    const subTotal = items.reduce((s, h) => s + (parseFloat(h.new_price) || 0), 0);
    const amount = subTotal * (1 + markup);

    const rows = items.map(h => `
      <tr>
        <td>${escapeHtml(h.name || '')}</td>
        <td class="num">${h.quantity != null ? h.quantity : '—'}</td>
        <td class="num">${formatNumber(h.old_price, 2)}</td>
        <td class="num">${formatNumber(h.new_price, 2)}</td>
        <td class="num ${(h.difference || 0) >= 0 ? '' : 'text-danger'}">${formatNumber(h.difference, 2)}</td>
        <td class="center">${escapeHtml(h.tax_type || '')}</td>
      </tr>
    `).join('');

    return `
      <div class="toolbar">
        <span class="toolbar-title">C. Purchase Parts Cost</span>
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
              <th>名称</th><th>用量</th><th>开模报价</th><th>样板报价</th><th>差额</th><th>含税</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="6" style="text-align:center;color:#aaa;padding:20px">暂无采购件</td></tr>'}
          </tbody>
        </table>
      </div>
      <p style="margin:12px 0 0;font-size:12px;color:#888">
        * 明细请在 BD → C. Purchase Parts 标签编辑
      </p>
      <style>.text-danger{color:#e74c3c}</style>
    `;
  },

  init(container, versionData, versionId) {
    // Read-only view; editing done in BD purchase tab
  },
};
