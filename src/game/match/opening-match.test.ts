import { describe, expect, it } from 'vitest'
import { asHeroId } from '../content/cards'
import type { Deck } from '../decks'
import { createOpeningMatch } from './opening-match'
import { createSeededRng } from './rng'
import { asPlayerId, type MatchSetup } from './match-types'

function makeDeck(id: string, cardId = 'basic_fireball'): Deck {
  return {
    id,
    name: id,
    heroId: asHeroId(id === 'human-deck' ? 'jaina' : 'guldan'),
    cards: { [cardId]: 30 },
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z'
  }
}

function makeSetup(seed = 42): MatchSetup {
  return {
    seed,
    participants: [
      {
        participantId: asPlayerId('human-player'),
        controllerKind: 'human',
        heroId: asHeroId('jaina'),
        deckId: 'human-deck'
      },
      {
        participantId: asPlayerId('ai-player'),
        controllerKind: 'ai',
        heroId: asHeroId('guldan'),
        deckId: 'ai-deck'
      }
    ]
  }
}

describe('opening match', () => {
  it('deals Hearthstone opening hands and resolves both mulligans', () => {
    const match = createOpeningMatch(
      makeSetup(),
      [makeDeck('human-deck'), makeDeck('ai-deck')],
      createSeededRng(7)
    )
    const initial = match.getState()
    expect(initial.phase).toBe('mulligan')
    expect(initial.players.map((player) => player.hand.length).sort()).toEqual([3, 4])

    const playerOne = initial.players[0]
    const playerTwo = initial.players[1]
    const replaced = playerOne.hand[0]
    expect(replaced).toBeDefined()

    const first = match.dispatch({
      type: 'confirm-mulligan',
      participantId: playerOne.participantId,
      replaceInstanceIds: replaced ? [replaced.instanceId] : []
    })
    expect(first.accepted).toBe(true)
    expect(first.events.some((event) => event.type === 'mulligan-resolved')).toBe(true)

    const second = match.dispatch({
      type: 'confirm-mulligan',
      participantId: playerTwo.participantId,
      replaceInstanceIds: []
    })
    expect(second.accepted).toBe(true)
    expect(second.events.map((event) => event.type)).toEqual([
      'mulligan-resolved',
      'coin-granted',
      'opening-turn-started',
      'opening-card-drawn'
    ])

    const finalState = match.getState()
    expect(finalState.phase).toBe('first-turn')
    expect(finalState.activePlayerId).toBe(finalState.playerOneId)
    expect(
      finalState.players[1].hand.some((card) => card.cardId === 'basic_the_coin')
    ).toBe(true)
    expect(finalState.players[0].hand).toHaveLength(4)
    expect(finalState.players[1].hand).toHaveLength(4 + 1)
    expect(
      replaced &&
        finalState.players[0].hand.some(
          (card) => card.instanceId === replaced.instanceId
        )
    ).toBe(false)
  })

  it('rejects duplicate or foreign card selections without mutation', () => {
    const match = createOpeningMatch(
      makeSetup(),
      [makeDeck('human-deck'), makeDeck('ai-deck')],
      createSeededRng(9)
    )
    const player = match.getState().players[0]
    const card = player.hand[0]
    expect(card).toBeDefined()
    const before = match.getState()

    const result = match.dispatch({
      type: 'confirm-mulligan',
      participantId: player.participantId,
      replaceInstanceIds: card ? [card.instanceId, card.instanceId] : []
    })
    expect(result.accepted).toBe(false)
    if (result.accepted) throw new Error('Expected invalid mulligan selection.')
    expect(result.code).toBe('invalid-card-selection')
    expect(match.getState()).toEqual(before)
  })

  it('is deterministic for a supplied seed, including player assignment', () => {
    const setup = makeSetup(123)
    const first = createOpeningMatch(
      setup,
      [makeDeck('human-deck'), makeDeck('ai-deck')],
      createSeededRng(123)
    )
    const second = createOpeningMatch(
      setup,
      [makeDeck('human-deck'), makeDeck('ai-deck')],
      createSeededRng(123)
    )
    expect(JSON.stringify(first.getState())).toBe(JSON.stringify(second.getState()))
  })
})
