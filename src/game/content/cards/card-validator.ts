import {
  asCardId,
  asClassId,
  asExpansionId,
  CARD_CLASSES,
  CARD_RARITIES,
  CARD_TYPES,
  type CardDefinition,
  type CardRarity,
  type CardType,
  type ExpansionId
} from './card-definition'

export interface RawCardRecord {
  readonly id?: unknown
  readonly name?: unknown
  readonly rarity?: unknown
  readonly cardClass?: unknown
  readonly type?: unknown
  readonly subtype?: unknown
  readonly spellSchool?: unknown
  readonly cost?: unknown
  readonly attack?: unknown
  readonly health?: unknown
  readonly armor?: unknown
  readonly rulesText?: unknown
  readonly collectible?: unknown
  readonly deckLegal?: unknown
}

export interface RawHeroPowerRecord extends RawCardRecord {
  readonly type: 'Hero Power'
}

export class ContentValidationError extends Error {
  readonly path: string

  constructor(path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'ContentValidationError'
    this.path = path
  }
}

const NON_COLLECTIBLE_RARITIES = new Set(['None', 'Summon', 'Dream'])
const NON_COSTED_CARD_IDS = new Set([
  'classic_hogger_smash',
  'classic_millhouse_manastorm'
])

function fail(path: string, message: string): never {
  throw new ContentValidationError(path, message)
}

function recordObject(value: unknown, path: string): RawCardRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(path, 'expected an object')
  }
  return value as RawCardRecord
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    return fail(path, 'expected a non-empty string')
  }
  return value.trim()
}

function optionalString(value: unknown, path: string): string | null {
  if (value === undefined || value === null || value === '') return null
  const normalized = stringValue(value, path)
  return normalized === 'General' ? null : normalized
}

function textValue(value: unknown, path: string): string {
  if (typeof value !== 'string') return fail(path, 'expected text')
  return value
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string
): T {
  const candidate = stringValue(value, path)
  if (!allowed.includes(candidate as T)) {
    return fail(path, `unknown value ${JSON.stringify(candidate)}`)
  }
  return candidate as T
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fail(path, 'expected a finite non-negative number')
  }
  return value
}

function statistic(value: unknown, path: string, required: boolean): number | null {
  if (value === undefined || value === null || value === '') {
    if (required) return fail(path, 'is required for this card type')
    return null
  }
  return finiteNumber(value, path)
}

function booleanValue(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') return fail(path, 'expected a boolean')
  return value
}

function normalizeCost(raw: RawCardRecord, id: string): number {
  if (raw.cost === undefined || raw.cost === null || raw.cost === '') {
    if (NON_COSTED_CARD_IDS.has(id)) return 0
    return fail(`${id}.cost`, 'is required')
  }
  return finiteNumber(raw.cost, `${id}.cost`)
}

function defaultCollectible(_type: CardType, rarity: CardRarity): boolean {
  return !NON_COLLECTIBLE_RARITIES.has(rarity)
}

