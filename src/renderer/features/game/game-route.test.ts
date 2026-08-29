import { asPlayerId, type MatchSetup } from '../../../game/match'
import { asHeroId } from '../../../game/content/cards'
import { createRestartGameRoute, type GameRoute } from './game-route'
import { describe, expect, it } from 'vitest'

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
})
