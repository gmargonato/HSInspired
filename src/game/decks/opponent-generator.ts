import {
  CARD_CATALOG,
  PLAYABLE_CLASSES,
  type CardCatalog,
  type CardDefinition,
  type CardId,
  type HeroId
} from '../content/cards'
import { HERO_CATALOG } from '../content/heroes'
import { createSeededRng, type DeterministicRng } from '../match/rng'
import {
  inspectCardCapabilities,
  runtimeCapabilityKeys
} from '../match/effects/capability'
import { getCardCopyLimit, type Deck } from './deck'
import { DeckRules } from './deck-rules'
import { OPPONENT_ARCHETYPES } from './opponent-archetypes'
import type { OpponentArchetype } from './opponent-archetype'
import {
  assessFillCard,
  isOpponentPowerCard,
  type OpponentFillCard
} from './opponent-fill-pool'
import { OPPONENT_FLOORS, type OpponentFloorRule } from './opponent-floors'
import type { OpponentStrategyBrief } from './opponent-strategy'

export const OPPONENT_GENERATOR_VERSION = 7

export interface OpponentConstructionStep {
  readonly layer: string
  readonly selected: string
  readonly reason: string
  readonly candidates: number
  readonly deckSize: number
}
export interface OpponentPowerCardSkip {
  readonly kind: 'hero'
  readonly reason: string
}
export interface GeneratedOpponentPowerCards {
  readonly questCardId: CardId | null
  readonly heroCardId: CardId | null
  readonly skipped: readonly OpponentPowerCardSkip[]
}
export interface GeneratedOpponentMetadata {
  readonly core: string
  readonly coreCards: OpponentArchetype['core']
  readonly archetype: string
  readonly construction: readonly OpponentConstructionStep[]
  readonly version: number
  readonly seed: number
  readonly heroId: HeroId
  readonly cards: Deck['cards']
  readonly powerCards: GeneratedOpponentPowerCards
  readonly strategy: OpponentStrategyBrief
  readonly diagnostics: {
    readonly attempts: number
    readonly warnings: readonly string[]
  }
}
export interface GeneratedOpponent {
  readonly deck: Deck
  readonly metadata: GeneratedOpponentMetadata
}

function pick<T>(values: readonly T[], rng: DeterministicRng): T {
  if (!values.length) throw new Error('No eligible opponent candidates.')
  return values[Math.floor(rng.next() * values.length)]
}
function shuffled<T>(values: readonly T[], rng: DeterministicRng): T[] {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(rng.next() * (index + 1))
    ;[result[index], result[other]] = [result[other], result[index]]
  }
  return result
}
function weightedPick(
  values: readonly OpponentFillCard[],
  weight: (card: OpponentFillCard) => number,
  rng: DeterministicRng
): OpponentFillCard {
  const weights = values.map(weight)
  let roll = rng.next() * weights.reduce((a, b) => a + b, 0)
  for (let index = 0; index < values.length; index++) {
    roll -= weights[index]
    if (roll < 0) return values[index]
  }
  return values[values.length - 1]
}

const supportedCapabilities = runtimeCapabilityKeys()

interface FixedCard {
  readonly card: CardDefinition
  readonly layer: string
  readonly reason: string
}

