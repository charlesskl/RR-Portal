import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE_PATH ?? (command === 'build' ? '/factory-review/' : '/'),
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
}))
