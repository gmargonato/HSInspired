import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'

const DEVELOPMENT_CSP =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self' http://localhost:8081 ws://localhost:8081 data: blob:"

const PRODUCTION_CSP =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self' data: blob:"

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
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [cspPlugin(mode)],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@assets': resolve('assets'),
        '@dev-inspector': resolve(
          mode === 'production'
            ? 'src/renderer/src/app/renderer-production-placeholder.ts'
            : 'src/renderer/src/scenes/dev/CardInspectorScene.ts'
        ),
        '@dev-layout-inspector': resolve(
          mode === 'production'
            ? 'src/renderer/src/app/renderer-production-placeholder.ts'
            : 'src/renderer/src/features/dev/layout-inspector/index.ts'
        )
      }
    },
    server: {
      port: 8081,
      strictPort: true
    }
  }
}))
