import axios from 'axios';
import { message } from 'antd';

const TOKEN_KEY = 'scp_token';
const appBasePath = import.meta.env.BASE_URL === '/'
  ? ''
  : import.meta.env.BASE_URL.replace(/\/$/, '');

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

/** 后端统一响应包装 { success, data, message }。 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

export const http = axios.create({
  // 正式部署时前后端同源，使用相对地址；本地开发仍连接 5192。
  baseURL: import.meta.env.VITE_API_BASE ?? (import.meta.env.PROD ? '' : 'http://localhost:5192'),
  timeout: 15000,
});

// 请求：附带 JWT
http.interceptors.request.use((config) => {
  if (appBasePath && config.url?.startsWith('/api/'))
    config.url = `${appBasePath}${config.url}`;

  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 响应：401 跳登录；其余错误统一弹提示
http.interceptors.response.use(
  (resp) => resp,
  (error) => {
    if (error.response?.status === 401) {
      tokenStore.clear();
      const loginPath = `${appBasePath}/login`;
      if (location.pathname !== loginPath) location.href = loginPath;
    } else {
      const data = error.response?.data;
      const validation = data?.errors && typeof data.errors === 'object'
        ? Object.values(data.errors).flat().join('；')
        : null;
      const msg = data?.message ?? validation ?? data?.title ?? error.message ?? '请求失败';
      error.message = msg;
      message.error(msg);
    }
    return Promise.reject(error);
  },
);

/** 调用并解包 ApiResponse；success=false 时抛出 message。 */
export async function unwrap<T>(promise: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const { data } = await promise;
  if (!data.success) {
    message.error(data.message ?? '操作失败');
    throw new Error(data.message ?? 'operation failed');
  }
  return data.data as T;
}
