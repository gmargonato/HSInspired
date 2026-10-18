/** Match-wide depths, relative to the gameplay container. Child depths stay local. */
export const MATCH_LAYERS = {
  board: 0,
  landingCracks: 5,
  shadows: 10,
  entities: 20,
  opening: 25,
  heroes: 30,
  badges: 35,
  hud: 40,
  historyRail: 45,
  travel: 50,
  summons: 51,
  effects: 52,
  cardPlay: 53,
  discard: 54,
  combat: 55,
  indicators: 56,
  historyPreview: 60,
  boardPreview: 61,
  remotePlayPreview: 62,
  deckInfo: 63,
  deckTracker: 64,
  fatigue: 65,
  secretReveal: 66,
  modalExit: 67,
  remoteHand: 70,
  hand: 71,
  selectedCard: 72,
  // Landing minions can still occupy selectedCard while choosing a Battlecry target.
  landingDust: 73,
  targeting: 74,
  mulligan: 80,
  mulliganTravel: 81,
  mulliganExit: 82,
  cardChoice: 90,
  selection: 91
} as const

/** Relative to the hand container; retained until a returning card has settled. */
export const ACTIVE_HAND_CARD_DEPTH = 1000
