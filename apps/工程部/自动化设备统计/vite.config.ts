import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// base './'：构建产物以相对路径引用资源，支持 nginx 子路径（/automation-equipment/）部署
export default defineConfig({
  base: './',
  plugins: [react()],
});
