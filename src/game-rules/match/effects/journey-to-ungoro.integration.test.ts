import { describe, expect, it, vi } from 'vitest'
import { CARD_CATALOG, asCardId, asHeroId } from '../../content/cards'
import { createMatchScenario } from '../testing/match-scenario-builder'
import { getDerivedState } from './effect-runtime'
import { enumerateLegalCommands } from '../ai/legal-commands'

import { DeckRules, type Deck } from '../../decks'
import { asPlayerId, type PlayerId } from '../match-types'
import { createOpeningMatch, createOpeningMatchFromCheckpoint } from '../opening-match'

type Scenario = ReturnType<typeof createMatchScenario>

const ELISE_ID = 'journey_to_ungoro_elise_the_trailblazer'

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

function ready(options: Parameters<typeof createMatchScenario>[0] = {}) {
  const scenario = createMatchScenario(options)
  scenario.confirmBothMulligans()
  return scenario
}

function addCard(scenario: Scenario, participantId: string, cardId: string): void {
  const result = scenario.match.dispatch({
    type: 'dev-add-card',
    participantId,
    cardId: asCardId(cardId)
  })
  if (!result.accepted) throw new Error(result.message)
}

function setMana(
  scenario: Scenario,
  participantId: string,
  available = 10,
  maximum = 10
): void {
  const result = scenario.match.dispatch({
    type: 'dev-set-mana',
    participantId,
    available,
    maximum
  })
  if (!result.accepted) throw new Error(result.message)
}

function play(scenario: Scenario, participantId: string, cardId: string): void {
  const card = player(scenario, participantId).hand.find(
    (candidate) => candidate.cardId === cardId
  )
  expect(card).toBeDefined()
  const result = scenario.match.dispatch({
    type: 'play-card',
    participantId,
    cardInstanceId: card!.instanceId,
    ...(CARD_CATALOG.require(card!.cardId).type === 'Minion' ? { position: 0 } : {})
  })
  if (!result.accepted) throw new Error(result.message)
}

function playEliseAndCollectPack(scenario: Scenario, participantId: string) {
  const handBefore = player(scenario, participantId).hand.filter(
    (card) => card.cardId !== ELISE_ID
  )
  play(scenario, participantId, ELISE_ID)
  const handAfter = player(scenario, participantId).hand
  const pack = handAfter.filter(
    (card) => !handBefore.some((before) => before.instanceId === card.instanceId)
  )
  return { pack, handBeforeCount: handBefore.length, handAfterCount: handAfter.length }
}

describe("Elise the Trailblazer Un'Goro pack", () => {
  it("adds exactly 5 distinct Un'Goro cards with one guaranteed Legendary", () => {
    const scenario = ready({ seed: 7311 })
    const [own] = activePlayers(scenario)
    addCard(scenario, own, ELISE_ID)
    setMana(scenario, own)

    const { pack, handBeforeCount, handAfterCount } = playEliseAndCollectPack(
      scenario,
      own
    )

    expect(handAfterCount).toBe(handBeforeCount + 5)
    expect(pack).toHaveLength(5)

    const cardIds = pack.map((card) => card.cardId)
    expect(new Set(cardIds).size).toBe(5)

    const definitions = cardIds.map((cardId) => CARD_CATALOG.require(cardId))
    for (const definition of definitions) {
      expect(definition.expansionId).toBe('journey-to-ungoro')
      expect(definition.collectible).toBe(true)
    }

    const legendaries = definitions.filter(
      (definition) => definition.rarity === 'Legendary'
    )
    expect(legendaries.length).toBeGreaterThanOrEqual(1)
    const others = definitions.filter((definition) => definition !== legendaries[0])
    expect(others).toHaveLength(4)
    for (const definition of others)
      expect(['Rare', 'Epic', 'Legendary']).toContain(definition.rarity)
  })

  it('is deterministic for the same seed', () => {
    const collectPack = (seed: number) => {
      const scenario = ready({ seed })
      const [own] = activePlayers(scenario)
      addCard(scenario, own, ELISE_ID)
      setMana(scenario, own)
      const { pack } = playEliseAndCollectPack(scenario, own)
      return pack.map((card) => card.cardId).sort()
    }
    expect(collectPack(4242)).toEqual(collectPack(4242))
  })

  it('keeps all 5 cards distinct even when a Legendary is drawn twice', () => {
    for (const seed of [1, 2, 3, 17, 99, 4242, 7311, 88_000]) {
      const scenario = ready({ seed })
      const [own] = activePlayers(scenario)
      addCard(scenario, own, ELISE_ID)
      setMana(scenario, own)
      const { pack } = playEliseAndCollectPack(scenario, own)
      const cardIds = pack.map((card) => card.cardId)
      expect(new Set(cardIds).size).toBe(cardIds.length)
      const legendaries = cardIds.filter(
        (cardId) => CARD_CATALOG.require(cardId).rarity === 'Legendary'
      )
      expect(legendaries.length).toBeGreaterThanOrEqual(1)
    }
  })
})

const HIVE_QUEEN_ID = 'journey_to_ungoro_emerald_hive_queen'

