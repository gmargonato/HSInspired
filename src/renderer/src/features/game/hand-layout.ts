export interface HandLayoutConfig {
  readonly centerX: number
  readonly baselineY: number
  readonly span: number
  /** Maximum center-to-center spacing as the hand grows. */
  readonly maxCardStep: number
  readonly arcHeight: number
  readonly maxRotation: number
  readonly cardScale: number
  readonly hoverLift: number
  readonly hoverScale: number
  readonly hoverSpread: number
}

export interface HandCardTransform {
  readonly x: number
  readonly y: number
  readonly rotation: number
  readonly scale: number
  readonly zIndex: number
}

export const DEFAULT_HAND_LAYOUT: HandLayoutConfig = {
  centerX: 960,
  // The card origin is its bottom centre. Keep the hand mostly below the
  // viewport, leaving only its upper portion visible until hover.
  baselineY: 1220,
  span: 952,
  maxCardStep: 105,
  arcHeight: 38,
  maxRotation: 0.16,
  cardScale: 0.24,
  hoverLift: 155,
  hoverScale: 0.3,
  hoverSpread: 44
}

/** Computes a symmetric fan for any hand size from zero to ten cards. */
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
  const positions =
    cardCount === 1
      ? [0]
      : Array.from({ length: cardCount }, (_, index) => {
          const normalized = (index - midpoint) / Math.max(1, midpoint)
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
      x: config.centerX + xOffset + neighborOffset,
      y:
        config.baselineY -
        config.arcHeight * (1 - normalized * normalized) -
        (isHovered ? config.hoverLift : 0),
      rotation: isHovered ? 0 : normalized * config.maxRotation,
      scale: isHovered ? config.hoverScale : config.cardScale,
      zIndex: isHovered ? 1000 : index
    }
  })
}
