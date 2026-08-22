import { describe, expect, it } from 'vitest'
import {
  buildDeckEditorEntries,
  shouldAnimateDeckRowRemoval
} from './deck-editor-model'

describe('deck editor row removal', () => {
  it('only animates when the final copy is removed', () => {
    expect(shouldAnimateDeckRowRemoval(2)).toBe(false)
    expect(shouldAnimateDeckRowRemoval(1)).toBe(true)
    expect(shouldAnimateDeckRowRemoval(0)).toBe(false)
  })
})

describe('deck editor entry order', () => {
  it('keeps one row per card and orders an arriving card by cost then name', () => {
    const entries = buildDeckEditorEntries({
      cards: {
        basic_boulderfist_ogre: 1,
        basic_arcane_intellect: 2,
        basic_frostbolt: 1
      }
    })

    expect(entries.map((entry) => entry.cardId)).toEqual([
      'basic_frostbolt',
      'basic_arcane_intellect',
      'basic_boulderfist_ogre'
    ])
    expect(entries[1]?.count).toBe(2)
  })
})
