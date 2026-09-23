/**
 * IPC channel used by the development-only native Scenes menu.
 *
 * Keep this contract free of renderer classes: the main process and preload
 * can safely import it, while the renderer resolves each id to a Scene.
 */
export const SCENE_REQUEST_CHANNEL = 'debug:scene-request'

export type DevMatchLaunchMode = 'first-player' | 'second-player' | 'skip-mulligan'

type DevMatchMenuCatalog = {
  readonly [Mode in DevMatchLaunchMode]: {
    readonly label: string
    readonly request: {
      readonly id: 'game'
      readonly params: { readonly launchMode: Mode }
    }
  }
}

export const DEV_MATCH_MENU_ENTRIES = {
  'first-player': {
    label: 'Start as First player',
    request: { id: 'game', params: { launchMode: 'first-player' } }
  },
  'second-player': {
    label: 'Start as Second player',
    request: { id: 'game', params: { launchMode: 'second-player' } }
  },
  'skip-mulligan': {
    label: 'Skip mulligan',
    request: { id: 'game', params: { launchMode: 'skip-mulligan' } }
  }
} as const satisfies DevMatchMenuCatalog

/**
 * Parameters accepted by each scene request. Adding a parameterized scene
 * here makes the request type require its data everywhere it is constructed.
 * The development Match request can carry a deck override and launch mode.
 *
 * `game` supports auto selection (no params) and optional deck or launch-mode
 * overrides for development tooling.
 */
export interface SceneParamsById {
  'main-menu': undefined
  'deck-selection': undefined
  collection: undefined
  arena: undefined
  'new-deck': undefined
  'tavern-brawl': undefined
  'card-inspector': undefined
  'outline-lab': undefined
  'hero-power-anim': undefined
  game: { deckId?: string; launchMode?: DevMatchLaunchMode } | undefined
}

export type SceneId = keyof SceneParamsById

type SceneRequestFor<Id extends SceneId> = [SceneParamsById[Id]] extends [undefined]
  ? { id: Id }
  : [undefined] extends [SceneParamsById[Id]]
    ? { id: Id } | { id: Id; params: NonNullable<SceneParamsById[Id]> }
    : { id: Id; params: SceneParamsById[Id] }

export type SceneRequest = {
  [Id in SceneId]: SceneRequestFor<Id>
}[SceneId]

/**
 * Single source of truth for the developer Scenes menu.
 *
 * The Electron main process turns these entries into native menu items. The
 * renderer's SceneNavigator uses the same request ids to construct scenes.
 * Add a new scene's parameter type and catalog entry here; the exhaustive
 * renderer factory will then require the corresponding constructor hook at
 * compile time.
 */
type SceneMenuCatalog = {
  readonly [Id in SceneId]: {
    readonly label: string
    readonly request: SceneRequestFor<Id>
  }
}

export const SCENE_MENU_ENTRIES = {
  'main-menu': { label: 'Main Menu', request: { id: 'main-menu' } },
  'deck-selection': {
    label: 'Deck Selection',
    request: { id: 'deck-selection' }
  },
  collection: { label: 'Collection', request: { id: 'collection' } },
  arena: { label: 'Arena', request: { id: 'arena' } },
  'new-deck': { label: 'New Deck', request: { id: 'new-deck' } },
  'tavern-brawl': {
    label: 'Tavern Brawl',
    request: { id: 'tavern-brawl' }
  },
  'card-inspector': {
    label: 'Card Lab',
    request: { id: 'card-inspector' }
  },
  'outline-lab': { label: 'Shader Lab', request: { id: 'outline-lab' } },
  'hero-power-anim': { label: 'Hero Power Anim', request: { id: 'hero-power-anim' } },
  game: { label: 'Match', request: { id: 'game' } }
} as const satisfies SceneMenuCatalog

const knownSceneIds = new Set<string>(
  Object.values(SCENE_MENU_ENTRIES).map((entry) => entry.request.id)
)

/** Runtime validation for data received across the IPC boundary. */
export function isSceneRequest(value: unknown): value is SceneRequest {
  if (typeof value !== 'object' || value === null) return false

  const request = value as { id?: unknown; params?: unknown }
  if (typeof request.id !== 'string' || !knownSceneIds.has(request.id)) return false

  if (request.id === 'game' && request.params !== undefined) {
    if (typeof request.params !== 'object' || request.params === null) return false
    const params = request.params as { deckId?: unknown; launchMode?: unknown }
    if (
      params.deckId !== undefined &&
      (typeof params.deckId !== 'string' || params.deckId.length === 0)
    )
      return false
    if (
      params.launchMode !== undefined &&
      params.launchMode !== 'first-player' &&
      params.launchMode !== 'second-player' &&
      params.launchMode !== 'skip-mulligan'
    )
      return false
  }

  return true
}
