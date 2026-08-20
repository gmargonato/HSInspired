import type { CardDefinition } from '../../../../game/content/cards'
import type {
  Deck,
  DeckCreateRequest,
  DeckMutationResult
} from '../../../../game/decks'

export interface CollectionDeckPort {
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

/** Collection-facing deck operations kept out of Pixi scene orchestration. */
export class CollectionDeckController implements CollectionDeckPort {
  constructor(
    private readonly store: CollectionDeckPort,
    private readonly confirm: (message: string) => boolean
  ) {}

  load(): Promise<void> {
    return this.store.load()
  }

  getDecks(): readonly Deck[] {
    return this.store.getDecks()
  }

  getDeck(deckId: string): Deck | undefined {
    return this.store.getDeck(deckId)
  }

  createDeck(request?: DeckCreateRequest): Promise<Deck> {
    return this.store.createDeck(request)
  }

  updateDeck(deck: Deck): Promise<Deck> {
    return this.store.updateDeck(deck)
  }

  deleteDeck(deckId: string): Promise<void> {
    return this.store.deleteDeck(deckId)
  }

  addCard(deckId: string, card: CardDefinition): Promise<DeckMutationResult> {
    return this.store.addCard(deckId, card)
  }

  removeCard(deckId: string, cardId: string): Promise<DeckMutationResult> {
    return this.store.removeCard(deckId, cardId)
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  confirmDeckDeletion(deck: Pick<Deck, 'name'>): boolean {
    return this.confirm(`Delete ${deck.name}? This cannot be undone.`)
  }
}
