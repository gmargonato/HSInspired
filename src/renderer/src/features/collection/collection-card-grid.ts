export interface CollectionCardGridLayout {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly columns: number
  readonly rows: number
  readonly paddingX: number
  readonly paddingY: number
}

export interface CollectionCardPlacement {
  readonly scale: number
  readonly x: number
  readonly y: number
}

/** Resolves a card's read-only placement inside the current collection page. */
export function getCollectionCardPlacement(
  index: number,
  cardWidth: number,
  cardHeight: number,
  layout: CollectionCardGridLayout
): CollectionCardPlacement {
  const slotWidth = layout.width / layout.columns
  const slotHeight = layout.height / layout.rows
  const column = index % layout.columns
  const row = Math.floor(index / layout.columns)
  const maxWidth = slotWidth - layout.paddingX * 2
  const maxHeight = slotHeight - layout.paddingY * 2
  const scale = Math.min(maxWidth / cardWidth, maxHeight / cardHeight)

  return {
    scale,
    x: layout.x + column * slotWidth + (slotWidth - cardWidth * scale) / 2,
    y: layout.y + row * slotHeight + (slotHeight - cardHeight * scale) / 2
  }
}
