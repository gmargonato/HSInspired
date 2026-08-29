import { describe, expect, it } from 'vitest'
import { createMatchScenario } from '../testing/match-scenario-builder'

type Scenario = ReturnType<typeof createMatchScenario>

function player(scenario: Scenario, participantId: string) {
  return scenario.match
    .getState()
    .players.find((candidate) => candidate.participantId === participantId)!
}

function summon(scenario: Scenario, participantId: string, cardId: string): void {
  const result = scenario.match.dispatch({
    type: 'dev-summon-minion',
    participantId,
    cardId
  })
  expect(result.accepted).toBe(true)
}

function setMana(scenario: Scenario, participantId: string, amount: number): void {
  const result = scenario.match.dispatch({
    type: 'dev-set-mana',
    participantId,
    available: amount,
    maximum: amount
  })
  expect(result.accepted).toBe(true)
}

function playCard(
  scenario: Scenario,
  participantId: string,
  cardId: string,
  position?: number
): void {
  const card = player(scenario, participantId).hand.find(
    (entry) => entry.cardId === cardId
  )
  expect(card).toBeDefined()
  const result = scenario.match.dispatch({
    type: 'play-card',
    participantId,
    cardInstanceId: card!.instanceId,
    ...(position === undefined ? {} : { position })
  })
  expect(result.accepted).toBe(true)
}

