/* Tab: bd-decoration — D. Decoration / 喷油 (Breakdown) */
const tab_bd_decoration = {
  render(versionData) {
    const pd = versionData.painting_detail || {};
    const params = versionData.params || {};
    const markup = parseFloat(params.markup_body) || 0;

    const laborCost = parseFloat(pd.labor_cost_hkd) || 0;
    const paintCost = parseFloat(pd.paint_cost_hkd) || 0;
    const subTotal = laborCost + paintCost;
    const amount = subTotal * (1 + markup);

    const ops = [
      { key: 'clamp_count', label: '夹 (Clamp)' },
      { key: 'print_count', label: '印 (Print)' },
      { key: 'wipe_count', label: '抹油 (Wipe)' },
      { key: 'edge_count', label: '边 (Edge)' },
      { key: 'spray_count', label: '散枪 (Spray)' },
      { key: 'total_operations', label: '总次数 (Total Ops)', readonly: true },
    ];

    const opRows = ops.map(op => `
      <tr>
        <td>${op.label}</td>
        <td class="num ${op.readonly ? '' : 'editable'}" data-section="painting" data-field="${op.key}" data-type="number">
          ${pd[op.key] != null ? pd[op.key] : '—'}
        </td>
      </tr>
    `).join('');

    const costFields = [
      { key: 'labor_cost_hkd', label: '喷油人工 HKD' },
      { key: 'paint_cost_hkd', label: '油漆 HKD' },
      { key: 'quoted_price_hkd', label: '报价 HKD <span style="color:#888;font-size:11px">(含码点 ×1.08)</span>' },
    ];

    const costRows = costFields.map(f => `
      <tr>
        <td>${f.label}</td>
        <td class="num editable" data-section="painting" data-field="${f.key}" data-type="number">
          ${formatNumber(pd[f.key], 2)}
        </td>
      </tr>
    `).join('');

    return `
      <div class="toolbar">
        <span class="toolbar-title">D. Decoration (喷油)</span>
        <span class="toolbar-spacer"></span>
        <span class="toolbar-stats">
          Sub Total: <b>${formatNumber(subTotal, 2)}</b> &nbsp;|&nbsp;
          Mark Up: <b>${(markup * 100).toFixed(1)}%</b> &nbsp;|&nbsp;
          Amount: <b>${formatNumber(amount, 2)}</b>
        </span>
      </div>
      <div style="display:flex;gap:20px;flex-wrap:wrap">
        <div class="data-table-wrap" style="flex:1;min-width:220px">
          <table class="data-table">
            <thead><tr><th>操作</th><th>次数</th></tr></thead>
            <tbody>${opRows}</tbody>
          </table>
        </div>
        <div class="data-table-wrap" style="flex:1;min-width:220px">
          <table class="data-table">
            <thead><tr><th>费用项目</th><th>金额 HKD</th></tr></thead>
            <tbody>${costRows}</tbody>
          </table>
        </div>
      </div>
    `;
  },

  init(container, versionData, versionId) {
    const pd = versionData.painting_detail || {};

    container.querySelectorAll('td.editable[data-section="painting"]').forEach(td => {
      const field = td.dataset.field;
      makeEditable(td, {
        type: 'number',
        value: pd[field],
        onSave: async (val) => {
          const update = { [field]: val };
          // Auto-calc total_operations
          if (['clamp_count','print_count','wipe_count','edge_count','spray_count'].includes(field)) {
            const cur = { ...pd, [field]: val };
            update.total_operations =
              (parseFloat(cur.clamp_count) || 0) +
              (parseFloat(cur.print_count) || 0) +
              (parseFloat(cur.wipe_count) || 0) +
              (parseFloat(cur.edge_count) || 0) +
              (parseFloat(cur.spray_count) || 0);
          }
          try {
            // Painting is a singleton section — use PUT /sections/painting (no itemId)
            await fetch(`/api/versions/${versionId}/sections/painting`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(update),
            });
            await api.calculate(versionId);
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });
  },
};
