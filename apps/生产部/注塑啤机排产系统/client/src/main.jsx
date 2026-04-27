import React from 'react';
import ReactDOM from 'react-dom/client';
import axios from 'axios';
import App from './App';
import 'antd/dist/reset.css';
import './index.css';

// nginx 子路径部署 (vite --base /paiji/)。让 axios 调用 /api/* 自动加上 /paiji 前缀,
// 否则浏览器会请求根路径 /api/* 走到 core/FastAPI 而不是 paiji 后端。
const basePrefix = import.meta.env.BASE_URL.replace(/\/$/, '');
if (basePrefix) {
  axios.interceptors.request.use((config) => {
    if (config.url && config.url.startsWith('/api/')) {
      config.url = basePrefix + config.url;
    }
    return config;
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
