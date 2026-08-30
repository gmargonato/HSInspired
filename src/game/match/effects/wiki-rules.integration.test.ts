import { describe, expect, it } from 'vitest'
import { createMatchScenario } from '../testing/match-scenario-builder'

type Scenario = ReturnType<typeof createMatchScenario>

function player(scenario: Scenario, participantId: string) {
  return scenario.match
    .getState()
    .players.find((candidate) => candidate.participantId === participantId)!
}

function activePlayers(scenario: Scenario) {
  const active = scenario.match.getState().activePlayerId!
  return [
    active,
    scenario.participants.find((participantId) => participantId !== active)!
  ] as const
}

function addCard(scenario: Scenario, participantId: string, cardId: string): void {
  expect(
    scenario.match.dispatch({
      type: 'dev-add-card',
      participantId,
      cardId
    }).accepted
  ).toBe(true)
}

function setMana(scenario: Scenario, participantId: string, available = 10): void {
  expect(
    scenario.match.dispatch({
      type: 'dev-set-mana',
      participantId,
      available,
      maximum: available
    }).accepted
  ).toBe(true)
}

function playCard(
  scenario: Scenario,
  participantId: string,
  cardId: string,
  extra: Record<string, unknown> = {}
): void {
  const card = player(scenario, participantId).hand.find(
    (candidate) => candidate.cardId === cardId
  )
  expect(card).toBeDefined()
  const result = scenario.match.dispatch({
    type: 'play-card',
    participantId,
    cardInstanceId: card!.instanceId,
    ...extra
  })
  if (!result.accepted) throw new Error(result.message)
}

function effectTrace(scenario: Scenario) {
  return scenario.match.getEffectTrace?.() ?? []
}

function deathTriggerTrace(scenario: Scenario): readonly string[] {
  return effectTrace(scenario)
    .filter(
      (entry) => entry.eventType === 'minion-died' || entry.eventType === 'weapon-died'
    )
    .map((entry) => `${entry.sourceCardId}:${entry.actionPath}`)
}

