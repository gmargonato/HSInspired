import { describe, expect, it } from 'vitest'
import type { PlayerId } from '../match-types'
import {
  createMatchScenario,
  type MatchScenario
} from '../testing/match-scenario-builder'

function player(scenario: MatchScenario, participantId: PlayerId) {
  return scenario.match
    .getState()
    .players.find((candidate) => candidate.participantId === participantId)!
}

function activePlayers(scenario: MatchScenario): readonly [PlayerId, PlayerId] {
  const participantId = scenario.match.getState().activePlayerId!
  const opponentId = scenario.participants.find((id) => id !== participantId)!
  return [participantId, opponentId]
}

function setMana(scenario: MatchScenario, participantId: PlayerId): void {
  expect(
    scenario.match.dispatch({
      type: 'dev-set-mana',
      participantId,
      available: 10,
      maximum: 10
    }).accepted
  ).toBe(true)
}

describe('audit regression coverage', () => {
  it('draws Divine Favor only when the opponent has more cards', () => {
    const scenario = createMatchScenario({
      cardId: 'classic_divine_favor',
      firstHeroId: 'uther'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId: opponentId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    setMana(scenario, participantId)

    const card = player(scenario, participantId).hand[0]!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId
    })

    expect(result.accepted).toBe(true)
    expect(player(scenario, participantId).hand).toHaveLength(3)
    expect(result.events.filter((event) => event.type === 'card-drawn')).toHaveLength(0)
  })

  it('does not fatigue when The Curator has no matching cards to draw', () => {
    const scenario = createMatchScenario({ cardId: 'basic_acidic_swamp_ooze' })
    scenario.confirmBothMulligans()
    const [participantId] = activePlayers(scenario)

    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'one_night_in_karazhan_the_curator'
      }).accepted
    ).toBe(true)
    setMana(scenario, participantId)
    expect(
      scenario.match.dispatch({
        type: 'dev-modify-deck',
        participantId,
        action: 'destroy'
      }).accepted
    ).toBe(true)

    const fatigueBefore = player(scenario, participantId).fatigueDamage
    const curator = player(scenario, participantId).hand[0]!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: curator.instanceId,
      position: 0
    })

    expect(result.accepted).toBe(true)
    expect(result.events.filter((event) => event.type === 'card-drawn')).toHaveLength(0)
    expect(result.events.filter((event) => event.type === 'fatigue')).toHaveLength(0)
    expect(player(scenario, participantId).fatigueDamage).toBe(fatigueBefore)
  })

  it('applies spell damage to random split spells as additional sequential hits', () => {
    const scenario = createMatchScenario({ cardId: 'basic_arcane_missiles' })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId: 'classic_azure_drake'
      }).accepted
    ).toBe(true)
    setMana(scenario, participantId)

    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: player(scenario, participantId).hand[0]!.instanceId
    })

    expect(result.accepted).toBe(true)
    expect(player(scenario, opponentId).hero.health).toBe(26)
  })

  it('removes mortally wounded random-hit targets before selecting the next hit', () => {
    const scenario = createMatchScenario({
      seed: 1,
      cardId: 'basic_arcane_missiles'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponentId,
        cardId: 'classic_wisp'
      }).accepted
    ).toBe(true)
    setMana(scenario, participantId)

    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: player(scenario, participantId).hand[0]!.instanceId
      }).accepted
    ).toBe(true)
    expect(player(scenario, opponentId).board).toHaveLength(0)
    expect(player(scenario, opponentId).hero.health).toBe(28)
  })

  it('selects distinct enemy minions for Multi-Shot', () => {
    const scenario = createMatchScenario({ seed: 1, cardId: 'basic_multi_shot' })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)

    for (let index = 0; index < 2; index += 1) {
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId: opponentId,
          cardId: 'basic_boulderfist_ogre'
        }).accepted
      ).toBe(true)
    }
    setMana(scenario, participantId)

    const card = player(scenario, participantId).hand.find(
      (candidate) => candidate.cardId === 'basic_multi_shot'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId
    })

    expect(result.accepted).toBe(true)
    expect(player(scenario, opponentId).board.map((minion) => minion.health)).toEqual([
      4, 4
    ])
  })

  it('draws the fixed missing count for draw-until, including fatigue attempts', () => {
    const scenario = createMatchScenario({ cardId: 'goblins_vs_gnomes_jeeves' })
    scenario.confirmBothMulligans()
    const [participantId] = activePlayers(scenario)
    setMana(scenario, participantId)
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: player(scenario, participantId).hand[0]!.instanceId,
        position: 0
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-clear-zone',
        participantId,
        zone: 'hand'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-modify-deck',
        participantId,
        action: 'destroy'
      }).accepted
    ).toBe(true)

    expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
    expect(player(scenario, participantId).hero.health).toBe(24)
    expect(player(scenario, participantId).fatigueDamage).toBe(4)
  })

  it('preserves lost weapon durability when a durability modifier is applied', () => {
    const scenario = createMatchScenario({
      cardId: 'basic_fiery_war_axe',
      firstHeroId: 'garrosh'
    })
    scenario.confirmBothMulligans()
    const [participantId] = activePlayers(scenario)
    setMana(scenario, participantId)
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: player(scenario, participantId).hand[0]!.instanceId
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'attack-character',
        participantId,
        attacker: { kind: 'hero' },
        defender: { kind: 'hero' }
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId,
        cardId: 'classic_upgrade'
      }).accepted
    ).toBe(true)
    const upgrade = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_upgrade'
    )!

    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: upgrade.instanceId
      }).accepted
    ).toBe(true)
    expect(player(scenario, participantId).weapon).toMatchObject({
      attack: 4,
      durability: 2,
      maxDurability: 3
    })
  })

  it('preserves a card creation ordinal across normal hand-to-play movement', () => {
    const scenario = createMatchScenario({ cardId: 'basic_acidic_swamp_ooze' })
    scenario.confirmBothMulligans()
    const [participantId] = activePlayers(scenario)
    setMana(scenario, participantId)
    const card = player(scenario, participantId).hand[0]!

    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: card.instanceId,
        position: 0
      }).accepted
    ).toBe(true)
    const minion = player(scenario, participantId).board.find(
      (candidate) => candidate.instanceId === card.instanceId
    )!
    expect(minion.creationOrdinal).toBe(card.creationOrdinal)

    const weaponScenario = createMatchScenario({ cardId: 'basic_fiery_war_axe' })
    weaponScenario.confirmBothMulligans()
    const [weaponPlayer] = activePlayers(weaponScenario)
    setMana(weaponScenario, weaponPlayer)
    const weaponCard = player(weaponScenario, weaponPlayer).hand[0]!
    expect(
      weaponScenario.match.dispatch({
        type: 'play-card',
        participantId: weaponPlayer,
        cardInstanceId: weaponCard.instanceId
      }).accepted
    ).toBe(true)
    expect(player(weaponScenario, weaponPlayer).weapon?.creationOrdinal).toBe(
      weaponCard.creationOrdinal
    )

    const secretScenario = createMatchScenario({ cardId: 'classic_counterspell' })
    secretScenario.confirmBothMulligans()
    const [secretPlayer] = activePlayers(secretScenario)
    setMana(secretScenario, secretPlayer)
    const secretCard = player(secretScenario, secretPlayer).hand[0]!
    expect(
      secretScenario.match.dispatch({
        type: 'play-card',
        participantId: secretPlayer,
        cardInstanceId: secretCard.instanceId
      }).accepted
    ).toBe(true)
    expect(player(secretScenario, secretPlayer).secrets?.[0]?.creationOrdinal).toBe(
      secretCard.creationOrdinal
    )
  })
})
