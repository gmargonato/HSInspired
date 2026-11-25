/** Source seconds/angles; projection distances are design-canvas adaptations. */
export const CARD_MOTION_LAYOUT = {
  cameraDepth: 3000,
  cameraSideAngle: -0.22,
  // Full card dimensions at the established local draw's launch scale.
  // The painted deck is a cropped back; its silhouette is not a card rectangle.
  deckCardWidth: 620 * 0.22,
  sourceUnit: 45,
  aboveDeck: { x: -0.3 * 45, y: -3.6 * 45 },
  // Board-space opening; these numbers do not describe deck.png's cropped silhouette.
  slot: {
    // A complete card at table scale, before perspective or clipping.
    fullCardWidth: 620 * 0.27,
    mouthOffset: { x: -40, y: 0 },
    yaw: 69,
    exposedFraction: 0.5,
    approachLift: 18,
    extraction: 0.25,
    mulliganEntry: 0.4,
    revealEntry: 0.25
  },
  remoteDraw: { duration: 1.75, turnStart: 0.8, turnDuration: 0.7 },
  insertion: {
    approach: 0.7,
    descend: 0.7,
    align: 0.2,
    turn: 0.3,
    hiddenTurn: 0.5
  },
  handReturn: { stage: 1.85, stagger: 0.3, grow: 1.5 },
  tradePause: 0.1,
  mulligan: {
    deal: 1.5,
    return: 1.5,
    stagger: 0.5,
    spread: 14 / 15,
    tableDrop: 75,
    tableSpread: 0.72
  },
  deckToPlay: { approach: 0.6, turn: 0.7, flip: 0.35, travelStart: 0.4, travel: 1.6 },
  deckToSecret: { scale: 0.12 },
  fatigue: { travel: 1.2, turnDelay: 0.15, turn: 1.2, grow: 1 },
  revealOnly: { show: 1.2, flip: 0.5, hold: 1.2, hide: 0.8 },
  publicDraw: { show: 1.75, hide: 0.525 },
  // These retain our established reveal placement while changing the transport.
  reveal: { x: 1500, localY: 490, remoteY: 310 }
} as const
