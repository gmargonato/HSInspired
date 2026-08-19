export const DECK_FILE_VERSION = 1
export const MAX_DECK_CARDS = 30
export const MAX_DECKS = 9
export const MAX_NON_LEGENDARY_COPIES = 2
export const MAX_LEGENDARY_COPIES = 1
export const DECK_CLASSES = [
  'Warlock',
  'Hunter',
  'Rogue',
  'Warrior',
  'Druid',
  'Paladin',
  'Priest',
  'Mage',
  'Shaman'
] as const
export type DeckClass = (typeof DECK_CLASSES)[number]

/** Rarities used by the source data for cards that cannot be collected. */
export const NON_COLLECTIBLE_RARITIES = ['None', 'Summon', 'Dream'] as const

export const DECK_IPC_CHANNELS = {
  list: 'decks:list',
  create: 'decks:create',
  update: 'decks:update',
  delete: 'decks:delete'
} as const

export interface Deck {
  readonly id: string
  readonly name: string
  readonly heroClass?: DeckClass
  readonly heroId?: string
  readonly cards: Readonly<Record<string, number>>
  readonly createdAt: string
  readonly updatedAt: string
}

export interface DeckCreateRequest {
  readonly name?: string
  readonly heroClass?: DeckClass
  readonly heroId?: string
}

export interface DecksApi {
  list(): Promise<readonly Deck[]>
  create(request?: DeckCreateRequest): Promise<Deck>
  update(deck: Deck): Promise<Deck>
  delete(deckId: string): Promise<void>
}

export interface DeckCardLike {
  readonly id: string
  readonly rarity: string
  /** Optional metadata used to enforce class legality in the renderer. */
  readonly cardClass?: string
  readonly collectible?: boolean
}

export type DeckMutationErrorCode =
  | 'deck-full'
  | 'copy-limit'
  | 'card-not-in-deck'
  | 'card-not-allowed'
  | 'deck-not-found'

export interface DeckMutationFailure {
  readonly ok: false
  readonly code: DeckMutationErrorCode
  readonly message: string
}

export interface DeckMutationSuccess {
  readonly ok: true
  readonly deck: Deck
}

export type DeckMutationResult = DeckMutationFailure | DeckMutationSuccess

export interface PersistedDeckFile {
  readonly version: typeof DECK_FILE_VERSION
  readonly decks: readonly Deck[]
}

export function cloneDeck(deck: Deck): Deck {
  return {
    ...deck,
    cards: { ...deck.cards }
  }
}

export function countDeckCards(deck: Pick<Deck, 'cards'>): number {
  return Object.values(deck.cards).reduce((total, count) => total + count, 0)
}

export function getDeckCardCount(deck: Pick<Deck, 'cards'>, cardId: string): number {
  return deck.cards[cardId] ?? 0
}

export function getCardCopyLimit(card: Pick<DeckCardLike, 'rarity'>): number {
  return card.rarity === 'Legendary' ? MAX_LEGENDARY_COPIES : MAX_NON_LEGENDARY_COPIES
}

export function isCollectibleDeckCard(
  card: Pick<DeckCardLike, 'rarity' | 'collectible'>
): boolean {
  if (card.collectible === false) return false
  return !NON_COLLECTIBLE_RARITIES.includes(
    card.rarity as (typeof NON_COLLECTIBLE_RARITIES)[number]
  )
}

export function isCardAllowedInDeck(
  deck: Pick<Deck, 'heroClass'>,
  card: Pick<DeckCardLike, 'rarity' | 'cardClass' | 'collectible'>
): boolean {
  if (!isCollectibleDeckCard(card)) return false
  if (!deck.heroClass) return true
  if (!card.cardClass) return false
  if (card.cardClass === 'Neutral') return true

  return card.cardClass === deck.heroClass
}

export function addCardToDeck(
  deck: Deck,
  card: DeckCardLike,
  updatedAt = new Date().toISOString()
): DeckMutationResult {
  if (!isCardAllowedInDeck(deck, card)) {
    return {
      ok: false,
      code: 'card-not-allowed',
      message: deck.heroClass
        ? `That card cannot be added to a ${deck.heroClass} deck.`
        : 'That card cannot be added to a deck.'
    }
  }

  const totalCards = countDeckCards(deck)
  if (totalCards >= MAX_DECK_CARDS) {
    return {
      ok: false,
      code: 'deck-full',
      message: `A deck cannot contain more than ${MAX_DECK_CARDS} cards.`
    }
  }

  const currentCopies = getDeckCardCount(deck, card.id)
  const copyLimit = getCardCopyLimit(card)
  if (currentCopies >= copyLimit) {
    return {
      ok: false,
      code: 'copy-limit',
      message:
        card.rarity === 'Legendary'
          ? 'A Legendary card can only have one copy in a deck.'
          : 'A card can only have two copies in a deck.'
    }
  }

  return {
    ok: true,
    deck: {
      ...deck,
      cards: {
        ...deck.cards,
        [card.id]: currentCopies + 1
      },
      updatedAt
    }
  }
}

export function removeCardFromDeck(
  deck: Deck,
  cardId: string,
  updatedAt = new Date().toISOString()
): DeckMutationResult {
  const currentCopies = getDeckCardCount(deck, cardId)
  if (currentCopies === 0) {
    return {
      ok: false,
      code: 'card-not-in-deck',
      message: 'That card is not in the deck.'
    }
  }

  const cards = { ...deck.cards }
  if (currentCopies === 1) {
    delete cards[cardId]
  } else {
    cards[cardId] = currentCopies - 1
  }

  return {
    ok: true,
    deck: {
      ...deck,
      cards,
      updatedAt
    }
  }
}
