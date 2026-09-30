import { describe, expect, it } from 'vitest'
import { TargetGestureController } from './target-gesture'

describe('target gesture controller', () => {
  it('keeps a short press available for click targeting', () => {
    const gestures = new TargetGestureController<string>()
    gestures.begin('hero-power', 7, { x: 10, y: 10 })

    expect(gestures.move(7, { x: 15, y: 10 }, 10)).toBe(false)
    expect(gestures.release(7)).toEqual({
      source: 'hero-power',
      pointerId: 7,
      phase: 'pressed'
    })
    expect(gestures.consumeTap(7)).toBe(false)
  })

  it('activates once after the threshold and suppresses the resulting tap', () => {
    const gestures = new TargetGestureController<string>()
    gestures.begin('combat', 7, { x: 10, y: 10 })

    expect(gestures.move(8, { x: 30, y: 10 }, 10)).toBe(false)
    expect(gestures.move(7, { x: 20, y: 10 }, 10)).toBe(true)
    expect(gestures.move(7, { x: 40, y: 10 }, 10)).toBe(false)
    expect(gestures.release(7)?.phase).toBe('dragging')
    expect(gestures.consumeTap(7)).toBe(true)
    expect(gestures.consumeTap(7)).toBe(false)
  })

  it('ignores mismatched releases and supports source-specific cancellation', () => {
    const gestures = new TargetGestureController<{ readonly kind: string }>()
    gestures.begin({ kind: 'card' }, 7, { x: 10, y: 10 })

    expect(gestures.release(8)).toBeNull()
    gestures.cancel((source) => source.kind === 'combat')
    expect(gestures.current?.source.kind).toBe('card')
    gestures.cancel((source) => source.kind === 'card')
    expect(gestures.current).toBeNull()
  })

  it('can suppress the activation tap for a click-selected card', () => {
    const gestures = new TargetGestureController<string>()
    gestures.suppressTap(7)

    expect(gestures.consumeTap(7)).toBe(true)
  })
})
