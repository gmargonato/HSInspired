import { MAX_DECK_CARDS } from './deck'
import {
  OPPONENT_CURVE_TAGS,
  type OpponentCurveTag
} from './opponent-curated-assessment'
import type { OpponentFloorRule } from './opponent-floors'

export type OpponentProfileId = 'aggro' | 'midrange' | 'ramp'

/** Curve shape and pacing for an archetype. The Hero card counts; the Quest does not. */
export interface OpponentProfile {
  readonly id: OpponentProfileId
  /** Label handed to the AI as the deck's strategy. */
  readonly strategy: string
  readonly floors: readonly OpponentFloorRule[]
}

type Window = readonly [min: number, max: number]

function profile(
  id: OpponentProfileId,
  strategy: string,
  shape: {
    /** Card-count window per mana bucket. */
    readonly curve: Readonly<Record<OpponentCurveTag, Window>>
    readonly minions: number
    /** Cheap cards with efficient stats or multiple bodies. */
    readonly early: number
  }
): OpponentProfile {
  return {
    id,
    strategy,
    floors: [
      ...OPPONENT_CURVE_TAGS.map((tag) => ({
        tag,
        min: shape.curve[tag][0],
        max: shape.curve[tag][1]
      })),
      { tag: 'minion', min: shape.minions, max: MAX_DECK_CARDS },
      { tag: 'early', min: shape.early, max: MAX_DECK_CARDS }
    ]
  }
}

export const OPPONENT_PROFILES: Readonly<Record<OpponentProfileId, OpponentProfile>> = {
  aggro: profile('aggro', 'aggro-tempo', {
    curve: {
      'cost:0-1': [4, 7],
      'cost:2': [7, 10],
      'cost:3': [5, 8],
      'cost:4': [3, 6],
      'cost:5': [1, 3],
      'cost:6+': [0, 3]
    },
    minions: 18,
    early: 10
  }),
  midrange: profile('midrange', 'midrange-tempo', {
    curve: {
      'cost:0-1': [1, 4],
      'cost:2': [5, 8],
      'cost:3': [4, 7],
      'cost:4': [4, 7],
      'cost:5': [2, 5],
      'cost:6+': [3, 5]
    },
    minions: 15,
    early: 6
  }),
  ramp: profile('ramp', 'ramp-value', {
    curve: {
      'cost:0-1': [0, 3],
      'cost:2': [4, 7],
      'cost:3': [3, 6],
      'cost:4': [3, 6],
      'cost:5': [3, 5],
      'cost:6+': [5, 8]
    },
    minions: 13,
    early: 4
  })
}
