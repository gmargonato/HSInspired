import {
  CARD_CATALOG,
  type ArenaRunSnapshot,
  type CardDefinition
} from '../../game-rules'

export interface ArenaDeckEntry {
  readonly card: CardDefinition
  readonly count: number
}

export function buildArenaDeckEntries(
  run: ArenaRunSnapshot
): readonly ArenaDeckEntry[] {
  return Object.entries(run.cards)
    .map(([cardId, count]) => ({ card: CARD_CATALOG.require(cardId), count }))
    .sort(
      (left, right) =>
        left.card.cost - right.card.cost ||
        left.card.name.localeCompare(right.card.name)
    )
}

export function buildArenaManaCurve(run: ArenaRunSnapshot): readonly number[] {
  const counts = Array.from({ length: 8 }, () => 0)
  for (const [cardId, copies] of Object.entries(run.cards)) {
    const cost = CARD_CATALOG.require(cardId).cost
    counts[Math.min(7, Math.max(0, cost))] += copies
  }
  return counts
}
