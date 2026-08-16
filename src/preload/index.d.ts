import type { SceneRequest } from '../shared/sceneNavigation'

interface SceneNavigationAPI {
  onSceneRequest(listener: (request: SceneRequest) => void): () => void
}

declare global {
  interface Window {
    api: SceneNavigationAPI
  }
}

export {}
