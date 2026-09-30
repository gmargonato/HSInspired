import { describe, expect, it } from 'vitest'
import { PLAYABLE_CLASSES } from '../../game-rules/content/cards'
import { HERO_CATALOG } from '../../game-rules/content/heroes'
import { countDeckCards } from '../../game-rules/decks'
import { createTurnMatch } from '../../game-rules/match'
import {
  UNSTABLE_PORTAL_CARD_ID,
  createTavernBrawlGameRoute
} from './tavern-brawl-model'

describe('createTavernBrawlGameRoute', () => {
  it('builds a deterministic matchup with temporary 30-portal decks', () => {
    const route = createTavernBrawlGameRoute(12345)
    const repeated = createTavernBrawlGameRoute(12345)

    expect(route).toEqual(repeated)
    expect(route.mode).toBe('tavern-brawl')
    expect(route.deckSnapshots).toHaveLength(2)
    expect(route.deckSnapshots?.[0]?.id).not.toBe(route.deckSnapshots?.[1]?.id)

    for (const deck of route.deckSnapshots ?? []) {
      expect(countDeckCards(deck)).toBe(30)
      expect(deck.cards).toEqual({ [UNSTABLE_PORTAL_CARD_ID]: 30 })
      const hero = HERO_CATALOG.require(deck.heroId)
      expect(PLAYABLE_CLASSES).toContain(hero.classId)
    }

    expect(() => createTurnMatch(route.setup, route.deckSnapshots ?? [])).not.toThrow()
  })
})
