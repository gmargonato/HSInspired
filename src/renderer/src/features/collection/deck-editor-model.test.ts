import { describe, expect, it } from 'vitest'
import { shouldAnimateDeckRowRemoval } from './deck-editor-model'

describe('deck editor row removal', () => {
  it('only animates when the final copy is removed', () => {
    expect(shouldAnimateDeckRowRemoval(2)).toBe(false)
    expect(shouldAnimateDeckRowRemoval(1)).toBe(true)
    expect(shouldAnimateDeckRowRemoval(0)).toBe(false)
  })
})
