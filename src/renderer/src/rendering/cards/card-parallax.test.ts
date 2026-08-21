import { describe, expect, it } from 'vitest'
import { CARD_PARALLAX_LAYERS } from './card-parallax'

describe('card parallax layers', () => {
  it('adds minor relative depth to stat labels without a mana texture overlay', () => {
    expect(CARD_PARALLAX_LAYERS).toEqual(
      expect.arrayContaining([
        { path: 'card.stats.mana', depth: 30 },
        { path: 'card.stats.mana.label', depth: 8 },
        { path: 'card.stats.attack.label', depth: 8 },
        { path: 'card.stats.health.label', depth: 8 },
        { path: 'card.stats.durability.label', depth: 8 }
      ])
    )
    expect(CARD_PARALLAX_LAYERS.some(({ path }) => path.includes('top-parallax'))).toBe(
      false
    )
  })
})
