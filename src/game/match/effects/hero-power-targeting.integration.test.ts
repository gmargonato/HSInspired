import { describe, expect, it } from 'vitest'
import { asCardId } from '../../content/cards'
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
  it('reports hero powers unavailable while Mindbreaker disables them', () => {
    const scenario = createMatchScenario({ seed: 1200 })
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
        participantId: opponentId,
        cardId: 'knights_of_the_frozen_throne_mindbreaker'
      }).accepted
    ).toBe(true)

    expect(player(scenario, participantId).heroPower.available).toBe(true)
    expect(scenario.match.getLegality!(participantId).legalHeroPower).toBe(false)
    expect(
      scenario.match.dispatch({ type: 'use-hero-power', participantId })
    ).toMatchObject({ accepted: false, code: 'hero-power-unavailable' })
  })

  it.each(['rexxar', 'jaina', 'garrosh', 'guldan', 'anduin'])(
    'only modifies Hunter powers, including upgrades, for %s',
    (heroId) => {
      const scenario = createMatchScenario({
        firstHeroId: heroId,
        secondHeroId: heroId
      })
      scenario.confirmBothMulligans()
      const participantId = scenario.match.getState().activePlayerId!
      const before = player(scenario, participantId).heroPower.targetingGranted
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId,
          cardId: 'goblins_vs_gnomes_steamwheedle_sniper'
        }).accepted
      ).toBe(true)
      expect(player(scenario, participantId).heroPower.targetingGranted).toBe(
        heroId === 'rexxar' ? 'minion' : before
      )
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
          type: 'dev-add-card',
          participantId,
          cardId: asCardId('the_grand_tournament_justicar_trueheart')
        }).accepted
      ).toBe(true)
      const justicar = player(scenario, participantId).hand.find(
        (card) => card.cardId === 'the_grand_tournament_justicar_trueheart'
      )!
      expect(
        scenario.match.dispatch({
          type: 'play-card',
          participantId,
          cardInstanceId: justicar.instanceId,
          position: 1
        }).accepted
      ).toBe(true)
      const power = player(scenario, participantId).heroPower
      expect(power.targetingGranted).toBe(
        heroId === 'rexxar' ? 'minion' : power.targetType
      )
      if (heroId === 'rexxar') expect(power.id).toBe('hunter-ballista-shot')
    }
  )

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
