import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve('card-lab'),
  base: './',
  resolve: {
    alias: {
      '@assets': resolve('assets')
    }
  },
  server: {
    port: 8090,
    strictPort: true
  },
  build: {
    outDir: resolve('dist-card-lab'),
    emptyOutDir: true
  }
})
