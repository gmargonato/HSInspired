import { describe, expect, it } from 'vitest'
import { asHeroId } from '../../game/content/cards'
import { createHumanVsAiGameRoute } from './router'

describe('game route contract', () => {
  it('carries the complete human-versus-AI match setup', () => {
    const route = createHumanVsAiGameRoute(
      {
        humanDeck: { id: 'human-deck', heroId: asHeroId('jaina') },
        aiDeck: { id: 'ai-deck', heroId: asHeroId('guldan') }
      },
      42
    )

    expect(route.id).toBe('game')
    expect(route.setup.participants.map((participant) => participant.deckId)).toEqual([
      'human-deck',
      'ai-deck'
    ])
    expect(JSON.parse(JSON.stringify(route))).toEqual(route)
  })
})
