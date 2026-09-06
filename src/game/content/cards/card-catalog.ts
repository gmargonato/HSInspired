import { BASIC_CARD_SOURCE } from './sets/basic'
import { BLACKROCK_MOUNTAIN_CARD_SOURCE } from './sets/blackrock-mountain'
import { CLASSIC_CARD_SOURCE } from './sets/classic'
import { GOBLINS_VS_GNOMES_CARD_SOURCE } from './sets/goblins-vs-gnomes'
import { LEAGUE_OF_EXPLORERS_CARD_SOURCE } from './sets/league-of-explorers'
import { NAXXRAMAS_CARD_SOURCE } from './sets/naxxramas'
import { THE_GRAND_TOURNAMENT_CARD_SOURCE } from './sets/the-grand-tournament'
import type { CardDefinition, CardId } from './card-definition'
import { GENERATED_CARD_DEFINITIONS } from './generated-card-definitions'

function referencedCardIds(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.flatMap(referencedCardIds)
  if (typeof value !== 'object' || value === null) return []

  const record = value as Record<string, unknown>
  const nested = Object.entries(record).flatMap(([key, nestedValue]) => {
    if (key === 'pool' && Array.isArray(nestedValue)) {
      return nestedValue.flatMap((entry) =>
        typeof entry === 'string' ? [entry] : referencedCardIds(entry)
      )
    }
    return referencedCardIds(nestedValue)
  })
  const references = [
    typeof record['cardId'] === 'string' ? record['cardId'] : null,
    typeof record['presentationCardId'] === 'string'
      ? record['presentationCardId']
      : null,
    typeof record['excludeCardId'] === 'string' ? record['excludeCardId'] : null
  ].filter((reference): reference is string => reference !== null)
  return [...references, ...nested]
}

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
    for (const card of cards) {
      for (const referencedCardId of referencedCardIds(card.effects ?? [])) {
        if (!cardsById.has(referencedCardId as CardId)) {
          throw new Error(
            `Unknown card id ${referencedCardId} referenced by ${card.id}`
          )
        }
      }
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
  NAXXRAMAS_CARD_SOURCE,
  BLACKROCK_MOUNTAIN_CARD_SOURCE,
  LEAGUE_OF_EXPLORERS_CARD_SOURCE,
  THE_GRAND_TOURNAMENT_CARD_SOURCE
] as const

export function createCardCatalog(
  sources: readonly (readonly CardDefinition[])[] = [
    ...CARD_SET_SOURCES,
    GENERATED_CARD_DEFINITIONS
  ]
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