describe('Emerald Hive Queen cost aura', () => {
  function handMinionCosts(scenario: Scenario, participantId: string) {
    return player(scenario, participantId)
      .hand.filter((card) => CARD_CATALOG.require(card!.cardId).type === 'Minion')
      .map((card) => card.currentCost)
  }

  function clearBoard(scenario: Scenario, participantId: string) {
    const result = scenario.match.dispatch({
      type: 'dev-clear-zone',
      participantId,
      zone: 'board'
    })
    if (!result.accepted) throw new Error(result.message)
  }

  function expectAllCosts(
    scenario: Scenario,
    participantId: string,
    expectedCost: number
  ) {
    const costs = handMinionCosts(scenario, participantId)
    expect(costs).not.toHaveLength(0)
    for (const cost of costs) expect(cost).toBe(expectedCost)
  }

  it('taxes only its owner’s hand minions, never the opponent’s', () => {
    const scenario = ready({ seed: 7311, cardId: HIVE_QUEEN_ID })
    const [own, other] = activePlayers(scenario)
    setMana(scenario, own)

    expectAllCosts(scenario, own, 1)
    expectAllCosts(scenario, other, 1)

    play(scenario, own, HIVE_QUEEN_ID)

    expectAllCosts(scenario, own, 3)
    expectAllCosts(scenario, other, 1)

    clearBoard(scenario, own)
    expectAllCosts(scenario, own, 1)
  })

  it('taxes only the second player’s hand when they play their Queen', () => {
    const scenario = ready({ seed: 7311, cardId: HIVE_QUEEN_ID })
    const [own, other] = activePlayers(scenario)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: own }).accepted
    ).toBe(true)

    setMana(scenario, other)
    play(scenario, other, HIVE_QUEEN_ID)

    expectAllCosts(scenario, other, 3)
    expectAllCosts(scenario, own, 1)
  })
})

describe('Tortollan Forager catalog generation', () => {
  const foragerId = 'journey_to_ungoro_tortollan_forager'

  function setup(seed: number, seat: number) {
    const heroId = asHeroId('malfurion')
    const rules = new DeckRules()
    const filler = CARD_CATALOG.all
      .filter(
        (card) =>
          card.id !== foragerId &&
          card.rarity !== 'Legendary' &&
          card.type === 'Minion' &&
          rules.isCardAllowedInDeck({ heroId }, card)
      )
      .slice(0, 14)
    const decks = ['forager-one', 'forager-two'].map((id): Deck => ({
      id,
      name: id,
      heroId,
      cards: Object.fromEntries(
        [foragerId, ...filler.map((card) => card.id)].map((id) => [id, 2])
      ),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }))
    for (const deck of decks) {
      expect(rules.validate(deck)).toEqual([])
      expect(Object.values(deck.cards).reduce((sum, count) => sum + count, 0)).toBe(30)
    }
    const participantList = decks.map((deck) => ({
      participantId: asPlayerId(deck.id),
      controllerKind: 'human' as const,
      heroId,
      deckId: deck.id
    }))
    const participants = [participantList[0]!, participantList[1]!] as const
    const own = participants[seat]!.participantId
    const match = createOpeningMatch(
      {
        seed,
        participants,
        startingParticipantId: own,
        skipMulligan: true,
        recordEffectTrace: true
      },
      decks
    )
    expect(
      match.dispatch({
        type: 'dev-set-mana',
        participantId: own,
        available: 10,
        maximum: 10
      }).accepted
    ).toBe(true)
    // Only prepare the fixture through accepted commands; the battlecry uses the real catalog.
    expect(
      match.dispatch({ type: 'dev-clear-zone', participantId: own, zone: 'hand' })
        .accepted
    ).toBe(true)
    expect(
      match.dispatch({ type: 'dev-add-card', participantId: own, cardId: foragerId })
        .accepted
    ).toBe(true)
    const source = match.getState().players.find((p) => p.participantId === own)!
      .hand[0]!
    const command = {
      type: 'play-card',
      participantId: own,
      cardInstanceId: source.instanceId,
      position: 0
    }
    return { match, own, source, command }
  }

  it.each([1, 2, 3, 17, 99, 4242, 7311, 88000])(
    'generates an eligible owned card with deterministic accepted replay for seed %i in both seats',
    (seed) => {
      for (const seat of [0, 1]) {
        const { match, own, command, source } = setup(seed, seat)
        const checkpoint = match.getCheckpoint()
        const before = match.getState()
        const result = match.dispatch(command)
        expect(result.accepted).toBe(true)
        const self = result.state.players.find((p) => p.participantId === own)!
        const generated = self.hand.filter(
          (card) => card.instanceId !== source.instanceId
        )
        expect(generated).toHaveLength(1)
        const card = generated[0]!
        const definition = CARD_CATALOG.require(card.cardId)
        expect(definition.type).toBe('Minion')
        expect(definition.type === 'Minion' && definition.attack >= 5).toBe(true)
        expect(card).toMatchObject({
          ownerId: own,
          controllerId: own,
          zone: 'hand',
          baseCost: definition.cost
        })
        expect(
          self.board.some((minion) => minion.instanceId === source.instanceId)
        ).toBe(true)
        expect(self.deck).toEqual(
          before.players.find((p) => p.participantId === own)!.deck
        )
        expect(result.state.players.find((p) => p.participantId !== own)).toEqual(
          before.players.find((p) => p.participantId !== own)
        )
        expect(
          result.events.filter((event) => event.type === 'card-generated')
        ).toHaveLength(1)
        const replay = createOpeningMatchFromCheckpoint(checkpoint)
        expect(replay.dispatch(command)).toEqual(result)
        expect(replay.getCheckpoint()).toEqual(match.getCheckpoint())
      }
    }
  )

  it('respects the hand cap and burns only the overflow from a doubled battlecry', () => {
    const { match, own, command } = setup(91, 0)
    expect(
      match.dispatch({
        type: 'dev-summon-minion',
        participantId: own,
        cardId: 'league_of_explorers_brann_bronzebeard'
      }).accepted
    ).toBe(true)
    for (let i = 0; i < 9; i++)
      expect(
        match.dispatch({
          type: 'dev-add-card',
          participantId: own,
          cardId: 'basic_chillwind_yeti'
        }).accepted
      ).toBe(true)
    const result = match.dispatch(command)
    expect(result.accepted).toBe(true)
    expect(
      result.state.players.find((p) => p.participantId === own)!.hand
    ).toHaveLength(10)
    expect(
      result.events.filter((event) => event.type === 'card-generated')
    ).toHaveLength(1)
    const burns = result.events.filter((event) => event.type === 'card-burned')
    expect(burns).toHaveLength(1)
    expect(burns[0]).toMatchObject({ participantId: own })
  })

  it('generates nothing when a constrained pool has no eligible card', () => {
    const { match, own, command } = setup(92, 0)
    const originalGet = CARD_CATALOG.get.bind(CARD_CATALOG)
    const original = CARD_CATALOG.require(foragerId)
    const filtered = {
      ...original,
      effects: original.effects.map((effect) => ({
        ...effect,
        actions: effect.actions?.map((action) => ({
          ...action,
          pool: ['basic_chillwind_yeti', 'basic_fireball']
        }))
      }))
    }
    const get = vi
      .spyOn(CARD_CATALOG, 'get')
      .mockImplementation((id) => (id === foragerId ? filtered : originalGet(id)))
    try {
      const result = match.dispatch(command)
      expect(result.accepted).toBe(true)
      expect(
        result.state.players.find((p) => p.participantId === own)!.hand
      ).toHaveLength(0)
      expect(
        result.events.some(
          (event) => event.type === 'card-generated' || event.type === 'card-burned'
        )
      ).toBe(false)
    } finally {
      get.mockRestore()
    }
  })
})

