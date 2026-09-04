import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/health': 'http://localhost:2567',
      '/metrics': 'http://localhost:2567',
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 150,
  },
})
