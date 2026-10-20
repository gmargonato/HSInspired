import { CARD_CATALOG } from '../../content/cards'
import { createAiFixture, type AiFixtureOptions } from '../testing/ai-scenario-builder'
import { createOpeningMatchFromCheckpoint } from '../opening-match'
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

// Defile mechanics: deaths and Deathrattles resolve between recasts; 14 casts maximum.
// https://hearthstone.wiki.gg/wiki/Defile
function runDefileFixture(
  board: { cardId: string; health?: number; maxHealth?: number }[],
  friendly: { cardId: string; health?: number; maxHealth?: number }[] = []
) {
  const f = createAiFixture({
    seed: 741,
    aiHeroId: 'guldan',
    opponentHeroId: 'jaina',
    aiMana: 10,
    aiHand: ['knights_of_the_frozen_throne_defile'],
    aiBoard: friendly,
    opponentBoard: board
  })
  const m = createOpeningMatchFromCheckpoint(f.checkpoint)
  const me = () =>
    m.getState().players.find((p) => p.participantId === f.aiParticipantId)!
  const foe = () =>
    m.getState().players.find((p) => p.participantId === f.localParticipantId)!
  const result = m.dispatch({
    type: 'play-card',
    participantId: f.aiParticipantId,
    cardInstanceId: me().hand[0]!.instanceId
  })
  expect(result).toMatchObject({ accepted: true })
  return { m, me, foe }
}
describe('Defile repetition death checkpoints', () => {
  it('clears a plain one-two-three Health ladder', () => {
    const s = runDefileFixture(
      [
        { cardId: 'basic_bloodfen_raptor', health: 2, maxHealth: 2 },
        { cardId: 'basic_chillwind_yeti', health: 3, maxHealth: 5 }
      ],
      [{ cardId: 'classic_wisp' }]
    )
    expect(s.me().board).toHaveLength(0)
    expect(s.foe().board).toHaveLength(0)
    expect(s.m.getState().history!.minionsDiedThisTurn).toHaveLength(3)
  })
  it('does not repeat when initial damage kills nothing', () => {
    const s = runDefileFixture([
      { cardId: 'basic_chillwind_yeti', health: 3, maxHealth: 5 }
    ])
    expect(s.foe().board[0]!.health).toBe(2)
    expect(s.m.getState().history!.minionsDiedThisTurn).toHaveLength(0)
  })
  it('a removed Divine Shield is not a death', () => {
    const s = runDefileFixture([{ cardId: 'classic_argent_squire' }])
    expect(s.foe().board).toHaveLength(1)
    expect(s.foe().board[0]!.health).toBe(1)
    expect(s.foe().board[0]!.divineShield).toBe(false)
  })
  it('resolves Deathrattle summons between damage passes', () => {
    const s = runDefileFixture([
      { cardId: 'naxxramas_haunted_creeper', health: 1, maxHealth: 2 },
      { cardId: 'basic_chillwind_yeti', health: 3, maxHealth: 5 }
    ])
    expect(s.foe().board).toHaveLength(0)
    expect(s.m.getState().history!.minionsDiedThisTurn).toHaveLength(4)
  })
  it('recalculates spell damage when its source dies', () => {
    const s = runDefileFixture(
      [{ cardId: 'basic_chillwind_yeti', health: 4, maxHealth: 5 }],
      [{ cardId: 'classic_bloodmage_thalnos' }]
    )
    expect(s.me().board).toHaveLength(0)
    expect(s.foe().board).toHaveLength(1)
    expect(s.foe().board[0]!.health).toBe(1)
  })
})

it('caps a regenerating Grim Patron ladder at fourteen casts', () => {
  const s = runDefileFixture([
    { cardId: 'blackrock_mountain_grim_patron', health: 1, maxHealth: 3 },
    { cardId: 'blackrock_mountain_grim_patron', health: 2, maxHealth: 3 },
    { cardId: 'blackrock_mountain_grim_patron', health: 3, maxHealth: 3 }
  ])
  expect(s.foe().board.length).toBeGreaterThan(0)
  const damage = s.m.getState().history!.minionsDiedThisTurn.length
  expect(damage).toBeGreaterThan(14)
  const f = createAiFixture({
    seed: 741,
    aiHeroId: 'guldan',
    opponentHeroId: 'jaina',
    aiMana: 10,
    aiHand: ['knights_of_the_frozen_throne_defile'],
    aiBoard: [{ cardId: 'basic_chillwind_yeti', health: 100, maxHealth: 100 }],
    opponentBoard: [
      { cardId: 'blackrock_mountain_grim_patron', health: 1, maxHealth: 3 },
      { cardId: 'blackrock_mountain_grim_patron', health: 2, maxHealth: 3 },
      { cardId: 'blackrock_mountain_grim_patron', health: 3, maxHealth: 3 }
    ]
  })
  const m = createOpeningMatchFromCheckpoint(f.checkpoint)
  const p = () =>
    m.getState().players.find((x) => x.participantId === f.aiParticipantId)!
  expect(
    m.dispatch({
      type: 'play-card',
      participantId: f.aiParticipantId,
      cardInstanceId: p().hand[0]!.instanceId
    })
  ).toMatchObject({ accepted: true })
  expect(p().board[0]!.health).toBe(86)
})
it('ends recasts when a Deathrattle defeats a hero', () => {
  const f = createAiFixture({
    seed: 741,
    aiHeroId: 'guldan',
    opponentHeroId: 'jaina',
    aiMana: 10,
    aiHealth: 2,
    aiHand: ['knights_of_the_frozen_throne_defile'],
    opponentBoard: [
      { cardId: 'classic_abomination', health: 1, maxHealth: 4 },
      { cardId: 'basic_chillwind_yeti' }
    ]
  })
  const m = createOpeningMatchFromCheckpoint(f.checkpoint)
  const p = m.getState().players.find((x) => x.participantId === f.aiParticipantId)!
  expect(
    m.dispatch({
      type: 'play-card',
      participantId: f.aiParticipantId,
      cardInstanceId: p.hand[0]!.instanceId
    })
  ).toMatchObject({ accepted: true })
  expect(m.getState().phase).toBe('ended')
  expect(
    m.getState().players.find((x) => x.participantId === f.localParticipantId)!
      .board[0]!.health
  ).toBe(2)
})

