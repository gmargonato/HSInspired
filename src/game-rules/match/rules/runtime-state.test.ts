import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMatchScenario } from '../testing/match-scenario-builder'
import * as invariants from './invariants'

afterEach(() => vi.restoreAllMocks())

describe('match state publication', () => {
  it('validates an isolated replacement before publishing it', () => {
    const { match, participants } = createMatchScenario()
    const before = match.getCheckpoint()
    const validate = invariants.assertOpeningMatchInvariants
    const check = vi
      .spyOn(invariants, 'assertOpeningMatchInvariants')
      .mockImplementation((candidate) => {
        expect(match.getCheckpoint()).toEqual(before)
        expect(candidate.players[0].mana.available).toBe(5)
        validate(candidate)
      })
    const result = match.dispatch({
      type: 'dev-set-mana',
      participantId: participants[0],
      available: 5,
      maximum: 5
    })
    expect(result.accepted).toBe(true)
    expect(check).toHaveBeenCalledOnce()
    Object.assign(result.state.players[0].mana, { available: 99 })
    expect(match.getState().players[0].mana.available).toBe(5)
    expect(before.state.players[0].mana.available).toBe(0)
  })

  it('does not publish a replacement when validation throws', () => {
    const { match, participants } = createMatchScenario()
    const before = match.getCheckpoint()
    vi.spyOn(invariants, 'assertOpeningMatchInvariants').mockImplementationOnce(() => {
      throw new Error('invalid replacement')
    })
    expect(() =>
      match.dispatch({
        type: 'dev-set-mana',
        participantId: participants[0],
        available: 5,
        maximum: 5
      })
    ).toThrow('invalid replacement')
    expect(match.getCheckpoint()).toEqual(before)
    expect(
      match.dispatch({
        type: 'dev-set-mana',
        participantId: participants[0],
        available: 5,
        maximum: 5
      }).accepted
    ).toBe(true)
  })
})
