/**
 * Development-only menu contracts.
 *
 * Keep this free of renderer/main implementations so both processes can
 * safely import it. The deck list for the Match submenu is renderer-owned
 * (the renderer already caches decks via DeckStore) and is pushed to the
 * main process for menu rendering.
 */

export const DEV_DECK_SYNC_CHANNEL = 'debug:dev-decks-sync'
export const DEV_SCENE_CHANGED_CHANNEL = 'debug:scene-changed'
export const DEV_COMMAND_CHANNEL = 'debug:dev-command'
export const DEV_COLLECTIBLE_SYNC_CHANNEL = 'debug:collectible-sync'

export type DevSceneId =
  | 'main-menu'
  | 'deck-selection'
  | 'collection'
  | 'new-deck'
  | 'game'
  | 'settings'
  | 'card-preview'
  | 'unknown'

export interface DevDeckEntry {
  readonly id: string
  readonly heroId: string
  readonly classId: string
}

export type CollectibleMode = 'all' | 'collectible' | 'uncollectible'

export type DevCommand =
  | { readonly type: 'collection:set-collectible'; readonly mode: CollectibleMode }
  | { readonly type: 'game:toggle-tracker' }
  | { readonly type: 'game:open-add-card-picker' }
  | { readonly type: 'game:add-card'; readonly cardId: string }
  | {
      readonly type: 'game:set-mana'
      readonly available: number
      readonly maximum: number
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isDevDeckEntry(value: unknown): value is DevDeckEntry {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.heroId === 'string' &&
    value.heroId.length > 0 &&
    typeof value.classId === 'string' &&
    value.classId.length > 0
  )
}

export function isDevDeckSyncPayload(value: unknown): value is readonly DevDeckEntry[] {
  if (!Array.isArray(value)) return false
  return value.every(isDevDeckEntry)
}

export function isDevSceneId(value: unknown): value is DevSceneId {
  return (
    typeof value === 'string' &&
    [
      'main-menu',
      'deck-selection',
      'collection',
      'new-deck',
      'game',
      'settings',
      'card-preview',
      'unknown'
    ].includes(value)
  )
}

export function isCollectibleMode(value: unknown): value is CollectibleMode {
  return value === 'all' || value === 'collectible' || value === 'uncollectible'
}

export function isDevCommand(value: unknown): value is DevCommand {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (value.type === 'collection:set-collectible') {
    const mode = (value as { mode?: unknown }).mode
    return isCollectibleMode(mode)
  }
  if (value.type === 'game:toggle-tracker') return true
  if (value.type === 'game:open-add-card-picker') return true
  if (value.type === 'game:add-card') {
    const cardId = (value as { cardId?: unknown }).cardId
    return typeof cardId === 'string' && cardId.length > 0
  }
  if (value.type === 'game:set-mana') {
    const available = (value as { available?: unknown }).available
    const maximum = (value as { maximum?: unknown }).maximum
    return (
      typeof available === 'number' &&
      Number.isInteger(available) &&
      available >= 0 &&
      available <= 10 &&
      typeof maximum === 'number' &&
      Number.isInteger(maximum) &&
      maximum >= 0 &&
      maximum <= 10
    )
  }
  return false
}