/** Validates and normalizes one authored card record into the domain union. */
export function validateCardRecord(
  value: unknown,
  expansionId: ExpansionId | string,
  indexOrPath = 'card'
): CardDefinition {
  const raw = recordObject(value, indexOrPath)
  const id = stringValue(raw.id, `${indexOrPath}.id`)
  const type = enumValue(raw.type, CARD_TYPES, `${indexOrPath}.type`)
  const rarity = enumValue(raw.rarity, CARD_RARITIES, `${indexOrPath}.rarity`)
  const cardClass = enumValue(raw.cardClass, CARD_CLASSES, `${indexOrPath}.cardClass`)
  const name = stringValue(raw.name, `${indexOrPath}.name`)
  const rulesText = textValue(raw.rulesText, `${indexOrPath}.rulesText`)
  const cost = normalizeCost(raw, id)
  const subtype = optionalString(raw.subtype, `${indexOrPath}.subtype`)
  const spellSchool = optionalString(raw.spellSchool, `${indexOrPath}.spellSchool`)
  const collectible = booleanValue(
    raw.collectible,
    `${indexOrPath}.collectible`,
    defaultCollectible(type, rarity)
  )
  const deckLegal = booleanValue(
    raw.deckLegal,
    `${indexOrPath}.deckLegal`,
    type !== 'Hero' && collectible
  )

  if (deckLegal && !collectible) {
    return fail(`${indexOrPath}.deckLegal`, 'cannot be true for a non-collectible card')
  }
  if (type === 'Hero' && deckLegal) {
    return fail(`${indexOrPath}.deckLegal`, 'hero cards are not deck cards')
  }

  const metadata = {
    id: asCardId(id),
    expansionId: asExpansionId(String(expansionId)),
    set: asExpansionId(String(expansionId)),
    name,
    rarity,
    cardClass: asClassId(cardClass),
    subtype,
    spellSchool,
    cost,
    rulesText,
    collectible,
    deckLegal
  } as const

  if (type === 'Minion') {
    const attack = statistic(raw.attack, `${indexOrPath}.attack`, true)
    const health = statistic(raw.health, `${indexOrPath}.health`, true)
    if (attack === null || health === null)
      return fail(indexOrPath, 'invalid minion stats')
    if (raw.armor !== undefined && raw.armor !== null) {
      return fail(`${indexOrPath}.armor`, 'is not valid for minions')
    }
    return { ...metadata, type, attack, health }
  }

  if (type === 'Spell') {
    if (raw.attack !== undefined && raw.attack !== null) {
      return fail(`${indexOrPath}.attack`, 'is not valid for spells')
    }
    if (raw.health !== undefined && raw.health !== null) {
      return fail(`${indexOrPath}.health`, 'is not valid for spells')
    }
    if (raw.armor !== undefined && raw.armor !== null) {
      return fail(`${indexOrPath}.armor`, 'is not valid for spells')
    }
    return { ...metadata, type }
  }

  if (type === 'Weapon') {
    const attack = statistic(raw.attack, `${indexOrPath}.attack`, true)
    const durability = statistic(raw.health, `${indexOrPath}.health`, true)
    if (attack === null || durability === null)
      return fail(indexOrPath, 'invalid weapon stats')
    if (raw.armor !== undefined && raw.armor !== null) {
      return fail(`${indexOrPath}.armor`, 'is not valid for weapons')
    }
    return { ...metadata, type, attack, durability }
  }

  const armor = statistic(raw.armor, `${indexOrPath}.armor`, true)
  if (armor === null) return fail(indexOrPath, 'invalid hero stats')
  if (raw.attack !== undefined && raw.attack !== null) {
    return fail(`${indexOrPath}.attack`, 'is not valid for heroes')
  }
  if (raw.health !== undefined && raw.health !== null) {
    return fail(`${indexOrPath}.health`, 'is not valid for heroes')
  }
  return { ...metadata, type, armor }
}

/** Validates one non-card record so hero powers cannot silently enter CardCatalog. */
export function validateHeroPowerRecord(
  value: unknown,
  path = 'hero-power'
): RawHeroPowerRecord {
  const raw = recordObject(value, path)
  if (raw.type !== 'Hero Power') return fail(`${path}.type`, 'expected Hero Power')
  stringValue(raw.id, `${path}.id`)
  stringValue(raw.name, `${path}.name`)
  enumValue(raw.rarity, CARD_RARITIES, `${path}.rarity`)
  enumValue(raw.cardClass, CARD_CLASSES, `${path}.cardClass`)
  textValue(raw.rulesText, `${path}.rulesText`)
  normalizeCost(raw, String(raw.id))
  return raw as RawHeroPowerRecord
}

/** Runs the same record validator used by runtime catalog construction. */
export function validateCardSet(
  value: unknown,
  expansionId: ExpansionId | string,
  sourceName = String(expansionId)
): readonly CardDefinition[] {
  if (!Array.isArray(value)) return fail(sourceName, 'expected an array of records')

  const ids = new Set<string>()
  const cards: CardDefinition[] = []
  value.forEach((record, index) => {
    const raw = recordObject(record, `${sourceName}[${index}]`)
    if (raw.type === 'Hero Power') {
      validateHeroPowerRecord(raw, `${sourceName}[${index}]`)
      return
    }
    const card = validateCardRecord(raw, expansionId, `${sourceName}[${index}]`)
    if (ids.has(card.id))
      return fail(`${sourceName}[${index}].id`, `duplicate id ${card.id}`)
    ids.add(card.id)
    cards.push(card)
  })
  return cards
}
