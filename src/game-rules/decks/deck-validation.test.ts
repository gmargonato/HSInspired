import { describe, expect, it } from 'vitest'
import { parseDeck } from './deck-validation'

function deckWithName(name: string): Record<string, unknown> {
  return {
    id: 'deck-1',
    name,
    heroId: 'guldan',
    cards: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('deck name validation', () => {
  it('accepts names up to fifteen characters', () => {
    expect(parseDeck(deckWithName('Fifteen chars!!')).name).toBe('Fifteen chars!!')
  })

  it('rejects names longer than fifteen characters', () => {
    expect(() => parseDeck(deckWithName('Sixteen chars!!!'))).toThrow(
      'deck.name exceeds 15 characters'
    )
  })
})
