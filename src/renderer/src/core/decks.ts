import type { CardDefinition } from '../../../../card-lab/card-catalog'
import {
  addCardToDeck,
  cloneDeck,
  MAX_DECKS,
  removeCardFromDeck,
  type Deck,
  type DeckCreateRequest,
  type DeckMutationResult,
  type DecksApi
} from '../../../shared/decks'

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

function getDeckApi(): DecksApi {
  if (typeof window === 'undefined' || !window.api?.decks) {
    throw new Error('Deck persistence is unavailable outside the Electron renderer')
  }
  return window.api.decks
}

/** Renderer cache and command gateway for the persisted player decks. */
export class PersistentDeckStore implements DeckStore {
  private decks: Deck[] = []
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private mutationQueue: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly apiProvider: () => DecksApi = getDeckApi) {}

  async load(): Promise<void> {
    if (this.loaded) return
    if (this.loadPromise) return this.loadPromise

    this.loadPromise = this.apiProvider()
      .list()
      .then((decks) => {
        this.decks = decks.map(cloneDeck)
        this.loaded = true
        this.notify()
      })
      .finally(() => {
        this.loadPromise = null
      })

    return this.loadPromise
  }

  getDecks(): readonly Deck[] {
    return this.decks.map(cloneDeck)
  }

  getDeck(deckId: string): Deck | undefined {
    const deck = this.decks.find((candidate) => candidate.id === deckId)
    return deck ? cloneDeck(deck) : undefined
  }

  createDeck(request?: DeckCreateRequest): Promise<Deck> {
    return this.enqueue(async () => {
      await this.load()

      if (this.decks.length >= MAX_DECKS) {
        throw new Error(`You can have at most ${MAX_DECKS} decks.`)
      }

      const deck = await this.apiProvider().create(request)
      this.decks.push(cloneDeck(deck))
      this.notify()
      return cloneDeck(deck)
    })
  }

  updateDeck(deck: Deck): Promise<Deck> {
    return this.enqueue(async () => {
      await this.load()
      const savedDeck = await this.apiProvider().update(deck)
      const index = this.decks.findIndex((candidate) => candidate.id === deck.id)
      if (index === -1) {
        this.decks.push(cloneDeck(savedDeck))
      } else {
        this.decks[index] = cloneDeck(savedDeck)
      }
      this.notify()
      return cloneDeck(savedDeck)
    })
  }

  deleteDeck(deckId: string): Promise<void> {
    return this.enqueue(async () => {
      await this.load()
      await this.apiProvider().delete(deckId)
      this.decks = this.decks.filter((deck) => deck.id !== deckId)
      this.notify()
    })
  }

  addCard(deckId: string, card: CardDefinition): Promise<DeckMutationResult> {
    return this.enqueue(async () => {
      await this.load()
      const deck = this.decks.find((candidate) => candidate.id === deckId)
      if (!deck) {
        return {
          ok: false,
          code: 'deck-not-found',
          message: 'The selected deck no longer exists.'
        }
      }

      const result = addCardToDeck(deck, card)
      if (!result.ok) return result

      const savedDeck = await this.apiProvider().update(result.deck)
      this.replaceDeck(savedDeck)
      this.notify()
      return { ok: true, deck: cloneDeck(savedDeck) }
    })
  }

  removeCard(deckId: string, cardId: string): Promise<DeckMutationResult> {
    return this.enqueue(async () => {
      await this.load()
      const deck = this.decks.find((candidate) => candidate.id === deckId)
      if (!deck) {
        return {
          ok: false,
          code: 'deck-not-found',
          message: 'The selected deck no longer exists.'
        }
      }

      const result = removeCardFromDeck(deck, cardId)
      if (!result.ok) return result

      const savedDeck = await this.apiProvider().update(result.deck)
      this.replaceDeck(savedDeck)
      this.notify()
      return { ok: true, deck: cloneDeck(savedDeck) }
    })
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private replaceDeck(deck: Deck): void {
    const index = this.decks.findIndex((candidate) => candidate.id === deck.id)
    if (index === -1) {
      this.decks.push(cloneDeck(deck))
    } else {
      this.decks[index] = cloneDeck(deck)
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.error('Deck store listener failed:', error)
      }
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(operation, operation)
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }
}

export const playerDeckStore: DeckStore = new PersistentDeckStore()
