import { describe, expect, it } from 'vitest'
import { createMatchScenario } from '../testing/match-scenario-builder'
import { getDerivedState } from './effect-runtime'

describe('continuous effect derivation', () => {
  it('is idempotent and leaves the stored match snapshot unchanged', () => {
    const scenario = createMatchScenario({ seed: 1201 })
    scenario.confirmBothMulligans()
    const participantId = scenario.match.getState().activePlayerId!
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'goblins_vs_gnomes_cogmaster'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'goblins_vs_gnomes_warbot'
      }).accepted
    ).toBe(true)

    const snapshot = scenario.match.getState()
    const first = getDerivedState(snapshot)
    const second = getDerivedState(first)

    expect(second).toEqual(first)
    expect(scenario.match.getState()).toEqual(snapshot)
    expect(
      first.players.find((player) => player.participantId === participantId)?.board[0]
    ).toMatchObject({ cardId: 'goblins_vs_gnomes_cogmaster', attack: 3 })
  })
})
