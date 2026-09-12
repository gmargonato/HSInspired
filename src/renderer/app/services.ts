import { PersistentDeckStore, type DeckStore } from './deck-store'
import { createAppLogger, type AppLogger } from './logger'
import type { AiDecisionApi } from '../../shared/ipc/ai'
import { createAiDecisionApi } from './ai-decision-api'
import type { MatchLogsApi } from '../../shared/ipc/match-logs'
import { PersistentPlayerStatsStore } from './player-stats-store'
import type { PlayerStatsStore } from '../ui/player-stats-store'
import { PersistentArenaStore } from './arena-store'
import type { ArenaStore } from '../ui/arena-store'
import { resolveAssetDefinition } from '../ui/asset-registry'

export type { AppLogger } from './logger'

export interface DialogService {
  confirm(message: string): boolean
  error(message: string, retry?: () => void): void
}

export class BrowserDialogService implements DialogService {
  confirm(message: string): boolean {
    return typeof window.confirm === 'function' ? window.confirm(message) : true
  }

  error(message: string, retry?: () => void): void {
    const existing = document.getElementById('app-error-notice')
    const notice = existing ?? document.createElement('div')
    notice.id = 'app-error-notice'
    notice.setAttribute('role', 'alert')
    notice.className = 'app-error-notice'
    notice.style.backgroundImage = `url("${resolveAssetDefinition('ui.generic-dialog').source.src}")`
    notice.textContent = ''
    const text = document.createElement('div')
    text.className = 'app-error-notice-message'
    text.textContent = message
    text.tabIndex = 0
    notice.appendChild(text)

    if (retry) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = 'Retry AI'
      button.className = 'app-error-notice-button app-error-notice-retry'
      button.addEventListener(
        'click',
        () => {
          button.disabled = true
          notice.remove()
          retry()
        },
        { once: true }
      )
      notice.appendChild(button)
    }
    {
      const dismiss = document.createElement('button')
      dismiss.type = 'button'
      dismiss.textContent = 'Dismiss'
      dismiss.className = 'app-error-notice-button app-error-notice-dismiss'
      dismiss.addEventListener('click', () => notice.remove())
      notice.appendChild(dismiss)
      if (!existing) document.body.appendChild(notice)
    }
  }
}

/** Renderer-lifetime dependencies assembled once by the application root. */
export interface AppServices {
  readonly matchLogs?: MatchLogsApi
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
      ? createAiDecisionApi(window.api.ai)
      : {
          settings: async () => {
            throw new Error('The AI settings bridge is unavailable.')
          },
          cancel: async () => {},
          decide: async () => {
            throw new Error('The AI decision bridge is unavailable.')
          }
        })
  return {
    ai,
    matchLogs:
      overrides.matchLogs ??
      (typeof window !== 'undefined' ? window.api?.matchLogs : undefined),
    arenaStore: overrides.arenaStore ?? new PersistentArenaStore(),
    deckStore: overrides.deckStore ?? new PersistentDeckStore(undefined, logger),
    playerStatsStore: overrides.playerStatsStore ?? new PersistentPlayerStatsStore(),
    dialogs: overrides.dialogs ?? new BrowserDialogService(),
    logger,
    ...overrides
  }
}