describe('authentic quest reward mechanics with custom tuning', () => {
  const core = 'journey_to_ungoro_crystal_core'
  const brood = 'journey_to_ungoro_carnassas_brood'
  function cast(
    scenario: Scenario,
    who: string,
    id: string,
    target?: { participantId: string; instanceId: string }
  ) {
    addCard(scenario, who, id)
    setMana(scenario, who)
    const card = player(scenario, who).hand.find((c) => c.cardId === id)!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: who,
      cardInstanceId: card.instanceId,
      ...(CARD_CATALOG.require(id).type === 'Minion' ? { position: 0 } : {}),
      ...(target ? { targets: [{ kind: 'minion', ...target }] } : {})
    })
    if (!result.accepted) throw new Error(result.message)
  }
  function summon(scenario: Scenario, who: string, id: string) {
    const result = scenario.match.dispatch({
      type: 'dev-summon-minion',
      participantId: who,
      cardId: id
    })
    if (!result.accepted) throw new Error(result.message)
    return {
      participantId: who,
      instanceId: player(scenario, who).board.at(-1)!.instanceId
    }
  }
  function stats(
    scenario: Scenario,
    target: { participantId: string; instanceId: string }
  ) {
    const minion = player(scenario, target.participantId).board.find(
      (m) => m.instanceId === target.instanceId
    )!
    return [minion.attack, minion.health, minion.maxHealth]
  }
  it('shuffles exactly twenty generated Brood, preserving the original deck and custom Queen stats', () => {
    const scenario = ready({ seed: 8100 })
    const [own] = activePlayers(scenario)
    const original = player(scenario, own).deck
    cast(scenario, own, 'journey_to_ungoro_queen_carnassa')
    const deck = player(scenario, own).deck
    expect(deck).toHaveLength(original.length + 20)
    expect(deck.filter((c) => c.cardId === brood)).toHaveLength(20)
    expect(new Set(deck.map((c) => c.instanceId)).size).toBe(deck.length)
    expect(
      original.every((card) => deck.some((c) => c.instanceId === card.instanceId))
    ).toBe(true)
    expect(deck.filter((c) => c.cardId === brood).every((c) => !c.startedInDeck)).toBe(
      true
    )
    expect(CARD_CATALOG.require('journey_to_ungoro_queen_carnassa')).toMatchObject({
      cost: 5,
      attack: 8,
      health: 8,
      keywords: ['rush']
    })
    expect(CARD_CATALOG.require(brood)).toMatchObject({
      cost: 1,
      attack: 3,
      health: 2,
      subtype: 'Beast',
      collectible: false,
      deckLegal: false
    })
  })
  it('Brood draws once on play but not on summon, and fatigues normally', () => {
    const scenario = ready({ seed: 8101 })
    const [own] = activePlayers(scenario)
    const before = player(scenario, own).deck.length
    summon(scenario, own, brood)
    expect(player(scenario, own).deck).toHaveLength(before)
    cast(scenario, own, brood)
    expect(player(scenario, own).deck).toHaveLength(before - 1)
    expect(
      scenario.match.dispatch({
        type: 'dev-modify-deck',
        participantId: own,
        action: 'destroy'
      }).accepted
    ).toBe(true)
    const health = player(scenario, own).hero.health
    cast(scenario, own, brood)
    expect(player(scenario, own).hero.health).toBe(health - 1)
  })
  it('sets the current board to healthy 5/5, overrides earlier buffs, then allows later buffs and damage', () => {
    const scenario = ready({ seed: 8102 })
    const [own] = activePlayers(scenario)
    const target = summon(scenario, own, 'basic_chillwind_yeti')
    cast(scenario, own, 'basic_blessing_of_kings', target)
    cast(scenario, own, 'classic_moonfire', target)
    cast(scenario, own, core)
    expect(stats(scenario, target)).toEqual([5, 5, 5])
    cast(scenario, own, 'basic_blessing_of_kings', target)
    expect(stats(scenario, target)).toEqual([9, 9, 9])
    cast(scenario, own, 'classic_moonfire', target)
    expect(stats(scenario, target)).toEqual([9, 8, 9])
    cast(scenario, own, 'classic_silence', target)
    expect(stats(scenario, target)).toEqual([5, 5, 5])
  })
  it('affects existing hand/deck, newly generated cards, later summons and transformations', () => {
    const scenario = ready({ seed: 8103 })
    const [own] = activePlayers(scenario)
    cast(scenario, own, core)
    expect(
      player(scenario, own)
        .hand.filter((c) => CARD_CATALOG.require(c.cardId).type === 'Minion')
        .every((c) => c.attack === 5 && c.health === 5)
    ).toBe(true)
    expect(
      player(scenario, own).deck.every((c) => c.attack === 5 && c.health === 5)
    ).toBe(true)
    cast(scenario, own, brood)
    const played = {
      participantId: own,
      instanceId: player(scenario, own).board[0]!.instanceId
    }
    expect(stats(scenario, played)).toEqual([5, 5, 5])
    const generated = summon(scenario, own, 'classic_wisp')
    expect(stats(scenario, generated)).toEqual([5, 5, 5])
    cast(scenario, own, 'basic_polymorph', generated)
    expect(stats(scenario, generated)).toEqual([5, 5, 5])
  })
  it('preserves base stats through bounce and replay, without preserving damage or ordinary buffs', () => {
    const scenario = ready({ seed: 8104 })
    const [own] = activePlayers(scenario)
    cast(scenario, own, core)
    const target = summon(scenario, own, 'basic_chillwind_yeti')
    cast(scenario, own, 'basic_blessing_of_kings', target)
    cast(scenario, own, 'classic_shadowstep', target)
    const returned = player(scenario, own).hand.find(
      (c) => c.instanceId === target.instanceId
    )!
    expect(returned).toMatchObject({ attack: 5, health: 5 })
    setMana(scenario, own)
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: own,
        cardInstanceId: returned.instanceId,
        position: 0
      }).accepted
    ).toBe(true)
    expect(stats(scenario, target)).toEqual([5, 5, 5])
  })
  it('retains the new base when an affected minion is stolen and silenced', () => {
    const scenario = ready({ seed: 8105 })
    const [own, other] = activePlayers(scenario)
    cast(scenario, own, core)
    const target = summon(scenario, own, 'basic_chillwind_yeti')
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: own }).accepted
    ).toBe(true)
    cast(scenario, other, 'basic_mind_control', target)
    const stolen = { ...target, participantId: other }
    expect(stats(scenario, stolen)).toEqual([5, 5, 5])
    cast(scenario, other, 'classic_silence', stolen)
    expect(stats(scenario, stolen)).toEqual([5, 5, 5])
  })
  it('keeps stat-setting effects and explicit 1/1 copies effective after the base change', () => {
    const scenario = ready({ seed: 8106 })
    const [own] = activePlayers(scenario)
    cast(scenario, own, core)
    const target = summon(scenario, own, 'basic_chillwind_yeti')
    cast(scenario, own, 'basic_humility', target)
    expect(stats(scenario, target)).toEqual([1, 5, 5])
    cast(scenario, own, 'one_night_in_karazhan_barnes')
    expect(
      player(scenario, own).board.some((m) => m.attack === 1 && m.maxHealth === 1)
    ).toBe(true)
  })
  it('retains the effect in JSON checkpoints, AI observations and repeated derivations', () => {
    const scenario = ready({ seed: 8107 })
    const [own] = activePlayers(scenario)
    cast(scenario, own, core)
    const target = summon(scenario, own, 'basic_chillwind_yeti')
    cast(scenario, own, 'classic_moonfire', target)
    const state = scenario.match.getState()
    expect(getDerivedState(getDerivedState(state))).toEqual(getDerivedState(state))
    expect(
      scenario.match.getAiObservation!(own, 'fair').players.find(
        (p) => p.participantId === own
      )?.effects.minionBaseStats
    ).toEqual({ attack: 5, health: 5 })
    const restored = createOpeningMatchFromCheckpoint(
      JSON.parse(JSON.stringify(scenario.match.getCheckpoint()))
    )
    const command = {
      type: 'dev-summon-minion',
      participantId: own,
      cardId: 'classic_wisp'
    }
    expect(restored.dispatch(command)).toEqual(scenario.match.dispatch(command))
    expect(restored.getCheckpoint()).toEqual(scenario.match.getCheckpoint())
    expect(stats(scenario, target)).toEqual([5, 4, 5])
  })
  it('applies auras after the one-time reset and does not compound them', () => {
    const scenario = ready({ seed: 8108 })
    const [own] = activePlayers(scenario)
    summon(scenario, own, 'basic_stormwind_champion')
    const target = summon(scenario, own, 'basic_chillwind_yeti')
    cast(scenario, own, core)
    expect(stats(scenario, target)).toEqual([6, 6, 6])
    cast(scenario, own, 'classic_moonfire', target)
    expect(stats(scenario, target)).toEqual([6, 5, 6])
    setMana(scenario, own)
    expect(stats(scenario, target)).toEqual([6, 5, 6])
  })
  it('changes incoming enemy minions to the new base and leaves the enemy board alone', () => {
    const scenario = ready({ seed: 8109 })
    const [own, other] = activePlayers(scenario)
    const enemy = summon(scenario, other, 'basic_bloodfen_raptor')
    cast(scenario, own, core)
    expect(stats(scenario, enemy)).toEqual([3, 2, 2])
    cast(scenario, own, 'basic_mind_control', enemy)
    expect(stats(scenario, { ...enemy, participantId: own })).toEqual([5, 5, 5])
  })
  it('restores the persistent base on resurrection without ordinary buffs or damage', () => {
    const scenario = ready({ seed: 8110 })
    const [own] = activePlayers(scenario)
    cast(scenario, own, core)
    const target = summon(scenario, own, 'basic_chillwind_yeti')
    cast(scenario, own, 'basic_blessing_of_kings', target)
    cast(scenario, own, 'basic_shadow_word_death', target)
    expect(player(scenario, own).board).toHaveLength(0)
    cast(scenario, own, 'blackrock_mountain_resurrect')
    const reborn = player(scenario, own).board[0]!
    expect([reborn.attack, reborn.health, reborn.maxHealth]).toEqual([5, 5, 5])
  })
  it('preserves the base when a stolen Malorne dies and shuffles into a non-Core deck', () => {
    const scenario = ready({ seed: 8115 })
    const [own, other] = activePlayers(scenario)
    cast(scenario, own, core)
    const target = summon(scenario, own, 'goblins_vs_gnomes_malorne')
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: own }).accepted
    ).toBe(true)
    cast(scenario, other, 'basic_mind_control', target)
    cast(scenario, other, 'basic_shadow_word_death', {
      ...target,
      participantId: other
    })
    const shuffled = player(scenario, other).deck.find(
      (card) => card.cardId === 'goblins_vs_gnomes_malorne'
    )
    expect(shuffled).toMatchObject({
      baseStatsOverride: { attack: 5, health: 5 },
      attack: 5,
      health: 5
    })
  })
  it('applies the receiving player base when transforming a Core minion into an unmodified enemy copy', () => {
    const scenario = ready({ seed: 8116 })
    const [own, other] = activePlayers(scenario)
    const target = summon(scenario, other, 'basic_boulderfist_ogre')
    cast(scenario, own, core)
    cast(scenario, own, 'classic_faceless_manipulator', target)
    const copy = player(scenario, own).board[0]!
    expect(copy.cardId).toBe('basic_boulderfist_ogre')
    expect([copy.attack, copy.health, copy.maxHealth]).toEqual([5, 5, 5])
  })
})

