import type { MatchLegality } from '../../../game/match'

/** Whether the player has any legal action that should delay the exhausted-turn cue. */
export function hasAvailableTurnAction(legality: MatchLegality | undefined): boolean {
  if (!legality) return false
  return (
    legality.playableCardInstanceIds.length > 0 ||
    legality.legalHeroPower ||
    Object.keys(legality.legalAttackTargets).length > 0
  )
}
