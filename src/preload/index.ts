import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  MATCH_LOG_CHANNELS,
  parseMatchLogId,
  parseMatchLogObject,
  parseMatchLogRecord,
  parseMatchLogStatus,
  type MatchLogsApi
} from '../shared/ipc/match-logs'
import { isSceneRequest, SCENE_REQUEST_CHANNEL } from '../shared/scene-navigation'
import type { SceneRequest } from '../shared/scene-navigation'
import {
  DEV_COLLECTIBLE_SYNC_CHANNEL,
  DEV_PREMIUM_SYNC_CHANNEL,
  DEV_ARENA_SYNC_CHANNEL,
  isDevArenaAvailability,
  isPremiumMode,
  type PremiumMode,
  type DevArenaAvailability,
  DEV_COMMAND_CHANNEL,
  DEV_SCENE_CHANGED_CHANNEL,
  isCollectibleMode,
  isDevCommand,
  isDevSceneId,
  type CollectibleMode,
  type DevCommand,
  type DevSceneId
} from '../shared/dev-menu'
import {
  AI_IPC_CHANNELS,
  parseAiIdentity,
  parseAiRequestProgress,
  type AiRequestProgress,
  parseAiSettings,
  type AiDecisionIdentity,
  parseAiDecisionRequest,
  parseAiDecisionResponse,
  parseAiIpcResult,
  unwrapAiIpcResult,
  type AiDecisionRequest,
  type AiDecisionResponse,
  type AiIpcResult
} from '../shared/ipc/ai'
import {
  DECK_IPC_CHANNELS,
  parseDeckCreateRequest,
  parseDeckId,
  parseDeckListResponse,
  parseDeckResponse,
  type Deck,
  type DeckCreateRequest
} from '../shared/ipc/decks'
import {
  WINDOW_SETTINGS_IPC_CHANNELS,
  parseWindowResolution,
  parseWindowResolutionSettings,
  type WindowResolution,
  type WindowResolutionSettings
} from '../shared/ipc/window-settings'
import {
  PREFERENCES_IPC_CHANNELS,
  parsePreferences,
  parsePreferencesUpdateRequest,
  type Preferences,
  type PreferencesUpdateRequest
} from '../shared/ipc/preferences'
import {
  PLAYER_STATS_IPC_CHANNELS,
  parseConstructedRankResultRequest,
  parseConstructedRankSnapshot,
  parsePlayableClassId,
  parsePlayerStatsSnapshot,
  type ConstructedRankResultRequest,
  type ConstructedRankSnapshot,
  type PlayerStatsApi,
  type PlayerStatsSnapshot
} from '../shared/ipc/player-stats'
import {
  PROGRESSION_IPC_CHANNELS,
  parseDustAmount,
  parseDustRewardRequest,
  parseDustRewardReceipt,
  parseProgressionCardId,
  parseProgressionSnapshot,
  type ProgressionApi
} from '../shared/ipc/progression'
import {
  ARENA_IPC_CHANNELS,
  parseArenaCardId,
  parseArenaHeroId,
  parseArenaMatchResult,
  parseArenaRunSnapshot,
  parseArenaScoreRequest,
  type ArenaScoreRequest,
  type ArenaApi,
  type ArenaRunSnapshot
} from '../shared/ipc/arena'
import { parseArenaRunId } from '../shared/ipc/arena-rewards'
import {
  CARD_CLASS_BUILDER_IPC_CHANNELS,
  parseCardClassBuilderConfig,
  type CardClassBuilderConfig
} from '../shared/ipc/card-class-builder'
import {
  OUTLINE_TUNING_IPC_CHANNELS,
  parseOutlineTuningConfig,
  type OutlineTuningConfig
} from '../shared/ipc/outline-tuning'

