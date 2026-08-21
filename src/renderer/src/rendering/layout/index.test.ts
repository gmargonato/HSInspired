import type { Container, ObservablePoint } from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'
import { applyAnchoredPlacement, CENTER, placement } from '.'

describe('scene layout placement', () => {
  it('normalizes uniform scale declarations to explicit x/y scale', () => {
    expect(
      placement({ x: 10, y: 20 }, { width: 30, height: 40 }, { scale: 0.5 }).scale
    ).toEqual({ x: 0.5, y: 0.5 })
  })

  it('applies position, anchor, and non-uniform scale atomically', () => {
    const positionSet = vi.fn()
    const scaleSet = vi.fn()
    const anchorSet = vi.fn()
    const target = {
      position: { set: positionSet },
      scale: { set: scaleSet },
      anchor: { set: anchorSet }
    } as unknown as Container & { readonly anchor: ObservablePoint }
    const value = placement(
      { x: 1470, y: 490 },
      { width: 345, height: 433 },
      { anchor: CENTER, scale: { x: 0.935, y: 0.8925 } }
    )

    expect(applyAnchoredPlacement(target, value)).toBe(target)
    expect(positionSet).toHaveBeenCalledWith(1470, 490)
    expect(anchorSet).toHaveBeenCalledWith(0.5, 0.5)
    expect(scaleSet).toHaveBeenCalledWith(0.935, 0.8925)
  })
})
