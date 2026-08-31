import { describe, expect, it } from 'vitest'
import { asPlayerId, type MatchEndedEvent } from '../../../game/match'
import { classifyArenaMatchResult, shouldRecordClassWin } from './match-win-tracking'

const localId = asPlayerId('human-player')
const remoteId = asPlayerId('ai-player')

function matchEnded(
  winnerId: MatchEndedEvent['winnerId'],
  reason: MatchEndedEvent['reason'] = 'hero-health-depleted'
): MatchEndedEvent {
  return {
    type: 'match-ended',
    winnerId,
    loserId: winnerId === localId ? remoteId : winnerId === remoteId ? localId : null,
    reason
  }
}

describe('class win tracking', () => {
  it('records only naturally completed local victories', () => {
    expect(shouldRecordClassWin(matchEnded(localId), localId)).toBe(true)
    expect(shouldRecordClassWin(matchEnded(remoteId), localId)).toBe(false)
    expect(
      shouldRecordClassWin(matchEnded(null, 'simultaneous-hero-lethal'), localId)
    ).toBe(false)
    expect(shouldRecordClassWin(matchEnded(localId, 'dev-forced'), localId)).toBe(false)
  })

  it('classifies Arena outcomes and ignores development-forced endings', () => {
    expect(classifyArenaMatchResult(matchEnded(localId), localId)).toBe('win')
    expect(classifyArenaMatchResult(matchEnded(remoteId), localId)).toBe('defeat')
    expect(
      classifyArenaMatchResult(matchEnded(null, 'simultaneous-hero-lethal'), localId)
    ).toBe('draw')
    expect(classifyArenaMatchResult(matchEnded(localId, 'dev-forced'), localId)).toBe(
      null
    )
  })
})
