import type { DeckClass } from '../content/cards'
import type { OpponentTag } from './opponent-curated-assessment'
import type { OpponentFloorRule } from './opponent-floors'
import type { OpponentProfileId } from './opponent-profiles'

export interface OpponentCoreSlot {
  readonly id: string
  readonly count: number
}

/**
 * A synergy package: at least `min` cards carrying `tag`, drawn randomly right after
 * the core. `max` overrides the profile/role ceiling for that tag (e.g. a Taunt quest).
 * On-theme cards down to `minQuality` (default 3) may enter only through the package.
 */
export interface OpponentPackageRule {
  readonly tag: OpponentTag
  readonly min: number
  readonly max?: number
  readonly minQuality?: number
}

/** Archetype flavor: a few fixed cards, synergy packages and a light bias. */
export interface OpponentArchetype {
  readonly id: string
  readonly name: string
  readonly classId: DeckClass
  /** Quest archetypes carry their quest in the core; no other deck may include a quest. */
  readonly quest: boolean
  readonly profile: OpponentProfileId
  /** May only name cards from `core`; the generated brief lists the actual key cards. */
  readonly plan: string
  readonly mulligan: string
  readonly core: readonly OpponentCoreSlot[]
  readonly packages: readonly OpponentPackageRule[]
  /** Replaces profile/role floors with the same tag, e.g. a one-cost-heavy curve. */
  readonly floorOverrides?: readonly OpponentFloorRule[]
  readonly bias: readonly OpponentTag[]
}
