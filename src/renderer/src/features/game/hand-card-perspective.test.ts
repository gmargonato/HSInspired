import { describe, expect, it } from 'vitest'
import { resolvePerspectiveCorners } from './hand-card-perspective'

describe('hand card perspective', () => {
  it('preserves the card rectangle at rest', () => {
    expect(resolvePerspectiveCorners({ x: 0, y: 0 }, 620, 900)).toEqual({
      topLeft: { x: 0, y: 0 },
      topRight: { x: 620, y: 0 },
      bottomRight: { x: 620, y: 900 },
      bottomLeft: { x: 0, y: 900 }
    })
  })

  it('creates a visible trapezoid for horizontal motion', () => {
    const corners = resolvePerspectiveCorners({ x: 1, y: 0 }, 620, 900)
    const leftHeight = corners.bottomLeft.y - corners.topLeft.y
    const rightHeight = corners.bottomRight.y - corners.topRight.y

    expect(Math.abs(rightHeight - leftHeight)).toBeGreaterThan(100)
    expect(corners.topLeft.x).toBeGreaterThan(0)
    expect(corners.topRight.x).toBeGreaterThan(620)
  })

  it('creates depth asymmetry for vertical motion and clamps excess input', () => {
    const tilted = resolvePerspectiveCorners({ x: 0, y: 1 }, 620, 900)
    const clamped = resolvePerspectiveCorners({ x: 0, y: 10 }, 620, 900)
    const topWidth = tilted.topRight.x - tilted.topLeft.x
    const bottomWidth = tilted.bottomRight.x - tilted.bottomLeft.x

    expect(Math.abs(bottomWidth - topWidth)).toBeGreaterThan(100)
    expect(clamped).toEqual(tilted)
  })
})
