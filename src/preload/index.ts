import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
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
  parseAiDecisionRequest,
  parseAiDecisionResponse,
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

const api = {
  ai: {
    decide: async (request: AiDecisionRequest): Promise<AiDecisionResponse> =>
      parseAiDecisionResponse(
        await ipcRenderer.invoke(
          AI_IPC_CHANNELS.decide,
          parseAiDecisionRequest(request)
        )
      )
  },

  /**
   * Listen for requests from the development-only native Scenes menu.
   * Returning an unsubscribe function keeps the bridge safe for hot reloads
   * and renderer teardown.
   */
  onSceneRequest(listener: (request: SceneRequest) => void): () => void {
    const trace = (...details: readonly unknown[]): void => {
      if (process.env.NODE_ENV !== 'production') {
        console.info('[Scenes menu][preload]', ...details)
      }
    }
    const handleSceneRequest = (_event: IpcRendererEvent, request: unknown): void => {
      if (isSceneRequest(request)) {
        trace('received', request)
        listener(request)
      } else {
        trace('rejected request', request)
      }
    }

    ipcRenderer.on(SCENE_REQUEST_CHANNEL, handleSceneRequest)
    trace('listener registered')
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
