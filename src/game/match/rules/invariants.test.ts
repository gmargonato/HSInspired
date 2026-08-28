import { describe, expect, it } from 'vitest'
import { createMatchScenario } from '../testing/match-scenario-builder'
import { assertOpeningMatchInvariants, MatchInvariantError } from './invariants'

describe('opening match invariants', () => {
  it('accepts a real seeded scenario snapshot', () => {
    const scenario = createMatchScenario()
    assertOpeningMatchInvariants(scenario.match.getState())
  })

  it('rejects duplicate authoritative identities and overfull zones', () => {
    const scenario = createMatchScenario()
    const state = scenario.match.getState()
    const card = state.players[0].hand[0]!
    const invalid = {
      ...state,
      players: [
        { ...state.players[0], hand: [...state.players[0].hand, card] },
        state.players[1]
      ] as [(typeof state.players)[0], (typeof state.players)[1]]
    }
    expect(() => assertOpeningMatchInvariants(invalid)).toThrow(MatchInvariantError)
  })
  it('rejects invalid resources, invalid controller placement, and dead board minions', () => {
    const state = createMatchScenario().match.getState()
    const player = state.players[0]
    const card = player.hand[0]!
    const invalid = {
      ...state,
      players: [
        {
          ...player,
          mana: { available: 2, maximum: 1 },
          hand: [{ ...card, controllerId: state.players[1].participantId }],
          board: [
            {
              instanceId: 'dead-board-minion',
              cardId: card.cardId,
              attack: 1,
              health: 0,
              maxHealth: 1,
              summonedOnTurn: 0,
              lastAttackedOnTurn: null
            }
          ]
        },
        state.players[1]
      ] as [(typeof state.players)[0], (typeof state.players)[1]]
    }

    expect(() => assertOpeningMatchInvariants(invalid)).toThrow(MatchInvariantError)
  })

  it('returns isolated snapshots and leaves rejected commands fully unchanged', () => {
    const scenario = createMatchScenario({ seed: 41 })
    const before = scenario.match.getState()
    const expectedState = structuredClone(before)
    const rngBefore = scenario.rng.snapshot?.()

    ;(before.players[0].hand as unknown as { currentCost?: number }[])[0]!.currentCost =
      99
    expect(scenario.match.getState()).toEqual(expectedState)

    const rejected = scenario.match.dispatch({
      type: 'confirm-mulligan',
      participantId: scenario.participants[0],
      replaceInstanceIds: ['stale-card-instance']
    })

    expect(rejected).toMatchObject({
      accepted: false,
      code: 'invalid-card-selection',
      events: []
    })
    expect(scenario.match.getState()).toEqual(expectedState)
    expect(scenario.rng.snapshot?.()).toBe(rngBefore)
  })
})
