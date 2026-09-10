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
  /** Peak rotation (radians) at the outer cards before dense-hand treatment. */
  readonly maxRotation: number
  /** First hand size that receives the dense-hand treatment. */
  readonly denseHandStartCount: number
  /** Hand size at which dense-hand treatment reaches its maximum. */
  readonly denseHandFullCount: number
  /** Peak outer-card rotation for a full dense hand. */
  readonly denseHandMaxRotation: number
  /** Maximum upward lift applied to the complete dense hand. */
  readonly denseHandLift: number
  /** Maximum downward tuck at either outer edge of a full dense hand. */
  readonly denseHandEdgeTuck: number
  /** Resting scale of each hand card. */
  readonly cardScale: number
  /** How far a hovered card lifts above the resting baseline. */
  readonly hoverLift: number
  /** Upward travel after the enlarged card first appears, in design pixels. */
  readonly hoverSettleDistance: number
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
  denseHandStartCount: 6,
  denseHandFullCount: 10,
  denseHandMaxRotation: 0.32,
  denseHandLift: 28,
  denseHandEdgeTuck: 18,
  cardScale: 0.2,
  hoverScale: 0.5,
  safeRightBoundaryX: 1257,
  hoverLift: 120,
  hoverSettleDistance: 20,
  hoverSpread: 45,
  hoverEntryMargin: 15
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
  const denseHandProgress = resolveDenseHandProgress(cardCount, config)
  const outerRotation =
    config.maxRotation +
    (config.denseHandMaxRotation - config.maxRotation) * denseHandProgress
  const centerX = resolveHandCenterX(handSpan, config, outerRotation)
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

    const handLift = config.denseHandLift * denseHandProgress
    const edgeTuck = Math.abs(normalized) * config.denseHandEdgeTuck * denseHandProgress
    return {
      x: centerX + xOffset + neighborOffset,
      y: config.baselineY - handLift + edgeTuck - (isHovered ? config.hoverLift : 0),
      rotation: isHovered ? 0 : normalized * outerRotation,
      scale: isHovered ? config.hoverScale : config.cardScale,
      zIndex: isHovered ? 1000 : index
    }
  })
}

/**
 * Returns the centre of the fan after accounting for the rotated outer card's
 * full painted bounds.
 */
function resolveDenseHandProgress(cardCount: number, config: HandLayoutConfig): number {
  const start = Math.max(1, config.denseHandStartCount)
  const full = Math.max(start, config.denseHandFullCount)
  if (cardCount < start) return 0
  return Math.min(1, (cardCount - start + 1) / (full - start + 1))
}

function resolveHandCenterX(
  handSpan: number,
  config: HandLayoutConfig,
  outerRotation: number
): number {
  const rightExtent = rotatedCardRightExtent(config.cardScale, outerRotation)
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

/** Broad pointer bounds covering resting cards, including the dense-hand lift. */
export function handHoverHitBounds(config: HandLayoutConfig): HandHoverHitBounds {
  const top =
    config.baselineY -
    config.denseHandLift -
    CARD_CANVAS.height * config.cardScale -
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
    const reach = CARD_CANVAS.width * config.cardScale * 0.5
    return Math.abs(pointerX - onlyCard.x) <= reach ? 0 : null
  }

  const first = transforms[0]
  const second = transforms[1]
  const last = transforms[cardCount - 1]
  const penultimate = transforms[cardCount - 2]
  if (!first || !second || !last || !penultimate) return null

  const leftSlotBoundary = first.x - (second.x - first.x) / 2
  const rightSlotBoundary = last.x + (last.x - penultimate.x) / 2
  const leftVisibleEdge =
    first.x - rotatedCardRightExtent(config.cardScale, Math.abs(first.rotation))
  const rightVisibleEdge =
    last.x + rotatedCardRightExtent(config.cardScale, Math.abs(last.rotation))
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