// Future Past interactions are permanent regressions for the fun-first Yore package.
const yoreCard = (s: string) => `future_past_${s}`
function createYoreScenario(o: Partial<AiFixtureOptions> = {}) {
  const f = createAiFixture({
    seed: 2871,
    aiHeroId: 'guldan',
    opponentHeroId: 'jaina',
    aiMana: 10,
    aiMaximumMana: 10,
    aiDeck: ['classic_wisp'],
    opponentDeck: ['classic_wisp'],
    ...o
  })
  const m = createOpeningMatchFromCheckpoint(f.checkpoint),
    id = f.aiParticipantId,
    enemy = f.localParticipantId
  const me = () => m.getState().players.find((x) => x.participantId === id)!
  const foe = () => m.getState().players.find((x) => x.participantId === enemy)!
  const target = (side = 'self', i = 0) => ({
    kind: 'minion' as const,
    participantId: side === 'self' ? id : enemy,
    instanceId: (side === 'self' ? me() : foe()).board[i]!.instanceId
  })
  const play = (cardId: string, t?: ReturnType<typeof target>, choice?: number) => {
    const card = me().hand.find((x) => x.cardId === cardId)!
    expect(card, cardId).toBeTruthy()
    const r = m.dispatch({
      type: 'play-card',
      participantId: id,
      cardInstanceId: card.instanceId,
      ...(CARD_CATALOG.get(cardId)?.type === 'Minion'
        ? { position: me().board.length }
        : {}),
      ...(t ? { targets: [t] } : {}),
      ...(choice === undefined ? {} : { choice })
    })
    if (!r.accepted) throw new Error(`${r.code}: ${r.message}`)
    return r
  }
  const end = () => {
    const r = m.dispatch({
      type: 'end-turn',
      participantId: m.getState().activePlayerId!
    })
    expect(r).toMatchObject({ accepted: true })
  }
  const mana = () =>
    m.dispatch({ type: 'dev-set-mana', participantId: id, available: 10, maximum: 10 })
  return { m, id, enemy, me, foe, target, play, end, mana }
}
describe('Yore: Warlock removal and recovery', () => {
  it('Dark Pact destroys and heals eight', () => {
    const s = createYoreScenario({
      aiHealth: 10,
      aiHand: [yoreCard('dark_pact')],
      aiBoard: [{ cardId: 'classic_wisp' }]
    })
    s.play(yoreCard('dark_pact'), s.target())
    expect(s.me().hero.health).toBe(18)
    expect(s.me().board).toHaveLength(0)
  })
  it.each([1, 2, 3])('Touch heals iff target dies: health %s', (health) => {
    const s = createYoreScenario({
      aiHealth: 10,
      aiHand: [yoreCard('touch_of_the_nathrezim')],
      opponentBoard: [{ cardId: 'basic_chillwind_yeti', health, maxHealth: 5 }]
    })
    s.play(yoreCard('touch_of_the_nathrezim'), s.target('enemy'))
    expect(s.me().hero.health).toBe(health <= 2 ? 13 : 10)
    expect(s.foe().board).toHaveLength(health <= 2 ? 0 : 1)
  })
  it('Domino from left hits 2 3 4 and no friendly board', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('domino_effect')],
      aiBoard: [{ cardId: 'classic_wisp' }],
      opponentBoard: Array.from({ length: 3 }, () => ({
        cardId: 'basic_chillwind_yeti',
        health: 10,
        maxHealth: 10
      }))
    })
    s.play(yoreCard('domino_effect'), s.target('enemy'))
    expect(s.foe().board.map((x) => x.health)).toEqual([8, 7, 6])
    expect(s.me().board[0]!.health).toBe(1)
  })
  it.each([0, 1, 2])('Raise Dead returns at most available distinct deaths %s', (n) => {
    const s = createYoreScenario({
      aiHand: [yoreCard('raise_dead')],
      aiGraveyard: ['classic_wisp', 'basic_chillwind_yeti']
        .slice(0, n)
        .map((cardId) => ({ cardId }))
    })
    s.play(yoreCard('raise_dead'))
    expect(s.me().hero.health).toBe(27)
    expect(s.me().hand).toHaveLength(n)
    expect(new Set(s.me().hand.map((x) => x.cardId)).size).toBe(n)
  })
  it('Table Flip discounts other cards and damages enemy board only', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('table_flip'), 'classic_wisp', 'classic_wisp'],
      aiBoard: [{ cardId: 'basic_chillwind_yeti' }],
      opponentBoard: [{ cardId: 'basic_chillwind_yeti' }]
    })
    expect(s.me().hand[0]!.currentCost).toBe(8)
    s.play(yoreCard('table_flip'))
    expect(s.me().mana.available).toBe(2)
    expect(s.me().board[0]!.health).toBe(5)
    expect(s.foe().board[0]!.health).toBe(2)
  })
  it('Domino right edge reverses damage and keeps going after deaths', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('domino_effect')],
      opponentBoard: [
        { cardId: 'basic_chillwind_yeti' },
        { cardId: 'basic_chillwind_yeti', health: 3 },
        { cardId: 'classic_wisp' }
      ]
    })
    s.play(yoreCard('domino_effect'), s.target('enemy', 2))
    expect(s.foe().board).toHaveLength(1)
    expect(s.foe().board[0]!.health).toBe(1)
  })
  it('Domino rejects hero targets without spending card/mana', () => {
    const s = createYoreScenario({ aiHand: [yoreCard('domino_effect')] })
    const before = s.m.getCheckpoint()
    const r = s.m.dispatch({
      type: 'play-card',
      participantId: s.id,
      cardInstanceId: s.me().hand[0]!.instanceId,
      targets: [{ kind: 'hero', participantId: s.enemy }]
    })
    expect(r.accepted).toBe(false)
    expect(s.m.getCheckpoint()).toEqual(before)
  })
  it('Domino rejects elusive primary target', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('domino_effect')],
      opponentBoard: [
        {
          cardId: 'basic_chillwind_yeti',
          keywords: ['spell-immune'],
          spellImmune: true
        }
      ]
    })
    const r = s.m.dispatch({
      type: 'play-card',
      participantId: s.id,
      cardInstanceId: s.me().hand[0]!.instanceId,
      targets: [s.target('enemy')]
    })
    expect(r.accepted).toBe(false)
  })
  it('Domino secondary hits elusive and continues past divine shield', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('domino_effect')],
      opponentBoard: [
        {
          cardId: 'basic_chillwind_yeti',
          keywords: ['divine-shield'],
          divineShield: true
        },
        {
          cardId: 'basic_chillwind_yeti',
          keywords: ['spell-immune'],
          spellImmune: true
        },
        { cardId: 'basic_chillwind_yeti' }
      ]
    })
    s.play(yoreCard('domino_effect'), s.target('enemy'))
    expect(s.foe().board.map((x) => x.health)).toEqual([5, 2, 1])
  })
  it('Raise Dead can return separate deaths of same card', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('raise_dead')],
      aiGraveyard: [{ cardId: 'classic_wisp' }, { cardId: 'classic_wisp' }]
    })
    s.play(yoreCard('raise_dead'))
    expect(s.me().hand.map((x) => x.cardId)).toEqual(['classic_wisp', 'classic_wisp'])
  })
})

