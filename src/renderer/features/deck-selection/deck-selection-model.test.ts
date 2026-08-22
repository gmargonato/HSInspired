import { describe, expect, it } from 'vitest'
import { asHeroId } from '../../../game/content/cards'
import { MAX_DECKS, type Deck } from '../../../game/decks'
import { buildDeckSelectionEntries, chooseOpponentDeck } from './deck-selection-model'

function makeDeck(id: string, cardCounts: readonly number[]): Deck {
  return {
    id,
    name: `Deck ${id}`,
    heroId: asHeroId('jaina'),
    cards: Object.fromEntries(
      cardCounts.map((count, index) => [`card-${index}`, count])
    ),
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z'
  }
}

describe('deck selection model', () => {
  it('includes only decks containing exactly 30 cards', () => {
    const entries = buildDeckSelectionEntries([
      makeDeck('incomplete', [29]),
      makeDeck('complete-with-copies', [2, 28]),
      makeDeck('overfull', [31])
    ])

    expect(entries.map((entry) => entry.deck.id)).toEqual(['complete-with-copies'])
  })

  it('preserves deck order and assigns stable 3x3 positions', () => {
    const decks = Array.from({ length: MAX_DECKS + 2 }, (_, index) =>
      makeDeck(String(index), [30])
    )

    const entries = buildDeckSelectionEntries(decks)

    expect(entries).toHaveLength(MAX_DECKS)
    expect(entries.map(({ deck, column, row }) => [deck.id, column, row])).toEqual([
      ['0', 0, 0],
      ['1', 1, 0],
      ['2', 2, 0],
      ['3', 0, 1],
      ['4', 1, 1],
      ['5', 2, 1],
      ['6', 0, 2],
      ['7', 1, 2],
      ['8', 2, 2]
    ])
  })

  it('chooses a deterministic alternative opponent and allows a mirror fallback', () => {
    const local = makeDeck('local', [30])
    const alternative = makeDeck('alternative', [30])
    expect(chooseOpponentDeck([local, alternative], 'local', 17)?.id).toBe(
      'alternative'
    )
    expect(chooseOpponentDeck([local], 'local', 17)?.id).toBe('local')
  })
})
