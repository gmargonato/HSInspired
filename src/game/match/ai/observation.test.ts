import { describe, expect, it } from 'vitest'
import { asCardId } from '../../content/cards'
import { cloneOpeningMatchState } from '../opening-match'
import { createMatchScenario } from '../testing/match-scenario-builder'
import { createAiObservation } from './observation'
import { AiTranspositionCache, hashAiState } from './state-hash'

describe('competitive AI observation', () => {
  it('reveals both decklists and the exact opponent hand without hidden order metadata', () => {
    const scenario = createMatchScenario({ seed: 71 })
    const state = scenario.match.getState()
    const viewer = scenario.participants[1]
    const observation = scenario.match.getAiObservation!(
      viewer,
      'opponent-deck-and-hand'
    )
    const opponent = state.players.find((player) => player.participantId !== viewer)!
    const observedOpponent = observation.players.find(
      (player) => player.role === 'opponent'
    )!

    expect(observation.informationPolicy).toBe('opponent-deck-and-hand')
    expect(observation.originalDecks).toHaveLength(2)
    expect(observedOpponent.hand.map((card) => card.cardId)).toEqual(
      opponent.hand.map((card) => card.cardId).sort()
    )
    expect(observedOpponent.deckSize).toBe(opponent.deck.length)
    expect(JSON.stringify(observedOpponent.hand)).not.toContain('instanceId')
  })

  it('is invariant to remaining deck order, hidden ids, and facedown secret identity', () => {
    const scenario = createMatchScenario({ seed: 72 })
    const original = scenario.match.getState()
    const viewer = scenario.participants[1]
    const opponentIndex = original.players.findIndex(
      (player) => player.participantId !== viewer
    ) as 0 | 1
    const changed = cloneOpeningMatchState(original)
    const players = [...changed.players] as typeof changed.players extends readonly [
      infer A,
      infer B
    ]
      ? [A, B]
      : never
    const opponent = players[opponentIndex]
    players[opponentIndex] = {
      ...opponent,
      deck: [...opponent.deck].reverse().map((card, index) => ({
        ...card,
        instanceId: `hidden-reordered-${index}`,
        creationOrdinal: 90_000 + index
      })),
      secrets: [
        {
          instanceId: 'hidden-secret-b',
          cardId: asCardId('classic_ice_barrier'),
          ownerId: opponent.participantId,
          controllerId: opponent.participantId,
          creationOrdinal: 99_000,
          revealed: false
        }
      ]
    }
    const baselineWithSecret = cloneOpeningMatchState(original)
    const baselinePlayers = [...baselineWithSecret.players] as typeof players
    const baselineOpponent = baselinePlayers[opponentIndex]
    baselinePlayers[opponentIndex] = {
      ...baselineOpponent,
      secrets: [
        {
          instanceId: 'hidden-secret-a',
          cardId: asCardId('classic_counterspell'),
          ownerId: baselineOpponent.participantId,
          controllerId: baselineOpponent.participantId,
          creationOrdinal: 88_000,
          revealed: false
        }
      ]
    }
    const first = createAiObservation(
      { ...baselineWithSecret, players: baselinePlayers },
      scenario.setup,
      scenario.decks,
      viewer
    )
    const second = createAiObservation(
      { ...changed, players },
      scenario.setup,
      scenario.decks,
      viewer
    )

    expect(second).toEqual(first)
  })
})

describe('competitive AI state hash and cache', () => {
  it('collapses order-only state differences and evicts oldest entries', () => {
    expect(hashAiState({ revision: 1, deck: [{ cardId: 'a' }, { cardId: 'b' }] })).toBe(
      hashAiState({ revision: 99, deck: [{ cardId: 'b' }, { cardId: 'a' }] })
    )
    const cache = new AiTranspositionCache<number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBe(1)
    cache.set('c', 3)
    expect(cache.size).toBe(2)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.hitCount).toBe(1)
  })
})
