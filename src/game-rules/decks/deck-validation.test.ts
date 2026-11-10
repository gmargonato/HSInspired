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
  it('pins the exact cleaned roster, heroes, names and card counts', () => {
    expect(CURATED_OPPONENT_CATALOG_VERSION).toBe(4)
    expect(
      CURATED_OPPONENT_DECKS.map(({ definition, deck }) => ({
        id: definition.id,
        name: deck.name,
        classId: definition.classId,
        heroId: deck.heroId,
        cards: deck.cards
      }))
    ).toMatchSnapshot()
  })

  it('contains three legal thirty-card decks per class with valid unique names', () => {
    const roster = CURATED_OPPONENT_DECKS
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
    expect(roster).toHaveLength(27)
    expect(new Set(roster.map(({ definition }) => definition.id)).size).toBe(27)
    expect(new Set(roster.map(({ deck }) => deck.name)).size).toBe(27)
    expect(roster.reduce((total, { deck }) => total + countDeckCards(deck), 0)).toBe(
      810
    )
    for (const classId of PLAYABLE_CLASSES)
      expect(
        roster.filter(({ definition }) => definition.classId === classId)
      ).toHaveLength(3)
    for (const { definition, deck, strategy } of roster) {
      expect(countDeckCards(deck), definition.id).toBe(30)
      expect(deck.name.length).toBeLessThanOrEqual(MAX_DECK_NAME_LENGTH)
      expect(parseDeck(deck)).toEqual(deck)
      expect(rules.validate(deck), definition.id).toEqual([])
      expect(HERO_CATALOG.require(deck.heroId).classId).toBe(definition.classId)
      expect(strategy.strategy).toBe('constructed')
      expect(strategy.text).toContain(definition.plan)
      const shortlisted = definition.id.startsWith('shortlist-')
      expect(strategy.text).toContain(
        shortlisted ? 'Approved custom shortlist:' : 'Historical inspiration:'
      )
      for (const [id, count] of Object.entries(deck.cards)) {
        const card = CARD_CATALOG.require(id)
        if (!shortlisted)
          expect(
            historicalExpansions.has(card.expansionId) ||
              (definition.id === 'rogue-crystal-caverns' &&
                card.expansionId === 'future-past'),
            id
          ).toBe(true)
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
        catalogVersion: 4,
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

  it('removes the requested decks from explicit and seeded selection', () => {
    const removedIds = [
      'druid-jungle-giants',
      'shortlist-dragon-hand-ramp-druid',
      'shortlist-glowfly-token-druid',
      'hunter-marsh-queen',
      'shortlist-beast-swarm-hunter',
      'mage-flamewaker-tempo',
      'mage-giants-waygate',
      'shortlist-shark-swarm-mech-mage',
      'paladin-anyfin-control',
      'paladin-murloc-swarm',
      'paladin-kaleidosaur',
      'shortlist-showdown-giant-paladin',
      'priest-dragon-tempo',
      'priest-awaken-makers',
      'rogue-jade-deathrattle',
      'shortlist-pirate-oil-rogue',
      'shaman-elemental-battlecry',
      'shaman-unite-murlocs',
      'warlock-reno-demon-control-selected',
      'warlock-lakkari-portal',
      'warrior-dragon-tempo',
      'warrior-fire-plume'
    ]
    for (const id of removedIds) {
      expect(
        CURATED_OPPONENT_DECKS.some(({ definition }) => definition.id === id),
        id
      ).toBe(false)
      expect(() => selectCuratedConstructedOpponent(42, id)).toThrow(
        'Unknown curated opponent deck'
      )
    }
    const seen = new Set<string>()
    for (let seed = 0; seed < 10000; seed++)
      seen.add(selectCuratedConstructedOpponent(seed).metadata.deckId)
    expect([...seen].sort()).toEqual(
      CURATED_OPPONENT_DECKS.map(({ definition }) => definition.id).sort()
    )
  })

  it('swaps exactly one Swashburglar for Vicious Scalehide in Crystal Caverns', () => {
    const { deck } = selectCuratedConstructedOpponent(42, 'rogue-crystal-caverns')
    expect(deck.cards.one_night_in_karazhan_swashburglar).toBe(1)
    expect(deck.cards.the_witchwood_vicious_scalehide).toBe(1)
    expect(countDeckCards(deck)).toBe(30)
    expect(new DeckRules().validate(deck)).toEqual([])
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

  it('keeps Snake Oil out of decks and limits legacy Future Past cards to Caverns', () => {
    const token = CARD_CATALOG.require('future_past_snake_oil')
    const rules = new DeckRules()
    expect(isCollectibleDeckCard(token)).toBe(false)
    expect(rules.isCardAllowedInDeck(FUTURE_PAST_UTHER_OTK_DECK, token)).toBe(false)
    expect(CURATED_OPPONENT_DECKS).toHaveLength(27)
    expect(
      CURATED_OPPONENT_DECKS.filter(
        ({ definition }) =>
          !definition.id.startsWith('shortlist-') &&
          definition.id !== 'rogue-crystal-caverns'
      ).every(({ deck }) =>
        Object.keys(deck.cards).every(
          (id) => CARD_CATALOG.require(id).expansionId !== 'future-past'
        )
      )
    ).toBe(true)
  })
})
