import type { OpeningCard } from '../../../game-rules/match'
import type { GameCardSlot } from './game-card-slot'
import type { HandCardTransform } from './hand-layout'

export interface HandEntry {
  card: OpeningCard
  slot: GameCardSlot
  /**
   * Resting transform (no hover applied). Set by `applyHandLayout` after every
   * structural change (deal, mulligan resolve, draw) and read by `applyHoverDelta`
   * to compute hover targets without re-running `layoutHand`.
   */
  restTransform: HandCardTransform | undefined
  /**
   * True while the card is at a non-rest position due to hover. Cleared by
   * `applyHandLayout`. Used by `applyHoverDelta` to skip cards that are at rest
   * and should not be touched (the common case — only one card is hovered).
   */
  displaced: boolean
}