describe('Yore: Catacombs and Dorian', () => {
  it('Cat draws only minion, Dorian makes permanent one-cost 1/1, original expires', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('cursed_catacombs')],
      aiDeck: [yoreCard('dark_pact'), yoreCard('agamaggan')],
      aiBoard: [{ cardId: yoreCard('puppetmaster_dorian') }]
    })
    s.play(yoreCard('cursed_catacombs'))
    const d = s.m.getState().pendingDiscover!
    expect(d.candidates.map((x) => x.cardId)).toEqual([yoreCard('agamaggan')])
    expect(
      s.m.dispatch({
        type: 'choose-discover-card',
        participantId: s.id,
        cardInstanceId: d.candidates[0]!.instanceId
      })
    ).toMatchObject({ accepted: true })
    expect(s.me().hand).toHaveLength(2)
    expect(s.me().deck.map((x) => x.cardId)).toEqual([yoreCard('dark_pact')])
    s.end()
    expect(s.me().hand).toHaveLength(1)
    expect(s.me().hand[0]).toMatchObject({
      cardId: yoreCard('agamaggan'),
      currentCost: 1
    })
    s.end()
    s.play(yoreCard('agamaggan'))
    expect(s.me().board.find((x) => x.cardId === yoreCard('agamaggan'))).toMatchObject({
      attack: 1,
      health: 1
    })
  })
  it('Cat empty minion pool ends without choice or fatigue', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('cursed_catacombs')],
      aiDeck: [yoreCard('dark_pact')]
    })
    s.play(yoreCard('cursed_catacombs'))
    expect(s.m.getState().pendingDiscover).toBeUndefined()
    expect(s.me().hero.health).toBe(30)
    expect(s.me().deck).toHaveLength(1)
  })
  it('Cat and Dorian respect ten-card hand limit', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('cursed_catacombs'), ...Array(9).fill('classic_wisp')],
      aiDeck: [yoreCard('agamaggan')],
      aiBoard: [{ cardId: yoreCard('puppetmaster_dorian') }]
    })
    s.play(yoreCard('cursed_catacombs'))
    const d = s.m.getState().pendingDiscover!
    expect(
      s.m.dispatch({
        type: 'choose-discover-card',
        participantId: s.id,
        cardInstanceId: d.candidates[0]!.instanceId
      })
    ).toMatchObject({ accepted: true })
    expect(s.me().hand).toHaveLength(10)
    expect(s.me().deck).toHaveLength(0)
    s.end()
    expect(s.me().hand).toHaveLength(9)
  })
  it('Dorian normal turn draw produces permanent 1/1 copy', () => {
    const s = createYoreScenario({
      aiDeck: ['basic_chillwind_yeti'],
      aiBoard: [{ cardId: yoreCard('puppetmaster_dorian') }]
    })
    s.end()
    s.end()
    expect(s.me().hand).toHaveLength(2)
    expect(
      s
        .me()
        .hand.map((x) => x.currentCost)
        .sort()
    ).toEqual([1, 4])
    s.end()
    expect(s.me().hand).toHaveLength(2)
  })
  it('multiple Dorians each make a separate copy', () => {
    const s = createYoreScenario({
      aiDeck: ['basic_chillwind_yeti'],
      aiBoard: [
        { cardId: yoreCard('puppetmaster_dorian') },
        { cardId: yoreCard('puppetmaster_dorian') }
      ]
    })
    s.end()
    s.end()
    expect(
      s
        .me()
        .hand.map((x) => x.currentCost)
        .sort()
    ).toEqual([1, 1, 4])
  })
})

describe('Yore: Fresh copies and deathrattles', () => {
  it('Cube shallow grave yields four base victims', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('carnivorous_cube'), yoreCard('shallow_grave')],
      aiBoard: [{ cardId: 'basic_chillwind_yeti', attack: 8, health: 8, maxHealth: 8 }]
    })
    s.play(yoreCard('carnivorous_cube'), s.target())
    s.play(yoreCard('shallow_grave'), s.target())
    expect(s.me().board).toHaveLength(4)
    for (const x of s.me().board)
      expect(x).toMatchObject({ cardId: 'basic_chillwind_yeti', attack: 4, health: 5 })
  })
  it('Campaign produces fresh dormant copies', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('cursed_campaign'), yoreCard('dark_pact')],
      aiBoard: [{ cardId: 'basic_chillwind_yeti', attack: 8, health: 8, maxHealth: 8 }]
    })
    s.play(yoreCard('cursed_campaign'), s.target())
    s.play(yoreCard('dark_pact'), s.target())
    expect(s.me().board).toHaveLength(2)
    for (const x of s.me().board)
      expect(x).toMatchObject({
        cardId: 'basic_chillwind_yeti',
        attack: 4,
        health: 5,
        dormant: true
      })
  })
  it('Campaign copies do not recursively inherit the granted deathrattle', () => {
    const s = createYoreScenario({
      aiHand: [
        yoreCard('cursed_campaign'),
        yoreCard('dark_pact'),
        yoreCard('dark_pact')
      ],
      aiBoard: [{ cardId: 'classic_wisp' }],
      aiDeck: Array(8).fill('classic_wisp'),
      opponentDeck: Array(8).fill('classic_wisp')
    })
    s.play(yoreCard('cursed_campaign'), s.target())
    s.play(yoreCard('dark_pact'), s.target())
    s.end()
    s.end()
    s.end()
    s.end()
    s.play(yoreCard('dark_pact'), s.target())
    expect(s.me().board).toHaveLength(1)
  })
  it('Cube stolen after consuming victim summons for current controller', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('carnivorous_cube')],
      aiBoard: [{ cardId: 'basic_chillwind_yeti' }],
      opponentHand: ['basic_mind_control', yoreCard('dark_pact')]
    })
    s.play(yoreCard('carnivorous_cube'), s.target())
    s.end()
    expect(
      s.m.dispatch({
        type: 'dev-set-mana',
        participantId: s.enemy,
        available: 10,
        maximum: 10
      })
    ).toMatchObject({ accepted: true })
    expect(
      s.m.dispatch({
        type: 'play-card',
        participantId: s.enemy,
        cardInstanceId: s.foe().hand.find((x) => x.cardId === 'basic_mind_control')!
          .instanceId,
        targets: [s.target()]
      })
    ).toMatchObject({ accepted: true })
    expect(
      s.m.dispatch({
        type: 'dev-set-mana',
        participantId: s.enemy,
        available: 10,
        maximum: 10
      })
    ).toMatchObject({ accepted: true })
    expect(
      s.m.dispatch({
        type: 'play-card',
        participantId: s.enemy,
        cardInstanceId: s.foe().hand.find((x) => x.cardId === yoreCard('dark_pact'))!
          .instanceId,
        targets: [s.target('enemy')]
      })
    ).toMatchObject({ accepted: true })
    expect(s.foe().board.map((x) => x.cardId)).toEqual([
      'basic_chillwind_yeti',
      'basic_chillwind_yeti'
    ])
    expect(s.me().board).toHaveLength(0)
  })
})

