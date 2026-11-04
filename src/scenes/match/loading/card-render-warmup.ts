import type { Renderer } from 'pixi.js'
import type { CardView } from '../../../visual-components/cards/card-view'

/** Warm the actual opening strings/caches even while their mulligan slots are hidden. */
export function prewarmOpeningCard(renderer: Renderer, card: CardView): void {
  // generateTexture renders this card as its own root, bypassing its alpha-zero
  // slot. Its retained cache survives; the temporary output does not.
  const snapshot = card.createAppearanceSnapshot(renderer)
  snapshot.destroy(true)
}
