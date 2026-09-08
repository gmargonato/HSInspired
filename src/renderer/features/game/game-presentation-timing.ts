/** Feature-local timings make the opening easy to tune without layout edits. */
export const OPENING_TIMING = {
  versusHold: 2,
  heroSettle: 0.6,
  boardPause: 0.5,
  mulliganFade: 0.3,
  cardDeal: 0.75,
  cardStagger: 0.18,
  localRevealStagger: 0.5,
  playerTwoAnnouncementHold: 0.9,
  playerTwoAnnouncementFade: 0.25,
  playerTwoFourthCard: 0.65,
  replacementPause: 0.25,
  handoffPause: 0.5,
  hover: 0.2
} as const

/** Resolution pacing shared by every trigger/death/outcome presentation. */
export const RESOLUTION_TIMING = {
  /** Full marker pulse for each concrete trigger frame. */
  triggerPulse: 0.6,
  /** Small handoff while a captured death leaves the board. */
  deathCollapse: 0.28,
  /** Deathrattle marker growth/fade before its actions begin. */
  deathrattleGhost: 0.62,
  /** Lets non-combat effect outcomes be read before the next queue item. */
  outcomePause: 0.2,
  /** Impact beat between combat damage and its reactive trigger queue. */
  combatImpactPause: 0.12,
  /** Travel time for a card newly created by an effect. */
  generatedCard: 0.45,
  /** Brief delay before a generated card leaves its source. */
  generatedCardDelay: 0.05,
  /** Downward exit time for each card replaced by Golden Monkey. */
  handReplacementExit: 0.2
} as const

/** Board-only timing knobs for row previews and minion entry presentation. */
export const BOARD_TIMING = {
  minionSettle: 0.3,
  rowShift: 0.25,
  controlTransfer: 0.4,
  combatWindupPause: 0.08,
  combatLunge: 0.18,
  combatImpact: 0.12,
  combatReturn: 0.2,
  combatDeath: 0.28,
  characterIndicatorGrow: 0.16,
  characterIndicatorHold: 1,
  characterIndicatorFade: 0.2
} as const
