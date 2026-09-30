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

const CARD_CLASS_CONFIG_PATH = resolve('config/card-class-colors.json')
const OUTLINE_TUNING_CONFIG_PATH = resolve('config/outline-tunings.json')
const VFX_TEMPLATES_CONFIG_PATH = resolve('config/vfx-templates.json')
const LIVE_CONFIG_PATHS = new Set([
  CARD_CLASS_CONFIG_PATH,
  OUTLINE_TUNING_CONFIG_PATH,
  VFX_TEMPLATES_CONFIG_PATH
])

function liveConfigHmrGuard() {
  return {
    name: 'live-config-hmr-guard',
    handleHotUpdate(context: { readonly file: string }) {
      if (LIVE_CONFIG_PATHS.has(resolve(context.file))) return []
      return undefined
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
    plugins: [cspPlugin(mode), liveConfigHmrGuard()],
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
      port: 8081,
      strictPort: true
    }
  }
}))
