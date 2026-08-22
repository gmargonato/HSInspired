import type { CardView } from './card-view'

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

interface CardBaseTransform {
  readonly position: ParallaxPoint
  readonly pivot: ParallaxPoint
  readonly scale: ParallaxPoint
  readonly skew: ParallaxPoint
}

export const CARD_PARALLAX_LAYERS: readonly ParallaxLayerDefinition[] = [
  { path: 'card.artwork', depth: -18 },
  { path: 'card.frame', depth: 0 },
  { path: 'card.rules', depth: 0 },
  { path: 'card.race-banner', depth: 0 },
  { path: 'card.race', depth: 0 },
  { path: 'card.name-banner', depth: 16 },
  { path: 'card.name', depth: 16 },
  { path: 'card.legendary-frame', depth: 12 },
  { path: 'card.rarity', depth: 10 },
  { path: 'card.stats.mana', depth: 30 },
  { path: 'card.stats.mana.label', depth: 8 },
  { path: 'card.stats.attack', depth: 30 },
  { path: 'card.stats.attack.label', depth: 8 },
  { path: 'card.stats.health', depth: 30 },
  { path: 'card.stats.health.label', depth: 8 },
  { path: 'card.stats.durability', depth: 30 },
  { path: 'card.stats.durability.label', depth: 8 },
  { path: 'card.stats.armor', depth: 30 },
  { path: 'card.overlays', depth: 32 }
]

const RESPONSE_TIME_MS = 105
const MAX_TILT_X = (10 * Math.PI) / 180
const MAX_TILT_Y = (12 * Math.PI) / 180

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value))
}

/** Converts a pointer position into a bounded tilt around a card. */
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

/** Frame-rate-independent interpolation factor for weighted card motion. */
export function resolveParallaxSmoothing(deltaMS: number): number {
  if (deltaMS <= 0) return 0
  return 1 - Math.exp(-deltaMS / RESPONSE_TIME_MS)
}

/** Projects a rigid card plane after X/Y rotation using an orthographic camera. */
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
 * Reusable 2.5D motion for a composed CardView. It preserves the card's local
 * placement, so callers can apply it both to a top-left preview and to a card
 * positioned inside a bottom-centred hand slot.
 */
export class CardParallaxEffect {
  private readonly layers: readonly ParallaxLayerDefinition[]
  private readonly base: CardBaseTransform
  private readonly target = { x: 0, y: 0 }
  private readonly current = { x: 0, y: 0 }
  private destroyed = false

  constructor(private readonly cardView: CardView) {
    const paths = new Set(cardView.getNodeMetadata().map((metadata) => metadata.path))
    this.layers = CARD_PARALLAX_LAYERS.filter((definition) =>
      paths.has(definition.path)
    )
    this.base = {
      position: { x: cardView.position.x, y: cardView.position.y },
      pivot: { x: cardView.pivot.x, y: cardView.pivot.y },
      scale: { x: cardView.scale.x, y: cardView.scale.y },
      skew: { x: cardView.skew.x, y: cardView.skew.y }
    }

    const centerX = cardView.plan.width / 2
    const centerY = cardView.renderedHeight / 2
    cardView.pivot.set(centerX, centerY)
    cardView.position.set(
      this.base.position.x + centerX * this.base.scale.x,
      this.base.position.y + centerY * this.base.scale.y
    )
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
    this.cardView.skew.set(
      this.base.skew.x + plane.skewX,
      this.base.skew.y + plane.skewY
    )
    this.cardView.scale.set(
      this.base.scale.x * plane.scaleX,
      this.base.scale.y * plane.scaleY
    )

    for (const layer of this.layers) {
      const offset = resolveParallaxLayerOffset(this.current, layer.depth)
      this.cardView.setSemanticLayerOffset(layer.path, offset)
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true

    for (const layer of this.layers) {
      this.cardView.setSemanticLayerOffset(layer.path, { x: 0, y: 0 })
    }
    this.cardView.position.set(this.base.position.x, this.base.position.y)
    this.cardView.pivot.set(this.base.pivot.x, this.base.pivot.y)
    this.cardView.scale.set(this.base.scale.x, this.base.scale.y)
    this.cardView.skew.set(this.base.skew.x, this.base.skew.y)
  }
}
