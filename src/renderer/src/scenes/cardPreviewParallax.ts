import type { CardView } from '../../../../card-lab/card-view'

export interface ParallaxPoint {
  readonly x: number
  readonly y: number
}

export interface CardPlaneTransform {
  readonly scaleX: number
  readonly scaleY: number
  readonly skewX: number
  readonly skewY: number
}

interface ParallaxLayerDefinition {
  readonly path: string
  readonly depth: number
}

interface ParallaxLayer extends ParallaxLayerDefinition {
  readonly x: number
  readonly y: number
}

const PARALLAX_LAYERS: readonly ParallaxLayerDefinition[] = [
  // Artwork sits just behind the frame; its small depth avoids exposing the
  // edge of the existing artwork mask.
  { path: 'card.artwork', depth: -18 },
  // Printed elements remain locked to one rigid card surface.
  { path: 'card.frame', depth: 0 },
  { path: 'card.rules', depth: 0 },
  // The name and its banner form one raised physical layer.
  { path: 'card.name-banner', depth: 16 },
  { path: 'card.name', depth: 16 },
  // Physical ornaments sit slightly above the printed card surface.
  { path: 'card.legendary-frame', depth: 12 },
  { path: 'card.rarity', depth: 10 },
  // Stat medallions are the strongest available foreground cue.
  { path: 'card.stats.mana', depth: 30 },
  { path: 'card.stats.attack', depth: 30 },
  { path: 'card.stats.health', depth: 30 },
  { path: 'card.stats.durability', depth: 30 },
  { path: 'card.stats.armor', depth: 30 },
  { path: 'card.overlays', depth: 32 }
]

const RESPONSE_TIME_MS = 105
const MAX_TILT_X = (10 * Math.PI) / 180
const MAX_TILT_Y = (12 * Math.PI) / 180

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value))
}

/** Converts a pointer position into a bounded tilt around the preview card. */
export function resolveParallaxTarget(
  pointer: ParallaxPoint,
  center: ParallaxPoint,
  range: ParallaxPoint
): ParallaxPoint {
  return {
    x: clampUnit((pointer.x - center.x) / Math.max(1, range.x)),
    y: clampUnit((pointer.y - center.y) / Math.max(1, range.y))
  }
}

/** Frame-rate-independent interpolation factor for the weighted card motion. */
export function resolveParallaxSmoothing(deltaMS: number): number {
  if (deltaMS <= 0) return 0
  return 1 - Math.exp(-deltaMS / RESPONSE_TIME_MS)
}

/**
 * Projects a rigid card plane after X/Y rotation using an orthographic camera.
 * A single-axis tilt only foreshortens that axis; shear appears naturally only
 * when both rotations are present.
 */
export function resolveCardPlaneTransform(tilt: ParallaxPoint): CardPlaneTransform {
  const rotateX = -clampUnit(tilt.y) * MAX_TILT_X
  const rotateY = clampUnit(tilt.x) * MAX_TILT_Y
  const projectedX = Math.cos(rotateY)
  const projectedCrossAxis = Math.sin(rotateY) * Math.sin(rotateX)
  const projectedY = Math.cos(rotateX)
  const skewX =
    projectedCrossAxis === 0 ? 0 : Math.atan2(projectedCrossAxis, projectedY)

  return {
    scaleX: projectedX,
    scaleY: Math.hypot(projectedCrossAxis, projectedY),
    skewX,
    skewY: 0
  }
}

/** Returns the local translation for one semantic card layer. */
export function resolveParallaxLayerOffset(
  tilt: ParallaxPoint,
  depth: number
): ParallaxPoint {
  return {
    x: Math.sin(clampUnit(tilt.x) * MAX_TILT_Y) * depth,
    y: Math.sin(clampUnit(tilt.y) * MAX_TILT_X) * depth
  }
}

/**
 * Preview-only 2.5D motion for a composed CardView.
 *
 * It intentionally uses CardView's public semantic-node API so the effect can
 * be removed without changing the shared renderer or its card templates.
 */
export class CardPreviewParallax {
  private readonly layers: readonly ParallaxLayer[]
  private readonly target = { x: 0, y: 0 }
  private readonly current = { x: 0, y: 0 }
  private destroyed = false

  constructor(private readonly cardView: CardView) {
    const nodes = new Map(
      cardView.getNodeInspectors().map((inspector) => [inspector.path, inspector])
    )
    this.layers = PARALLAX_LAYERS.flatMap((definition) => {
      const node = nodes.get(definition.path)
      return node ? [{ ...definition, x: node.x, y: node.y }] : []
    })

    // Keep the wrapper's origin at the visual top-left while making all local
    // skew and compression happen around the center of the card.
    const centerX = cardView.plan.width / 2
    const centerY = cardView.renderedHeight / 2
    cardView.pivot.set(centerX, centerY)
    cardView.position.set(centerX, centerY)
  }

  setTarget(target: ParallaxPoint): void {
    if (this.destroyed) return
    this.target.x = clampUnit(target.x)
    this.target.y = clampUnit(target.y)
  }

  release(): void {
    this.setTarget({ x: 0, y: 0 })
  }

  update(deltaMS: number): void {
    if (this.destroyed) return

    const smoothing = resolveParallaxSmoothing(deltaMS)
    this.current.x += (this.target.x - this.current.x) * smoothing
    this.current.y += (this.target.y - this.current.y) * smoothing

    const plane = resolveCardPlaneTransform(this.current)
    this.cardView.skew.set(plane.skewX, plane.skewY)
    this.cardView.scale.set(plane.scaleX, plane.scaleY)

    for (const layer of this.layers) {
      const offset = resolveParallaxLayerOffset(this.current, layer.depth)
      this.cardView.setNodeGeometry(layer.path, {
        x: layer.x + offset.x,
        y: layer.y + offset.y
      })
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true

    for (const layer of this.layers) {
      this.cardView.setNodeGeometry(layer.path, { x: layer.x, y: layer.y })
    }
    this.cardView.skew.set(0)
    this.cardView.scale.set(1)
    this.cardView.pivot.set(0)
    this.cardView.position.set(0)
  }
}