describe('Yore: Dream cards and corruption', () => {
  it('Shala base adds five distinct Dreams', () => {
    const s = createYoreScenario({ aiHand: [yoreCard('shaladrassil')] })
    s.play(yoreCard('shaladrassil'))
    expect(
      s
        .me()
        .hand.map((x) => x.cardId)
        .sort()
    ).toEqual(
      ['dream', 'nightmare', 'laughing_sister', 'emerald_drake', 'ysera_awakens']
        .map(yoreCard)
        .sort()
    )
  })
  it('higher played cost corrupts Shala and produces five upgrades', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('shaladrassil'), 'classic_ysera']
    })
    s.play('classic_ysera')
    expect(s.me().hand.map((x) => x.cardId)).toEqual([
      yoreCard('shaladrassil_corrupted')
    ])
    s.mana()
    s.play(yoreCard('shaladrassil_corrupted'))
    expect(
      s
        .me()
        .hand.map((x) => x.cardId)
        .sort()
    ).toEqual(
      [
        'corrupted_dream',
        'corrupted_nightmare',
        'corrupted_laughing_sister',
        'corrupted_drake',
        'corrupted_awakening'
      ]
        .map(yoreCard)
        .sort()
    )
  })
  it('same cost does not corrupt Shala', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('shaladrassil'), 'classic_ragnaros_the_firelord']
    })
    s.play('classic_ragnaros_the_firelord')
    expect(s.me().hand[0]!.cardId).toBe(yoreCard('shaladrassil'))
  })
  it('Dream bounces and corrupted Dream shuffles', () => {
    for (const name of ['dream', 'corrupted_dream']) {
      const s = createYoreScenario({
        aiHand: [yoreCard(name)],
        opponentBoard: [{ cardId: 'basic_chillwind_yeti' }]
      })
      s.play(yoreCard(name), s.target('enemy'))
      expect(s.foe().board).toHaveLength(0)
      expect(
        (name === 'dream' ? s.foe().hand : s.foe().deck).some(
          (x) => x.cardId === 'basic_chillwind_yeti'
        )
      ).toBe(true)
    }
  })
  it('Nightmare expires at casters next turn', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('nightmare')],
      aiBoard: [{ cardId: 'classic_wisp' }]
    })
    s.play(yoreCard('nightmare'), s.target())
    expect(s.me().board[0]).toMatchObject({ attack: 6, health: 6 })
    s.end()
    expect(s.me().board).toHaveLength(1)
    s.end()
    expect(s.me().board).toHaveLength(0)
  })
  it('corrupted Nightmare immunity expires but stats remain', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('corrupted_nightmare')],
      aiBoard: [{ cardId: 'classic_wisp' }]
    })
    s.play(yoreCard('corrupted_nightmare'), s.target())
    expect(s.me().board[0]).toMatchObject({ attack: 6, health: 6, immune: true })
    s.end()
    expect(s.me().board[0]).toMatchObject({ attack: 6, health: 6 })
    expect(s.me().board[0]!.immune).not.toBe(true)
  })
  it('corrupted Awakening destroys Ysera and damages enemies only', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('corrupted_awakening')],
      aiBoard: [{ cardId: 'classic_ysera' }, { cardId: 'basic_chillwind_yeti' }],
      opponentBoard: [{ cardId: 'classic_ysera' }, { cardId: 'basic_chillwind_yeti' }]
    })
    s.play(yoreCard('corrupted_awakening'))
    expect(s.foe().board).toHaveLength(0)
    expect(s.me().board.map((x) => x.cardId)).toEqual(['basic_chillwind_yeti'])
    expect(s.foe().hero.health).toBe(25)
    expect(s.me().hero.health).toBe(30)
  })
  it('Bob recruit resets a real Nightmare enchantment', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('nightmare'), yoreCard('bob_the_bartender')],
      opponentBoard: [{ cardId: 'basic_chillwind_yeti' }]
    })
    s.play(yoreCard('nightmare'), s.target('enemy'))
    s.play(yoreCard('bob_the_bartender'), s.target('enemy'), 1)
    s.mana()
    s.play('basic_chillwind_yeti')
    expect(s.me().board[1]).toMatchObject({ attack: 4, health: 5, maxHealth: 5 })
  })
  it('Shala full hand never exceeds cap or duplicates Dream cards', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('shaladrassil'), ...Array(8).fill('classic_wisp')]
    })
    s.play(yoreCard('shaladrassil'))
    expect(s.me().hand).toHaveLength(10)
    const dreams = s.me().hand.filter((x) => x.cardId !== 'classic_wisp')
    expect(dreams).toHaveLength(2)
    expect(new Set(dreams.map((x) => x.cardId)).size).toBe(2)
  })
  it('Ysera Awakens leaves Ysera and damages other characters', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('ysera_awakens')],
      aiBoard: [{ cardId: 'classic_ysera' }, { cardId: 'basic_chillwind_yeti' }],
      opponentBoard: [{ cardId: 'classic_ysera' }, { cardId: 'basic_chillwind_yeti' }]
    })
    s.play(yoreCard('ysera_awakens'))
    expect(s.me().hero.health).toBe(25)
    expect(s.foe().hero.health).toBe(25)
    expect(s.me().board.map((x) => x.cardId)).toEqual(['classic_ysera'])
    expect(s.foe().board.map((x) => x.cardId)).toEqual(['classic_ysera'])
  })
  it('Corrupted Sister makes own hero Elusive and loses aura when removed', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('corrupted_laughing_sister'), yoreCard('carnivorous_cube')]
    })
    s.play(yoreCard('corrupted_laughing_sister'))
    expect(s.me().hero.spellImmune).toBe(true)
    s.play(yoreCard('carnivorous_cube'), s.target())
    expect(s.me().hero.spellImmune).not.toBe(true)
  })

  it('Corrupted Dream shuffles a stolen minion into its original owners deck', () => {
    const s = createYoreScenario({
      aiHand: ['basic_mind_control', yoreCard('corrupted_dream')],
      opponentBoard: [{ cardId: 'basic_chillwind_yeti' }]
    })
    s.play('basic_mind_control', s.target('enemy'))
    s.play(yoreCard('corrupted_dream'), s.target())
    expect(s.me().board).toHaveLength(0)
    expect(s.foe().deck.some((x) => x.cardId === 'basic_chillwind_yeti')).toBe(true)
    expect(s.me().deck.some((x) => x.cardId === 'basic_chillwind_yeti')).toBe(false)
  })
  it('Corrupted Sister prevents hero spell and power targeting but not AoE', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('corrupted_laughing_sister')],
      opponentHand: ['basic_fireball', 'basic_hellfire'],
      opponentMaximumMana: 10
    })
    s.play(yoreCard('corrupted_laughing_sister'))
    s.end()
    s.m.dispatch({
      type: 'dev-set-mana',
      participantId: s.enemy,
      available: 10,
      maximum: 10
    })
    expect(
      s.m.dispatch({
        type: 'play-card',
        participantId: s.enemy,
        cardInstanceId: s.foe().hand.find((x) => x.cardId === 'basic_fireball')!
          .instanceId,
        targets: [{ kind: 'hero', participantId: s.id }]
      }).accepted
    ).toBe(false)
    expect(
      s.m.dispatch({
        type: 'use-hero-power',
        participantId: s.enemy,
        target: { kind: 'hero', participantId: s.id }
      }).accepted
    ).toBe(false)
    expect(
      s.m.dispatch({
        type: 'play-card',
        participantId: s.enemy,
        cardInstanceId: s.foe().hand.find((x) => x.cardId === 'basic_hellfire')!
          .instanceId
      }).accepted
    ).toBe(true)
    expect(s.me().hero.health).toBe(27)
  })
})