describe('generic extra-turn lifecycle', () => {
  // The production Time Warp definition is deliberately independent of these
  // runtime regressions; existing custom card tuning is never altered here.
  const spellId = asCardId('basic_arcane_intellect')
  const grant = { action: 'grant-extra-turn', player: 'self' } as const
  const ownHero = { type: 'hero', controller: 'self' } as const

  function withActions(
    actions: import('../../content/cards').CardAction[],
    run: (scenario: Scenario, own: PlayerId, other: PlayerId) => void
  ): void {
    const originalGet = CARD_CATALOG.get.bind(CARD_CATALOG)
    const definition = CARD_CATALOG.require(spellId)
    const patched = {
      ...definition,
      effects: [{ trigger: 'cast' as const, actions }]
    }
    const spy = vi
      .spyOn(CARD_CATALOG, 'get')
      .mockImplementation((id) => (id === spellId ? patched : originalGet(id)))
    try {
      const scenario = ready({ cardId: spellId })
      const [own, other] = activePlayers(scenario)
      setMana(scenario, own)
      run(scenario, own, other)
    } finally {
      spy.mockRestore()
    }
  }

  it('queues the extra turn without interrupting play, then runs the full turn boundary', () => {
    withActions([grant], (scenario, own, other) => {
      const { match } = scenario
      setMana(scenario, own, 5, 5)
      expect(
        match.dispatch({
          type: 'dev-summon-minion',
          participantId: own,
          cardId: 'basic_chillwind_yeti'
        }).accepted
      ).toBe(true)
      expect(
        match.dispatch({
          type: 'use-hero-power',
          participantId: own,
          target: { kind: 'hero', participantId: other }
        }).accepted
      ).toBe(true)
      const before = match.getState()
      play(scenario, own, spellId)
      const queued = match.getState()
      expect(queued.activePlayerId).toBe(own)
      expect(queued.turnNumber).toBe(before.turnNumber)
      expect(queued.extraTurnQueue).toEqual([own])
      expect(player(scenario, own).deck).toHaveLength(
        before.players.find((p) => p.participantId === own)!.deck.length
      )
      const ended = match.dispatch({ type: 'end-turn', participantId: own })
      expect(ended.accepted).toBe(true)
      expect(ended.state).toMatchObject({
        activePlayerId: own,
        turnNumber: before.turnNumber + 1,
        isExtraTurn: true,
        nextRegularPlayerId: other
      })
      expect(ended.events.filter((event) => event.type === 'turn-started')).toEqual([
        expect.objectContaining({ participantId: own, isExtraTurn: true })
      ])
      expect(ended.events.filter((event) => event.type === 'card-drawn')).toEqual([
        expect.objectContaining({ participantId: own, reason: 'turn-start' })
      ])
      expect(player(scenario, own).mana).toMatchObject({ maximum: 6, available: 6 })
      expect(player(scenario, own).heroPower).toMatchObject({
        available: true,
        usesThisTurn: 0
      })
      expect(ended.state.history?.cardsPlayedThisTurn).toEqual([])
      const minion = player(scenario, own).board[0]!
      expect(
        match.getLegality!(own).legalAttackTargets[minion.instanceId]
      ).not.toHaveLength(0)
      const resumed = match.dispatch({ type: 'end-turn', participantId: own })
      expect(resumed.accepted).toBe(true)
      expect(resumed.state.activePlayerId).toBe(other)
      expect(resumed.state.isExtraTurn).toBeUndefined()
      expect(resumed.state.nextRegularPlayerId).toBeUndefined()
    })
  })

  it('stacks grants and preserves the interrupted regular turn when another grant occurs during an extra turn', () => {
    withActions([{ ...grant, amount: 2 }], (scenario, own, other) => {
      play(scenario, own, spellId)
      expect(
        scenario.match.dispatch({ type: 'end-turn', participantId: own }).state
          .extraTurnQueue
      ).toEqual([own])
      play(scenario, own, spellId)
      for (let index = 0; index < 3; index++) {
        const next = scenario.match.dispatch({ type: 'end-turn', participantId: own })
        expect(next.accepted).toBe(true)
        expect(next.state.activePlayerId).toBe(own)
        expect(next.state.isExtraTurn).toBe(true)
      }
      expect(
        scenario.match.dispatch({ type: 'end-turn', participantId: own }).state
          .activePlayerId
      ).toBe(other)
    })
  })

  it('consumes mixed-player grants in order and resumes the original regular turn', () => {
    withActions([{ ...grant, player: 'opponent' }, grant], (scenario, own, other) => {
      play(scenario, own, spellId)
      expect(scenario.match.getState().extraTurnQueue).toEqual([other, own])
      expect(
        scenario.match.dispatch({ type: 'end-turn', participantId: own }).state
          .activePlayerId
      ).toBe(other)
      expect(
        scenario.match.dispatch({ type: 'end-turn', participantId: other }).state
          .activePlayerId
      ).toBe(own)
      const resumed = scenario.match.dispatch({ type: 'end-turn', participantId: own })
      expect(resumed.state.activePlayerId).toBe(other)
      expect(resumed.state.isExtraTurn).toBeUndefined()
    })
  })

  it('retains public queue state through isolated previews, analysis, AI observations, checkpoints and replay', () => {
    withActions([{ ...grant, amount: 2 }], (scenario, own) => {
      const { match } = scenario
      const original = match.getCheckpoint()
      const card = player(scenario, own).hand.find((card) => card.cardId === spellId)!
      const commands = [
        { type: 'play-card', participantId: own, cardInstanceId: card.instanceId },
        { type: 'end-turn', participantId: own },
        { type: 'end-turn', participantId: own },
        { type: 'end-turn', participantId: own }
      ]
      const results = commands.map((command) => {
        const before = match.getCheckpoint()
        const preview = match.preview(command)
        expect(match.getCheckpoint()).toEqual(before)
        const result = match.dispatch(command)
        expect(result).toEqual(preview)
        expect(result.accepted).toBe(true)
        return result
      })
      const replay = createOpeningMatchFromCheckpoint(structuredClone(original))
      expect(commands.map((command) => replay.dispatch(command))).toEqual(results)
      expect(replay.getCheckpoint()).toEqual(match.getCheckpoint())
      const queued = createOpeningMatchFromCheckpoint({
        ...original,
        state: results[0]!.state
      })
      const baseline = queued.getCheckpoint()
      const observation = queued.getAiObservation!(own, 'fair')
      expect(observation.extraTurnQueue).toEqual([own, own])
      expect(queued.getPublicState!(own).extraTurnQueue).toEqual([own, own])
      ;(observation.extraTurnQueue as unknown as PlayerId[]).pop()
      queued.analyze((fork) => {
        fork.dispatch({ type: 'end-turn', participantId: own })
        expect(fork.getState().isExtraTurn).toBe(true)
      })
      expect(queued.getCheckpoint()).toEqual(baseline)
    })
  })

  it('runs end/start schedules and expires until-next-turn effects at the actual next own turn', () => {
    withActions(
      [
        { action: 'gain-armor', target: ownHero, amount: 1 },
        {
          action: 'schedule',
          trigger: 'end-of-turn',
          actions: [{ action: 'gain-armor', target: ownHero, amount: 2 }]
        },
        {
          action: 'schedule',
          trigger: 'start-of-turn',
          actions: [{ action: 'gain-armor', target: ownHero, amount: 4 }]
        },
        {
          action: 'modify',
          target: ownHero,
          attack: 3,
          duration: 'until-next-turn'
        },
        grant
      ],
      (scenario, own) => {
        play(scenario, own, spellId)
        expect(player(scenario, own).hero.armor).toBe(1)
        const result = scenario.match.dispatch({ type: 'end-turn', participantId: own })
        expect(result.accepted).toBe(true)
        expect(player(scenario, own).hero.armor).toBe(7)
        expect(player(scenario, own).hero.attack).toBe(0)
        expect(result.state.scheduledEffects).toEqual([])
      }
    )
  })

  it('defers owner-relative schedules through other players extra and regular turns', () => {
    withActions(
      [
        {
          action: 'schedule',
          trigger: 'start-of-turn',
          actions: [{ action: 'gain-armor', target: ownHero, amount: 4 }]
        },
        { ...grant, player: 'opponent' }
      ],
      (scenario, own, other) => {
        play(scenario, own, spellId)
        expect(
          scenario.match.dispatch({ type: 'end-turn', participantId: own }).state
            .activePlayerId
        ).toBe(other)
        expect(player(scenario, own).hero.armor).toBe(0)
        expect(
          scenario.match.dispatch({ type: 'end-turn', participantId: other }).state
            .activePlayerId
        ).toBe(other)
        expect(player(scenario, own).hero.armor).toBe(0)
        expect(
          scenario.match.dispatch({ type: 'end-turn', participantId: other }).state
            .activePlayerId
        ).toBe(own)
        expect(player(scenario, own).hero.armor).toBe(4)
      }
    )
  })

  it('resolves attached next-own-turn effects at the extra turn and not a fixed turn number', () => {
    withActions(
      [
        {
          action: 'schedule',
          trigger: 'start-of-turn',
          attachedToTarget: true,
          target: { type: 'minion', controller: 'self', selection: 'all' },
          actions: [
            { action: 'destroy', target: { type: 'minion', selection: 'event-target' } }
          ]
        },
        grant
      ],
      (scenario, own) => {
        expect(
          scenario.match.dispatch({
            type: 'dev-summon-minion',
            participantId: own,
            cardId: 'basic_chillwind_yeti'
          }).accepted
        ).toBe(true)
        play(scenario, own, spellId)
        expect(player(scenario, own).board).toHaveLength(1)
        const result = scenario.match.dispatch({ type: 'end-turn', participantId: own })
        expect(result.accepted).toBe(true)
        expect(player(scenario, own).board).toHaveLength(0)
      }
    )
  })

  it('burns the automatic extra-turn draw at a full hand and rejects the inactive player', () => {
    withActions([grant], (scenario, own, other) => {
      play(scenario, own, spellId)
      while (player(scenario, own).hand.length < 10) addCard(scenario, own, spellId)
      const before = scenario.match.getCheckpoint()
      expect(
        scenario.match.dispatch({ type: 'end-turn', participantId: other }).accepted
      ).toBe(false)
      expect(scenario.match.getCheckpoint()).toEqual(before)
      const result = scenario.match.dispatch({ type: 'end-turn', participantId: own })
      expect(result.accepted).toBe(true)
      expect(result.events.filter((event) => event.type === 'card-burned')).toEqual([
        expect.objectContaining({ participantId: own, origin: 'deck' })
      ])
      expect(player(scenario, own).hand).toHaveLength(10)
    })
  })

  it('keeps a frozen opponent frozen until it has had a turn despite consecutive extra turns', () => {
    withActions(
      [
        { action: 'freeze', target: { type: 'hero', controller: 'opponent' } },
        { ...grant, amount: 2 }
      ],
      (scenario, own, other) => {
        play(scenario, own, spellId)
        for (let index = 0; index < 3; index++) {
          const result = scenario.match.dispatch({
            type: 'end-turn',
            participantId: own
          })
          expect(result.accepted).toBe(true)
          expect(player(scenario, other).hero.frozenUntilTurn).toBeGreaterThanOrEqual(
            result.state.turnNumber
          )
        }
        const result = scenario.match.dispatch({
          type: 'end-turn',
          participantId: other
        })
        expect(player(scenario, other).hero.frozenUntilTurn).toBeLessThan(
          result.state.turnNumber
        )
      }
    )
  })

  it('preserves next-turn spell and hero-power taxes until the opponent actually plays', () => {
    withActions(
      [
        {
          action: 'change-cost',
          target: {
            type: 'spell-card',
            controller: 'opponent',
            filter: { cardType: 'Spell' }
          },
          amount: 5,
          duration: 'next-turn',
          deferUntil: 'matching-cards-until-expiry'
        },
        {
          action: 'change-cost',
          target: { type: 'hero-power', controller: 'opponent' },
          amount: 5,
          duration: 'next-turn'
        },
        { ...grant, amount: 2 }
      ],
      (scenario, own, other) => {
        const original = player(scenario, other)
        play(scenario, own, spellId)
        for (let index = 0; index < 2; index++) {
          expect(
            scenario.match.dispatch({ type: 'end-turn', participantId: own }).accepted
          ).toBe(true)
          expect(player(scenario, other).heroPower.cost).toBe(original.heroPower.cost)
        }
        expect(
          scenario.match.dispatch({ type: 'end-turn', participantId: own }).state
            .activePlayerId
        ).toBe(other)
        expect(player(scenario, other).heroPower.cost).toBe(original.heroPower.cost + 5)
        expect(
          player(scenario, other)
            .hand.filter((card) => card.cardId === spellId)
            .every((card) => card.currentCost === 8)
        ).toBe(true)
        expect(
          scenario.match.dispatch({ type: 'end-turn', participantId: other }).accepted
        ).toBe(true)
        expect(player(scenario, other).heroPower.cost).toBe(original.heroPower.cost)
        expect(
          player(scenario, other)
            .hand.filter((card) => card.cardId === spellId)
            .every((card) => card.currentCost === 3)
        ).toBe(true)
      }
    )
  })

  it('applies overload on the extra turn and preserves the opponent resources', () => {
    withActions([{ action: 'overload', amount: 3 }, grant], (scenario, own, other) => {
      play(scenario, own, spellId)
      const opponent = player(scenario, other)
      const result = scenario.match.dispatch({ type: 'end-turn', participantId: own })
      expect(result.accepted).toBe(true)
      expect(player(scenario, own).mana).toMatchObject({
        maximum: 10,
        available: 7,
        overloadLocked: 3,
        overloadNextTurn: 0
      })
      expect(player(scenario, other).mana).toEqual(opponent.mana)
      expect(player(scenario, other).deck).toEqual(opponent.deck)
    })
  })

  it('ends on fatigue during the extra turn without giving the opponent a turn', () => {
    withActions([grant], (scenario, own, other) => {
      play(scenario, own, spellId)
      const checkpoint = scenario.match.getCheckpoint()
      const match = createOpeningMatchFromCheckpoint({
        ...checkpoint,
        state: {
          ...checkpoint.state,
          players: checkpoint.state.players.map((p) =>
            p.participantId === own
              ? {
                  ...p,
                  deck: [],
                  hero: { ...p.hero, health: 1, damageTaken: p.hero.maxHealth - 1 }
                }
              : p
          ) as unknown as typeof checkpoint.state.players
        }
      })
      const result = match.dispatch({ type: 'end-turn', participantId: own })
      expect(result.accepted).toBe(true)
      expect(result.state.phase).toBe('ended')
      expect(result.state.winnerId).toBe(other)
      expect(result.events.filter((event) => event.type === 'turn-started')).toEqual([
        expect.objectContaining({ participantId: own, isExtraTurn: true })
      ])
    })
  })

  it('does not start or consume an extra turn after lethal end-of-turn effects', () => {
    withActions(
      [
        grant,
        {
          action: 'schedule',
          trigger: 'end-of-turn',
          actions: [{ action: 'damage', amount: 100, target: ownHero }]
        }
      ],
      (scenario, own, other) => {
        play(scenario, own, spellId)
        const result = scenario.match.dispatch({ type: 'end-turn', participantId: own })
        expect(result.accepted).toBe(true)
        expect(result.state.phase).toBe('ended')
        expect(result.state.winnerId).toBe(other)
        expect(result.state.extraTurnQueue).toEqual([own])
        expect(result.events.some((event) => event.type === 'turn-started')).toBe(false)
      }
    )
  })
})

