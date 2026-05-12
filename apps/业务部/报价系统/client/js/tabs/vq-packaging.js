/* Tab: vq-packaging — B. Packaging Materials & Packing Labour Cost */
const tab_vq_packaging = {
  render(versionData) {
    const items = versionData.packaging_items || [];
    const params = versionData.params || {};
    const markup = parseFloat(params.markup_packaging) || 0;

    const subTotal = items.reduce((s, i) => {
      return s + (parseFloat(i.quantity) || 0) * (parseFloat(i.new_price) || 0);
    }, 0);
    const markupAmt = subTotal * markup;
    const total = subTotal + markupAmt;

    const rows = items.map(item => {
      const amount = (parseFloat(item.quantity) || 0) * (parseFloat(item.new_price) || 0);
      return `
        <tr>
          <td class="center"><input type="checkbox" class="row-check" data-id="${item.id}"></td>
          <td class="editable" data-id="${item.id}" data-field="pm_no" data-type="text">${escapeHtml(item.pm_no || '')}</td>
          <td class="editable" data-id="${item.id}" data-field="name" data-type="text">${escapeHtml(item.name || '')}${item.eng_name && item.eng_name.toLowerCase() !== (item.name || '').toLowerCase() ? `<br><span style="color:#888;font-size:11px">${escapeHtml(item.eng_name)}</span>` : ''}</td>
          <td class="editable" data-id="${item.id}" data-field="remark" data-type="text">${escapeHtml(item.remark || '')}</td>
          <td class="editable num" data-id="${item.id}" data-field="moq" data-type="number">${item.moq != null ? item.moq : ''}</td>
          <td class="editable num" data-id="${item.id}" data-field="quantity" data-type="number">${formatNumber(item.quantity, 3)}</td>
          <td class="editable num" data-id="${item.id}" data-field="new_price" data-type="number">${formatNumber(item.new_price, 3)}</td>
          <td class="num">${formatNumber(amount, 2)}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="toolbar">
        <span class="toolbar-title">B. Packaging Materials &amp; Packing Labour Cost</span>
        <button class="btn btn-primary" id="vqPkgTranslate">自动翻译英文</button>
        <button class="btn btn-primary" id="vqPkgAdd">+ 添加行</button>
        <button class="btn btn-danger" id="vqPkgDelete">删除选中</button>
        <span class="toolbar-spacer"></span>
        <span class="toolbar-stats">
          Sub Total: <b>${formatNumber(subTotal, 2)}</b> &nbsp;|&nbsp;
          Mark Up: <b>${(markup * 100).toFixed(1)}%</b> &nbsp;|&nbsp;
          Amount: <b>${formatNumber(total, 2)}</b> HK$
        </span>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th><input type="checkbox" id="vqPkgAll"></th>
              <th>PM No.</th>
              <th>Part Descriptions</th>
              <th>Specifications</th>
              <th>MOQ</th>
              <th>Usage/Toy</th>
              <th>Unit Cost (HK$)</th>
              <th>Amount (HK$)</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="8" style="text-align:center;color:#aaa;padding:20px">暂无包装项目</td></tr>'}
            <tr style="font-weight:bold;background:#f0f4fa">
              <td colspan="6" style="text-align:right">Mark Up <span id="pkgMarkupCell" class="editable-inline" style="cursor:pointer;border-bottom:1px dashed #888">${(markup * 100).toFixed(2)}%</span></td>
              <td class="num">${formatNumber(markupAmt, 2)}</td>
              <td class="num" style="background:#222;color:#fff">HK$${formatNumber(total, 2)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  },

  init(container, versionData, versionId) {
    const items = versionData.packaging_items || [];
    const params = versionData.params || {};

    // Editable Mark Up
    const markupCell = container.querySelector('#pkgMarkupCell');
    if (markupCell) {
      makeEditable(markupCell, {
        type: 'number',
        value: (parseFloat(params.markup_packaging) || 0) * 100,
        format: v => parseFloat(v).toFixed(2) + '%',
        onSave: async (val) => {
          try {
            await api.updateParams(versionId, { markup_packaging: parseFloat(val) / 100 });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    }

    container.querySelector('#vqPkgAll')?.addEventListener('change', e => {
      container.querySelectorAll('.row-check').forEach(cb => cb.checked = e.target.checked);
    });

    container.querySelector('#vqPkgTranslate')?.addEventListener('click', async () => {
      try {
        showToast('正在翻译...', 'info');
        const r = await fetch(`/api/versions/${versionId}/translate-all`, { method: 'POST' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        showToast(`已翻译 ${d.translated} 条`, 'success');
        app.refresh();
      } catch (e) { showToast('翻译失败: ' + e.message, 'error'); }
    });

    container.querySelector('#vqPkgAdd')?.addEventListener('click', async () => {
      try {
        await api.addSectionItem(versionId, 'packaging', { name: '新包装件', pm_no: '', remark: '', moq: 2500, quantity: 1, new_price: 0 });
        app.refresh();
      } catch (e) { showToast('添加失败: ' + e.message, 'error'); }
    });

    container.querySelector('#vqPkgDelete')?.addEventListener('click', async () => {
      const ids = [...container.querySelectorAll('.row-check:checked')].map(cb => cb.dataset.id);
      if (!ids.length) return showToast('请先选择要删除的行', 'info');
      if (!confirm(`确定删除 ${ids.length} 行？`)) return;
      try {
        await Promise.all(ids.map(id => api.deleteSectionItem(versionId, 'packaging', id)));
        app.refresh();
      } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
    });

    container.querySelectorAll('td.editable').forEach(td => {
      const id = td.dataset.id;
      const field = td.dataset.field;
      const type = td.dataset.type;
      const item = items.find(i => String(i.id) === id) || {};
      makeEditable(td, {
        type,
        value: item[field],
        onSave: async (val) => {
          try {
            await api.updateSectionItem(versionId, 'packaging', id, { [field]: val });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });
  },
};
