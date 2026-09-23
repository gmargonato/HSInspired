interface AffineMapping {
  readonly a: number
  readonly b: number
  readonly c: number
  readonly d: number
  readonly tx: number
  readonly ty: number
}

interface PixelSize {
  readonly pixelWidth: number
  readonly pixelHeight: number
}

/** Maps the current filter UVs into a distance field saved at a reference pose. */
export function mapOutlineDistance(
  current: AffineMapping,
  reference: AffineMapping,
  input: PixelSize,
  cache: PixelSize
): { x: [number, number, number, number]; y: [number, number, number, number] } | null {
  const determinant = reference.a * reference.d - reference.b * reference.c
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null

  // Both matrices map filter UVs to normalized sprite coordinates. Taking
  // inverse(reference) * current also retains clipping/subpixel translations.
  const a = (reference.d * current.a - reference.c * current.b) / determinant
  const b = (reference.a * current.b - reference.b * current.a) / determinant
  const c = (reference.d * current.c - reference.c * current.d) / determinant
  const d = (reference.a * current.d - reference.b * current.c) / determinant
  const dx = current.tx - reference.tx
  const dy = current.ty - reference.ty
  const tx = (reference.d * dx - reference.c * dy) / determinant
  const ty = (reference.a * dy - reference.b * dx) / determinant

  // A scalar distance transforms correctly only under a similarity in PIXEL
  // space. UV lengths alone are misleading for non-square/pooled textures.
  const ax = (a * cache.pixelWidth) / input.pixelWidth
  const ay = (b * cache.pixelHeight) / input.pixelWidth
  const bx = (c * cache.pixelWidth) / input.pixelHeight
  const by = (d * cache.pixelHeight) / input.pixelHeight
  const lengthX = Math.hypot(ax, ay)
  const lengthY = Math.hypot(bx, by)
  const dot = ax * bx + ay * by
  if (
    ![a, b, c, d, tx, ty, lengthX, lengthY].every(Number.isFinite) ||
    lengthX < 0.5 ||
    lengthX > 2 ||
    Math.abs(lengthX - lengthY) > 1e-5 * lengthX ||
    Math.abs(dot) > 1e-5 * lengthX * lengthY
  )
    return null

  // Large scale changes rebake instead of magnifying a low-detail field.
  return { x: [a, c, tx, 1 / lengthX], y: [b, d, ty, 0] }
}
