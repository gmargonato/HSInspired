import { asCardId, asHeroId, type CardId } from '../content/cards'
import { HERO_CATALOG } from '../content/heroes'
import { DECK_FILE_VERSION, type Deck, type PersistedDeckFile } from './deck'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

export function parseDeck(value: unknown, path = 'deck'): Deck {
  if (!isRecord(value)) throw new Error(`${path} must be an object`)
  if (typeof value.id !== 'string' || value.id.trim() === '')
    throw new Error(`${path}.id is invalid`)
  if (typeof value.name !== 'string' || value.name.trim() === '')
    throw new Error(`${path}.name is invalid`)
  if (typeof value.heroId !== 'string' || value.heroId.trim() === '')
    throw new Error(`${path}.heroId is required`)
  if (!isRecord(value.cards)) throw new Error(`${path}.cards is invalid`)
  if (!isoDate(value.createdAt) || !isoDate(value.updatedAt))
    throw new Error(`${path} timestamps are invalid`)

  const cards: Record<CardId, number> = {}
  for (const [cardId, count] of Object.entries(value.cards)) {
    if (
      !cardId.trim() ||
      typeof count !== 'number' ||
      !Number.isInteger(count) ||
      count < 1
    ) {
      throw new Error(`${path}.cards.${cardId} is invalid`)
    }
    cards[asCardId(cardId)] = count
  }

  const heroId = asHeroId(value.heroId)
  HERO_CATALOG.require(heroId)

  return {
    id: value.id,
    name: value.name.trim(),
    heroId,
    cards,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  }
}

export function parsePersistedDeckFile(value: unknown): PersistedDeckFile {
  if (
    !isRecord(value) ||
    value.version !== DECK_FILE_VERSION ||
    !Array.isArray(value.decks)
  ) {
    throw new Error(
      `Unsupported deck data format; expected version ${DECK_FILE_VERSION}`
    )
  }
  const decks = value.decks.map((deck, index) => parseDeck(deck, `decks[${index}]`))
  const ids = new Set<string>()
  for (const deck of decks) {
    if (ids.has(deck.id)) throw new Error(`Duplicate deck id: ${deck.id}`)
    ids.add(deck.id)
  }
  return { version: DECK_FILE_VERSION, decks }
}

export function isDeck(value: unknown): value is Deck {
  try {
    parseDeck(value)
    return true
  } catch {
    return false
  }
}
