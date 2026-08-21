import { describe, expect, it } from 'vitest'
import {
  CARD_PARALLAX_LAYERS,
  resolveCardPlaneTransform,
  resolveParallaxLayerOffset,
  resolveParallaxSmoothing,
  resolveParallaxTarget
} from '../src/renderer/src/rendering/cards/card-parallax'

describe('Card preview parallax', () => {
  it('normalizes pointer movement around the card and clamps distant input', () => {
    const center = { x: 100, y: 200 }
    const range = { x: 50, y: 100 }

    expect(resolveParallaxTarget(center, center, range)).toEqual({ x: 0, y: 0 })
    expect(resolveParallaxTarget({ x: 125, y: 150 }, center, range)).toEqual({
      x: 0.5,
      y: -0.5
    })
    expect(resolveParallaxTarget({ x: 500, y: -500 }, center, range)).toEqual({
      x: 1,
      y: -1
    })
  })

  it('foreshortens single-axis tilts without shearing the card', () => {
    const horizontal = resolveCardPlaneTransform({ x: 1, y: 0 })
    const vertical = resolveCardPlaneTransform({ x: 0, y: 1 })

    expect(horizontal.scaleX).toBeLessThan(1)
    expect(horizontal.scaleY).toBeCloseTo(1)
    expect(horizontal.skewX).toBeCloseTo(0)
    expect(horizontal.skewY).toBe(0)

    expect(vertical.scaleX).toBeCloseTo(1)
    expect(vertical.scaleY).toBeLessThan(1)
    expect(vertical.skewX).toBeCloseTo(0)
    expect(vertical.skewY).toBe(0)
  })

  it('introduces only the cross-axis shear produced by a diagonal tilt', () => {
    const neutral = resolveCardPlaneTransform({ x: 0, y: 0 })
    const diagonal = resolveCardPlaneTransform({ x: 1, y: 1 })

    expect(neutral).toEqual({ scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 })
    expect(diagonal.scaleX).toBeLessThan(1)
    expect(diagonal.scaleY).toBeLessThan(1)
    expect(Math.abs(diagonal.skewX)).toBeGreaterThan(0)
    expect(Math.abs(diagonal.skewX)).toBeLessThan(0.05)
  })

  it('moves foreground layers farther than rear layers', () => {
    const tilt = { x: 0.5, y: -0.5 }
    const foreground = resolveParallaxLayerOffset(tilt, 30)
    const background = resolveParallaxLayerOffset(tilt, -18)

    expect(foreground.x).toBeGreaterThan(0)
    expect(foreground.y).toBeLessThan(0)
    expect(Math.abs(foreground.x)).toBeGreaterThan(Math.abs(background.x))
    expect(Math.abs(foreground.y)).toBeGreaterThan(Math.abs(background.y))
    expect(background.x).toBeLessThan(0)
    expect(background.y).toBeGreaterThan(0)
  })

  it('keeps race metadata on the same zero-depth surface as card description text', () => {
    expect(CARD_PARALLAX_LAYERS).toEqual(
      expect.arrayContaining([
        { path: 'card.rules', depth: 0 },
        { path: 'card.race-banner', depth: 0 },
        { path: 'card.race', depth: 0 }
      ])
    )
  })

  it('uses frame-rate-independent smoothing without advancing zero-time frames', () => {
    expect(resolveParallaxSmoothing(0)).toBe(0)
    expect(resolveParallaxSmoothing(16)).toBeGreaterThan(0)
    expect(resolveParallaxSmoothing(32)).toBeGreaterThan(resolveParallaxSmoothing(16))
    expect(resolveParallaxSmoothing(1000)).toBeGreaterThan(0.999)
  })
})
