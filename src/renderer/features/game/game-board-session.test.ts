import { describe, expect, it } from 'vitest'
import { createHumanVsAiMatchSetup } from '../../../game/match'
import type { Deck } from '../../../game/decks'
import { asCardId } from '../../../game/content/cards'
import { GameBoardSession } from './game-board-session'

function makeDeck(id: string): Deck {
  return {
    id: id as Deck['id'],
    name: id,
    heroId: (id.includes('human') ? 'jaina' : 'guldan') as Deck['heroId'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cards: {
      [asCardId('basic_acidic_swamp_ooze')]: 15,
      [asCardId('basic_ancestral_healing')]: 15
    }
  }
}

describe('GameBoardSession', () => {
  it('resolves participant roles once and dispatches domain commands', () => {
    const setup = createHumanVsAiMatchSetup(
      {
        humanDeck: makeDeck('human-deck'),
        aiDeck: makeDeck('ai-deck')
      },
      17
    )
    const session = new GameBoardSession({
      setup,
      decks: [makeDeck('human-deck'), makeDeck('ai-deck')]
    })

    expect(session.localParticipantId).toBe('human-player')
    expect(session.remoteParticipantId).toBe('ai-player')
    expect(session.getState().phase).toBe('mulligan')
    expect(
      session.dispatch({
        type: 'confirm-mulligan',
        participantId: session.remoteParticipantId,
        replaceInstanceIds: []
      }).accepted
    ).toBe(true)
  })
})
