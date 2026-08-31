import { describe, expect, it } from 'vitest'
import { formatClassWins } from './deck-selection-model'

describe('deck selection win total', () => {
  it('formats zero and multi-digit totals', () => {
    expect(formatClassWins(0)).toBe('Wins: 0')
    expect(formatClassWins(123)).toBe('Wins: 123')
  })
})
