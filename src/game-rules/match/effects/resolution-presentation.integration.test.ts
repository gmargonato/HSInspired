import { getDerivedState, resolveCardPlay } from './effect-runtime'
import { CARD_CATALOG } from '../../content/cards'
import { validateCardSet } from '../../content/cards/card-validator'
import type { OpeningMatchEvent, OpeningMatchState } from '../opening-match-types'
import type { PlayerId } from '../match-types'
import { describe, expect, it, vi } from 'vitest'
import { createSeededRng } from '../rng'
import { createMatchScenario } from '../testing/match-scenario-builder'
import { getOpeningMatchPublicEvents } from '../match-public-projection'

type Scenario = ReturnType<typeof createMatchScenario>

function deckAdditions(events: readonly OpeningMatchEvent[]) {
  return events.flatMap((event) =>
    event.type === 'effect-resolved' && event.deckAddition ? [event.deckAddition] : []
  )
}

describe('deck addition presentation', () => {
  it.each([
    [
      'league_of_explorers_elise_starseeker',
      'league_of_explorers_map_to_the_golden_monkey',
      1
    ],
    [
      'league_of_explorers_map_to_the_golden_monkey',
      'league_of_explorers_golden_monkey',
      1
    ],
    ['league_of_explorers_forgotten_torch', 'league_of_explorers_roaring_torch', 1],
    ['league_of_explorers_excavated_evil', 'league_of_explorers_excavated_evil', 1],
    ['league_of_explorers_ancient_shade', 'league_of_explorers_ancient_curse', 1],
    ['goblins_vs_gnomes_iron_juggernaut', 'goblins_vs_gnomes_burrowing_mine', 1],
    ['the_grand_tournament_beneath_the_grounds', 'the_grand_tournament_ambush', 3],
    ['journey_to_ungoro_queen_carnassa', 'journey_to_ungoro_carnassas_brood', 20]
  ] as const)(
    '%s captures every inserted card once',
    (sourceId, generatedId, count) => {
      const f = damagePhaseFixture(sourceId)
      const result = f.play(
        sourceId === 'league_of_explorers_forgotten_torch' ? 'hero' : undefined
      )
      const batches = deckAdditions(result.events)
      expect(batches).toHaveLength(1)
      expect(batches[0].cards).toHaveLength(count)
      expect(new Set(batches[0].cards.map(({ card }) => card.instanceId)).size).toBe(
        count
      )
      expect(
        batches[0].cards.every(
          ({ card, visibleTo }) => card.cardId === generatedId && visibleTo === 'all'
        )
      ).toBe(true)
      const destination =
        sourceId === 'goblins_vs_gnomes_iron_juggernaut' ||
        sourceId === 'the_grand_tournament_beneath_the_grounds' ||
        sourceId === 'league_of_explorers_excavated_evil'
          ? f.enemy
          : f.self
      expect(batches[0].participantId).toBe(destination)
      for (const viewer of [f.self, f.enemy]) {
        const publicBatch = getOpeningMatchPublicEvents(result.events, viewer).flatMap(
          (e) =>
            e.type === 'effect-resolved' && e.deckAddition ? [e.deckAddition] : []
        )[0]
        expect(publicBatch.cards.every(({ card }) => card.cardId === generatedId)).toBe(
          true
        )
        expect(
          publicBatch.cards.every(
            (entry) => !('visibleTo' in entry) && !('knownTo' in entry.card)
          )
        ).toBe(true)
      }
    }
  )

  it('keeps the Monkey snapshot before an immediate draw removes it from the deck', () => {
    const f = damagePhaseFixture('league_of_explorers_map_to_the_golden_monkey')
    const state = f.s.match.getState()
    const result = resolveCardPlay({
      state: {
        ...state,
        players: [
          state.players[0].participantId === f.self
            ? { ...state.players[0], deck: [] }
            : state.players[0],
          state.players[1].participantId === f.self
            ? { ...state.players[1], deck: [] }
            : state.players[1]
        ]
      },
      participantId: f.self,
      cardInstanceId: f.player(f.self).hand[0].instanceId,
      rng: createSeededRng(99)
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) throw new Error(result.message)
    const batch = deckAdditions(result.events)[0]
    const additionIndex = result.events.findIndex(
      (e) => e.type === 'effect-resolved' && !!e.deckAddition
    )
    const drawIndex = result.events.findIndex(
      (e) =>
        e.type === 'card-drawn' && e.card.instanceId === batch.cards[0].card.instanceId
    )
    expect(drawIndex).toBeGreaterThan(additionIndex)
    expect(batch.cards[0].card.zone).toBe('deck')
    expect(
      result.state.players.find((p) => p.participantId === f.self)!.deck
    ).toHaveLength(0)
  })

  it.each([
    'journey_to_ungoro_raptor_hatchling',
    'journey_to_ungoro_direhorn_hatchling',
    'mean_streets_of_gadgetzan_white_eyes',
    'mean_streets_of_gadgetzan_weasel_tunneler',
    'goblins_vs_gnomes_malorne',
    'goblins_vs_gnomes_iron_juggernaut'
  ])('captures %s deathrattle without requiring a live board body', (cardId) => {
    const f = damagePhaseFixture('basic_assassinate')
    const source = f.summon(cardId)
    const result = f.play(source)
    const batch = deckAdditions(result.events)[0]
    expect(batch).toBeDefined()
    expect(batch.sourceInstanceId).toBe(source.instanceId)
    expect(batch.cards).toHaveLength(1)
    expect(f.player().board.some((m) => m.instanceId === source.instanceId)).toBe(false)
  })

  it.each([
    'blackrock_mountain_gang_up',
    'league_of_explorers_entomb',
    'goblins_vs_gnomes_recycle'
  ])('%s retains its board movement without a duplicate addition', (cardId) => {
    const f = damagePhaseFixture(cardId)
    const result = f.play(f.summon('basic_chillwind_yeti'))
    expect(deckAdditions(result.events)).toHaveLength(0)
    expect(
      result.events.filter(
        (e) => e.type === 'effect-resolved' && e.cardMovement?.destination === 'deck'
      )
    ).toHaveLength(1)
  })

  it.each([
    'knights_of_the_frozen_throne_dead_mans_hand',
    'knights_of_the_frozen_throne_archbishop_benedictus'
  ])('%s masks hidden-zone copies by viewer', (cardId) => {
    const f = damagePhaseFixture(cardId)
    const expected = cardId.endsWith('dead_mans_hand')
      ? f.player(f.self).hand.length - 1
      : f.player().deck.length
    const result = f.play()
    const batches = deckAdditions(result.events)
    expect(batches).toHaveLength(1)
    expect(batches[0].cards).toHaveLength(expected)
    for (const viewer of [f.self, f.enemy]) {
      const publicEvents = getOpeningMatchPublicEvents(result.events, viewer)
      const publicBatch = publicEvents.flatMap((e) =>
        e.type === 'effect-resolved' && e.deckAddition ? [e.deckAddition] : []
      )[0]
      const visible = cardId.endsWith('dead_mans_hand') && viewer === f.self
      expect(
        publicBatch.cards.every(({ card }) =>
          visible ? card.cardId !== null : card.cardId === null
        )
      ).toBe(true)
      if (!visible) {
        expect(
          publicEvents
            .filter((e) => e.type === 'effect-resolved' && e.action === 'copy')
            .every((e) => e.type === 'effect-resolved' && e.data?.cardId === null)
        ).toBe(true)
      }
    }
  })

  it('gives one Latorvius reward to hand and batches the eight hidden deck rewards', () => {
    const f = damagePhaseFixture('journey_to_ungoro_latorvius_gaze_of_the_city')
    const handIds = new Set(f.player(f.self).hand.map((card) => card.instanceId))
    const deckSize = f.player(f.self).deck.length
    const result = f.play()
    const rewards = f
      .player(f.self)
      .hand.filter((card) => !handIds.has(card.instanceId))
    expect(rewards).toHaveLength(1)
    const batches = deckAdditions(result.events)
    expect(batches).toHaveLength(1)
    expect(batches[0].cards).toHaveLength(8)
    expect(f.player(f.self).deck).toHaveLength(deckSize + 8)
    expect(
      new Set(
        [...rewards, ...batches[0].cards.map(({ card }) => card)].map(
          (card) => card.cardId
        )
      ).size
    ).toBe(9)
    for (const viewer of [f.self, f.enemy]) {
      const batch = getOpeningMatchPublicEvents(result.events, viewer).flatMap((e) =>
        e.type === 'effect-resolved' && e.deckAddition ? [e.deckAddition] : []
      )[0]
      expect(batch.cards.every(({ card }) => card.cardId === null)).toBe(true)
    }
  })

  it('batches all three Jade Idols after choosing shuffle', () => {
    const f = damagePhaseFixture('mean_streets_of_gadgetzan_jade_idol')
    const result = f.s.match.dispatch({
      type: 'play-card',
      participantId: f.self,
      cardInstanceId: f.player(f.self).hand[0].instanceId,
      choice: 1
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) throw new Error(result.message)
    expect(deckAdditions(result.events)).toHaveLength(1)
    expect(deckAdditions(result.events)[0].cards).toHaveLength(3)
  })

  it.each([false, true])(
    'Doomcaller only presents a successful shuffle (dead=%s)',
    (cthunDied) => {
      const f = damagePhaseFixture('whispers_of_the_old_gods_doomcaller')
      const state = f.s.match.getState()
      const change = (p: (typeof state.players)[number]) =>
        p.participantId === f.self ? { ...p, cthunDied } : p
      const result = resolveCardPlay({
        state: {
          ...state,
          players: [change(state.players[0]), change(state.players[1])]
        },
        participantId: f.self,
        cardInstanceId: f.player(f.self).hand[0].instanceId,
        position: 0,
        rng: createSeededRng(99)
      })
      expect(result.accepted).toBe(true)
      if (!result.accepted) throw new Error(result.message)
      expect(deckAdditions(result.events)).toHaveLength(cthunDied ? 1 : 0)
      if (cthunDied)
        expect(deckAdditions(result.events)[0].cards[0].card.cardId).toBe(
          'whispers_of_the_old_gods_cthun'
        )
    }
  )

  it('retains Manic Soulcaster board-copy materialization', () => {
    const f = damagePhaseFixture('mean_streets_of_gadgetzan_manic_soulcaster')
    const target = f.summon('basic_chillwind_yeti', f.self)
    const result = f.s.match.dispatch({
      type: 'play-card',
      participantId: f.self,
      cardInstanceId: f.player(f.self).hand[0].instanceId,
      position: 0,
      targets: [
        { kind: 'minion', participantId: f.self, instanceId: target.instanceId }
      ]
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) throw new Error(result.message)
    expect(deckAdditions(result.events)).toHaveLength(0)
    const movement = result.events.flatMap((e) =>
      e.type === 'effect-resolved' && e.cardMovement ? [e.cardMovement] : []
    )[0]
    expect(movement).toMatchObject({
      destination: 'deck',
      copy: true,
      sourceInstanceId: target.instanceId
    })
    expect(movement.cards).toHaveLength(1)
  })

  it('presents Ninja returns enabled by Master Dusk', () => {
    const f = damagePhaseFixture('basic_hellfire')
    const ninja = f.summon('journey_to_ungoro_tortollan_ninja')
    const state = f.s.match.getState()
    const change = (p: (typeof state.players)[number]) =>
      p.participantId === f.enemy ? { ...p, ninjaCycle: true } : p
    const result = resolveCardPlay({
      state: {
        ...state,
        players: [change(state.players[0]), change(state.players[1])]
      },
      participantId: f.self,
      cardInstanceId: f.player(f.self).hand[0].instanceId,
      rng: createSeededRng(99)
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) throw new Error(result.message)
    expect(deckAdditions(result.events)[0]).toMatchObject({
      sourceInstanceId: ninja.instanceId,
      participantId: f.enemy,
      cards: [{ card: { cardId: ninja.cardId }, visibleTo: 'all' }]
    })
  })
})

function activePlayers(scenario: Scenario) {
  const active = scenario.match.getState().activePlayerId!
  return [
    active,
    scenario.participants.find((participantId) => participantId !== active)!
  ] as const
}

function player(scenario: Scenario, participantId: string) {
  return scenario.match
    .getState()
    .players.find((candidate) => candidate.participantId === participantId)!
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

function setMana(scenario: Scenario, participantId: string): void {
  expect(
    scenario.match.dispatch({
      type: 'dev-set-mana',
      participantId,
      available: 10,
      maximum: 10
    }).accepted
  ).toBe(true)
}

function summon(
  scenario: Scenario,
  participantId: string,
  cardId: string,
  position?: number
): void {
  expect(
    scenario.match.dispatch({
      type: 'dev-summon-minion',
      participantId,
      cardId,
      ...(position === undefined ? {} : { position })
    }).accepted
  ).toBe(true)
}

function play(
  scenario: Scenario,
  participantId: string,
  cardId: string,
  targets: readonly { kind: 'minion'; participantId: string; instanceId: string }[]
) {
  const card = player(scenario, participantId).hand.find(
    (candidate) => candidate.cardId === cardId
  )
  expect(card).toBeDefined()
  return scenario.match.dispatch({
    type: 'play-card',
    participantId,
    cardInstanceId: card!.instanceId,
    ...(CARD_CATALOG.require(cardId).type === 'Minion' ? { position: 0 } : {}),
    targets
  })
}

describe('resolution presentation events', () => {
  it('preserves the hand origin of Dirty Rat pulls without treating them as plays', () => {
    const scenario = createMatchScenario({ seed: 1701 })
    scenario.confirmBothMulligans()
    const [active, opponent] = activePlayers(scenario)
    addCard(scenario, active, 'mean_streets_of_gadgetzan_dirty_rat')
    addCard(scenario, opponent, 'basic_boulderfist_ogre')
    setMana(scenario, active)
    const handIds = new Set(
      player(scenario, opponent).hand.map((card) => card.instanceId)
    )
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: active,
      cardInstanceId: player(scenario, active).hand.find(
        (card) => card.cardId === 'mean_streets_of_gadgetzan_dirty_rat'
      )!.instanceId,
      position: 0,
      targets: []
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    const pulled = result.events.find(
      (event) => event.type === 'minion-summoned' && event.participantId === opponent
    )
    expect(pulled).toMatchObject({ type: 'minion-summoned', sourceZone: 'hand' })
    if (pulled?.type !== 'minion-summoned') throw new Error('Missing pulled minion')
    expect(handIds.has(pulled.minion.instanceId)).toBe(true)
    expect(
      result.events.some(
        (event) => event.type === 'minion-played' && event.participantId === opponent
      )
    ).toBe(false)
  })

  it('does not label Alleycat generated summons as hand arrivals', () => {
    const scenario = createMatchScenario({ seed: 1702 })
    scenario.confirmBothMulligans()
    const [active] = activePlayers(scenario)
    addCard(scenario, active, 'mean_streets_of_gadgetzan_alleycat')
    setMana(scenario, active)
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: active,
      cardInstanceId: player(scenario, active).hand.find(
        (card) => card.cardId === 'mean_streets_of_gadgetzan_alleycat'
      )!.instanceId,
      position: 0,
      targets: []
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    const tabby = result.events.find(
      (event) =>
        event.type === 'minion-summoned' &&
        event.minion.cardId === 'mean_streets_of_gadgetzan_tabbycat'
    )
    expect(tabby).toBeDefined()
    if (tabby?.type !== 'minion-summoned') throw new Error('Missing Tabbycat')
    expect(tabby.sourceZone).toBeUndefined()
    expect(
      result.events.some(
        (event) =>
          event.type === 'minion-played' &&
          event.minion.cardId === 'mean_streets_of_gadgetzan_alleycat'
      )
    ).toBe(true)
  })

  it('reports Healing Totem full values for undamaged friendly minions', () => {
    const scenario = createMatchScenario({ seed: 1698 })
    scenario.confirmBothMulligans()
    const [participantId] = activePlayers(scenario)
    summon(scenario, participantId, 'basic_healing_totem')
    summon(scenario, participantId, 'basic_boulderfist_ogre')
    const friendlyIds = new Set(
      player(scenario, participantId).board.map((minion) => minion.instanceId)
    )

    const result = scenario.match.dispatch({ type: 'end-turn', participantId })

    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    const restores = result.events.filter(
      (event) =>
        event.type === 'effect-resolved' &&
        event.action === 'restore' &&
        event.sourceCardId === 'basic_healing_totem' &&
        typeof event.data?.target === 'string' &&
        friendlyIds.has(event.data.target)
    )
    expect(restores).toHaveLength(2)
    expect(restores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({ amount: 0, displayAmount: 1 })
        }),
        expect.objectContaining({
          data: expect.objectContaining({ amount: 0, displayAmount: 1 })
        })
      ])
    )
  })

  it("reports Alexstrasza's actual hero health after setting it to fifteen", () => {
    const scenario = createMatchScenario({ seed: 1697 })
    scenario.confirmBothMulligans()
    const [participantId] = activePlayers(scenario)
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
        type: 'dev-set-hero',
        participantId,
        health: 10
      }).accepted
    ).toBe(true)
    addCard(scenario, participantId, 'classic_alexstrasza')

    const alexstrasza = player(scenario, participantId).hand.find(
      (card) => card.cardId === 'classic_alexstrasza'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: alexstrasza.instanceId,
      targets: [{ kind: 'hero', participantId }],
      position: 0
    })

    expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
    if (!result.accepted) return
    expect(player(scenario, participantId).hero.health).toBe(15)
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'effect-resolved',
        action: 'set-health',
        data: expect.objectContaining({
          target: `${participantId}:hero`,
          health: 15,
          healthBefore: 10,
          healthAfter: 15,
          maximumHealthAfter: 30
        })
      })
    )
  })

  it.each(['classic_molten_giant', 'classic_mountain_giant'])(
    'does not activate %s hand-only cost effect from the board',
    (cardId) => {
      const scenario = createMatchScenario({ seed: 1699 })
      scenario.confirmBothMulligans()
      const [participantId] = activePlayers(scenario)

      const result = scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId,
        cardId
      })

      expect(result.accepted).toBe(true)
      if (!result.accepted) return
      const giant = player(scenario, participantId).board[0]!
      expect(
        result.events.filter(
          (event) =>
            event.type === 'trigger-activated' &&
            event.source.instanceId === giant.instanceId
        )
      ).toHaveLength(0)
    }
  )

  it('emits one trigger cue for every actual Acolyte damage trigger', () => {
    const scenario = createMatchScenario({ seed: 1700 })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    summon(scenario, opponentId, 'classic_acolyte_of_pain')
    setMana(scenario, participantId)
    addCard(scenario, participantId, 'basic_fireball')

    const acolyte = player(scenario, opponentId).board[0]!
    const result = play(scenario, participantId, 'basic_fireball', [
      { kind: 'minion', participantId: opponentId, instanceId: acolyte.instanceId }
    ])
    expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
    if (!result.accepted) return

    const cues = result.events.filter(
      (event) =>
        event.type === 'trigger-activated' &&
        event.source.instanceId === acolyte.instanceId
    )
    expect(cues).toHaveLength(1)
    expect(cues[0]).toMatchObject({
      trigger: 'on-damage',
      eventType: 'damage-dealt',
      parentActivationId: null
    })
    const cueIndex = result.events.indexOf(cues[0]!)
    const drawIndex = result.events.findIndex(
      (event, index) => index > cueIndex && event.type === 'card-drawn'
    )
    expect(drawIndex).toBeGreaterThan(cueIndex)
    expect(
      result.events.find(
        (event) =>
          event.type === 'effect-resolved' &&
          event.action === 'damage' &&
          event.data?.target === acolyte.instanceId
      )
    ).toMatchObject({
      data: { actualDamage: 3, displayAmount: 6, healthAfter: 0 }
    })
  })

  it('exposes Frothing attack modifications after each damaged minion', () => {
    const scenario = createMatchScenario({ seed: 1701 })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    summon(scenario, participantId, 'classic_frothing_berserker')
    summon(scenario, opponentId, 'basic_acidic_swamp_ooze')
    setMana(scenario, participantId)
    addCard(scenario, participantId, 'basic_fireball')

    const target = player(scenario, opponentId).board[0]!
    const result = play(scenario, participantId, 'basic_fireball', [
      { kind: 'minion', participantId: opponentId, instanceId: target.instanceId }
    ])
    expect(result.accepted).toBe(true)
    if (!result.accepted) return

    const frothing = player(scenario, participantId).board[0]!
    expect(frothing.attack).toBe(3)
    const cueIndex = result.events.findIndex(
      (event) =>
        event.type === 'trigger-activated' &&
        event.source.instanceId === frothing.instanceId
    )
    expect(cueIndex).toBeGreaterThanOrEqual(0)
    const modify = result.events.find(
      (event, index) =>
        index > cueIndex &&
        event.type === 'effect-resolved' &&
        event.action === 'modify' &&
        event.data?.target === frothing.instanceId
    )
    expect(modify).toMatchObject({
      type: 'effect-resolved',
      action: 'modify',
      data: { attackBefore: 2, attackAfter: 3 }
    })
  })

  it('starts combat before damage effects so reactive chains can be presented in order', () => {
    const scenario = createMatchScenario({ seed: 1703 })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    summon(scenario, participantId, 'classic_acolyte_of_pain')
    summon(scenario, opponentId, 'basic_acidic_swamp_ooze')
    expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
    const attacker = player(scenario, opponentId).board[0]!
    const defender = player(scenario, participantId).board[0]!
    const result = scenario.match.dispatch({
      type: 'attack-character',
      participantId: opponentId,
      attacker: { kind: 'minion', instanceId: attacker.instanceId },
      defender: { kind: 'minion', instanceId: defender.instanceId }
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    const startIndex = result.events.findIndex(
      (event) => event.type === 'combat-started'
    )
    const damageIndex = result.events.findIndex(
      (event) => event.type === 'effect-resolved' && event.action === 'damage'
    )
    const resolvedIndex = result.events.findIndex(
      (event) =>
        event.type === 'minion-combat-resolved' ||
        event.type === 'character-combat-resolved'
    )
    expect(startIndex).toBeGreaterThanOrEqual(0)
    expect(damageIndex).toBeGreaterThan(startIndex)
    expect(resolvedIndex).toBeGreaterThan(damageIndex)
  })

  it('brackets simultaneous deaths and repeated Deathrattle activations', () => {
    const scenario = createMatchScenario({ seed: 1702 })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    summon(scenario, participantId, 'classic_abomination')
    summon(scenario, participantId, 'naxxramas_baron_rivendare')
    expect(scenario.match.dispatch({ type: 'end-turn', participantId }).accepted).toBe(
      true
    )
    setMana(scenario, opponentId)
    addCard(scenario, opponentId, 'basic_assassinate')

    const abomination = player(scenario, participantId).board.find(
      (minion) => minion.cardId === 'classic_abomination'
    )!
    const result = play(scenario, opponentId, 'basic_assassinate', [
      { kind: 'minion', participantId, instanceId: abomination.instanceId }
    ])
    expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
    if (!result.accepted) return

    const started = result.events.find((event) => event.type === 'death-batch-started')
    const completed = result.events.find(
      (event) => event.type === 'death-batch-completed'
    )
    expect(started).toBeDefined()
    expect(completed).toBeDefined()
    if (!started || !completed) return
    expect(started.deaths.map((death) => death.instanceId)).toContain(
      abomination.instanceId
    )
    const activations = result.events.filter(
      (event) =>
        event.type === 'trigger-activated' &&
        event.source.instanceId === abomination.instanceId &&
        event.trigger === 'deathrattle'
    )
    expect(activations).toHaveLength(2)
    expect(result.events.indexOf(started)).toBeLessThan(
      result.events.indexOf(activations[0]!)
    )
    expect(result.events.indexOf(activations[1]!)).toBeLessThan(
      result.events.indexOf(completed)
    )
  })

  it('emits paced activation cues for live Deathrattles', () => {
    const scenario = createMatchScenario({
      seed: 1704,
      cardId: 'goblins_vs_gnomes_feign_death',
      firstHeroId: 'rexxar'
    })
    scenario.confirmBothMulligans()
    const [participantId, opponentId] = activePlayers(scenario)
    summon(scenario, participantId, 'classic_leper_gnome')
    setMana(scenario, participantId)

    const card = player(scenario, participantId).hand.find(
      (entry) => entry.cardId === 'goblins_vs_gnomes_feign_death'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: card.instanceId
    })
    expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
    if (!result.accepted) return

    const leper = player(scenario, participantId).board[0]!
    const activationIndex = result.events.findIndex(
      (event) =>
        event.type === 'trigger-activated' &&
        event.source.instanceId === leper.instanceId &&
        event.trigger === 'deathrattle'
    )
    expect(activationIndex).toBeGreaterThanOrEqual(0)
    expect(
      result.events.findIndex(
        (event, index) =>
          index > activationIndex &&
          event.type === 'effect-resolved' &&
          event.action === 'damage' &&
          event.data?.target === `${opponentId}:hero`
      )
    ).toBeGreaterThan(activationIndex)
  })
})

