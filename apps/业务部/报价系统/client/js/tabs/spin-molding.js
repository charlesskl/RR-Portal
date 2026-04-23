/* Tab: spin-molding — SPIN In-Housed Molding (模内件) */
const tab_spin_molding = {
  render(versionData) {
    const items = (versionData.mold_parts || []);
    // 优先用存储的 usd_per_toy，没有则用料价×重量公式兜底
    const total = items.reduce((s, m) => {
      const v = parseFloat(m.usd_per_toy) ||
                (parseFloat(m.resin_price_usd_kg) * parseFloat(m.weight_g) / 1000) || 0;
      return s + v;
    }, 0);

    function renderRows() {
      if (!items.length) return '<tr><td colspan="12" style="text-align:center;color:#aaa;padding:12px">暂无数据，重新导入 Excel 后显示</td></tr>';
      return items.map(m => {
        // US$ per toy = Resin(USD/kg) × Weight(g) ÷ 1000
        const resin = parseFloat(m.resin_price_usd_kg) || 0;
        const wt    = parseFloat(m.weight_g) || 0;
        const usdPerToy = resin && wt ? resin * wt / 1000 : null;
        const sets  = parseFloat(m.sets_per_toy) || 1;
        return `
        <tr data-machine="${escapeHtml(m.machine_type || '')}"
            data-cycle="${m.cycle_time_sec != null ? m.cycle_time_sec : ''}"
            data-sets="${sets}"
            data-material="${escapeHtml(m.material || '')}"
            data-weight="${wt}"
            data-resin="${resin}">
          <td>${escapeHtml(m.description || '')}</td>
          <td>${escapeHtml(m.mold_no || '')}</td>
          <td>${escapeHtml(m.part_no || '')}</td>
          <td class="num">${(m.cavity_count != null || m.sets_per_toy != null) ? [m.cavity_count, m.sets_per_toy].filter(v => v != null).join('/') : '—'}</td>
          <td>${escapeHtml(m.material || '')}</td>
          <td class="num" data-resin-cell>${resin ? formatNumber(resin, 4) : '—'}</td>
          <td class="num">${formatNumber(wt, 1)}</td>
          <td class="num" data-usd-toy>${usdPerToy != null ? usdPerToy.toFixed(4) : '—'}</td>
          <td class="num" data-mold-cost>—</td>
          <td class="num">${m.cycle_time_sec != null ? m.cycle_time_sec : '—'}</td>
          <td data-mach-tonnage>${escapeHtml(m.machine_type || '')}</td>
          <td class="num" data-mach-rate>—</td>
        </tr>`;
      }).join('');
    }

    return `
      <div class="spin-section">
        <div class="spin-section-header">
          <div class="spin-section-accent" style="background:#8e44ad"></div>
          <span class="spin-section-title">In-Housed Molding <span class="spin-section-subtitle">模内件</span></span>
          <span class="spin-section-total" id="spinMoldSubTotal">Sub Total: ${formatNumber(total, 4)} USD</span>
        </div>
        <div class="spin-section-body">
          <div class="data-table-wrap">
            <table class="data-table">
              <thead><tr>
                <th>Parts</th><th>Mold No.</th><th>Part No.</th><th>件/套</th>
                <th>Material</th><th>美金/kg</th><th>Wt. per toy (g)</th>
                <th>US$ per toy</th><th>Molding Cost (US$/pc)</th>
                <th>Cycle time (sec)</th><th>Machine size (Ton)</th><th>Molding Labour Rate (US$/hr)</th>
              </tr></thead>
              <tbody>${renderRows()}</tbody>
            </table>
          </div>
        </div>
      </div>

      <div id="spinMoldRefSection" style="margin-top:16px">
        <div style="color:#6a8aaa;font-size:12px;padding:8px 0">加载参考价格表…</div>
      </div>
    `;
  },

  init(container, versionData, versionId) {
    const refSection = container.querySelector('#spinMoldRefSection');
    if (!refSection) return;

    const HKD_USD = 7.75, LB_G = 454;

    function calcFromLb(hkdLb) {
      const lb = parseFloat(hkdLb) || 0;
      return {
        rmb_g:    lb ? (lb / LB_G).toFixed(4) : '0.0000',
        spin_usd: lb ? (lb / LB_G * 1000 / HKD_USD).toFixed(4) : '0.0000',
      };
    }

    function saveField(id, field, value) {
      fetch(`/api/reference/materials/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: parseFloat(value) || 0 }),
      }).catch(() => {});
    }

    const LABEL_STD = localStorage.getItem('refLabel_std') || '2026年报价';
    const LABEL_CLI = localStorage.getItem('refLabel_cli') || '2022年报价';

    function buildMatTable(mats) {
      const rows = mats.map(m => {
        const cStd = calcFromLb(m.price_hkd_lb);
        const cCli = calcFromLb(m.client_hkd_lb);
        const diff = ((parseFloat(m.client_spin_usd_kg) || 0) - (parseFloat(m.spin_usd_kg) || 0)).toFixed(4);
        return `
          <tr data-id="${m.id}">
            <td>${escapeHtml(m.material_name)}</td>
            <td>${escapeHtml(m.grade || '')}</td>
            <td class="num ref-edit" style="background:rgba(231,76,60,0.12);border:1px solid rgba(231,76,60,0.4)">
              <input class="ref-input" data-field="price_hkd_lb" value="${m.price_hkd_lb || ''}" placeholder="0.0000" style="width:70px">
            </td>
            <td class="num ref-calc" data-std-rmb>${cStd.rmb_g}</td>
            <td class="num ref-calc spin-std" data-std-spin>${cStd.spin_usd}</td>
            <td class="num ref-edit" style="background:rgba(243,156,18,0.12);border:1px solid rgba(243,156,18,0.4)">
              <input class="ref-input" data-field="client_hkd_lb" value="${m.client_hkd_lb || ''}" placeholder="0.0000" style="width:70px">
            </td>
            <td class="num ref-calc" data-cli-rmb>${cCli.rmb_g}</td>
            <td class="num ref-calc spin-cli" style="color:#f0c040;font-weight:600" data-cli-spin>${cCli.spin_usd}</td>
            <td class="num" style="color:#3498db;font-weight:600" data-diff>${diff === '0.0000' ? '—' : diff}</td>
          </tr>`;
      }).join('');

      return `
        <div class="spin-section" style="margin-top:0">
          <div class="spin-section-header">
            <div class="spin-section-accent" style="background:#2980b9"></div>
            <span class="spin-section-title">料价参考表 <span class="spin-section-subtitle">Resin Reference</span></span>
            <span style="font-size:11px;color:#6a8aaa;margin-left:12px">汇率 HKD/USD: ${HKD_USD} | 换算: HK$/Lb ÷ ${LB_G}g ÷ ${HKD_USD} × 1000 = US$/kg</span>
          </div>
          <div class="spin-section-body">
            <div class="data-table-wrap">
              <table class="data-table" id="refMatTable">
                <thead>
                  <tr>
                    <th rowspan="2">料名</th>
                    <th rowspan="2">型号</th>
                    <th colspan="3" style="background:rgba(52,152,219,0.15);border-bottom:1px solid #2980b9">公司标准 <span class="ref-label-edit" data-key="refLabel_std" title="点击编辑标签" style="cursor:pointer;border-bottom:1px dashed #6a8aaa">${LABEL_STD}</span></th>
                    <th colspan="3" style="background:rgba(243,156,18,0.15);border-bottom:1px solid #f39c12">报客 <span class="ref-label-edit" data-key="refLabel_cli" title="点击编辑标签" style="cursor:pointer;border-bottom:1px dashed #6a8aaa">${LABEL_CLI}</span></th>
                    <th rowspan="2" style="color:#3498db">相差<br>Spin US$</th>
                  </tr>
                  <tr>
                    <th style="background:rgba(52,152,219,0.1);color:#e74c3c"><span class="ref-label-edit" data-key="refLabel_std" style="cursor:pointer">${LABEL_STD}</span><br>料价(HK$/Lb) ✎</th>
                    <th style="background:rgba(52,152,219,0.1)">料价(HK$/g)</th>
                    <th style="background:rgba(52,152,219,0.1)">按公斤计报<br>Spin MasterUS$</th>
                    <th style="background:rgba(243,156,18,0.1);color:#e67e22"><span class="ref-label-edit" data-key="refLabel_cli" style="cursor:pointer">${LABEL_CLI}</span><br>料价(HK$/Lb) ✎</th>
                    <th style="background:rgba(243,156,18,0.1)">料价(HK$/g)</th>
                    <th style="background:rgba(243,156,18,0.1);color:#f0c040">按公斤计报<br>Spin MasterUS$</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>
        </div>`;
    }

    // 模具人工费率(美元/小时) = 价格(24H) / 22 / (7.75 * 0.97)
    function calcMachRate(hkd) {
      const v = parseFloat(hkd) || 0;
      return v ? (v / 22 / (HKD_USD * 0.97)).toFixed(4) : '0.0000';
    }

    function saveMach(id, rate_hkd, target_qty) {
      const rate_rmb_24h = parseFloat(calcMachRate(rate_hkd));
      const hkd = parseFloat(rate_hkd) || 0;
      const tgt = parseInt(target_qty) || 0;
      const rate_usd = tgt ? parseFloat((hkd / tgt / HKD_USD).toFixed(4)) : 0;
      fetch(`/api/reference/machines/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate_hkd: hkd, rate_rmb_24h, rate_usd, target_qty: tgt }),
      }).catch(() => {});
    }

    function buildMachTable(machs) {
      const rows = machs.map(m => {
        const hkdPc = m.target_qty ? (m.rate_hkd / m.target_qty).toFixed(4) : '—';
        const usdPc = m.target_qty ? (m.rate_hkd / m.target_qty / HKD_USD).toFixed(2) : '—';
        return `
        <tr data-mach-id="${m.id}">
          <td>${escapeHtml(m.machine_type)}</td>
          <td>${escapeHtml(m.tonnage || '')}</td>
          <td class="num" style="color:#f0c040;font-weight:600" data-mach-rmb>US$${formatNumber(m.rate_rmb_24h, 2)}</td>
          <td class="num ref-edit" style="background:rgba(231,76,60,0.12);border:1px solid rgba(231,76,60,0.4)">
            HK$<input class="ref-input mach-hkd-input" value="${m.rate_hkd || ''}" placeholder="0" style="width:65px">
          </td>
          <td class="num" data-mach-target>
            <input class="ref-input mach-tgt-input" value="${m.target_qty || ''}" placeholder="0" style="width:55px">
          </td>
          <td class="num" data-mach-hkd-pc>${hkdPc}</td>
          <td class="num" data-mach-usd-pc>${usdPc}</td>
        </tr>`;
      }).join('');

      return `
        <div class="spin-section" style="margin-top:16px">
          <div class="spin-section-header">
            <div class="spin-section-accent" style="background:#27ae60"></div>
            <span class="spin-section-title">机台参考表 <span class="spin-section-subtitle">Machine Rate</span></span>
            <span style="font-size:11px;color:#6a8aaa;margin-left:12px">模具人工费率(美元/小时) = 价格(24H) ÷ 22 ÷ 7.75 ÷ 0.97 &nbsp;|&nbsp; 啤机价(HK$) = 价格(24H) ÷ 目标 &nbsp;|&nbsp; 啤机价(US$) = 价格(24H) ÷ 目标 ÷ 7.75</span>
          </div>
          <div class="spin-section-body">
            <div class="data-table-wrap">
              <table class="data-table">
                <thead><tr>
                  <th>机型</th><th>普通机</th>
                  <th style="color:#f0c040">模具人工费率<br>(美元/小时)</th>
                  <th style="color:#e74c3c">价格(24H) ✎</th>
                  <th>目标 ✎</th>
                  <th>啤机价(HK$)</th>
                  <th>啤机价(US$)</th>
                </tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>
        </div>`;
    }

    // 根据机型文字匹配参考机台（支持 "150T"=tonnage 或 "14A" 匹配 "14A-16A" 范围）
    function findMachRef(machType, machs) {
      if (!machType) return null;
      const t = (machType + '').trim().toUpperCase();
      // 1. 精确 tonnage 匹配（如 "150T"）
      let found = machs.find(m => m.tonnage && m.tonnage.trim().toUpperCase() === t);
      if (found) return found;
      // 2. 精确 machine_type 匹配
      found = machs.find(m => m.machine_type && m.machine_type.trim().toUpperCase() === t);
      if (found) return found;
      // 3. A数范围匹配（如 "14A" 在 "14A-16A" 范围内）
      const aMatch = t.match(/^(\d+)A$/);
      if (aMatch) {
        const n = parseInt(aMatch[1]);
        found = machs.find(m => {
          const parts = (m.machine_type || '').toUpperCase().split('-');
          const lo = parseInt(parts[0]);
          const hi = parseInt((parts[1] || '').replace(/A$/, '') || parts[0]);
          return !isNaN(lo) && !isNaN(hi) && n >= lo && n <= hi;
        });
      }
      return found || null;
    }

    Promise.all([
      fetch('/api/reference/materials').then(r => r.json()),
      fetch('/api/reference/machines').then(r => r.json()),
    ]).then(([mats, machs]) => {
      refSection.innerHTML = buildMatTable(mats) + buildMachTable(machs);

      // 料型匹配：按材料名从参考表取 client_spin_usd_kg（报客料价 USD/kg）
      function findMatRef(matName, mats) {
        if (!matName) return null;
        const t = matName.trim().toUpperCase();
        return mats.find(m => m.material_name && m.material_name.trim().toUpperCase() === t) || null;
      }

      // 自动填入模内件表：料价、吨数、人工费率，并计算 US$/toy 和 Molding Cost
      container.querySelectorAll('tr[data-machine]').forEach(tr => {
        const wt       = parseFloat(tr.dataset.weight) || 0;
        const sets     = parseFloat(tr.dataset.sets)   || 1;
        const cycle    = parseFloat(tr.dataset.cycle)  || 0;

        // 1. 料价：优先用解析值，为 0 时从参考表补入
        let resin = parseFloat(tr.dataset.resin) || 0;
        const resinCell  = tr.querySelector('[data-resin-cell]');
        const usdToyCell = tr.querySelector('[data-usd-toy]');
        if (!resin) {
          const matRef = findMatRef(tr.dataset.material, mats);
          if (matRef) {
            resin = parseFloat(matRef.client_spin_usd_kg) || parseFloat(matRef.spin_usd_kg) || 0;
            if (resinCell && resin) resinCell.textContent = resin.toFixed(4);
          }
        }
        // 重算 US$ per toy
        if (usdToyCell && resin && wt) {
          usdToyCell.textContent = (resin * wt / 1000).toFixed(4);
        }

        // 2. 机台：下拉选择机型，自动填入吨数、费率、Molding Cost
        const tonnageCell  = tr.querySelector('[data-mach-tonnage]');
        const rateCell     = tr.querySelector('[data-mach-rate]');
        const moldCostCell = tr.querySelector('[data-mold-cost]');

        function applyMachRef(ref) {
          if (!ref) return;
          const rate = parseFloat(ref.rate_rmb_24h) || 0;
          if (rateCell)    rateCell.textContent = rate ? rate.toFixed(4) : '—';
          if (moldCostCell && rate && cycle) {
            moldCostCell.textContent = (rate * cycle / 3600 / sets).toFixed(4);
          }
        }

        // 构建机型下拉
        const sel = document.createElement('select');
        sel.style.cssText = 'background:transparent;border:none;color:inherit;font-size:inherit;cursor:pointer;max-width:90px';
        const blankOpt = document.createElement('option');
        blankOpt.value = '';
        blankOpt.textContent = '— 选择 —';
        sel.appendChild(blankOpt);
        let matched = null;
        machs.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = `${m.tonnage || m.machine_type}`;
          opt.dataset.rate = m.rate_rmb_24h;
          opt.dataset.tonnage = m.tonnage || '';
          sel.appendChild(opt);
          if (!matched) {
            const ref = findMachRef(tr.dataset.machine, [m]);
            if (ref) { matched = opt; }
          }
        });
        if (matched) matched.selected = true;
        if (tonnageCell) { tonnageCell.innerHTML = ''; tonnageCell.appendChild(sel); }

        // 初始自动填入
        const initRef = findMachRef(tr.dataset.machine, machs);
        applyMachRef(initRef);

        // 用户切换时更新
        sel.addEventListener('change', () => {
          const selOpt = sel.options[sel.selectedIndex];
          const rate = parseFloat(selOpt.dataset.rate) || 0;
          if (rateCell)    rateCell.textContent = rate ? rate.toFixed(4) : '—';
          if (moldCostCell && rate && cycle) {
            moldCostCell.textContent = (rate * cycle / 3600 / sets).toFixed(4);
          } else if (moldCostCell) {
            moldCostCell.textContent = '—';
          }
          updateSubTotal();
        });
      });

      // 参考表填入完成后重算 Sub Total
      function updateSubTotal() {
        let sum = 0;
        container.querySelectorAll('tr[data-machine]').forEach(tr => {
          const cell = tr.querySelector('[data-usd-toy]');
          if (cell) sum += parseFloat(cell.textContent) || 0;
        });
        const span = container.querySelector('#spinMoldSubTotal');
        if (span) span.textContent = `Sub Total: ${sum.toFixed(4)} USD`;
      }
      updateSubTotal();

      // Inline editing: on blur, save and update calculated cells
      refSection.querySelectorAll('.ref-input').forEach(input => {
        input.addEventListener('blur', () => {
          const tr = input.closest('tr');
          const id = tr.dataset.id;
          const field = input.dataset.field;
          const val = parseFloat(input.value) || 0;
          saveField(id, field, val);

          const calc = calcFromLb(val);
          if (field === 'price_hkd_lb') {
            tr.querySelector('[data-std-rmb]').textContent = calc.rmb_g;
            tr.querySelector('[data-std-spin]').textContent = calc.spin_usd;
          } else {
            tr.querySelector('[data-cli-rmb]').textContent = calc.rmb_g;
            tr.querySelector('[data-cli-spin]').textContent = calc.spin_usd;
          }
          // Update diff
          const stdSpin = parseFloat(tr.querySelector('[data-std-spin]').textContent) || 0;
          const cliSpin = parseFloat(tr.querySelector('[data-cli-spin]').textContent) || 0;
          const diff = (cliSpin - stdSpin).toFixed(4);
          tr.querySelector('[data-diff]').textContent = diff === '0.0000' ? '—' : diff;
        });

        // Also update on Enter key
        input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
      });

      // Helper: refresh row derived cells
      function refreshMachRow(tr) {
        const hkd = parseFloat(tr.querySelector('.mach-hkd-input').value) || 0;
        const tgt = parseInt(tr.querySelector('.mach-tgt-input').value) || 0;
        tr.querySelector('[data-mach-rmb]').textContent = 'HK$' + calcMachRate(hkd);
        tr.querySelector('[data-mach-hkd-pc]').textContent = tgt ? (hkd / tgt).toFixed(4) : '—';
        tr.querySelector('[data-mach-usd-pc]').textContent = tgt ? (hkd / tgt / HKD_USD).toFixed(2) : '—';
      }

      // Machine 价格(24H) editable
      refSection.querySelectorAll('.mach-hkd-input').forEach(input => {
        input.addEventListener('blur', () => {
          const tr = input.closest('tr');
          refreshMachRow(tr);
          saveMach(tr.dataset.machId, input.value, tr.querySelector('.mach-tgt-input').value);
        });
        input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
      });

      // Machine target editable
      refSection.querySelectorAll('.mach-tgt-input').forEach(input => {
        input.addEventListener('blur', () => {
          const tr = input.closest('tr');
          refreshMachRow(tr);
          saveMach(tr.dataset.machId, tr.querySelector('.mach-hkd-input').value, input.value);
        });
        input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
      });

      // Click-to-edit labels (stored in localStorage)
      refSection.querySelectorAll('.ref-label-edit').forEach(span => {
        span.addEventListener('click', () => {
          const key = span.dataset.key;
          const cur = localStorage.getItem(key) || span.textContent.trim();
          const val = prompt('修改标签名称：', cur);
          if (val !== null && val.trim()) {
            localStorage.setItem(key, val.trim());
            // Update all spans with same key
            refSection.querySelectorAll(`.ref-label-edit[data-key="${key}"]`).forEach(s => {
              s.textContent = val.trim();
            });
          }
        });
      });
    }).catch(() => {
      refSection.innerHTML = '<div style="color:#e74c3c;font-size:12px">参考表加载失败</div>';
    });
  },
};
