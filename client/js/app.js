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
  };

  // ─── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    setupEventListeners();
    await loadProducts();
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
        </div>
        <div class="product-versions ${p.id === currentProductId ? 'open' : ''}" id="versions-${p.id}">
          <div class="sidebar-empty" style="padding:6px 8px;font-size:11px">加载中…</div>
        </div>
      </div>
    `).join('');

    // Attach click handlers for product headers
    list.querySelectorAll('.product-header').forEach(hdr => {
      hdr.addEventListener('click', () => {
        const productId = parseInt(hdr.closest('.product-item').dataset.productId);
        toggleProduct(productId);
      });
    });

    // If a product is already open, load its versions
    if (currentProductId) {
      loadVersionsForProduct(currentProductId);
    }
  }

  async function toggleProduct(productId) {
    if (currentProductId === productId) {
      // Collapse
      currentProductId = null;
      renderSidebar(products);
      return;
    }
    currentProductId = productId;
    renderSidebar(products);
    await loadVersionsForProduct(productId);
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
          <span>${escapeHtml(v.version_name || v.source_sheet || `V${v.id}`)}</span>
          <span class="version-status ${v.status}">${v.status === 'final' ? '定稿' : '草稿'}</span>
        </div>
      `).join('');

      container.querySelectorAll('.version-item').forEach(item => {
        item.addEventListener('click', () => {
          const vId = parseInt(item.dataset.versionId);
          const pId = parseInt(item.dataset.productId);
          selectVersion(pId, vId);
        });
      });
    } catch (e) {
      container.innerHTML = `<div class="sidebar-empty" style="padding:6px;font-size:11px;color:#e74c3c">加载失败</div>`;
    }
  }

  // ─── Select Version ───────────────────────────────────────────────────────
  async function selectVersion(productId, versionId) {
    currentProductId = productId;
    currentVersionId = versionId;
    renderSidebar(products);
    await loadVersionsForProduct(productId);

    try {
      versionData = await api.getVersion(versionId);
      renderInfoBar(versionData);
      paramsModule.render(versionId, versionData.params || {});
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
    bar.innerHTML = `
      <span class="info-bar-product">${escapeHtml(p.item_no || '')} ${escapeHtml(p.item_desc || '')}</span>
      <span class="info-bar-version">${escapeHtml(v.version_name || v.source_sheet || '')}</span>
      ${p.vendor ? `<span class="info-bar-vendor">${escapeHtml(p.vendor)}</span>` : ''}
      <div class="info-bar-actions">
        <button class="btn btn-export" id="btnExport">导出 Excel</button>
      </div>
    `;
    document.getElementById('btnExport').addEventListener('click', () => {
      api.exportExcel(currentVersionId).catch(e => showToast('导出失败: ' + e.message, 'error'));
    });
  }

  // ─── Summary Bar ──────────────────────────────────────────────────────────
  function updateSummaryBar() {
    if (!versionData) return;
    // Use pricing data from parsed params for now
    const params = versionData.params || {};
    const moldParts = versionData.mold_parts || [];

    const totalMaterialCost = moldParts.reduce((s, p) => s + (p.material_cost_hkd || 0), 0);
    const totalMoldingLabor = moldParts.reduce((s, p) => s + (p.molding_labor || 0), 0);

    document.getElementById('sumBodyCost').textContent = formatCurrency(totalMaterialCost + totalMoldingLabor);
    document.getElementById('sumTotalHkd').textContent = '—';
    document.getElementById('sumTotalUsd').textContent = '—';
    document.getElementById('sumPackaging').textContent = '—';
  }

  // ─── Tab Switching ────────────────────────────────────────────────────────
  function switchLevel(level) {
    currentLevel = level;
    // Set first tab of that level
    currentTab = level === 'vq' ? 'vq-body-cost' : 'bd-material';

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

    // Search
    document.getElementById('searchInput').addEventListener('input', () => {
      renderSidebar(products);
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

  return { init, loadProducts, selectVersion, switchLevel, switchTab };
})();

document.addEventListener('DOMContentLoaded', () => app.init());
