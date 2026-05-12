import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// nginx 子路径部署 (例如 /penyou/) 时由 Dockerfile 传入 BASE_PATH ARG，
// 进而设置 VITE_BASE_PATH，让 Vite 生成的资源 URL 带前缀。
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3100'
    }
  }
});
