import { CARD_CANVAS } from '../../rendering/cards/card-layout'
import type { HandPointer } from './hand-layout'

/** Tunables for the pick-up "weight" and the unaffordable shake. */
export interface HandDragConfig {
  /** Time constant for pickup settling and scale; pointer translation is immediate. */
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
  readonly pickupOffsetX: number
  readonly pickupOffsetY: number
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
  scale: number,
  pointer: HandPointer,
  config: HandDragConfig = DEFAULT_HAND_DRAG
): HandDragState {
  const origin = dragOrigin(pointer.x, pointer.y, scale, config)
  return {
    x,
    y,
    scale,
    pickupOffsetX: x - origin.x,
    pickupOffsetY: y - origin.y
  }
}

function dragOrigin(
  pointerX: number,
  pointerY: number,
  scale: number,
  config: HandDragConfig
): HandPointer {
  return {
    x: pointerX - (config.grabAnchor.x - 0.5) * CARD_CANVAS.width * scale,
    y: pointerY + (1 - config.grabAnchor.y) * CARD_CANVAS.height * scale
  }
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
 * Advances the drag one rendered frame. The grab anchor follows the latest pointer
 * immediately while the initial pickup offset and scale settle independently.
 * Half the card may leave the canvas at an edge, preserving the low-hand pickup.
 */
export function stepDrag(
  state: HandDragState,
  pointerX: number,
  pointerY: number,
  deltaMS: number,
  config: HandDragConfig = DEFAULT_HAND_DRAG
): HandDragState {
  if (deltaMS <= 0) return state
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
  const pickupOffsetX = state.pickupOffsetX * (1 - smoothing)
  const pickupOffsetY = state.pickupOffsetY * (1 - smoothing)
  const origin = dragOrigin(pointerX, pointerY, nextScale, config)
  const nextX = clamp(origin.x + pickupOffsetX, 0, BOUNDS.width)
  const nextY = clamp(origin.y + pickupOffsetY, halfHeight, BOUNDS.height + halfHeight)

  return {
    x: nextX,
    y: nextY,
    scale: nextScale,
    pickupOffsetX,
    pickupOffsetY
  }
}

/** Frame-rate-independent interpolation factor for the pointer-follow lag. */
export function resolveDragSmoothing(deltaMS: number, responseMS: number): number {
  if (deltaMS <= 0) return 0
  return 1 - Math.exp(-deltaMS / Math.max(1, responseMS))
}
