import {
  ARENA_CARD_CHOICE_COUNT,
  ARENA_DECK_ID,
  ARENA_DECK_SIZE,
  ARENA_HERO_CHOICE_COUNT,
  CARD_CATALOG,
  HERO_CATALOG,
  asCardId,
  asHeroId,
  type ArenaMatchResult,
  type ArenaRunSnapshot,
  type CardId,
  type HeroId
} from '../../game'

export const ARENA_IPC_CHANNELS = {
  get: 'arena:get',
  selectHero: 'arena:select-hero',
  pickCard: 'arena:pick-card',
  retire: 'arena:retire',
  recordResult: 'arena:record-result'
} as const

export interface ArenaApi {
  get(): Promise<ArenaRunSnapshot>
  selectHero(heroId: HeroId): Promise<ArenaRunSnapshot>
  pickCard(cardId: CardId): Promise<ArenaRunSnapshot>
  retire(): Promise<ArenaRunSnapshot>
  recordResult(result: ArenaMatchResult): Promise<ArenaRunSnapshot>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseCounter(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${path} is invalid`)
  }
  return value
}

function parseHeroIds(value: unknown): [HeroId, HeroId, HeroId] {
  if (!Array.isArray(value) || value.length !== ARENA_HERO_CHOICE_COUNT) {
    throw new Error('Arena hero choices are invalid')
  }
  const choices = value.map((id) => parseArenaHeroId(id))
  if (new Set(choices).size !== ARENA_HERO_CHOICE_COUNT) {
    throw new Error('Arena hero choices must be distinct')
  }
  return choices as [HeroId, HeroId, HeroId]
}

function parseCardIds(value: unknown): [CardId, CardId, CardId] | null {
  if (value === null) return null
  if (!Array.isArray(value) || value.length !== ARENA_CARD_CHOICE_COUNT) {
    throw new Error('Arena card choices are invalid')
  }
  const choices = value.map((id) => parseArenaCardId(id))
  if (new Set(choices).size !== ARENA_CARD_CHOICE_COUNT) {
    throw new Error('Arena card choices must be distinct')
  }
  const rarity = CARD_CATALOG.require(choices[0]).rarity
  if (choices.some((id) => CARD_CATALOG.require(id).rarity !== rarity)) {
    throw new Error('Arena card choices must share one rarity')
  }
  return choices as [CardId, CardId, CardId]
}

export function parseArenaHeroId(value: unknown): HeroId {
  if (typeof value !== 'string' || !HERO_CATALOG.get(value)?.deckSelectable) {
    throw new Error('Invalid Arena hero id')
  }
  return asHeroId(value)
}

export function parseArenaCardId(value: unknown): CardId {
  if (typeof value !== 'string' || !CARD_CATALOG.get(value)) {
    throw new Error('Invalid Arena card id')
  }
  return asCardId(value)
}

export function parseArenaMatchResult(value: unknown): ArenaMatchResult {
  if (value !== 'win' && value !== 'defeat' && value !== 'draw') {
    throw new Error('Invalid Arena match result')
  }
  return value
}

export function parseArenaRunSnapshot(value: unknown): ArenaRunSnapshot {
  if (!isRecord(value) || value.id !== ARENA_DECK_ID) {
    throw new Error('Invalid Arena run')
  }
  if (
    value.phase !== 'choosing-hero' &&
    value.phase !== 'drafting' &&
    value.phase !== 'ready'
  ) {
    throw new Error('Invalid Arena phase')
  }
  const heroChoices = parseHeroIds(value.heroChoices)
  const heroId = value.heroId === null ? null : parseArenaHeroId(value.heroId)
  const cardChoices = parseCardIds(value.cardChoices)
  if (!isRecord(value.cards)) throw new Error('Arena cards are invalid')
  const cards: Record<string, number> = {}
  const heroClass = heroId ? HERO_CATALOG.require(heroId).classId : null
  for (const [cardId, count] of Object.entries(value.cards)) {
    parseArenaCardId(cardId)
    const definition = CARD_CATALOG.require(cardId)
    if (
      !heroClass ||
      !definition.collectible ||
      !definition.deckLegal ||
      (definition.cardClass !== 'Neutral' && definition.cardClass !== heroClass)
    ) {
      throw new Error(`Arena card ${cardId} is not legal for this hero`)
    }
    cards[cardId] = parseCounter(count, `Arena card ${cardId}`)
    if (cards[cardId] < 1) throw new Error(`Arena card ${cardId} is invalid`)
  }
  const picksCompleted = parseCounter(value.picksCompleted, 'Arena picks')
  const totalCards = Object.values(cards).reduce((sum, count) => sum + count, 0)
  if (picksCompleted !== totalCards || picksCompleted > ARENA_DECK_SIZE) {
    throw new Error('Arena pick total is invalid')
  }
  const gamesPlayed = parseCounter(value.gamesPlayed, 'Arena games')
  const wins = parseCounter(value.wins, 'Arena wins')
  const defeats = parseCounter(value.defeats, 'Arena defeats')
  if (wins + defeats > gamesPlayed) throw new Error('Arena statistics are invalid')
  if (
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.updatedAt))
  ) {
    throw new Error('Arena timestamps are invalid')
  }
  if (
    value.phase === 'choosing-hero' &&
    (heroId || cardChoices || picksCompleted !== 0)
  ) {
    throw new Error('Choosing-hero Arena state is inconsistent')
  }
  if (value.phase === 'drafting' && (!heroId || !cardChoices || picksCompleted >= 30)) {
    throw new Error('Drafting Arena state is inconsistent')
  }
  if (heroClass && cardChoices) {
    for (const cardId of cardChoices) {
      const definition = CARD_CATALOG.require(cardId)
      if (
        !definition.collectible ||
        !definition.deckLegal ||
        (definition.cardClass !== 'Neutral' && definition.cardClass !== heroClass)
      ) {
        throw new Error(`Arena choice ${cardId} is not legal for this hero`)
      }
    }
  }
  if (value.phase === 'ready' && (!heroId || cardChoices || picksCompleted !== 30)) {
    throw new Error('Ready Arena state is inconsistent')
  }
  return {
    id: ARENA_DECK_ID,
    phase: value.phase,
    heroChoices,
    heroId,
    cardChoices,
    cards,
    picksCompleted,
    gamesPlayed,
    wins,
    defeats,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  }
}

export type { ArenaMatchResult, ArenaRunSnapshot } from '../../game'