const api = {
  matchLogs: {
    start: async (metadata) =>
      parseMatchLogId(
        await ipcRenderer.invoke(
          MATCH_LOG_CHANNELS.start,
          parseMatchLogObject(metadata)
        )
      ),
    append: async (id, record) => {
      await ipcRenderer.invoke(
        MATCH_LOG_CHANNELS.append,
        parseMatchLogId(id),
        parseMatchLogRecord(record)
      )
    },
    finish: async (id, status) => {
      await ipcRenderer.invoke(
        MATCH_LOG_CHANNELS.finish,
        parseMatchLogId(id),
        parseMatchLogStatus(status)
      )
    }
  } satisfies MatchLogsApi,
  ...(process.env.NODE_ENV === 'development'
    ? {
        cardClassBuilder: {
          save: async (config: CardClassBuilderConfig): Promise<void> => {
            await ipcRenderer.invoke(
              CARD_CLASS_BUILDER_IPC_CHANNELS.save,
              parseCardClassBuilderConfig(config)
            )
          }
        },
        outlineTuning: {
          save: async (config: OutlineTuningConfig): Promise<void> => {
            await ipcRenderer.invoke(
              OUTLINE_TUNING_IPC_CHANNELS.save,
              parseOutlineTuningConfig(config)
            )
          }
        }
      }
    : {}),
  arena: {
    ...(process.env.NODE_ENV === 'development'
      ? {
          devSetScore: async (request: ArenaScoreRequest): Promise<ArenaRunSnapshot> =>
            parseArenaRunSnapshot(
              await ipcRenderer.invoke(
                ARENA_IPC_CHANNELS.devSetScore,
                parseArenaScoreRequest(request)
              )
            )
        }
      : {}),
    get: async (): Promise<ArenaRunSnapshot> =>
      parseArenaRunSnapshot(await ipcRenderer.invoke(ARENA_IPC_CHANNELS.get)),
    selectHero: async (
      heroId: Parameters<ArenaApi['selectHero']>[0]
    ): Promise<ArenaRunSnapshot> =>
      parseArenaRunSnapshot(
        await ipcRenderer.invoke(
          ARENA_IPC_CHANNELS.selectHero,
          parseArenaHeroId(heroId)
        )
      ),
    pickCard: async (
      cardId: Parameters<ArenaApi['pickCard']>[0]
    ): Promise<ArenaRunSnapshot> =>
      parseArenaRunSnapshot(
        await ipcRenderer.invoke(ARENA_IPC_CHANNELS.pickCard, parseArenaCardId(cardId))
      ),
    retire: async (runId: string): Promise<ArenaRunSnapshot> =>
      parseArenaRunSnapshot(
        await ipcRenderer.invoke(ARENA_IPC_CHANNELS.retire, parseArenaRunId(runId))
      ),
    acknowledgeRewards: async (runId: string): Promise<ArenaRunSnapshot> =>
      parseArenaRunSnapshot(
        await ipcRenderer.invoke(
          ARENA_IPC_CHANNELS.acknowledgeRewards,
          parseArenaRunId(runId)
        )
      ),
    recordResult: async (
      result: Parameters<ArenaApi['recordResult']>[0]
    ): Promise<ArenaRunSnapshot> =>
      parseArenaRunSnapshot(
        await ipcRenderer.invoke(
          ARENA_IPC_CHANNELS.recordResult,
          parseArenaMatchResult(result)
        )
      )
  },

  ai: {
    onProgress(listener: (progress: AiRequestProgress) => void): () => void {
      const handle = (_event: IpcRendererEvent, value: unknown): void => {
        listener(parseAiRequestProgress(value))
      }
      ipcRenderer.on(AI_IPC_CHANNELS.progress, handle)
      return () => ipcRenderer.removeListener(AI_IPC_CHANNELS.progress, handle)
    },
    settings: async () =>
      unwrapAiIpcResult(
        await ipcRenderer.invoke(AI_IPC_CHANNELS.settings),
        parseAiSettings
      ),
    cancel: async (identity: AiDecisionIdentity): Promise<void> => {
      await ipcRenderer.invoke(AI_IPC_CHANNELS.cancel, parseAiIdentity(identity))
    },
    decide: async (
      request: AiDecisionRequest
    ): Promise<AiIpcResult<AiDecisionResponse>> =>
      parseAiIpcResult(
        await ipcRenderer.invoke(
          AI_IPC_CHANNELS.decide,
          parseAiDecisionRequest(request)
        ),
        parseAiDecisionResponse
      )
  },

  /**
   * Listen for requests from the development-only native Scenes menu.
   * Returning an unsubscribe function keeps the bridge safe for hot reloads
   * and renderer teardown.
   */
  onSceneRequest(listener: (request: SceneRequest) => void): () => void {
    const handleSceneRequest = (_event: IpcRendererEvent, request: unknown): void => {
      if (isSceneRequest(request)) {
        listener(request)
      }
    }

    ipcRenderer.on(SCENE_REQUEST_CHANNEL, handleSceneRequest)
    return () => ipcRenderer.removeListener(SCENE_REQUEST_CHANNEL, handleSceneRequest)
  },

  devMenu: {
    notifyArenaAvailability(availability: DevArenaAvailability): void {
      if (!isDevArenaAvailability(availability)) return
      ipcRenderer.send(DEV_ARENA_SYNC_CHANNEL, availability)
    },
    notifyPremiumMode(mode: PremiumMode): void {
      if (!isPremiumMode(mode)) return
      ipcRenderer.send(DEV_PREMIUM_SYNC_CHANNEL, mode)
    },
    notifySceneChanged(sceneId: DevSceneId): void {
      if (process.env.NODE_ENV !== 'production' && !isDevSceneId(sceneId)) {
        console.warn('[DevMenu][preload] rejected scene id', sceneId)
        return
      }
      ipcRenderer.send(DEV_SCENE_CHANGED_CHANNEL, sceneId)
    },
    onDevCommand(listener: (command: DevCommand) => void): () => void {
      const handleDevCommand = (_event: IpcRendererEvent, command: unknown): void => {
        if (isDevCommand(command)) {
          listener(command)
        } else if (process.env.NODE_ENV !== 'production') {
          console.warn('[DevMenu][preload] rejected dev command', command)
        }
      }
      ipcRenderer.on(DEV_COMMAND_CHANNEL, handleDevCommand)
      return () => ipcRenderer.removeListener(DEV_COMMAND_CHANNEL, handleDevCommand)
    },
    notifyCollectibleMode(mode: CollectibleMode): void {
      if (process.env.NODE_ENV !== 'production' && !isCollectibleMode(mode)) {
        console.warn('[DevMenu][preload] rejected collectible mode', mode)
        return
      }
      ipcRenderer.send(DEV_COLLECTIBLE_SYNC_CHANNEL, mode)
    }
  },

  decks: {
    list: async (): Promise<readonly Deck[]> =>
      parseDeckListResponse(await ipcRenderer.invoke(DECK_IPC_CHANNELS.list)),
    create: async (request?: DeckCreateRequest): Promise<Deck> =>
      parseDeckResponse(
        await ipcRenderer.invoke(
          DECK_IPC_CHANNELS.create,
          parseDeckCreateRequest(request)
        )
      ),
    update: async (deck: Deck): Promise<Deck> =>
      parseDeckResponse(await ipcRenderer.invoke(DECK_IPC_CHANNELS.update, deck)),
    delete: async (deckId: string): Promise<void> => {
      await ipcRenderer.invoke(DECK_IPC_CHANNELS.delete, parseDeckId(deckId))
    }
  },

  progression: {
    ...(process.env.NODE_ENV !== 'production'
      ? {
          devSetDust: async (amount: number) =>
            parseProgressionSnapshot(
              await ipcRenderer.invoke(
                PROGRESSION_IPC_CHANNELS.devSetDust,
                parseDustAmount(amount)
              )
            )
        }
      : {}),
    get: async () =>
      parseProgressionSnapshot(await ipcRenderer.invoke(PROGRESSION_IPC_CHANNELS.get)),
    reward: async (request) =>
      parseDustRewardReceipt(
        await ipcRenderer.invoke(
          PROGRESSION_IPC_CHANNELS.reward,
          parseDustRewardRequest(request)
        )
      ),
    upgrade: async (cardId) =>
      parseProgressionSnapshot(
        await ipcRenderer.invoke(
          PROGRESSION_IPC_CHANNELS.upgrade,
          parseProgressionCardId(cardId)
        )
      ),
    refund: async (cardId) =>
      parseProgressionSnapshot(
        await ipcRenderer.invoke(
          PROGRESSION_IPC_CHANNELS.refund,
          parseProgressionCardId(cardId)
        )
      )
  } satisfies ProgressionApi,

  playerStats: {
    get: async (): Promise<PlayerStatsSnapshot> =>
      parsePlayerStatsSnapshot(await ipcRenderer.invoke(PLAYER_STATS_IPC_CHANNELS.get)),
    recordWin: async (
      classId: Parameters<PlayerStatsApi['recordWin']>[0]
    ): Promise<PlayerStatsSnapshot> =>
      parsePlayerStatsSnapshot(
        await ipcRenderer.invoke(
          PLAYER_STATS_IPC_CHANNELS.recordWin,
          parsePlayableClassId(classId)
        )
      ),
    recordTavernBrawlWin: async (): Promise<PlayerStatsSnapshot> =>
      parsePlayerStatsSnapshot(
        await ipcRenderer.invoke(PLAYER_STATS_IPC_CHANNELS.recordTavernBrawlWin)
      ),
    recordConstructedResult: async (
      request: ConstructedRankResultRequest
    ): Promise<PlayerStatsSnapshot> =>
      parsePlayerStatsSnapshot(
        await ipcRenderer.invoke(
          PLAYER_STATS_IPC_CHANNELS.recordConstructedResult,
          parseConstructedRankResultRequest(request)
        )
      ),
    devSetRank: async (rank: ConstructedRankSnapshot): Promise<PlayerStatsSnapshot> =>
      parsePlayerStatsSnapshot(
        await ipcRenderer.invoke(
          PLAYER_STATS_IPC_CHANNELS.devSetRank,
          parseConstructedRankSnapshot(rank)
        )
      )
  },

  windowSettings: {
    get: async (): Promise<WindowResolutionSettings> =>
      parseWindowResolutionSettings(
        await ipcRenderer.invoke(WINDOW_SETTINGS_IPC_CHANNELS.get)
      ),
    setResolution: async (
      resolution: WindowResolution
    ): Promise<WindowResolutionSettings> =>
      parseWindowResolutionSettings(
        await ipcRenderer.invoke(
          WINDOW_SETTINGS_IPC_CHANNELS.setResolution,
          parseWindowResolution(resolution)
        )
      )
  },

  preferences: {
    get: async (): Promise<Preferences> =>
      parsePreferences(await ipcRenderer.invoke(PREFERENCES_IPC_CHANNELS.get)),
    set: async (request: PreferencesUpdateRequest): Promise<Preferences> =>
      parsePreferences(
        await ipcRenderer.invoke(
          PREFERENCES_IPC_CHANNELS.set,
          parsePreferencesUpdateRequest(request)
        )
      )
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('Failed to expose the application API:', error)
  }
} else {
  Object.assign(window, { api })
}
