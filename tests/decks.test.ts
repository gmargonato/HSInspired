import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAX_DECK_CARDS,
  MAX_DECKS,
  addCardToDeck,
  countDeckCards,
  isCollectibleDeckCard,
  removeCardFromDeck,
  type Deck
} from '../src/game/decks'
import { CARD_CATALOG } from '../src/game/content/cards'
import { asHeroId } from '../src/game/content'
import { DeckRepository } from '../src/main/services/deckRepository'

const baseDeck: Deck = {
  id: 'deck-test',
  name: 'Test deck',
  heroId: asHeroId('jaina'),
  cards: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('deck rules', () => {
  it('allows two non-legendary copies but only one legendary copy', () => {
    const common = CARD_CATALOG.require('basic_fireball')
    const legendary = CARD_CATALOG.require('classic_archmage_antonidas')

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
    expect(
      addCardToDeck(fullDeck, CARD_CATALOG.require('basic_fireball'))
    ).toMatchObject({
      ok: false,
      code: 'deck-full'
    })
  })

  it('decrements duplicate copies before removing the final copy', () => {
    const card = CARD_CATALOG.require('basic_fireball')
    const doubleCopyDeck: Deck = {
      ...baseDeck,
      cards: { [card.id]: 2 }
    }

    const firstRemoval = removeCardFromDeck(doubleCopyDeck, card.id)
    expect(firstRemoval.ok).toBe(true)
    if (!firstRemoval.ok) return

    expect(firstRemoval.deck.cards[card.id]).toBe(1)

    const finalRemoval = removeCardFromDeck(firstRemoval.deck, card.id)
    expect(finalRemoval.ok).toBe(true)
    if (!finalRemoval.ok) return

    expect(finalRemoval.deck.cards[card.id]).toBeUndefined()
    expect(countDeckCards(finalRemoval.deck)).toBe(0)
  })

  it('rejects off-class and non-collectible cards', () => {
    const mageDeck = { ...baseDeck, heroId: asHeroId('jaina') }
    const warrior = CARD_CATALOG.require('basic_execute')
    const coin = CARD_CATALOG.require('basic_the_coin')
    expect(addCardToDeck(mageDeck, warrior)).toMatchObject({
      ok: false,
      code: 'card-not-allowed'
    })
    expect(addCardToDeck(mageDeck, coin)).toMatchObject({
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
        heroId: asHeroId('jaina')
      })

      const file = JSON.parse(await readFile(filePath, 'utf8')) as {
        version: number
        decks: readonly Deck[]
      }
      expect(file.version).toBe(2)
      expect(file.decks).toHaveLength(1)
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

  it('replaces an unsupported persisted version while keeping a backup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hs-inspired-deck-reset-'))
    const filePath = join(directory, 'decks.json')

    try {
      await writeFile(
        filePath,
        JSON.stringify({ version: 99, decks: [{ id: 'legacy-deck' }] }),
        'utf8'
      )

      const repository = new DeckRepository(filePath)

      expect(await repository.list()).toEqual([])
      expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({
        version: 2,
        decks: []
      })
      expect((await readdir(directory)).some((name) => name.endsWith('.bak'))).toBe(
        true
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('migrates legacy decks to version 2 using their hero class', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hs-inspired-deck-migration-'))
    const filePath = join(directory, 'decks.json')

    try {
      await writeFile(
        filePath,
        JSON.stringify({
          version: 1,
          decks: [
            {
              id: 'legacy-mage',
              name: 'Legacy Mage',
              heroClass: 'Mage',
              cards: { basic_fireball: 2 },
              createdAt: baseDeck.createdAt,
              updatedAt: baseDeck.updatedAt
            }
          ]
        }),
        'utf8'
      )

      const repository = new DeckRepository(filePath)
      const decks = await repository.list()

      expect(decks).toMatchObject([
        { id: 'legacy-mage', name: 'Legacy Mage', heroId: 'jaina' }
      ])
      expect(JSON.parse(await readFile(filePath, 'utf8')).version).toBe(2)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('recovers legacy decks from the backup created by the reset', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hs-inspired-deck-backup-'))
    const filePath = join(directory, 'decks.json')

    try {
      await writeFile(filePath, JSON.stringify({ version: 2, decks: [] }), 'utf8')
      await writeFile(
        `${filePath}.unsupported-1787179170221-test.bak`,
        JSON.stringify({
          version: 1,
          decks: [
            {
              id: 'backup-mage',
              name: 'Backup Mage',
              heroClass: 'Mage',
              cards: {},
              createdAt: baseDeck.createdAt,
              updatedAt: baseDeck.updatedAt
            }
          ]
        }),
        'utf8'
      )

      const repository = new DeckRepository(filePath)

      await expect(repository.list()).resolves.toMatchObject([
        { id: 'backup-mage', heroId: 'jaina' }
      ])
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
