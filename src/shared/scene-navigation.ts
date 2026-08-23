/**
 * IPC channel used by the development-only native Scenes menu.
 *
 * Keep this contract free of renderer classes: the main process and preload
 * can safely import it, while the renderer resolves each id to a Scene.
 */
export const SCENE_REQUEST_CHANNEL = 'debug:scene-request'

/**
 * Parameters accepted by each scene request. Adding a parameterized scene
 * here makes the request type require its data everywhere it is constructed.
 * For example: `game: { deckId: string }`.
 *
 * `game` supports both auto selection (no params) and explicit deck selection
 * via `deckId` - the native menu sends one or the other depending on whether
 * the user picked a specific deck. Keep the union so both forms validate.
 */
export interface SceneParamsById {
  'main-menu': undefined
  'deck-selection': undefined
  collection: undefined
  'new-deck': undefined
  game: { deckId: string } | undefined
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
  'new-deck': { label: 'New Deck', request: { id: 'new-deck' } },
  game: { label: 'Match (First Complete Deck)', request: { id: 'game' } }
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
    const params = request.params as { deckId?: unknown }
    if (typeof params.deckId !== 'string' || params.deckId.length === 0) return false
  }

  return true
}
