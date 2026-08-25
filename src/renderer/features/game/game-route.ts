import type { MatchSetup } from '../../../game/match'

/** Minimal route contract consumed by the game feature itself. */
export interface GameRoute {
  readonly id: 'game'
  readonly setup: MatchSetup
}
