import { describe, expect, it } from 'vitest'
import { CARD_CATALOG, HERO_CATALOG, asCardId, type CardDefinition } from '../content'
import type { Deck } from '../decks'
import { ArenaOpponentPool } from './arena-opponent-pool'
import { countDeckCards } from '../decks'
import { createSeededRng } from '../match'
import { createArenaRewards, ARENA_REWARD_TIERS } from './arena-rewards'
import {
  ARENA_DECK_ID,
  ARENA_MAX_DEFEATS,
  ARENA_MAX_WINS,
  arenaRunToDeck,
  createArenaCardChoices,
  createArenaHeroChoices,
  createArenaOpponentDeck,
  isArenaRunComplete,
  type ArenaRunSnapshot
} from './arena'

function playerDeck(cards: Record<string, number> = { basic_fireball: 30 }): Deck {
  return {
    id: 'player',
    name: 'Player',
    heroId: HERO_CATALOG.require('jaina').id,
    cards,
    createdAt: '',
    updatedAt: ''
  }
}

function fixture(
  id: string,
  cost: number,
  rarity: CardDefinition['rarity'],
  type: CardDefinition['type'] = 'Minion'
): CardDefinition {
  const base = CARD_CATALOG.require('basic_fireball')
  const metadata = { ...base, id: asCardId(id), cost, rarity }
  switch (type) {
    case 'Minion':
      return { ...metadata, type, attack: 1, health: 1 }
    case 'Weapon':
      return { ...metadata, type, attack: 1, durability: 1 }
    case 'Hero':
      return {
        ...metadata,
        type,
        armor: 0,
        replacementHeroId: HERO_CATALOG.require('jaina').id
      }
    case 'Spell':
      return { ...metadata, type }
  }
}

