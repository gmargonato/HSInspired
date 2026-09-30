import { ColorMatrixFilter } from 'pixi.js'

/** Brightness multiplier used to highlight a mana crystal. */
export const MANA_HIGHLIGHT_BRIGHTNESS = 2

/** Creates a fresh brightness filter that highlights a mana crystal. */
export function createManaHighlightFilter(): ColorMatrixFilter {
  const filter = new ColorMatrixFilter()
  filter.brightness(MANA_HIGHLIGHT_BRIGHTNESS, false)
  return filter
}
