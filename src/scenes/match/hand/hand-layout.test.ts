import { describe, expect, it } from 'vitest'
import { CARD_CANVAS } from '../../../visual-components/cards/card-layout'
import {
  DEFAULT_HAND_LAYOUT,
  layoutHand,
  resolveHandHover,
  handCardBounds,
  handHoverTarget,
  handHoverHitBounds
} from './hand-layout'
import {
  DEFAULT_HAND_DRAG,
  initialDragState,
  stepDrag,
  type HandDragState
} from './hand-drag'

describe('hand drag following', () => {
  const pointer = { x: 960, y: 800 }

  it('preserves the current pose at pickup and its existing stationary settling', () => {
    const initial = initialDragState(900, 1010, 0.5, pointer)
    expect(initial).toMatchObject({ x: 900, y: 1010, scale: 0.5 })

    const elapsedMS = 60
    const config = DEFAULT_HAND_DRAG
    const progress = (config.nearHandY - pointer.y) / (config.nearHandY - config.boardY)
    const targetScale =
      config.nearHandScale + (config.dragScale - config.nearHandScale) * progress
    const remaining = Math.exp(-elapsedMS / config.followResponseMS)
    const targetX =
      pointer.x - (config.grabAnchor.x - 0.5) * CARD_CANVAS.width * targetScale
    const targetY =
      pointer.y + (1 - config.grabAnchor.y) * CARD_CANVAS.height * targetScale
    const next = stepDrag(initial, pointer.x, pointer.y, elapsedMS)
    expect(next.x).toBeCloseTo(targetX + (initial.x - targetX) * remaining)
    expect(next.y).toBeCloseTo(targetY + (initial.y - targetY) * remaining)
    expect(next.scale).toBeCloseTo(
      targetScale + (initial.scale - targetScale) * remaining
    )
  })

  it('follows pointer translation immediately, including during pickup and reversal', () => {
    const initial = initialDragState(900, 1010, 0.5, pointer)
    const unchanged = stepDrag(initial, pointer.x, pointer.y, 1000 / 60)
    const right = stepDrag(initial, pointer.x + 200, pointer.y, 1000 / 60)
    const left = stepDrag(initial, pointer.x - 200, pointer.y, 1000 / 60)
    expect(right.x - unchanged.x).toBeCloseTo(200)
    expect(left.x - unchanged.x).toBeCloseTo(-200)
    expect(right.scale).toBe(unchanged.scale)
  })

  it('keeps the grab anchor on the pointer while scale changes after pickup', () => {
    const initial = initialDragState(900, 1010, 0.5, pointer)
    const settled = stepDrag(initial, pointer.x, pointer.y, 10_000)
    const moved = { x: 1080, y: 600 }
    const next = stepDrag(settled, moved.x, moved.y, 1000 / 60)
    expect(next.scale).not.toBe(settled.scale)
    expect(
      next.x + (DEFAULT_HAND_DRAG.grabAnchor.x - 0.5) * CARD_CANVAS.width * next.scale
    ).toBeCloseTo(moved.x)
    expect(
      next.y - (1 - DEFAULT_HAND_DRAG.grabAnchor.y) * CARD_CANVAS.height * next.scale
    ).toBeCloseTo(moved.y)
  })

  it('settles consistently at 30, 60 and 120 frames per second', () => {
    const run = (fps: number): HandDragState => {
      let state = initialDragState(900, 1010, 0.5, pointer)
      for (let index = 0; index < fps; index++) {
        state = stepDrag(state, pointer.x, pointer.y, 1000 / fps)
      }
      return state
    }
    const baseline = run(60)
    for (const fps of [30, 120]) {
      const state = run(fps)
      expect(state.x).toBeCloseTo(baseline.x, 8)
      expect(state.y).toBeCloseTo(baseline.y, 8)
      expect(state.scale).toBeCloseTo(baseline.scale, 8)
    }
  })

  it('keeps the card within the existing bounds after a long frame', () => {
    const initial = initialDragState(900, 1010, 0.5, pointer)
    const topLeft = stepDrag(initial, -10_000, -10_000, 1000)
    const bottomRight = stepDrag(initial, 10_000, 10_000, 1000)
    expect(topLeft.x).toBe(0)
    expect(topLeft.y).toBe((CARD_CANVAS.height * topLeft.scale) / 2)
    expect(bottomRight.x).toBe(1920)
    expect(bottomRight.y).toBe(1080 + (CARD_CANVAS.height * bottomRight.scale) / 2)
    expect(Object.values(topLeft).every(Number.isFinite)).toBe(true)
    expect(Object.values(bottomRight).every(Number.isFinite)).toBe(true)
  })

  it('does not advance pickup or pose without elapsed time', () => {
    const initial = initialDragState(900, 1010, 0.5, pointer)
    expect(stepDrag(initial, 100, 100, 0)).toBe(initial)
    expect(stepDrag(initial, 100, 100, -1)).toBe(initial)
  })
})

