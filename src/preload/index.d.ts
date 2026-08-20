import type { SceneRequest } from '../shared/sceneNavigation'
import type { DecksApi } from '../shared/ipc/decks'

interface SceneNavigationAPI {
  onSceneRequest(listener: (request: SceneRequest) => void): () => void
  decks: DecksApi
}

declare global {
  interface Window {
    api: SceneNavigationAPI
  }
}

export {}