describe('Arena draft generation', () => {
  it('offers three distinct playable heroes', () => {
    const choices = createArenaHeroChoices(createSeededRng(7))
    expect(new Set(choices)).toHaveLength(3)
    expect(choices.every((id) => HERO_CATALOG.require(id).deckSelectable)).toBe(true)
  })

  it('offers three distinct legal cards of one rarity', () => {
    const heroId = HERO_CATALOG.require('jaina').id
    const heroClass = HERO_CATALOG.require(heroId).classId
    const rng = createSeededRng(19)

    for (let index = 0; index < 100; index += 1) {
      const choices = createArenaCardChoices(heroId, rng)
      const cards = choices.map((id) => CARD_CATALOG.require(id))
      expect(new Set(choices)).toHaveLength(3)
      expect(new Set(cards.map((card) => card.rarity))).toHaveLength(1)
      expect(
        cards.every(
          (card) =>
            card.collectible &&
            card.deckLegal &&
            (card.cardClass === 'Neutral' || card.cardClass === heroClass)
        )
      ).toBe(true)
    }
  })

  it('generates a complete temporary opponent deck', () => {
    const deck = createArenaOpponentDeck(42, playerDeck())
    expect(countDeckCards(deck)).toBe(30)
    expect(deck.id).toBe('arena-opponent-42')
  })

  it('adapts a ready run without constructed copy-limit validation', () => {
    const timestamp = new Date(0).toISOString()
    const run: ArenaRunSnapshot = {
      runId: 'test-run',
      rewards: null,
      id: ARENA_DECK_ID,
      phase: 'ready',
      heroChoices: [
        HERO_CATALOG.require('jaina').id,
        HERO_CATALOG.require('guldan').id,
        HERO_CATALOG.require('rexxar').id
      ],
      heroId: HERO_CATALOG.require('jaina').id,
      cardChoices: null,
      cards: { basic_arcane_missiles: 30 },
      picksCompleted: 30,
      gamesPlayed: 0,
      wins: 0,
      defeats: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    expect(arenaRunToDeck(run).cards.basic_arcane_missiles).toBe(30)
  })
})

describe('Arena opponent composition', () => {
  it('matches type, tier and printed cost, merging Free and Common', () => {
    const common = fixture('common', 4, 'Common')
    const free = fixture('free', 4, 'Free')
    const pool = new ArenaOpponentPool([
      common,
      free,
      fixture('wrong-type', 4, 'Common', 'Spell'),
      fixture('wrong-cost', 5, 'Common')
    ])
    expect(pool.candidates(common, false)).toEqual([common, free])
  })

  it('upgrades one tier, preserves Legendary, and falls back to the original tier', () => {
    const cards = ['Common', 'Rare', 'Epic', 'Legendary'].map((rarity, i) =>
      fixture(`tier-${i}`, 4, rarity as CardDefinition['rarity'])
    )
    const pool = new ArenaOpponentPool(cards)
    cards.forEach((card, index) =>
      expect(pool.candidates(card, true)).toEqual([cards[Math.min(index + 1, 3)]])
    )
    expect(new ArenaOpponentPool([cards[0]]).candidates(cards[0], true)).toEqual([
      cards[0]
    ])
  })

  it('relaxes cost before rarity and keeps equally close costs', () => {
    const source = fixture('source', 4, 'Rare')
    const low = fixture('low', 3, 'Rare')
    const high = fixture('high', 5, 'Rare')
    expect(
      new ArenaOpponentPool([low, high, fixture('other-tier', 4, 'Epic')]).candidates(
        source,
        false
      )
    ).toEqual([low, high])
  })

  it('preserves type before rarity and breaks rarity ties downward', () => {
    const source = fixture('source', 4, 'Rare', 'Weapon')
    const low = fixture('low', 6, 'Common', 'Weapon')
    const high = fixture('high', 4, 'Epic', 'Weapon')
    expect(
      new ArenaOpponentPool([
        low,
        high,
        fixture('spell', 4, 'Rare', 'Spell')
      ]).candidates(source, false)
    ).toEqual([low])
  })

  it('relaxes missing weapon and hero types and rejects empty pools', () => {
    const replacement = fixture('replacement', 4, 'Rare')
    const pool = new ArenaOpponentPool([replacement])
    for (const type of ['Weapon', 'Hero'] as const) {
      expect(pool.candidates(fixture('source', 4, 'Common', type), true)).toEqual([
        replacement
      ])
    }
    expect(() => new ArenaOpponentPool([])).toThrow()
  })

  it('is deterministic across input order and warm caches without mutating the player', () => {
    const first = playerDeck({ basic_fireball: 15, basic_arcane_missiles: 15 })
    const before = JSON.stringify(first)
    const result = createArenaOpponentDeck(923, first)
    expect(
      createArenaOpponentDeck(
        923,
        playerDeck({ basic_arcane_missiles: 15, basic_fireball: 15 })
      )
    ).toEqual(result)
    expect(JSON.stringify(first)).toBe(before)
  })

  it('generates legal decks across every playable opponent class', () => {
    const classes = new Set<string>()
    const signatures = new Set<string>()
    for (let seed = 0; seed < 200; seed += 1) {
      const deck = createArenaOpponentDeck(seed, playerDeck())
      const heroClass = HERO_CATALOG.require(deck.heroId).classId
      classes.add(heroClass)
      signatures.add(JSON.stringify(deck.cards))
      expect(countDeckCards(deck)).toBe(30)
      for (const id of Object.keys(deck.cards)) {
        const card = CARD_CATALOG.require(id)
        expect(card.collectible && card.deckLegal).toBe(true)
        expect(['Neutral', heroClass]).toContain(card.cardClass)
      }
    }
    expect(classes.size).toBe(9)
    expect(signatures.size).toBeGreaterThan(1)
  })

  it('rejects malformed source decks', () => {
    const invalidDecks: Record<string, number>[] = [
      { basic_fireball: 29 },
      { basic_fireball: 31 },
      { basic_fireball: 1.5 },
      { basic_fireball: 0 },
      { basic_fireball: -1 },
      { missing_card: 30 }
    ]
    for (const cards of invalidDecks) {
      expect(() => createArenaOpponentDeck(42, playerDeck(cards))).toThrow()
    }
  })
})

describe('Arena run completion', () => {
  it('ends at twelve wins or three defeats', () => {
    expect(isArenaRunComplete({ wins: ARENA_MAX_WINS - 1, defeats: 0 })).toBe(false)
    expect(isArenaRunComplete({ wins: ARENA_MAX_WINS, defeats: 0 })).toBe(true)
    expect(isArenaRunComplete({ wins: 0, defeats: ARENA_MAX_DEFEATS - 1 })).toBe(false)
    expect(isArenaRunComplete({ wins: 0, defeats: ARENA_MAX_DEFEATS })).toBe(true)
  })

  it('does not count draws toward either limit', () => {
    expect(
      isArenaRunComplete({
        wins: ARENA_MAX_WINS - 1,
        defeats: ARENA_MAX_DEFEATS - 1
      })
    ).toBe(false)
  })
})

describe('Arena reward generation', () => {
  const fixedRng = (value: number) => ({
    next: () => value,
    snapshot: () => null,
    restore: () => undefined
  })

  it('uses every win tier and five-dust increments when all premiums are owned', () => {
    const owned = Object.fromEntries(CARD_CATALOG.all.map((card) => [card.id, 50]))
    for (let wins = 0; wins <= 12; wins++) {
      const [count, minimum, maximum] = ARENA_REWARD_TIERS[wins]
      for (let seed = 0; seed < 20; seed++) {
        const receipt = createArenaRewards('run', wins, owned, createSeededRng(seed))
        expect(receipt.prizes).toHaveLength(count)
        for (const prize of receipt.prizes) {
          expect(prize.kind).toBe('dust')
          if (prize.kind !== 'dust') throw new Error('Unexpected premium')
          expect(prize.amount).toBeGreaterThanOrEqual(minimum)
          expect(prize.amount).toBeLessThanOrEqual(maximum)
          expect(prize.amount % 5).toBe(0)
        }
      }
    }
  })

  it('excludes owned cards, Arena-ineligible formats and duplicate prizes', () => {
    const owned = fixture('owned', 1, 'Rare')
    const available = fixture('available', 1, 'Rare')
    const hero = fixture('hero', 1, 'Rare', 'Hero')
    const uncollectible = { ...fixture('token', 1, 'Rare'), collectible: false }
    const receipt = createArenaRewards('run', 12, { owned: 100 }, fixedRng(0), [
      owned,
      available,
      hero,
      uncollectible
    ])
    expect(receipt.prizes[0]).toEqual({
      kind: 'premium',
      cardId: available.id,
      refundValue: 100
    })
    expect(
      receipt.prizes.some(
        (prize) => prize.kind === 'premium' && prize.cardId === hero.id
      )
    ).toBe(false)
    expect(receipt.prizes.slice(1)).toEqual(
      Array.from({ length: 4 }, () => ({ kind: 'dust', amount: 80 }))
    )
  })

  it('merges Free/Common and falls back to dust for an exhausted rolled rarity', () => {
    const free = fixture('free', 1, 'Free')
    expect(createArenaRewards('run', 0, {}, fixedRng(0), [free]).prizes).toEqual([
      { kind: 'premium', cardId: free.id, refundValue: 50 }
    ])
    expect(
      createArenaRewards('run', 12, {}, fixedRng(0), [free]).prizes.every(
        (prize) => prize.kind === 'dust'
      )
    ).toBe(true)
  })

  it('can select each permitted premium rarity and is deterministic', () => {
    const cards = ['Common', 'Rare', 'Epic', 'Legendary'].map((rarity, index) =>
      fixture(`prize-${index}`, 1, rarity as CardDefinition['rarity'])
    )
    for (const [rarityRoll, expected] of [
      [0, 1],
      [0.7, 2],
      [0.95, 3]
    ]) {
      const values = [0, rarityRoll, 0]
      const rng = { ...fixedRng(0.99), next: () => values.shift() ?? 0.99 }
      expect(createArenaRewards('run', 12, {}, rng, cards).prizes[0]).toMatchObject({
        kind: 'premium',
        cardId: cards[expected].id
      })
    }
    expect(createArenaRewards('run', 12, {}, createSeededRng(42))).toEqual(
      createArenaRewards('run', 12, {}, createSeededRng(42))
    )
    for (const wins of [-1, 13, 0.5])
      expect(() => createArenaRewards('run', wins, {}, fixedRng(0))).toThrow()
  })
})