describe('wiki-aligned trigger and Deathrattle rules', () => {
  it.each([
    ['Deathrattle first', false],
    ['Secret first', true]
  ])('orders simultaneous death triggers by play order: %s', (_label, secretFirst) => {
    const scenario = createMatchScenario({
      seed: 1500,
      cardId: 'basic_acidic_swamp_ooze'
    })
    scenario.confirmBothMulligans()
    const [playerId, opponentId] = activePlayers(scenario)
    setMana(scenario, playerId)
    addCard(scenario, playerId, 'classic_abomination')
    addCard(scenario, playerId, 'naxxramas_duplicate')

    if (secretFirst) {
      playCard(scenario, playerId, 'naxxramas_duplicate')
      playCard(scenario, playerId, 'classic_abomination', { position: 0 })
    } else {
      playCard(scenario, playerId, 'classic_abomination', { position: 0 })
      playCard(scenario, playerId, 'naxxramas_duplicate')
    }

    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: playerId }).accepted
    ).toBe(true)
    setMana(scenario, opponentId)
    addCard(scenario, opponentId, 'basic_assassinate')
    const abomination = player(scenario, playerId).board.find(
      (minion) => minion.cardId === 'classic_abomination'
    )!
    playCard(scenario, opponentId, 'basic_assassinate', {
      targets: [
        {
          kind: 'minion',
          participantId: playerId,
          instanceId: abomination.instanceId
        }
      ]
    })

    const trace = deathTriggerTrace(scenario)
    const deathrattleIndex = trace.findIndex((entry) =>
      entry.startsWith('classic_abomination:')
    )
    const secretIndex = trace.findIndex((entry) =>
      entry.startsWith('naxxramas_duplicate:')
    )
    expect(deathrattleIndex).toBeGreaterThanOrEqual(0)
    expect(secretIndex).toBeGreaterThanOrEqual(0)
    if (secretFirst) expect(secretIndex).toBeLessThan(deathrattleIndex)
    else expect(deathrattleIndex).toBeLessThan(secretIndex)
  })

  it('defers deaths caused by a Deathrattle until the current death queue drains', () => {
    const scenario = createMatchScenario({
      seed: 1505,
      cardId: 'basic_acidic_swamp_ooze'
    })
    scenario.confirmBothMulligans()
    const [playerId, opponentId] = activePlayers(scenario)
    for (const cardId of [
      'classic_abomination',
      'classic_loot_hoarder',
      'naxxramas_sludge_belcher'
    ]) {
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId: opponentId,
          cardId
        }).accepted
      ).toBe(true)
    }
    setMana(scenario, playerId)
    addCard(scenario, playerId, 'basic_flamestrike')
    playCard(scenario, playerId, 'basic_flamestrike')

    const deathrattleSources = deathTriggerTrace(scenario)
      .filter((entry) =>
        [
          'classic_abomination',
          'classic_loot_hoarder',
          'naxxramas_sludge_belcher'
        ].some((cardId) => entry.startsWith(`${cardId}:`))
      )
      .map((entry) => entry.split(':', 1)[0])
      .filter((cardId, index, sources) => sources.indexOf(cardId) === index)
    expect(deathrattleSources).toEqual([
      'classic_abomination',
      'classic_loot_hoarder',
      'naxxramas_sludge_belcher'
    ])
  })

  it('resolves card-play triggers before the played minion Battlecry', () => {
    const scenario = createMatchScenario({
      seed: 1501,
      cardId: 'basic_acidic_swamp_ooze'
    })
    scenario.confirmBothMulligans()
    const [playerId, opponentId] = activePlayers(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: playerId,
        cardId: 'classic_illidan_stormrage'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponentId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    setMana(scenario, playerId)
    addCard(scenario, playerId, 'basic_elven_archer')
    const target = player(scenario, opponentId).board[0]!
    playCard(scenario, playerId, 'basic_elven_archer', {
      position: 1,
      targets: [
        { kind: 'minion', participantId: opponentId, instanceId: target.instanceId }
      ]
    })

    const trace = effectTrace(scenario)
    const illidanIndex = trace.findIndex(
      (entry) =>
        entry.sourceCardId === 'classic_illidan_stormrage' &&
        entry.actionPath.startsWith('trigger.on-card-played')
    )
    const battlecryIndex = trace.findIndex(
      (entry) =>
        entry.sourceCardId === 'basic_elven_archer' &&
        entry.actionPath.includes('play-card.battlecry')
    )
    expect(illidanIndex).toBeGreaterThanOrEqual(0)
    expect(battlecryIndex).toBeGreaterThanOrEqual(0)
    expect(illidanIndex).toBeLessThan(battlecryIndex)
  })

  it('resolves summon triggers after the played minion Battlecry', () => {
    const scenario = createMatchScenario({
      seed: 1502,
      cardId: 'basic_acidic_swamp_ooze'
    })
    scenario.confirmBothMulligans()
    const [playerId, opponentId] = activePlayers(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: playerId,
        cardId: 'classic_knife_juggler'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: opponentId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    setMana(scenario, playerId)
    addCard(scenario, playerId, 'basic_elven_archer')
    const target = player(scenario, opponentId).board[0]!
    playCard(scenario, playerId, 'basic_elven_archer', {
      position: 1,
      targets: [
        { kind: 'minion', participantId: opponentId, instanceId: target.instanceId }
      ]
    })

    const trace = effectTrace(scenario)
    const battlecryIndex = trace.findIndex(
      (entry) =>
        entry.sourceCardId === 'basic_elven_archer' &&
        entry.actionPath.includes('play-card.battlecry')
    )
    const summonTriggerIndex = trace.findIndex(
      (entry) =>
        entry.sourceCardId === 'classic_knife_juggler' &&
        entry.actionPath.startsWith('trigger.on-summon')
    )
    expect(battlecryIndex).toBeGreaterThanOrEqual(0)
    expect(summonTriggerIndex).toBeGreaterThanOrEqual(0)
    expect(battlecryIndex).toBeLessThan(summonTriggerIndex)
  })

  it('resolves an explicit minion-played listener after Battlecry', () => {
    const scenario = createMatchScenario({
      seed: 1506,
      cardId: 'basic_acidic_swamp_ooze'
    })
    scenario.confirmBothMulligans()
    const [playerId] = activePlayers(scenario)
    for (const cardId of ['basic_darkspear_hunter', 'basic_bloodfen_raptor']) {
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId: playerId,
          cardId
        }).accepted
      ).toBe(true)
    }
    setMana(scenario, playerId)
    addCard(scenario, playerId, 'goblins_vs_gnomes_king_of_beasts')
    playCard(scenario, playerId, 'goblins_vs_gnomes_king_of_beasts', { position: 2 })

    const king = player(scenario, playerId).board.find(
      (minion) => minion.cardId === 'goblins_vs_gnomes_king_of_beasts'
    )
    expect(king).toMatchObject({ attack: 4, health: 7 })
  })

  it('resolves after-play Secrets after the played minion Battlecry', () => {
    const scenario = createMatchScenario({
      seed: 1504,
      cardId: 'basic_acidic_swamp_ooze'
    })
    scenario.confirmBothMulligans()
    const [minionPlayer, secretController] = activePlayers(scenario)
    setMana(scenario, minionPlayer)
    setMana(scenario, secretController)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: secretController,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: minionPlayer })
        .accepted
    ).toBe(true)
    addCard(scenario, secretController, 'classic_snipe')
    playCard(scenario, secretController, 'classic_snipe')
    expect(
      scenario.match.dispatch({
        type: 'end-turn',
        participantId: secretController
      }).accepted
    ).toBe(true)

    setMana(scenario, minionPlayer)
    addCard(scenario, minionPlayer, 'basic_elven_archer')
    const target = player(scenario, secretController).board[0]!
    playCard(scenario, minionPlayer, 'basic_elven_archer', {
      position: 0,
      targets: [
        {
          kind: 'minion',
          participantId: secretController,
          instanceId: target.instanceId
        }
      ]
    })

    const trace = effectTrace(scenario)
    const battlecryIndex = trace.findIndex(
      (entry) =>
        entry.sourceCardId === 'basic_elven_archer' &&
        entry.actionPath.includes('play-card.battlecry')
    )
    const snipeIndex = trace.findIndex(
      (entry) =>
        entry.sourceCardId === 'classic_snipe' &&
        entry.actionPath.startsWith('trigger.secret')
    )
    expect(battlecryIndex).toBeGreaterThanOrEqual(0)
    expect(snipeIndex).toBeGreaterThanOrEqual(0)
    expect(battlecryIndex).toBeLessThan(snipeIndex)
  })

  it('resolves a weapon Deathrattle when replacing the weapon', () => {
    const scenario = createMatchScenario({
      seed: 1503,
      cardId: 'basic_acidic_swamp_ooze'
    })
    scenario.confirmBothMulligans()
    const [playerId] = activePlayers(scenario)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: playerId,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    setMana(scenario, playerId)
    addCard(scenario, playerId, 'naxxramas_deaths_bite')
    addCard(scenario, playerId, 'naxxramas_deaths_bite')
    playCard(scenario, playerId, 'naxxramas_deaths_bite')
    playCard(scenario, playerId, 'naxxramas_deaths_bite')

    expect(player(scenario, playerId).board[0]).toMatchObject({ health: 1 })
    expect(
      effectTrace(scenario).some(
        (entry) =>
          entry.sourceCardId === 'naxxramas_deaths_bite' &&
          entry.eventType === 'weapon-died' &&
          entry.actionPath.startsWith('trigger.deathrattle')
      )
    ).toBe(true)
  })
  it('prevents summon listeners from observing their own entry, but allows later summons', () => {
    const buzzardScenario = createMatchScenario({
      seed: 1507,
      cardId: 'basic_starving_buzzard'
    })
    buzzardScenario.confirmBothMulligans()
    const [buzzardPlayerId] = activePlayers(buzzardScenario)
    setMana(buzzardScenario, buzzardPlayerId)
    const handBeforeBuzzard = player(buzzardScenario, buzzardPlayerId).hand.length
    playCard(buzzardScenario, buzzardPlayerId, 'basic_starving_buzzard', {
      position: 0
    })
    expect(player(buzzardScenario, buzzardPlayerId).hand).toHaveLength(
      handBeforeBuzzard - 1
    )
    addCard(buzzardScenario, buzzardPlayerId, 'basic_bloodfen_raptor')
    playCard(buzzardScenario, buzzardPlayerId, 'basic_bloodfen_raptor', { position: 1 })
    expect(player(buzzardScenario, buzzardPlayerId).hand).toHaveLength(
      handBeforeBuzzard
    )

    const tidecallerScenario = createMatchScenario({
      seed: 1508,
      cardId: 'classic_murloc_tidecaller'
    })
    tidecallerScenario.confirmBothMulligans()
    const [tidecallerPlayerId] = activePlayers(tidecallerScenario)
    setMana(tidecallerScenario, tidecallerPlayerId)
    playCard(tidecallerScenario, tidecallerPlayerId, 'classic_murloc_tidecaller', {
      position: 0
    })
    expect(player(tidecallerScenario, tidecallerPlayerId).board[0]).toMatchObject({
      attack: 1
    })
    addCard(tidecallerScenario, tidecallerPlayerId, 'basic_murloc_raider')
    playCard(tidecallerScenario, tidecallerPlayerId, 'basic_murloc_raider', {
      position: 1
    })
    expect(player(tidecallerScenario, tidecallerPlayerId).board[0]).toMatchObject({
      attack: 2
    })
  })

  it('prevents card-play listeners from observing their own entry, but allows later plays', () => {
    const illidanScenario = createMatchScenario({
      seed: 1509,
      cardId: 'classic_illidan_stormrage'
    })
    illidanScenario.confirmBothMulligans()
    const [illidanPlayerId] = activePlayers(illidanScenario)
    setMana(illidanScenario, illidanPlayerId)
    playCard(illidanScenario, illidanPlayerId, 'classic_illidan_stormrage', {
      position: 0
    })
    expect(
      player(illidanScenario, illidanPlayerId).board.filter(
        (minion) => minion.cardId === 'classic_flame_of_azzinoth'
      )
    ).toHaveLength(0)
    addCard(illidanScenario, illidanPlayerId, 'basic_arcane_intellect')
    playCard(illidanScenario, illidanPlayerId, 'basic_arcane_intellect')
    expect(
      player(illidanScenario, illidanPlayerId).board.filter(
        (minion) => minion.cardId === 'classic_flame_of_azzinoth'
      )
    ).toHaveLength(1)

    const questingScenario = createMatchScenario({
      seed: 1510,
      cardId: 'classic_questing_adventurer'
    })
    questingScenario.confirmBothMulligans()
    const [questingPlayerId] = activePlayers(questingScenario)
    setMana(questingScenario, questingPlayerId)
    playCard(questingScenario, questingPlayerId, 'classic_questing_adventurer', {
      position: 0
    })
    expect(player(questingScenario, questingPlayerId).board[0]).toMatchObject({
      attack: 2,
      health: 2
    })
    addCard(questingScenario, questingPlayerId, 'basic_arcane_intellect')
    playCard(questingScenario, questingPlayerId, 'basic_arcane_intellect')
    expect(player(questingScenario, questingPlayerId).board[0]).toMatchObject({
      attack: 3,
      health: 3
    })
  })
})
