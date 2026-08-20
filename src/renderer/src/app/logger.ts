export interface AppLogger {
  info(message: string, ...details: readonly unknown[]): void
  warn(message: string, ...details: readonly unknown[]): void
  error(message: string, ...details: readonly unknown[]): void
}

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
