import { CARD_CANVAS } from '../../../visual-components/cards/card-layout'
import { ACTIVE_HAND_CARD_DEPTH } from '../match-layers'

export interface HandLayoutConfig {
  readonly centerX: number
  readonly baselineY: number
  /** Extracted desktop distances, in original world units. */
  readonly width: number
  readonly defaultSpacing: number
  /** Independent 2D calibration, not recovered camera projection. */
  readonly horizontalUnitsToPixels: number
  readonly verticalUnitsToPixels: number
  /** Converts the original fan angle to rotation about our bottom-center pivot. */
  readonly screenRotationMultiplier: number
  /** Upward lift ramps from zero at three cards to this value at six cards. */
  readonly maxHandLift: number
  readonly cardScale: number
  readonly hoverLift: number
  readonly hoverScale: number
  /** Initial focus-entry and focus-exit offsets in design pixels. */
  readonly hoverSettleDistance: number
  readonly hoverReturnLift: number
  readonly safeRightBoundaryX: number
  readonly hoverEntryMargin: number
}

export interface HandCardTransform {
  readonly x: number
  readonly y: number
  readonly rotation: number
  readonly scale: number
  readonly zIndex: number
}

export interface HandPointer {
  readonly x: number
  readonly y: number
}

const VERTICAL_UNITS_TO_PIXELS = 120 / 2.283901

/** Extracted desktop distances plus calibration for our 2D card canvas. */
export const DEFAULT_HAND_LAYOUT: HandLayoutConfig = {
  centerX: 960,
  baselineY: 1140,
  width: 4.8,
  defaultSpacing: 1.270804,
  // Fit the visible rotated fan, not just the distance between card origins.
  horizontalUnitsToPixels: 90,
  verticalUnitsToPixels: VERTICAL_UNITS_TO_PIXELS,
  screenRotationMultiplier: 0.6,
  maxHandLift: 28,
  cardScale: 0.2,
  hoverScale: 0.2 * (1.5 / 0.62),
  safeRightBoundaryX: 1257,
  hoverLift: 120,
  hoverSettleDistance: 0.1 * VERTICAL_UNITS_TO_PIXELS,
  hoverReturnLift: 0.5 * VERTICAL_UNITS_TO_PIXELS,
  hoverEntryMargin: 15
}

/**
 * Recovered desktop fan adapted to our bottom-center, Y-down card canvas.
 * Original Y-axis fan angles become calibrated 2D rotation; negative Z becomes
 * downward Y. Tucking still uses the original angle, before screen calibration.
 * The separate -7.5 degree Z-axis tilt cannot be projected without the original
 * camera/model and is deliberately not added to the screen-space fan angle.
 * Entries already include arriving cards; do not subtract them as pending draws.
 */
export function layoutHand(
  count: number,
  config: HandLayoutConfig = DEFAULT_HAND_LAYOUT
): readonly HandCardTransform[] {
  if (!Number.isFinite(count) || count < 1) return []
  const n = Math.floor(count)
  const fanned = n > 3
  const spacing = Math.min(config.defaultSpacing, config.width / n)
  const handLift = config.maxHandLift * Math.min(1, Math.max(0, (n - 3) / 3))
  const transforms = Array.from({ length: n }, (_, index): HandCardTransform => {
    const d = index - (n - 1) / 2
    const sourceAngle = fanned
      ? ((40 + 2 * n) * (index / (n - 1) - 0.5) * Math.PI) / 180
      : 0
    const curve = fanned ? (d * d) / (6 * n) : 0
    const tuck = sourceAngle > 0 ? (Math.sin(sourceAngle) * spacing) / 2 : 0
    return {
      x: config.centerX + d * spacing * config.horizontalUnitsToPixels,
      y: config.baselineY - handLift + (curve + tuck) * config.verticalUnitsToPixels,
      rotation: sourceAngle * config.screenRotationMultiplier,
      scale: config.cardScale,
      zIndex: index
    }
  })
  const rightEdge = Math.max(...transforms.map((pose) => handCardBounds(pose).right))
  const shift = Math.min(0, config.safeRightBoundaryX - rightEdge)
  return transforms.map((pose) => ({ ...pose, x: pose.x + shift }))
}

/** All desktop focused cards share one height, regardless of their resting tuck. */
export function handHoverTarget(
  rest: HandCardTransform,
  config: HandLayoutConfig = DEFAULT_HAND_LAYOUT
): HandCardTransform {
  return {
    x: rest.x,
    y: config.baselineY - config.hoverLift,
    rotation: 0,
    scale: config.hoverScale,
    zIndex: ACTIVE_HAND_CARD_DEPTH
  }
}

