/**
 * Development-only menu contracts.
 *
 * Keep this free of renderer/main implementations so both processes can
 * safely import it.
 */

export const DEV_SCENE_CHANGED_CHANNEL = 'debug:scene-changed'
export const DEV_COMMAND_CHANNEL = 'debug:dev-command'
export const DEV_COLLECTIBLE_SYNC_CHANNEL = 'debug:collectible-sync'
export const DEV_PREMIUM_SYNC_CHANNEL = 'debug:premium-sync'
export const DEV_ARENA_SYNC_CHANNEL = 'debug:arena-sync'

export type PremiumMode = 'unlocked' | 'all' | 'local' | 'remote'
export interface DevArenaAvailability {
  readonly retire: boolean
  readonly scores: boolean
}

export function isPremiumMode(value: unknown): value is PremiumMode {
  return (
    value === 'unlocked' || value === 'all' || value === 'local' || value === 'remote'
  )
}

export function isDevArenaAvailability(value: unknown): value is DevArenaAvailability {
  return (
    isRecord(value) &&
    typeof value.retire === 'boolean' &&
    typeof value.scores === 'boolean'
  )
}

export type DevSceneId =
  | 'main-menu'
  | 'deck-selection'
  | 'collection'
  | 'arena'
  | 'new-deck'
  | 'tavern-brawl'
  | 'card-inspector'
  | 'outline-lab'
  | 'hero-power-anim'
  | 'game'
  | 'settings'
  | 'card-preview'
  | 'unknown'

export type CollectibleMode = 'all' | 'collectible' | 'uncollectible'
export type DevMatchTarget = 'local' | 'remote'
export type DevCardPickerAction = 'add-to-hand' | 'summon'
export type DevDeckAction = 'destroy' | 'refill'
export type DevZone = 'hand' | 'board'
export type DevHeroPowerAction = 'reset' | 'consume'
export type DevDeckTrackerVisibility = 'hidden' | 'local'
export type DevDeckTrackerSortMode = 'cost' | 'alphabetical' | 'draw-order'

export type DevCommand =
  | { readonly type: 'progression:set-dust'; readonly amount: number | 'custom' }
  | {
      readonly type: 'ranking:set-rank'
      readonly tier: 'rank' | 'legend'
      /** Numeric ladder rank (1..25) or Legend position (1..999) for `tier`. */
      readonly rank: number
    }
  | { readonly type: 'cards:set-premium'; readonly mode: PremiumMode }
  | { readonly type: 'arena:retire' }
  | {
      readonly type: 'arena:set-score'
      readonly counter: 'wins' | 'defeats'
      readonly value: number
    }
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
      'card-inspector',
      'outline-lab',
      'hero-power-anim',
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
  if (value.type === 'progression:set-dust')
    return (
      value.amount === 'custom' ||
      (typeof value.amount === 'number' &&
        Number.isSafeInteger(value.amount) &&
        value.amount >= 0)
    )
  if (value.type === 'ranking:set-rank') {
    const rank = (value as { rank?: unknown }).rank
    return (
      (value.tier === 'rank' || value.tier === 'legend') &&
      typeof rank === 'number' &&
      Number.isSafeInteger(rank) &&
      rank >= 1 &&
      rank <= (value.tier === 'rank' ? 25 : 999)
    )
  }
  if (value.type === 'cards:set-premium') return isPremiumMode(value.mode)
  if (value.type === 'arena:retire') return true
  if (value.type === 'arena:set-score')
    return (
      (value.counter === 'wins' || value.counter === 'defeats') &&
      Number.isInteger(value.value) &&
      (value.value as number) >= 0 &&
      (value.value as number) <= (value.counter === 'wins' ? 12 : 3)
    )
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
