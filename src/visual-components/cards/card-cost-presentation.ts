export type CardCostColor = 'normal' | 'reduced' | 'increased'

/** Derives the presentation tint from the authoritative and printed costs. */
export function cardCostColor(baseCost: number, currentCost: number): CardCostColor {
  if (currentCost < baseCost) return 'reduced'
  if (currentCost > baseCost) return 'increased'
  return 'normal'
}
