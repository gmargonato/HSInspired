import type { CardDefinition } from '../../../game-rules/content/cards'
import { CARD_CATALOG } from '../../../game-rules/content/cards'
import type { OpeningCard } from '../../../game-rules/match'

export interface DeckTrackerEntry {
  readonly cardId: OpeningCard['cardId']
  readonly count: number
  readonly card: CardDefinition | undefined
  readonly drawPosition?: number
}

export type DeckTrackerSortMode = 'cost' | 'alphabetical' | 'draw-order'

/** Builds the stable, grouped cost/name ordering shown by the match tracker. */
export function buildDeckTrackerEntries(
  deck: readonly OpeningCard[],
  sortMode: DeckTrackerSortMode = 'cost'
): readonly DeckTrackerEntry[] {
  if (sortMode === 'draw-order') {
    return deck.map((card, index) => ({
      cardId: card.cardId,
      count: 1,
      card: CARD_CATALOG.get(card.cardId),
      drawPosition: index + 1
    }))
  }
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
      if (sortMode === 'alphabetical') {
        const nameDifference = (left.card?.name ?? left.cardId).localeCompare(
          right.card?.name ?? right.cardId
        )
        return nameDifference !== 0
          ? nameDifference
          : left.cardId.localeCompare(right.cardId)
      }
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