/** Pure local generation. No human deck, clock, network, or match RNG is consulted. */
export function generateConstructedOpponent(
  seed: number,
  options: {
    readonly heroId?: HeroId
    readonly archetypeId?: string
    readonly catalog?: CardCatalog
  } = {}
): GeneratedOpponent {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error('Opponent seed must be uint32.')
  const rng = createSeededRng(seed ^ 0x74656d70)
  const forced = options.archetypeId
    ? OPPONENT_ARCHETYPES.find((entry) => entry.id === options.archetypeId)
    : undefined
  if (options.archetypeId && !forced)
    throw new Error(`Unknown opponent archetype: ${options.archetypeId}`)
  const heroClass = options.heroId
    ? HERO_CATALOG.require(options.heroId).classId
    : (forced?.classId ?? pick(PLAYABLE_CLASSES, rng))
  const heroId =
    options.heroId ??
    pick(
      HERO_CATALOG.all.filter(
        (hero) => hero.deckSelectable && hero.classId === heroClass
      ),
      rng
    ).id
  if (!HERO_CATALOG.require(heroId).deckSelectable)
    throw new Error('Opponent hero is not deck selectable.')
  const catalog = options.catalog ?? CARD_CATALOG
  const rules = new DeckRules(catalog)

  const construction: OpponentConstructionStep[] = [
    {
      layer: 'class',
      selected: heroClass,
      reason:
        options.heroId || forced
          ? 'Explicit audit/development selection.'
          : 'Uniform seeded playable-class selection.',
      candidates: options.heroId || forced ? 1 : PLAYABLE_CLASSES.length,
      deckSize: 0
    }
  ]

  // Mandatory hero card: the one deliberate inclusion every generated deck carries.
  const heroCandidates = catalog.all
    .filter(
      (card) =>
        card.type === 'Hero' &&
        card.cardClass === heroClass &&
        rules.isCardAllowedInDeck({ heroId }, card)
    )
    .sort((a, b) => a.id.localeCompare(b.id))
  const heroCard = heroCandidates.length ? pick(heroCandidates, rng) : undefined
  const skipped: OpponentPowerCardSkip[] = heroCard
    ? []
    : [
        {
          kind: 'hero',
          reason: `No legal Hero card is available for ${heroClass}; skipped this bonus card.`
        }
      ]
  if (heroCard)
    construction.push({
      layer: 'hero',
      selected: heroCard.id,
      reason: `Mandatory class-legal Hero card selected from ${heroCandidates.length} candidate${heroCandidates.length === 1 ? '' : 's'}.`,
      candidates: heroCandidates.length,
      deckSize: 0
    })
  const warnings = skipped.map((entry) => entry.reason)

  // Uniform seeded archetype pick.
  const available = OPPONENT_ARCHETYPES.filter(
    (entry) => entry.classId === heroClass && (!forced || entry === forced)
  )
  if (!available.length) throw new Error(`No opponent archetypes for ${heroClass}.`)
  const archetype = shuffled(available, rng)[0]
  construction.push({
    layer: 'archetype',
    selected: archetype.id,
    reason: archetype.plan,
    candidates: available.length,
    deckSize: 0
  })

  const fixed: FixedCard[] = heroCard
    ? [{ card: heroCard, layer: 'hero', reason: 'Mandatory Hero card.' }]
    : []
  const invalidCore = archetype.core.find((slot) => {
    const card = catalog.get(slot.id)
    return (
      !card ||
      !rules.isCardAllowedInDeck({ heroId }, card) ||
      !inspectCardCapabilities(card, supportedCapabilities).supported
    )
  })
  if (invalidCore)
    throw new Error(`Ineligible opponent core card: ${invalidCore.id}`)
  for (const slot of archetype.core) {
    const card = catalog.require(slot.id)
    const quest = card.type === 'Spell' && card.quest !== undefined
    fixed.push({
      card,
      layer: quest ? 'quest' : 'core',
      reason: quest
        ? 'Quest archetype inclusion; the only quest this deck may carry.'
        : 'Defining archetype card.'
    })
    if (quest)
      construction.push({
        layer: 'quest',
        selected: card.id,
        reason: 'Quest archetype: the quest enters through the core.',
        candidates: 1,
        deckSize: 0
      })
  }

  const pool: OpponentFillCard[] = []
  for (const card of catalog.all) {
    if (card.cardClass !== 'Neutral' && card.cardClass !== heroClass) continue
    if (isOpponentPowerCard(card)) continue
    if (!rules.isCardAllowedInDeck({ heroId }, card)) continue
    const facts = assessFillCard(card)
    if (facts) pool.push(facts)
  }
  const assembled = assemble(archetype, rng, construction, pool, fixed)
  if (assembled.errors.length)
    throw new Error(`Unable to assemble opponent: ${assembled.errors.join('; ')}`)

  const deck: Deck = {
    id: `constructed-opponent-v${OPPONENT_GENERATOR_VERSION}-${seed}-${heroId}`,
    name: 'Challenger',
    heroId,
    cards: assembled.cards,
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z'
  }
  const deckErrors = rules.validate(deck)
  if (deckErrors.length)
    throw new Error(`Invalid generated opponent: ${deckErrors.join('; ')}`)

  construction.push({
    layer: 'validation',
    selected: 'accepted',
    reason: `30 cards; class/copy legality and universal floors passed. Floors: ${assembled.floorReport}.`,
    candidates: 1,
    deckSize: 30
  })

  return {
    deck,
    metadata: {
      core: archetype.core[0]?.id ?? '',
      coreCards: archetype.core,
      archetype: archetype.id,
      construction,
      version: OPPONENT_GENERATOR_VERSION,
      seed,
      heroId,
      cards: { ...deck.cards },
      powerCards: {
        questCardId: assembled.questCardId,
        heroCardId: heroCard?.id ?? null,
        skipped
      },
      strategy: {
        strategy: 'midrange-tempo',
        theme: archetype.id,
        text: `Original deck: ${archetype.name}. Current state overrides this plan. ${archetype.plan} Mulligan: ${archetype.mulligan}`
      },
      diagnostics: {
        attempts: 1,
        warnings
      }
    }
  }
}

