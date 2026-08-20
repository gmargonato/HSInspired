import { BASIC_CARD_SOURCE } from './sets/basic'
import { CLASSIC_CARD_SOURCE } from './sets/classic'
import { GOBLINS_VS_GNOMES_CARD_SOURCE } from './sets/goblins-vs-gnomes'
import { NAXXRAMAS_CARD_SOURCE } from './sets/naxxramas'
import type { CardDefinition, CardId } from './card-definition'

export class CardCatalog {
  private readonly cardsById: ReadonlyMap<CardId, CardDefinition>

  constructor(cards: readonly CardDefinition[]) {
    const cardsById = new Map<CardId, CardDefinition>()
    for (const card of cards) {
      if (cardsById.has(card.id)) {
        throw new Error(`Duplicate card id: ${card.id}`)
      }
      cardsById.set(card.id, card)
    }
    this.cardsById = cardsById
  }

  get size(): number {
    return this.cardsById.size
  }

  get all(): readonly CardDefinition[] {
    return [...this.cardsById.values()]
  }

  get(id: CardId | string): CardDefinition | undefined {
    return this.cardsById.get(id as CardId)
  }

  require(id: CardId | string): CardDefinition {
    const card = this.get(id)
    if (!card) throw new Error(`Unknown card id: ${id}`)
    return card
  }

  search(query: string): readonly CardDefinition[] {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return this.all

    return this.all.filter(
      (card) =>
        card.id.toLowerCase().includes(normalizedQuery) ||
        card.name.toLowerCase().includes(normalizedQuery) ||
        card.rulesText.toLowerCase().includes(normalizedQuery)
    )
  }
}

export const CARD_SET_SOURCES = [
  BASIC_CARD_SOURCE,
  CLASSIC_CARD_SOURCE,
  GOBLINS_VS_GNOMES_CARD_SOURCE,
  NAXXRAMAS_CARD_SOURCE
] as const

export function createCardCatalog(
  sources: readonly (readonly CardDefinition[])[] = CARD_SET_SOURCES
): CardCatalog {
  return new CardCatalog(sources.flat())
}

export const CARD_CATALOG = createCardCatalog()

export type {
  CardDefinition,
  CardClass,
  CardId,
  CardRarity,
  CardType,
  ClassId,
  DeckClass,
  ExpansionId,
  HeroId,
  HeroPowerId,
  KnownClassId,
  KnownExpansionId,
  MinionCardDefinition,
  SpellCardDefinition,
  WeaponCardDefinition,
  HeroCardDefinition
} from './card-definition'
export {
  CARD_CLASSES,
  CARD_RARITIES,
  CARD_TYPES,
  EXPANSION_IDS,
  PLAYABLE_CLASSES,
  formatExpansionName,
  isCollectibleCard
} from './card-definition'
export {
  ContentValidationError,
  validateCardRecord,
  validateCardSet,
  validateHeroPowerRecord
} from './card-validator'
