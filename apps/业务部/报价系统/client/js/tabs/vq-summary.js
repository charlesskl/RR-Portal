/* Tab: vq-summary — Summary (VQ cost matrix across MOQs) */
const tab_vq_summary = {
  _calcSummary(versionData) {
    const parts = versionData.mold_parts || [];
    const hw = versionData.hardware_items || [];
    const pkg = versionData.packaging_items || [];
    const pd = versionData.painting_detail || {};
    const tc = versionData.transport_config || {};
    const dim = versionData.product_dimension || {};
    const mc = versionData.mold_cost || {};
    const params = versionData.params || {};

    const markupBody = parseFloat(params.markup_body) || 0;
    const markupPkg  = parseFloat(params.markup_packaging) || 0;
    const markupPoint = parseFloat(params.markup_point) || 1;
    const paymentDiv = parseFloat(params.payment_divisor) || 0.98;
    const surcharge  = parseFloat(params.surcharge_pct) || 0.004;
    const boxPrice   = parseFloat(params.box_price_hkd) || 0;
    const hkdUsd     = parseFloat(params.hkd_usd) || 0.1291;
    const rmb_hkd    = parseFloat(params.rmb_hkd) || 0.85;

    // A. Body Cost
    const rawAmt  = parts.reduce((s, p) => s + (parseFloat(p.material_cost_hkd) || 0), 0) * (1 + markupBody);
    const moldAmt = parts.reduce((s, p) => s + (parseFloat(p.molding_labor) || 0), 0) * (1 + markupBody);
    const purAmt  = hw.reduce((s, h) => s + (parseFloat(h.new_price) || 0), 0) * (1 + markupBody);
    const decSub  = (parseFloat(pd.labor_cost_hkd) || 0) + (parseFloat(pd.paint_cost_hkd) || 0);
    const decAmt  = decSub * (1 + markupBody);
    const bodyCost = rawAmt + moldAmt + purAmt + decAmt;

    // B. Packaging
    const pkgItems = pkg.reduce((s, i) => s + (parseFloat(i.new_price) || 0), 0);
    const packagingTotal = (pkgItems + boxPrice) * (1 + markupPkg);

    // C. Purchase (already included in body cost in this model)
    // D. Master Carton per pc
    const cartonPrice = parseFloat(dim.carton_price) || 0;
    const pcsPerCarton = parseInt(dim.pcs_per_carton) || 1;
    const cartonPerPc = pcsPerCarton > 0 ? cartonPrice / pcsPerCarton : 0;

    // Sub before transport
    const subBeforeTransport = bodyCost + packagingTotal + cartonPerPc;

    // Transport: cuft/box and pcs/box
    const cuft = parseFloat(tc.cuft_per_box) || 0;
    const pcsPerBox = parseFloat(tc.pcs_per_box) || 1;

    function transportPerPc(containerCuft, shippingCost, moq) {
      if (!containerCuft || !cuft || !moq) return 0;
      const boxes = Math.ceil(moq / pcsPerBox);
      const cuftNeeded = boxes * cuft;
      return (shippingCost / containerCuft) * cuftNeeded / moq;
    }

    // Mold amortization
    const moldAmortRmb = parseFloat(mc.amortization_rmb) || 0;
    const moldPerPc = rmb_hkd > 0 ? moldAmortRmb / rmb_hkd : 0;

    const moqs = [2500, 5000, 10000, 15000];
    // Use YT-40 as default transport route
    const yt40Cost = parseFloat(tc.yt_40_cost) || 0;
    const yt40Cuft = parseFloat(tc.container_40_cuft) || 0;

    const matrix = moqs.map(moq => {
      const trans = transportPerPc(yt40Cuft, yt40Cost, moq);
      const subTotal = subBeforeTransport + trans;
      const surchargeAmt = subTotal * surcharge;
      const afterSurcharge = subTotal + surchargeAmt;
      const withPoint = afterSurcharge * markupPoint;
      const totalHkd = withPoint / paymentDiv;
      const totalUsd = totalHkd * hkdUsd;
      return {
        moq,
        body: bodyCost,
        packaging: packagingTotal,
        carton: cartonPerPc,
        transport: trans,
        subTotal,
        surcharge: surchargeAmt,
        afterSurcharge,
        markupPointAmt: withPoint - afterSurcharge,
        withPoint,
        totalHkd,
        totalUsd,
        totalWithMoldHkd: totalHkd + moldPerPc,
        totalWithMoldUsd: (totalHkd + moldPerPc) * hkdUsd,
      };
    });

    return {
      matrix,
      bodyCost,
      packagingTotal,
      cartonPerPc,
      subBeforeTransport,
      moldPerPc,
      params: { markupBody, markupPkg, markupPoint, paymentDiv, surcharge, hkdUsd },
    };
  },

  render(versionData) {
    const params = versionData.params || {};
    const summary = this._calcSummary(versionData);
    const { matrix, bodyCost, packagingTotal, cartonPerPc, moldPerPc } = summary;

    const moqHeaders = matrix.map(r => `<th>${(r.moq/1000).toFixed(1)}K pcs</th>`).join('');

    function rowOf(label, key, decimals = 4) {
      const cells = matrix.map(r => `<td class="num">${formatNumber(r[key], decimals)}</td>`).join('');
      return `<tr><td>${label}</td>${cells}</tr>`;
    }

    const hkdUsd = parseFloat(params.hkd_usd) || 0.1291;
    const rmb_hkd = parseFloat(params.rmb_hkd) || 0.85;
    const markupPoint = parseFloat(params.markup_point) || 1;
    const paymentDiv = parseFloat(params.payment_divisor) || 0.98;
    const surcharge = parseFloat(params.surcharge_pct) || 0.004;

    return `
      <div class="toolbar">
        <span class="toolbar-title">VQ Summary</span>
        <span class="toolbar-spacer"></span>
        <span class="toolbar-stats">
          Body: <b>${formatNumber(bodyCost, 2)}</b> &nbsp;|&nbsp;
          Pkg: <b>${formatNumber(packagingTotal, 2)}</b> &nbsp;|&nbsp;
          CTN/pc: <b>${formatNumber(cartonPerPc, 2)}</b> HKD
        </span>
      </div>

      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th style="min-width:180px">项目</th>
              ${moqHeaders}
            </tr>
          </thead>
          <tbody>
            ${rowOf('A. Body Cost HKD', 'body')}
            ${rowOf('B. Packaging HKD', 'packaging')}
            ${rowOf('D. Master Carton /pc HKD', 'carton')}
            ${rowOf('E. Transport /pc HKD (YT40)', 'transport')}
            <tr style="font-weight:bold;background:#eef2fb">
              <td>小计 Sub Total HKD</td>
              ${matrix.map(r => `<td class="num"><b>${formatNumber(r.subTotal, 2)}</b></td>`).join('')}
            </tr>
            <tr>
              <td>附加税 (${((surcharge)*100).toFixed(2)}%)</td>
              ${matrix.map(r => `<td class="num">${formatNumber(r.surcharge, 2)}</td>`).join('')}
            </tr>
            <tr>
              <td>码点 (×${markupPoint.toFixed(4)})</td>
              ${matrix.map(r => `<td class="num">${formatNumber(r.markupPointAmt, 2)}</td>`).join('')}
            </tr>
            <tr>
              <td>找数 (÷${paymentDiv.toFixed(4)})</td>
              ${matrix.map(r => `<td class="num">${formatNumber(r.totalHkd - r.withPoint, 2)}</td>`).join('')}
            </tr>
            <tr style="font-weight:bold;background:#dce8f8">
              <td>合计 Total HKD</td>
              ${matrix.map(r => `<td class="num"><b>${formatNumber(r.totalHkd, 2)}</b></td>`).join('')}
            </tr>
            <tr style="font-weight:bold;background:#dce8f8">
              <td>合计 Total USD</td>
              ${matrix.map(r => `<td class="num"><b>${formatNumber(r.totalUsd, 2)}</b></td>`).join('')}
            </tr>
            <tr style="border-top:2px solid #ccc">
              <td style="color:#888">模费摊销/件 HKD</td>
              ${matrix.map(() => `<td class="num" style="color:#888">${formatNumber(moldPerPc, 2)}</td>`).join('')}
            </tr>
            <tr style="font-weight:bold;background:#fef9e7">
              <td>含模费 Total HKD</td>
              ${matrix.map(r => `<td class="num"><b>${formatNumber(r.totalWithMoldHkd, 2)}</b></td>`).join('')}
            </tr>
            <tr style="font-weight:bold;background:#fef9e7">
              <td>含模费 Total USD</td>
              ${matrix.map(r => `<td class="num"><b>${formatNumber(r.totalWithMoldUsd, 2)}</b></td>`).join('')}
            </tr>
          </tbody>
        </table>
      </div>

      <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:16px">
        <div class="data-table-wrap" style="flex:1;min-width:220px">
          <table class="data-table">
            <thead><tr><th colspan="2">参数 Parameters</th></tr></thead>
            <tbody>
              <tr><td>HKD/USD</td><td class="num">${hkdUsd}</td></tr>
              <tr><td>RMB→HKD</td><td class="num">${rmb_hkd}</td></tr>
              <tr><td>Body Mark Up</td><td class="num">${((parseFloat(params.markup_body)||0)*100).toFixed(1)}%</td></tr>
              <tr><td>Pkg Mark Up</td><td class="num">${((parseFloat(params.markup_packaging)||0)*100).toFixed(1)}%</td></tr>
              <tr><td>附加税率</td><td class="num">${(surcharge*100).toFixed(2)}%</td></tr>
              <tr><td>码点</td><td class="num">×${markupPoint.toFixed(4)}</td></tr>
              <tr><td>找数</td><td class="num">÷${paymentDiv.toFixed(4)}</td></tr>
            </tbody>
          </table>
        </div>
        <div class="data-table-wrap" style="flex:1;min-width:220px">
          <table class="data-table">
            <thead><tr><th colspan="2">模费 Mold Cost</th></tr></thead>
            <tbody>
              ${versionData.mold_cost ? `
                <tr><td>开模费 RMB</td><td class="num">${formatNumber(versionData.mold_cost.mold_cost_rmb, 2)}</td></tr>
                <tr><td>五金模 RMB</td><td class="num">${formatNumber(versionData.mold_cost.hardware_mold_cost_rmb, 2)}</td></tr>
                <tr><td>喷油模 RMB</td><td class="num">${formatNumber(versionData.mold_cost.paint_mold_cost_rmb, 2)}</td></tr>
                <tr><td><b>模费合计 RMB</b></td><td class="num"><b>${formatNumber(versionData.mold_cost.total_mold_rmb, 2)}</b></td></tr>
                <tr><td>模费合计 USD</td><td class="num">${formatNumber(versionData.mold_cost.total_mold_usd, 2)}</td></tr>
                <tr><td>客户补贴 USD</td><td class="num">${formatNumber(versionData.mold_cost.customer_subsidy_usd, 2)}</td></tr>
                <tr><td>摊销数量</td><td class="num">${versionData.mold_cost.amortization_qty || '—'}</td></tr>
                <tr><td>摊销金额 RMB</td><td class="num">${formatNumber(versionData.mold_cost.amortization_rmb, 2)}</td></tr>
                <tr><td>摊销/件 HKD</td><td class="num">${formatNumber(moldPerPc, 2)}</td></tr>
              ` : '<tr><td colspan="2" style="text-align:center;color:#aaa">无模费数据</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  init(container, versionData, versionId) {
    // Read-only calculated view
  },
};
