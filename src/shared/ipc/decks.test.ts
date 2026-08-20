import { describe, expect, it } from 'vitest'
import {
  parseDeckCreateRequest,
  parseDeckId,
  parseDeckListResponse,
  parseDeckResponse
} from './decks'

const validDeck = {
  id: 'deck-1',
  name: 'Jaina',
  heroId: 'jaina',
  cards: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('deck IPC boundary validation', () => {
  it('accepts valid requests and responses while rejecting malformed input', () => {
    expect(parseDeckCreateRequest({ name: 'Jaina', heroId: 'jaina' })).toEqual({
      name: 'Jaina',
      heroId: 'jaina'
    })
    expect(parseDeckResponse(validDeck)).toEqual(validDeck)
    expect(parseDeckListResponse([validDeck])).toEqual([validDeck])

    expect(() => parseDeckCreateRequest({ heroId: 7 })).toThrow('heroId')
    expect(() => parseDeckResponse({ ...validDeck, heroId: undefined })).toThrow(
      'heroId is required'
    )
    expect(() => parseDeckListResponse({ decks: [validDeck] })).toThrow(
      'must be an array'
    )
    expect(() => parseDeckResponse({ ...validDeck, heroId: 'missing-hero' })).toThrow(
      'Unknown hero id'
    )
    expect(() => parseDeckId('')).toThrow('Invalid deck id')
  })
})