interface AssemblyResult {
  readonly cards: Deck['cards']
  readonly errors: readonly string[]
  readonly questCardId: CardId | null
  readonly floorReport: string
}

function assemble(
  archetype: OpponentArchetype,
  rng: DeterministicRng,
  trace: OpponentConstructionStep[],
  pool: readonly OpponentFillCard[],
  fixed: readonly FixedCard[]
): AssemblyResult {
  const cards: CardDefinition[] = []
  const counts = new Map<string, number>()
  const tagCounts = new Map<string, number>()
  const floors: readonly OpponentFloorRule[] = OPPONENT_FLOORS.filter((floor) =>
    pool.some((entry) => entry.tags.includes(floor.tag))
  )
  const errors: string[] = []
  const add = (card: CardDefinition, layer: string, reason: string): void => {
    cards.push(card)
    counts.set(card.id, (counts.get(card.id) ?? 0) + 1)
    for (const tag of assessFillCard(card)?.tags ?? [])
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
    trace.push({ layer, selected: card.id, reason, candidates: 1, deckSize: cards.length })
  }
  for (const entry of fixed) {
    // Hero and Quest cards are deliberate power cards, not pool candidates.
    if (!isOpponentPowerCard(entry.card)) {
      const facts = assessFillCard(entry.card)
      if (!facts || (counts.get(entry.card.id) ?? 0) >= getCardCopyLimit(entry.card)) {
        errors.push(`${entry.card.id}: ineligible or copy-conflicting fixed card`)
        return { cards: {}, errors, questCardId: null, floorReport: '' }
      }
    }
    add(entry.card, entry.layer, entry.reason)
  }
  const questCardId =
    fixed.find((entry) => entry.card.type === 'Spell' && entry.card.quest !== undefined)
      ?.card.id ?? null
  const weight = (card: OpponentFillCard): number =>
    card.quality ** 2 *
    (card.card.cardClass !== 'Neutral' ? 2 : 1) *
    (archetype.bias.some((tag) => card.tags.includes(tag)) ? 1.5 : 1) *
    ((counts.get(card.card.id) ?? 0) === 1 ? 1.5 : 1)
  const legal = (): OpponentFillCard[] =>
    pool.filter(
      (entry) =>
        (counts.get(entry.card.id) ?? 0) < getCardCopyLimit(entry.card) &&
        floors.every(
          (floor) =>
            !entry.tags.includes(floor.tag) ||
            (tagCounts.get(floor.tag) ?? 0) + 1 <= floor.max
        )
    )
  while (cards.length < 30) {
    const current = legal()
    if (!current.length) {
      errors.push('No compatible fill slots remain.')
      break
    }
    const target = floors.find((floor) => (tagCounts.get(floor.tag) ?? 0) < floor.min)
    const roleCandidates = target
      ? current.filter((entry) => entry.tags.includes(target.tag))
      : []
    const candidates = roleCandidates.length ? roleCandidates : current
    const selected = weightedPick(candidates, weight, rng)
    add(
      selected.card,
      target && roleCandidates.length ? `fill:${target.tag}` : 'fill',
      target && roleCandidates.length
        ? `Floor ${target.tag}: ${tagCounts.get(target.tag) ?? 0}/${target.min}; weighted by quality, class affinity and archetype bias.`
        : 'Flexible slot; weighted by quality, class affinity and archetype bias.'
    )
  }
  for (const floor of floors) {
    const actual = tagCounts.get(floor.tag) ?? 0
    if (actual < floor.min)
      errors.push(`Floor unmet: ${floor.tag} (${actual}/${floor.min})`)
  }
  const deckCards: Record<string, number> = {}
  for (const card of cards) deckCards[card.id] = (deckCards[card.id] ?? 0) + 1
  const floorReport = floors
    .map(
      (floor) =>
        `${floor.tag}=${tagCounts.get(floor.tag) ?? 0} [${floor.min}..${floor.max}]`
    )
    .join('; ')
  return { cards: deckCards, errors, questCardId, floorReport }
}
