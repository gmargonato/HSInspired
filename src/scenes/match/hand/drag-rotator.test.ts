import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DRAG_ROTATOR,
  MAX_TILT_X_DEG,
  MAX_TILT_Y_DEG,
  resetDragRotator,
  stepDragRotator,
  type DragRotatorState
} from './drag-rotator'

const FRAME_MS = 1000 / 60

/** Moves the card at a constant velocity (px/s) for the given frame count. */
function dragAtVelocity(
  state: DragRotatorState,
  velocityX: number,
  velocityY: number,
  frames: number,
  deltaMS = FRAME_MS
): DragRotatorState {
  let next = state
  for (let i = 0; i < frames; i++) {
    const seconds = deltaMS / 1000
    next = stepDragRotator(
      next,
      next.prevX + velocityX * seconds,
      next.prevY + velocityY * seconds,
      deltaMS
    )
  }
  return next
}

describe('stepDragRotator', () => {
  it('accumulates movement into pitch and roll with Hearthstone signs', () => {
    const down = dragAtVelocity(resetDragRotator(0, 0), 0, 600, 10)
    expect(down.pitchDeg).toBeGreaterThan(0)
    expect(down.rollDeg).toBe(0)

    const right = dragAtVelocity(resetDragRotator(0, 0), 600, 0, 10)
    expect(right.rollDeg).toBeLessThan(0)
    expect(right.pitchDeg).toBe(0)
  })

  it('clamps tilt at the projection maxima', () => {
    // The clamp applies before SmoothDamp each frame, so the resting value
    // settles a couple of degrees short of the maximum rather than on it.
    const down = dragAtVelocity(resetDragRotator(0, 0), 0, 2000, 120)
    expect(down.pitchDeg).toBeGreaterThan(36)
    expect(down.pitchDeg).toBeLessThanOrEqual(MAX_TILT_X_DEG)

    const up = dragAtVelocity(resetDragRotator(0, 0), 0, -2000, 120)
    expect(up.pitchDeg).toBeLessThan(-36)
    expect(up.pitchDeg).toBeGreaterThanOrEqual(-MAX_TILT_X_DEG)

    const right = dragAtVelocity(resetDragRotator(0, 0), 2000, 0, 120)
    expect(right.rollDeg).toBeLessThan(-46)
    expect(right.rollDeg).toBeGreaterThanOrEqual(-MAX_TILT_Y_DEG)
  })

  it('unwinds a clamped tilt through reversing movement instead of flipping', () => {
    const clamped = dragAtVelocity(resetDragRotator(0, 0), 0, 2000, 60)
    expect(clamped.pitchDeg).toBeGreaterThan(36)

    const fewFrames = dragAtVelocity(clamped, 0, -2000, 3)
    expect(fewFrames.pitchDeg).toBeGreaterThan(0)

    const saturated = dragAtVelocity(clamped, 0, -2000, 60)
    expect(saturated.pitchDeg).toBeLessThan(-36)
  })

  it('decays toward rest through the damped spring without overshooting', () => {
    const clamped = dragAtVelocity(resetDragRotator(0, 0), 0, 2000, 60)
    let next = clamped
    for (let i = 0; i < 240; i++) {
      next = stepDragRotator(next, next.prevX, next.prevY, FRAME_MS)
      expect(next.pitchDeg).toBeGreaterThanOrEqual(0)
    }
    expect(next.pitchDeg).toBeLessThan(0.5)
    expect(Math.abs(next.pitchVel)).toBeLessThan(1e-6)
  })

  it('is frame-rate independent for sustained velocity', () => {
    const at60 = dragAtVelocity(resetDragRotator(0, 0), 300, 0, 60)
    const at30 = dragAtVelocity(resetDragRotator(0, 0), 300, 0, 30, 1000 / 30)
    const at120 = dragAtVelocity(resetDragRotator(0, 0), 300, 0, 120, 1000 / 120)
    // The exp-polynomial approximation of SmoothDamp leaves a small
    // frame-rate-dependent residue; allow roughly one degree of it.
    expect(Math.abs(at60.rollDeg - at30.rollDeg)).toBeLessThan(1)
    expect(Math.abs(at60.rollDeg - at120.rollDeg)).toBeLessThan(1)
  })

  it('ignores sub-epsilon jitter', () => {
    let next = resetDragRotator(0, 0)
    for (let i = 0; i < 600; i++) {
      next = stepDragRotator(next, next.prevX + 0.005, next.prevY + 0.005, FRAME_MS)
    }
    expect(next.pitchDeg).toBe(0)
    expect(next.rollDeg).toBe(0)
  })

  it('reset zeroes tilt and anchors deltas at the pickup centre', () => {
    const clamped = dragAtVelocity(resetDragRotator(0, 0), 0, 2000, 60)
    expect(clamped.pitchDeg).not.toBe(0)

    const reset = resetDragRotator(500, 800)
    expect(reset).toEqual({
      pitchDeg: 0,
      rollDeg: 0,
      pitchVel: 0,
      rollVel: 0,
      prevX: 500,
      prevY: 800
    })

    const first = stepDragRotator(reset, 500, 800, FRAME_MS)
    expect(first.pitchDeg).toBe(0)
    expect(first.rollDeg).toBe(0)
  })

  it('keeps the normalized tilt the projection consumes within one unit', () => {
    const clamped = dragAtVelocity(resetDragRotator(0, 0), 2000, 2000, 120)
    const tiltX = clamped.rollDeg / MAX_TILT_Y_DEG
    const tiltY = -clamped.pitchDeg / MAX_TILT_X_DEG
    expect(tiltX).toBeGreaterThanOrEqual(-1)
    expect(tiltX).toBeLessThanOrEqual(1)
    expect(tiltY).toBeGreaterThanOrEqual(-1)
    expect(tiltY).toBeLessThanOrEqual(1)
    expect(DEFAULT_DRAG_ROTATOR.roll.forceMultiplier).toBeGreaterThan(0)
  })
})
