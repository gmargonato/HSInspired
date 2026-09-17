import {
  CARD_CATALOG,
  PLAYABLE_CLASSES,
  type CardDefinition,
  type CardId,
  type CardRarity,
  type HeroId
} from '../content/cards'
import { HERO_CATALOG } from '../content/heroes'
import type { Deck } from '../decks'
import { createSeededRng, type DeterministicRng } from '../match'
import { ArenaOpponentPool, arenaRarityTier } from './arena-opponent-pool'
import type { ArenaRewardReceipt } from './arena-rewards'

export const ARENA_DECK_ID = 'arena-deck'
export const ARENA_DECK_SIZE = 30
export const ARENA_HERO_CHOICE_COUNT = 3
export const ARENA_CARD_CHOICE_COUNT = 3
export const ARENA_MAX_WINS = 12
export const ARENA_MAX_DEFEATS = 3
export const ARENA_OPPONENT_RARITY_UPGRADE_CHANCE = 0.2

const opponentPools = new Map<string, ArenaOpponentPool>()

export type ArenaPhase = 'choosing-hero' | 'drafting' | 'ready'
export type ArenaMatchResult = 'win' | 'defeat' | 'draw'
export type ArenaDraftRarity = Extract<
  CardRarity,
  'Free' | 'Common' | 'Rare' | 'Epic' | 'Legendary'
>

export interface ArenaRunSnapshot {
  readonly runId: string
  readonly rewards: ArenaRewardReceipt | null
  readonly id: typeof ARENA_DECK_ID
  readonly phase: ArenaPhase
  readonly heroChoices: readonly [HeroId, HeroId, HeroId]
  readonly heroId: HeroId | null
  readonly cardChoices: readonly [CardId, CardId, CardId] | null
  readonly cards: Readonly<Record<string, number>>
  readonly picksCompleted: number
  readonly gamesPlayed: number
  readonly wins: number
  readonly defeats: number
  readonly createdAt: string
  readonly updatedAt: string
}

export function isArenaRunComplete(
  run: Pick<ArenaRunSnapshot, 'wins' | 'defeats'>
): boolean {
  return run.wins >= ARENA_MAX_WINS || run.defeats >= ARENA_MAX_DEFEATS
}

const RARITY_WEIGHTS: Readonly<Record<ArenaDraftRarity, number>> = {
  Free: 0,
  Common: 0,
  Rare: 20,
  Epic: 9,
  Legendary: 3
}

function takeDistinct<T>(
  values: readonly T[],
  count: number,
  rng: DeterministicRng
): T[] {
  if (values.length < count) throw new Error(`Cannot choose ${count} distinct values.`)
  const pool = [...values]
  const chosen: T[] = []
  while (chosen.length < count) {
    const index = Math.min(Math.floor(rng.next() * pool.length), pool.length - 1)
    chosen.push(pool.splice(index, 1)[0])
  }
  return chosen
}

export function createArenaHeroChoices(
  rng: DeterministicRng
): readonly [HeroId, HeroId, HeroId] {
  const heroes = PLAYABLE_CLASSES.map((classId) => {
    const hero = HERO_CATALOG.getPrimaryForClass(classId)
    if (!hero) throw new Error(`No playable hero is available for ${classId}.`)
    return hero.id
  })
  return takeDistinct(heroes, ARENA_HERO_CHOICE_COUNT, rng) as [HeroId, HeroId, HeroId]
}

export function getArenaCardPool(heroId: HeroId): readonly CardDefinition[] {
  const heroClass = HERO_CATALOG.require(heroId).classId
  return CARD_CATALOG.all.filter(
    (card) =>
      card.collectible &&
      card.deckLegal &&
      (card.cardClass === 'Neutral' || card.cardClass === heroClass) &&
      (card.rarity === 'Free' ||
        card.rarity === 'Common' ||
        card.rarity === 'Rare' ||
        card.rarity === 'Epic' ||
        card.rarity === 'Legendary')
  )
}

