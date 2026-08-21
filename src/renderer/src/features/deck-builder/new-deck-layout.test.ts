import { describe, expect, it } from 'vitest'
import { NEW_DECK_LAYOUT } from './new-deck-layout'

describe('new deck layout', () => {
  it('fully describes the hero portrait non-uniform scale', () => {
    expect(NEW_DECK_LAYOUT.heroPortrait.scale).toEqual({
      x: 0.85 * 1.1,
      y: 0.85 * 1.05
    })
  })
})