function damagePhaseFixture(cardId = 'basic_swipe') {
  const s = createMatchScenario({ seed: 1100, cardId })
  s.confirmBothMulligans()
  const self = s.match.getState().activePlayerId!
  const enemy = s.participants.find((id) => id !== self)!
  const player = (id = enemy) =>
    s.match.getState().players.find((p) => p.participantId === id)!
  s.match.dispatch({
    type: 'dev-set-mana',
    participantId: self,
    available: 10,
    maximum: 10
  })
  const summon = (cardId: string, id = enemy) => {
    expect(
      s.match.dispatch({ type: 'dev-summon-minion', participantId: id, cardId })
        .accepted
    ).toBe(true)
    return player(id).board.at(-1)!
  }
  const play = (target?: ReturnType<typeof summon> | 'hero') => {
    const result = s.match.dispatch({
      type: 'play-card',
      participantId: self,
      cardInstanceId: player(self).hand.find((c) => c.cardId === cardId)!.instanceId,
      ...(CARD_CATALOG.require(cardId).type === 'Minion' ? { position: 0 } : {}),
      ...(target
        ? {
            targets: [
              target === 'hero'
                ? { kind: 'hero' as const, participantId: enemy }
                : {
                    kind: 'minion' as const,
                    participantId: enemy,
                    instanceId: target.instanceId
                  }
            ]
          }
        : {})
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) throw new Error(result.message)
    return result
  }
  return { s, self, enemy, player, summon, play }
}
const bossId = 'blackrock_mountain_imp_gang_boss'
const impId = 'blackrock_mountain_imp'
function damageBeforeTriggers(events: readonly OpeningMatchEvent[], cardId: string) {
  const damage = events.flatMap((e, i) =>
    e.type === 'effect-resolved' && e.action === 'damage' && e.sourceCardId === cardId
      ? [i]
      : []
  )
  const firstTrigger = events.findIndex((e) => e.type === 'trigger-activated')
  expect(damage.length).toBeGreaterThan(0)
  expect(firstTrigger).toBeGreaterThan(Math.max(...damage))
}

describe('shared damage phases', () => {
  it.each([true, false])(
    'Swipe: surviving Imp and original splash targets (direct: %s)',
    (direct) => {
      const f = damagePhaseFixture()
      const boss = f.summon(bossId)
      f.summon('basic_bloodfen_raptor')
      const r = f.play(direct ? boss : 'hero')
      expect(f.player().board.find((m) => m.cardId === impId)).toMatchObject({
        health: 1
      })
      expect(
        f.player().board.find((m) => m.cardId === 'basic_bloodfen_raptor')
      ).toMatchObject({ health: 1 })
      if (direct)
        expect(
          f.player().board.find((m) => m.instanceId === boss.instanceId)
        ).toBeUndefined()
      else
        expect(
          f.player().board.find((m) => m.instanceId === boss.instanceId)
        ).toMatchObject({ health: 3 })
      damageBeforeTriggers(r.events, 'basic_swipe')
    }
  )
  it('ordinary area damage automatically applies to everyone before any reaction', () => {
    const f = damagePhaseFixture('basic_hellfire')
    f.summon(bossId)
    f.summon(bossId)
    f.summon('classic_acolyte_of_pain')
    const r = f.play()
    expect(f.player().board.filter((m) => m.cardId === impId)).toHaveLength(2)
    expect(
      f
        .player()
        .board.filter((m) => m.cardId === impId)
        .every((m) => m.health === 1)
    ).toBe(true)
    expect(f.player().board.some((m) => m.cardId === 'classic_acolyte_of_pain')).toBe(
      false
    )
    damageBeforeTriggers(r.events, 'basic_hellfire')
    const lastReaction = Math.max(
      ...r.events.flatMap((e, i) => (e.type === 'trigger-activated' ? [i] : []))
    )
    expect(r.events.findIndex((e) => e.type === 'death-batch-started')).toBeGreaterThan(
      lastReaction
    )
  })
  it('does not free mortally wounded board slots before damage summons', () => {
    const f = damagePhaseFixture()
    const boss = f.summon(bossId)
    for (let i = 0; i < 6; i++) f.summon('basic_stonetusk_boar')
    f.play(boss)
    expect(f.player().board).toHaveLength(0)
  })
  it('Explosive Shot captures original neighbours before lethal primary damage', () => {
    const f = damagePhaseFixture('classic_explosive_shot')
    const left = f.summon('basic_chillwind_yeti')
    const boss = f.summon(bossId)
    const right = f.summon('basic_chillwind_yeti')
    const r = f.play(boss)
    expect(
      f.player().board.find((m) => m.instanceId === left.instanceId)
    ).toMatchObject({ health: 3 })
    expect(
      f.player().board.find((m) => m.instanceId === right.instanceId)
    ).toMatchObject({ health: 3 })
    expect(f.player().board.find((m) => m.cardId === impId)).toMatchObject({
      health: 1
    })
    damageBeforeTriggers(r.events, 'classic_explosive_shot')
  })
  it('combat applies attack and retaliation before either damage trigger', () => {
    const f = damagePhaseFixture()
    const attacker = f.summon(bossId, f.self)
    const defender = f.summon(bossId)
    f.s.match.dispatch({ type: 'end-turn', participantId: f.self })
    f.s.match.dispatch({ type: 'end-turn', participantId: f.enemy })
    const r = f.s.match.dispatch({
      type: 'attack-character',
      participantId: f.self,
      attacker: { kind: 'minion', instanceId: attacker.instanceId },
      defender: { kind: 'minion', instanceId: defender.instanceId }
    })
    expect(r.accepted).toBe(true)
    damageBeforeTriggers(r.events, bossId)
    expect(f.player().board.find((m) => m.cardId === impId)).toBeDefined()
    expect(f.player(f.self).board.find((m) => m.cardId === impId)).toBeDefined()
  })
  it('Mortal Coil draws from lethal damage before the death checkpoint', () => {
    const f = damagePhaseFixture('basic_mortal_coil')
    const target = f.summon('basic_stonetusk_boar')
    const before = f.player(f.self).hand.length
    f.play(target)
    expect(f.player(f.self).hand).toHaveLength(before)
    expect(f.player().board).toHaveLength(0)
  })
  it('Slam draws when the damaged target survives', () => {
    const f = damagePhaseFixture('classic_slam')
    const target = f.summon(bossId)
    const before = f.player(f.self).hand.length
    f.play(target)
    expect(f.player(f.self).hand).toHaveLength(before)
    expect(f.player().board.find((m) => m.cardId === impId)).toBeDefined()
  })
  it('Cobra Shot resolves its first damage trigger before damaging the hero', () => {
    const f = damagePhaseFixture('goblins_vs_gnomes_cobra_shot')
    const target = f.summon(bossId)
    const r = f.play(target)
    const trigger = r.events.findIndex((e) => e.type === 'trigger-activated')
    const damages = r.events.flatMap((e, i) =>
      e.type === 'effect-resolved' &&
      e.action === 'damage' &&
      e.sourceCardId === 'goblins_vs_gnomes_cobra_shot'
        ? [i]
        : []
    )
    expect(trigger).toBeGreaterThan(damages[0])
    expect(trigger).toBeLessThan(damages[1])
  })
  it('per-target damage captures targets but resolves each reaction immediately', () => {
    const f = damagePhaseFixture('goblins_vs_gnomes_lightbomb')
    f.summon(bossId)
    f.summon(bossId)
    const r = f.play()
    const trigger = r.events.findIndex((e) => e.type === 'trigger-activated')
    const damages = r.events.flatMap((e, i) =>
      e.type === 'effect-resolved' &&
      e.action === 'damage' &&
      e.sourceCardId === 'goblins_vs_gnomes_lightbomb'
        ? [i]
        : []
    )
    expect(trigger).toBeGreaterThan(damages[0])
    expect(trigger).toBeLessThan(damages[1])
    expect(f.player().board.filter((m) => m.cardId === impId)).toHaveLength(2)
  })
})

it('repeated missiles can hit a summoned Imp before the outer death checkpoint', () => {
  const f = damagePhaseFixture('mean_streets_of_gadgetzan_greater_arcane_missiles')
  const boss = f.summon(bossId)
  const state = f.s.match.getState()
  let calls = 0
  const rng = {
    next: () => {
      return [0, 0.4, 0][calls++] ?? 0
    },
    snapshot: () => calls,
    restore: (n: unknown) => {
      calls = n as number
    }
  }
  const options = {
    state,
    rng,
    participantId: f.self,
    cardInstanceId: f.player(f.self).hand[0].instanceId
  }
  const result = resolveCardPlay(options)
  expect(result.accepted).toBe(true)
  if (!result.accepted) return
  const damages = result.events.flatMap((e) =>
    e.type === 'effect-resolved' &&
    e.action === 'damage' &&
    e.sourceCardId === 'mean_streets_of_gadgetzan_greater_arcane_missiles'
      ? [e]
      : []
  )
  expect(damages).toHaveLength(3)
  expect(damages[0].data?.target).toBe(boss.instanceId)
  expect(damages[1].data?.target).not.toBe(boss.instanceId)
  expect(damages[2].data?.target).toBe(boss.instanceId)
  const board = result.state.players.find((p) => p.participantId === f.enemy)!.board
  expect(board).toHaveLength(1)
  expect(board[0]).toMatchObject({ cardId: impId, health: 1 })
  const lastDamage = result.events.indexOf(damages.at(-1)!)
  expect(
    result.events.findIndex((e) => e.type === 'death-batch-started')
  ).toBeGreaterThan(lastDamage)
  calls = 0
  expect(resolveCardPlay(options)).toEqual(result)
  expect(f.s.match.getState()).toEqual(state)
})

it('damage-group validation rejects nesting, repeated hits and per-target members', () => {
  const card = CARD_CATALOG.require('basic_swipe')
  const damage = {
    action: 'damage',
    amount: 1,
    target: { controller: 'opponent', type: 'character', selection: 'all' }
  }
  const validate = (actions: unknown[]) =>
    validateCardSet(
      [{ ...card, effects: [{ trigger: 'cast', actions }] }],
      card.expansionId
    )
  expect(() =>
    validate([{ action: 'damage-group', actions: [damage, damage] }])
  ).not.toThrow()
  for (const child of [
    { ...damage, hits: 2 },
    { ...damage, damageResolution: 'per-target' },
    { action: 'damage-group', actions: [damage] },
    { action: 'draw', player: 'self', count: 1 }
  ])
    expect(() => validate([{ action: 'damage-group', actions: [child] }])).toThrow()
  expect(() => validate([{ ...damage, damageResolution: 'later' }])).toThrow()
  expect(() => validate([{ action: 'damage-group', actions: [] }])).toThrow()
})

it('Swipe scales both damage amounts and never damages its primary target twice', () => {
  const f = damagePhaseFixture()
  f.summon('basic_kobold_geomancer', f.self)
  f.summon('basic_chillwind_yeti')
  f.play('hero')
  expect(f.player().hero.health).toBe(25)
  expect(f.player().board[0]).toMatchObject({ health: 3 })
})

it('prevented area damage consumes shields without creating damage triggers', () => {
  const f = damagePhaseFixture('basic_whirlwind')
  f.summon('classic_argent_squire')
  f.summon(bossId)
  const r = f.play()
  expect(
    f.player().board.find((m) => m.cardId === 'classic_argent_squire')
  ).toMatchObject({ health: 1, divineShield: false })
  expect(f.player().board.filter((m) => m.cardId === impId)).toHaveLength(1)
  damageBeforeTriggers(r.events, 'basic_whirlwind')
})

it('rolls back a failure between missiles and restores RNG state', () => {
  const f = damagePhaseFixture('mean_streets_of_gadgetzan_greater_arcane_missiles')
  f.summon(bossId)
  const state = f.s.match.getState(),
    before = structuredClone(state)
  let calls = 0
  const result = resolveCardPlay({
    state,
    participantId: f.self,
    cardInstanceId: f.player(f.self).hand[0].instanceId,
    rng: {
      next: () => {
        if (calls++ === 1) throw Error('injected second-hit failure')
        return 0
      },
      snapshot: () => calls,
      restore: (n: unknown) => {
        calls = n as number
      }
    }
  })
  expect(result.accepted).toBe(false)
  expect(result.events).toEqual([])
  expect(calls).toBe(0)
  expect(state).toEqual(before)
})

it('converted area healing applies all damage before damage triggers', () => {
  const f = damagePhaseFixture('classic_circle_of_healing')
  f.summon('classic_auchenai_soulpriest', f.self)
  f.summon(bossId)
  f.summon(bossId)
  const r = f.play()
  expect(f.player().board.filter((m) => m.cardId === impId)).toHaveLength(2)
  damageBeforeTriggers(r.events, 'classic_circle_of_healing')
})

describe('explicit action VFX', () => {
  const cues = (events: readonly OpeningMatchEvent[]) =>
    events.filter((e) => e.type === 'effect-vfx-started')
  const outcomes = (events: readonly OpeningMatchEvent[]) =>
    events.filter(
      (e): e is Extract<OpeningMatchEvent, { type: 'effect-resolved' }> =>
        e.type === 'effect-resolved' &&
        (e.action === 'damage' || e.action === 'destroy')
    )

  it.each([
    ['future_past_table_flip', 'shadow-blast-enemy-board', false],
    ['future_past_corrupted_awakening', 'shadow-blast-enemy-side', true]
  ] as const)(
    '%s emits enemy-only area VFX with the correct hero coverage',
    (cardId, vfxId, hitsHero) => {
      const f = damagePhaseFixture(cardId)
      const friend = f.summon('basic_chillwind_yeti', f.self)
      const enemy = f.summon('basic_chillwind_yeti')
      const r = f.play()
      const visual = cues(r.events)
      expect(visual).toHaveLength(1)
      expect(visual[0]).toMatchObject({ vfxId })
      expect(visual[0]!.targetInstanceIds).toContain(enemy.instanceId)
      expect(visual[0]!.targetInstanceIds).not.toContain(friend.instanceId)
      expect((visual[0]!.targetInstanceIds ?? []).includes(`${f.enemy}:hero`)).toBe(
        hitsHero
      )
      expect(f.player(f.self).hero.health).toBe(30)
    }
  )

  it('Domino Effect emits a separately correlated missile for each sequential hit', () => {
    const f = damagePhaseFixture('future_past_domino_effect')
    const targets = Array.from({ length: 3 }, () => f.summon('basic_chillwind_yeti'))
    const r = f.play(targets[0])
    const missiles = cues(r.events)
    expect(missiles).toHaveLength(3)
    expect(new Set(missiles.map((cue) => cue.vfxGroupId)).size).toBe(3)
    for (const [index, cue] of missiles.entries()) {
      expect(cue).toMatchObject({
        vfxId: 'shadow-missile-small',
        targetInstanceIds: [targets[index]!.instanceId]
      })
      const hit = outcomes(r.events).find(
        (outcome) => outcome.vfxGroupId === cue.vfxGroupId
      )
      expect(hit).toBeDefined()
      expect(r.events.indexOf(cue)).toBeLessThan(r.events.indexOf(hit!))
    }
    expect(f.player().board.map((minion) => minion.health)).toEqual([3, 2, 1])
  })

  it.each([
    'future_past_dark_pact',
    'future_past_shallow_grave',
    'future_past_carnivorous_cube'
  ])('%s emits a destruction missile at its friendly victim', (cardId) => {
    const f = damagePhaseFixture(cardId)
    const victim = f.summon('basic_chillwind_yeti', f.self)
    const r = f.s.match.dispatch({
      type: 'play-card',
      participantId: f.self,
      cardInstanceId: f.player(f.self).hand.find((card) => card.cardId === cardId)!
        .instanceId,
      targets: [
        { kind: 'minion', participantId: f.self, instanceId: victim.instanceId }
      ],
      ...(CARD_CATALOG.require(cardId).type === 'Minion' ? { position: 0 } : {})
    })
    expect(r.accepted).toBe(true)
    expect(cues(r.events)).toMatchObject([
      { vfxId: 'shadow-missile-small', targetInstanceIds: [victim.instanceId] }
    ])
    expect(
      f.player(f.self).board.some((minion) => minion.instanceId === victim.instanceId)
    ).toBe(false)
  })

  it.each(['future_past_bob_the_bartender', 'future_past_freeze_the_shop'])(
    '%s emits frost board VFX for the freeze action',
    (cardId) => {
      const f = damagePhaseFixture(cardId)
      const target = f.summon('basic_chillwind_yeti')
      const friend = f.summon('basic_chillwind_yeti', f.self)
      const r = f.s.match.dispatch({
        type: 'play-card',
        participantId: f.self,
        cardInstanceId: f.player(f.self).hand.find((card) => card.cardId === cardId)!
          .instanceId,
        ...(cardId === 'future_past_bob_the_bartender'
          ? { position: 0, choice: 0 }
          : {})
      })
      expect(r.accepted).toBe(true)
      expect(cues(r.events)).toMatchObject([
        { vfxId: 'frost-blast-enemy-board', targetInstanceIds: [target.instanceId] }
      ])
      expect(f.player().board[0]!.frozenUntilTurn).toBeGreaterThan(0)
      expect(
        f
          .player(f.self)
          .board.find((minion) => minion.instanceId === friend.instanceId)!
          .frozenUntilTurn
      ).toBeFalsy()
    }
  )

  it.each(['basic_frost_nova', 'knights_of_the_frozen_throne_frost_lich_jaina'])(
    '%s shares Blizzard VFX, freezes only enemy minions, and deals no damage',
    (cardId) => {
      const f = damagePhaseFixture(cardId)
      const friendly = f.summon('basic_chillwind_yeti', f.self)
      const first = f.summon('basic_chillwind_yeti')
      const second = f.summon('basic_bloodfen_raptor')
      const before = f
        .player()
        .board.map((m) => ({ id: m.instanceId, health: m.health }))
      const r = f.play()
      const visual = cues(r.events)
      expect(visual).toHaveLength(1)
      expect(visual[0]).toMatchObject({
        vfxId: 'frost-blast-enemy-board',
        targetInstanceIds: [first.instanceId, second.instanceId]
      })
      const freezes = r.events.filter(
        (e) => e.type === 'effect-resolved' && e.action === 'freeze'
      )
      expect(freezes).toHaveLength(2)
      expect(
        freezes.every(
          (e) => e.type === 'effect-resolved' && e.vfxGroupId === visual[0].vfxGroupId
        )
      ).toBe(true)
      expect(r.events.indexOf(visual[0])).toBeLessThan(r.events.indexOf(freezes[0]))
      expect(
        f.player().board.map((m) => ({ id: m.instanceId, health: m.health }))
      ).toEqual(before)
      expect(f.player().board.every((m) => typeof m.frozenUntilTurn === 'number')).toBe(
        true
      )
      expect(f.player(f.self).board).toHaveLength(1)
      expect(
        f.player(f.self).board.find((m) => m.instanceId === friendly.instanceId)
          ?.frozenUntilTurn
      ).toBeNull()
      expect(f.player(f.self).hero.frozenUntilTurn).toBeNull()
      expect(f.player().hero.frozenUntilTurn).toBeNull()
      expect(
        r.events.some((e) => e.type === 'effect-resolved' && e.action === 'damage')
      ).toBe(false)
    }
  )

  it.each(['basic_frost_nova', 'knights_of_the_frozen_throne_frost_lich_jaina'])(
    '%s skips VFX on an empty enemy board',
    (cardId) => {
      const f = damagePhaseFixture(cardId)
      f.summon('basic_chillwind_yeti', f.self)
      expect(cues(f.play().events)).toHaveLength(0)
      expect(f.player().board).toHaveLength(0)
      expect(f.player(f.self).board).toHaveLength(1)
    }
  )

  it.each([
    'classic_frost_elemental',
    'journey_to_ungoro_glacial_shard',
    'knights_of_the_frozen_throne_brrrloc',
    'mean_streets_of_gadgetzan_freezing_potion',
    'classic_ice_lance',
    'goblins_vs_gnomes_spare_part_emergency_coolant'
  ])('%s links its frost missile to the chosen freeze outcome', (cardId) => {
    const f = damagePhaseFixture(cardId)
    const target = f.summon('basic_chillwind_yeti')
    const bystander = f.summon('basic_bloodfen_raptor')
    const r = f.play(target)
    const visual = cues(r.events)
    expect(visual).toHaveLength(1)
    expect(visual[0]).toMatchObject({
      vfxId: 'frost-missile-small',
      targetInstanceIds: [target.instanceId]
    })
    const freeze = r.events.find(
      (e) => e.type === 'effect-resolved' && e.action === 'freeze'
    )
    expect(freeze).toMatchObject({ vfxGroupId: visual[0].vfxGroupId })
    expect(r.events.indexOf(visual[0])).toBeLessThan(r.events.indexOf(freeze!))
    expect(
      f.player().board.find((m) => m.instanceId === target.instanceId)
    ).toMatchObject({
      health: target.health,
      frozenUntilTurn: expect.any(Number)
    })
    expect(
      f.player().board.find((m) => m.instanceId === bystander.instanceId)
        ?.frozenUntilTurn
    ).toBeNull()
    expect(outcomes(r.events)).toHaveLength(0)
  })

  it.each([
    ['basic_fireball', 'fire-missile'],
    ['basic_frostbolt', 'frost-missile-small'],
    ['basic_shadow_word_death', 'shadow-missile-small'],
    ['classic_big_game_hunter', 'neutral-missile-raw']
  ])('%s emits its explicitly authored missile before the outcome', (cardId, vfxId) => {
    const f = damagePhaseFixture(cardId)
    const target = f.summon('basic_war_golem')
    const r = f.play(target)
    const cue = cues(r.events)[0]!
    expect(cue).toMatchObject({
      vfxId,
      targetInstanceIds: [target.instanceId],
      origin: 'source'
    })
    const outcome = outcomes(r.events).find((e) => e.vfxGroupId === cue.vfxGroupId)!
    expect(outcome).toBeDefined()
    expect(r.events.indexOf(cue)).toBeLessThan(r.events.indexOf(outcome))
  })

  it('Flamestrike stays AoE for one shielded target and skips an empty board', () => {
    const f = damagePhaseFixture('basic_flamestrike')
    expect(cues(f.play().events)).toHaveLength(0)
    setMana(f.s, f.self)
    const target = f.summon('classic_argent_squire')
    const r = f.play()
    expect(cues(r.events)).toHaveLength(1)
    expect(cues(r.events)[0]).toMatchObject({
      vfxId: 'fire-blast-enemy-board',
      targetInstanceIds: [target.instanceId]
    })
    expect(outcomes(r.events)[0].data?.shieldConsumed).toBe(true)
  })

  it('Bouncing Blade gives each raw missile its own cue before its damage outcome', () => {
    const f = damagePhaseFixture('goblins_vs_gnomes_bouncing_blade')
    const target = f.summon('basic_bloodfen_raptor')
    const r = f.play()
    const missiles = cues(r.events)
    expect(missiles).toHaveLength(target.health)
    expect(new Set(missiles.map((cue) => cue.vfxGroupId)).size).toBe(missiles.length)
    for (const cue of missiles) {
      expect(cue).toMatchObject({
        vfxId: 'neutral-missile-raw',
        targetInstanceIds: [target.instanceId]
      })
      const outcome = outcomes(r.events).find((e) => e.vfxGroupId === cue.vfxGroupId)
      expect(outcome).toBeDefined()
      expect(r.events.indexOf(cue)).toBeLessThan(r.events.indexOf(outcome!))
    }
    expect(f.player().board).toHaveLength(0)
  })

  it('each random hit has its own cue and matching outcome, even on the same hero', () => {
    const f = damagePhaseFixture('basic_arcane_missiles')
    const r = f.play()
    expect(cues(r.events)).toHaveLength(3)
    expect(new Set(cues(r.events).map((e) => e.vfxGroupId)).size).toBe(3)
    for (const cue of cues(r.events)) {
      expect(cue.vfxId).toBe('arcane-missile-small')
      const outcome = outcomes(r.events).find((e) => e.vfxGroupId === cue.vfxGroupId)!
      expect(cue.targetInstanceIds).toEqual([outcome.data?.target])
      expect(r.events.indexOf(cue)).toBeLessThan(r.events.indexOf(outcome))
    }
  })

  it('Swipe gates its mixed missile and AoE together before all damage', () => {
    const f = damagePhaseFixture('basic_swipe')
    const target = f.summon('basic_chillwind_yeti')
    f.summon('basic_chillwind_yeti')
    const r = f.play(target)
    const cue = cues(r.events)[0]!
    expect(cues(r.events)).toHaveLength(1)
    expect(cue.visuals?.map((v) => v.vfxId)).toEqual([
      'neutral-missile-raw',
      'fire-blast-enemy-side'
    ])
    expect(outcomes(r.events).every((e) => e.vfxGroupId === cue.vfxGroupId)).toBe(true)
  })

  it('Explosive Shot launches its three missiles as one simultaneous wave', () => {
    const f = damagePhaseFixture('classic_explosive_shot')
    f.summon('basic_chillwind_yeti')
    const target = f.summon('basic_chillwind_yeti')
    f.summon('basic_chillwind_yeti')
    const r = f.play(target)
    expect(cues(r.events)).toHaveLength(1)
    expect(cues(r.events)[0].targetInstanceIds).toHaveLength(3)
    // Keep the entire damage-group on medium so all three impacts stay aligned.
    expect(cues(r.events)[0].vfxId).toBe('fire-missile')
    expect(cues(r.events)[0].visuals).toBeUndefined()
    expect(new Set(outcomes(r.events).map((e) => e.vfxGroupId)).size).toBe(1)
  })

  it('a triggered minion missile retains its own group inside an AoE resolution', () => {
    const f = damagePhaseFixture('basic_hellfire')
    const leper = f.summon('classic_leper_gnome')
    const r = f.play()
    const wave = cues(r.events).find((e) => e.vfxId === 'fire-blast-all-characters')!
    const deathrattle = cues(r.events).find(
      (e) => e.sourceInstanceId === leper.instanceId
    )!
    expect(deathrattle.vfxId).toBe('nature-missile-small')
    expect(deathrattle.vfxGroupId).not.toBe(wave.vfxGroupId)
    expect(
      outcomes(r.events).some((e) => e.vfxGroupId === deathrattle.vfxGroupId)
    ).toBe(true)
  })

  it.each(['classic_baron_geddon', 'classic_doomsayer'])(
    '%s retains its turn-trigger AoE',
    (cardId) => {
      const f = damagePhaseFixture()
      f.summon(cardId, f.self)
      f.summon('basic_chillwind_yeti')
      const end = f.s.match.dispatch({ type: 'end-turn', participantId: f.self })
      const events =
        cardId === 'classic_doomsayer'
          ? f.s.match.dispatch({ type: 'end-turn', participantId: f.enemy }).events
          : end.events
      expect(
        cues(events).some(
          (e) =>
            e.vfxId ===
            (cardId === 'classic_doomsayer'
              ? 'fire-blast-both-boards'
              : 'fire-blast-all-characters')
        )
      ).toBe(true)
    }
  )

  it('specialized selective clears animate only once', () => {
    const f = damagePhaseFixture('the_grand_tournament_enter_the_coliseum')
    for (const id of [f.self, f.enemy]) {
      f.summon('basic_chillwind_yeti', id)
      f.summon('basic_stonetusk_boar', id)
    }
    const r = f.play()
    expect(cues(r.events)).toHaveLength(1)
    expect(cues(r.events)[0].vfxId).toBe('fire-blast-both-boards')
    expect(outcomes(r.events)).toHaveLength(2)
  })

  it('leaves an explicit self-cost without a shader', () => {
    const f = damagePhaseFixture('classic_flame_imp')
    const r = f.play()
    expect(outcomes(r.events)).toHaveLength(1)
    expect(cues(r.events)).toHaveLength(0)
  })

  it('removing the authored key removes all cues without changing RNG, state or gameplay events', () => {
    const f = damagePhaseFixture('basic_arcane_missiles')
    const state = f.s.match.getState()
    const options = {
      state,
      participantId: f.self,
      cardInstanceId: f.player(f.self).hand[0].instanceId
    }
    const run = () => resolveCardPlay({ ...options, rng: createSeededRng(401) })
    const configured = run()
    const get = CARD_CATALOG.get.bind(CARD_CATALOG)
    const spy = vi.spyOn(CARD_CATALOG, 'get').mockImplementation((id) => {
      const card = get(id)
      if (id !== 'basic_arcane_missiles') return card
      return JSON.parse(
        JSON.stringify(card, (key, value) => (key === 'vfx' ? undefined : value))
      )
    })
    try {
      const unconfigured = run()
      expect(configured.accepted).toBe(true)
      expect(unconfigured.accepted).toBe(true)
      if (!configured.accepted || !unconfigured.accepted) return
      expect(cues(configured.events)).toHaveLength(3)
      expect(cues(unconfigured.events)).toHaveLength(0)
      expect(unconfigured.state).toEqual(configured.state)
      const gameplay = (events: readonly OpeningMatchEvent[]) =>
        JSON.parse(
          JSON.stringify(
            events.filter((e) => e.type !== 'effect-vfx-started'),
            (key, value) => (key === 'vfxGroupId' ? undefined : value)
          )
        )
      expect(gameplay(unconfigured.events)).toEqual(gameplay(configured.events))
    } finally {
      spy.mockRestore()
    }
  })
})

it('Shadowflame animates its damage without animating the sacrifice', () => {
  const f = damagePhaseFixture('classic_shadowflame')
  const sacrifice = f.summon('basic_chillwind_yeti', f.self)
  f.summon('basic_chillwind_yeti')
  const r = f.s.match.dispatch({
    type: 'play-card',
    participantId: f.self,
    cardInstanceId: f.player(f.self).hand[0].instanceId,
    targets: [
      { kind: 'minion', participantId: f.self, instanceId: sacrifice.instanceId }
    ]
  })
  expect(r.accepted).toBe(true)
  if (!r.accepted) throw new Error(r.message)
  const cues = r.events.filter((e) => e.type === 'effect-vfx-started')
  expect(cues).toHaveLength(1)
  expect(cues[0].vfxId).toBe('shadow-blast-enemy-board')
  const cost = r.events.find(
    (e) => e.type === 'effect-resolved' && e.action === 'destroy'
  )
  expect(cost?.type === 'effect-resolved' && cost.vfxGroupId).toBeUndefined()
})

it('Betrayal emits missiles from the selected minion to both neighbours', () => {
  const f = damagePhaseFixture('classic_betrayal')
  const left = f.summon('basic_chillwind_yeti')
  const source = f.summon('basic_chillwind_yeti')
  const right = f.summon('basic_chillwind_yeti')
  const r = f.play(source)
  const cues = r.events.filter((e) => e.type === 'effect-vfx-started')
  expect(cues).toHaveLength(1)
  expect(cues[0]).toMatchObject({
    sourceInstanceId: source.instanceId,
    vfxId: 'neutral-missile-raw'
  })
  expect(cues[0].targetInstanceIds).toEqual([left.instanceId, right.instanceId])
})

describe('Four Horsemen passive victory', () => {
  const horsemen = [
    'knights_of_the_frozen_throne_darion_mograine',
    'knights_of_the_frozen_throne_deathlord_nazgrim',
    'knights_of_the_frozen_throne_inquisitor_whitemane',
    'knights_of_the_frozen_throne_thoras_trollbane'
  ]
  function fixture(withPower = true) {
    const s = createMatchScenario({
      seed: 423,
      firstHeroId: withPower ? 'uther-ebon-blade' : 'jaina',
      secondHeroId: withPower ? 'uther-ebon-blade' : 'jaina'
    })
    s.confirmBothMulligans()
    const [self, enemy] = activePlayers(s)
    setMana(s, self)
    for (const id of horsemen.slice(0, 3)) summon(s, self, id)
    return { s, self, enemy }
  }
  function expectVictory(
    result: {
      readonly accepted: boolean
      readonly message?: string
      readonly events: readonly OpeningMatchEvent[]
      readonly state: OpeningMatchState
    },
    self: PlayerId,
    enemy: PlayerId
  ) {
    expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
    if (!result.accepted) throw new Error(result.message)
    const waves = result.events.filter(
      (e): e is Extract<OpeningMatchEvent, { type: 'effect-vfx-started' }> =>
        e.type === 'effect-vfx-started' &&
        e.actionPath === 'hero-power.four-horsemen.destroy-enemy-hero'
    )
    expect(waves).toHaveLength(1)
    const wave = waves[0]
    const owner = result.state.players.find((p) => p.participantId === self)!
    expect(wave).toMatchObject({
      vfxId: 'frost-missile-small',
      controllerId: self,
      origin: 'source',
      targetInstanceIds: [`${enemy}:hero`],
      sourceInstanceIds: horsemen.map(
        (id) => owner.board.find((minion) => minion.cardId === id)!.instanceId
      )
    })
    expect(new Set(wave.sourceInstanceIds).size).toBe(4)
    const destruction = result.events.filter(
      (e) => e.type === 'effect-resolved' && e.action === 'destroy'
    )
    expect(destruction).toContainEqual(
      expect.objectContaining({
        vfxGroupId: wave.vfxGroupId,
        data: { target: `${enemy}:hero` }
      })
    )
    expect(result.events.indexOf(wave)).toBeLessThan(
      result.events.indexOf(destruction.at(-1)!)
    )
    const ended = result.events.find((e) => e.type === 'match-ended')!
    expect(ended).toMatchObject({ winnerId: self })
    expect(result.events.indexOf(ended)).toBeGreaterThan(
      result.events.indexOf(destruction.at(-1)!)
    )
    expect(result.events.some((e) => e.type === 'character-damaged')).toBe(false)
    expect(
      result.state.players.find((p) => p.participantId === enemy)!.hero.health
    ).toBe(0)
    for (const viewer of [self, enemy]) {
      const publicWave = getOpeningMatchPublicEvents(result.events, viewer).find(
        (e) => e.type === 'effect-vfx-started' && e.vfxGroupId === wave.vfxGroupId
      )
      expect(publicWave).toEqual(wave)
    }
    return wave
  }

  it('summons the missing fourth before emitting one four-origin finishing wave', () => {
    const { s, self, enemy } = fixture()
    const result = s.match.dispatch({ type: 'use-hero-power', participantId: self })
    if (!result.accepted) throw new Error(result.message)
    const wave = expectVictory(result, self, enemy)
    const entrance = result.events.find(
      (e) => e.type === 'minion-summoned' && e.minion.cardId === horsemen[3]
    )!
    expect(result.events.indexOf(entrance)).toBeLessThan(result.events.indexOf(wave))
  })

  it('wins when a Horseman is played from hand even after the power was spent', () => {
    const { s, self, enemy } = fixture()
    addCard(s, self, horsemen[3])
    const original = s.match.getState()
    const state = {
      ...original,
      players: original.players.map((p) =>
        p.participantId === self
          ? {
              ...p,
              mana: { ...p.mana, available: 2 },
              heroPower: { ...p.heroPower, available: false, usesThisTurn: 1 }
            }
          : { ...p, hero: { ...p.hero, armor: 100, immune: true } }
      ) as unknown as typeof original.players
    }
    const options = {
      state,
      participantId: self,
      position: 0,
      cardInstanceId: state.players
        .find((p) => p.participantId === self)!
        .hand.find((c) => c.cardId === horsemen[3])!.instanceId
    }
    const result = resolveCardPlay(options)
    expectVictory(result, self, enemy)
    expect(result.events.some((e) => e.type === 'hero-power-used')).toBe(false)
    expect(
      result.state.players.find((p) => p.participantId === enemy)!.hero.armor
    ).toBe(100)
    expect(resolveCardPlay(options)).toEqual(result)
    expect(s.match.getState()).toEqual(original)
  })

  it.each(['classic_faceless_manipulator', 'basic_mind_control'])(
    'wins when %s completes the controlled set',
    (cardId) => {
      const { s, self, enemy } = fixture()
      summon(s, enemy, horsemen[3])
      const target = player(s, enemy).board[0]
      addCard(s, self, cardId)
      expectVictory(
        play(s, self, cardId, [
          { kind: 'minion', participantId: enemy, instanceId: target.instanceId }
        ]),
        self,
        enemy
      )
    }
  )

  it('waits while Mindbreaker disables the power and wins when it is silenced', () => {
    const { s, self, enemy } = fixture()
    summon(s, enemy, 'knights_of_the_frozen_throne_mindbreaker')
    addCard(s, self, horsemen[3])
    const blocked = play(s, self, horsemen[3], [])
    expect(blocked.accepted).toBe(true)
    expect(blocked.state.phase).toBe('turns')
    expect(blocked.events.some((e) => e.type === 'effect-vfx-started')).toBe(false)
    addCard(s, self, 'classic_silence')
    expectVictory(
      play(s, self, 'classic_silence', [
        {
          kind: 'minion',
          participantId: enemy,
          instanceId: player(s, enemy).board[0].instanceId
        }
      ]),
      self,
      enemy
    )
  })

  it('wins when resurrection summons the missing Horseman', () => {
    const { s, self, enemy } = fixture()
    summon(s, self, horsemen[3])
    const fourth = player(s, self).board.at(-1)!
    addCard(s, self, 'basic_shadow_word_pain')
    expect(
      play(s, self, 'basic_shadow_word_pain', [
        { kind: 'minion', participantId: self, instanceId: fourth.instanceId }
      ]).accepted
    ).toBe(true)
    expect(player(s, self).board).toHaveLength(3)
    addCard(s, self, 'blackrock_mountain_resurrect')
    const result = play(s, self, 'blackrock_mountain_resurrect', [])
    if (!result.accepted) throw new Error(result.message)
    const wave = expectVictory(result, self, enemy)
    const entrance = result.events.find((e) => e.type === 'minion-summoned')!
    expect(result.events.indexOf(entrance)).toBeLessThan(result.events.indexOf(wave))
  })

  it('does not win from a temporary complete set during two Sylvanas deathrattles', () => {
    const { s, self, enemy } = fixture()
    summon(s, self, 'classic_sylvanas_windrunner')
    const attacker = player(s, self).board.at(-1)!
    summon(s, enemy, horsemen[3])
    summon(s, enemy, 'classic_sylvanas_windrunner')
    const defender = player(s, enemy).board.at(-1)!
    expect(s.match.dispatch({ type: 'end-turn', participantId: self }).accepted).toBe(
      true
    )
    expect(s.match.dispatch({ type: 'end-turn', participantId: enemy }).accepted).toBe(
      true
    )
    const result = s.match.dispatch({
      type: 'attack-character',
      participantId: self,
      attacker: { kind: 'minion', instanceId: attacker.instanceId },
      defender: {
        kind: 'minion',
        instanceId: defender.instanceId
      }
    })
    expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
    expect(
      result.events.filter(
        (e) => e.type === 'effect-resolved' && e.action === 'take-control'
      )
    ).toHaveLength(2)
    expect(result.state.phase).toBe('turns')
    expect(result.events.some((e) => e.type === 'effect-vfx-started')).toBe(false)
  })

  it('can complete the condition on the opposing turn through a control change', () => {
    const { s, self, enemy } = fixture()
    summon(s, self, 'classic_sylvanas_windrunner')
    const sylvanas = player(s, self).board.at(-1)!
    summon(s, enemy, horsemen[3])
    expect(s.match.dispatch({ type: 'end-turn', participantId: self }).accepted).toBe(
      true
    )
    setMana(s, enemy)
    addCard(s, enemy, 'basic_shadow_word_death')
    expectVictory(
      play(s, enemy, 'basic_shadow_word_death', [
        { kind: 'minion', participantId: self, instanceId: sylvanas.instanceId }
      ]),
      self,
      enemy
    )
  })

  it('resolves two complete sets at the same checkpoint as simultaneous hero destruction', () => {
    const { s, self, enemy } = fixture()
    summon(s, self, horsemen[3])
    for (const id of horsemen) summon(s, enemy, id)
    addCard(s, self, 'classic_silence')
    const result = play(s, self, 'classic_silence', [
      {
        kind: 'minion',
        participantId: self,
        instanceId: player(s, self).board[0].instanceId
      }
    ])
    expect(result.accepted).toBe(true)
    expect(result.events.filter((e) => e.type === 'effect-vfx-started')).toHaveLength(2)
    expect(result.state).toMatchObject({
      phase: 'ended',
      winnerId: null,
      loserId: null
    })
    expect(result.state.players.map((p) => p.hero.health)).toEqual([0, 0])
  })

  it.each(['missing identity', 'wrong power', 'dormant Horseman', 'dead Horseman'])(
    'does not complete the condition with a %s',
    (condition) => {
      const { s, self } = fixture(condition !== 'wrong power')
      summon(s, self, condition === 'missing identity' ? horsemen[0] : horsemen[3])
      const original = s.match.getState()
      const state = {
        ...original,
        players: original.players.map((p) =>
          p.participantId === self
            ? {
                ...p,
                board: p.board.map((m, i) =>
                  i !== 3
                    ? m
                    : condition === 'dormant Horseman'
                      ? { ...m, dormant: true }
                      : condition === 'dead Horseman'
                        ? { ...m, health: 0, damageTaken: m.maxHealth }
                        : m
                )
              }
            : p
        ) as unknown as typeof original.players
      }
      const result = resolveCardPlay({
        state,
        participantId: self,
        position: 0,
        cardInstanceId: player(s, self).hand[0].instanceId
      })
      expect(result.accepted).toBe(true)
      expect(result.state.phase).toBe('turns')
      expect(result.events.some((e) => e.type === 'effect-vfx-started')).toBe(false)
    }
  )

  it('does not execute the passive condition while deriving or reading a complete board', () => {
    const { s, self } = fixture()
    summon(s, self, horsemen[3])
    const before = s.match.getState()
    expect(getDerivedState(before).phase).toBe('turns')
    expect(s.match.getState()).toEqual(before)
    expect(s.match.getLegality!(self).legalHeroPower).toBe(false)
    expect(s.match.getState()).toEqual(before)
  })
})
