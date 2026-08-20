import { describe, expect, it } from 'vitest'
import { layoutHand } from './hand-layout'

describe('dynamic hand layout', () => {
  it('supports empty through ten-card hands without hardcoded slots', () => {
    expect(layoutHand(0)).toEqual([])
    for (let count = 1; count <= 10; count += 1) {
      const cards = layoutHand(count)
      expect(cards).toHaveLength(count)
      expect(cards[0]?.x).toBeLessThanOrEqual(cards[count - 1]?.x ?? 0)
      expect(
        cards.every((card) => Number.isFinite(card.x) && Number.isFinite(card.y))
      ).toBe(true)
    }
  })

  it('keeps the normal fan symmetric and promotes the hovered card', () => {
    const normal = layoutHand(5)
    expect(normal[0]?.rotation).toBeCloseTo(-(normal[4]?.rotation ?? 0))
    expect(normal[1]?.rotation).toBeCloseTo(-(normal[3]?.rotation ?? 0))

    const hovered = layoutHand(5, undefined, 2)
    expect(hovered[2]?.rotation).toBe(0)
    expect(hovered[2]?.scale).toBeGreaterThan(normal[2]?.scale ?? 0)
    expect(hovered[2]?.y).toBeLessThan(normal[2]?.y ?? Number.POSITIVE_INFINITY)
    expect(hovered[2]?.zIndex).toBeGreaterThan(hovered[0]?.zIndex ?? 0)
    expect(hovered[0]?.x).toBeLessThan(normal[0]?.x ?? Number.POSITIVE_INFINITY)
    expect(hovered[4]?.x).toBeGreaterThan(normal[4]?.x ?? Number.NEGATIVE_INFINITY)
  })

  it('uses the compact live-hand card scale', () => {
    expect(layoutHand(4).every((card) => card.scale === 0.24)).toBe(true)
    expect(layoutHand(4, undefined, 1)[1]?.scale).toBe(0.3)
  })

  it('keeps small hands compact while preserving the reduced ten-card span', () => {
    const two = layoutHand(2)
    const four = layoutHand(4)
    const ten = layoutHand(10)

    expect((two[1]?.x ?? 0) - (two[0]?.x ?? 0)).toBeCloseTo(105)
    expect((four[1]?.x ?? 0) - (four[0]?.x ?? 0)).toBeCloseTo(105)
    expect((ten[9]?.x ?? 0) - (ten[0]?.x ?? 0)).toBeCloseTo(945)
  })

  it('keeps the center card lower than the fan edges while leaving it readable', () => {
    const hand = layoutHand(5)

    expect(hand[2]?.y).toBeCloseTo(1182)
    expect(hand[0]?.y).toBeCloseTo(1220)
    expect(hand[0]?.y).toBeGreaterThan(hand[2]?.y ?? Number.POSITIVE_INFINITY)
  })
})
