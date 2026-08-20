import type { CardId, CardRarity, ClassId, HeroId } from '../content/cards'

export const DECK_FILE_VERSION = 2 as const
export const MAX_DECK_CARDS = 30
export const MAX_DECKS = 9
export const MAX_NON_LEGENDARY_COPIES = 2
export const MAX_LEGENDARY_COPIES = 1

export interface Deck {
  readonly id: string
  readonly name: string
  readonly heroId: HeroId
  readonly cards: Readonly<Record<string, number>>
  readonly createdAt: string
  readonly updatedAt: string
}

export interface DeckCreateRequest {
  readonly name?: string
  readonly heroId?: HeroId
}

export interface DeckCardLike {
  readonly id: CardId | string
  readonly rarity: CardRarity | string
  readonly cardClass: ClassId | string
  readonly collectible: boolean
  readonly deckLegal: boolean
}

export interface PersistedDeckFile {
  readonly version: typeof DECK_FILE_VERSION
  readonly decks: readonly Deck[]
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

export function cloneDeck(deck: Deck): Deck {
  return { ...deck, cards: { ...deck.cards } }
}

export function countDeckCards(deck: Pick<Deck, 'cards'>): number {
  return Object.values(deck.cards).reduce((total, count) => total + count, 0)
}

export function getDeckCardCount(
  deck: Pick<Deck, 'cards'>,
  cardId: CardId | string
): number {
  return deck.cards[cardId as CardId] ?? 0
}

export function getCardCopyLimit(card: Pick<DeckCardLike, 'rarity'>): number {
  return card.rarity === 'Legendary' ? MAX_LEGENDARY_COPIES : MAX_NON_LEGENDARY_COPIES
}
