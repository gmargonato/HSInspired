import { describe, expect, it } from 'vitest'
import type { Deck } from '../../../game/decks'
import {
  buildDeckSelectionEntries,
  formatClassWins,
  getDeckSelectionPageCount
} from './deck-selection-model'

function createDeck(index: number, cardCount: number): Deck {
  return {
    id: `deck-${index}`,
    name: `Deck ${index}`,
    heroId: 'guldan' as Deck['heroId'],
    cards: cardCount === 30 ? { test_card: 30 } : { test_card: cardCount },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('deck selection win total', () => {
  it('formats zero and multi-digit totals', () => {
    expect(formatClassWins(0)).toBe('Wins: 0')
    expect(formatClassWins(123)).toBe('Wins: 123')
  })
})

describe('deck selection pagination', () => {
  it('paginates completed decks in stable nine-slot pages', () => {
    const decks = Array.from({ length: 19 }, (_, index) => createDeck(index, 30))
    decks.push(createDeck(20, 29))

    expect(getDeckSelectionPageCount(decks)).toBe(3)
    expect(buildDeckSelectionEntries(decks, 0)).toHaveLength(9)
    expect(buildDeckSelectionEntries(decks, 1).map((entry) => entry.deck.id)).toEqual(
      decks.slice(9, 18).map((deck) => deck.id)
    )
    expect(buildDeckSelectionEntries(decks, 2).map((entry) => entry.deck.id)).toEqual([
      'deck-18'
    ])
  })

  it('keeps an empty first page and clamps out-of-range page requests', () => {
    const incompleteDeck = createDeck(0, 29)

    expect(getDeckSelectionPageCount([incompleteDeck])).toBe(1)
    expect(buildDeckSelectionEntries([incompleteDeck], 10)).toEqual([])
  })
})
