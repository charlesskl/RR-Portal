/* Params panel — render and edit QuoteParams */

const paramsModule = (() => {
  let _versionId = null;
  let _params = null;

  const FIELDS = [
    { key: 'hkd_rmb_quote', label: '港币兑人民币（报价）', decimals: 4 },
    { key: 'hkd_rmb_check', label: '港币兑人民币（核价）', decimals: 4 },
    { key: 'rmb_hkd',       label: '人民币兑港币', decimals: 4 },
    { key: 'hkd_usd',       label: '港币兑美金', decimals: 4 },
    { key: 'labor_hkd',     label: '人工 HKD', decimals: 2 },
    { key: 'box_price_hkd', label: '箱价 HKD', decimals: 2 },
    { key: 'markup_body',   label: 'Body 加价率', decimals: 4 },
    { key: 'markup_packaging', label: '包装 加价率', decimals: 4 },
    { key: 'tax_point',     label: '税点', decimals: 4 },
    { key: 'markup_point',  label: '码点', decimals: 5 },
    { key: 'payment_divisor', label: '找数', decimals: 4 },
    { key: 'surcharge_pct', label: '附加税%', decimals: 4 },
  ];

  const saveDebounced = debounce(async () => {
    if (!_versionId || !_params) return;
    try {
      await api.updateParams(_versionId, _params);
    } catch (e) {
      showToast('参数保存失败: ' + e.message, 'error');
    }
  }, 800);

  function render(versionId, params) {
    _versionId = versionId;
    _params = { ...params };

    const body = document.getElementById('paramsBody');
    body.innerHTML = FIELDS.map(f => `
      <div class="param-group">
        <label class="param-label">${escapeHtml(f.label)}</label>
        <input class="param-input" type="number" step="any"
          data-key="${f.key}"
          value="${_params[f.key] !== null && _params[f.key] !== undefined ? _params[f.key] : ''}">
      </div>
    `).join('');

    body.querySelectorAll('.param-input').forEach(input => {
      input.addEventListener('change', () => {
        const key = input.dataset.key;
        _params[key] = input.value === '' ? null : parseFloat(input.value);
        saveDebounced();
      });
    });

    document.getElementById('paramsPanel').style.display = '';
  }

  function hide() {
    document.getElementById('paramsPanel').style.display = 'none';
    _versionId = null;
    _params = null;
  }

  // Toggle open/close
  document.getElementById('paramsToggle').addEventListener('click', () => {
    const body = document.getElementById('paramsBody');
    const arrow = document.querySelector('.params-arrow');
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : '';
    arrow.classList.toggle('open', !isOpen);
  });

  return { render, hide };
})();
