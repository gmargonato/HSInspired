import basicCards from '../src/data/cards/basic.json'
import classicCards from '../src/data/cards/classic.json'
import { isCollectibleDeckCard } from '../src/shared/decks'

/** Card types that can be collected and rendered as cards. */
export const CARD_TYPES = ['Minion', 'Spell', 'Weapon', 'Hero'] as const
export type CardType = (typeof CARD_TYPES)[number]

export const CARD_CLASSES = [
  'Druid',
  'Hunter',
  'Mage',
  'Neutral',
  'Paladin',
  'Priest',
  'Rogue',
  'Shaman',
  'Warlock',
  'Warrior',
  'Deathknight'
] as const
export type CardClass = (typeof CARD_CLASSES)[number]

export const CARD_RARITIES = [
  'Common',
  'Rare',
  'Epic',
  'Legendary',
  'Free',
  'None',
  'Summon',
  'Dream'
] as const
export type CardRarity = (typeof CARD_RARITIES)[number]

/**
 * Set identifiers are intentionally open-ended so future expansion files can
 * be added without changing the card renderer's domain model.
 */
export type CardSet = 'basic' | 'classic' | (string & {})

export const CARD_SET_LABELS: Readonly<Record<string, string>> = {
  basic: 'Basic',
  classic: 'Classic',
  goblins_vs_gnomes: 'Goblins vs Gnomes',
  naxxramas: 'Curse of Naxxramas'
}

export function formatCardSetName(set: CardSet): string {
  const knownLabel = CARD_SET_LABELS[set]
  if (knownLabel) return knownLabel

  return set
    .split(/[_-]+/u)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export interface CardDefinition {
  readonly id: string
  readonly set: CardSet
  readonly name: string
  readonly rarity: CardRarity
  readonly cardClass: CardClass
  readonly type: CardType
  readonly subtype: string | null
  readonly spellSchool: string | null
  readonly cost: number
  readonly attack: number | null
  readonly health: number | null
  readonly armor: number | null
  readonly durability: number | null
  readonly effect: string
}

export function isCollectibleCard(card: Pick<CardDefinition, 'rarity'>): boolean {
  return isCollectibleDeckCard(card)
}

interface RawCardRecord {
  id?: unknown
  name?: unknown
  rarity?: unknown
  cardClass?: unknown
  type?: unknown
  subtype?: unknown
  spellSchool?: unknown
  cost?: unknown
  attack?: unknown
  health?: unknown
  armor?: unknown
  effect?: unknown
}

function readString(value: unknown, field: string, idHint = 'unknown card'): string {
  if (typeof value !== 'string') {
    throw new Error(`Card ${idHint} has an invalid ${field}`)
  }
  return value
}

function readNumber(value: unknown, field: string, idHint: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Card ${idHint} has an invalid ${field}`)
  }
  return value
}

function readCost(value: unknown, idHint: string): number {
  // A few non-collectible Classic token records omit cost. Treat them as
  // zero-cost display data while keeping the rest of the card definition
  // available to the lab.
  if (value === null || value === undefined || value === '') return 0
  return readNumber(value, 'cost', idHint)
}

function readNullableNumber(
  value: unknown,
  field: string,
  idHint: string
): number | null {
  if (value === null || value === undefined || value === '') return null
  return readNumber(value, field, idHint)
}

function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  idHint: string,
  fallback?: T
): T {
  if (typeof value === 'string' && allowed.includes(value as T)) {
    return value as T
  }
  if (
    fallback !== undefined &&
    (value === '' || value === null || value === undefined)
  ) {
    return fallback
  }
  throw new Error(`Card ${idHint} has an invalid ${field}`)
}

function readSubtype(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '' || value === 'General')
    return null
  return value
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  return value.trim()
}

export function normalizeCard(raw: RawCardRecord, set: CardSet): CardDefinition {
  const id = readString(raw.id, 'id')
  const name = readString(raw.name, 'name', id)
  const type = readEnum(raw.type, CARD_TYPES, 'type', id)
  const health = readNullableNumber(raw.health, 'health', id)
  const armor = readNullableNumber(raw.armor, 'armor', id)
  const attack = readNullableNumber(raw.attack, 'attack', id)

  return {
    id,
    set,
    name,
    rarity: readEnum(raw.rarity, CARD_RARITIES, 'rarity', id, 'None'),
    cardClass: readEnum(raw.cardClass, CARD_CLASSES, 'cardClass', id),
    type,
    subtype: readSubtype(raw.subtype),
    spellSchool: readOptionalString(raw.spellSchool),
    cost: readCost(raw.cost, id),
    attack: type === 'Hero' ? null : attack,
    health: type === 'Minion' ? health : null,
    armor: type === 'Hero' ? armor : null,
    durability: type === 'Weapon' ? health : null,
    effect: typeof raw.effect === 'string' ? raw.effect : ''
  }
}

function normalizeSet(
  records: readonly RawCardRecord[],
  set: CardSet
): CardDefinition[] {
  // Hero Powers are game content, but they are not cards and therefore do not
  // belong in the card catalog. Keep their source records available for a
  // future dedicated hero-power catalog without pretending they use a card
  // frame or a card type.
  return records
    .filter((record) => record.type !== 'Hero Power')
    .map((record) => normalizeCard(record, set))
}

export class CardCatalog {
  private readonly cardsById: ReadonlyMap<string, CardDefinition>

  constructor(cards: readonly CardDefinition[]) {
    const cardsById = new Map<string, CardDefinition>()
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

  get(id: string): CardDefinition | undefined {
    return this.cardsById.get(id)
  }

  require(id: string): CardDefinition {
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
        card.name.toLowerCase().includes(normalizedQuery)
    )
  }
}

export function createCardCatalog(): CardCatalog {
  const basic = normalizeSet(basicCards as unknown as RawCardRecord[], 'basic')
  const classic = normalizeSet(classicCards as unknown as RawCardRecord[], 'classic')
  return new CardCatalog([...basic, ...classic])
}

export const CARD_CATALOG = createCardCatalog()
