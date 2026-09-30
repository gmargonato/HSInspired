/**
 * Canonical name for the turn-capable match engine used by the renderer.
 *
 * `opening-match.ts` remains as a compatibility module for existing content
 * tests, but the engine is no longer described as an opening-only service once
 * it owns mulligan, turns, mana, card play, weapons, and combat.
 */
export {
  createOpeningMatch as createTurnMatch,
  cloneOpeningMatchState,
  type OpeningCard,
  type OpeningMatchCommand as TurnMatchCommand,
  type OpeningMatchEvent as TurnMatchEvent,
  type OpeningMatchInstance as TurnMatchInstance,
  type OpeningCommandResult as TurnMatchResult,
  type OpeningMatchState as TurnMatchState,
  type MulliganResolvedEvent
} from './opening-match'
