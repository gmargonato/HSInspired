import type { DeckClass } from '../content/cards'

export interface CuratedCardSlot {
  readonly id: string
  readonly count: number
}

export interface CuratedPackage {
  readonly id: string
  readonly reason: string
  readonly requirements: readonly CuratedRequirement[]
  readonly preferences: readonly string[]
}

export interface CuratedRequirement {
  readonly tag: string
  readonly minimum: number
  readonly maximum: number
}

/** Archetype knowledge: defining cards stay fixed; support is selected by live roles. */
export interface OpponentArchetype {
  readonly id: string
  readonly name: string
  readonly classId: DeckClass
  readonly strategy: 'midrange-tempo'
  readonly plan: string
  readonly mulligan: string
  readonly core: readonly CuratedCardSlot[]
  readonly variants: readonly CuratedPackage[]
  readonly preferences: readonly string[]
  readonly maxCopies?: Readonly<Record<string, number>>
  readonly requirements: readonly CuratedRequirement[]
  readonly sources: readonly string[]
}
