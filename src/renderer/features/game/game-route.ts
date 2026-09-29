import type { MatchSetup } from '../../../game/match'
import type { Deck } from '../../../game/decks'
import type { CuratedOpponentMetadata } from '../../../game/decks/curated-opponent-selection'

/** Minimal route contract consumed by the game feature itself. */
export interface GameRoute {
  readonly id: 'game'
  readonly setup: MatchSetup
  readonly mode?: 'tavern-brawl' | 'arena'
  readonly deckSnapshots?: readonly Deck[]
  readonly curatedOpponent?: CuratedOpponentMetadata
}

/** Rebuilds the same matchup with a fresh deterministic match seed. */
export function createRestartGameRoute(route: GameRoute, seed: number): GameRoute {
  return {
    ...route,
    setup: {
      ...route.setup,
      seed
    }
  }
}
