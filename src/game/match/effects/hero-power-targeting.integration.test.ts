import { describe, expect, it } from 'vitest'
import { createMatchScenario } from '../testing/match-scenario-builder'

function player(
  scenario: ReturnType<typeof createMatchScenario>,
  participantId: string
) {
  return scenario.match
    .getState()
    .players.find((candidate) => candidate.participantId === participantId)!
}

describe('aura-modified hero powers', () => {
  it('uses Steamwheedle Sniper targeting against the selected minion', () => {
    const scenario = createMatchScenario({
      seed: 1201,
      firstHeroId: 'rexxar',
      secondHeroId: 'rexxar'
    })
    scenario.confirmBothMulligans()
    const participantId = scenario.match.getState().activePlayerId!
    const opponentId = scenario.participants.find((id) => id !== participantId)!
    expect(
      scenario.match.dispatch({
        type: 'dev-set-mana',
        participantId,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'goblins_vs_gnomes_steamwheedle_sniper'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponentId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    const target = player(scenario, opponentId).board[0]!

    const legality = scenario.match.getLegality!(participantId)
    expect(legality.legalHeroPower).toBe(true)
    expect(legality.legalHeroPowerTargets).toContainEqual({
      kind: 'minion',
      participantId: opponentId,
      instanceId: target.instanceId
    })
    expect(
      scenario.match.dispatch({ type: 'use-hero-power', participantId })
    ).toMatchObject({ accepted: false, code: 'invalid-target' })
    expect(
      scenario.match.dispatch({
        type: 'use-hero-power',
        participantId,
        target: {
          kind: 'minion',
          participantId: opponentId,
          instanceId: target.instanceId
        }
      }).accepted
    ).toBe(true)
    expect(player(scenario, opponentId).board).toHaveLength(0)
    expect(player(scenario, opponentId).hero.health).toBe(30)
  })
})
