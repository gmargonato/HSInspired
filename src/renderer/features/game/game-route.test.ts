import { asPlayerId, type MatchSetup } from '../../../game/match'
import { asHeroId } from '../../../game/content/cards'
import { createRestartGameRoute, type GameRoute } from './game-route'
import { describe, expect, it } from 'vitest'
import type { Deck } from '../../../game/decks'

describe('createRestartGameRoute', () => {
  it('preserves the matchup while replacing the match seed', () => {
    const setup: MatchSetup = {
      seed: 11,
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
    const route: GameRoute = { id: 'game', setup }

    expect(createRestartGameRoute(route, 22)).toEqual({
      id: 'game',
      setup: {
        ...setup,
        seed: 22
      }
    })
  })

  it('preserves Tavern mode and temporary decks', () => {
    const decks: readonly Deck[] = [
      {
        id: 'temporary-deck',
        name: 'Temporary',
        heroId: asHeroId('jaina'),
        cards: {},
        createdAt: '1970-01-01T00:00:00.000Z',
        updatedAt: '1970-01-01T00:00:00.000Z'
      }
    ]
    const route: GameRoute = {
      id: 'game',
      mode: 'tavern-brawl',
      deckSnapshots: decks,
      setup: {
        seed: 11,
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

    expect(createRestartGameRoute(route, 22)).toMatchObject({
      mode: 'tavern-brawl',
      deckSnapshots: decks,
      setup: { seed: 22 }
    })
  })
})
