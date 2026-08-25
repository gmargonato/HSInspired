import { CARD_CANVAS } from '../../rendering/cards/card-layout'

export interface HandLayoutConfig {
  readonly centerX: number
  readonly baselineY: number
  /**
   * Hard maximum width of the hand fan (center-to-center span of the outer
   * cards). Once the natural spacing would exceed it, the cards compress and
   * the gap between them shrinks with every added card.
   */
  readonly span: number
  /** Center-to-center step between neighbours while the hand still fits `span`. */
  readonly maxCardStep: number
  /** Peak rotation (radians) at the outer cards; all cards share one height. */
  readonly maxRotation: number
  /** Resting scale of each hand card. */
  readonly cardScale: number
  /** How far a hovered card lifts above the resting baseline. */
  readonly hoverLift: number
  /** Scale of a hovered (lifted) card. */
  readonly hoverScale: number
  /**
   * Maximum x-coordinate for the painted right edge of the resting hand.
   * Wider hands shift left to stay inside this HUD-safe boundary.
   */
  readonly safeRightBoundaryX: number
  /** Horizontal push applied to neighbours when another card is hovered. */
  readonly hoverSpread: number
  /** Vertical grace in px above a resting card's top edge for hover entry. */
  readonly hoverEntryMargin: number
  /** Extra slack in px around the lifted card's bounds for hover keep-alive. */
  readonly hoverKeepMargin: number
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

export const DEFAULT_HAND_LAYOUT: HandLayoutConfig = {
  centerX: 960,
  // The card origin is its bottom centre. Keep the hand mostly below the
  // viewport, leaving only its upper portion visible until hover.
  baselineY: 1140,
  // Cards overlap at rest: `maxCardStep` steps on ~155px-wide cards leave
  // about 55px of each card exposed. The fan compresses to this maximum width
  // once the natural spacing would exceed it (a ten-card hand ends up ~55px
  // apart, like Hearthstone's full hand). The right edge is clamped just
  // inside the local hero power, before the mana label begins.
  span: 500,
  maxCardStep: 100,
  maxRotation: 0.2,
  cardScale: 0.2,
  hoverScale: 0.5,
  safeRightBoundaryX: 1257,
  hoverLift: 120,
  hoverSpread: 45,
  hoverEntryMargin: 15,
  hoverKeepMargin: 10
}

/**
 * Computes a symmetric fan for any hand size from zero to ten cards. Small
 * hands stay centred; once the fan would cross the HUD-safe right boundary,
 * its centre shifts left while the rightmost card remains anchored.
 */
export function layoutHand(
  count: number,
  config: HandLayoutConfig = DEFAULT_HAND_LAYOUT,
  hoveredIndex: number | null = null
): readonly HandCardTransform[] {
  if (!Number.isFinite(count) || count <= 0) return []

  const cardCount = Math.floor(count)
  const normalizedHover =
    hoveredIndex !== null && hoveredIndex >= 0 && hoveredIndex < cardCount
      ? hoveredIndex
      : null
  const midpoint = (cardCount - 1) / 2
  const handSpan =
    cardCount === 1 ? 0 : Math.min(config.span, (cardCount - 1) * config.maxCardStep)
  const centerX = resolveHandCenterX(handSpan, config)
  const positions =
    cardCount === 1
      ? [0]
      : Array.from({ length: cardCount }, (_, index) => {
          const normalized = (index - midpoint) / midpoint
          return normalized * (handSpan / 2)
        })

  return positions.map((xOffset, index) => {
    const normalized = midpoint === 0 ? 0 : (index - midpoint) / midpoint
    const isHovered = normalizedHover === index
    const neighborOffset =
      normalizedHover === null || isHovered
        ? 0
        : Math.sign(index - normalizedHover) * config.hoverSpread

    return {
      x: centerX + xOffset + neighborOffset,
      y: config.baselineY - (isHovered ? config.hoverLift : 0),
      rotation: isHovered ? 0 : normalized * config.maxRotation,
      scale: isHovered ? config.hoverScale : config.cardScale,
      zIndex: isHovered ? 1000 : index
    }
  })
}

/**
 * Returns the centre of the fan after accounting for the rotated outer card's
 * full painted bounds.
 */
function resolveHandCenterX(handSpan: number, config: HandLayoutConfig): number {
  const rightExtent = rotatedCardRightExtent(config.cardScale, config.maxRotation)
  const maxCenterX = config.safeRightBoundaryX - rightExtent - handSpan / 2
  return Math.min(config.centerX, maxCenterX)
}

/** Horizontal extent from a card's bottom-center origin to its rotated right edge. */
function rotatedCardRightExtent(scale: number, rotation: number): number {
  const width = CARD_CANVAS.width * scale
  const height = CARD_CANVAS.height * scale
  return (
    (width / 2) * Math.abs(Math.cos(rotation)) + height * Math.abs(Math.sin(rotation))
  )
}

/** Screen-space bounds of the hand layer's pointer hit zone. */
export interface HandHoverHitBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Bounds of the hand layer's pointer hit zone on the 1920x1080 canvas. It must
 * cover both the resting strip (where hover may enter) and the tallest lifted
 * card, so the pointer can roam over a hovered card without leaving the zone
 * and dropping the hover.
 */
export function handHoverHitBounds(config: HandLayoutConfig): HandHoverHitBounds {
  const top = Math.min(
    config.baselineY - CARD_CANVAS.height * config.cardScale - config.hoverEntryMargin,
    config.baselineY -
      config.hoverLift -
      CARD_CANVAS.height * config.hoverScale -
      config.hoverKeepMargin
  )
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
 * - Above the strip, hover is retained only while the pointer stays over the
 *   currently lifted card's on-screen body (`isPointerOverLiftedCard`).
 *
 * All geometry derives from the *resting* transforms and config constants —
 * never from in-flight animations — so hover targets cannot oscillate.
 */
export function resolveHandHover(
  pointer: HandPointer,
  transforms: readonly (HandCardTransform | undefined)[],
  config: HandLayoutConfig,
  hoveredIndex: number | null
): number | null {
  const cardCount = transforms.length
  if (cardCount === 0) return null

  const slotIndex = resolveSlotIndex(pointer.x, transforms, config)
  if (slotIndex !== null) {
    const rest = transforms[slotIndex]
    if (rest) {
      const restTop = rest.y - CARD_CANVAS.height * config.cardScale
      if (pointer.y >= restTop - config.hoverEntryMargin) {
        return slotIndex
      }
    }
  }

  if (hoveredIndex !== null) {
    const hovered = transforms[hoveredIndex]
    if (hovered && isPointerOverLiftedCard(pointer, hovered, config)) {
      return hoveredIndex
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
  transforms: readonly (HandCardTransform | undefined)[],
  config: HandLayoutConfig
): number | null {
  const cardCount = transforms.length
  if (cardCount === 1) {
    const onlyCard = transforms[0]
    if (!onlyCard) return null
    return Math.abs(pointerX - onlyCard.x) <= config.maxCardStep / 2 ? 0 : null
  }

  const first = transforms[0]
  const second = transforms[1]
  const last = transforms[cardCount - 1]
  const penultimate = transforms[cardCount - 2]
  if (!first || !second || !last || !penultimate) return null

  const leftReach = first.x - (second.x - first.x) / 2
  const rightReach = last.x + (last.x - penultimate.x) / 2
  if (pointerX < leftReach || pointerX > rightReach) return null

  for (let index = 0; index < cardCount - 1; index += 1) {
    const current = transforms[index]
    const next = transforms[index + 1]
    if (!current || !next) return null
    if (pointerX < (current.x + next.x) / 2) return index
  }
  return cardCount - 1
}

function isPointerOverLiftedCard(
  pointer: HandPointer,
  transform: HandCardTransform,
  config: HandLayoutConfig
): boolean {
  const halfWidth = (CARD_CANVAS.width * config.hoverScale) / 2 + config.hoverKeepMargin
  const bottom = transform.y - config.hoverLift
  const top = bottom - CARD_CANVAS.height * config.hoverScale
  return (
    Math.abs(pointer.x - transform.x) <= halfWidth &&
    pointer.y >= top - config.hoverKeepMargin &&
    pointer.y <= bottom + config.hoverKeepMargin
  )
}
