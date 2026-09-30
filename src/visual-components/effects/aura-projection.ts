/** Inverse homography: local quad coordinates -> normalized source UVs. */
export function inverseAuraProjection(c: readonly number[]): number[] {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = c
  const dx1 = x1 - x2,
    dx2 = x3 - x2,
    dx3 = x0 - x1 + x2 - x3
  const dy1 = y1 - y2,
    dy2 = y3 - y2,
    dy3 = y0 - y1 + y2 - y3
  const determinant = dx1 * dy2 - dx2 * dy1
  if (Math.abs(determinant) < 1e-8) return [0, 0, 0, 0, 0, 0, 0, 0, 1]
  const g = (dx3 * dy2 - dx2 * dy3) / determinant
  const h = (dx1 * dy3 - dx3 * dy1) / determinant
  const a = x1 - x0 + g * x1,
    b = x3 - x0 + h * x3,
    d = y1 - y0 + g * y1,
    e = y3 - y0 + h * y3
  return [
    e - y0 * h,
    x0 * h - b,
    b * y0 - x0 * e,
    y0 * g - d,
    a - x0 * g,
    x0 * d - a * y0,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d
  ]
}
