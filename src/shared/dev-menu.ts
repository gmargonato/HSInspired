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
  | 'arena'
  | 'new-deck'
  | 'tavern-brawl'
  | 'outline-lab'
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
export type DevMatchTarget = 'local' | 'remote'
export type DevCardPickerAction = 'add-to-hand' | 'summon'
export type DevDeckAction = 'destroy' | 'refill'
export type DevZone = 'hand' | 'board'
export type DevHeroPowerAction = 'reset' | 'consume'
export type DevDeckTrackerVisibility = 'hidden' | 'local'
export type DevDeckTrackerSortMode = 'cost' | 'alphabetical' | 'draw-order'

export type DevCommand =
  | { readonly type: 'collection:set-collectible'; readonly mode: CollectibleMode }
  | { readonly type: 'game:toggle-tracker' }
  | {
      readonly type: 'game:set-deck-tracker'
      readonly visibility: DevDeckTrackerVisibility
      readonly sortMode: DevDeckTrackerSortMode
    }
  | { readonly type: 'game:draw'; readonly target: DevMatchTarget }
  | {
      readonly type: 'game:clear-zone'
      readonly target: DevMatchTarget
      readonly zone: DevZone
    }
  | {
      readonly type: 'game:set-fatigue'
      readonly target: DevMatchTarget
      readonly nextDamage: number
    }
  | {
      readonly type: 'game:set-hero'
      readonly target: DevMatchTarget
      readonly health?: number
      readonly armor?: number
      readonly attack?: number
    }
  | {
      readonly type: 'game:set-hero-power'
      readonly target: DevMatchTarget
      readonly cost?: number
      readonly action?: DevHeroPowerAction
    }
  | { readonly type: 'game:remove-weapon'; readonly target: DevMatchTarget }
  | {
      readonly type: 'game:open-card-picker'
      readonly target: DevMatchTarget
      readonly action: DevCardPickerAction
    }
  | {
      readonly type: 'game:modify-deck'
      readonly target: DevMatchTarget
      readonly action: DevDeckAction
    }
  | { readonly type: 'game:end-match'; readonly outcome: 'win' | 'lose' }
  | {
      readonly type: 'game:set-mana'
      readonly target: DevMatchTarget
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
      'arena',
      'new-deck',
      'tavern-brawl',
      'outline-lab',
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

function isDevMatchTarget(value: unknown): value is DevMatchTarget {
  return value === 'local' || value === 'remote'
}

function isDevCardPickerAction(value: unknown): value is DevCardPickerAction {
  return value === 'add-to-hand' || value === 'summon'
}

function isDevDeckAction(value: unknown): value is DevDeckAction {
  return value === 'destroy' || value === 'refill'
}

export function isDevCommand(value: unknown): value is DevCommand {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (value.type === 'collection:set-collectible') {
    const mode = (value as { mode?: unknown }).mode
    return isCollectibleMode(mode)
  }
  if (value.type === 'game:toggle-tracker') return true
  if (value.type === 'game:set-deck-tracker') {
    const command = value as { visibility?: unknown; sortMode?: unknown }
    return (
      (command.visibility === 'hidden' || command.visibility === 'local') &&
      (command.sortMode === 'cost' ||
        command.sortMode === 'alphabetical' ||
        command.sortMode === 'draw-order')
    )
  }
  if (value.type === 'game:open-card-picker') {
    return (
      isDevMatchTarget((value as { target?: unknown }).target) &&
      isDevCardPickerAction((value as { action?: unknown }).action)
    )
  }
  if (value.type === 'game:modify-deck') {
    return (
      isDevMatchTarget((value as { target?: unknown }).target) &&
      isDevDeckAction((value as { action?: unknown }).action)
    )
  }
  if (value.type === 'game:end-match') {
    const outcome = (value as { outcome?: unknown }).outcome
    return outcome === 'win' || outcome === 'lose'
  }
  if (value.type === 'game:set-mana') {
    const available = (value as { available?: unknown }).available
    const maximum = (value as { maximum?: unknown }).maximum
    return (
      isDevMatchTarget((value as { target?: unknown }).target) &&
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
  if (value.type === 'game:draw' || value.type === 'game:remove-weapon')
    return isDevMatchTarget((value as { target?: unknown }).target)
  if (value.type === 'game:clear-zone')
    return (
      isDevMatchTarget((value as { target?: unknown }).target) &&
      ((value as { zone?: unknown }).zone === 'hand' ||
        (value as { zone?: unknown }).zone === 'board')
    )
  if (value.type === 'game:set-fatigue')
    return (
      isDevMatchTarget((value as { target?: unknown }).target) &&
      Number.isInteger((value as { nextDamage?: unknown }).nextDamage) &&
      (value as { nextDamage: number }).nextDamage >= 1
    )
  if (value.type === 'game:set-hero') {
    if (!isDevMatchTarget((value as { target?: unknown }).target)) return false
    const command = value as { health?: unknown; armor?: unknown; attack?: unknown }
    return [command.health, command.armor, command.attack].some(
      (entry) => Number.isInteger(entry) && (entry as number) >= 0
    )
  }
  if (value.type === 'game:set-hero-power') {
    if (!isDevMatchTarget((value as { target?: unknown }).target)) return false
    const command = value as { cost?: unknown; action?: unknown }
    return (
      (Number.isInteger(command.cost) && (command.cost as number) >= 0) ||
      command.action === 'reset' ||
      command.action === 'consume'
    )
  }
  return false
}
