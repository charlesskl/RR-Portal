/* Tab: vq-carton — D. Master Carton (ProductDimension) */
const tab_vq_carton = {
  render(versionData) {
    const dim = versionData.product_dimension || {};
    const params = versionData.params || {};

    const cartonPrice = parseFloat(dim.carton_price) || 0;
    const pcsPerCarton = parseInt(dim.pcs_per_carton) || 0;
    const perPc = pcsPerCarton > 0 ? cartonPrice / pcsPerCarton : 0;

    function dimField(key, label, unit) {
      return `
        <tr>
          <td>${label}</td>
          <td class="num editable" data-section="dimensions" data-field="${key}" data-type="number">
            ${dim[key] != null ? formatNumber(dim[key], 2) : '—'}
          </td>
          ${unit ? `<td style="color:#888">${unit}</td>` : '<td></td>'}
        </tr>
      `;
    }

    return `
      <div class="toolbar">
        <span class="toolbar-title">D. Master Carton</span>
        <span class="toolbar-spacer"></span>
        <span class="toolbar-stats">
          Carton Price: <b>${formatNumber(cartonPrice, 2)}</b> HKD &nbsp;|&nbsp;
          PCS/CTN: <b>${pcsPerCarton || '—'}</b> &nbsp;|&nbsp;
          Per PC: <b>${formatNumber(perPc, 2)}</b> HKD
        </span>
      </div>
      <div style="display:flex;gap:20px;flex-wrap:wrap">
        <div class="data-table-wrap" style="flex:1;min-width:220px">
          <table class="data-table">
            <thead><tr><th>尺寸 (Product)</th><th>数值</th><th>单位</th></tr></thead>
            <tbody>
              ${dimField('product_l_inch', '长 (L)', 'inch')}
              ${dimField('product_w_inch', '宽 (W)', 'inch')}
              ${dimField('product_h_inch', '高 (H)', 'inch')}
            </tbody>
          </table>
        </div>
        <div class="data-table-wrap" style="flex:1;min-width:220px">
          <table class="data-table">
            <thead><tr><th>纸箱 (Carton)</th><th>数值</th><th>单位</th></tr></thead>
            <tbody>
              ${dimField('carton_l_inch', '箱长 (L)', 'inch')}
              ${dimField('carton_w_inch', '箱宽 (W)', 'inch')}
              ${dimField('carton_h_inch', '箱高 (H)', 'inch')}
              ${dimField('carton_cuft', '体积', 'cuft')}
              <tr>
                <td>纸板</td>
                <td class="editable" data-section="dimensions" data-field="carton_paper" data-type="text" colspan="2">
                  ${escapeHtml(dim.carton_paper || '—')}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="data-table-wrap" style="flex:1;min-width:220px">
          <table class="data-table">
            <thead><tr><th>装箱 (Packing)</th><th>数值</th><th>单位</th></tr></thead>
            <tbody>
              ${dimField('pcs_per_carton', 'PCS/CTN', 'pcs')}
              ${dimField('carton_price', '纸箱价', 'HKD')}
              <tr>
                <td><b>每件摊销</b></td>
                <td class="num" colspan="2"><b>${formatNumber(perPc, 2)}</b> HKD</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  init(container, versionData, versionId) {
    const dim = versionData.product_dimension || {};

    container.querySelectorAll('td.editable[data-section="dimensions"]').forEach(td => {
      const field = td.dataset.field;
      const type = td.dataset.type;
      makeEditable(td, {
        type,
        value: dim[field],
        onSave: async (val) => {
          try {
            await fetch(`/api/versions/${versionId}/sections/dimensions`, {
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