describe('layoutHand', () => {
  it.each([0, -1, NaN, Infinity, 0.5])(
    'returns no poses for invalid or empty count %s',
    (count) => {
      expect(layoutHand(count)).toEqual([])
    }
  )

  it.each([1, 2])('keeps %i cards straight with uncompressed spacing', (count) => {
    const hand = layoutHand(count)
    for (const card of hand) {
      expect(card.rotation).toBe(0)
      expect(card.y).toBe(DEFAULT_HAND_LAYOUT.baselineY)
    }
    if (count > 1) {
      expect(hand[1]!.x - hand[0]!.x).toBeCloseTo(
        1.270804 * DEFAULT_HAND_LAYOUT.horizontalUnitsToPixels
      )
    }
  })

  it('spreads three cards to 126 px and lifts them 12 px while keeping the middle centered', () => {
    const hand = layoutHand(3)
    expect(hand[1]!.x).toBe(DEFAULT_HAND_LAYOUT.centerX)
    hand.forEach((card, index) => {
      expect(card.x).toBe(DEFAULT_HAND_LAYOUT.centerX + (index - 1) * 126)
      expect(card.y).toBe(DEFAULT_HAND_LAYOUT.baselineY - 12)
      expect(card.rotation).toBe(0)
      expect(card.scale).toBe(DEFAULT_HAND_LAYOUT.cardScale)
      expect(handHoverTarget(card).y).toBe(1020)
    })
  })

  it.each([4, 5, 6, 7, 8, 9, 10])(
    'fans and compresses %i cards using the count divisor',
    (count) => {
      const hand = layoutHand(count)
      const step = (4.8 / count) * DEFAULT_HAND_LAYOUT.horizontalUnitsToPixels
      expect(hand[0]!.rotation).toBeCloseTo(
        (-(20 + count) * Math.PI * DEFAULT_HAND_LAYOUT.screenRotationMultiplier) / 180
      )
      expect(hand[count - 1]!.rotation).toBeCloseTo(
        ((20 + count) * Math.PI * DEFAULT_HAND_LAYOUT.screenRotationMultiplier) / 180
      )
      for (let i = 1; i < count; i++) {
        expect(hand[i]!.x - hand[i - 1]!.x).toBeCloseTo(step)
      }
      expect(hand.every((card) => card.scale === 0.2)).toBe(true)
      expect(hand[count - 1]!.y).toBeGreaterThan(hand[0]!.y)
    }
  )

  it('matches the recovered ten-card example after pixel conversion', () => {
    const hand = layoutHand(10, { ...DEFAULT_HAND_LAYOUT, maxHandLift: 0 })
    const zOffsets = [
      -0.3375, -0.204167, -0.104167, -0.0375, -0.004167, -0.018121, -0.079176,
      -0.172999, -0.299226, -0.4575
    ]
    const center = (hand[0]!.x + hand[9]!.x) / 2
    hand.forEach((card, index) => {
      expect(
        (card.x - center) / DEFAULT_HAND_LAYOUT.horizontalUnitsToPixels
      ).toBeCloseTo(-2.16 + index * 0.48, 6)
      expect(
        (DEFAULT_HAND_LAYOUT.baselineY - card.y) /
          DEFAULT_HAND_LAYOUT.verticalUnitsToPixels
      ).toBeCloseTo(zOffsets[index]!, 5)
    })
    expect(hand[9]!.x - hand[0]!.x).toBeCloseTo(388.8)
  })

  it.each([
    [5, 550, 565],
    [6, 570, 585],
    [7, 585, 600],
    [10, 610, 625]
  ])(
    'fits the visible %i-card fan rather than only its origin span',
    (count, minWidth, maxWidth) => {
      const hand = layoutHand(count)
      const bounds = hand.map(handCardBounds)
      const width =
        Math.max(...bounds.map((box) => box.right)) -
        Math.min(...bounds.map((box) => box.left))
      expect(width).toBeGreaterThan(minWidth)
      expect(width).toBeLessThan(maxWidth)
      const middle = hand[Math.floor((count - 1) / 2)]!
      const middleTop =
        middle.y - CARD_CANVAS.height * middle.scale * Math.cos(middle.rotation)
      expect(middleTop).toBeGreaterThan(930)
      expect(middleTop).toBeLessThan(945)
      if (count <= 7) {
        expect((hand[0]!.x + hand[count - 1]!.x) / 2).toBeCloseTo(960)
      }
    }
  )

  it('ramps lift through six cards without changing source tucking or hover height', () => {
    for (const [count, lift] of [
      [3, 0],
      [4, 28 / 3],
      [5, 56 / 3],
      [6, 28],
      [7, 28],
      [10, 28]
    ]) {
      const hand = layoutHand(count)
      const source = layoutHand(count, {
        ...DEFAULT_HAND_LAYOUT,
        maxHandLift: 0,
        screenRotationMultiplier: 1
      })
      hand.forEach((card, index) => {
        expect(source[index]!.y - card.y).toBeCloseTo(lift)
        expect(handHoverTarget(card).y).toBe(1020)
      })
    }
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])(
    'keeps all %i cards within the HUD boundary and broad hover zone',
    (count) => {
      const hand = layoutHand(count)
      const broad = handHoverHitBounds(DEFAULT_HAND_LAYOUT)
      for (const card of hand) {
        const bounds = handCardBounds(card)
        expect(bounds.right).toBeLessThanOrEqual(
          DEFAULT_HAND_LAYOUT.safeRightBoundaryX + 1e-8
        )
        expect(
          bounds.top - DEFAULT_HAND_LAYOUT.hoverEntryMargin
        ).toBeGreaterThanOrEqual(broad.y)
        expect(
          resolveHandHover({ x: card.x, y: 1060 }, hand, DEFAULT_HAND_LAYOUT)
        ).toBe(hand.indexOf(card))
      }
    }
  )

  it('uses fixed hover height and the extracted enlargement ratio without moving neighbors', () => {
    const hand = layoutHand(10)
    const before = hand.map((card) => ({ ...card }))
    for (const card of hand) {
      expect(handHoverTarget(card)).toMatchObject({ x: card.x, y: 1020, rotation: 0 })
      expect(handHoverTarget(card).scale / card.scale).toBeCloseTo(1.5 / 0.62)
    }
    expect(hand).toEqual(before)
  })

  it('keeps entry-strip slot selection authoritative for a six-card hand', () => {
    const hand = layoutHand(6)
    const card = hand[2]!

    expect(
      resolveHandHover({ x: card.x, y: card.y - 20 }, hand, DEFAULT_HAND_LAYOUT)
    ).toBe(2)
  })

  it('selects the exposed body of either edge card in a dense hand', () => {
    const hand = layoutHand(8)
    const first = hand[0]!
    const last = hand[hand.length - 1]!

    expect(
      resolveHandHover({ x: first.x - 70, y: first.y - 20 }, hand, DEFAULT_HAND_LAYOUT)
    ).toBe(0)
    expect(
      resolveHandHover({ x: last.x + 70, y: last.y - 20 }, hand, DEFAULT_HAND_LAYOUT)
    ).toBe(hand.length - 1)
  })

  it.each([4, 8])('uses the resting hover boundary for %i cards', (count) => {
    const hand = layoutHand(count)
    const card = hand[2]!
    const top = handCardBounds(card).top - DEFAULT_HAND_LAYOUT.hoverEntryMargin
    expect(resolveHandHover({ x: card.x, y: top }, hand, DEFAULT_HAND_LAYOUT)).toBe(2)
    expect(
      resolveHandHover({ x: card.x, y: top - 1 }, hand, DEFAULT_HAND_LAYOUT)
    ).toBeNull()
    expect(
      resolveHandHover({ x: hand[3]!.x, y: hand[3]!.y - 20 }, hand, DEFAULT_HAND_LAYOUT)
    ).toBe(3)
    const enlargedTop =
      card.y -
      DEFAULT_HAND_LAYOUT.hoverLift -
      CARD_CANVAS.height * DEFAULT_HAND_LAYOUT.hoverScale
    expect(
      resolveHandHover({ x: card.x, y: enlargedTop + 20 }, hand, DEFAULT_HAND_LAYOUT)
    ).toBeNull()
  })
})
