/* Header Info panel — editable VQ / BD header fields */

const headerInfoModule = (() => {
  let _versionId = null;
  let _productId = null;
  let _versionData = {};
  let _productData = {};

  // Fields stored on Product
  const PRODUCT_KEYS = new Set(['vendor', 'item_no', 'item_desc']);

  const VQ_FIELDS = [
    { key: 'item_no',            label: 'Item No.' },
    { key: 'item_desc',          label: 'Item Desc.' },
    { key: 'item_rev',           label: 'Item Rev.' },
    { key: 'prepared_by',        label: 'Prepared By' },
    { key: 'quote_date',         label: 'Quote Date' },
    { key: 'quote_rev',          label: 'Quote Rev.' },
    { key: 'fty_delivery_date',  label: 'Fty Delivery Date' },
  ];

  const BD_FIELDS = [
    { key: 'body_no',             label: 'Body No.' },
    { key: 'item_desc',           label: 'Body Descriptions' },
    { key: 'body_cost_revision',  label: 'Body Cost Revision' },
    { key: 'bd_prepared_by',      label: 'Prepared By' },
    { key: 'bd_date',             label: 'Date' },
  ];

  const saveDebounced = debounce(async () => {
    if (!_versionId) return;
    try {
      const vFields = {};
      const pFields = {};
      Object.entries({ ..._versionData, ..._productData }).forEach(([k, v]) => {
        if (PRODUCT_KEYS.has(k)) pFields[k] = v;
        else vFields[k] = v;
      });
      const tasks = [];
      if (Object.keys(vFields).length) tasks.push(api.updateVersion(_versionId, vFields));
      if (Object.keys(pFields).length) tasks.push(api.updateProduct(_productId, pFields));
      await Promise.all(tasks);
      if (Object.keys(pFields).length) await app.loadProducts();
    } catch (e) {
      showToast('表头信息保存失败: ' + e.message, 'error');
    }
  }, 800);

  function render(versionId, versionData, level) {
    _versionId = versionId;
    _productId = versionData.product?.id || versionData.product_id;
    _versionData = {};
    _productData = {};

    const fields = level === 'bd' ? BD_FIELDS : VQ_FIELDS;
    const panel = document.getElementById('headerInfoPanel');
    const body = document.getElementById('headerInfoBody');

    // Collect current values from appropriate source
    const values = {};
    fields.forEach(f => {
      if (PRODUCT_KEYS.has(f.key)) {
        values[f.key] = versionData.product?.[f.key] ?? null;
      } else {
        values[f.key] = versionData[f.key] ?? null;
      }
    });

    body.innerHTML = fields.map(f => `
      <div class="header-info-group">
        <label class="header-info-label">${escapeHtml(f.label)}</label>
        <input class="header-info-input" type="text"
          data-key="${f.key}"
          value="${values[f.key] !== null && values[f.key] !== undefined ? escapeHtml(String(values[f.key])) : ''}">
      </div>
    `).join('');

    body.querySelectorAll('.header-info-input').forEach(input => {
      input.addEventListener('change', () => {
        const key = input.dataset.key;
        const val = input.value.trim() || null;
        if (PRODUCT_KEYS.has(key)) _productData[key] = val;
        else _versionData[key] = val;
        saveDebounced();
      });
    });

    panel.style.display = '';
  }

  function hide() {
    document.getElementById('headerInfoPanel').style.display = 'none';
    _versionId = null;
    _productId = null;
    _versionData = {};
    _productData = {};
  }

  return { render, hide };
})();
