import type { MatchEndedEvent, PlayerId } from '../../../game-rules/match'
import type { ArenaMatchResult } from '../../../game-rules/arena'

/** Identifies real local victories that should affect persistent player stats. */
export function shouldRecordClassWin(
  event: MatchEndedEvent,
  localParticipantId: PlayerId
): boolean {
  return event.reason !== 'dev-forced' && event.winnerId === localParticipantId
}

/** Maps a real Arena match end to its run-local persisted result. */
export function classifyArenaMatchResult(
  event: MatchEndedEvent,
  localParticipantId: PlayerId
): ArenaMatchResult | null {
  if (event.reason === 'dev-forced') return null
  if (event.winnerId === null) return 'draw'
  return event.winnerId === localParticipantId ? 'win' : 'defeat'
}