describe('Yore: Bob choices', () => {
  it('Bob freeze choice freezes enemy board', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('bob_the_bartender')],
      opponentBoard: [{ cardId: 'basic_chillwind_yeti' }]
    })
    s.play(yoreCard('bob_the_bartender'), undefined, 0)
    expect(s.foe().board[0]!.frozenUntilTurn).toBeGreaterThan(0)
  })
  it('Bob recruit copies base stats and gives three coins', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('bob_the_bartender')],
      opponentBoard: [
        { cardId: 'basic_chillwind_yeti', attack: 8, health: 7, maxHealth: 9 }
      ]
    })
    s.play(yoreCard('bob_the_bartender'), s.target('enemy'), 1)
    expect(s.foe().hand.filter((x) => x.cardId === 'basic_the_coin')).toHaveLength(3)
    expect(s.me().hand).toHaveLength(1)
    s.mana()
    s.play('basic_chillwind_yeti')
    expect(s.me().board[1]).toMatchObject({ attack: 4, health: 5, maxHealth: 5 })
  })
  it('Bob refresh discovers exclusively cost-three minions and refreshes three', () => {
    const s = createYoreScenario({ aiHand: [yoreCard('bob_the_bartender')] })
    s.play(yoreCard('bob_the_bartender'), undefined, 2)
    const d = s.m.getState().pendingDiscover!
    expect(d.candidates).toHaveLength(3)
    for (const c of d.candidates)
      expect(CARD_CATALOG.get(c.cardId)).toMatchObject({ type: 'Minion', cost: 3 })
    expect(
      s.m.dispatch({
        type: 'choose-discover-card',
        participantId: s.id,
        cardInstanceId: d.candidates[0]!.instanceId
      })
    ).toMatchObject({ accepted: true })
    expect(s.me().mana.available).toBe(7)
  })
  it('Bob triple draws a minion and gives two copies', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('bob_the_bartender')],
      aiDeck: [yoreCard('dark_pact'), 'basic_chillwind_yeti']
    })
    s.play(yoreCard('bob_the_bartender'), undefined, 3)
    expect(s.me().hand.map((x) => x.cardId)).toEqual(
      Array(3).fill('basic_chillwind_yeti')
    )
    expect(s.me().deck.map((x) => x.cardId)).toEqual([yoreCard('dark_pact')])
  })
})

describe('Yore: Fyrakk randomized Fire budgets', () => {
  it.each(Array.from({ length: 25 }, (_, i) => i + 1))(
    'Fyrakk seed %s casts exactly fifteen printed Mana of Fire without charging mana',
    (seed) => {
      const s = createYoreScenario({
        seed,
        aiHand: [yoreCard('fyrakk_the_blazing')],
        aiArmor: 1000,
        opponentArmor: 1000,
        aiDeck: Array(20).fill('classic_wisp'),
        opponentDeck: Array(20).fill('classic_wisp'),
        opponentBoard: [{ cardId: 'basic_chillwind_yeti' }]
      })
      const r = s.play(yoreCard('fyrakk_the_blazing'))
      const casts = r.events.filter((x) => x.type === 'random-spell-started')
      expect(casts.length).toBeGreaterThan(0)
      let budget = 0
      for (const e of casts) {
        const def = CARD_CATALOG.get(e.cardId)!
        expect(def.type).toBe('Spell')
        expect(def.spellSchool).toBe('Fire')
        budget += def.cost
        expect(budget).toBeLessThanOrEqual(15)
      }
      expect(budget).toBe(15)
      expect(s.me().mana.available).toBe(0)
      expect(s.me().hero.immune).not.toBe(true)
    }
  )
})

