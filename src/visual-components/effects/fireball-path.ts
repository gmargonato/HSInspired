/** Bend a straight, upward-facing cast in design pixels. Positive bends right.
 * Beyond the endpoints, continue along the tangent so surviving particles do not
 * fold back toward the source. Zero-distance casts retain their local geometry.
 */
export function fireballPathPoint(
  across: number,
  along: number,
  distance: number,
  curvature: number
): { x: number; y: number } {
  if (curvature === 0 || distance < 0.001) return { x: across, y: -along }
  const u = along / distance
  const t = Math.max(0, Math.min(1, u))
  const slope = curvature * (1 - 2 * t)
  const bend = curvature * distance * t * (1 - t) + slope * (along - t * distance)
  const norm = Math.hypot(1, slope)
  return { x: bend + across / norm, y: -along + (across * slope) / norm }
}
