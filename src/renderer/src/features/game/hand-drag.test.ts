import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HAND_DRAG,
  initialDragState,
  stepDrag,
  type HandDragState
} from './hand-drag'
import { CARD_CANVAS } from '../../rendering/cards/card-layout'

describe('hand drag physics', () => {
  it('uses the normal hand scale while attached', () => {
    expect(DEFAULT_HAND_DRAG.dragScale).toBe(0.25)
  })

  it('starts at the given position with no tilt', () => {
    const state = initialDragState(400, 800)
    expect(state).toEqual({ x: 400, y: 800, tiltX: 0, tiltY: 0 })
  })

  it('lerps toward the pointer and converges on it', () => {
    let state: HandDragState = initialDragState(0, 0)
    const pointer = { x: 960, y: 540 }
    for (let i = 0; i < 200; i += 1) {
      state = stepDrag(state, pointer.x, pointer.y, 1000 / 60, DEFAULT_HAND_DRAG)
    }
    const halfHeight = (CARD_CANVAS.height * DEFAULT_HAND_DRAG.dragScale) / 2
    expect(state.x).toBeCloseTo(pointer.x)
    expect(state.y).toBeCloseTo(pointer.y + halfHeight)
  })

  it('leans in the direction of motion and clamps the tilt', () => {
    const config = DEFAULT_HAND_DRAG
    let state = initialDragState(500, 600)
    // Move far right in a single step: horizontal velocity is strongly positive.
    state = stepDrag(state, 1500, 600, 1000 / 60, config)
    expect(state.tiltX).toBeGreaterThan(0)
    expect(state.tiltX).toBeLessThanOrEqual(1)
  })

  it('decays tilt back to zero when the card stops moving', () => {
    const config = DEFAULT_HAND_DRAG
    let state: HandDragState = { x: 100, y: 100, tiltX: 0.3, tiltY: -0.2 }
    for (let i = 0; i < 100; i += 1) {
      state = stepDrag(
        state,
        100,
        100 - (CARD_CANVAS.height * config.dragScale) / 2,
        1000 / 60,
        config
      )
    }
    expect(Math.abs(state.tiltX)).toBeLessThan(0.001)
    expect(Math.abs(state.tiltY)).toBeLessThan(0.001)
  })

  it('keeps the card center within the canvas like the reference effect', () => {
    const config = DEFAULT_HAND_DRAG
    let state = initialDragState(960, 540)
    for (let i = 0; i < 500; i += 1) {
      state = stepDrag(state, 5000, -5000, 1000 / 60, config)
    }
    const halfHeight = (CARD_CANVAS.height * config.dragScale) / 2
    expect(state.x).toBeLessThanOrEqual(1920)
    expect(state.x).toBeGreaterThanOrEqual(0)
    expect(state.y).toBeLessThanOrEqual(1080 + halfHeight)
    expect(state.y).toBeGreaterThanOrEqual(halfHeight)
  })

  it('does not jump when pickup starts from the low hand', () => {
    const state = stepDrag(
      initialDragState(960, 1045),
      960,
      1000,
      1000 / 60,
      DEFAULT_HAND_DRAG
    )
    expect(state.y).toBeGreaterThan(1045)
  })
})
