/* Tab: vq-transport — E. Transport (TransportConfig) */
const tab_vq_transport = {
  render(versionData) {
    const tc = versionData.transport_config || {};
    const params = versionData.params || {};

    // Calculate per-pc costs for different routes and MOQs
    const cuft = parseFloat(tc.cuft_per_box) || 0;
    const pcsPerBox = parseFloat(tc.pcs_per_box) || 1;

    function perPc(containerCuft, shippingCost, moq) {
      if (!containerCuft || !cuft || !moq) return null;
      const boxes = Math.ceil(moq / pcsPerBox);
      const cuftNeeded = boxes * cuft;
      return (shippingCost / containerCuft) * cuftNeeded / moq;
    }

    const moqs = [2500, 5000, 10000, 15000];

    const routes = [
      { key: 'hk_40',  label: '香港 40呎', cuftKey: 'container_40_cuft', costKey: 'hk_40_cost' },
      { key: 'hk_20',  label: '香港 20呎', cuftKey: 'container_20_cuft', costKey: 'hk_20_cost' },
      { key: 'yt_40',  label: '盐田 40呎', cuftKey: 'container_40_cuft', costKey: 'yt_40_cost' },
      { key: 'yt_20',  label: '盐田 20呎', cuftKey: 'container_20_cuft', costKey: 'yt_20_cost' },
      { key: 'hk_10t', label: '香港 10T车', cuftKey: 'truck_10t_cuft',   costKey: 'hk_10t_cost' },
      { key: 'yt_10t', label: '盐田 10T车', cuftKey: 'truck_10t_cuft',   costKey: 'yt_10t_cost' },
      { key: 'hk_5t',  label: '香港 5T车',  cuftKey: 'truck_5t_cuft',    costKey: 'hk_5t_cost' },
      { key: 'yt_5t',  label: '盐田 5T车',  cuftKey: 'truck_5t_cuft',    costKey: 'yt_5t_cost' },
    ];

    const perPcHeader = moqs.map(q => `<th>${(q/1000).toFixed(1)}K/pc</th>`).join('');
    const routeRows = routes.map(r => {
      const cCuft = parseFloat(tc[r.cuftKey]) || 0;
      const cost = parseFloat(tc[r.costKey]) || 0;
      const cells = moqs.map(q => {
        const v = perPc(cCuft, cost, q);
        return `<td class="num">${v != null ? formatNumber(v, 2) : '—'}</td>`;
      }).join('');
      return `
        <tr>
          <td>${r.label}</td>
          <td class="num editable" data-field="${r.costKey}" data-type="number">${formatNumber(cost, 2)}</td>
          ${cells}
        </tr>
      `;
    }).join('');

    function tcField(key, label, unit) {
      return `
        <tr>
          <td>${label}</td>
          <td class="num editable" data-field="${key}" data-type="number">
            ${tc[key] != null ? formatNumber(tc[key], 2) : '—'}
          </td>
          ${unit ? `<td style="color:#888">${unit}</td>` : '<td></td>'}
        </tr>
      `;
    }

    return `
      <div class="toolbar">
        <span class="toolbar-title">E. Transport</span>
        <span class="toolbar-spacer"></span>
        <span class="toolbar-stats">
          体积/箱: <b>${formatNumber(cuft, 2)}</b> cuft &nbsp;|&nbsp;
          PCS/箱: <b>${pcsPerBox}</b>
        </span>
      </div>
      <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:16px">
        <div class="data-table-wrap" style="flex:0 0 auto;min-width:220px">
          <table class="data-table">
            <thead><tr><th colspan="3">装箱规格</th></tr></thead>
            <tbody>
              ${tcField('cuft_per_box', '体积/箱', 'cuft')}
              ${tcField('pcs_per_box', 'PCS/箱', 'pcs')}
              ${tcField('container_40_cuft', '40呎柜', 'cuft')}
              ${tcField('container_20_cuft', '20呎柜', 'cuft')}
              ${tcField('truck_10t_cuft', '10T车', 'cuft')}
              ${tcField('truck_5t_cuft', '5T车', 'cuft')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>运输路线</th>
              <th>运费 HKD</th>
              ${perPcHeader}
            </tr>
          </thead>
          <tbody>${routeRows}</tbody>
        </table>
      </div>
      <p style="margin:8px 0 0;font-size:12px;color:#888">每件运费 = 运费总额 / 柜体积 × 所需体积 / 数量</p>
    `;
  },

  init(container, versionData, versionId) {
    const tc = versionData.transport_config || {};

    container.querySelectorAll('td.editable[data-field]').forEach(td => {
      const field = td.dataset.field;
      const type = td.dataset.type;
      makeEditable(td, {
        type,
        value: tc[field],
        onSave: async (val) => {
          try {
            await fetch(`/api/versions/${versionId}/sections/transport`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [field]: val }),
            });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });
  },
};
