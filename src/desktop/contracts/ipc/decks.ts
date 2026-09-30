import { parseDeck, type Deck, type DeckCreateRequest } from '../../../game-rules/decks'
import { asHeroId } from '../../../game-rules/content/cards'

export const DECK_IPC_CHANNELS = {
  list: 'decks:list',
  create: 'decks:create',
  update: 'decks:update',
  delete: 'decks:delete'
} as const

export interface DecksApi {
  list(): Promise<readonly Deck[]>
  create(request?: DeckCreateRequest): Promise<Deck>
  update(deck: Deck): Promise<Deck>
  delete(deckId: string): Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseDeckCreateRequest(value: unknown): DeckCreateRequest | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('Invalid deck creation request')
  if (value.name !== undefined && typeof value.name !== 'string') {
    throw new Error('Invalid deck creation request name')
  }
  if (
    value.heroId !== undefined &&
    (typeof value.heroId !== 'string' || value.heroId.trim() === '')
  ) {
    throw new Error('Invalid deck creation request heroId')
  }
  return {
    ...(value.name === undefined ? {} : { name: value.name }),
    ...(value.heroId === undefined ? {} : { heroId: asHeroId(value.heroId) })
  }
}

export function parseDeckResponse(value: unknown): Deck {
  return parseDeck(value, 'deck response')
}

export function parseDeckListResponse(value: unknown): readonly Deck[] {
  if (!Array.isArray(value)) throw new Error('Deck list response must be an array')
  return value.map((deck, index) => parseDeckResponseAt(deck, index))
}

function parseDeckResponseAt(value: unknown, index: number): Deck {
  return parseDeck(value, `deck response[${index}]`)
}

export function parseDeckId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error('Invalid deck id')
  return value
}

export type { Deck, DeckCreateRequest } from '../../../game-rules/decks'
