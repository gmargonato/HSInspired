import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAX_DECK_CARDS,
  MAX_DECKS,
  addCardToDeck,
  countDeckCards,
  isCollectibleDeckCard,
  type Deck
} from '../src/shared/decks'
import { CARD_CATALOG } from '../card-lab/card-catalog'
import { DeckRepository } from '../src/main/services/deckRepository'

const baseDeck: Deck = {
  id: 'deck-test',
  name: 'Test deck',
  cards: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('deck rules', () => {
  it('allows two non-legendary copies but only one legendary copy', () => {
    const common = { id: 'common-card', rarity: 'Common' }
    const legendary = { id: 'legendary-card', rarity: 'Legendary' }

    const firstCommon = addCardToDeck(baseDeck, common)
    expect(firstCommon.ok).toBe(true)
    if (!firstCommon.ok) return

    const secondCommon = addCardToDeck(firstCommon.deck, common)
    expect(secondCommon.ok).toBe(true)
    if (!secondCommon.ok) return

    expect(addCardToDeck(secondCommon.deck, common)).toMatchObject({
      ok: false,
      code: 'copy-limit'
    })

    const firstLegendary = addCardToDeck(secondCommon.deck, legendary)
    expect(firstLegendary.ok).toBe(true)
    if (!firstLegendary.ok) return

    expect(addCardToDeck(firstLegendary.deck, legendary)).toMatchObject({
      ok: false,
      code: 'copy-limit'
    })
  })

  it('rejects cards after the deck reaches thirty total cards', () => {
    const cards = Object.fromEntries(
      Array.from({ length: MAX_DECK_CARDS }, (_, index) => [`card-${index}`, 1])
    )
    const fullDeck = { ...baseDeck, cards }

    expect(countDeckCards(fullDeck)).toBe(MAX_DECK_CARDS)
    expect(addCardToDeck(fullDeck, { id: 'new-card', rarity: 'Common' })).toMatchObject(
      {
        ok: false,
        code: 'deck-full'
      }
    )
  })

  it('rejects off-class and non-collectible cards', () => {
    const mageDeck = { ...baseDeck, heroClass: 'Mage' as const }
    const warrior = CARD_CATALOG.require('basic_execute')
    const coin = CARD_CATALOG.require('basic_the_coin')
    const missingClass = { id: 'missing-class', rarity: 'Common' }

    expect(addCardToDeck(mageDeck, warrior)).toMatchObject({
      ok: false,
      code: 'card-not-allowed'
    })
    expect(addCardToDeck(mageDeck, coin)).toMatchObject({
      ok: false,
      code: 'card-not-allowed'
    })
    expect(addCardToDeck(mageDeck, missingClass)).toMatchObject({
      ok: false,
      code: 'card-not-allowed'
    })
    expect(isCollectibleDeckCard(coin)).toBe(false)
  })
})

describe('DeckRepository', () => {
  it('persists, reloads, updates, and deletes decks as versioned JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hs-inspired-decks-'))
    const filePath = join(directory, 'decks.json')

    try {
      const repository = new DeckRepository(filePath)
      const created = await repository.create({
        name: 'Persistent deck',
        heroClass: 'Mage',
        heroId: 'jaina'
      })

      const file = JSON.parse(await readFile(filePath, 'utf8')) as {
        version: number
        decks: readonly Deck[]
      }
      expect(file.version).toBe(1)
      expect(file.decks).toHaveLength(1)
      expect(file.decks[0]?.heroClass).toBe('Mage')
      expect(file.decks[0]?.heroId).toBe('jaina')

      const reloaded = new DeckRepository(filePath)
      expect(await reloaded.list()).toEqual([created])

      const updated = await reloaded.update({
        ...created,
        cards: { basic_fireball: 2 }
      })
      expect((await reloaded.list())[0]).toEqual(updated)

      await expect(
        reloaded.update({
          ...updated,
          cards: { basic_execute: 1 }
        })
      ).rejects.toThrow('Invalid deck data')

      await reloaded.delete(updated.id)
      expect(await reloaded.list()).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('keeps generated names unique after deletions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hs-inspired-deck-names-'))
    const filePath = join(directory, 'decks.json')

    try {
      const repository = new DeckRepository(filePath)
      const first = await repository.create()
      const second = await repository.create()
      await repository.delete(first.id)
      const third = await repository.create()

      expect([first.name, second.name, third.name]).toEqual([
        'Deck 1',
        'Deck 2',
        'Deck 3'
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects creating more than nine decks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hs-inspired-deck-limit-'))
    const filePath = join(directory, 'decks.json')

    try {
      const repository = new DeckRepository(filePath)
      for (let index = 0; index < MAX_DECKS; index += 1) {
        await repository.create()
      }

      await expect(repository.create()).rejects.toThrow(
        `You can have at most ${MAX_DECKS} decks.`
      )
      expect(await repository.list()).toHaveLength(MAX_DECKS)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('serializes concurrent mutations without losing a deck', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hs-inspired-deck-concurrency-'))
    const filePath = join(directory, 'decks.json')

    try {
      const repository = new DeckRepository(filePath)
      const created = await Promise.all([repository.create(), repository.create()])

      expect(new Set(created.map((deck) => deck.id)).size).toBe(2)
      expect((await repository.list()).map((deck) => deck.name)).toEqual([
        'Deck 1',
        'Deck 2'
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
