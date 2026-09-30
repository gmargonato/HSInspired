/** Feature-local timings make the opening easy to tune without layout edits. */
export const OPENING_TIMING = {
  loadingPanelShrink: 0.2,
  versusReveal: 0.85,
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
  hover: 0.2,
  hoverSettle: 0.1
} as const

/** Sequential Secret reveal, totaling 1.6 seconds before the effect plays. */
export const SECRET_REVEAL_TIMING = {
  bannerGrow: 0.35,
  bannerHold: 0.35,
  bannerFade: 0.1,
  cardGrow: 0.65,
  cardFade: 0.15
} as const

/** Resolution pacing shared by every trigger/death/outcome presentation. */
export const RESOLUTION_TIMING = {
  /** Match the remote deck draw's travel time, without a reveal hold. */
  cardDraw: OPENING_TIMING.cardDeal,
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
  /** Total horizontal flip time for each card replaced by Golden Monkey. */
  handReplacementFlip: 0.3,
  /** Steady vertical departure, followed by a stationary fade. */
  discardFlight: 0.4,
  discardFade: 0.18,
  discardHandSettle: 0.2
} as const

/** Board-only timing knobs for row previews and minion entry presentation. */
export const BOARD_TIMING = {
  /** Pointer dwell before a board information preview opens. */
  previewHoverDelay: 0.6,
  minionSettle: 0.3,
  rowShift: 0.25,
  controlTransfer: 0.4,
  combatWindupPause: 0.08,
  combatLunge: 0.18,
  combatImpact: 0.12,
  combatReturn: 0.2,
  /** Extra time a warped attacker stays on screen so the un-warp reads. */
  combatWarpLinger: 0.15,
  /** Total time for a dying minion's local side-to-side wiggle. */
  minionDeathWiggle: 0.18,
  combatDeath: 0.28,
  characterIndicatorGrow: 0.16,
  characterIndicatorHold: 1,
  characterIndicatorFade: 0.2
} as const

/** Short remote-player beats that keep hidden actions readable to the local player. */
export const REMOTE_TIMING = {
  discoverFade: 0.2,
  discoverSelection: 0.32,
  targetFadeIn: 0.08,
  targetHold: 0.22,
  targetFadeOut: 0.1,
  minionFlight: 0.4,
  minionFlipClose: 0.1,
  minionFlipOpen: 0.2
} as const
