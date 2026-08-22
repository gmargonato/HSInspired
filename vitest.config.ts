import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@assets': resolve('assets'),
      '@renderer': resolve('src/renderer')
    }
  },
  test: {
    environment: 'node',
    setupFiles: ['tests/setup/pixi-headless.ts'],
    include: ['**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true
  }
})
