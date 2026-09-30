/** Match shadows: edit here, then reload the match. No assets or animation edits needed. */
export const MATCH_SHADOW_CONFIG = {
  enabled: true,
  /** Separation multiplier; 0 hides shadows, 1 is the normal depth. */
  depth: 1,
  /** Elevation response in milliseconds: smaller is faster, 0 is immediate. */
  responseMs: 80,
  opacity: 0.25,
  /** Slightly denser shadows near the board, fading to normal opacity as they lift. */
  groundOpacityBoost: 0.05,
  /** Sun at the upper right: shadows extend down and left. */
  lightOffset: { x: -0.6, y: 1 },
  /** Softness baked into shared 256px shapes once; 0 gives hard edges. */
  blur: 3,
  restingHeight: 8,
  liftStrength: 120,
  maxHeight: 100,
  /** Inspection zoom should not lift cards higher than a held card. */
  heldCardHeight: 38,
  /** Extra separation only while a hand card is held/dragged. */
  draggedCardDepth: 2.5,
  combatHeight: 26
}
