import type { SceneRequest } from '../shared/scene-navigation'
import type {
  DevArenaAvailability,
  PremiumMode,
  DevCommand,
  DevSceneId,
  CollectibleMode
} from '../shared/dev-menu'
import type { AiDecisionBridge } from '../shared/ipc/ai'
import type { MatchLogsApi } from '../shared/ipc/match-logs'
import type { DecksApi } from '../shared/ipc/decks'
import type { WindowSettingsApi } from '../shared/ipc/window-settings'
import type { PlayerStatsApi } from '../shared/ipc/player-stats'
import type { ProgressionApi } from '../shared/ipc/progression'
import type { ArenaApi } from '../shared/ipc/arena'
import type { CardClassBuilderApi } from '../shared/ipc/card-class-builder'
import type { OutlineTuningApi } from '../shared/ipc/outline-tuning'

interface AppAPI {
  devMenu: {
    notifyArenaAvailability(availability: DevArenaAvailability): void
    notifyPremiumMode(mode: PremiumMode): void
    notifySceneChanged(sceneId: DevSceneId): void
    notifyCollectibleMode(mode: CollectibleMode): void
    onDevCommand(listener: (command: DevCommand) => void): () => void
  }
  matchLogs: MatchLogsApi
  cardClassBuilder?: CardClassBuilderApi
  outlineTuning?: OutlineTuningApi
  arena: ArenaApi
  onSceneRequest(listener: (request: SceneRequest) => void): () => void
  ai: AiDecisionBridge
  decks: DecksApi
  playerStats: PlayerStatsApi
  progression: ProgressionApi
  windowSettings: WindowSettingsApi
}

declare global {
  interface Window {
    api: AppAPI
  }
}

export {}
