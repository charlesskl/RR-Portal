import React from 'react';
import ReactDOM from 'react-dom/client';
import axios from 'axios';
import App from './App';
import 'antd/dist/reset.css';
import './index.css';

// Rewrite /api/... requests to include base path when served under a subpath
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
if (basePath) {
  axios.interceptors.request.use(config => {
    if (config.url && config.url.startsWith('/api')) {
      config.url = basePath + config.url;
    }
    return config;
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
