import type {
  MatchLegality,
  OpeningMatchState,
  PlayerId
} from '../../../game-rules/match'

/** Whether the player has any legal action that should delay the exhausted-turn cue. */
export function hasAvailableTurnAction(legality: MatchLegality | undefined): boolean {
  if (!legality) return false
  return (
    (legality.activatableBoardObjectInstanceIds?.length ?? 0) > 0 ||
    (legality.tradeableCardInstanceIds?.length ?? 0) > 0 ||
    legality.playableCardInstanceIds.length > 0 ||
    legality.legalHeroPower ||
    Object.keys(legality.legalAttackTargets).length > 0
  )
}

/** The button describes the immediately queued transition, not an extra turn already in progress. */
export function turnControlFace(
  state: Pick<
    OpeningMatchState,
    'phase' | 'playerOneId' | 'activePlayerId' | 'extraTurnQueue'
  >,
  localPlayerId: PlayerId
): 'endTurn' | 'extraTurn' | 'enemyTurn' {
  const displayedPlayerId =
    state.phase === 'mulligan' ? state.playerOneId : state.activePlayerId
  if (displayedPlayerId !== localPlayerId) return 'enemyTurn'
  return state.phase === 'turns' && state.extraTurnQueue?.[0] === localPlayerId
    ? 'extraTurn'
    : 'endTurn'
}
