/** Flight-only geometry in design-canvas pixels; resting placements are unchanged. */
export const CARD_DRAW_LAYOUT = {
  name: 'Card draw flight',
  // Exposed back in deck.png (83 × 181). Gold to its right is stack thickness.
  deckFace: [
    { x: 0, y: 19 },
    { x: 40, y: 9 },
    { x: 42, y: 178 },
    { x: 0, y: 168 }
  ],
  arc: { x: -35, y: -75 },
  perspectiveDepth: 1600,
  pitch: 0.12,
  liftFraction: 0.35
} as const
