import { describe, expect, it } from 'vitest'
import { asPlayerId, type MatchLegality } from '../../../game-rules/match'
import { hasAvailableTurnAction, turnControlFace } from './turn-action-availability'

const NO_ACTIONS: MatchLegality = {
  canEndTurn: true,
  playableCardInstanceIds: [],
  legalAttackerInstanceIds: [],
  legalAttackTargets: {},
  legalHeroPower: false,
  legalHeroPowerTargets: [],
  legalTargets: {}
}

describe('turn action availability', () => {
  it('counts a hero-only weapon attack as an available action', () => {
    expect(
      hasAvailableTurnAction({
        ...NO_ACTIONS,
        legalAttackTargets: {
          'local-player:hero': [{ kind: 'hero' }]
        }
      })
    ).toBe(true)
  })

  it('reports no action when legality is missing or contains no legal action', () => {
    expect(hasAvailableTurnAction(undefined)).toBe(false)
    expect(hasAvailableTurnAction(NO_ACTIONS)).toBe(false)
  })
})

describe('turn button face', () => {
  const local = asPlayerId('local')
  const remote = asPlayerId('remote')
  const state = {
    phase: 'turns' as const,
    playerOneId: local,
    activePlayerId: local
  }
  it('uses Extra Turn only for the immediately queued local turn', () => {
    expect(turnControlFace({ ...state, extraTurnQueue: [local] }, local)).toBe(
      'extraTurn'
    )
    expect(turnControlFace({ ...state, extraTurnQueue: [remote, local] }, local)).toBe(
      'endTurn'
    )
    expect(turnControlFace(state, local)).toBe('endTurn')
  })
  it('keeps enemy and mulligan presentation independent of the queue', () => {
    expect(
      turnControlFace(
        { ...state, activePlayerId: remote, extraTurnQueue: [local] },
        local
      )
    ).toBe('enemyTurn')
    expect(
      turnControlFace({ ...state, phase: 'mulligan', extraTurnQueue: [local] }, local)
    ).toBe('endTurn')
  })
})
