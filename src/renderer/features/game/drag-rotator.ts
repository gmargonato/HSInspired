/**
 * TypeScript port of the Hearthstone client's DragRotator.cs: per-frame card
 * movement deltas accumulate into clamped pitch/roll angles that relax back to
 * rest through a critically damped spring (Unity's Mathf.SmoothDamp).
 */

/** Visual tilt maxima of the perspective projection, in degrees. */
export const MAX_TILT_X_DEG = 40
export const MAX_TILT_Y_DEG = 50

const SMOOTH_DAMP_SEC_FUDGE = 0.1
/** Movement deltas whose squared magnitude is at or below this do not inject tilt. */
const EPSILON_SQUARED = 9.99999974737875e-5

export interface DragRotatorAxisConfig {
  /** Degrees injected per pixel of card movement. */
  readonly forceMultiplier: number
  readonly minDegrees: number
  readonly maxDegrees: number
  /** Seconds the tilt takes to settle back to rest. */
  readonly restSeconds: number
}

export interface DragRotatorConfig {
  /** Vertical card movement rotating around the X axis. */
  readonly pitch: DragRotatorAxisConfig
  /** Horizontal card movement rotating around the Y axis. */
  readonly roll: DragRotatorAxisConfig
}

export interface DragRotatorState {
  readonly pitchDeg: number
  readonly rollDeg: number
  readonly pitchVel: number
  readonly rollVel: number
  readonly prevX: number
  readonly prevY: number
}

/**
 * Tuned to the DragRotator reference: clamps in the reported 40-50 degree
 * range, a sustained ~800 px/s drag settles at the clamp, and a
 * Hearthstone-flavoured RestSeconds of 2.5.
 */
export const DEFAULT_DRAG_ROTATOR: DragRotatorConfig = {
  pitch: {
    forceMultiplier: 0.2,
    minDegrees: -MAX_TILT_X_DEG,
    maxDegrees: MAX_TILT_X_DEG,
    restSeconds: 2.5
  },
  roll: {
    forceMultiplier: 0.25,
    minDegrees: -MAX_TILT_Y_DEG,
    maxDegrees: MAX_TILT_Y_DEG,
    restSeconds: 2.5
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Faithful port of Unity's Mathf.SmoothDamp (critically damped spring). */
function smoothDamp(
  current: number,
  target: number,
  velocity: number,
  smoothTime: number,
  deltaSeconds: number
): { value: number; velocity: number } {
  if (deltaSeconds <= 0) return { value: current, velocity }
  smoothTime = Math.max(0.0001, smoothTime)
  const omega = 2 / smoothTime
  const x = omega * deltaSeconds
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  // Unity's default maxSpeed is Infinity, so the change clamp is a no-op.
  const maxChange = Infinity
  const change = clamp(current - target, -maxChange, maxChange)
  const dampedTarget = current - change
  const temp = (velocity + omega * change) * deltaSeconds
  const nextVelocity = (velocity - omega * temp) * exp
  let output = dampedTarget + (change + temp) * exp
  if (target - current > 0.1 === output > target) {
    output = target
    return { value: output, velocity: (output - target) / deltaSeconds }
  }
  return { value: output, velocity: nextVelocity }
}

/** Mirrors DragRotator.Reset(): zero the tilt state and re-anchor the deltas. */
export function resetDragRotator(centerX: number, centerY: number): DragRotatorState {
  return {
    pitchDeg: 0,
    rollDeg: 0,
    pitchVel: 0,
    rollVel: 0,
    prevX: centerX,
    prevY: centerY
  }
}

/**
 * Advances the rotator one frame. Like DragRotator.Update(), the card-centre
 * deltas accumulate into clamped angles and then SmoothDamp back toward rest.
 */
export function stepDragRotator(
  state: DragRotatorState,
  centerX: number,
  centerY: number,
  deltaMS: number,
  config: DragRotatorConfig = DEFAULT_DRAG_ROTATOR
): DragRotatorState {
  const deltaX = centerX - state.prevX
  const deltaY = centerY - state.prevY
  let pitchDeg = state.pitchDeg
  let rollDeg = state.rollDeg
  if (deltaX * deltaX + deltaY * deltaY > EPSILON_SQUARED) {
    pitchDeg += deltaY * config.pitch.forceMultiplier
    pitchDeg = clamp(pitchDeg, config.pitch.minDegrees, config.pitch.maxDegrees)
    rollDeg -= deltaX * config.roll.forceMultiplier
    rollDeg = clamp(rollDeg, config.roll.minDegrees, config.roll.maxDegrees)
  }
  const deltaSeconds = Math.max(0, deltaMS) / 1000
  const pitch = smoothDamp(
    pitchDeg,
    0,
    state.pitchVel,
    config.pitch.restSeconds * SMOOTH_DAMP_SEC_FUDGE,
    deltaSeconds
  )
  const roll = smoothDamp(
    rollDeg,
    0,
    state.rollVel,
    config.roll.restSeconds * SMOOTH_DAMP_SEC_FUDGE,
    deltaSeconds
  )
  return {
    pitchDeg: pitch.value,
    rollDeg: roll.value,
    pitchVel: pitch.velocity,
    rollVel: roll.velocity,
    prevX: centerX,
    prevY: centerY
  }
}
