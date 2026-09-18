import { CARD_CANVAS } from '../../rendering/cards/card-layout'

/** Tunables for the pick-up "weight" and the unaffordable shake. */
export interface HandDragConfig {
  /** Time constant for the pointer-follow lag. Higher values feel heavier. */
  readonly followResponseMS: number
  /** Minimum held scale, reached at the board-side limit. */
  readonly dragScale: number
  /** Maximum held scale, reached near the hand. */
  readonly nearHandScale: number
  /**
   * Normalized point of the card the cursor holds, Hearthstone-style: the card
   * hangs from the grab spot instead of centring on the cursor. (0.5, 0.5) is
   * the old centred behaviour; (0.65, 0.6) holds the card by its right side.
   */
  readonly grabAnchor: { readonly x: number; readonly y: number }
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
}

export const DEFAULT_HAND_DRAG: HandDragConfig = {
  followResponseMS: 85,
  dragScale: 0.2,
  nearHandScale: 0.3,
  grabAnchor: { x: 0.65, y: 0.6 },
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
  return { x, y, scale }
}

/**
 * Card centre in canvas coordinates. The drag origin is bottom-centre, so the
 * centre sits half a scaled card above it and shifts while the scale changes.
 */
export function resolveDragCenter(
  x: number,
  y: number,
  scale: number
): { x: number; y: number } {
  return { x, y: y - (CARD_CANVAS.height * scale) / 2 }
}

/**
 * Advances the drag one frame. The card is pinned at its centre, follows the
 * pointer with frame-rate-independent resistance. Like the reference effect,
 * half the card may leave the canvas at an edge; this also keeps pickup from
 * jumping out of the low hand.
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
  // The cursor holds the card at its grab anchor instead of its centre.
  const targetX =
    pointerX - (config.grabAnchor.x - 0.5) * CARD_CANVAS.width * targetScale
  // Interpolate position and scale together so resizing keeps the same centre.
  const targetY =
    pointerY + (1 - config.grabAnchor.y) * CARD_CANVAS.height * targetScale

  const nextX = clamp(state.x + (targetX - state.x) * smoothing, 0, BOUNDS.width)
  const nextY = clamp(
    state.y + (targetY - state.y) * smoothing,
    halfHeight,
    BOUNDS.height + halfHeight
  )

  return {
    x: nextX,
    y: nextY,
    scale: nextScale
  }
}

/** Frame-rate-independent interpolation factor for the pointer-follow lag. */
export function resolveDragSmoothing(deltaMS: number, responseMS: number): number {
  if (deltaMS <= 0) return 0
  return 1 - Math.exp(-deltaMS / Math.max(1, responseMS))
}
