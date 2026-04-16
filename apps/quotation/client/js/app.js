/* Main application — state, routing, sidebar, tab switching */

const app = (() => {
  // ─── State ───────────────────────────────────────────────────────────────
  let currentProductId = null;
  let currentVersionId = null;
  let currentLevel = 'vq';     // 'vq' | 'bd'
  let currentTab = 'vq-body-cost';
  let versionData = null;
  let products = [];

  // Tab module registry
  const tabModules = {
    'vq-body-cost': typeof tab_vq_body_cost !== 'undefined' ? tab_vq_body_cost : null,
    'vq-packaging': typeof tab_vq_packaging !== 'undefined' ? tab_vq_packaging : null,
    'vq-purchase':  typeof tab_vq_purchase !== 'undefined' ? tab_vq_purchase : null,
    'vq-carton':    typeof tab_vq_carton !== 'undefined' ? tab_vq_carton : null,
    'vq-transport': typeof tab_vq_transport !== 'undefined' ? tab_vq_transport : null,
    'vq-summary':   typeof tab_vq_summary !== 'undefined' ? tab_vq_summary : null,
    'bd-material':  typeof tab_bd_material !== 'undefined' ? tab_bd_material : null,
    'bd-molding':   typeof tab_bd_molding !== 'undefined' ? tab_bd_molding : null,
    'bd-purchase':  typeof tab_bd_purchase !== 'undefined' ? tab_bd_purchase : null,
    'bd-decoration':typeof tab_bd_decoration !== 'undefined' ? tab_bd_decoration : null,
    'bd-others':    typeof tab_bd_others !== 'undefined' ? tab_bd_others : null,
    'bd-sewing':   typeof tab_bd_sewing !== 'undefined' ? tab_bd_sewing : null,
    'bd-rotocast': typeof tab_bd_rotocast !== 'undefined' ? tab_bd_rotocast : null,
  };

  // ─── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    setupEventListeners();
    await loadProducts();
  }

  // ─── Refresh (reload current version in place) ────────────────────────────
  async function refresh() {
    if (currentProductId && currentVersionId) {
      await selectVersion(currentProductId, currentVersionId);
    }
  }

  // ─── Products ─────────────────────────────────────────────────────────────
  async function loadProducts() {
    try {
      products = await api.getProducts();
      renderSidebar(products);
    } catch (e) {
      showToast('加载产品失败: ' + e.message, 'error');
    }
  }

  function renderSidebar(prods) {
    const list = document.getElementById('productList');
    const search = document.getElementById('searchInput').value.toLowerCase();

    const filtered = search
      ? prods.filter(p =>
          (p.item_no || '').toLowerCase().includes(search) ||
          (p.item_desc || '').toLowerCase().includes(search))
      : prods;

    if (filtered.length === 0) {
      list.innerHTML = '<div class="sidebar-empty">暂无产品，请导入报价明细</div>';
      return;
    }

    list.innerHTML = filtered.map(p => `
      <div class="product-item" data-product-id="${p.id}">
        <div class="product-header ${p.id === currentProductId ? 'selected' : ''}">
          <span class="product-arrow ${p.id === currentProductId ? 'expanded' : ''}">▶</span>
          <div class="product-name">
            <div class="product-no">${escapeHtml(p.item_no)}</div>
            ${p.item_desc ? `<div class="product-desc">${escapeHtml(p.item_desc)}</div>` : ''}
          </div>
          <span class="prod-del-btn" title="删除产品" data-product-id="${p.id}">✕</span>
        </div>
        <div class="product-versions ${p.id === currentProductId ? 'open' : ''}" id="versions-${p.id}">
          <div class="sidebar-empty" style="padding:6px 8px;font-size:11px">加载中…</div>
        </div>
      </div>
    `).join('');

    // Attach click handlers for product headers
    list.querySelectorAll('.product-header').forEach(hdr => {
      hdr.addEventListener('click', (e) => {
        if (e.target.classList.contains('prod-del-btn')) return;
        const productId = parseInt(hdr.closest('.product-item').dataset.productId);
        toggleProduct(productId);
      });
    });

    list.querySelectorAll('.prod-del-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const productId = parseInt(btn.dataset.productId);
        deleteProduct(productId);
      });
    });

    // If a product is already open, load its versions
    if (currentProductId) {
      loadVersionsForProduct(currentProductId);
    }
  }

  async function toggleProduct(productId) {
    if (currentProductId === productId) {
      currentProductId = null;
      renderSidebar(products);
      return;
    }
    currentProductId = productId;
    renderSidebar(products);
    await loadVersionsForProduct(productId);
  }

  async function deleteProduct(productId) {
    if (!confirm('确定删除该产品及其所有版本？')) return;
    try {
      await api.deleteProduct(productId);
      if (currentProductId === productId) {
        currentProductId = null;
        currentVersionId = null;
        versionData = null;
        document.getElementById('infoBar').innerHTML = '<div class="info-bar-empty">← 从左侧选择产品版本开始</div>';
        document.getElementById('tabNavWrapper').style.display = 'none';
        document.getElementById('summaryBar').style.display = 'none';
        document.getElementById('paramsPanel').style.display = 'none';
        headerInfoModule.hide();
        document.getElementById('tabContent').innerHTML = '<div class="tab-content-empty">请从左侧选择产品版本</div>';
      }
      await loadProducts();
      showToast('产品已删除', 'success');
    } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
  }

  async function loadVersionsForProduct(productId) {
    const container = document.getElementById(`versions-${productId}`);
    if (!container) return;
    try {
      const product = await api.getProduct(productId);
      const versions = product.versions || [];
      if (versions.length === 0) {
        container.innerHTML = '<div class="sidebar-empty" style="padding:6px 8px;font-size:11px">无版本</div>';
        return;
      }
      container.innerHTML = versions.map(v => `
        <div class="version-item ${v.id === currentVersionId ? 'active' : ''}"
             data-version-id="${v.id}" data-product-id="${productId}">
          <span class="version-name">${escapeHtml(v.version_name || v.source_sheet || `V${v.id}`)}</span>
          <span class="version-actions">
            <span class="version-status ${v.status}">${v.status === 'final' ? '定稿' : '草稿'}</span>
            <span class="ver-btn ver-dup" title="复制版本" data-version-id="${v.id}">⎘</span>
            <span class="ver-btn ver-del" title="删除版本" data-version-id="${v.id}">✕</span>
          </span>
        </div>
      `).join('');

      container.querySelectorAll('.version-item').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.classList.contains('ver-btn')) return;
          const vId = parseInt(item.dataset.versionId);
          const pId = parseInt(item.dataset.productId);
          selectVersion(pId, vId);
        });
      });

      container.querySelectorAll('.ver-dup').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const vId = parseInt(btn.dataset.versionId);
          try {
            const newVer = await api.duplicateVersion(vId);
            await loadVersionsForProduct(productId);
            selectVersion(productId, newVer.id);
            showToast('版本已复制', 'success');
          } catch (err) { showToast('复制失败: ' + err.message, 'error'); }
        });
      });

      container.querySelectorAll('.ver-del').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const vId = parseInt(btn.dataset.versionId);
          if (!confirm('确定删除该版本？')) return;
          try {
            await api.deleteVersion(vId);
            if (currentVersionId === vId) {
              currentVersionId = null;
              versionData = null;
              document.getElementById('infoBar').innerHTML = '<div class="info-bar-empty">← 从左侧选择产品版本开始</div>';
              document.getElementById('tabNavWrapper').style.display = 'none';
              document.getElementById('summaryBar').style.display = 'none';
              document.getElementById('paramsPanel').style.display = 'none';
              headerInfoModule.hide();
              document.getElementById('tabContent').innerHTML = '<div class="tab-content-empty">请从左侧选择产品版本</div>';
            }
            await loadVersionsForProduct(productId);
            showToast('版本已删除', 'success');
          } catch (err) { showToast('删除失败: ' + err.message, 'error'); }
        });
      });
    } catch (e) {
      container.innerHTML = `<div class="sidebar-empty" style="padding:6px;font-size:11px;color:#e74c3c">加载失败</div>`;
    }
  }

  // ─── Select Version ───────────────────────────────────────────────────────
  async function selectVersion(productId, versionId) {
    if (productId != null) currentProductId = productId;
    currentVersionId = versionId;
    renderSidebar(products);
    await loadVersionsForProduct(productId);

    try {
      versionData = await api.getVersion(versionId);
      renderInfoBar(versionData);
      paramsModule.render(versionId, versionData.params || {});
      headerInfoModule.render(versionId, versionData, currentLevel);
      document.getElementById('tabNavWrapper').style.display = '';
      document.getElementById('summaryBar').style.display = '';
      renderCurrentTab();
      updateSummaryBar();
    } catch (e) {
      showToast('加载版本失败: ' + e.message, 'error');
    }
  }

  // ─── Info Bar ─────────────────────────────────────────────────────────────
  function renderInfoBar(data) {
    const bar = document.getElementById('infoBar');
    const p = data.product || {};
    const v = data;
    const isFinal = v.status === 'final';
    bar.innerHTML = `
      <span class="info-bar-product">${escapeHtml(p.item_no || '')} ${p.item_desc ? escapeHtml(p.item_desc) : ''}</span>
      <span class="info-bar-version">${escapeHtml(v.version_name || v.source_sheet || `V${v.id}`)}</span>
      ${p.vendor ? `<span class="info-bar-vendor">${escapeHtml(p.vendor)}</span>` : ''}
      <div class="info-bar-actions">
        <button class="btn ${isFinal ? 'btn-success' : 'btn-outline'}" id="btnToggleFinal" title="${isFinal ? '点击改为草稿' : '点击标记为定稿'}">
          ${isFinal ? '✓ 定稿' : '草稿'}
        </button>
        <button class="btn btn-primary" id="btnTranslateAll">自动翻译英文</button>
        <button class="btn btn-export" id="btnExport">导出 Excel</button>
      </div>
    `;
    document.getElementById('btnTranslateAll').addEventListener('click', async () => {
      try {
        showToast('正在翻译，请稍候...', 'info');
        const r = await fetch(`${api.BASE}/api/versions/${currentVersionId}/translate-all`, { method: 'POST' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        showToast(`已翻译 ${d.translated} 条名称`, 'success');
        versionData = await api.getVersion(currentVersionId);
        renderCurrentTab();
      } catch (e) { showToast('翻译失败: ' + e.message, 'error'); }
    });
    document.getElementById('btnExport').addEventListener('click', () => {
      api.exportExcel(currentVersionId).catch(e => showToast('导出失败: ' + e.message, 'error'));
    });
    document.getElementById('btnToggleFinal').addEventListener('click', async () => {
      const newStatus = isFinal ? 'draft' : 'final';
      try {
        await api.updateVersion(currentVersionId, { status: newStatus });
        versionData.status = newStatus;
        renderInfoBar(versionData);
        await loadVersionsForProduct(currentProductId);
        showToast(newStatus === 'final' ? '已标记为定稿' : '已改为草稿', 'success');
      } catch (e) { showToast('状态更新失败: ' + e.message, 'error'); }
    });
  }

  // ─── Summary Bar ──────────────────────────────────────────────────────────
  function updateSummaryBar() {
    if (!versionData) return;
    const params = versionData.params || {};
    const parts = versionData.mold_parts || [];
    const hw = versionData.hardware_items || [];
    const pkg = versionData.packaging_items || [];
    const pd = versionData.painting_detail || {};
    const dim = versionData.product_dimension || {};

    const markupBody = parseFloat(params.markup_body) || 0;
    const markupPkg  = parseFloat(params.markup_packaging) || 0;
    const markupPoint = parseFloat(params.markup_point) || 1;
    const paymentDiv = parseFloat(params.payment_divisor) || 0.98;
    const surcharge  = parseFloat(params.surcharge_pct) || 0.004;
    const boxPrice   = parseFloat(params.box_price_hkd) || 0;
    const hkdUsd     = parseFloat(params.hkd_usd) || 0.1291;

    const rawAmt  = parts.reduce((s, p) => s + (parseFloat(p.material_cost_hkd) || 0), 0) * (1 + markupBody);
    const moldAmt = parts.reduce((s, p) => s + (parseFloat(p.molding_labor) || 0), 0) * (1 + markupBody);
    const purAmt  = hw.reduce((s, h) => s + (parseFloat(h.new_price) || 0), 0) * (1 + markupBody);
    const decSub  = (parseFloat(pd.labor_cost_hkd) || 0) + (parseFloat(pd.paint_cost_hkd) || 0);
    const bodyCost = rawAmt + moldAmt + purAmt + decSub * (1 + markupBody);

    const pkgItems = pkg.reduce((s, i) => s + (parseFloat(i.new_price) || 0), 0);
    const packagingTotal = (pkgItems + boxPrice) * (1 + markupPkg);

    const cartonPrice = parseFloat(dim.carton_price) || 0;
    const pcsPerCarton = parseInt(dim.pcs_per_carton) || 1;
    const cartonPerPc = pcsPerCarton > 0 ? cartonPrice / pcsPerCarton : 0;

    const subTotal = bodyCost + packagingTotal + cartonPerPc;
    const totalHkd = subTotal * (1 + surcharge) * markupPoint / paymentDiv;
    const totalUsd = totalHkd * hkdUsd;

    document.getElementById('sumBodyCost').textContent = formatCurrency(bodyCost);
    document.getElementById('sumTotalHkd').textContent = formatCurrency(totalHkd);
    document.getElementById('sumTotalUsd').textContent = formatCurrency(totalUsd, 'US$');
    document.getElementById('sumPackaging').textContent = formatCurrency(packagingTotal);
  }

  // ─── Tab Switching ────────────────────────────────────────────────────────
  function switchLevel(level) {
    currentLevel = level;
    // Set first tab of that level
    currentTab = level === 'vq' ? 'vq-body-cost' : 'bd-material';
    if (versionData) headerInfoModule.render(currentVersionId, versionData, level);

    document.querySelectorAll('.tab-top').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.level === level);
    });
    document.getElementById('tabsVq').style.display = level === 'vq' ? '' : 'none';
    document.getElementById('tabsBd').style.display = level === 'bd' ? '' : 'none';

    // Activate first sub-tab button
    const activeSubs = document.querySelectorAll(
      `#tabs${level === 'vq' ? 'Vq' : 'Bd'} .tab-sub`
    );
    activeSubs.forEach((btn, i) => btn.classList.toggle('active', i === 0));

    renderCurrentTab();
  }

  function switchTab(tabName) {
    currentTab = tabName;
    const level = tabName.startsWith('vq') ? 'vq' : 'bd';
    document.querySelectorAll(`#tabs${level === 'vq' ? 'Vq' : 'Bd'} .tab-sub`).forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    renderCurrentTab();
  }

  function renderCurrentTab() {
    const container = document.getElementById('tabContent');
    if (!versionData) {
      container.innerHTML = '<div class="tab-content-empty">请从左侧选择产品版本</div>';
      return;
    }
    const mod = tabModules[currentTab];
    if (mod && mod.render) {
      container.innerHTML = mod.render(versionData);
      if (mod.init) mod.init(container, versionData, currentVersionId);
    } else {
      container.innerHTML = `<div class="section-placeholder">
        <p style="color:#aaa">${currentTab} — 正在开发中</p>
      </div>`;
    }
  }

  // ─── Import ───────────────────────────────────────────────────────────────
  function openImportModal() {
    const modal = document.getElementById('importModal');
    const dropZone = document.getElementById('importDropZone');
    const progress = document.getElementById('importProgress');
    const fileInput = document.getElementById('fileInput');

    // Reset
    dropZone.style.display = '';
    progress.style.display = 'none';
    modal.style.display = 'flex';

    // Click to pick file
    dropZone.onclick = () => fileInput.click();

    // Drag and drop
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    }, { once: false });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) doImport(file);
    }, { once: true });
  }

  async function doImport(file) {
    const dropZone = document.getElementById('importDropZone');
    const progress = document.getElementById('importProgress');
    const status = document.getElementById('importStatus');

    dropZone.style.display = 'none';
    progress.style.display = '';
    status.textContent = '正在上传并解析…';

    try {
      const fd = new FormData();
      fd.append('file', file);
      const result = await api.importFile(fd);
      status.textContent = `导入成功！产品 #${result.productId} 版本 #${result.versionId}`;
      await loadProducts();
      setTimeout(() => {
        document.getElementById('importModal').style.display = 'none';
        selectVersion(result.productId, result.versionId);
      }, 1000);
    } catch (e) {
      status.textContent = '导入失败: ' + e.message;
      showToast('导入失败: ' + e.message, 'error');
    }
  }

  // ─── Event Listeners ──────────────────────────────────────────────────────
  function setupEventListeners() {
    // New product button
    document.getElementById('btnNew').addEventListener('click', openNewProductModal);

    // Import button
    document.getElementById('btnImport').addEventListener('click', openImportModal);

    // File input change
    document.getElementById('fileInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) doImport(file);
      e.target.value = '';
    });

    // Import modal cancel
    document.getElementById('importCancel').addEventListener('click', () => {
      document.getElementById('importModal').style.display = 'none';
    });

    // New product modal
    document.getElementById('npCancel').addEventListener('click', () => {
      document.getElementById('newProductModal').style.display = 'none';
    });
    document.getElementById('newProductModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
    });
    document.getElementById('npConfirm').addEventListener('click', async () => {
      const itemNo = document.getElementById('npItemNo').value.trim();
      if (!itemNo) return showToast('产品编号不能为空', 'error');
      try {
        const p = await api.createProduct({
          item_no: itemNo,
          item_desc: document.getElementById('npItemDesc').value.trim() || null,
          vendor: document.getElementById('npVendor').value.trim() || null,
        });
        document.getElementById('newProductModal').style.display = 'none';
        await loadProducts();
        toggleProduct(p.id);
        showToast('产品创建成功', 'success');
      } catch (e) { showToast('创建失败: ' + e.message, 'error'); }
    });

    // Search
    document.getElementById('searchInput').addEventListener('input', () => {
      renderSidebar(products);
    });

    // Header info toggle
    document.getElementById('headerInfoToggle').addEventListener('click', () => {
      const body = document.getElementById('headerInfoBody');
      const arrow = document.querySelector('#headerInfoToggle .header-info-arrow');
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : '';
      arrow.classList.toggle('open', !isOpen);
    });

    // Top-level tab buttons
    document.querySelectorAll('.tab-top').forEach(btn => {
      btn.addEventListener('click', () => switchLevel(btn.dataset.level));
    });

    // Sub-tab buttons
    document.querySelectorAll('.tab-sub').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
  }

  // ─── New Product Modal ────────────────────────────────────────────────────
  function openNewProductModal() {
    const modal = document.getElementById('newProductModal');
    modal.style.display = 'flex';
    modal.querySelector('#npItemNo').value = '';
    modal.querySelector('#npItemDesc').value = '';
    modal.querySelector('#npVendor').value = '';
    modal.querySelector('#npItemNo').focus();
  }

  return { init, loadProducts, selectVersion, refresh, switchLevel, switchTab };
})();

document.addEventListener('DOMContentLoaded', () => app.init());
