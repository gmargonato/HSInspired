import type { SceneRequest } from '../shared/scene-navigation'
import type { AiDecisionBridge } from '../shared/ipc/ai'
import type { MatchLogsApi } from '../shared/ipc/match-logs'
import type { DecksApi } from '../shared/ipc/decks'
import type { WindowSettingsApi } from '../shared/ipc/window-settings'
import type { PlayerStatsApi } from '../shared/ipc/player-stats'
import type { ArenaApi } from '../shared/ipc/arena'
import type { CardClassBuilderApi } from '../shared/ipc/card-class-builder'
import type { OutlineTuningApi } from '../shared/ipc/outline-tuning'

interface AppAPI {
  matchLogs: MatchLogsApi
  cardClassBuilder?: CardClassBuilderApi
  outlineTuning?: OutlineTuningApi
  arena: ArenaApi
  onSceneRequest(listener: (request: SceneRequest) => void): () => void
  ai: AiDecisionBridge
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
