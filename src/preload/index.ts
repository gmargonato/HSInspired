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
  DEV_COMMAND_CHANNEL,
  DEV_DECK_SYNC_CHANNEL,
  DEV_SCENE_CHANGED_CHANNEL,
  isCollectibleMode,
  isDevCommand,
  isDevDeckSyncPayload,
  isDevSceneId,
  type CollectibleMode,
  type DevCommand,
  type DevDeckEntry,
  type DevSceneId
} from '../shared/dev-menu'
import {
  AI_IPC_CHANNELS,
  parseAiDeckPlanRequest,
  parseAiDeckPlanResponse,
  parseAiDecisionRequest,
  parseAiDecisionResponse,
  unwrapAiIpcResult,
  type AiDeckPlanRequest,
  type AiDeckPlanResponse,
  type AiDecisionRequest,
  type AiDecisionResponse
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
  PLAYER_STATS_IPC_CHANNELS,
  parsePlayableClassId,
  parsePlayerStatsSnapshot,
  type PlayerStatsApi,
  type PlayerStatsSnapshot
} from '../shared/ipc/player-stats'
import {
  ARENA_IPC_CHANNELS,
  parseArenaCardId,
  parseArenaHeroId,
  parseArenaMatchResult,
  parseArenaRunSnapshot,
  type ArenaApi,
  type ArenaRunSnapshot
} from '../shared/ipc/arena'
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
    retire: async (): Promise<ArenaRunSnapshot> =>
      parseArenaRunSnapshot(await ipcRenderer.invoke(ARENA_IPC_CHANNELS.retire)),
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
    planDeck: async (request: AiDeckPlanRequest): Promise<AiDeckPlanResponse> =>
      unwrapAiIpcResult(
        await ipcRenderer.invoke(
          AI_IPC_CHANNELS.planDeck,
          parseAiDeckPlanRequest(request)
        ),
        parseAiDeckPlanResponse
      ),
    decide: async (request: AiDecisionRequest): Promise<AiDecisionResponse> =>
      unwrapAiIpcResult(
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
    syncDecks(entries: readonly DevDeckEntry[]): void {
      if (process.env.NODE_ENV !== 'production' && !isDevDeckSyncPayload(entries)) {
        console.warn('[DevMenu][preload] rejected deck sync payload', entries)
        return
      }
      ipcRenderer.send(DEV_DECK_SYNC_CHANNEL, entries)
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
