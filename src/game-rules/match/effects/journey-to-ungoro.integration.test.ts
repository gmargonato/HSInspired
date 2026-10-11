import { describe, expect, it, vi } from 'vitest'
import { CARD_CATALOG, asCardId, asHeroId } from '../../content/cards'
import { createMatchScenario } from '../testing/match-scenario-builder'

import { DeckRules, type Deck } from '../../decks'
import { asPlayerId } from '../match-types'
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
    position: 0
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
      .hand.filter((card) => CARD_CATALOG.require(card.cardId).type === 'Minion')
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
