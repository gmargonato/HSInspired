import { describe, expect, it } from 'vitest'
import { CARD_CANVAS } from '../../rendering/cards/card-layout'
import { DEFAULT_HAND_LAYOUT, layoutHand, resolveHandHover } from './hand-layout'
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
  it('keeps hands of four cards at the gentle small-hand fan', () => {
    const hand = layoutHand(4)

    // The linear treatment ramp (progress 0.25 at four cards) stays in place.
    expect(hand.map((card) => card.y)).toEqual([
      DEFAULT_HAND_LAYOUT.baselineY - 7 + 10,
      DEFAULT_HAND_LAYOUT.baselineY - 7 + 10 / 3,
      DEFAULT_HAND_LAYOUT.baselineY - 7 + 10 / 3,
      DEFAULT_HAND_LAYOUT.baselineY - 7 + 10
    ])
    expect(hand[0]?.rotation).toBeCloseTo(-0.23)
    expect(hand[3]?.rotation).toBeCloseTo(0.23)
  })

  it('eases mid hands into the dense arc while anchoring the full hand', () => {
    const five = layoutHand(5)
    const six = layoutHand(6)
    const ten = layoutHand(10)

    // Curvature arrives early: five cards already tilt past the small-hand
    // rotation, and six tilt further still, with the fan cresting above the
    // baseline while its outer cards tuck below it.
    expect(Math.abs(five[0]?.rotation ?? 0)).toBeGreaterThan(
      DEFAULT_HAND_LAYOUT.maxRotation
    )
    expect(Math.abs(six[0]?.rotation ?? 0)).toBeGreaterThan(
      Math.abs(five[0]?.rotation ?? 0)
    )
    expect(six[2]?.y).toBeLessThan(DEFAULT_HAND_LAYOUT.baselineY)
    expect(five[0]?.y).toBeGreaterThan(DEFAULT_HAND_LAYOUT.baselineY)

    // Full-hand anchors stay fixed.
    expect(Math.abs(ten[0]?.rotation ?? 0)).toBeCloseTo(
      DEFAULT_HAND_LAYOUT.denseHandMaxRotation
    )
    expect(ten[0]?.y).toBeCloseTo(
      DEFAULT_HAND_LAYOUT.baselineY -
        DEFAULT_HAND_LAYOUT.denseHandLift +
        DEFAULT_HAND_LAYOUT.denseHandEdgeTuck
    )
  })

  it('tightens the fan step with every card past the small-hand shoulder', () => {
    const steps = [4, 5, 6, 7, 8, 9, 10].map((count) => {
      const hand = layoutHand(count)
      return (hand[hand.length - 1]!.x - hand[0]!.x) / (count - 1)
    })

    expect(steps[0]).toBeCloseTo(DEFAULT_HAND_LAYOUT.maxCardStep)
    for (let index = 1; index < steps.length; index += 1) {
      expect(steps[index]).toBeLessThan(steps[index - 1]!)
    }
    expect(steps[steps.length - 1]).toBeCloseTo(
      DEFAULT_HAND_LAYOUT.span / (DEFAULT_HAND_LAYOUT.denseHandFullCount - 1)
    )
  })

  it('curves the full-hand baseline into an arc above its chord', () => {
    const hand = layoutHand(10)
    const chordMidY = (hand[0]!.y + hand[hand.length - 1]!.y) / 2

    expect(hand[4]?.y).toBeLessThan(chordMidY)
    expect(hand[5]?.y).toBeLessThan(chordMidY)
  })

  it('keeps entry-strip slot selection authoritative for a six-card hand', () => {
    const hand = layoutHand(6)
    const card = hand[2]!

    expect(
      resolveHandHover({ x: card.x, y: card.y - 20 }, hand, DEFAULT_HAND_LAYOUT)
    ).toBe(2)
  })

  it('keeps the stronger long-hand fan symmetric around its center', () => {
    const hand = layoutHand(8)
    for (let index = 0; index < hand.length / 2; index += 1) {
      const opposite = hand[hand.length - 1 - index]
      const current = hand[index]
      expect(current?.y).toBeCloseTo(opposite?.y ?? 0)
      expect(current?.rotation).toBeCloseTo(-(opposite?.rotation ?? 0))
    }
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
    const top =
      card.y -
      CARD_CANVAS.height * DEFAULT_HAND_LAYOUT.cardScale -
      DEFAULT_HAND_LAYOUT.hoverEntryMargin
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
