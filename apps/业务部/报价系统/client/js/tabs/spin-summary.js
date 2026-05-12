/* Tab: spin-summary — SPIN Cost Summary (成本汇总) */
const tab_spin_summary = {
  render(versionData) {
    const params         = versionData.params || {};
    const sewingDetails  = versionData.sewing_details || [];
    const packagingItems = versionData.packaging_items || [];
    const hardwareItems  = versionData.hardware_items || [];
    const elecItems      = versionData.electronic_items || [];
    const elecSummary    = versionData.electronic_summary || {};
    const moldParts      = versionData.mold_parts || [];

    const rmb_hkd    = parseFloat(params.rmb_hkd) || 0.85;
    const hkd_usd    = parseFloat(params.hkd_usd) || 7.75;
    const rmbUsdRate = rmb_hkd * hkd_usd;

    const markupBody  = parseFloat(params.markup_body)      || 0.15;
    const markupPkg   = parseFloat(params.markup_packaging)  || 0.10;
    const markupLabor = parseFloat(params.markup_labor)      || 0.15;

    // Fabric + Other Cost (sewing_details, non-labor)
    const fabricRmb = sewingDetails
      .filter(d => d.position === '__fabric__')
      .reduce((s, d) => s + (parseFloat(d.usage_amount) || 0) * (parseFloat(d.material_price_rmb) || 0), 0);
    const otherRmb = sewingDetails
      .filter(d => d.position !== '__fabric__' && d.position !== '__labor__')
      .reduce((s, d) => s + (parseFloat(d.usage_amount) || 0) * (parseFloat(d.material_price_rmb) || 0), 0);

    // Labor (sewing_details __labor__)
    const laborRmb = sewingDetails
      .filter(d => d.position === '__labor__')
      .reduce((s, d) => s + (parseFloat(d.usage_amount) || 0) * (parseFloat(d.material_price_rmb) || 0), 0);

    // Packaging
    const packagingRmb = packagingItems.reduce((s, i) => {
      const unitPrice = i.unit_price != null ? i.unit_price : i.new_price;
      return s + (parseFloat(i.quantity) || 0) * (parseFloat(unitPrice) || 0);
    }, 0);

    // Metal Parts (HKD → USD)
    const metalItems = hardwareItems.filter(h => !h.part_category || h.part_category.toLowerCase() !== 'electronic');
    const metalUsd = metalItems.reduce((s, h) => s + (parseFloat(h.quantity) || 0) * ((parseFloat(h.new_price) || 0) / hkd_usd), 0);

    // Electronic Parts (already USD)
    const elecPartsUsd = elecItems.reduce((s, e) => s + (parseFloat(e.total_usd) || (parseFloat(e.quantity) || 0) * (parseFloat(e.unit_price_usd) || 0)), 0);
    const elecLaborUsd = parseFloat(elecSummary.labor_cost) || 0;

    // In-Housed Molding (HKD → USD)
    const moldingUsd = moldParts.reduce((s, m) => {
      const resinUsd   = ((parseFloat(m.unit_price_hkd_g) || 0) * (parseFloat(m.weight_g) || 0)) / hkd_usd;
      const moldLbrUsd = (parseFloat(m.molding_labor) || 0) / hkd_usd;
      return s + resinUsd + moldLbrUsd;
    }, 0);

    // USD totals with markup
    const fabricUsd    = rmbUsdRate > 0 ? fabricRmb  * (1 + markupBody)  / rmbUsdRate : 0;
    const otherUsd     = rmbUsdRate > 0 ? otherRmb   * (1 + markupBody)  / rmbUsdRate : 0;
    const packagingUsd = rmbUsdRate > 0 ? packagingRmb * (1 + markupPkg) / rmbUsdRate : 0;
    const laborUsd     = rmbUsdRate > 0 ? laborRmb   * (1 + markupLabor) / rmbUsdRate : 0;
    const totalUsd     = fabricUsd + otherUsd + metalUsd + elecPartsUsd + elecLaborUsd + moldingUsd + packagingUsd + laborUsd;

    const fmt = v => formatNumber(v, 4);
    const pct = v => (v * 100).toFixed(1) + '%';

    function row(label, rmb, markup, usd, highlight) {
      const style = highlight ? ' style="font-weight:bold;background:#1a2e44"' : '';
      const usdStyle = highlight ? ' style="color:#4fc3f7;font-size:15px"' : '';
      return `<tr${style}>
        <td>${label}</td>
        <td class="num">${rmb != null ? fmt(rmb) : '—'}</td>
        <td class="num">${markup != null ? pct(markup) : '—'}</td>
        <td class="num"${usdStyle}>${highlight ? 'US$ ' : ''}${fmt(usd)}</td>
      </tr>`;
    }

    return `
      <div class="toolbar">
        <span class="toolbar-title">Cost Summary (成本汇总)</span>
        <span class="toolbar-spacer"></span>
        <span class="toolbar-stats">
          Rate: 1 RMB = ${rmb_hkd} HKD &nbsp;|&nbsp; 1 USD = ${hkd_usd} HKD
        </span>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Cost Item</th>
            <th>RMB (sub-total)</th>
            <th>Markup</th>
            <th>USD (EX-FTY)</th>
          </tr></thead>
          <tbody>
            ${row('Fabric Cost',             fabricRmb,    markupBody,  fabricUsd)}
            ${row('Other Cost',              otherRmb,     markupBody,  otherUsd)}
            ${row('Metal Parts Cost',        null,         null,        metalUsd)}
            ${row('Electronic Parts Cost',   null,         null,        elecPartsUsd)}
            ${row('Electronics Assembly',    null,         null,        elecLaborUsd)}
            ${row('In-Housed Molding',       null,         null,        moldingUsd)}
            ${row('Packaging',               packagingRmb, markupPkg,   packagingUsd)}
            ${row('Labor',                   laborRmb,     markupLabor, laborUsd)}
            ${row('Total EX-FTY (USD)',      null,         null,        totalUsd, true)}
          </tbody>
        </table>
      </div>
      <div style="padding:10px 16px;font-size:12px;color:#7a9bbf">
        汇率换算：RMB → HKD (×${rmb_hkd}) → USD (÷${hkd_usd}) &nbsp;|&nbsp; 综合汇率：1 RMB = ${(rmbUsdRate > 0 ? 1/rmbUsdRate : 0).toFixed(6)} USD
      </div>
    `;
  },

  init(container, versionData, versionId) {
    // Summary tab is read-only; no interactive elements
  },
};
