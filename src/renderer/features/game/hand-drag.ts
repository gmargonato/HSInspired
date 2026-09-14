import { CARD_CANVAS } from '../../rendering/cards/card-layout'

/** Tunables for the pick-up "weight" and the unaffordable shake. */
export interface HandDragConfig {
  /** Time constant for the pointer-follow lag. Higher values feel heavier. */
  readonly followResponseMS: number
  /** Card velocity in px/s that produces the maximum normalized tilt. */
  readonly velocityForFullTilt: number
  /** Minimum held scale, reached at the board-side limit. */
  readonly dragScale: number
  /** Maximum held scale, reached near the hand. */
  readonly nearHandScale: number
  /** Pointer Y limits on the 1920x1080 design canvas. */
  readonly nearHandY: number
  readonly boardY: number
  /** Horizontal wobble amplitude (px) of the unaffordable shake. */
  readonly shakeDistance: number
  /** Total duration of one shake. */
  readonly shakeDuration: number
}

/** Per-frame drag state advanced by `stepDrag`. */
export interface HandDragState {
  readonly x: number
  readonly y: number
  readonly scale: number
  /** Normalized rigid-plane tilt target derived from horizontal velocity. */
  readonly tiltX: number
  /** Normalized rigid-plane tilt target derived from vertical velocity. */
  readonly tiltY: number
}

export const DEFAULT_HAND_DRAG: HandDragConfig = {
  followResponseMS: 65,
  velocityForFullTilt: 1100,
  dragScale: 0.2,
  nearHandScale: 0.3,
  nearHandY: 950,
  boardY: 540,
  shakeDistance: 4,
  shakeDuration: 0.1
}

/** The drag is contained to the 1920x1080 design canvas. */
const BOUNDS = { width: 1920, height: 1080 } as const

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function initialDragState(
  x: number,
  y: number,
  scale: number = DEFAULT_HAND_DRAG.dragScale
): HandDragState {
  return { x, y, scale, tiltX: 0, tiltY: 0 }
}

/**
 * Advances the drag one frame. The card is pinned at its centre (its origin is
 * bottom-centre, so the centre sits `height/2` above that origin), follows the
 * pointer with frame-rate-independent resistance, and produces normalized tilt
 * from its velocity. Like the reference effect, half the card may leave the
 * canvas at an edge; this also keeps pickup from jumping out of the low hand.
 */
export function stepDrag(
  state: HandDragState,
  pointerX: number,
  pointerY: number,
  deltaMS: number,
  config: HandDragConfig = DEFAULT_HAND_DRAG
): HandDragState {
  const progress = clamp(
    (config.nearHandY - pointerY) / (config.nearHandY - config.boardY),
    0,
    1
  )
  const targetScale =
    config.nearHandScale + (config.dragScale - config.nearHandScale) * progress
  const smoothing = resolveDragSmoothing(deltaMS, config.followResponseMS)
  const nextScale = state.scale + (targetScale - state.scale) * smoothing
  const halfHeight = (CARD_CANVAS.height * nextScale) / 2
  const targetX = pointerX
  // Interpolate position and scale together so resizing keeps the same centre.
  const targetY = pointerY + (CARD_CANVAS.height * targetScale) / 2

  const nextX = clamp(state.x + (targetX - state.x) * smoothing, 0, BOUNDS.width)
  const nextY = clamp(
    state.y + (targetY - state.y) * smoothing,
    halfHeight,
    BOUNDS.height + halfHeight
  )
  const elapsedSeconds = Math.max(1, deltaMS) / 1000
  // Resizing moves the bottom-centre origin even when the visual centre is still.
  const previousCenterY = state.y - (CARD_CANVAS.height * state.scale) / 2
  const nextCenterY = nextY - halfHeight

  return {
    x: nextX,
    y: nextY,
    scale: nextScale,
    tiltX: clamp(
      (nextX - state.x) / elapsedSeconds / config.velocityForFullTilt,
      -1,
      1
    ),
    tiltY: clamp(
      (nextCenterY - previousCenterY) / elapsedSeconds / config.velocityForFullTilt,
      -1,
      1
    )
  }
}

/** Frame-rate-independent interpolation factor for the pointer-follow lag. */
export function resolveDragSmoothing(deltaMS: number, responseMS: number): number {
  if (deltaMS <= 0) return 0
  return 1 - Math.exp(-deltaMS / Math.max(1, responseMS))
}
