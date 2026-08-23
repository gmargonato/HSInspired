import type { CardDefinition } from '../../../game/content/cards'
import { CARD_CATALOG } from '../../../game/content/cards'
import type { OpeningCard } from '../../../game/match'

export interface DeckTrackerEntry {
  readonly cardId: OpeningCard['cardId']
  readonly count: number
  readonly card: CardDefinition | undefined
}

/** Builds the stable, grouped cost/name ordering shown by the match tracker. */
export function buildDeckTrackerEntries(
  deck: readonly OpeningCard[]
): readonly DeckTrackerEntry[] {
  const counts = new Map<OpeningCard['cardId'], number>()
  for (const card of deck) {
    counts.set(card.cardId, (counts.get(card.cardId) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([cardId, count]) => ({
      cardId,
      count,
      card: CARD_CATALOG.get(cardId)
    }))
    .sort((left, right) => {
      const costDifference = (left.card?.cost ?? 0) - (right.card?.cost ?? 0)
      if (costDifference !== 0) return costDifference

      const nameDifference = (left.card?.name ?? left.cardId).localeCompare(
        right.card?.name ?? right.cardId
      )
      return nameDifference !== 0
        ? nameDifference
        : left.cardId.localeCompare(right.cardId)
    })
}
