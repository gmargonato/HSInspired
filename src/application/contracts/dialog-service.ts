export interface DialogService {
  confirm(message: string): boolean
  error(message: string, retry?: () => void): void
  abandon(message: string, onContinue: () => void): void
}
