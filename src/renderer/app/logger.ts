import type { RendererLogger } from '../ui/logger'

export type AppLogger = RendererLogger

/** Development-visible logging without production debug noise. */
export function createAppLogger(): AppLogger {
  const enabled = import.meta.env.DEV
  return {
    info: (message, ...details) => {
      if (enabled) console.info(message, ...details)
    },
    warn: (message, ...details) => {
      if (enabled) console.warn(message, ...details)
    },
    error: (message, ...details) => {
      if (enabled) console.error(message, ...details)
    }
  }
}
