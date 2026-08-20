import { describe, expect, it } from 'vitest'
import { getCollectionCardPlacement } from './collection-card-grid'

describe('collection card grid', () => {
  it('centers a card inside its deterministic page slot', () => {
    const placement = getCollectionCardPlacement(1, 620, 900, {
      x: 100,
      y: 200,
      width: 1000,
      height: 770,
      columns: 4,
      rows: 2,
      paddingX: 10,
      paddingY: 12
    })

    expect(placement.scale).toBeCloseTo(230 / 620)
    expect(placement.x).toBeCloseTo(360)
    expect(placement.y).toBeCloseTo(225.564516)
  })
})