/** Bounds of the rotated 620 x 900 card about its bottom-center origin. */
export function handCardBounds(pose: HandCardTransform): {
  left: number
  right: number
  top: number
} {
  const halfWidth = (CARD_CANVAS.width * pose.scale) / 2
  const height = CARD_CANVAS.height * pose.scale
  const sin = Math.sin(pose.rotation)
  const cos = Math.cos(pose.rotation)
  const halfX = halfWidth * Math.abs(cos)
  return {
    left: pose.x - halfX + Math.min(0, height * sin),
    right: pose.x + halfX + Math.max(0, height * sin),
    top: pose.y - halfWidth * Math.abs(sin) - Math.max(0, height * cos)
  }
}

/** Screen-space bounds of the hand layer's pointer hit zone. */
export interface HandHoverHitBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Broad bounds cover every rotation; slot hit tests use actual resting bounds. */
export function handHoverHitBounds(config: HandLayoutConfig): HandHoverHitBounds {
  const top =
    config.baselineY -
    config.maxHandLift -
    Math.hypot(CARD_CANVAS.width / 2, CARD_CANVAS.height) * config.cardScale -
    config.hoverEntryMargin
  return { x: 0, y: top, width: 1920, height: 1080 - top }
}

/**
 * Resolves which hand card (if any) is hovered, or null for none.
 *
 * Hit-testing is decoupled from the card sprites: the fan is divided into
 * logical slots using the actual resting x positions and the pointer's x maps
 * directly to a slot, so overlapping art or the wide body of a lifted card
 * can never steal the selection. Which rule applies depends on the
 * pointer's height:
 *
 * - In the *entry strip* (at or below a resting card's top edge plus a small
 *   grace margin) the slot mapping is authoritative — moving along the strip
 *   always switches to the card under the pointer, however tight the fan.
 * - Above the strip, hover clears even over enlarged artwork.
 *
 * All geometry derives from the *resting* transforms and config constants —
 * never from in-flight animations — so hover targets cannot oscillate.
 */
export function resolveHandHover(
  pointer: HandPointer,
  transforms: readonly (HandCardTransform | undefined)[],
  config: HandLayoutConfig
): number | null {
  const cardCount = transforms.length
  if (cardCount === 0) return null

  const slotIndex = resolveSlotIndex(pointer.x, transforms)
  if (slotIndex !== null) {
    const rest = transforms[slotIndex]
    if (rest) {
      const restTop = handCardBounds(rest).top
      if (pointer.y >= restTop - config.hoverEntryMargin) {
        return slotIndex
      }
    }
  }

  return null
}

/**
 * Maps a pointer x to the fan's logical slot, or null when the pointer is
 * outside the hand's horizontal reach. Boundaries are derived from the actual
 * resting transforms so count-dependent hand shifts and any future spread
 * adjustments are shared by rendering and hit testing.
 */
function resolveSlotIndex(
  pointerX: number,
  transforms: readonly (HandCardTransform | undefined)[]
): number | null {
  const cardCount = transforms.length
  if (cardCount === 1) {
    const onlyCard = transforms[0]
    if (!onlyCard) return null
    const bounds = handCardBounds(onlyCard)
    return pointerX >= bounds.left && pointerX <= bounds.right ? 0 : null
  }

  const first = transforms[0]
  const second = transforms[1]
  const last = transforms[cardCount - 1]
  const penultimate = transforms[cardCount - 2]
  if (!first || !second || !last || !penultimate) return null

  const leftSlotBoundary = first.x - (second.x - first.x) / 2
  const rightSlotBoundary = last.x + (last.x - penultimate.x) / 2
  const leftVisibleEdge = handCardBounds(first).left
  const rightVisibleEdge = handCardBounds(last).right
  const leftReach = Math.min(leftSlotBoundary, leftVisibleEdge)
  const rightReach = Math.max(rightSlotBoundary, rightVisibleEdge)
  if (pointerX < leftReach || pointerX > rightReach) return null

  for (let index = 0; index < cardCount - 1; index += 1) {
    const current = transforms[index]
    const next = transforms[index + 1]
    if (!current || !next) return null
    if (pointerX < (current.x + next.x) / 2) return index
  }
  return cardCount - 1
}
