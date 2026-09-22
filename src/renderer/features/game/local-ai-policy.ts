/**
 * Compact policy calibration derived from the complete local match-log corpus.
 *
 * The archived corpus contains 186 matches (48 completed, 113 interrupted,
 * 25 abandoned), 3,403 executed AI actions, and 2,430 provider responses.
 * Provider responses averaged 5,424.04 ms, with 915 forced actions and 9
 * timeout fallbacks. It is useful evidence for recurring tactical failures,
 * but its wins and losses are not treated as per-move labels. Hard tactical
 * rules in the evaluator always outrank these soft weights.
 */
export const LOCAL_AI_POLICY = {
  version: 1,
  source: {
    matches: 186,
    completed: 48,
    interrupted: 113,
    abandoned: 25,
    executedActions: 3403,
    providerResponses: 2430,
    localResponses: 50,
    averageProviderResponseMs: 5424.04,
    rejectedResponses: 254,
    intentMismatches: 227,
    otherRejections: 26,
    forcedActions: 915,
    timeoutFallbacks: 9,
    failureSignals: 392,
    executedActionTypes: {
      mulligan: 112,
      endTurn: 876,
      playCard: 1144,
      attack: 913,
      heroPower: 321,
      discover: 37
    }
  },
  weights: {
    terminalWin: 1_000_000,
    terminalLoss: -1_000_000,
    immediateLethal: 300_000,
    preventVisibleLethal: 24_000,
    heroHealth: 7,
    heroArmor: 3,
    boardAttack: 4.8,
    boardHealth: 2.6,
    boardKeyword: 2.5,
    handCard: 3.1,
    manaAvailable: 0.7,
    spentMana: 1.15,
    weaponAttack: 3.2,
    weaponDurability: 1.8,
    secret: 2.4,
    deckCard: 0.12,
    fatigueRisk: 8,
    handOverflow: -6,
    overloadLocked: -2.5,
    enemyBoardRemoval: 9,
    friendlyMinionLoss: -11,
    faceDamage: 5.5,
    endTurnWithMana: -7,
    endTurnWithAction: -18,
    weakRandomLine: -3
  }
} as const

export type LocalAiPolicy = typeof LOCAL_AI_POLICY
