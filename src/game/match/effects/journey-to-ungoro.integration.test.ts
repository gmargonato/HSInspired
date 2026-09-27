import { describe, expect, it } from 'vitest'
import { CARD_CATALOG, asCardId } from '../../content/cards'
import { createMatchScenario } from '../testing/match-scenario-builder'

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