describe('Yore: Fyrakk Fire budget', () => {
  it('Fyrakk reduced to 1/1 can die to its own Fire AoE without stopping subsequent casts', () => {
    let proven = false
    for (let seed = 1; seed <= 100 && !proven; seed++) {
      const s = createYoreScenario({
        seed,
        aiHand: [yoreCard('cursed_catacombs')],
        aiBoard: [{ cardId: yoreCard('puppetmaster_dorian') }],
        aiDeck: [yoreCard('fyrakk_the_blazing')],
        aiArmor: 1000,
        opponentArmor: 1000
      })
      s.play(yoreCard('cursed_catacombs'))
      const d = s.m.getState().pendingDiscover!
      expect(
        s.m.dispatch({
          type: 'choose-discover-card',
          participantId: s.id,
          cardInstanceId: d.candidates[0]!.instanceId
        })
      ).toMatchObject({ accepted: true })
      const small = s.me().hand.find((x) => x.currentCost === 1)!
      const r = s.m.dispatch({
        type: 'play-card',
        participantId: s.id,
        cardInstanceId: small.instanceId,
        position: s.me().board.length
      })
      if (!r.accepted) throw new Error(`${r.code}: ${r.message}`)
      const casts = r.events.filter((x) => x.type === 'random-spell-completed')
      const death = casts.findIndex(
        (e) =>
          !e.state.players
            .find((x) => x.participantId === s.id)!
            .board.some((x) => x.cardId === yoreCard('fyrakk_the_blazing'))
      )
      if (death >= 0 && death < casts.length - 1) {
        expect(casts[death]!.cardId).toBe('basic_hellfire')
        expect(casts.reduce((v, e) => v + CARD_CATALOG.get(e.cardId)!.cost, 0)).toBe(15)
        expect(seed).toBe(1)
        proven = true
      }
    }
    expect(proven).toBe(true)
  })
})
describe('Dorian board-only draw trigger regression', () => {
  it('drawing Dorian with an empty board does not copy itself', () => {
    const s = createYoreScenario({ aiDeck: [yoreCard('puppetmaster_dorian')] })
    s.end()
    s.end()
    expect(
      s.me().hand.filter((c) => c.cardId === yoreCard('puppetmaster_dorian'))
    ).toHaveLength(1)
  })
  it('Dorian in hand does not copy another minion drawn', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('puppetmaster_dorian')],
      aiDeck: ['basic_chillwind_yeti']
    })
    s.end()
    s.end()
    expect(s.me().hand.filter((c) => c.cardId === 'basic_chillwind_yeti')).toHaveLength(
      1
    )
  })
  it('board Dorian drawing Dorian creates exactly one small copy', () => {
    const s = createYoreScenario({
      aiBoard: [{ cardId: yoreCard('puppetmaster_dorian') }],
      aiDeck: [yoreCard('puppetmaster_dorian')]
    })
    s.end()
    s.end()
    const cards = s
      .me()
      .hand.filter((c) => c.cardId === yoreCard('puppetmaster_dorian'))
    expect(cards).toHaveLength(2)
    expect(cards.filter((c) => c.currentCost === 1)).toHaveLength(1)
  })
  it('board Dorian does not copy spells', () => {
    const s = createYoreScenario({
      aiBoard: [{ cardId: yoreCard('puppetmaster_dorian') }],
      aiDeck: [yoreCard('dark_pact')]
    })
    s.end()
    s.end()
    expect(s.me().hand.filter((c) => c.cardId === yoreCard('dark_pact'))).toHaveLength(
      1
    )
  })
})
it('lethal health payment ends before Hellfire can kill the caster', () => {
  const f = createAiFixture({
    seed: 2871,
    aiHeroId: 'guldan',
    opponentHeroId: 'jaina',
    aiMana: 0,
    aiHealth: 1,
    opponentHealth: 4,
    aiHand: ['basic_hellfire']
  })
  const checkpoint = structuredClone(f.checkpoint)
  const player = checkpoint.state.players.find(
    (p) => p.participantId === f.aiParticipantId
  )!
  Object.assign(player, { nextCardCostsOpponentHealth: true })
  const m = createOpeningMatchFromCheckpoint(checkpoint)
  const r = m.dispatch({
    type: 'play-card',
    participantId: player.participantId,
    cardInstanceId: player.hand[0]!.instanceId
  })
  expect(r.accepted).toBe(true)
  expect(m.getState().winnerId).toBe(player.participantId)
})
describe('Terminal opponent-health payment ordering', () => {
  function terminal(cardId: string, health: number, board: string[] = []) {
    const f = createAiFixture({
      seed: 2871,
      aiHeroId: 'guldan',
      opponentHeroId: 'jaina',
      aiMana: 0,
      aiHealth: 1,
      opponentHealth: health,
      aiHand: [cardId],
      aiBoard: board.map((cardId) => ({ cardId }))
    })
    const checkpoint = structuredClone(f.checkpoint)
    Object.assign(
      checkpoint.state.players.find((p) => p.participantId === f.aiParticipantId)!,
      { nextCardCostsOpponentHealth: true }
    )
    const m = createOpeningMatchFromCheckpoint(checkpoint)
    const id = f.aiParticipantId,
      enemy = f.localParticipantId
    return {
      m,
      id,
      enemy,
      card: checkpoint.state.players.find((p) => p.participantId === id)!.hand[0]!
    }
  }
  it.each([1, CARD_CATALOG.require('classic_alexstrasza').cost])(
    'Alexstrasza cannot heal an opponent defeated by payment from health %s',
    (health) => {
      const s = terminal('classic_alexstrasza', health)
      const r = s.m.dispatch({
        type: 'play-card',
        participantId: s.id,
        cardInstanceId: s.card.instanceId,
        position: 0,
        targets: [{ kind: 'hero', participantId: s.enemy }]
      })
      expect(r.accepted).toBe(true)
      const state = s.m.getState(),
        me = state.players.find((p) => p.participantId === s.id)!,
        foe = state.players.find((p) => p.participantId === s.enemy)!
      expect(state.winnerId).toBe(s.id)
      expect(foe.hero.health).toBe(0)
      expect(me.nextCardCostsOpponentHealth).toBe(false)
      expect(me.board).toHaveLength(0)
      expect(me.discardedCards?.some((c) => c.cardId === 'classic_alexstrasza')).toBe(
        true
      )
      expect(state.history?.cardsPlayedThisGame).toContain('classic_alexstrasza')
    }
  )
  it('terminal minion payment does not emit on-play buffs or battlecry destruction', () => {
    const s = terminal('classic_deathwing', 1, ['classic_questing_adventurer'])
    const r = s.m.dispatch({
      type: 'play-card',
      participantId: s.id,
      cardInstanceId: s.card.instanceId,
      position: 1
    })
    expect(r.accepted).toBe(true)
    expect(
      s.m.getState().players.find((p) => p.participantId === s.id)!.board
    ).toMatchObject([{ cardId: 'classic_questing_adventurer', attack: 2, health: 2 }])
    expect(s.m.getState().winnerId).toBe(s.id)
  })
  it('terminal deferred Choose One payment does not leave a choice open', () => {
    const s = terminal('blackrock_mountain_druid_of_the_flame', 3)
    const r = s.m.dispatch({
      type: 'play-card',
      participantId: s.id,
      cardInstanceId: s.card.instanceId,
      position: 0
    })
    expect(r.accepted).toBe(true)
    expect(s.m.getState().pendingCardChoice).toBeUndefined()
    expect(s.m.getState().winnerId).toBe(s.id)
  })
})

