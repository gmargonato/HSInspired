import { AudioService } from './audio'
import {
  PersistentDeckStore,
  type DeckStore
} from '../features/deck-builder/deck-store'
import { createAppLogger, type AppLogger } from './logger'

export type { AppLogger } from './logger'

export interface DialogService {
  confirm(message: string): boolean
  error(message: string): void
}

class BrowserDialogService implements DialogService {
  confirm(message: string): boolean {
    return typeof window.confirm === 'function' ? window.confirm(message) : true
  }

  error(message: string): void {
    const existing = document.getElementById('app-error-notice')
    const notice = existing ?? document.createElement('div')
    notice.id = 'app-error-notice'
    notice.setAttribute('role', 'alert')
    notice.style.position = 'fixed'
    notice.style.left = '50%'
    notice.style.bottom = '24px'
    notice.style.zIndex = '1000'
    notice.style.maxWidth = 'min(720px, calc(100vw - 48px))'
    notice.style.padding = '14px 18px'
    notice.style.transform = 'translateX(-50%)'
    notice.style.border = '1px solid #d29b60'
    notice.style.borderRadius = '6px'
    notice.style.background = '#241b22'
    notice.style.color = '#fff4df'
    notice.style.fontFamily = 'Arial, sans-serif'
    notice.textContent = message

    if (!existing) {
      const dismiss = document.createElement('button')
      dismiss.type = 'button'
      dismiss.textContent = 'Dismiss'
      dismiss.style.marginLeft = '16px'
      dismiss.addEventListener('click', () => notice.remove())
      notice.appendChild(dismiss)
      document.body.appendChild(notice)
    }
  }
}

/** Renderer-lifetime dependencies assembled once by the application root. */
export interface AppServices {
  readonly audio: AudioService
  readonly deckStore: DeckStore
  readonly dialogs: DialogService
  readonly logger: AppLogger
}

export function createAppServices(overrides: Partial<AppServices> = {}): AppServices {
  const logger = overrides.logger ?? createAppLogger()
  return {
    audio: overrides.audio ?? new AudioService({ logger }),
    deckStore: overrides.deckStore ?? new PersistentDeckStore(undefined, logger),
    dialogs: overrides.dialogs ?? new BrowserDialogService(),
    logger,
    ...overrides
  }
}
