import { describe, expect, it } from 'vitest'
import { selectRandomBoardTexture } from './board-selection'

describe('selectRandomBoardTexture', () => {
  it.each([
    [0, 0],
    [0.2, 1],
    [0.4, 2],
    [0.6, 3],
    [0.8, 4]
  ])('selects board %i for random value %f', (random, index) => {
    const boards = [0, 1, 2, 3, 4]

    expect(selectRandomBoardTexture(boards, () => random)).toBe(boards[index])
  })

  it('rejects an empty board collection', () => {
    expect(() => selectRandomBoardTexture([], () => 0)).toThrow(
      'At least one board texture is required.'
    )
  })
})