describe('Catacombs unique deck choices', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])(
    'offers distinct minions from duplicate-rich deck seed %s',
    (seed) => {
      const s = createYoreScenario({
        seed,
        aiHand: [yoreCard('cursed_catacombs')],
        aiDeck: [
          yoreCard('ancient_of_yore'),
          yoreCard('ancient_of_yore'),
          'classic_wisp',
          'classic_wisp',
          yoreCard('agamaggan'),
          yoreCard('dark_pact')
        ]
      })
      const before = s.me().deck.map((x) => x.instanceId)
      s.play(yoreCard('cursed_catacombs'))
      const options = s.m.getState().pendingDiscover!.candidates
      expect(options).toHaveLength(3)
      expect(new Set(options.map((x) => x.cardId)).size).toBe(3)
      expect(options.some((x) => x.cardId === yoreCard('dark_pact'))).toBe(false)
      expect(s.me().deck.map((x) => x.instanceId)).toEqual(before)
      const chosen = options[0]!
      expect(
        s.m.dispatch({
          type: 'choose-discover-card',
          participantId: s.id,
          cardInstanceId: chosen.instanceId
        })
      ).toMatchObject({ accepted: true })
      expect(s.me().deck.map((x) => x.instanceId)).toEqual(
        before.filter((x) => x !== chosen.instanceId)
      )
      expect(s.me().hand[0]!.instanceId).toBe(chosen.instanceId)
    }
  )
  it('shows one option for two copies and leaves the unchosen copy intact', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('cursed_catacombs')],
      aiDeck: [yoreCard('agamaggan'), yoreCard('agamaggan')]
    })
    s.play(yoreCard('cursed_catacombs'))
    const options = s.m.getState().pendingDiscover!.candidates
    expect(options).toHaveLength(1)
    expect(
      s.m.dispatch({
        type: 'choose-discover-card',
        participantId: s.id,
        cardInstanceId: options[0]!.instanceId
      })
    ).toMatchObject({ accepted: true })
    expect(s.me().deck).toHaveLength(1)
    expect(s.me().deck[0]!.instanceId).not.toBe(options[0]!.instanceId)
  })
})
describe('Bounded list alternative timing', () => {
  it('Power Overwhelming Campaign reset misses immediate Ancient end-turn value', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('cursed_campaign'), 'classic_power_overwhelming'],
      aiBoard: [{ cardId: yoreCard('ancient_of_yore'), ready: true }],
      aiDeck: Array(8).fill('classic_wisp')
    })
    s.play(yoreCard('cursed_campaign'), s.target())
    s.play('classic_power_overwhelming', s.target())
    expect(s.me().board[0]!.attack).toBe(9)
    s.end()
    expect(s.me().board).toHaveLength(2)
    expect(s.me().board.every((x) => x.dormant)).toBe(true)
    expect(s.me().hero.armor ?? 0).toBe(0)
    expect(s.me().hand).toHaveLength(0)
    s.end()
    s.end()
    expect(s.me().hero.armor).toBe(6)
    expect(s.me().hand).toHaveLength(3)
  })
})
describe('Shaladrassil fun-first recovery', () => {
  it.each([0, 1000])(
    'returns early Agamaggan and rebuilds the chain through %s Armor',
    (opponentArmor) => {
      const s = createYoreScenario({
        seed: 2871,
        opponentArmor,
        aiHand: [
          yoreCard('agamaggan'),
          yoreCard('shaladrassil'),
          yoreCard('cursed_catacombs'),
          yoreCard('fyrakk_the_blazing')
        ],
        aiBoard: [{ cardId: yoreCard('puppetmaster_dorian') }],
        aiDeck: Array(20).fill(yoreCard('dark_pact'))
      })
      s.play(yoreCard('agamaggan'))
      expect(
        s.me().hand.some((x) => x.cardId === yoreCard('shaladrassil_corrupted'))
      ).toBe(true)
      expect(s.me().mana.available).toBe(0)
      s.play(yoreCard('shaladrassil_corrupted'))
      expect(s.foe().hero.health).toBe(22)
      expect(s.foe().hero.armor).toBe(opponentArmor)
      expect(
        s.me().hand.filter((x) => x.cardId.startsWith(yoreCard('corrupted_')))
      ).toHaveLength(5)
      const agam = s.me().board.findIndex((x) => x.cardId === yoreCard('agamaggan'))
      s.play(yoreCard('corrupted_dream'), s.target('self', agam))
      expect(s.me().board.some((x) => x.cardId === yoreCard('agamaggan'))).toBe(false)
      expect(s.me().deck.some((x) => x.cardId === yoreCard('agamaggan'))).toBe(true)
      s.end()
      s.end()
      if (opponentArmor === 0) s.play(yoreCard('corrupted_awakening'))
      s.play(yoreCard('cursed_catacombs'))
      const choice = s.m
        .getState()
        .pendingDiscover!.candidates.find((x) => x.cardId === yoreCard('agamaggan'))!
      expect(choice).toBeDefined()
      expect(
        s.m.dispatch({
          type: 'choose-discover-card',
          participantId: s.id,
          cardInstanceId: choice.instanceId
        })
      ).toMatchObject({ accepted: true })
      const small = s
        .me()
        .hand.find((x) => x.cardId === yoreCard('agamaggan') && x.currentCost === 1)!
      expect(small).toMatchObject({ attack: 1, health: 1 })
      expect(small.temporaryUntilTurn).toBeUndefined()
      expect(
        s.m.dispatch({
          type: 'play-card',
          participantId: s.id,
          cardInstanceId: small.instanceId,
          position: s.me().board.length
        })
      ).toMatchObject({ accepted: true })
      s.play(yoreCard('agamaggan'))
      expect(s.foe().hero.health).toBe(opponentArmor === 0 ? 7 : 12)
      s.play(yoreCard('fyrakk_the_blazing'))
      expect(s.foe().hero.health).toBe(opponentArmor === 0 ? 0 : 2)
      expect(s.me().mana.available).toBe(opponentArmor === 0 ? 7 : 9)
      expect(s.me().nextCardCostsOpponentHealth).toBeFalsy()
      if (opponentArmor === 0) expect(s.m.getState().phase).toBe('ended')
    }
  )
})

