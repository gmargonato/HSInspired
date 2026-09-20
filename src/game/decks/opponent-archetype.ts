import type { DeckClass } from '../content/cards'

export interface OpponentCoreSlot {
  readonly id: string
  readonly count: number
}

/** Archetype flavor: a few fixed cards plus a light bias. Everything else is random fill. */
export interface OpponentArchetype {
  readonly id: string
  readonly name: string
  readonly classId: DeckClass
  /** Quest archetypes carry their quest in the core; no other deck may include a quest. */
  readonly quest: boolean
  readonly plan: string
  readonly mulligan: string
  readonly core: readonly OpponentCoreSlot[]
  readonly bias: readonly string[]
}
