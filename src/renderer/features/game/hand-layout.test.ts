import { describe, expect, it } from 'vitest'
import { CARD_CANVAS } from '../../rendering/cards/card-layout'
import {
  DEFAULT_HAND_LAYOUT,
  handHoverHitBounds,
  layoutHand,
  resolveHandHover,
  type HandCardTransform
} from './hand-layout'

function step(hand: readonly HandCardTransform[]): number {
  return (hand[1]?.x ?? 0) - (hand[0]?.x ?? 0)
}

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
    expect(layoutHand(4).every((card) => card.scale === 0.2)).toBe(true)
    expect(layoutHand(4, undefined, 1)[1]?.scale).toBe(0.5)
  })

  it('keeps small hands snug and compresses large hands to the maximum width', () => {
    const { span, maxCardStep } = DEFAULT_HAND_LAYOUT
    const two = layoutHand(2)
    const four = layoutHand(4)
    const six = layoutHand(6)
    const seven = layoutHand(7)
    const eight = layoutHand(8)
    const ten = layoutHand(10)

    // Small hands keep the natural per-card spacing.
    expect(step(two)).toBeCloseTo(maxCardStep)
    expect(step(four)).toBeCloseTo(maxCardStep)
    expect((six[5]?.x ?? 0) - (six[0]?.x ?? 0)).toBeCloseTo(5 * maxCardStep)

    // Compression begins once the natural spacing would exceed the maximum
    // width, and the gap keeps shrinking with every added card.
    expect((seven[6]?.x ?? 0) - (seven[0]?.x ?? 0)).toBeCloseTo(span)
    expect((eight[7]?.x ?? 0) - (eight[0]?.x ?? 0)).toBeCloseTo(span)
    expect((ten[9]?.x ?? 0) - (ten[0]?.x ?? 0)).toBeCloseTo(span)
    expect(step(ten)).toBeLessThan(step(eight))
    expect(step(ten)).toBeLessThan(maxCardStep)
  })

  it('keeps small hands centred and shifts wider hands left at the safe boundary', () => {
    const five = layoutHand(5)
    const six = layoutHand(6)
    const seven = layoutHand(7)
    const fiveCenter = ((five[0]?.x ?? 0) + (five[4]?.x ?? 0)) / 2
    const sixCenter = ((six[0]?.x ?? 0) + (six[5]?.x ?? 0)) / 2
    const restingRightExtent =
      ((CARD_CANVAS.width * DEFAULT_HAND_LAYOUT.cardScale) / 2) *
        Math.cos(DEFAULT_HAND_LAYOUT.maxRotation) +
      CARD_CANVAS.height *
        DEFAULT_HAND_LAYOUT.cardScale *
        Math.sin(DEFAULT_HAND_LAYOUT.maxRotation)

    expect(fiveCenter).toBeCloseTo(DEFAULT_HAND_LAYOUT.centerX)
    expect(sixCenter).toBeLessThan(fiveCenter)
    expect((six[5]?.x ?? 0) + restingRightExtent).toBeLessThanOrEqual(
      DEFAULT_HAND_LAYOUT.safeRightBoundaryX + 0.001
    )
    expect(seven[6]?.x).toBeCloseTo(six[5]?.x ?? 0)
    expect(six[0]?.x).toBeLessThan(five[0]?.x ?? Number.POSITIVE_INFINITY)
  })

  it('keeps every card on a single shared baseline', () => {
    const hand = layoutHand(5)

    expect(hand[2]?.y).toBeCloseTo(1140)
    expect(hand[0]?.y).toBeCloseTo(1140)
    expect(hand[0]?.y).toBe(hand[2]?.y)
  })
})

