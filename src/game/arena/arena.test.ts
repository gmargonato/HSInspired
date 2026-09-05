import { describe, expect, it } from 'vitest'
import { CARD_CATALOG, HERO_CATALOG } from '../content'
import { countDeckCards } from '../decks'
import { createSeededRng } from '../match'
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
    const deck = createArenaOpponentDeck(42)
    expect(countDeckCards(deck)).toBe(30)
    expect(deck.id).toBe('arena-opponent-42')
  })

  it('adapts a ready run without constructed copy-limit validation', () => {
    const timestamp = new Date(0).toISOString()
    const run: ArenaRunSnapshot = {
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
