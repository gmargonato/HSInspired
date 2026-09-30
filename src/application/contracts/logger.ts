/**
 * Small presentation-layer logging port. Features depend on this structural
 * contract instead of reaching upward into the application composition root.
 */
export interface RendererLogger {
  info(message: string, ...details: readonly unknown[]): void
  warn(message: string, ...details: readonly unknown[]): void
  error(message: string, ...details: readonly unknown[]): void
}
