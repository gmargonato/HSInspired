import { describe, expect, it } from 'vitest'
import { createHumanVsAiMatchSetup } from './match-setup'
import { createTurnMatch } from './turn-match'
import type { Deck } from '../decks'
import { asCardId } from '../content/cards'

function deck(id: string, heroId: string): Deck {
  return {
    id: id as Deck['id'],
    name: id,
    heroId: heroId as Deck['heroId'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cards: {
      [asCardId('basic_acidic_swamp_ooze')]: 15,
      [asCardId('basic_ancestral_healing')]: 15
    }
  }
}

describe('turn match facade', () => {
  it('exposes the turn-capable engine under its domain name', () => {
    const setup = createHumanVsAiMatchSetup(
      {
        humanDeck: deck('human-deck', 'jaina'),
        aiDeck: deck('ai-deck', 'guldan')
      },
      7
    )
    const match = createTurnMatch(setup, [
      deck('human-deck', 'jaina'),
      deck('ai-deck', 'guldan')
    ])

    expect(match.getState().phase).toBe('mulligan')
    expect(
      match.dispatch({
        type: 'confirm-mulligan',
        participantId: 'ai-player',
        replaceInstanceIds: []
      }).accepted
    ).toBe(true)
  })
})
