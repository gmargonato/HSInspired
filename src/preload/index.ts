import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { isSceneRequest, SCENE_REQUEST_CHANNEL } from '../shared/sceneNavigation'
import type { SceneRequest } from '../shared/sceneNavigation'
import { DECK_IPC_CHANNELS, type Deck, type DeckCreateRequest } from '../shared/decks'

const api = {
  /**
   * Listen for requests from the development-only native Scenes menu.
   * Returning an unsubscribe function keeps the bridge safe for hot reloads
   * and renderer teardown.
   */
  onSceneRequest(listener: (request: SceneRequest) => void): () => void {
    const handleSceneRequest = (_event: IpcRendererEvent, request: unknown): void => {
      if (isSceneRequest(request)) {
        console.info('[Scenes menu][preload] received', request)
        listener(request)
      } else {
        console.warn('[Scenes menu][preload] rejected request', request)
      }
    }

    ipcRenderer.on(SCENE_REQUEST_CHANNEL, handleSceneRequest)
    console.info('[Scenes menu][preload] listener registered')
    return () => ipcRenderer.removeListener(SCENE_REQUEST_CHANNEL, handleSceneRequest)
  },

  decks: {
    list: (): Promise<readonly Deck[]> => ipcRenderer.invoke(DECK_IPC_CHANNELS.list),
    create: (request?: DeckCreateRequest): Promise<Deck> =>
      ipcRenderer.invoke(DECK_IPC_CHANNELS.create, request),
    update: (deck: Deck): Promise<Deck> =>
      ipcRenderer.invoke(DECK_IPC_CHANNELS.update, deck),
    delete: (deckId: string): Promise<void> =>
      ipcRenderer.invoke(DECK_IPC_CHANNELS.delete, deckId)
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
