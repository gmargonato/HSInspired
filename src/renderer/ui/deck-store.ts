import type { CardDefinition } from '../../game/content/cards'
import type { Deck, DeckCreateRequest, DeckMutationResult } from '../../game/decks'

/** Renderer-facing persistence port; implementation lives in the app root. */
export interface DeckStore {
  load(): Promise<void>
  getDecks(): readonly Deck[]
  getDeck(deckId: string): Deck | undefined
  createDeck(request?: DeckCreateRequest): Promise<Deck>
  updateDeck(deck: Deck): Promise<Deck>
  deleteDeck(deckId: string): Promise<void>
  addCard(deckId: string, card: CardDefinition): Promise<DeckMutationResult>
  removeCard(deckId: string, cardId: string): Promise<DeckMutationResult>
  subscribe(listener: () => void): () => void
}
