import { describe, expect, it } from 'vitest'
import { createMatchScenario } from './match-scenario-builder'

describe('deterministic match scenario builder', () => {
  it('uses real catalog cards and a seeded public match facade', () => {
    const scenario = createMatchScenario({ seed: 1234, cardId: 'basic_fireball' })
    scenario.confirmBothMulligans()
    const state = scenario.match.getState()
    expect(state.phase).toBe('turns')
    expect(
      state.players.every((player) =>
        player.hand.every(
          (card) => card.cardId === 'basic_fireball' || card.cardId === 'basic_the_coin'
        )
      )
    ).toBe(true)
  })

  it('replays setup and RNG identically for the same seed', () => {
    const first = createMatchScenario({ seed: 99 })
    const second = createMatchScenario({ seed: 99 })
    expect(first.match.getState()).toEqual(second.match.getState())
    first.confirmBothMulligans()
    second.confirmBothMulligans()
    expect(first.match.getState()).toEqual(second.match.getState())
  })
})
