import {
  CARD_CATALOG,
  HERO_CATALOG,
  type CardId,
  type CardCatalog,
  type CardDefinition,
  type HeroCatalog
} from '../content'
import {
  type Deck,
  type DeckCardLike,
  type DeckMutationResult,
  MAX_DECK_CARDS,
  getCardCopyLimit,
  getDeckCardCount
} from './deck'

const NON_COLLECTIBLE_RARITIES = new Set(['None', 'Summon', 'Dream'])

export function isCollectibleDeckCard(
  card: Pick<DeckCardLike, 'rarity' | 'collectible' | 'deckLegal'>
): boolean {
  return (
    card.collectible && card.deckLegal && !NON_COLLECTIBLE_RARITIES.has(card.rarity)
  )
}

export class DeckRules {
  constructor(
    private readonly cards: CardCatalog = CARD_CATALOG,
    private readonly heroes: HeroCatalog = HERO_CATALOG
  ) {}

  getHeroClass(deck: Pick<Deck, 'heroId'>): string {
    return this.heroes.require(deck.heroId).classId
  }

  isCardAllowedInDeck(deck: Pick<Deck, 'heroId'>, card: CardDefinition): boolean {
    if (!isCollectibleDeckCard(card)) return false
    const heroClass = this.getHeroClass(deck)
    return card.cardClass === 'Neutral' || card.cardClass === heroClass
  }

  validate(deck: Deck): readonly string[] {
    const errors: string[] = []
    if (!deck.name.trim()) errors.push('Deck name cannot be empty.')
    if (
      deck.cards &&
      Object.values(deck.cards).some((count) => !Number.isInteger(count) || count < 1)
    ) {
      errors.push('Deck card counts must be positive integers.')
    }
    if (this.cards && this.heroes) {
      for (const [cardId, count] of Object.entries(deck.cards)) {
        const card = this.cards.get(cardId)
        if (!card) {
          errors.push(`Unknown card: ${cardId}`)
          continue
        }
        if (!this.isCardAllowedInDeck(deck, card)) {
          errors.push(`Card ${cardId} is not legal for this hero.`)
        }
        if (count > getCardCopyLimit(card)) {
          errors.push(`Card ${cardId} exceeds its copy limit.`)
        }
      }
    }
    if (
      Object.values(deck.cards).reduce((total, count) => total + count, 0) >
      MAX_DECK_CARDS
    ) {
      errors.push(`A deck cannot contain more than ${MAX_DECK_CARDS} cards.`)
    }
    return errors
  }

  addCardToDeck(
    deck: Deck,
    card: CardDefinition,
    updatedAt = new Date().toISOString()
  ): DeckMutationResult {
    if (!this.isCardAllowedInDeck(deck, card)) {
      return {
        ok: false,
        code: 'card-not-allowed',
        message: `That card cannot be added to a ${this.getHeroClass(deck)} deck.`
      }
    }
    if (
      Object.values(deck.cards).reduce((total, count) => total + count, 0) >=
      MAX_DECK_CARDS
    ) {
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
        cards: { ...deck.cards, [card.id]: currentCopies + 1 },
        updatedAt
      }
    }
  }

  removeCardFromDeck(
    deck: Deck,
    cardId: CardId | string,
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
    if (currentCopies === 1) delete cards[cardId as CardId]
    else cards[cardId as CardId] = currentCopies - 1
    return { ok: true, deck: { ...deck, cards, updatedAt } }
  }
}

export const DECK_RULES = new DeckRules()

export function isCardAllowedInDeck(
  deck: Pick<Deck, 'heroId'>,
  card: CardDefinition
): boolean {
  return DECK_RULES.isCardAllowedInDeck(deck, card)
}

export function addCardToDeck(
  deck: Deck,
  card: CardDefinition,
  updatedAt?: string
): DeckMutationResult {
  return DECK_RULES.addCardToDeck(deck, card, updatedAt)
}

export function removeCardFromDeck(
  deck: Deck,
  cardId: CardId | string,
  updatedAt?: string
): DeckMutationResult {
  return DECK_RULES.removeCardFromDeck(deck, cardId, updatedAt)
}
