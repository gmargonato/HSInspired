import { PLAYABLE_CLASSES } from '../../../game/content/cards'
import { HERO_CATALOG } from '../../../game/content/heroes'
import type { Deck } from '../../../game/decks'
import { createHumanVsAiMatchSetup, createSeededRng } from '../../../game/match'
import type { GameRoute } from '../game/game-route'

export const UNSTABLE_PORTAL_CARD_ID = 'goblins_vs_gnomes_unstable_portal' as const

function createPortalDeck(id: string, heroId: Deck['heroId']): Deck {
  const timestamp = new Date(0).toISOString()
  return {
    id,
    name: 'Too Many Portals!',
    heroId,
    cards: { [UNSTABLE_PORTAL_CARD_ID]: 30 },
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

/** Builds the complete, non-persisted matchup for one Tavern Brawl launch. */
export function createTavernBrawlGameRoute(seed: number): GameRoute {
  const rng = createSeededRng(seed ^ 0x74617665)
  const chooseHero = (): Deck['heroId'] => {
    const index = Math.floor(rng.next() * PLAYABLE_CLASSES.length)
    const classId = PLAYABLE_CLASSES[Math.min(index, PLAYABLE_CLASSES.length - 1)]
    const hero = HERO_CATALOG.getPrimaryForClass(classId)
    if (!hero) throw new Error(`No playable hero is available for ${classId}.`)
    return hero.id
  }

  const humanDeck = createPortalDeck(`tavern-brawl-human-${seed}`, chooseHero())
  const aiDeck = createPortalDeck(`tavern-brawl-ai-${seed}`, chooseHero())

  return {
    id: 'game',
    mode: 'tavern-brawl',
    setup: createHumanVsAiMatchSetup({ humanDeck, aiDeck }, seed),
    deckSnapshots: [humanDeck, aiDeck]
  }
}
