import type { DialogService } from './contracts/dialog-service'
import { PersistentDeckStore, type DeckStore } from './deck-store'
import { createAppLogger, type AppLogger } from './logger'
import type { AiDecisionApi } from '../desktop/contracts/ipc/ai'
import { createAiDecisionApi } from './ai-decision-api'
import type { MatchLogsApi } from '../desktop/contracts/ipc/match-logs'
import type { PreferencesApi } from '../desktop/contracts/ipc/preferences'
import { PersistentPlayerStatsStore } from './player-stats-store'
import { PersistentProgressionStore } from './progression-store'
import type { ProgressionStore } from './contracts/progression-store'
import type { PlayerStatsStore } from './contracts/player-stats-store'
import { PersistentArenaStore } from './arena-store'
import type { ArenaStore } from './contracts/arena-store'
import { resolveAssetDefinition } from '../visual-components/assets'

export type { AppLogger } from './logger'
export type { DialogService } from './contracts/dialog-service'

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

  abandon(message: string, onContinue: () => void): void {
    document.getElementById('app-abandon-overlay')?.remove()
    const overlay = document.createElement('div')
    overlay.id = 'app-abandon-overlay'
    overlay.className = 'app-abandon-overlay'
    overlay.setAttribute('role', 'alertdialog')
    overlay.setAttribute('aria-modal', 'true')

    const notice = document.createElement('div')
    notice.className = 'app-error-notice app-error-notice-abandon'
    notice.style.backgroundImage = `url("${resolveAssetDefinition('ui.generic-dialog').source.src}")`
    const text = document.createElement('div')
    text.className = 'app-error-notice-message'
    text.textContent = message
    notice.appendChild(text)
    overlay.appendChild(notice)

    let continued = false
    const finish = (): void => {
      if (continued) return
      continued = true
      overlay.remove()
      onContinue()
    }
    overlay.addEventListener('click', finish, { once: true })
    document.body.appendChild(overlay)
  }
}

/** Renderer-lifetime dependencies assembled once by the application root. */
export interface AppServices {
  readonly matchLogs?: MatchLogsApi
  readonly preferences?: PreferencesApi
  readonly ai: AiDecisionApi
  readonly arenaStore: ArenaStore
  readonly deckStore: DeckStore
  readonly playerStatsStore: PlayerStatsStore
  readonly progressionStore: ProgressionStore
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
    preferences:
      overrides.preferences ??
      (typeof window !== 'undefined' ? window.api?.preferences : undefined),
    matchLogs:
      overrides.matchLogs ??
      (typeof window !== 'undefined' ? window.api?.matchLogs : undefined),
    arenaStore: overrides.arenaStore ?? new PersistentArenaStore(),
    deckStore: overrides.deckStore ?? new PersistentDeckStore(undefined, logger),
    playerStatsStore: overrides.playerStatsStore ?? new PersistentPlayerStatsStore(),
    progressionStore: overrides.progressionStore ?? new PersistentProgressionStore(),
    dialogs: overrides.dialogs ?? new BrowserDialogService(),
    logger,
    ...overrides
  }
}
