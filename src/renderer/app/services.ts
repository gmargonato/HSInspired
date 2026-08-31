import { PersistentDeckStore, type DeckStore } from './deck-store'
import { createAppLogger, type AppLogger } from './logger'
import type { AiDecisionApi } from '../../shared/ipc/ai'
import { PersistentPlayerStatsStore } from './player-stats-store'
import type { PlayerStatsStore } from '../ui/player-stats-store'
import { PersistentArenaStore } from './arena-store'
import type { ArenaStore } from '../ui/arena-store'

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
  readonly ai: AiDecisionApi
  readonly arenaStore: ArenaStore
  readonly deckStore: DeckStore
  readonly playerStatsStore: PlayerStatsStore
  readonly dialogs: DialogService
  readonly logger: AppLogger
}

export function createAppServices(overrides: Partial<AppServices> = {}): AppServices {
  const logger = overrides.logger ?? createAppLogger()
  const ai =
    overrides.ai ??
    (typeof window !== 'undefined' && window.api?.ai
      ? window.api.ai
      : {
          decide: async () => {
            throw new Error('The AI decision bridge is unavailable.')
          }
        })
  return {
    ai,
    arenaStore: overrides.arenaStore ?? new PersistentArenaStore(),
    deckStore: overrides.deckStore ?? new PersistentDeckStore(undefined, logger),
    playerStatsStore: overrides.playerStatsStore ?? new PersistentPlayerStatsStore(),
    dialogs: overrides.dialogs ?? new BrowserDialogService(),
    logger,
    ...overrides
  }
}