describe('Hearthstone summon placement', () => {
  it('places a single minion summon immediately to the source minion right', () => {
    const scenario = createMatchScenario({
      seed: 210,
      cardId: 'basic_murloc_tidehunter'
    })
    scenario.confirmBothMulligans()
    const participantId = scenario.match.getState().activePlayerId!

    summon(scenario, participantId, 'basic_acidic_swamp_ooze')
    summon(scenario, participantId, 'basic_boulderfist_ogre')
    setMana(scenario, participantId, 10)
    playCard(scenario, participantId, 'basic_murloc_tidehunter', 1)

    expect(
      player(scenario, participantId).board.map((minion) => minion.cardId)
    ).toEqual([
      'basic_acidic_swamp_ooze',
      'basic_murloc_tidehunter',
      'basic_murloc_scout',
      'basic_boulderfist_ogre'
    ])
  })

  it('alternates Dr. Boom tokens around their source, starting on the right', () => {
    const scenario = createMatchScenario({
      seed: 211,
      cardId: 'goblins_vs_gnomes_dr_boom'
    })
    scenario.confirmBothMulligans()
    const participantId = scenario.match.getState().activePlayerId!

    summon(scenario, participantId, 'basic_acidic_swamp_ooze')
    summon(scenario, participantId, 'basic_boulderfist_ogre')
    setMana(scenario, participantId, 10)
    playCard(scenario, participantId, 'goblins_vs_gnomes_dr_boom', 1)

    expect(
      player(scenario, participantId).board.map((minion) => minion.cardId)
    ).toEqual([
      'basic_acidic_swamp_ooze',
      'goblins_vs_gnomes_boom_bot',
      'goblins_vs_gnomes_dr_boom',
      'goblins_vs_gnomes_boom_bot',
      'basic_boulderfist_ogre'
    ])
  })

  it('fills Onyxia tokens symmetrically and gives the extra token to the right', () => {
    const fullBoardScenario = createMatchScenario({
      seed: 212,
      cardId: 'classic_onyxia'
    })
    fullBoardScenario.confirmBothMulligans()
    const fullBoardParticipantId = fullBoardScenario.match.getState().activePlayerId!
    setMana(fullBoardScenario, fullBoardParticipantId, 10)
    playCard(fullBoardScenario, fullBoardParticipantId, 'classic_onyxia', 0)

    expect(
      player(fullBoardScenario, fullBoardParticipantId).board.map(
        (minion) => minion.cardId
      )
    ).toEqual([
      'classic_whelp',
      'classic_whelp',
      'classic_whelp',
      'classic_onyxia',
      'classic_whelp',
      'classic_whelp',
      'classic_whelp'
    ])

    const oddBoardScenario = createMatchScenario({
      seed: 213,
      cardId: 'classic_onyxia'
    })
    oddBoardScenario.confirmBothMulligans()
    const oddBoardParticipantId = oddBoardScenario.match.getState().activePlayerId!
    summon(oddBoardScenario, oddBoardParticipantId, 'basic_acidic_swamp_ooze')
    setMana(oddBoardScenario, oddBoardParticipantId, 10)
    playCard(oddBoardScenario, oddBoardParticipantId, 'classic_onyxia', 1)

    expect(
      player(oddBoardScenario, oddBoardParticipantId).board.map(
        (minion) => minion.cardId
      )
    ).toEqual([
      'basic_acidic_swamp_ooze',
      'classic_whelp',
      'classic_whelp',
      'classic_onyxia',
      'classic_whelp',
      'classic_whelp',
      'classic_whelp'
    ])
  })

  it('places spell and hero-power summons at the far right', () => {
    const spellScenario = createMatchScenario({
      seed: 214,
      cardId: 'classic_summon_a_panther',
      firstHeroId: 'malfurion'
    })
    spellScenario.confirmBothMulligans()
    const spellParticipantId = spellScenario.match.getState().activePlayerId!
    summon(spellScenario, spellParticipantId, 'basic_acidic_swamp_ooze')
    summon(spellScenario, spellParticipantId, 'basic_boulderfist_ogre')
    setMana(spellScenario, spellParticipantId, 10)
    playCard(spellScenario, spellParticipantId, 'classic_summon_a_panther')

    expect(
      player(spellScenario, spellParticipantId).board.map((minion) => minion.cardId)
    ).toEqual(['basic_acidic_swamp_ooze', 'basic_boulderfist_ogre', 'classic_panther'])

    const heroPowerScenario = createMatchScenario({
      seed: 215,
      cardId: 'basic_acidic_swamp_ooze',
      firstHeroId: 'uther'
    })
    heroPowerScenario.confirmBothMulligans()
    const heroPowerParticipantId = heroPowerScenario.match.getState().activePlayerId!
    summon(heroPowerScenario, heroPowerParticipantId, 'basic_acidic_swamp_ooze')
    summon(heroPowerScenario, heroPowerParticipantId, 'basic_boulderfist_ogre')
    setMana(heroPowerScenario, heroPowerParticipantId, 2)
    const result = heroPowerScenario.match.dispatch({
      type: 'use-hero-power',
      participantId: heroPowerParticipantId
    })
    expect(result.accepted).toBe(true)

    expect(
      player(heroPowerScenario, heroPowerParticipantId).board.map(
        (minion) => minion.cardId
      )
    ).toEqual([
      'basic_acidic_swamp_ooze',
      'basic_boulderfist_ogre',
      'basic_silver_hand_recruit'
    ])
  })

  it("places a Deathrattle summon at its dead minion's remembered position", () => {
    const scenario = createMatchScenario({
      seed: 216,
      cardId: 'naxxramas_reincarnate',
      firstHeroId: 'thrall'
    })
    scenario.confirmBothMulligans()
    const participantId = scenario.match.getState().activePlayerId!

    summon(scenario, participantId, 'basic_acidic_swamp_ooze')
    summon(scenario, participantId, 'classic_harvest_golem')
    summon(scenario, participantId, 'basic_boulderfist_ogre')
    setMana(scenario, participantId, 10)

    const target = player(scenario, participantId).board[1]!
    const reincarnate = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'naxxramas_reincarnate'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: reincarnate.instanceId,
      targets: [
        {
          kind: 'minion',
          participantId,
          instanceId: target.instanceId
        }
      ]
    })
    expect(result.accepted).toBe(true)

    expect(
      player(scenario, participantId).board.map((minion) => minion.cardId)
    ).toEqual([
      'basic_acidic_swamp_ooze',
      'classic_damaged_golem',
      'basic_boulderfist_ogre',
      'classic_harvest_golem'
    ])
  })
})
