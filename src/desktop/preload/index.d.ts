import type { SceneRequest } from '../contracts/scene-navigation'
import type {
  DevArenaAvailability,
  PremiumMode,
  DevCommand,
  DevSceneId,
  CollectibleMode
} from '../contracts/dev-menu'
import type { AiDecisionBridge } from '../contracts/ipc/ai'
import type { MatchLogsApi } from '../contracts/ipc/match-logs'
import type { DecksApi } from '../contracts/ipc/decks'
import type { WindowSettingsApi } from '../contracts/ipc/window-settings'
import type { PreferencesApi } from '../contracts/ipc/preferences'
import type { PlayerStatsApi } from '../contracts/ipc/player-stats'
import type { ProgressionApi } from '../contracts/ipc/progression'
import type { ArenaApi } from '../contracts/ipc/arena'
import type { CardClassBuilderApi } from '../contracts/ipc/card-class-builder'
import type { OutlineTuningApi } from '../contracts/ipc/outline-tuning'

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
  preferences: PreferencesApi
}

declare global {
  interface Window {
    api: AppAPI
  }
}

export {}
