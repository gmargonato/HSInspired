import { describe, expect, it } from 'vitest'
import { CARD_CATALOG, type CardDefinition, type DeckClass } from '../content/cards'
import { HERO_CATALOG } from '../content/heroes'
import { MAX_DECK_CARDS } from './deck'
import { DeckRules, isCollectibleDeckCard } from './deck-rules'
import type { OpponentArchetype } from './opponent-archetype'
import { OPPONENT_ARCHETYPES } from './opponent-archetypes'
import { OPPONENT_CARD_RATINGS } from './opponent-card-ratings'
import { assessCuratedCard, type OpponentTag } from './opponent-curated-assessment'
import { opponentDeckTags } from './opponent-deck-draft'
import { assessFillCard } from './opponent-fill-pool'
import {
  generateConstructedOpponent,
  OPPONENT_GENERATOR_VERSION,
  resolveOpponentFloors,
  type GeneratedOpponent
} from './opponent-generator'
import { OPPONENT_PROFILES, type OpponentProfileId } from './opponent-profiles'
import { HERO_POWER_SUPPORT, opponentSupportGaps } from './opponent-support'

const SEEDS_PER_ARCHETYPE = 12
const rules = new DeckRules()

/** Which package tag realizes each quest goal used by an archetype. */
const QUEST_GOAL_TAGS: Readonly<Record<string, OpponentTag | null>> = {
  'play-cost-1-minion': 'cost-1-minion',
  'summon-deathrattle': 'deathrattle',
  'play-deathrattle-minion': 'deathrattle',
  'summon-murloc': 'murloc-source',
  'discard-card': 'discard',
  'play-taunt-minion': 'taunt',
  'cast-spell': 'spell',
  // Ending turns with unspent mana needs no deck enablers.
  'end-turn-unspent-mana': null
}

/** Expected average drawable cost per profile, aggregated over its archetypes. */
const PROFILE_AVERAGE_COST: Readonly<
  Record<OpponentProfileId, readonly [number, number]>
> = {
  aggro: [2.5, 3.2],
  midrange: [3.2, 3.8],
  ramp: [3.8, 4.5]
}

const classCards = (classId: DeckClass): CardDefinition[] =>
  CARD_CATALOG.all.filter(
    (card) =>
      isCollectibleDeckCard(card) &&
      (card.cardClass === 'Neutral' || card.cardClass === classId)
  )

const fillPool = (classId: DeckClass) =>
  classCards(classId)
    .map(assessFillCard)
    .filter((entry) => entry !== undefined)

const isQuest = (card: CardDefinition): boolean =>
  card.type === 'Spell' && card.quest !== undefined

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const CARD_NAMES = [
  ...new Set(
    CARD_CATALOG.all
      .filter((card) => isCollectibleDeckCard(card) && card.name.length >= 4)
      .map((card) => card.name)
  )
].sort((a, b) => b.length - a.length)

/**
 * Collectible card names mentioned as whole words in a text. Longer names are
 * consumed first, so "Death's Bite" is not also read as "Bite".
 */
function namedCards(text: string): string[] {
  let rest = text
  const found: string[] = []
  for (const name of CARD_NAMES) {
    const pattern = `(^|[^\\w'-])${escapeRegExp(name)}(?![\\w'-])`
    if (!new RegExp(pattern).test(rest)) continue
    found.push(name)
    rest = rest.replace(new RegExp(pattern, 'g'), '$1#')
  }
  return found
}

const generated = new Map<string, GeneratedOpponent[]>(
  OPPONENT_ARCHETYPES.map((archetype) => [
    archetype.id,
    Array.from({ length: SEEDS_PER_ARCHETYPE }, (_, index) =>
      generateConstructedOpponent(index * 7919 + 13, { archetypeId: archetype.id })
    )
  ])
)

const deckCards = (opponent: GeneratedOpponent): CardDefinition[] =>
  Object.entries(opponent.deck.cards).flatMap(([id, count]) =>
    Array<CardDefinition>(count).fill(CARD_CATALOG.require(id))
  )

