import type { Container } from 'pixi.js'

export interface ShadowPoint {
  readonly x: number
  readonly y: number
}

export type ShadowCorners = readonly [
  ShadowPoint,
  ShadowPoint,
  ShadowPoint,
  ShadowPoint
]

export interface ShadowBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Crop a snapshot's corners to its physical body, excluding transparent padding. */
export function shadowBodyCorners(
  corners: ShadowCorners,
  frame: ShadowBounds,
  body: ShadowBounds
): ShadowCorners {
  const [a, b, c, d] = corners
  // Square-to-quad homography, matching the card's PerspectiveMesh projection.
  // Bilinear interpolation loses perspective when cropping snapshot padding.
  const dx1 = b.x - c.x
  const dx2 = d.x - c.x
  const dx3 = a.x - b.x + c.x - d.x
  const dy1 = b.y - c.y
  const dy2 = d.y - c.y
  const dy3 = a.y - b.y + c.y - d.y
  const determinant = dx1 * dy2 - dx2 * dy1
  const g = Math.abs(determinant) < 1e-8 ? 0 : (dx3 * dy2 - dx2 * dy3) / determinant
  const h = Math.abs(determinant) < 1e-8 ? 0 : (dx1 * dy3 - dx3 * dy1) / determinant
  const point = (x: number, y: number): ShadowPoint => {
    const u = (x - frame.x) / frame.width
    const v = (y - frame.y) / frame.height
    const w = g * u + h * v + 1
    return {
      x: ((b.x - a.x + g * b.x) * u + (d.x - a.x + h * d.x) * v + a.x) / w,
      y: ((b.y - a.y + g * b.y) * u + (d.y - a.y + h * d.y) * v + a.y) / w
    }
  }
  return [
    point(body.x, body.y),
    point(body.x + body.width, body.y),
    point(body.x + body.width, body.y + body.height),
    point(body.x, body.y + body.height)
  ]
}

/** One physical body, even when its visible representation is temporarily a mesh. */
export interface ShadowCaster {
  readonly owner: Container
  visual: Container
  readonly shape: 'ellipse' | 'rounded-rect'
  readonly bounds: ShadowBounds
  restingScale: number
  restingHeight: number | null
  minimumHeight: number
  maximumHeight: number
  /** Presentation-only lift multiplier, smoothed together with inferred elevation. */
  depthMultiplier: number
  /** Perspective presenters supply magnification before foreshortening. */
  magnification: number | null
  /** Optional footprint in visual-local coordinates; excludes snapshot padding. */
  corners: ShadowCorners | null
  /** Smoothed elevation survives representation changes. */
  height: number | null
}

const casters = new Map<Container, ShadowCaster>()

/** Attach once in a reusable visual constructor, never per card definition/action. */
export function attachShadow(
  owner: Container,
  bounds: ShadowBounds,
  options: Partial<
    Pick<
      ShadowCaster,
      'visual' | 'shape' | 'restingScale' | 'restingHeight' | 'maximumHeight'
    >
  > = {}
): ShadowCaster {
  const existing = casters.get(owner)
  if (existing) return existing
  const caster: ShadowCaster = {
    owner,
    bounds,
    visual: owner,
    shape: 'rounded-rect',
    restingScale: 1,
    restingHeight: null,
    minimumHeight: 0,
    maximumHeight: Infinity,
    depthMultiplier: 1,
    magnification: null,
    corners: null,
    height: null,
    ...options
  }
  casters.set(owner, caster)
  owner.once('destroyed', () => casters.delete(owner))
  return caster
}

export function getShadowCaster(owner: Container): ShadowCaster | undefined {
  return casters.get(owner)
}

/** Only physical roots, not their artwork, labels, outlines, or particles. */
export function shadowCasters(): IterableIterator<ShadowCaster> {
  return casters.values()
}
