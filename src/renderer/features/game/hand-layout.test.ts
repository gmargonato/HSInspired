import { describe, expect, it } from 'vitest'
import { DEFAULT_HAND_LAYOUT, layoutHand, resolveHandHover } from './hand-layout'

describe('layoutHand', () => {
  it('keeps hands of four cards at the original flat fan baseline', () => {
    const hand = layoutHand(4)

    expect(hand.map((card) => card.y)).toEqual([
      DEFAULT_HAND_LAYOUT.baselineY,
      DEFAULT_HAND_LAYOUT.baselineY,
      DEFAULT_HAND_LAYOUT.baselineY,
      DEFAULT_HAND_LAYOUT.baselineY
    ])
    expect(hand[0]?.rotation).toBeCloseTo(-DEFAULT_HAND_LAYOUT.maxRotation)
    expect(hand[3]?.rotation).toBeCloseTo(DEFAULT_HAND_LAYOUT.maxRotation)
  })

  it('keeps five cards unchanged and applies dense-hand treatment from six cards', () => {
    const five = layoutHand(5)
    const six = layoutHand(6)
    const ten = layoutHand(10)

    expect(Math.abs(five[0]?.rotation ?? 0)).toBeCloseTo(
      DEFAULT_HAND_LAYOUT.maxRotation
    )
    expect(five[0]?.y).toBeCloseTo(DEFAULT_HAND_LAYOUT.baselineY)
    expect(Math.abs(six[0]?.rotation ?? 0)).toBeGreaterThan(
      DEFAULT_HAND_LAYOUT.maxRotation
    )
    expect(six[2]?.y).toBeLessThan(DEFAULT_HAND_LAYOUT.baselineY)
    expect(Math.abs(ten[0]?.rotation ?? 0)).toBeCloseTo(
      DEFAULT_HAND_LAYOUT.denseHandMaxRotation
    )
    expect(ten[0]?.y).toBeCloseTo(
      DEFAULT_HAND_LAYOUT.baselineY -
        DEFAULT_HAND_LAYOUT.denseHandLift +
        DEFAULT_HAND_LAYOUT.denseHandEdgeTuck
    )
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
      resolveHandHover(
        { x: first.x - 70, y: first.y - 20 },
        hand,
        DEFAULT_HAND_LAYOUT,
        null
      )
    ).toBe(0)
    expect(
      resolveHandHover(
        { x: last.x + 70, y: last.y - 20 },
        hand,
        DEFAULT_HAND_LAYOUT,
        null
      )
    ).toBe(hand.length - 1)
  })
})
