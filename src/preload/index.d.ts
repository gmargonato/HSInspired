import type { SceneRequest } from '../shared/scene-navigation'
import type { AiDecisionApi } from '../shared/ipc/ai'
import type { DecksApi } from '../shared/ipc/decks'
import type { WindowSettingsApi } from '../shared/ipc/window-settings'
import type { PlayerStatsApi } from '../shared/ipc/player-stats'
import type { ArenaApi } from '../shared/ipc/arena'

interface AppAPI {
  arena: ArenaApi
  onSceneRequest(listener: (request: SceneRequest) => void): () => void
  ai: AiDecisionApi
  decks: DecksApi
  playerStats: PlayerStatsApi
  windowSettings: WindowSettingsApi
}

declare global {
  interface Window {
    api: AppAPI
  }
}

export {}
