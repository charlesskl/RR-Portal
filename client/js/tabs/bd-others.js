/* Tab: bd-others — E. Others (Assembly labor, packaging labor, accessories) */
const tab_bd_others = {
  render(versionData) {
    const params = versionData.params || {};
    const markup = parseFloat(params.markup_body) || 0;

    // "Others" pulls from hardware_items that are labor-type (no new_price means summary rows)
    // and electronic summary final price
    const eSum = versionData.electronic_summary || {};
    const electronicHkd = parseFloat(eSum.final_price_usd || 0) / (parseFloat(params.hkd_usd) || 0.1291);

    // Mold parts — assembly/packaging labor stored separately in plan
    // For now, show electronic summary + configurable misc items
    const subTotal = electronicHkd;
    const amount = subTotal * (1 + markup);

    const eRows = eSum.final_price_usd ? `
      <tr>
        <td>电子件 (PCBA)</td>
        <td class="num">${formatNumber(eSum.final_price_usd, 2)} USD</td>
        <td class="num">${formatNumber(electronicHkd, 2)}</td>
        <td>—</td>
      </tr>
    ` : '';

    const eSummaryBlock = eSum.total_cost ? `
      <div class="data-table-wrap" style="margin-top:16px">
        <table class="data-table">
          <thead><tr><th colspan="2">电子汇总 (Electronic Summary)</th></tr></thead>
          <tbody>
            ${eSum.parts_cost != null ? `<tr><td>零件成本</td><td class="num">${formatNumber(eSum.parts_cost, 2)} USD</td></tr>` : ''}
            ${eSum.bonding_cost != null ? `<tr><td>邦定成本</td><td class="num">${formatNumber(eSum.bonding_cost, 2)} USD</td></tr>` : ''}
            ${eSum.smt_cost != null ? `<tr><td>贴片成本</td><td class="num">${formatNumber(eSum.smt_cost, 2)} USD</td></tr>` : ''}
            ${eSum.labor_cost != null ? `<tr><td>人工成本</td><td class="num">${formatNumber(eSum.labor_cost, 2)} USD</td></tr>` : ''}
            ${eSum.test_cost != null ? `<tr><td>测试费用</td><td class="num">${formatNumber(eSum.test_cost, 2)} USD</td></tr>` : ''}
            ${eSum.total_cost != null ? `<tr><td><b>合计成本</b></td><td class="num"><b>${formatNumber(eSum.total_cost, 2)} USD</b></td></tr>` : ''}
            ${eSum.profit_margin != null ? `<tr><td>利润率</td><td class="num">${formatNumber(eSum.profit_margin * 100, 1)}%</td></tr>` : ''}
            ${eSum.final_price_usd != null ? `<tr><td><b>含利润价 USD</b></td><td class="num"><b>${formatNumber(eSum.final_price_usd, 2)}</b></td></tr>` : ''}
            ${eSum.pcb_mold_cost_usd != null ? `<tr><td>PCB模费 USD</td><td class="num">${formatNumber(eSum.pcb_mold_cost_usd, 2)}</td></tr>` : ''}
          </tbody>
        </table>
      </div>
    ` : '';

    return `
      <div class="toolbar">
        <span class="toolbar-title">E. Others</span>
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
            <tr><th>项目</th><th>原始金额</th><th>HKD</th><th>备注</th></tr>
          </thead>
          <tbody>
            ${eRows}
            ${!eRows ? '<tr><td colspan="4" style="text-align:center;color:#aaa;padding:20px">暂无其他项目</td></tr>' : ''}
          </tbody>
        </table>
      </div>
      ${eSummaryBlock}
    `;
  },

  init(container, versionData, versionId) {
    // No editable fields in this tab for now
  },
};
