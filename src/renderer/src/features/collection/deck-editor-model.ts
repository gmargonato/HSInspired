import type { CardDefinition } from '../../../../game/content/cards'
import { CARD_CATALOG } from '../../../../game/content/cards'
import type { Deck } from '../../../../game/decks'

export interface DeckEditorEntry {
  readonly cardId: string
  readonly count: number
  readonly card: CardDefinition | undefined
}

/** A row only leaves the deck editor when its final copy is removed. */
export function shouldAnimateDeckRowRemoval(copyCount: number): boolean {
  return copyCount === 1
}

/** Builds the stable, cost/name ordered row model used by the deck editor. */
export function buildDeckEditorEntries(
  deck: Pick<Deck, 'cards'>
): readonly DeckEditorEntry[] {
  return Object.entries(deck.cards)
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
