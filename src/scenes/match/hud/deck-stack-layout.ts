/** Coordinates inside the original 83 x 181 deck image, before board scaling. */
export const DECK_STACK_LAYOUT = {
  name: 'Dynamic deck stack',
  /** Set to 'static' to restore deck.png for both players. */
  mode: 'dynamic' as 'dynamic' | 'static',
  card: { width: 47, height: 180 },
  // Thirty cards occupy the same width as the original painted pile.
  gap: 0.72,
  // A wider seam separates four-card groups without spreading every card apart.
  groupGap: 2.16,
  // Compress larger decks into the same board slot; keep every card represented.
  maxDepth: 36,
  groupSize: 4,
  // Group heights are deterministic; later groups are more likely to shift.
  groupShiftChance: { front: 0.2, rear: 0.95 },
  rearInset: 4,
  groupJitter: 2,
  rearTint: 0xfff9e8
} as const
