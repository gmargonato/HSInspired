import type { OpponentTag } from './opponent-curated-assessment'

/**
 * A deck-count window for one tag. Minima are satisfied before flexible slots;
 * maxima constrain every pick.
 */
export interface OpponentFloorRule {
  readonly tag: OpponentTag
  readonly min: number
  readonly max: number
}

/** Role floors shared by every profile: every deck carries "a little bit of everything". */
export const OPPONENT_ROLE_FLOORS: readonly OpponentFloorRule[] = [
  { tag: 'cost:8+', min: 0, max: 3 },
  { tag: 'taunt', min: 2, max: 6 },
  { tag: 'interaction', min: 4, max: 10 },
  { tag: 'resource', min: 2, max: 6 },
  { tag: 'spell', min: 4, max: 30 },
  { tag: 'heal', min: 1, max: 5 }
]
