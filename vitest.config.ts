import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Match renderer resolution for component lifecycle tests; no app is launched.
    alias: {
      '@assets': resolve('assets'),
      '@outline-directions': resolve(
        'src/dev-tools/outline-lab/outline-directions-dev.ts'
      )
    }
  }
})
