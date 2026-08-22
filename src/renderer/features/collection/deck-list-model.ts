import type { Deck } from '../../../game/decks'

export interface CollectionDeckListEntry {
  readonly deck: Deck
  readonly index: number
}

/** Keeps deck-list ordering/indexing separate from Pixi entry construction. */
export function buildCollectionDeckListEntries(
  decks: readonly Deck[]
): readonly CollectionDeckListEntry[] {
  return decks.map((deck, index) => ({ deck, index }))
}
