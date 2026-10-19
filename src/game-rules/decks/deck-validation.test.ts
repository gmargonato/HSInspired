import { describe, expect, it } from 'vitest'
import { parseDeck } from './deck-validation'
import { FUTURE_PAST_UTHER_OTK_DECK } from './future-past-uther-otk'
import { CARD_CATALOG, PLAYABLE_CLASSES } from '../content/cards'
import { HERO_CATALOG } from '../content/heroes'
import {
  CURATED_OPPONENT_CATALOG_VERSION,
  CURATED_OPPONENT_DECKS,
  getCuratedOpponentDecksForClass
} from './curated-opponent-decks'
import { selectCuratedConstructedOpponent } from './curated-opponent-selection'
import { countDeckCards, MAX_DECK_NAME_LENGTH } from './deck'
import { DeckRules, isCollectibleDeckCard } from './deck-rules'
import { createSeededRng } from '../match/rng'

function deckWithName(name: string): Record<string, unknown> {
  return {
    id: 'deck-1',
    name,
    heroId: 'guldan',
    cards: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('deck name validation', () => {
  it('accepts names up to fifteen characters', () => {
    expect(parseDeck(deckWithName('Fifteen chars!!')).name).toBe('Fifteen chars!!')
  })

  it('rejects names longer than fifteen characters', () => {
    expect(() => parseDeck(deckWithName('Sixteen chars!!!'))).toThrow(
      'deck.name exceeds 15 characters'
    )
  })
})

describe('approved curated opponent roster', () => {
  it('pins the exact version 2 roster, heroes, names and card counts', () => {
    expect(CURATED_OPPONENT_CATALOG_VERSION).toBe(3)
    expect(
      CURATED_OPPONENT_DECKS.slice(0, 27).map(({ definition, deck }) => ({
        id: definition.id,
        name: deck.name,
        classId: definition.classId,
        heroId: deck.heroId,
        cards: deck.cards
      }))
    ).toMatchSnapshot()
  })

  it('contains four legal historical-pool adaptations per class with valid unique names', () => {
    const historicalExpansions = new Set([
      'basic',
      'classic',
      'naxxramas',
      'goblins-vs-gnomes',
      'blackrock-mountain',
      'the-grand-tournament',
      'league-of-explorers',
      'whispers-of-the-old-gods',
      'one-night-in-karazhan',
      'mean-streets-of-gadgetzan',
      'journey-to-ungoro',
      'knights-of-the-frozen-throne'
    ])
    const rules = new DeckRules()
    expect(CURATED_OPPONENT_DECKS).toHaveLength(36)
    expect(
      new Set(CURATED_OPPONENT_DECKS.map(({ definition }) => definition.id)).size
    ).toBe(36)
    expect(new Set(CURATED_OPPONENT_DECKS.map(({ deck }) => deck.name)).size).toBe(36)
    expect(
      CURATED_OPPONENT_DECKS.reduce(
        (total, { deck }) => total + countDeckCards(deck),
        0
      )
    ).toBe(1080)
    for (const classId of PLAYABLE_CLASSES)
      expect(getCuratedOpponentDecksForClass(classId)).toHaveLength(4)
    for (const { definition, deck, strategy } of CURATED_OPPONENT_DECKS) {
      expect(countDeckCards(deck), definition.id).toBe(30)
      expect(deck.name.length).toBeLessThanOrEqual(MAX_DECK_NAME_LENGTH)
      expect(parseDeck(deck)).toEqual(deck)
      expect(rules.validate(deck), definition.id).toEqual([])
      expect(HERO_CATALOG.require(deck.heroId).classId).toBe(definition.classId)
      expect(strategy.strategy).toBe('constructed')
      expect(strategy.text).toContain(definition.plan)
      expect(strategy.text).toContain('Historical inspiration:')
      for (const [id, count] of Object.entries(deck.cards)) {
        const card = CARD_CATALOG.require(id)
        expect(historicalExpansions.has(card.expansionId), id).toBe(true)
        expect(isCollectibleDeckCard(card), id).toBe(true)
        expect([definition.classId, 'Neutral']).toContain(card.cardClass)
        expect(count).toBeGreaterThan(0)
        expect(count).toBeLessThanOrEqual(card.rarity === 'Legendary' ? 1 : 2)
      }
    }
  })

  it('keeps seeded uniform class-then-list selection and versioned metadata', () => {
    for (const seed of [0, 1, 42, 4242, 0xffffffff]) {
      const rng = createSeededRng(seed ^ 0x63757261)
      const classId = PLAYABLE_CLASSES[Math.floor(rng.next() * PLAYABLE_CLASSES.length)]
      const candidates = getCuratedOpponentDecksForClass(classId)
      const expected = candidates[Math.floor(rng.next() * candidates.length)]
      const selected = selectCuratedConstructedOpponent(seed)
      expect(selected).toEqual(selectCuratedConstructedOpponent(seed))
      expect(selected.deck).toEqual(expected.deck)
      expect(selected.metadata).toMatchObject({
        catalogVersion: 3,
        seed,
        classId,
        deckId: expected.definition.id,
        deckName: expected.definition.name
      })
    }
  })

  it('selects every replacement explicitly without inheriting an old Expert profile', () => {
    for (const { definition, deck } of CURATED_OPPONENT_DECKS) {
      const selected = selectCuratedConstructedOpponent(42, definition.id)
      expect(selected.deck).toEqual(deck)
      expect(definition.expertStrategyProfileId).toBeUndefined()
      expect(selected.metadata.expertStrategyProfileId).toBeUndefined()
      expect(selected.metadata.deckId).toBe(definition.id)
    }
    expect(() => selectCuratedConstructedOpponent(42, 'druid-cthun-midrange')).toThrow(
      'Unknown curated opponent deck'
    )
    for (const seed of [-1, 1.5, 0x100000000, NaN])
      expect(() => selectCuratedConstructedOpponent(seed)).toThrow(
        'seed must be uint32'
      )
  })

  it('uses Spirit Lash instead of the Reno Raza healing workaround', () => {
    const { deck } = selectCuratedConstructedOpponent(42, 'priest-reno-raza')
    expect(deck.cards.knights_of_the_frozen_throne_spirit_lash).toBe(1)
    expect(deck.cards.mean_streets_of_gadgetzan_greater_healing_potion).toBeUndefined()
    expect(Object.values(deck.cards).every((count) => count === 1)).toBe(true)
  })
})

describe('Future Past Uther OTK player recipe', () => {
  it('contains exactly the approved thirty cards and five reused definitions', () => {
    const deck = FUTURE_PAST_UTHER_OTK_DECK
    expect(deck.id).toBe('future-past-uther-otk')
    expect(deck.name).toBe('Uther OTK')
    expect(deck.heroId).toBe('uther')
    expect(parseDeck(deck)).toEqual(deck)
    expect(countDeckCards(deck)).toBe(30)
    expect(new DeckRules().validate(deck)).toEqual([])
    expect(deck.cards).toEqual({
      future_past_animated_broomstick: 2,
      future_past_armor_vendor: 2,
      future_past_critter_caretaker: 2,
      future_past_depth_charge: 2,
      future_past_dragonscale_armaments: 2,
      future_past_knight_of_anointment: 2,
      future_past_miracle_salesman: 2,
      mean_streets_of_gadgetzan_mistress_of_mixtures: 2,
      future_past_peasant: 2,
      knights_of_the_frozen_throne_righteous_protector: 2,
      naxxramas_zombie_chow: 2,
      the_grand_tournament_garrison_commander: 2,
      future_past_order_in_the_court: 2,
      future_past_sing_along_buddy: 2,
      future_past_nozdormu_the_timeless: 1,
      knights_of_the_frozen_throne_uther_of_the_ebon_blade: 1
    })
    expect(
      Object.keys(deck.cards).filter((id) => !id.startsWith('future_past_'))
    ).toHaveLength(5)
    expect(CARD_CATALOG.require('future_past_sing_along_buddy')).toMatchObject({
      cost: 3,
      attack: 2,
      health: 4
    })
    expect(CARD_CATALOG.require('future_past_order_in_the_court').cost).toBe(4)
    expect(
      CARD_CATALOG.require('knights_of_the_frozen_throne_uther_of_the_ebon_blade').cost
    ).toBe(8)
    expect(deck.cards.future_past_snake_oil).toBeUndefined()
  })

  it('keeps Snake Oil out of decks and leaves the curated AI roster unchanged', () => {
    const token = CARD_CATALOG.require('future_past_snake_oil')
    const rules = new DeckRules()
    expect(isCollectibleDeckCard(token)).toBe(false)
    expect(rules.isCardAllowedInDeck(FUTURE_PAST_UTHER_OTK_DECK, token)).toBe(false)
    expect(CURATED_OPPONENT_DECKS).toHaveLength(36)
    expect(
      CURATED_OPPONENT_DECKS.every(({ deck }) =>
        Object.keys(deck.cards).every((id) => !id.startsWith('future_past_'))
      )
    ).toBe(true)
  })
})
