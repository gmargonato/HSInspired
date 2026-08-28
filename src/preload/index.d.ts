import type { SceneRequest } from '../shared/scene-navigation'
import type { DecksApi } from '../shared/ipc/decks'
import type { WindowSettingsApi } from '../shared/ipc/window-settings'

interface AppAPI {
  onSceneRequest(listener: (request: SceneRequest) => void): () => void
  decks: DecksApi
  windowSettings: WindowSettingsApi
}

declare global {
  interface Window {
    api: AppAPI
  }
}

export {}
