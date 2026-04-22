import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'server/**/*.spec.ts'],
    environment: 'node',
  },
})
