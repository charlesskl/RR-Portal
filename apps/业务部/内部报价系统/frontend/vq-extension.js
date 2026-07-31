// TOMY / SPIN 报客表 UI 扩展。
// 独立于大型 workbench.js，避免每次小改都产生超过 CI 许可大小的新 blob。
(function () {
  'use strict';

  const LCL_DEFAULTS = [
    { label: '盐田散货 3吨', capacity_cuft: 450, unit_hkd: 16.8 },
    { label: '盐田散货 5吨', capacity_cuft: 850, unit_hkd: 11.24 },
    { label: '盐田散货 8吨', capacity_cuft: 1000, unit_hkd: 9.67 },
  ];

  const toNumber = value => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const escapeText = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));

  // 旧汇总渲染器把 pricing_summary.surtax 当 RMB 保存并换算为 HKD。
  // 当前业务口径是直接输入 HKD；通过轻量适配层保持旧渲染器不变，
  // 同时确保任何由汇总面板触发的保存都还原为 HKD 后再写入数据库。
  const SURTAX_ADAPTER = '__surtax_hkd_adapter';
  const salesSections = new Map();

  function parsePayload(section) {
    try {
      return JSON.parse(section?.payload_json || '{}');
    } catch {
      return {};
    }
  }

  function normalizeSurtaxPayload(payload) {
    const normalized = JSON.parse(JSON.stringify(payload || {}));
    if (!normalized[SURTAX_ADAPTER]) return normalized;
    const fx = toNumber(normalized.header?.fx_rmb_hkd) || 0.85;
    normalized.pricing_summary = normalized.pricing_summary || {};
    normalized.pricing_summary.surtax = toNumber(normalized.pricing_summary.surtax) / fx;
    delete normalized[SURTAX_ADAPTER];
    return normalized;
  }

  const basePutSection = window.putSection;
  if (typeof basePutSection === 'function') {
    window.putSection = function (section, payload, submit) {
      if (!payload?.[SURTAX_ADAPTER]) return basePutSection(section, payload, submit);
      const normalized = normalizeSurtaxPayload(payload);
      const target = salesSections.get(section.id) || section;
      target.payload_json = JSON.stringify(normalized);
      return basePutSection(target, normalized, submit);
    };
  }

  const baseRenderSummaryPane = window.renderSummaryPane;
  if (typeof baseRenderSummaryPane === 'function') {
    window.renderSummaryPane = function (host, sections, quote, me) {
      const sourceSections = (sections || []).map(section => {
        if (section.dept !== 'sales') return section;
        const normalized = normalizeSurtaxPayload(parsePayload(section));
        const original = salesSections.get(section.id) || section;
        original.payload_json = JSON.stringify(normalized);
        salesSections.set(section.id, original);
        return original;
      });
      const adaptedSections = sourceSections.map(section => {
        if (section.dept !== 'sales') return section;
        const payload = parsePayload(section);
        const fx = toNumber(payload.header?.fx_rmb_hkd) || 0.85;
        payload.pricing_summary = payload.pricing_summary || {};
        payload.pricing_summary.surtax = toNumber(payload.pricing_summary.surtax) * fx;
        payload[SURTAX_ADAPTER] = true;
        return { ...section, payload_json: JSON.stringify(payload) };
      });

      const result = baseRenderSummaryPane(host, adaptedSections, quote, me);
      const salesSection = sourceSections.find(section => section.dept === 'sales');
      const directPayload = parsePayload(salesSection);
      const directHkd = directPayload.pricing_summary?.surtax;
      const input = host.querySelector('#tot-surtax');
      if (!input) return result;

      input.value = directHkd == null ? '' : directHkd;
      const cellIndex = input.closest('td')?.cellIndex;
      const header = Number.isInteger(cellIndex)
        ? input.closest('table')?.querySelectorAll('th')[cellIndex]
        : null;
      if (header) header.textContent = '附加税 HK$';

      const canEdit = me?.dept === 'sales' || me?.dept === 'engineering';
      if (!canEdit || !salesSection) {
        input.disabled = true;
        return result;
      }
      input.disabled = false;
      input.oninput = () => {
        directPayload.pricing_summary = directPayload.pricing_summary || {};
        directPayload.pricing_summary.surtax = input.value === '' ? null : Number(input.value);
      };
      input.onchange = () => {
        salesSection.payload_json = JSON.stringify(directPayload);
        window.putSection(salesSection, directPayload, false)
          .then(() => window.renderSummaryPane(host, sourceSections, quote, me))
          .catch(() => {});
      };
      return result;
    };
  }

  function cartonPriceBase(carton) {
    return (toNumber(carton.cl) + toNumber(carton.cw) + 2)
      * (toNumber(carton.cw) + toNumber(carton.ch) + 1) * 2 / 1000;
  }

  function addEditableCartonPrices(host, config, canEdit, onChange) {
    (config.cartons || []).forEach((carton, index) => {
      const nameInput = host.querySelector(
        `input[data-bi="${index}"][data-k="name"]:not([data-fj])`
      );
      const metrics = nameInput?.parentElement?.nextElementSibling;
      if (!metrics || metrics.querySelector(`[data-carton-price="${index}"]`)) return;
      const priceHost = Array.from(metrics.children).find(element =>
        element.tagName === 'SPAN' && /^箱价/.test(element.textContent.trim())
      );
      if (!priceHost) return;

      const base = cartonPriceBase(carton);
      const rate = config.paper_rate == null || config.paper_rate === ''
        ? 2.75
        : toNumber(config.paper_rate);
      const price = base * rate;
      priceHost.innerHTML = `<b>箱价</b> HK$
        <input data-carton-price="${index}" type="number" step="0.01"
          value="${price.toFixed(2)}" ${canEdit ? '' : 'disabled'}
          title="可直接修改箱价；系统会自动反算并保存纸价系数"
          style="width:82px;color:#7c2d12;font-weight:700;text-align:right"/>`;
      if (!canEdit) return;

      const input = priceHost.querySelector('input');
      input.onchange = () => {
        const desiredPrice = toNumber(input.value);
        const currentBase = cartonPriceBase(carton);
        if (desiredPrice < 0 || currentBase <= 0) return;
        config.paper_rate = desiredPrice / currentBase;
        // 兼容旧导出字段；主数据口径仍以反算后的 paper_rate 为准。
        if (index === 0) config.box_price = desiredPrice;
        const rateInput = host.querySelector('#cc-rate');
        if (rateInput) rateInput.value = Number(config.paper_rate.toFixed(6));
        onChange();
        if (typeof rateInput?.onchange === 'function') rateInput.onchange();
      };
    });
  }

  const baseRenderCartonCalc = window.renderCartonCalc;
  if (typeof baseRenderCartonCalc === 'function') {
    window.renderCartonCalc = function (host, config, canEdit, onChange) {
      baseRenderCartonCalc(host, config, canEdit, onChange);
      const decorate = () => addEditableCartonPrices(host, config, canEdit, onChange);
      decorate();
      const observer = new MutationObserver(decorate);
      observer.observe(host, { childList: true, subtree: true });
    };
  }

  function renderSpinTransport(host, config, freight, cartonConfig, canEdit, onChange) {
    if (!host) return () => {};
    config.fx_hkd_usd = toNumber(config.fx_hkd_usd) || 7.75;
    config.lcl_divisor = toNumber(config.lcl_divisor) || 0.98;
    config.china_lcl = Array.isArray(config.china_lcl) ? config.china_lcl : [];
    LCL_DEFAULTS.forEach((defaults, index) => {
      config.china_lcl[index] = { ...defaults, ...(config.china_lcl[index] || {}) };
    });

    const disabled = canEdit ? '' : 'disabled';
    const lclRows = config.china_lcl.map((row, index) => `
      <tr>
        <td>${escapeText(row.label || LCL_DEFAULTS[index].label)}</td>
        <td><input data-spin-lcl="${index}" data-key="capacity_cuft" type="number" step="any" value="${toNumber(row.capacity_cuft)}" ${disabled}/></td>
        <td><input data-spin-lcl="${index}" data-key="unit_hkd" type="number" step="any" value="${toNumber(row.unit_hkd)}" ${disabled}/></td>
        <td id="spin-lcl-qty-${index}">0</td>
        <td id="spin-lcl-rate-${index}">0.0000</td>
      </tr>`).join('');

    host.innerHTML = `
      <div class="card" style="margin-top:16px;border:1px solid #f59e0b;background:#fffbeb">
        <h3 style="margin-top:0;color:#92400e">SPIN 报客表运费设定</h3>
        <div class="wb-grid2">
          <label>SPIN HKD→USD 汇率
            <input id="spin-fx" type="number" step="any" value="${config.fx_hkd_usd}" ${disabled}/>
          </label>
          <label>盐田散货找数
            <input id="spin-divisor" type="number" step="any" value="${config.lcl_divisor}" ${disabled}/>
          </label>
        </div>
        <p class="muted" style="font-size:13px">
          柜货：运费 HKD ÷ 汇率 ÷ 实际报客数量；散货：单价 HKD × 每箱 CUFT ÷ 每箱 PCS ÷ 找数 ÷ 汇率。
          导出 SPIN VQ 时会把相同计算写成 Excel 公式。
        </p>
        <table class="wb-table" style="font-size:13px;text-align:center">
          <thead><tr><th>柜货</th><th>柜容量 CUFT</th><th>运费 HKD</th><th>实际报客数量</th><th>产品运费 USD/PCS</th></tr></thead>
          <tbody>
            <tr><td>盐田 40HQ</td><td id="spin-yt40-cap">0</td><td id="spin-yt40-fee">0</td><td id="spin-yt40-qty">0</td><td id="spin-yt40-rate">0.0000</td></tr>
            <tr><td>盐田 20HQ</td><td id="spin-yt20-cap">0</td><td id="spin-yt20-fee">0</td><td id="spin-yt20-qty">0</td><td id="spin-yt20-rate">0.0000</td></tr>
            <tr><td>HK 40HQ</td><td id="spin-hk40-cap">0</td><td id="spin-hk40-fee">0</td><td id="spin-hk40-qty">0</td><td id="spin-hk40-rate">0.0000</td></tr>
            <tr><td>HK 20HQ</td><td id="spin-hk20-cap">0</td><td id="spin-hk20-fee">0</td><td id="spin-hk20-qty">0</td><td id="spin-hk20-rate">0.0000</td></tr>
          </tbody>
        </table>
        <table class="wb-table" style="margin-top:12px;font-size:13px;text-align:center">
          <thead><tr><th>盐田散货</th><th>可装容量 CUFT</th><th>单价 HKD</th><th>实际报客数量</th><th>产品运费 USD/PCS</th></tr></thead>
          <tbody>${lclRows}</tbody>
        </table>
        <p id="spin-carton-warning" class="muted" style="font-size:13px;margin-bottom:0"></p>
      </div>`;

    const paint = () => {
      const carton = Array.isArray(cartonConfig.cartons) && cartonConfig.cartons.length
        ? cartonConfig.cartons[0]
        : cartonConfig;
      const cuft = toNumber(carton.cuft)
        || toNumber(carton.cl) * toNumber(carton.cw) * toNumber(carton.ch) / 1728;
      const pcs = toNumber(carton.qty);
      const fx = toNumber(config.fx_hkd_usd);
      const divisor = toNumber(config.lcl_divisor);
      const quantity = capacity => cuft > 0 && pcs > 0
        ? Math.floor(toNumber(capacity) / cuft) * pcs
        : 0;
      const set = (id, value) => {
        const element = host.querySelector('#' + id);
        if (element) element.textContent = value;
      };
      [
        ['yt40', freight.cap_40, freight.yt40],
        ['yt20', freight.cap_20, freight.yt20],
        ['hk40', freight.cap_40, freight.hk40],
        ['hk20', freight.cap_20, freight.hk20],
      ].forEach(([key, capacity, fee]) => {
        const actual = quantity(capacity);
        const rate = fx > 0 && actual > 0 ? toNumber(fee) / fx / actual : 0;
        set(`spin-${key}-cap`, toNumber(capacity));
        set(`spin-${key}-fee`, toNumber(fee));
        set(`spin-${key}-qty`, actual);
        set(`spin-${key}-rate`, rate.toFixed(4));
      });
      config.china_lcl.forEach((item, index) => {
        const actual = quantity(item.capacity_cuft);
        const rate = cuft > 0 && pcs > 0 && fx > 0 && divisor > 0
          ? toNumber(item.unit_hkd) * cuft / pcs / divisor / fx
          : 0;
        set(`spin-lcl-qty-${index}`, actual);
        set(`spin-lcl-rate-${index}`, rate.toFixed(4));
      });
      const warning = host.querySelector('#spin-carton-warning');
      if (warning) {
        warning.textContent = cuft > 0 && pcs > 0
          ? `当前取值：每箱 ${cuft.toFixed(4)} CUFT，${pcs} PCS。`
          : '请先在工程部填写纸箱 CUFT 与每箱装箱数，SPIN 运费才能计算。';
      }
    };

    if (canEdit) {
      host.querySelector('#spin-fx').oninput = event => {
        config.fx_hkd_usd = toNumber(event.target.value);
        onChange();
        paint();
      };
      host.querySelector('#spin-divisor').oninput = event => {
        config.lcl_divisor = toNumber(event.target.value);
        onChange();
        paint();
      };
      host.querySelectorAll('[data-spin-lcl]').forEach(input => {
        input.oninput = event => {
          const index = Number(event.target.dataset.spinLcl);
          config.china_lcl[index][event.target.dataset.key] = toNumber(event.target.value);
          onChange();
          paint();
        };
      });
    }
    paint();
    return paint;
  }

  const baseRenderSales = window.renderSales;
  if (typeof baseRenderSales === 'function') {
    window.renderSales = function (host, payload, quote, canEditHeader, canEditPricing, allSections, onChange, onHeaderChange) {
      payload.pricing = payload.pricing || {};
      if (payload.pricing.vq_markup_pct == null) payload.pricing.vq_markup_pct = 18;
      baseRenderSales(host, payload, quote, canEditHeader, canEditPricing, allSections, onChange, onHeaderChange);

      const fxInput = host.querySelector('#h-fxhu');
      if (fxInput && !host.querySelector('#p-vqmk')) {
        const label = document.createElement('label');
        label.innerHTML = `报客加价 %
          <input id="p-vqmk" type="number" step="any" value="${payload.pricing.vq_markup_pct}"
                 title="生成报客表(VQ)时统一套到成本行的加价率" ${canEditPricing ? '' : 'disabled'} />`;
        fxInput.closest('.wb-grid2')?.appendChild(label);
        const input = label.querySelector('input');
        if (canEditPricing) input.oninput = () => {
          payload.pricing.vq_markup_pct = toNumber(input.value);
          onChange();
        };
      }

      if (String(quote.customer || '').trim().toUpperCase() !== 'SPIN') return;
      const freightHost = host.querySelector('#wb-freight');
      if (!freightHost) return;
      payload.freight_calc = payload.freight_calc || {
        cap_10t: 1166, cap_5t: 750, cap_40: 1980, cap_20: 883,
        hk40: 8000, hk20: 7100, yt40: 7200, yt20: 6000,
        hk10t: 14900, yt10t: 11500, hk5t: 12500, yt5t: 11000,
      };
      payload.spin_transport = payload.spin_transport || {
        fx_hkd_usd: 7.75,
        lcl_divisor: 0.98,
        china_lcl: LCL_DEFAULTS.map(item => ({ ...item })),
      };
      const engineering = (allSections || []).find(section => section.dept === 'engineering');
      let engineeringPayload = {};
      try { engineeringPayload = JSON.parse(engineering?.payload_json || '{}'); } catch {}
      const cartonConfig = engineeringPayload.carton_calc || {};
      const spinHost = document.createElement('div');
      spinHost.id = 'wb-spin-transport';
      freightHost.parentNode.insertBefore(spinHost, freightHost);
      const repaint = renderSpinTransport(
        spinHost,
        payload.spin_transport,
        payload.freight_calc,
        cartonConfig,
        canEditPricing,
        onChange
      );
      freightHost.addEventListener('input', repaint);
    };
  }

  function enhanceExportButton() {
    const data = window.__data;
    const exportButton = document.getElementById('btn-export');
    if (!data || !exportButton || document.getElementById('btn-export-vq')) return;
    const customer = String(data.quote?.customer || '').trim().toUpperCase();
    if (customer !== 'SPIN' && customer !== 'TOMY') return;
    const approved = (data.sections || []).filter(section => section.status === 'approved').length;
    const total = (data.sections || []).length;
    const button = document.createElement('button');
    button.id = 'btn-export-vq';
    button.style.marginLeft = '10px';
    button.disabled = approved < total;
    button.title = approved < total
      ? '需全部部门审核通过后可生成'
      : `按 ${customer} VQ 模板生成客户报价单`;
    button.textContent = `生成 ${customer} 报客表 (VQ)`;
    button.onclick = async () => {
      try {
        const id = new URLSearchParams(location.search).get('id');
        const response = await fetch('/api/quotes/' + id + '/export-vq', { credentials: 'include' });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || response.statusText);
        }
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = url;
        link.download = `VQ_${data.quote.quote_no || id}_${new Date().toISOString().slice(0, 10)}.xlsx`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      } catch (error) {
        alert(error.message);
      }
    };
    exportButton.insertAdjacentElement('afterend', button);

    const translateButton = document.createElement('button');
    translateButton.id = 'btn-translate-vq';
    translateButton.style.marginLeft = '10px';
    translateButton.textContent = '自动翻译英文';
    translateButton.title = '翻译报客表中的产品、布料、物料、包装及零件名称，并保存英文结果';
    translateButton.onclick = async () => {
      const id = new URLSearchParams(location.search).get('id');
      const originalText = translateButton.textContent;
      translateButton.disabled = true;
      translateButton.textContent = '正在翻译…';
      try {
        const response = await fetch('/api/quotes/' + id + '/translate-vq', {
          method: 'POST',
          credentials: 'include',
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || response.statusText);
        const incomplete = body.untranslated
          ? `\n另有 ${body.untranslated} 项未翻译：${body.warning || '翻译服务暂不可用'}`
          : '';
        alert(`英文翻译完成，共更新 ${body.translated} 项。${incomplete}\n请生成新的 ${customer} 报客表。`);
      } catch (error) {
        alert(error.message);
      } finally {
        translateButton.disabled = false;
        translateButton.textContent = originalText;
      }
    };
    button.insertAdjacentElement('beforebegin', translateButton);
  }

  try {
    if (typeof ACTION_LABEL === 'object') {
      ACTION_LABEL.export_vq = '📤 生成报客表';
      ACTION_LABEL.translate_vq = '🌐 翻译报客表英文';
    }
  } catch {}

  const sections = document.getElementById('sections');
  if (sections) {
    new MutationObserver(enhanceExportButton).observe(sections, { childList: true, subtree: true });
    enhanceExportButton();
  }
})();
