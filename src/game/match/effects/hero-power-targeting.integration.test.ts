import { describe, expect, it } from 'vitest'
import { asCardId, CARD_CATALOG, cardHasTribe } from '../../content/cards'
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

  it('limits Dinomancy to friendly Beasts and rejects other friendly minions', () => {
    const scenario = createMatchScenario({
      seed: 1202,
      firstHeroId: 'rexxar',
      secondHeroId: 'jaina'
    })
    scenario.confirmBothMulligans()
    const participantId = scenario.match.getState().activePlayerId!
    const beast = CARD_CATALOG.all.find(
      (card) => card.type === 'Minion' && cardHasTribe(card, 'Beast')
    )!

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
        cardId: asCardId('journey_to_ungoro_dinomancy')
      }).accepted
    ).toBe(true)
    const dinomancy = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'journey_to_ungoro_dinomancy'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: dinomancy.instanceId
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: beast.id
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)

    const ownBoard = player(scenario, participantId).board
    const beastMinion = ownBoard.find((minion) => minion.cardId === beast.id)!
    const nonBeastMinion = ownBoard.find(
      (minion) => minion.cardId === 'basic_acidic_swamp_ooze'
    )!
    const legality = scenario.match.getLegality!(participantId)
    expect(player(scenario, participantId).heroPower.targetType).toBe('friendly-beast')
    expect(legality.legalHeroPowerTargets).toEqual([
      {
        kind: 'minion',
        participantId,
        instanceId: beastMinion.instanceId
      }
    ])

    const manaBeforeUse = player(scenario, participantId).mana.available
    expect(
      scenario.match.dispatch({
        type: 'use-hero-power',
        participantId,
        target: {
          kind: 'minion',
          participantId,
          instanceId: nonBeastMinion.instanceId
        }
      })
    ).toMatchObject({ accepted: false, code: 'invalid-target' })
    expect(player(scenario, participantId).mana.available).toBe(manaBeforeUse)
    expect(player(scenario, participantId).heroPower.available).toBe(true)

    expect(
      scenario.match.dispatch({
        type: 'use-hero-power',
        participantId,
        target: {
          kind: 'minion',
          participantId,
          instanceId: beastMinion.instanceId
        }
      }).accepted
    ).toBe(true)
    expect(
      player(scenario, participantId).board.find(
        (minion) => minion.instanceId === beastMinion.instanceId
      )
    ).toMatchObject({ attack: beastMinion.attack + 3, health: beastMinion.health + 3 })
  })
})
