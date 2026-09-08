import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Match renderer resolution for component lifecycle tests; no app is launched.
    alias: {
      '@assets': resolve('assets'),
      '@outline-directions': resolve(
        'src/renderer/rendering/effects/outline-directions-dev.ts'
      )
    }
  }
})
