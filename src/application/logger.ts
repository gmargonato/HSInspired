import type { RendererLogger } from './contracts/logger'

export type AppLogger = RendererLogger

/** Development logging plus observable AI decisions in production DevTools. */
export function createAppLogger(): AppLogger {
  const enabled = import.meta.env.DEV
  return {
    info: (message, ...details) => {
      if (enabled || message.startsWith('[Game AI]')) console.info(message, ...details)
    },
    warn: (message, ...details) => {
      if (enabled || message.startsWith('[Game AI]')) console.warn(message, ...details)
    },
    error: (message, ...details) => {
      if (enabled || message.startsWith('[Game AI]')) console.error(message, ...details)
    }
  }
}
