import { describe, expect, it } from 'vitest'
import { asCardId } from '../../content/cards'
import { cloneOpeningMatchState } from '../opening-match'
import { createMatchScenario } from '../testing/match-scenario-builder'
import { createAiObservation } from './observation'
import { AiTranspositionCache, hashAiState } from './state-hash'
import { AiStrategicTracker } from './strategic-tracker'
import type { OpeningMatchPublicEvent, OpeningMatchState } from '../opening-match-types'

describe('fair strategic AI observation', () => {
  it('hides unrevealed opponent cards while preserving public counts', () => {
    const scenario = createMatchScenario({ seed: 71 })
    const state = scenario.match.getState()
    const viewer = scenario.participants[1]
    const observation = scenario.match.getAiObservation!(viewer, 'fair')
    const opponent = state.players.find((player) => player.participantId !== viewer)!
    const observedOpponent = observation.players.find(
      (player) => player.role === 'opponent'
    )!

    expect(observation.informationPolicy).toBe('fair')
    expect(observation.selfOriginalDeck.id).toBe(
      scenario.decks.find((deck) => deck.id === scenario.setup.participants[1]?.deckId)
        ?.id
    )
    expect(observedOpponent.hand).toEqual([])
    expect(observedOpponent.handSize).toBe(opponent.hand.length)
    expect(observedOpponent.deckSize).toBe(opponent.deck.length)
    expect(JSON.stringify(observedOpponent.hand)).not.toContain('instanceId')
  })

  it('retains an opponent hand identity explicitly revealed to the viewer', () => {
    const scenario = createMatchScenario({ seed: 77 })
    const original = scenario.match.getState()
    const viewer = scenario.participants[1]
    const opponent = original.players.find((player) => player.participantId !== viewer)!
    const revealedCard = opponent.hand[0]!
    const withRevealedCard = {
      ...original,
      players: original.players.map((player) =>
        player.participantId === opponent.participantId
          ? {
              ...player,
              hand: player.hand.map((card) =>
                card.instanceId === revealedCard.instanceId
                  ? {
                      ...card,
                      currentCost: 0,
                      knownTo: [...(card.knownTo ?? []), viewer]
                    }
                  : card
              )
            }
          : player
      )
    } as unknown as OpeningMatchState

    const observation = createAiObservation(
      withRevealedCard,
      scenario.setup,
      scenario.decks,
      viewer
    )
    const observedOpponent = observation.players.find(
      (player) => player.role === 'opponent'
    )!

    expect(observedOpponent.hand).toEqual([
      expect.objectContaining({ cardId: revealedCard.cardId, currentCost: null })
    ])
    expect(observedOpponent.handSize).toBe(opponent.hand.length)
  })

  it('retains own Secret identity while masking the opposing facedown Secret', () => {
    const scenario = createMatchScenario({ seed: 78 })
    const original = scenario.match.getState()
    const viewer = scenario.participants[1]
    const withSecrets = {
      ...original,
      players: original.players.map((player, index) => ({
        ...player,
        secrets: [
          {
            instanceId: `secret-${index}`,
            cardId: asCardId(
              player.participantId === viewer
                ? 'classic_ice_barrier'
                : 'classic_counterspell'
            ),
            ownerId: player.participantId,
            controllerId: player.participantId,
            creationOrdinal: 20_000 + index,
            revealed: false
          }
        ]
      }))
    } as unknown as OpeningMatchState

    const observation = createAiObservation(
      withSecrets,
      scenario.setup,
      scenario.decks,
      viewer
    )

    expect(
      observation.players.find((player) => player.role === 'self')?.secrets
    ).toEqual([{ revealed: false, cardId: 'classic_ice_barrier' }])
    expect(
      observation.players.find((player) => player.role === 'opponent')?.secrets
    ).toEqual([{ revealed: false, cardId: null }])
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
      hand: opponent.hand.map((card) => ({
        ...card,
        cardId: asCardId('basic_murloc_raider'),
        baseCost: 1,
        currentCost: 1
      })),
      deck: [...opponent.deck].reverse().map((card, index) => ({
        ...card,
        cardId: asCardId('basic_war_golem'),
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

describe('strategic AI state hash and cache', () => {
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

describe('fair strategic memory', () => {
  it('tracks repeated combo pieces by copy count', () => {
    const scenario = createMatchScenario({ seed: 79 })
    const original = scenario.match.getState()
    const viewer = scenario.participants[1]
    const withTwoCopies = {
      ...original,
      players: original.players.map((player) =>
        player.participantId === viewer
          ? {
              ...player,
              hand: player.hand.slice(0, 2).map((card) => ({
                ...card,
                cardId: asCardId('basic_frostbolt')
              }))
            }
          : player
      )
    } as unknown as OpeningMatchState
    const tracker = new AiStrategicTracker(
      viewer,
      {
        selfCombos: [
          {
            cardIds: ['basic_frostbolt', 'basic_frostbolt'],
            purpose: 'Two-copy burst package.'
          }
        ]
      },
      withTwoCopies
    )

    expect(tracker.snapshot.combos[0]).toMatchObject({
      heldPieces: 2,
      readyPieces: 2,
      requiredPieces: 2,
      viable: true,
      ready: true
    })
  })

  it('learns opponent posture from public evidence and never needs hidden cards', () => {
    const scenario = createMatchScenario({ seed: 73 })
    const state = scenario.match.getState()
    const viewer = scenario.participants[1]
    const opponent = scenario.participants[0]
    const tracker = new AiStrategicTracker(viewer, {}, state)
    const event: OpeningMatchPublicEvent = {
      type: 'history-action-resolved',
      participantId: opponent,
      action: 'card',
      source: {
        id: 'public-source',
        participantId: opponent,
        kind: 'card',
        cardId: asCardId('basic_mind_blast')
      },
      outcomes: [
        {
          kind: 'damage',
          target: {
            id: 'public-target',
            participantId: viewer,
            kind: 'hero',
            cardId: null
          },
          amount: 5
        }
      ]
    }

    const memory = tracker.update(state, [event])

    expect(memory.observedOpponentCardIds).toContain('basic_mind_blast')
    expect(memory.opponentHypotheses).toContainEqual(
      expect.objectContaining({ posture: 'aggression', confidence: 1 })
    )
    expect(memory.reviewReasons).toContain(
      'Opponent converted resources into hero damage.'
    )
    tracker.markReviewed(memory.evidenceFingerprint)
    expect(tracker.snapshot.reviewReasons).toEqual([])
  })

  it('releases a held resource when deterministic survival pressure is reached', () => {
    const scenario = createMatchScenario({ seed: 74 })
    const state = scenario.match.getState()
    const viewer = scenario.participants[1]
    const heldCardId = String(
      state.players.find((player) => player.participantId === viewer)!.hand[0]!.cardId
    )
    const tracker = new AiStrategicTracker(
      viewer,
      {
        reservedCardIds: [heldCardId],
        resourceRules: [
          {
            cardIds: [heldCardId],
            releaseTriggers: ['forced-survival']
          }
        ]
      },
      state
    )
    expect(tracker.snapshot.activeReservedCardIds).toContain(heldCardId)
    const lowHealth = {
      ...state,
      revision: state.revision + 1,
      players: state.players.map((player) =>
        player.participantId === viewer
          ? { ...player, hero: { ...player.hero, health: 5 } }
          : player
      )
    } as unknown as OpeningMatchState

    const memory = tracker.update(lowHealth)

    expect(memory.activeReservedCardIds).not.toContain(heldCardId)
    expect(memory.resources[0]?.releasedBy).toContain('forced-survival')
  })

  it('rules out an unconditional secret after a public non-triggering test', () => {
    const scenario = createMatchScenario({ seed: 75 })
    const original = scenario.match.getState()
    const viewer = scenario.participants[1]
    const opponentId = scenario.participants[0]
    const withSecret = {
      ...original,
      players: original.players.map((player) =>
        player.participantId === opponentId
          ? {
              ...player,
              secrets: [
                {
                  instanceId: 'unknown-secret',
                  cardId: asCardId('classic_ice_barrier'),
                  ownerId: opponentId,
                  controllerId: opponentId,
                  creationOrdinal: 10_000,
                  revealed: false
                }
              ]
            }
          : player
      )
    } as unknown as OpeningMatchState
    const tracker = new AiStrategicTracker(viewer, {}, withSecret)
    const spellEvent: OpeningMatchPublicEvent = {
      type: 'history-action-resolved',
      participantId: viewer,
      action: 'card',
      source: {
        id: 'known-spell',
        participantId: viewer,
        kind: 'card',
        cardId: asCardId('basic_frostbolt')
      },
      outcomes: [
        {
          kind: 'damage',
          target: {
            id: 'opponent-hero',
            participantId: opponentId,
            kind: 'hero',
            cardId: null
          },
          amount: 3
        }
      ]
    }

    const memory = tracker.update(
      { ...withSecret, revision: withSecret.revision + 1 },
      [spellEvent]
    )

    expect(memory.ruledOutOpponentSecretCardIds).toContain('classic_counterspell')
    expect(memory.possibleOpponentSecretCardIds).not.toContain('classic_counterspell')
    expect(memory.possibleOpponentSecretCardIds).toContain('classic_ice_barrier')

    const minionEvent: OpeningMatchPublicEvent = {
      type: 'history-action-resolved',
      participantId: viewer,
      action: 'card',
      source: {
        id: 'known-minion',
        participantId: viewer,
        kind: 'card',
        cardId: asCardId('basic_murloc_raider')
      },
      outcomes: []
    }
    const afterMinionTest = tracker.update(
      { ...withSecret, revision: withSecret.revision + 2 },
      [spellEvent, minionEvent]
    )

    expect(afterMinionTest.ruledOutOpponentSecretCardIds).toContain(
      'classic_mirror_entity'
    )
    expect(afterMinionTest.ruledOutOpponentSecretCardIds).not.toContain(
      'league_of_explorers_sacred_trial'
    )
  })

  it('does not rule out a Secret that could not affect a full board', () => {
    const scenario = createMatchScenario({ seed: 76 })
    scenario.confirmBothMulligans()
    const viewer = scenario.participants[1]
    const opponentId = scenario.participants[0]
    for (let index = 0; index < 7; index += 1) {
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId: opponentId,
          cardId: asCardId('basic_murloc_raider')
        }).accepted
      ).toBe(true)
    }
    const original = scenario.match.getState()
    const withSecret = {
      ...original,
      players: original.players.map((player) =>
        player.participantId === opponentId
          ? {
              ...player,
              secrets: [
                {
                  instanceId: 'unknown-secret-full-board',
                  cardId: asCardId('classic_mirror_entity'),
                  ownerId: opponentId,
                  controllerId: opponentId,
                  creationOrdinal: 10_001,
                  revealed: false
                }
              ]
            }
          : player
      )
    } as unknown as OpeningMatchState
    const tracker = new AiStrategicTracker(viewer, {}, withSecret)
    const minionEvent: OpeningMatchPublicEvent = {
      type: 'history-action-resolved',
      participantId: viewer,
      action: 'card',
      source: {
        id: 'known-minion-full-board-test',
        participantId: viewer,
        kind: 'card',
        cardId: asCardId('basic_murloc_raider')
      },
      outcomes: []
    }

    const memory = tracker.update(
      { ...withSecret, revision: withSecret.revision + 1 },
      [minionEvent]
    )

    expect(memory.ruledOutOpponentSecretCardIds).not.toContain('classic_mirror_entity')
    expect(memory.possibleOpponentSecretCardIds).toContain('classic_mirror_entity')
  })
})
