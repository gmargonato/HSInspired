import { describe, expect, it } from 'vitest'
import type { MatchLegality } from '../../../game/match'
import { hasAvailableTurnAction } from './turn-action-availability'

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
