import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: process.env.VITE_BASE_PATH || '/',
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        timeout: 300000,
        configure: (proxy) => {
          proxy.on('error', (err, req) => {
            console.log('[proxy error]', req.url, err.message)
          })
          proxy.on('proxyReq', (_, req) => {
            console.log('[proxy →]', req.method, req.url)
          })
          proxy.on('proxyRes', (res, req) => {
            console.log('[proxy ←]', res.statusCode, req.url)
          })
        },
      },
    },
  },
})
