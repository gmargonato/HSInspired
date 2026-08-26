import { asHeroId } from '../content/cards'
import type { Deck } from '../decks'
import { describe, expect, it } from 'vitest'
import { asPlayerId, type MatchSetup } from './match-types'
import { createOpeningMatch, type OpeningCommandResult } from './opening-match'

const HUMAN_ID = asPlayerId('human-player')
const OPPONENT_ID = asPlayerId('opponent-player')

function accept(result: OpeningCommandResult): void {
  expect(result.accepted, result.accepted ? undefined : result.message).toBe(true)
}

function deck(id: string, heroId: string): Deck {
  return {
    id,
    name: id,
    heroId: asHeroId(heroId),
    cards: { basic_acidic_swamp_ooze: 30 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function createStartedMatch() {
  const setup: MatchSetup = {
    seed: 1,
    participants: [
      {
        participantId: HUMAN_ID,
        controllerKind: 'human',
        heroId: asHeroId('rexxar'),
        deckId: 'human-deck'
      },
      {
        participantId: OPPONENT_ID,
        controllerKind: 'ai',
        heroId: asHeroId('jaina'),
        deckId: 'opponent-deck'
      }
    ]
  }
  const match = createOpeningMatch(
    setup,
    [deck('human-deck', 'rexxar'), deck('opponent-deck', 'jaina')],
    { next: () => 0.1 }
  )
  accept(
    match.dispatch({
      type: 'confirm-mulligan',
      participantId: HUMAN_ID,
      replaceInstanceIds: []
    })
  )
  accept(
    match.dispatch({
      type: 'confirm-mulligan',
      participantId: OPPONENT_ID,
      replaceInstanceIds: []
    })
  )
  return match
}

describe('dev deck commands', () => {
  it('destroys only the selected player deck', () => {
    const match = createStartedMatch()
    const before = match.getState()

    const result = match.dispatch({
      type: 'dev-modify-deck',
      participantId: OPPONENT_ID,
      action: 'destroy'
    })

    accept(result)
    const state = match.getState()
    expect(state.players[0].deck).toHaveLength(before.players[0].deck.length)
    expect(state.players[1].deck).toHaveLength(0)
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'dev-deck-modified',
        participantId: OPPONENT_ID,
        action: 'destroy',
        deckCount: 0
      })
    )
  })

  it('refills a selected deck with a fresh full set of card instances', () => {
    const match = createStartedMatch()
    const before = match.getState().players[0]
    accept(
      match.dispatch({
        type: 'dev-modify-deck',
        participantId: HUMAN_ID,
        action: 'destroy'
      })
    )

    const result = match.dispatch({
      type: 'dev-modify-deck',
      participantId: HUMAN_ID,
      action: 'refill'
    })

    accept(result)
    const after = match.getState().players[0]
    expect(after.deck).toHaveLength(30)
    expect(after.deck.every((card) => card.cardId === 'basic_acidic_swamp_ooze')).toBe(
      true
    )
    expect(new Set(after.deck.map((card) => card.instanceId)).size).toBe(30)
    expect(
      after.deck.some((card) =>
        before.hand.some((handCard) => handCard.instanceId === card.instanceId)
      )
    ).toBe(false)
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'dev-deck-modified',
        participantId: HUMAN_ID,
        action: 'refill',
        deckCount: 30
      })
    )
  })

  it('rejects deck changes before turns begin', () => {
    const setup: MatchSetup = {
      participants: [
        {
          participantId: HUMAN_ID,
          controllerKind: 'human',
          heroId: asHeroId('rexxar'),
          deckId: 'human-deck'
        },
        {
          participantId: OPPONENT_ID,
          controllerKind: 'ai',
          heroId: asHeroId('jaina'),
          deckId: 'opponent-deck'
        }
      ]
    }
    const match = createOpeningMatch(setup, [
      deck('human-deck', 'rexxar'),
      deck('opponent-deck', 'jaina')
    ])

    expect(
      match.dispatch({
        type: 'dev-modify-deck',
        participantId: HUMAN_ID,
        action: 'destroy'
      })
    ).toMatchObject({ accepted: false, code: 'wrong-phase' })
  })
})