describe('hand hover resolution', () => {
  // A five-card fan on a single shared baseline: every card rests at y 1140,
  // so each card's top edge sits at 960 (900 * 0.2 below the baseline).
  const hand = layoutHand(5)
  const center = hand[2]
  const edge = hand[0]
  if (!center || !edge) throw new Error('Expected a five-card hand.')

  it('hovers the nearest card when the pointer is at or below its resting top', () => {
    expect(
      resolveHandHover({ x: center.x, y: 1000 }, hand, DEFAULT_HAND_LAYOUT, null)
    ).toBe(2)
    expect(
      resolveHandHover({ x: edge.x + 10, y: 1010 }, hand, DEFAULT_HAND_LAYOUT, null)
    ).toBe(0)
    expect(
      resolveHandHover({ x: center.x, y: 1075 }, hand, DEFAULT_HAND_LAYOUT, null)
    ).toBe(2)
  })

  it('does not hover when the pointer is above the resting card tops', () => {
    // The resting top (960) minus the 15px grace is 945; above that the
    // pointer cannot enter hover.
    expect(
      resolveHandHover({ x: center.x, y: 940 }, hand, DEFAULT_HAND_LAYOUT, null)
    ).toBeNull()
    expect(
      resolveHandHover({ x: edge.x, y: 940 }, hand, DEFAULT_HAND_LAYOUT, null)
    ).toBeNull()
  })

  it('allows a small grace margin above the resting top edge', () => {
    expect(
      resolveHandHover({ x: center.x, y: 945 }, hand, DEFAULT_HAND_LAYOUT, null)
    ).toBe(2)
    expect(
      resolveHandHover({ x: center.x, y: 944 }, hand, DEFAULT_HAND_LAYOUT, null)
    ).toBeNull()
  })

  it('does not hover cards when the pointer is horizontally far from the hand', () => {
    expect(
      resolveHandHover({ x: 100, y: 1050 }, hand, DEFAULT_HAND_LAYOUT, null)
    ).toBeNull()
    expect(
      resolveHandHover({ x: 1800, y: 1050 }, hand, DEFAULT_HAND_LAYOUT, null)
    ).toBeNull()
  })

  it('keeps the lifted card hovered while the pointer roams over its body', () => {
    // Center card lifted: bottom 1020, top 570. The pointer at y 800 is far
    // above the entry strip yet stays on the hovered card.
    expect(
      resolveHandHover({ x: center.x, y: 800 }, hand, DEFAULT_HAND_LAYOUT, 2)
    ).toBe(2)
    expect(
      resolveHandHover({ x: center.x + 50, y: 900 }, hand, DEFAULT_HAND_LAYOUT, 2)
    ).toBe(2)
  })

  it('drops the lifted card once the pointer leaves its bounds', () => {
    // Above the lifted card: keep-alive fails and entry rules reject the height.
    expect(
      resolveHandHover({ x: center.x, y: 550 }, hand, DEFAULT_HAND_LAYOUT, 2)
    ).toBeNull()
    // Horizontally past the lifted card, in empty space above the entry strip.
    expect(
      resolveHandHover({ x: center.x + 180, y: 900 }, hand, DEFAULT_HAND_LAYOUT, 2)
    ).toBeNull()
  })

  it('switches to the nearest card when the pointer moves along the entry strip', () => {
    const target = hand[3]
    if (!target) throw new Error('Expected a fourth card.')
    expect(
      resolveHandHover({ x: target.x + 10, y: 1050 }, hand, DEFAULT_HAND_LAYOUT, 2)
    ).toBe(3)
  })

  it('switches to the neighbour in the strip even while a card is lifted', () => {
    // Regression: the lifted card's wide keep-alive box used to swallow the
    // neighbour (~55px away in a ten-card fan), so the strip could never
    // switch to it.
    const hand10 = layoutHand(10)
    const neighbour = hand10[6]
    if (!neighbour) throw new Error('Expected a ten-card hand.')
    expect(
      resolveHandHover({ x: neighbour.x, y: 1050 }, hand10, DEFAULT_HAND_LAYOUT, 5)
    ).toBe(6)
  })

  it('handles empty hands and stale hovered indices', () => {
    expect(
      resolveHandHover({ x: 960, y: 1050 }, [], DEFAULT_HAND_LAYOUT, null)
    ).toBeNull()
    expect(resolveHandHover({ x: 960, y: 1050 }, hand, DEFAULT_HAND_LAYOUT, 9)).toBe(2)
    expect(
      resolveHandHover(
        { x: 960, y: 1050 },
        [undefined, undefined],
        DEFAULT_HAND_LAYOUT,
        null
      )
    ).toBeNull()
  })
})

describe('hand hover hit bounds', () => {
  it('covers the resting strip and the tallest lifted card', () => {
    const bounds = handHoverHitBounds(DEFAULT_HAND_LAYOUT)
    // The tallest lifted card reaches y ~570; the zone starts just above it.
    expect(bounds.y).toBeCloseTo(560)
    // The zone reaches the bottom of the 1920x1080 canvas.
    expect(bounds.y + bounds.height).toBeCloseTo(1080)
    expect(bounds.x).toBe(0)
    expect(bounds.width).toBe(1920)
  })
})