describe('Time Warp once per player per game', () => {
  const warp = 'journey_to_ungoro_time_warp'
  function castWarp(scenario: Scenario, who: PlayerId, accepted = true) {
    addCard(scenario, who, warp)
    setMana(scenario, who)
    const card = player(scenario, who).hand.find((card) => card.cardId === warp)!
    const command = {
      type: 'play-card',
      participantId: who,
      cardInstanceId: card.instanceId
    }
    const before = scenario.match.getCheckpoint()
    const preview = scenario.match.preview(command)
    expect(scenario.match.getCheckpoint()).toEqual(before)
    const result = scenario.match.dispatch(command)
    expect(result).toEqual(preview)
    expect(result.accepted).toBe(accepted)
    if (!accepted) {
      expect(scenario.match.getCheckpoint()).toEqual(before)
      expect(scenario.match.getLegality!(who).playableCardInstanceIds).not.toContain(
        card.instanceId
      )
      expect(scenario.match.getPlayInput!(who, card.instanceId)).toBeNull()
      expect(
        enumerateLegalCommands(
          {
            getState: scenario.match.getState,
            getPlayInput: scenario.match.getPlayInput!,
            getLegality: scenario.match.getLegality!
          },
          asPlayerId(who)
        ).some(
          (command) =>
            command.type === 'play-card' && command.cardInstanceId === card.instanceId
        )
      ).toBe(false)
    }
    return result
  }
  it('grants one turn, rejects additional grants from generated copies, and does not refill the deck', () => {
    const scenario = ready({ seed: 8113 })
    const [own] = activePlayers(scenario)
    const deck = player(scenario, own).deck
    castWarp(scenario, own)
    expect(scenario.match.getState().extraTurnQueue).toEqual([own])
    expect(player(scenario, own).deck).toEqual(deck)
    castWarp(scenario, own, false)
    expect(scenario.match.getState().extraTurnQueue).toEqual([own])
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: own }).accepted
    ).toBe(true)
    expect(scenario.match.getState().activePlayerId).toBe(own)
    castWarp(scenario, own, false)
    expect(scenario.match.getState().extraTurnQueue ?? []).toEqual([])
    expect(player(scenario, own).counters?.['extra-turn:time-warp']).toBe(1)
  })
  it('allows automatic recasts to resolve without granting another turn', () => {
    const scenario = ready({ seed: 8115 })
    const [own] = activePlayers(scenario)
    castWarp(scenario, own)
    const spellId = asCardId('basic_arcane_intellect')
    const definition = CARD_CATALOG.require(spellId)
    const originalGet = CARD_CATALOG.get.bind(CARD_CATALOG)
    const spy = vi.spyOn(CARD_CATALOG, 'get').mockImplementation((id) =>
      id === spellId
        ? {
            ...definition,
            effects: [
              {
                trigger: 'cast' as const,
                actions: [
                  {
                    action: 'cast-random-spells',
                    count: 2,
                    includeUncollectible: true,
                    pool: [warp]
                  }
                ]
              }
            ]
          }
        : originalGet(id)
    )
    try {
      addCard(scenario, own, spellId)
      setMana(scenario, own)
      play(scenario, own, spellId)
      expect(scenario.match.getState().extraTurnQueue).toEqual([own])
      expect(player(scenario, own).counters?.['extra-turn:time-warp']).toBe(1)
    } finally {
      spy.mockRestore()
    }
  })
  it('lets both players use their own allowance and preserves spent allowance in JSON checkpoints and AI observations', () => {
    const scenario = ready({ seed: 8114 })
    const [own, other] = activePlayers(scenario)
    castWarp(scenario, own)
    for (let n = 0; n < 2; n++)
      expect(
        scenario.match.dispatch({ type: 'end-turn', participantId: own }).accepted
      ).toBe(true)
    expect(scenario.match.getState().activePlayerId).toBe(other)
    castWarp(scenario, other)
    expect(scenario.match.getState().extraTurnQueue).toEqual([other])
    const restored = createOpeningMatchFromCheckpoint(
      JSON.parse(JSON.stringify(scenario.match.getCheckpoint()))
    )
    expect(
      restored
        .getState()
        .players.every((p) => p.counters?.['extra-turn:time-warp'] === 1)
    ).toBe(true)
    addCard(scenario, other, warp)
    setMana(scenario, other)
    const spentCard = player(scenario, other).hand.find((card) => card.cardId === warp)!
    const restoredWithCopy = createOpeningMatchFromCheckpoint(
      JSON.parse(JSON.stringify(scenario.match.getCheckpoint()))
    )
    expect(restoredWithCopy.getLegality!(other).playableCardInstanceIds).not.toContain(
      spentCard.instanceId
    )
    expect(
      restoredWithCopy.dispatch({
        type: 'play-card',
        participantId: other,
        cardInstanceId: spentCard.instanceId
      }).accepted
    ).toBe(false)
    expect(
      scenario.match.getAiObservation!(own, 'fair').players.every(
        (p) => p.effects.counters?.['extra-turn:time-warp'] === 1
      )
    ).toBe(true)
  })
})
