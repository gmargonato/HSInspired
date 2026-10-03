import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'

const DEVELOPMENT_CSP =
  "default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self' http://localhost:8081 ws://localhost:8081 data: blob:"

const PRODUCTION_CSP =
  "default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self' data: blob:"

function cspPlugin(mode: string) {
  const csp = mode === 'development' ? DEVELOPMENT_CSP : PRODUCTION_CSP

  return {
    name: 'hs-inspired-csp',
    transformIndexHtml(html: string): string {
      return html.replace('__CSP__', csp)
    }
  }
}

export default defineConfig(({ mode }) => ({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: resolve('src/desktop/main/index.ts') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: resolve('src/desktop/preload/index.ts') }
    }
  },
  renderer: {
    root: resolve('src/application'),
    build: {
      rollupOptions: { input: resolve('src/application/index.html') }
    },
    plugins: [cspPlugin(mode)],
    resolve: {
      alias: {
        '@application': resolve('src/application'),
        '@assets': resolve('assets'),
        '@dev-inspector': resolve(
          mode === 'production'
            ? 'src/application/renderer-production-placeholder.ts'
            : 'src/dev-tools/card-inspector/card-inspector-scene.ts'
        ),
        '@outline-lab': resolve(
          mode === 'production'
            ? 'src/application/renderer-production-placeholder.ts'
            : 'src/dev-tools/outline-lab/outline-lab-scene.ts'
        ),
        '@hero-power-anim': resolve(
          mode === 'production'
            ? 'src/application/renderer-production-placeholder.ts'
            : 'src/dev-tools/hero-power-anim/hero-power-anim-scene.ts'
        ),
        '@vfx-lab': resolve(
          mode === 'production'
            ? 'src/application/renderer-production-placeholder.ts'
            : 'src/dev-tools/vfx-lab/vfx-lab-scene.ts'
        ),
        '@dev-layout-inspector': resolve(
          mode === 'production'
            ? 'src/application/renderer-production-placeholder.ts'
            : 'src/dev-tools/layout-inspector/index.ts'
        ),
        '@dev-match-performance': resolve(
          mode === 'production'
            ? 'src/application/renderer-production-placeholder.ts'
            : 'src/dev-tools/runtime/dev-match-performance.ts'
        ),
        '@outline-directions': resolve(
          mode === 'production'
            ? 'src/visual-components/effects/outline-directions-placeholder.ts'
            : 'src/dev-tools/outline-lab/outline-directions-dev.ts'
        )
      }
    },
    server: {
      // Keep the current game session running while source files are edited.
      // Restart npm run dev to apply changes; do not invalidate cached modules
      // or restart the server when its configuration changes during a match.
      hmr: false,
      watch: null,
      port: 8081,
      strictPort: true
    }
  }
}))
