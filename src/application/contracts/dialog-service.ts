export interface DialogService {
  confirm(message: string): boolean
  /** Shows a non-blocking message for three seconds, with no buttons. */
  error(message: string): void
  abandon(message: string, onContinue: () => void): void
}
