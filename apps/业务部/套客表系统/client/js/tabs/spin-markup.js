/* Tab: spin-markup — SPIN Markup (加价率设置) */
const tab_spin_markup = {
  render(versionData) {
    const params = versionData.params || {};
    const markupBody = parseFloat(params.markup_body) != null ? (parseFloat(params.markup_body) || 0) : 0.15;
    const markupPkg  = parseFloat(params.markup_packaging) != null ? (parseFloat(params.markup_packaging) || 0) : 0.10;
    const markupLabor = parseFloat(params.markup_labor) != null ? (parseFloat(params.markup_labor) || 0) : 0.15;

    return `
      <div class="toolbar">
        <span class="toolbar-title">Markup Settings (加价率设置)</span>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>名称</th>
            <th>加价率 %</th>
            <th>备注</th>
          </tr></thead>
          <tbody>
            <tr>
              <td>Material Markup</td>
              <td class="num editable-inline-cell">
                <span class="editable-inline" id="spinMarkupBody" style="cursor:pointer;border-bottom:1px dashed #888">${(markupBody * 100).toFixed(2)}%</span>
              </td>
              <td>布料成本加价率</td>
            </tr>
            <tr>
              <td>Packaging Markup</td>
              <td class="num editable-inline-cell">
                <span class="editable-inline" id="spinMarkupPkg" style="cursor:pointer;border-bottom:1px dashed #888">${(markupPkg * 100).toFixed(2)}%</span>
              </td>
              <td>包装成本加价率</td>
            </tr>
            <tr>
              <td>Labor Markup</td>
              <td class="num editable-inline-cell">
                <span class="editable-inline" id="spinMarkupLabor" style="cursor:pointer;border-bottom:1px dashed #888">${(markupLabor * 100).toFixed(2)}%</span>
              </td>
              <td>工时成本加价率</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  },

  init(container, versionData, versionId) {
    const params = versionData.params || {};

    const bodyCell = container.querySelector('#spinMarkupBody');
    if (bodyCell) {
      makeEditable(bodyCell, {
        type: 'number',
        value: (parseFloat(params.markup_body) || 0.15) * 100,
        format: v => parseFloat(v).toFixed(2) + '%',
        onSave: async (val) => {
          try {
            await api.updateParams(versionId, { markup_body: parseFloat(val) / 100 });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    }

    const pkgCell = container.querySelector('#spinMarkupPkg');
    if (pkgCell) {
      makeEditable(pkgCell, {
        type: 'number',
        value: (parseFloat(params.markup_packaging) || 0.10) * 100,
        format: v => parseFloat(v).toFixed(2) + '%',
        onSave: async (val) => {
          try {
            await api.updateParams(versionId, { markup_packaging: parseFloat(val) / 100 });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    }

    const laborCell = container.querySelector('#spinMarkupLabor');
    if (laborCell) {
      makeEditable(laborCell, {
        type: 'number',
        value: (parseFloat(params.markup_labor) || 0.15) * 100,
        format: v => parseFloat(v).toFixed(2) + '%',
        onSave: async (val) => {
          try {
            await api.updateParams(versionId, { markup_labor: parseFloat(val) / 100 });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    }
  },
};
