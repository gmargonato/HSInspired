import type { MatchSetup } from '../../../game/match'

/** Minimal route contract consumed by the game feature itself. */
export interface GameRoute {
  readonly id: 'game'
  readonly setup: MatchSetup
}

/** Rebuilds the same matchup with a fresh deterministic match seed. */
export function createRestartGameRoute(route: GameRoute, seed: number): GameRoute {
  return {
    id: 'game',
    setup: {
      ...route.setup,
      seed
    }
  }
}
