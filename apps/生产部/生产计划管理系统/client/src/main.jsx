import React from 'react';
import ReactDOM from 'react-dom/client';
import axios from 'axios';
import App from './App';
import './index.css';

// nginx 子路径部署 (vite --base /production-plan/)。让 axios 调用 /api/* 自动加上前缀,
// 否则浏览器会请求根路径 /api/* 走到 core 而不是本 app 后端。
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
  </React.StrictMode>,
);
