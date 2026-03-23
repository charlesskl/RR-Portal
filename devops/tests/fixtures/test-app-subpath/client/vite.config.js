import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/test-app-subpath/',
  plugins: [react()],
  server: { port: 3001 },
});
