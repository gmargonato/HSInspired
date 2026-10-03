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

  private noticeTimer: ReturnType<typeof setTimeout> | null = null

  /** One non-blocking message; newer messages replace it and restart its lifetime. */
  error(message: string): void {
    if (this.noticeTimer !== null) clearTimeout(this.noticeTimer)
    const existing = document.getElementById('app-error-notice')
    const notice = existing ?? document.createElement('div')
    notice.id = 'app-error-notice'
    notice.setAttribute('role', 'status')
    notice.setAttribute('aria-live', 'polite')
    notice.className = 'app-error-notice'
    notice.style.backgroundImage = `url("${resolveAssetDefinition('ui.generic-dialog').source.src}")`
    notice.textContent = ''
    const text = document.createElement('div')
    text.className = 'app-error-notice-message'
    text.textContent = message
    notice.appendChild(text)
    if (!existing) document.body.appendChild(notice)
    this.noticeTimer = setTimeout(() => {
      notice.remove()
      this.noticeTimer = null
    }, 3000)
  }

  abandon(message: string, onContinue: () => void): void {
    this.error(message)
    // Match recovery must still finish if another message replaces this one.
    setTimeout(onContinue, 3000)
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
