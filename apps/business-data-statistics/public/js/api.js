// API 封装
const API = {
  token: localStorage.getItem('token'),
  baseURL: '/business-data/api',

  setToken(token) {
    this.token = token;
    if (token) localStorage.setItem('token', token);
    else localStorage.removeItem('token');
  },

  async request(method, url, data, options = {}) {
    const config = {
      method,
      url: this.baseURL + url,
      headers: { 'Content-Type': 'application/json' },
      ...options
    };
    if (this.token) config.headers.Authorization = `Bearer ${this.token}`;
    if (data && ['post', 'put', 'delete'].includes(method)) config.data = data;
    if (data && method === 'get') config.params = data;

    try {
      const res = await axios(config);
      return res.data;
    } catch (err) {
      if (err.response?.status === 401) {
        this.setToken(null);
        localStorage.removeItem('user');
        window.location.hash = '#/login';
      }
      throw err.response?.data || err;
    }
  },

  get(url, params) { return this.request('get', url, params); },
  post(url, data) { return this.request('post', url, data); },
  put(url, data) { return this.request('put', url, data); },
  del(url, data) { return this.request('delete', url, data); },

  // 文件上传
  async upload(url, file) {
    const formData = new FormData();
    formData.append('file', file);
    const config = {
      method: 'post',
      url: this.baseURL + url,
      data: formData,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'multipart/form-data'
      }
    };
    const res = await axios(config);
    return res.data;
  },

  // === 公式配置 API ===
  getFormulas(params) { return this.get('/settings/formulas', params); },
  createFormula(data) { return this.post('/settings/formulas', data); },
  updateFormula(id, data) { return this.put(`/settings/formulas/${id}`, data); },
  deleteFormula(id) { return this.del(`/settings/formulas/${id}`); },
  sortFormulas(items) { return this.put('/settings/formulas/sort', items); },
  validateFormula(data) { return this.post('/settings/formulas/validate', data); },
  testFormula(data) { return this.post('/settings/formulas/test', data); },
  recalculate(data) { return this.post('/settings/formulas/recalculate', data); },

  // === 公式常量 API ===
  getConstants(params) { return this.get('/settings/constants', params); },
  getConstantNames(params) { return this.get('/settings/constants/names', params); },
  resolveConstants(params) { return this.get('/settings/constants/resolve', params); },
  saveConstant(data) { return this.post('/settings/constants', data); },
  deleteConstant(id) { return this.del(`/settings/constants/${id}`); },

  // === 大车间汇总 API ===
  getSummaryDashboard(params) { return this.get('/summary/dashboard', params); },
  getSummaryDetail(params) { return this.get('/summary/detail', params); },

  // === 字段注册表 & 标签 API ===
  getFieldRegistry(params) { return this.get('/settings/field-registry', params); },
  getFieldTags(params) { return this.get('/settings/field-tags', params); },
  updateFieldTags(tags) { return this.put('/settings/field-tags', { tags }); },

  // 文件下载
  async download(url, params, filename) {
    const config = {
      method: 'get',
      url: this.baseURL + url,
      params,
      responseType: 'blob',
      headers: { Authorization: `Bearer ${this.token}` }
    };
    const res = await axios(config);
    const blob = new Blob([res.data]);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }
};
