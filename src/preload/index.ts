import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { isSceneRequest, SCENE_REQUEST_CHANNEL } from '../shared/scene-navigation'
import type { SceneRequest } from '../shared/scene-navigation'
import {
  DECK_IPC_CHANNELS,
  parseDeckCreateRequest,
  parseDeckId,
  parseDeckListResponse,
  parseDeckResponse,
  type Deck,
  type DeckCreateRequest
} from '../shared/ipc/decks'

const api = {
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
