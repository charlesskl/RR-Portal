import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

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
