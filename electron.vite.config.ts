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
const LIVE_CONFIG_PATHS = new Set([CARD_CLASS_CONFIG_PATH, OUTLINE_TUNING_CONFIG_PATH])

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
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [cspPlugin(mode), liveConfigHmrGuard()],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@assets': resolve('assets'),
        '@dev-inspector': resolve(
          mode === 'production'
            ? 'src/renderer/app/renderer-production-placeholder.ts'
            : 'src/renderer/scenes/dev/card-inspector-scene.ts'
        ),
        '@outline-lab': resolve(
          mode === 'production'
            ? 'src/renderer/app/renderer-production-placeholder.ts'
            : 'src/renderer/scenes/dev/outline-lab-scene.ts'
        ),
        '@hero-power-anim': resolve(
          mode === 'production'
            ? 'src/renderer/app/renderer-production-placeholder.ts'
            : 'src/renderer/scenes/dev/hero-power-anim-scene.ts'
        ),
        '@vfx-lab': resolve(
          mode === 'production'
            ? 'src/renderer/app/renderer-production-placeholder.ts'
            : 'src/renderer/scenes/dev/vfx-lab-scene.ts'
        ),
        '@dev-layout-inspector': resolve(
          mode === 'production'
            ? 'src/renderer/app/renderer-production-placeholder.ts'
            : 'src/renderer/features/dev/layout-inspector/index.ts'
        ),
        '@dev-match-performance': resolve(
          mode === 'production'
            ? 'src/renderer/app/renderer-production-placeholder.ts'
            : 'src/renderer/app/dev-match-performance.ts'
        ),
        '@outline-directions': resolve(
          mode === 'production'
            ? 'src/renderer/rendering/effects/outline-directions-placeholder.ts'
            : 'src/renderer/rendering/effects/outline-directions-dev.ts'
        )
      }
    },
    server: {
      port: 8081,
      strictPort: true
    }
  }
}))