function chooseRarity(
  pool: readonly CardDefinition[],
  rng: DeterministicRng
): ArenaDraftRarity {
  const byRarity = new Map<ArenaDraftRarity, number>()
  for (const rarity of ['Free', 'Common', 'Rare', 'Epic', 'Legendary'] as const) {
    byRarity.set(rarity, pool.filter((card) => card.rarity === rarity).length)
  }

  const lowerTierSize = (byRarity.get('Free') ?? 0) + (byRarity.get('Common') ?? 0)
  const weighted: Array<readonly [ArenaDraftRarity, number]> = []
  for (const rarity of ['Free', 'Common'] as const) {
    const size = byRarity.get(rarity) ?? 0
    if (size >= ARENA_CARD_CHOICE_COUNT && lowerTierSize > 0) {
      weighted.push([rarity, 68 * (size / lowerTierSize)])
    }
  }
  for (const rarity of ['Rare', 'Epic', 'Legendary'] as const) {
    if ((byRarity.get(rarity) ?? 0) >= ARENA_CARD_CHOICE_COUNT) {
      weighted.push([rarity, RARITY_WEIGHTS[rarity]])
    }
  }
  const total = weighted.reduce((sum, [, weight]) => sum + weight, 0)
  if (total <= 0) throw new Error('No Arena rarity contains three eligible cards.')
  let roll = rng.next() * total
  for (const [rarity, weight] of weighted) {
    roll -= weight
    if (roll < 0) return rarity
  }
  return weighted[weighted.length - 1][0]
}

export function createArenaCardChoices(
  heroId: HeroId,
  rng: DeterministicRng
): readonly [CardId, CardId, CardId] {
  const pool = getArenaCardPool(heroId)
  const rarity = chooseRarity(pool, rng)
  const ids = pool.filter((card) => card.rarity === rarity).map((card) => card.id)
  return takeDistinct(ids, ARENA_CARD_CHOICE_COUNT, rng) as [CardId, CardId, CardId]
}

export function createArenaOpponentDeck(seed: number, playerDeck: Deck): Deck {
  const slots: CardDefinition[] = []
  for (const cardId of Object.keys(playerDeck.cards).sort()) {
    const count = playerDeck.cards[cardId]
    if (!Number.isInteger(count) || count <= 0 || count > ARENA_DECK_SIZE) {
      throw new Error(`Invalid Arena card count for ${cardId}.`)
    }
    const card = CARD_CATALOG.require(cardId)
    arenaRarityTier(card.rarity)
    if (slots.length + count > ARENA_DECK_SIZE) {
      throw new Error('Arena opponent generation requires a 30-card player deck.')
    }
    for (let copy = 0; copy < count; copy += 1) slots.push(card)
  }
  if (slots.length !== ARENA_DECK_SIZE) {
    throw new Error('Arena opponent generation requires a 30-card player deck.')
  }
  const rng = createSeededRng(seed ^ 0x6172656e)
  const heroChoices = createArenaHeroChoices(rng)
  const heroId = heroChoices[Math.min(Math.floor(rng.next() * 3), 2)]
  const heroClass = HERO_CATALOG.require(heroId).classId
  let pool = opponentPools.get(heroClass)
  if (!pool) {
    pool = new ArenaOpponentPool(getArenaCardPool(heroId))
    opponentPools.set(heroClass, pool)
  }
  const candidateCache = new Map<string, readonly CardDefinition[]>()
  const cards: Record<string, number> = {}
  for (const source of slots) {
    const upgrade = rng.next() < ARENA_OPPONENT_RARITY_UPGRADE_CHANCE
    const cacheKey = `${source.type}:${arenaRarityTier(source.rarity)}:${source.cost}:${upgrade}`
    let choices = candidateCache.get(cacheKey)
    if (!choices) {
      choices = pool.candidates(source, upgrade)
      candidateCache.set(cacheKey, choices)
    }
    const cardId =
      choices[Math.min(Math.floor(rng.next() * choices.length), choices.length - 1)].id
    cards[cardId] = (cards[cardId] ?? 0) + 1
  }
  const timestamp = new Date(0).toISOString()
  return {
    id: `arena-opponent-${seed}`,
    name: 'Arena Opponent',
    heroId,
    cards,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

export function arenaRunToDeck(run: ArenaRunSnapshot): Deck {
  if (run.phase !== 'ready' || !run.heroId || run.picksCompleted !== ARENA_DECK_SIZE) {
    throw new Error('The Arena deck is not ready to play.')
  }
  return {
    id: ARENA_DECK_ID,
    name: 'Arena Deck',
    heroId: run.heroId,
    cards: { ...run.cards },
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  }
}
