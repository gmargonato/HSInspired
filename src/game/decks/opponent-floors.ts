/**
 * Universal deck floors: every generated deck carries "a little bit of everything".
 * Minima are satisfied before flexible slots; maxima constrain every pick.
 */
export interface OpponentFloorRule {
  readonly tag: string
  readonly min: number
  readonly max: number
}

export const OPPONENT_FLOORS: readonly OpponentFloorRule[] = [
  { tag: 'cost:cheap', min: 8, max: 14 },
  { tag: 'cost:6+', min: 4, max: 12 },
  { tag: 'cost:8+', min: 0, max: 3 },
  { tag: 'taunt', min: 2, max: 6 },
  { tag: 'interaction', min: 4, max: 10 },
  { tag: 'resource', min: 2, max: 6 },
  { tag: 'spell', min: 4, max: 30 },
  { tag: 'heal', min: 1, max: 5 }
]
