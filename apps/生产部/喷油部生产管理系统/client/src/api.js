import axios from 'axios';

// 子路径部署: vite --base /penyou/ 时 BASE_URL = '/penyou/'。
// 浏览器调用 axios `/orders` → 实际请求 `/penyou/api/orders`，命中 nginx 的 /penyou/api/ location。
const basePrefix = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
const api = axios.create({ baseURL: basePrefix + '/api' });

api.interceptors.request.use(config => {
  const id = localStorage.getItem('workshop_id');
  // /workshops 路径不注入 workshop_id(它本身就是公共 API)
  const url = config.url || '';
  if (id && !url.startsWith('/workshops')) {
    config.params = { ...config.params, workshop_id: id };
  }
  return config;
});

export default api;
