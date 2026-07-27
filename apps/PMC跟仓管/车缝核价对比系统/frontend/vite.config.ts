import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// 注意：5173 已被本机 ERP 系统占用，前端固定用 5200。
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5200,
    strictPort: true, // 端口被占直接报错，不静默跳到 5201，避免与 CORS 配置脱节
  },
})
