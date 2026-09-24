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

describe('grouped summon placement', () => {
  it.each([0, 1])(
    'places Cenarius Treants on both sides at position %i',
    (position) => {
      const scenario = createMatchScenario({
        seed: 230,
        cardId: 'classic_cenarius',
        firstHeroId: 'malfurion'
      })
      scenario.confirmBothMulligans()
      const participantId = scenario.match.getState().activePlayerId!
      summon(scenario, participantId, 'basic_acidic_swamp_ooze')
      summon(scenario, participantId, 'basic_boulderfist_ogre')
      setMana(scenario, participantId, 10)
      const card = player(scenario, participantId).hand.find(
        (card) => card.cardId === 'classic_cenarius'
      )!
      const result = scenario.match.dispatch({
        type: 'play-card',
        participantId,
        cardInstanceId: card.instanceId,
        position,
        choice: 1
      })
      expect(result.accepted).toBe(true)
      if (!result.accepted) return
      const expected = ['basic_acidic_swamp_ooze', 'basic_boulderfist_ogre']
      expected.splice(
        position,
        0,
        'basic_treant_cenarius',
        'classic_cenarius',
        'basic_treant_cenarius'
      )
      expect(
        player(scenario, participantId).board.map((minion) => minion.cardId)
      ).toEqual(expected)
      const summons = result.events
        .filter((event) => event.type === 'minion-summoned')
        .filter((event) => !!event.summonGroupId)
      expect(summons).toHaveLength(2)
      expect(summons[0]!.summonGroupId).toBeTruthy()
      expect(summons[1]!.summonGroupId).toBe(summons[0]!.summonGroupId)
    }
  )

  it.each([0, 1, 5])('limits alternating summons to %i free slots', (free) => {
    const scenario = createMatchScenario({ seed: 231, cardId: 'classic_onyxia' })
    scenario.confirmBothMulligans()
    const participantId = scenario.match.getState().activePlayerId!
    for (let i = 0; i < 6 - free; i++)
      summon(scenario, participantId, 'basic_acidic_swamp_ooze')
    setMana(scenario, participantId, 10)
    playCard(scenario, participantId, 'classic_onyxia', 0)
    const row = player(scenario, participantId).board
    expect(row).toHaveLength(7)
    expect(row.findIndex((minion) => minion.cardId === 'classic_onyxia')).toBe(
      Math.floor(free / 2)
    )
    expect(row.filter((minion) => minion.cardId === 'classic_whelp')).toHaveLength(free)
  })

  it("resurrects N'Zoth minions around him before his existing neighbor", () => {
    const scenario = createMatchScenario({
      seed: 232,
      cardId: 'whispers_of_the_old_gods_nzoth_the_corruptor'
    })
    scenario.confirmBothMulligans()
    const participantId = scenario.match.getState().activePlayerId!
    for (let i = 0; i < 2; i++) {
      summon(scenario, participantId, 'classic_leper_gnome')
      expect(
        scenario.match.dispatch({
          type: 'dev-add-card',
          participantId,
          cardId: 'basic_shadow_word_pain'
        }).accepted
      ).toBe(true)
      setMana(scenario, participantId, 10)
      const target = player(scenario, participantId).board[0]!
      const spell = player(scenario, participantId).hand.find(
        (card) => card.cardId === 'basic_shadow_word_pain'
      )!
      expect(
        scenario.match.dispatch({
          type: 'play-card',
          participantId,
          cardInstanceId: spell.instanceId,
          targets: [{ kind: 'minion', participantId, instanceId: target.instanceId }]
        }).accepted
      ).toBe(true)
    }
    summon(scenario, participantId, 'basic_boulderfist_ogre')
    setMana(scenario, participantId, 10)
    playCard(scenario, participantId, 'whispers_of_the_old_gods_nzoth_the_corruptor', 0)
    expect(
      player(scenario, participantId).board.map((minion) => minion.cardId)
    ).toEqual([
      'classic_leper_gnome',
      'whispers_of_the_old_gods_nzoth_the_corruptor',
      'classic_leper_gnome',
      'basic_boulderfist_ogre'
    ])
  })
})

it('keeps repeated Battlecry summon groups distinct and seeded results deterministic', () => {
  const run = () => {
    const scenario = createMatchScenario({
      seed: 241,
      cardId: 'goblins_vs_gnomes_dr_boom'
    })
    scenario.confirmBothMulligans()
    const participantId = scenario.match.getState().activePlayerId!
    summon(scenario, participantId, 'league_of_explorers_brann_bronzebeard')
    setMana(scenario, participantId, 10)
    const card = player(scenario, participantId).hand.find(
      (entry) => entry.cardId === 'goblins_vs_gnomes_dr_boom'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId,
      position: 0
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) throw new Error(result.message)
    const summons = result.events
      .filter((event) => event.type === 'minion-summoned')
      .filter((event) => event.minion.cardId === 'goblins_vs_gnomes_boom_bot')
    expect(summons).toHaveLength(4)
    const groups = summons.map((event) => event.summonGroupId)
    expect(groups[0]).toBe(groups[1])
    expect(groups[2]).toBe(groups[3])
    expect(groups[0]).not.toBe(groups[2])
    return result
  }
  expect(run()).toEqual(run())
})
