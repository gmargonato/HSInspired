/** The existing texture budget and playback cadence, now all forward samples. */
export const OUTLINE_LOOP_FRAME_COUNT = 16
export const OUTLINE_LOOP_FRAME_MS = 1_000 / 12
export const OUTLINE_LOOP_SECONDS =
  (OUTLINE_LOOP_FRAME_COUNT * OUTLINE_LOOP_FRAME_MS) / 1_000

/**
 * A closed noise-coordinate path with matching position and velocity at the seam.
 * The perpendicular component prevents the field from retracing its path. These
 * values are computed once per baked frame, not with trigonometry per pixel.
 * Breathing completes whole cycles so it also joins without a brightness jump.
 */
export function sampleOutlineLoop(
  time: number,
  duration: number,
  pulseRate: number
): [number, number, number, number] {
  if (duration <= 0) return [0, 0, 0, 0]
  const phase = (((time % duration) + duration) % duration) / duration
  const angle = phase * Math.PI * 2
  const radius = duration / (Math.PI * 2)
  const pulseCycles =
    pulseRate > 0 ? Math.max(1, Math.round((pulseRate * duration) / 2)) : 0
  return [
    Math.sin(angle) * radius,
    (1 - Math.cos(angle)) * radius,
    1,
    angle * pulseCycles
  ]
}
