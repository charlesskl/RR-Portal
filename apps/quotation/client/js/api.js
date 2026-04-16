/* API client — all calls go through this module */
const api = (() => {
  // Derive base path from current URL so the app works under any reverse-proxy
  // prefix (e.g. nginx /quotation/ -> container /). location.pathname is the
  // directory the page is served from; strip trailing file/slash to get '/quotation'.
  const BASE = location.pathname.replace(/\/[^/]*$/, '');

  async function request(method, path, body) {
    const opts = {
      method,
      headers: {},
    };
    if (body instanceof FormData) {
      opts.body = body;
    } else if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(BASE + path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    // Export endpoint returns a file blob
    if (path.startsWith('/api/export')) return res.blob();
    return res.json();
  }

  return {
    BASE,
    // Products
    getProducts: () => request('GET', '/api/products'),
    createProduct: (data) => request('POST', '/api/products', data),
    getProduct: (id) => request('GET', `/api/products/${id}`),
    updateProduct: (id, data) => request('PUT', `/api/products/${id}`, data),
    deleteProduct: (id) => request('DELETE', `/api/products/${id}`),

    // Versions
    getVersion: (id) => request('GET', `/api/versions/${id}`),
    updateVersion: (id, data) => request('PUT', `/api/versions/${id}`, data),
    deleteVersion: (id) => request('DELETE', `/api/versions/${id}`),
    duplicateVersion: (id) => request('POST', `/api/versions/${id}/duplicate`),

    // Params
    getParams: (versionId) => request('GET', `/api/versions/${versionId}/params`),
    updateParams: (versionId, data) => request('PUT', `/api/versions/${versionId}/params`, data),
    updateMaterialPrices: (versionId, data) => request('PUT', `/api/versions/${versionId}/material-prices`, data),
    updateMachinePrices: (versionId, data) => request('PUT', `/api/versions/${versionId}/machine-prices`, data),

    // Section CRUD
    getSectionItems: (versionId, section) =>
      request('GET', `/api/versions/${versionId}/sections/${section}`),
    addSectionItem: (versionId, section, data) =>
      request('POST', `/api/versions/${versionId}/sections/${section}`, data),
    updateSectionItem: (versionId, section, itemId, data) =>
      request('PUT', `/api/versions/${versionId}/sections/${section}/${itemId}`, data),
    deleteSectionItem: (versionId, section, itemId) =>
      request('DELETE', `/api/versions/${versionId}/sections/${section}/${itemId}`),

    // Import
    importFile: (formData) => request('POST', '/api/import', formData),

    // Export
    exportExcel: async (versionId) => {
      const blob = await request('GET', `/api/export/${versionId}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `VendorQuotation_${versionId}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    },

    // Calculate
    calculate: (versionId) => request('GET', `/api/versions/${versionId}/calculate`),
  };
})();
