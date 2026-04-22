/* Tab: bd-purchase — C. Purchase Parts Cost (Breakdown) */
const tab_bd_purchase = {

  render(versionData) {
    const hwItems  = versionData.hardware_items  || [];
    const elecItems = versionData.electronic_items || [];
    const elecSummary = versionData.electronic_summary || null;
    const params   = versionData.params || {};
    const markup   = parseFloat(params.markup_body) || 0;

    // ── 1. Electronic Components ──────────────────────────────────────────────
    const elecSubTotalHkd = elecSummary
      ? (parseFloat(elecSummary.final_price_usd) || 0)
      : elecItems.reduce((s, e) => s + (parseFloat(e.total_usd) || 0), 0);

    const elecRows = elecItems.map(e => `
      <tr>
        <td class="center"><input type="checkbox" class="row-check elec-check" data-id="${e.id}"></td>
        <td>${escapeHtml(e.part_name || '')}${e.eng_name && e.eng_name.toLowerCase() !== (e.part_name || '').toLowerCase() ? `<br><span style="color:#888;font-size:11px">${escapeHtml(e.eng_name)}</span>` : ''}</td>
        <td>${escapeHtml(e.spec || '')}</td>
        <td class="editable num" data-table="electronics" data-id="${e.id}" data-field="quantity" data-type="number">${e.quantity != null ? e.quantity : ''}</td>
        <td class="editable num" data-table="electronics" data-id="${e.id}" data-field="unit_price_usd" data-type="number">${formatNumber(e.unit_price_usd, 4)}</td>
        <td class="num">${formatNumber(e.total_usd, 4)}</td>
      </tr>
    `).join('');

    const elecSummaryRow = elecSummary ? `
      <tr style="background:#f0f4ff;font-weight:bold">
        <td></td>
        <td colspan="4">Electronic Summary (Final Price)</td>
        <td class="num">${formatNumber(elecSummary.final_price_usd, 2)} HK$</td>
      </tr>
    ` : '';

    const elecSection = `
      <div class="pur-section" data-cat="electronic" style="margin-top:16px;">
        <div class="toolbar">
          <span class="toolbar-title">1. 电子零件 Electronic Components</span>
          <span class="toolbar-spacer"></span>
          <span class="toolbar-stats">
            Sub Total: <b>${formatNumber(elecSubTotalHkd, 2)} HK$</b>
          </span>
        </div>
        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width:30px"></th>
                <th>零件名称 Part Name</th><th>规格 Spec</th><th>数量 Qty</th><th>单价 Unit Price (HK$)</th><th>合计 Total (HK$)</th>
              </tr>
            </thead>
            <tbody>
              ${elecRows || '<tr><td colspan="6" style="text-align:center;color:#aaa;padding:10px">暂无电子零件</td></tr>'}
              ${elecSummaryRow}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // ── 2. Sewing Accessories — fabric items from 车缝明细 with no position ──
    const sewingDetails = versionData.sewing_details || [];
    const sewingItems = sewingDetails.filter(s => !s.position && s.position !== '__labor__');
    // Convert total_price_rmb → HKD for sub total
    const rmb_hkd = parseFloat(params.rmb_hkd) || 0.85;
    const sewingSub = sewingItems.reduce((s, sw) => {
      const hkd = rmb_hkd > 0 ? (parseFloat(sw.total_price_rmb) || 0) / rmb_hkd : 0;
      return s + hkd;
    }, 0);

    const sewingRows = sewingItems.map(sw => {
      const hkd = rmb_hkd > 0 ? (parseFloat(sw.total_price_rmb) || 0) / rmb_hkd : 0;
      return `
        <tr>
          <td class="center"><input type="checkbox" class="row-check sew-check" data-id="${sw.id}"></td>
          <td>${escapeHtml(sw.fabric_name || '')}</td>
          <td class="editable" data-table="sewing-detail" data-id="${sw.id}" data-field="eng_name" data-type="text"
              style="color:#888;font-style:italic">${escapeHtml(sw.eng_name || '')}</td>
          <td class="editable num" data-table="sewing-detail" data-id="${sw.id}" data-field="usage_amount" data-type="number">${formatNumber(sw.usage_amount, 4)}</td>
          <td class="editable num" data-table="sewing-detail" data-id="${sw.id}" data-field="material_price_rmb" data-type="number">${formatNumber(sw.material_price_rmb, 4)}</td>
          <td class="num">${formatNumber(hkd, 2)}</td>
        </tr>
      `;
    }).join('');

    const sewingSection = `
      <div class="pur-section" data-cat="sewing" style="margin-top:16px;">
        <div class="toolbar">
          <span class="toolbar-title">2. 车缝布料 Sewing Accessories</span>
          <button class="btn btn-primary" id="sewAutoTranslate">自动翻译英文</button>
          <button class="btn btn-danger" id="sewDel">删除选中</button>
          <span class="toolbar-spacer"></span>
          <span class="toolbar-stats">Sub Total: <b>${formatNumber(sewingSub, 2)} HK$</b></span>
        </div>
        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width:30px"><input type="checkbox" id="sewAll"></th>
                <th>中文名称</th><th>English Name</th><th>用量 Usage</th><th>物料价 (RMB)</th><th>金额 (HK$)</th>
              </tr>
            </thead>
            <tbody>
              ${sewingRows || '<tr><td colspan="6" style="text-align:center;color:#aaa;padding:10px">暂无无部位布料</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // ── 3. Other Components — 身体外购件 from BodyAccessory ──────────────────
    const bodyAccs = versionData.body_accessories || [];
    const otherSub = bodyAccs.reduce((s, b) => s + (parseFloat(b.usage_qty) || 0) * (parseFloat(b.unit_price) || 0), 0);
    const otherRows = bodyAccs.map(b => {
      const amount = (parseFloat(b.usage_qty) || 0) * (parseFloat(b.unit_price) || 0);
      return `
        <tr>
          <td class="center"><input type="checkbox" class="row-check ba-check" data-id="${b.id}"></td>
          <td class="editable" data-table="body-accessory" data-id="${b.id}" data-field="category"    data-type="text">${escapeHtml(b.category || '五金')}</td>
          <td class="editable" data-table="body-accessory" data-id="${b.id}" data-field="part_no"    data-type="text">${escapeHtml(b.part_no || '')}</td>
          <td class="editable" data-table="body-accessory" data-id="${b.id}" data-field="description" data-type="text">${escapeHtml(b.description || '')}${b.eng_name ? `<br><span style="color:#888;font-size:11px">${escapeHtml(b.eng_name)}</span>` : ''}</td>
          <td class="editable num" data-table="body-accessory" data-id="${b.id}" data-field="moq"       data-type="number">${b.moq != null ? b.moq : ''}</td>
          <td class="editable num" data-table="body-accessory" data-id="${b.id}" data-field="usage_qty" data-type="number">${formatNumber(b.usage_qty, 4)}</td>
          <td class="editable num" data-table="body-accessory" data-id="${b.id}" data-field="unit_price" data-type="number">${formatNumber(b.unit_price, 4)}</td>
          <td class="num"><b>${formatNumber(amount, 4)}</b></td>
        </tr>
      `;
    }).join('');
    const otherSection = `
      <div class="pur-section" data-cat="other" style="margin-top:16px;">
        <div class="toolbar">
          <span class="toolbar-title">3. 外购件 Other Components</span>
          <button class="btn btn-primary" id="baAutoTranslate">自动翻译英文</button>
          <button class="btn btn-primary" id="baAdd">+ 添加</button>
          <button class="btn btn-danger"  id="baDel">删除选中</button>
          <span class="toolbar-spacer"></span>
          <span class="toolbar-stats">Sub Total: <b>${formatNumber(otherSub, 2)} HK$</b></span>
        </div>
        <div class="data-table-wrap">
          <table class="data-table">
            <thead><tr>
              <th style="width:30px"><input type="checkbox" id="baAll"></th>
              <th>分类</th><th>零件编号 Part No.</th><th>描述 Description</th><th>MOQ</th><th>用量 Usage/Toy</th><th>单价 Unit Price (HK$)</th><th>金额 Amount</th>
            </tr></thead>
            <tbody>
              ${otherRows || '<tr><td colspan="8" style="text-align:center;color:#aaa;padding:10px">暂无，点击 + 添加</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // ── Grand Total ───────────────────────────────────────────────────────────
    const grandTotal = elecSubTotalHkd + sewingSub + otherSub;
    const amount       = grandTotal * (1 + markup);

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
      ${elecSection}
      ${sewingSection}
      ${otherSection}
    `;
  },

  init(container, versionData, versionId) {
    const bodyAccs = versionData.body_accessories || [];

    // ── Body Accessory ──
    container.querySelector('#baAll')?.addEventListener('change', e => {
      container.querySelectorAll('.ba-check').forEach(c => c.checked = e.target.checked);
    });
    container.querySelector('#baAdd')?.addEventListener('click', async () => {
      try {
        await api.addSectionItem(versionId, 'body-accessory', { part_no: '', description: '', moq: 2500, usage_qty: 1, unit_price: 0 });
        app.refresh();
      } catch (e) { showToast('添加失败: ' + e.message, 'error'); }
    });
    container.querySelector('#baDel')?.addEventListener('click', async () => {
      const ids = [...container.querySelectorAll('.ba-check:checked')].map(c => c.dataset.id);
      if (!ids.length) return showToast('请先选择要删除的行', 'info');
      if (!confirm(`确定删除 ${ids.length} 行？`)) return;
      try {
        await Promise.all(ids.map(id => api.deleteSectionItem(versionId, 'body-accessory', id)));
        app.refresh();
      } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
    });

    // ── Sewing select all / delete ──
    container.querySelector('#sewAll')?.addEventListener('change', e => {
      container.querySelectorAll('.sew-check').forEach(cb => cb.checked = e.target.checked);
    });

    container.querySelector('#sewDel')?.addEventListener('click', async () => {
      const ids = [...container.querySelectorAll('.sew-check:checked')].map(c => c.dataset.id);
      if (!ids.length) return showToast('请先选择要删除的行', 'info');
      if (!confirm(`确定删除 ${ids.length} 行？`)) return;
      try {
        await Promise.all(ids.map(id => api.deleteSectionItem(versionId, 'sewing-detail', id)));
        app.refresh();
      } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
    });

    // ── Sewing auto-translate ──
    container.querySelector('#sewAutoTranslate')?.addEventListener('click', async () => {
      try {
        showToast('正在翻译...', 'info');
        const r = await fetch(`${api.BASE}/api/versions/${versionId}/translate-sewing`, { method: 'POST' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        showToast(`已翻译 ${d.translated} 条`, 'success');
        app.refresh();
      } catch (e) { showToast('翻译失败: ' + e.message, 'error'); }
    });

    // ── Sewing Detail english name ──
    const sewingDetails = versionData.sewing_details || [];
    container.querySelectorAll('td.editable[data-table="sewing-detail"]').forEach(td => {
      const id    = td.dataset.id;
      const field = td.dataset.field;
      const item  = sewingDetails.find(s => String(s.id) === id) || {};
      makeEditable(td, {
        type: 'text',
        value: item[field],
        onSave: async (val) => {
          try {
            await api.updateSectionItem(versionId, 'sewing-detail', id, { [field]: val });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });

    // ── Electronic Items editable fields ──
    const elecItemsData = versionData.electronic_items || [];
    container.querySelectorAll('td.editable[data-table="electronics"]').forEach(td => {
      const id    = td.dataset.id;
      const field = td.dataset.field;
      const type  = td.dataset.type;
      const item  = elecItemsData.find(e => String(e.id) === id) || {};
      makeEditable(td, {
        type,
        value: item[field],
        onSave: async (val) => {
          try {
            await api.updateSectionItem(versionId, 'electronics', id, { [field]: val });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });

    // ── Sewing Detail editable fields (usage_amount, material_price_rmb) ──
    const sewingItemsData = (versionData.sewing_details || []).filter(s => !s.position);
    container.querySelectorAll('td.editable[data-table="sewing-detail"]:not([data-field="eng_name"])').forEach(td => {
      const id    = td.dataset.id;
      const field = td.dataset.field;
      const item  = sewingItemsData.find(s => String(s.id) === id) || {};
      makeEditable(td, {
        type: 'number',
        value: item[field],
        onSave: async (val) => {
          try {
            await api.updateSectionItem(versionId, 'sewing-detail', id, { [field]: val });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });

    container.querySelectorAll('td.editable[data-table="body-accessory"]').forEach(td => {
      const id    = td.dataset.id;
      const field = td.dataset.field;
      const type  = td.dataset.type;
      const item  = bodyAccs.find(b => String(b.id) === id) || {};
      makeEditable(td, {
        type,
        value: item[field],
        onSave: async (val) => {
          try {
            await api.updateSectionItem(versionId, 'body-accessory', id, { [field]: val });
            app.refresh();
          } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
        },
      });
    });
  },
};