describe('Yore: timed Dormancy and Ancient income', () => {
  it('Ancient earns two dormant end turns, then wakes on its second owner start', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('ancient_of_yore')],
      aiDeck: Array(12).fill('classic_wisp'),
      opponentDeck: Array(12).fill('classic_wisp')
    })
    s.play(yoreCard('ancient_of_yore'))
    expect(s.me().board[0]).toMatchObject({ dormant: true, dormantTurnsRemaining: 2 })
    s.end()
    expect(s.me().hero.armor).toBe(3)
    expect(s.me().hand).toHaveLength(1)
    expect(s.me().board[0]!.dormantTurnsRemaining).toBe(2)
    s.end()
    expect(s.me().board[0]).toMatchObject({ dormant: true, dormantTurnsRemaining: 1 })
    s.end()
    expect(s.me().hero.armor).toBe(6)
    expect(s.me().hand).toHaveLength(3)
    s.end()
    expect(s.me().board[0]!.dormant).toBe(false)
    expect(s.me().board[0]!.dormantTurnsRemaining).toBeUndefined()
    s.end()
    expect(s.me().hero.armor).toBe(6)
    expect(s.me().hand).toHaveLength(4)
  })
  it('Maiev pauses a damaged enemy for its next two starts without healing it', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('maiev_shadowsong')],
      opponentBoard: [{ cardId: 'basic_chillwind_yeti', health: 2, maxHealth: 5 }],
      aiDeck: Array(8).fill('classic_wisp'),
      opponentDeck: Array(8).fill('classic_wisp')
    })
    s.play(yoreCard('maiev_shadowsong'), s.target('enemy'))
    expect(s.foe().board[0]).toMatchObject({
      dormant: true,
      dormantTurnsRemaining: 2,
      health: 2
    })
    s.end()
    expect(s.foe().board[0]).toMatchObject({
      dormant: true,
      dormantTurnsRemaining: 1,
      health: 2
    })
    s.end()
    expect(s.foe().board[0]!.dormantTurnsRemaining).toBe(1)
    s.end()
    expect(s.foe().board[0]).toMatchObject({ dormant: false, health: 2 })
  })
  it('Dormant Ancient rejects targeted removal and ignores enemy AoE', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('ancient_of_yore'), yoreCard('dark_pact'), 'basic_hellfire']
    })
    s.play(yoreCard('ancient_of_yore'))
    const r = s.m.dispatch({
      type: 'play-card',
      participantId: s.id,
      cardInstanceId: s.me().hand.find((c) => c.cardId === yoreCard('dark_pact'))!
        .instanceId,
      targets: [s.target()]
    })
    expect(r.accepted).toBe(false)
    s.play('basic_hellfire')
    expect(s.me().board[0]).toMatchObject({ dormant: true, health: 5 })
  })
  it('Maiev suppresses ordinary end-turn triggers while Dormant', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('maiev_shadowsong')],
      opponentBoard: [{ cardId: 'classic_ysera' }],
      opponentDeck: Array(6).fill('classic_wisp')
    })
    s.play(yoreCard('maiev_shadowsong'), s.target('enemy'))
    s.end()
    const hand = s.foe().hand.map((c) => c.cardId)
    s.end()
    expect(s.foe().hand.map((c) => c.cardId)).toEqual(hand)
  })
})

describe('Yore: persistent opponent Health resource', () => {
  it('Agamaggan survives a round and pays for the next spell without spending Mana or Armor', () => {
    const s = createYoreScenario({
      aiHealth: 20,
      opponentArmor: 77,
      aiHand: [yoreCard('agamaggan'), yoreCard('dark_pact')],
      aiDeck: Array(6).fill('classic_wisp'),
      opponentDeck: Array(6).fill('classic_wisp')
    })
    s.play(yoreCard('agamaggan'))
    s.end()
    s.end()
    expect(s.me().nextCardCostsOpponentHealth).toBe(true)
    const mana = s.me().mana.available
    s.play(yoreCard('dark_pact'), s.target())
    expect(s.me().mana.available).toBe(mana)
    expect(s.foe().hero).toMatchObject({ health: 29, armor: 77 })
    expect(s.me().hero.health).toBe(28)
    expect(s.me().nextCardCostsOpponentHealth).toBe(false)
  })
  it('Agamaggan rejects an actual cost above ten without consuming its modifier', () => {
    const s = createYoreScenario({
      aiHand: [yoreCard('agamaggan'), 'classic_molten_giant']
    })
    s.play(yoreCard('agamaggan'))
    const giant = s.me().hand.find((c) => c.cardId === 'classic_molten_giant')!
    expect(giant.currentCost).toBe(20)
    const before = s.m.getCheckpoint()
    const r = s.m.dispatch({
      type: 'play-card',
      participantId: s.id,
      cardInstanceId: giant.instanceId,
      position: 1
    })
    expect(r.accepted).toBe(false)
    expect(s.m.getCheckpoint()).toEqual(before)
    expect(s.me().nextCardCostsOpponentHealth).toBe(true)
  })
})

describe('Yore: Domino adjacent Dormant barrier', () => {
  it.each([0, 2])(
    'stops at the dormant middle slot when starting at edge %s',
    (edge) => {
      const s = createYoreScenario({
        aiHand: [yoreCard('maiev_shadowsong'), yoreCard('domino_effect')],
        opponentBoard: Array.from({ length: 3 }, () => ({
          cardId: 'basic_chillwind_yeti'
        }))
      })
      s.play(yoreCard('maiev_shadowsong'), s.target('enemy', 1))
      s.play(yoreCard('domino_effect'), s.target('enemy', edge))
      expect(s.foe().board.map((c) => c.health)).toEqual(
        edge === 0 ? [3, 5, 5] : [5, 5, 3]
      )
      expect(s.foe().board[1]!.dormant).toBe(true)
    }
  )
})

describe('Yore: Dormant spell damage conditions', () => {
  it.each([false, true])(
    'Spirit Claws excludes a sleeping Drake, active second source %s',
    (secondSource) => {
      const s = createYoreScenario({
        aiHand: [yoreCard('maiev_shadowsong')],
        opponentBoard: [
          { cardId: 'classic_azure_drake' },
          ...(secondSource ? [{ cardId: 'basic_kobold_geomancer' }] : [])
        ],
        opponentWeapon: { cardId: 'one_night_in_karazhan_spirit_claws' },
        aiDeck: Array(8).fill('classic_wisp'),
        opponentDeck: Array(8).fill('classic_wisp')
      })
      s.play(yoreCard('maiev_shadowsong'), s.target('enemy'))
      expect(s.foe().board[0]!.dormant).toBe(true)
      expect(s.foe().weapon!.attack).toBe(secondSource ? 3 : 1)
      s.end()
      s.end()
      s.end()
      expect(s.foe().board[0]!.dormant).toBe(false)
      expect(s.foe().weapon!.attack).toBe(3)
    }
  )
})