describe('constructed opponent archetype data', () => {
  it('only rates cards that exist in the catalog', () => {
    expect(
      Object.keys(OPPONENT_CARD_RATINGS).filter((id) => !CARD_CATALOG.get(id))
    ).toEqual([])
  })

  it.each(OPPONENT_ARCHETYPES.map((archetype) => [archetype.id, archetype] as const))(
    '%s uses only tags that real class cards produce',
    (_, archetype: OpponentArchetype) => {
      const produced = new Set(
        classCards(archetype.classId).flatMap((card) => assessCuratedCard(card).tags)
      )
      const tags = [
        ...archetype.bias,
        ...archetype.packages.map((rule) => rule.tag),
        ...(archetype.floorOverrides ?? []).map((rule) => rule.tag)
      ]
      expect(tags.filter((tag) => !produced.has(tag))).toEqual([])
    }
  )

  it.each(OPPONENT_ARCHETYPES.map((archetype) => [archetype.id, archetype] as const))(
    '%s plan and mulligan name only core cards',
    (_, archetype: OpponentArchetype) => {
      const core = new Set(
        archetype.core.map((slot) => CARD_CATALOG.require(slot.id).name)
      )
      const named = namedCards(`${archetype.plan} ${archetype.mulligan}`)
      expect(named.filter((name) => !core.has(name))).toEqual([])
    }
  )

  it.each(OPPONENT_ARCHETYPES.map((archetype) => [archetype.id, archetype] as const))(
    '%s floors are internally consistent',
    (_, archetype: OpponentArchetype) => {
      const floors = resolveOpponentFloors(archetype, fillPool(archetype.classId))
      expect(floors.filter((floor) => floor.min > floor.max)).toEqual([])
      const curveMinimum = floors
        .filter((floor) => floor.tag.startsWith('cost:') && floor.tag !== 'cost:8+')
        .reduce((sum, floor) => sum + floor.min, 0)
      expect(curveMinimum).toBeLessThanOrEqual(
        MAX_DECK_CARDS - (archetype.quest ? 1 : 0)
      )
    }
  )

  it('gives every quest archetype a package for its quest goal', () => {
    for (const archetype of OPPONENT_ARCHETYPES) {
      const quest = archetype.core
        .map((slot) => CARD_CATALOG.require(slot.id))
        .find(isQuest)
      expect(Boolean(quest), archetype.id).toBe(archetype.quest)
      if (!quest || quest.type !== 'Spell' || !quest.quest) continue
      const tag = QUEST_GOAL_TAGS[quest.quest.goal]
      expect(
        tag,
        `${archetype.id}: unmapped goal ${quest.quest.goal}`
      ).not.toBeUndefined()
      if (tag === null) continue
      const rule = archetype.packages.find((entry) => entry.tag === tag)
      expect(rule?.min ?? 0, archetype.id).toBeGreaterThanOrEqual(quest.quest.target)
    }
  })
})

describe('constructed opponent generation', () => {
  it('is deterministic per seed and versioned', () => {
    const first = generateConstructedOpponent(4242)
    const second = generateConstructedOpponent(4242)
    expect(second.deck).toEqual(first.deck)
    expect(second.metadata.strategy).toEqual(first.metadata.strategy)
    expect(first.metadata.version).toBe(OPPONENT_GENERATOR_VERSION)
    expect(first.deck.id).toContain(`-v${OPPONENT_GENERATOR_VERSION}-`)
  })

  it.each(OPPONENT_ARCHETYPES.map((archetype) => [archetype.id, archetype] as const))(
    '%s builds legal lists with its core, packages, floors and support',
    (_, archetype: OpponentArchetype) => {
      const floors = resolveOpponentFloors(archetype, fillPool(archetype.classId))
      for (const opponent of generated.get(archetype.id)!) {
        const cards = deckCards(opponent)
        expect(cards).toHaveLength(MAX_DECK_CARDS)
        expect(rules.validate(opponent.deck)).toEqual([])
        expect(opponent.metadata.archetype).toBe(archetype.id)
        for (const slot of archetype.core)
          expect(opponent.deck.cards[slot.id] ?? 0, slot.id).toBeGreaterThanOrEqual(
            slot.count
          )
        const count = (tag: OpponentTag): number =>
          cards.filter((card) => opponentDeckTags(card).includes(tag)).length
        for (const floor of floors)
          expect(
            count(floor.tag),
            `${floor.tag} >= ${floor.min}`
          ).toBeGreaterThanOrEqual(floor.min)
        const heroClass = HERO_CATALOG.require(opponent.deck.heroId)
          .classId as DeckClass
        expect(opponentSupportGaps(cards, HERO_POWER_SUPPORT[heroClass] ?? {})).toEqual(
          []
        )
      }
    }
  )

  it.each(OPPONENT_ARCHETYPES.map((archetype) => [archetype.id, archetype] as const))(
    '%s strategy brief names only cards the list contains',
    (_, archetype: OpponentArchetype) => {
      for (const opponent of generated.get(archetype.id)!) {
        const { strategy } = opponent.metadata
        expect(strategy.strategy).toBe(OPPONENT_PROFILES[archetype.profile].strategy)
        expect(strategy.theme).toBe(archetype.id)
        expect(strategy.text).toContain('Key cards in this list:')
        const owned = new Set(deckCards(opponent).map((card) => card.name))
        expect(namedCards(strategy.text).filter((name) => !owned.has(name))).toEqual([])
      }
    }
  )

  it.each(Object.keys(PROFILE_AVERAGE_COST) as OpponentProfileId[])(
    '%s profile keeps its mana curve',
    (profile) => {
      let cost = 0
      let drawable = 0
      for (const archetype of OPPONENT_ARCHETYPES.filter(
        (entry) => entry.profile === profile
      ))
        for (const opponent of generated.get(archetype.id)!)
          for (const card of deckCards(opponent).filter((entry) => !isQuest(entry))) {
            cost += card.cost
            drawable++
          }
      const [low, high] = PROFILE_AVERAGE_COST[profile]
      expect(cost / drawable).toBeGreaterThanOrEqual(low)
      expect(cost / drawable).toBeLessThanOrEqual(high)
    }
  )
})
