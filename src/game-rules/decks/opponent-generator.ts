import {
  CARD_CATALOG,
  PLAYABLE_CLASSES,
  type CardCatalog,
  type CardDefinition,
  type CardId,
  type DeckClass,
  type HeroId
} from '../content/cards'
import { HERO_CATALOG } from '../content/heroes'
import { createSeededRng, type DeterministicRng } from '../match/rng'
import {
  inspectCardCapabilities,
  runtimeCapabilityKeys
} from '../match/effects/capability'
import { MAX_DECK_CARDS, type Deck } from './deck'
import { DeckRules } from './deck-rules'
import { OPPONENT_ARCHETYPES } from './opponent-archetypes'
import type { OpponentArchetype } from './opponent-archetype'
import {
  assembleOpponentDeck,
  type OpponentAssemblyInput,
  type OpponentAssemblyPools,
  type OpponentAssemblyResult,
  type OpponentConstructionStep,
  type OpponentFixedCard
} from './opponent-assembly'
import type { OpponentTag } from './opponent-curated-assessment'
import { opponentDeckTags, type ResolvedOpponentFloor } from './opponent-deck-draft'
import {
  assessFillCard,
  assessPackageCard,
  isOpponentPowerCard,
  type OpponentFillCard
} from './opponent-fill-pool'
import { OPPONENT_ROLE_FLOORS } from './opponent-floors'
import { OPPONENT_PROFILES } from './opponent-profiles'
import { HERO_POWER_SUPPORT, opponentSupportRequirements } from './opponent-support'
import {
  buildOpponentStrategyBrief,
  type OpponentStrategyBrief
} from './opponent-strategy'

export type { OpponentConstructionStep } from './opponent-assembly'

export const OPPONENT_GENERATOR_VERSION = 11

const MAX_ATTEMPTS = 8

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

const supportedCapabilities = runtimeCapabilityKeys()

interface ClassPools extends OpponentAssemblyPools {
  readonly fill: readonly OpponentFillCard[]
}

const poolCache = new WeakMap<CardCatalog, Map<string, ClassPools>>()

/** Class-legal pools are pure functions of the catalog, so they are built once. */
function classPools(
  catalog: CardCatalog,
  rules: DeckRules,
  heroId: HeroId
): ClassPools {
  const heroClass = HERO_CATALOG.require(heroId).classId
  let byClass = poolCache.get(catalog)
  if (!byClass) {
    byClass = new Map()
    poolCache.set(catalog, byClass)
  }
  const cached = byClass.get(heroClass)
  if (cached) return cached
  const legal = catalog.all.filter(
    (card) =>
      (card.cardClass === 'Neutral' || card.cardClass === heroClass) &&
      !isOpponentPowerCard(card) &&
      rules.isCardAllowedInDeck({ heroId }, card)
  )
  const fill = legal
    .map(assessFillCard)
    .filter((entry): entry is OpponentFillCard => entry !== undefined)
  const packages = new Map<string, readonly OpponentFillCard[]>()
  const pools: ClassPools = {
    fill,
    packageCandidates(floor) {
      const minQuality = floor.packageMinQuality ?? 3
      const key = `${floor.tag}|${minQuality}`
      let candidates = packages.get(key)
      if (!candidates) {
        candidates = legal
          .map((card) => assessPackageCard(card, floor.tag, minQuality))
          .filter((entry): entry is OpponentFillCard => entry !== undefined)
        packages.set(key, candidates)
      }
      return candidates
    }
  }
  byClass.set(heroClass, pools)
  return pools
}

/**
 * Profile curve and role floors, then archetype overrides, then packages. Role floors
 * nothing in the pool can satisfy are dropped; packages always stay mandatory.
 */
export function resolveOpponentFloors(
  archetype: OpponentArchetype,
  fill: readonly OpponentFillCard[]
): ResolvedOpponentFloor[] {
  const floors = new Map<OpponentTag, ResolvedOpponentFloor>()
  for (const floor of [
    ...OPPONENT_PROFILES[archetype.profile].floors,
    ...OPPONENT_ROLE_FLOORS
  ])
    if (floor.min === 0 || fill.some((entry) => entry.tags.includes(floor.tag)))
      floors.set(floor.tag, floor)
  for (const floor of archetype.floorOverrides ?? []) floors.set(floor.tag, floor)
  for (const rule of archetype.packages) {
    const existing = floors.get(rule.tag)
    floors.set(rule.tag, {
      tag: rule.tag,
      min: Math.max(rule.min, existing?.min ?? 0),
      max: rule.max ?? existing?.max ?? MAX_DECK_CARDS,
      packageMinQuality: rule.minQuality ?? 3
    })
  }
  return [...floors.values()]
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
  const { heroClass, heroId, step: classStep } = selectHero(options.heroId, forced, rng)
  const catalog = options.catalog ?? CARD_CATALOG
  const rules = new DeckRules(catalog)
  const construction: OpponentConstructionStep[] = [classStep]

  // Mandatory hero card: the one deliberate inclusion every generated deck carries.
  const { heroCard, skipped, step } = pickHeroCard(
    catalog,
    rules,
    heroClass,
    heroId,
    rng
  )
  if (step) construction.push(step)
  const warnings = skipped.map((entry) => entry.reason)

  // Uniform seeded archetype pick.
  const available = OPPONENT_ARCHETYPES.filter(
    (entry) => entry.classId === heroClass && (!forced || entry === forced)
  )
  if (!available.length) throw new Error(`No opponent archetypes for ${heroClass}.`)
  const archetype = shuffled(available, rng)[0]
  const profile = OPPONENT_PROFILES[archetype.profile]
  construction.push({
    layer: 'archetype',
    selected: archetype.id,
    reason: `${archetype.plan} Curve profile: ${profile.id}.`,
    candidates: available.length,
    deckSize: 0
  })

  const fixed = fixedCards(archetype, heroCard, catalog, rules, heroId)
  for (const entry of fixed)
    if (entry.layer === 'quest')
      construction.push({
        layer: 'quest',
        selected: entry.card.id,
        reason: 'Quest archetype: the quest enters through the core.',
        candidates: 1,
        deckSize: 0
      })

  const pools = classPools(catalog, rules, heroId)
  const { assembled, attempts } = assembleWithRetries({
    archetype,
    floors: resolveOpponentFloors(archetype, pools.fill),
    fixed,
    pools,
    rng,
    supportBonus: HERO_POWER_SUPPORT[heroClass as DeckClass] ?? {}
  })
  construction.push(...assembled.trace)

  const deck: Deck = {
    id: `constructed-opponent-v${OPPONENT_GENERATOR_VERSION}-${seed}-${heroId}`,
    name: 'Challenger',
    heroId,
    cards: assembled.draft.record(),
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z'
  }
  const deckErrors = rules.validate(deck)
  if (deckErrors.length)
    throw new Error(`Invalid generated opponent: ${deckErrors.join('; ')}`)

  construction.push({
    layer: 'validation',
    selected: 'accepted',
    reason: `30 cards; class/copy legality, card support, packages and floors passed. Floors: ${assembled.floorReport}.`,
    candidates: 1,
    deckSize: MAX_DECK_CARDS
  })

  const questCard = fixed.find((entry) => entry.layer === 'quest')?.card
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
        questCardId: questCard?.id ?? null,
        heroCardId: heroCard?.id ?? null,
        skipped
      },
      strategy: buildOpponentStrategyBrief(
        archetype,
        profile,
        keyCards(archetype, assembled.draft.cards)
      ),
      diagnostics: {
        attempts,
        warnings
      }
    }
  }
}

function selectHero(
  requestedHeroId: HeroId | undefined,
  forced: OpponentArchetype | undefined,
  rng: DeterministicRng
): {
  readonly heroClass: string
  readonly heroId: HeroId
  readonly step: OpponentConstructionStep
} {
  const heroClass = requestedHeroId
    ? HERO_CATALOG.require(requestedHeroId).classId
    : (forced?.classId ?? pick(PLAYABLE_CLASSES, rng))
  const heroId =
    requestedHeroId ??
    pick(
      HERO_CATALOG.all.filter(
        (hero) => hero.deckSelectable && hero.classId === heroClass
      ),
      rng
    ).id
  if (!HERO_CATALOG.require(heroId).deckSelectable)
    throw new Error('Opponent hero is not deck selectable.')
  const explicit = Boolean(requestedHeroId || forced)
  return {
    heroClass,
    heroId,
    step: {
      layer: 'class',
      selected: heroClass,
      reason: explicit
        ? 'Explicit audit/development selection.'
        : 'Uniform seeded playable-class selection.',
      candidates: explicit ? 1 : PLAYABLE_CLASSES.length,
      deckSize: 0
    }
  }
}

function pickHeroCard(
  catalog: CardCatalog,
  rules: DeckRules,
  heroClass: string,
  heroId: HeroId,
  rng: DeterministicRng
): {
  readonly heroCard: CardDefinition | undefined
  readonly skipped: OpponentPowerCardSkip[]
  readonly step: OpponentConstructionStep | undefined
} {
  const candidates = catalog.all
    .filter(
      (card) =>
        card.type === 'Hero' &&
        card.cardClass === heroClass &&
        rules.isCardAllowedInDeck({ heroId }, card)
    )
    .sort((a, b) => a.id.localeCompare(b.id))
  if (!candidates.length)
    return {
      heroCard: undefined,
      skipped: [
        {
          kind: 'hero',
          reason: `No legal Hero card is available for ${heroClass}; skipped this bonus card.`
        }
      ],
      step: undefined
    }
  const heroCard = pick(candidates, rng)
  return {
    heroCard,
    skipped: [],
    step: {
      layer: 'hero',
      selected: heroCard.id,
      reason: `Mandatory class-legal Hero card selected from ${candidates.length} candidate${candidates.length === 1 ? '' : 's'}.`,
      candidates: candidates.length,
      deckSize: 0
    }
  }
}

/** Retry only this archetype, with the same seeded stream and unchanged quality rules. */
function assembleWithRetries(input: OpponentAssemblyInput): {
  readonly assembled: OpponentAssemblyResult
  readonly attempts: number
} {
  let errors: readonly string[] = []
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const assembled = assembleOpponentDeck(input)
    if (!assembled.errors.length) return { assembled, attempts: attempt }
    errors = assembled.errors
  }
  throw new Error(`Unable to assemble opponent: ${errors.join('; ')}`)
}

function fixedCards(
  archetype: OpponentArchetype,
  heroCard: CardDefinition | undefined,
  catalog: CardCatalog,
  rules: DeckRules,
  heroId: HeroId
): OpponentFixedCard[] {
  const fixed: OpponentFixedCard[] = heroCard
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
  if (invalidCore) throw new Error(`Ineligible opponent core card: ${invalidCore.id}`)
  for (const slot of archetype.core) {
    const card = catalog.require(slot.id)
    const quest = card.type === 'Spell' && card.quest !== undefined
    for (let copy = 0; copy < slot.count; copy++)
      fixed.push({
        card,
        layer: quest ? 'quest' : 'core',
        reason: quest
          ? 'Quest archetype inclusion; the only quest this deck may carry.'
          : 'Defining archetype card.'
      })
  }
  return fixed
}

/** Core first, then supported payoffs, then package cards; Hero cards are listed elsewhere. */
function keyCards(
  archetype: OpponentArchetype,
  cards: readonly CardDefinition[]
): CardDefinition[] {
  const coreIds = new Set(archetype.core.map((slot) => slot.id))
  const packageTags = archetype.packages.map((rule) => rule.tag)
  const rank = (card: CardDefinition): number => {
    if (coreIds.has(card.id)) return 0
    if (opponentSupportRequirements(card).length) return 1
    const tags = opponentDeckTags(card)
    return packageTags.some((tag) => tags.includes(tag)) ? 2 : 3
  }
  return cards
    .filter((card) => card.type !== 'Hero' && rank(card) < 3)
    .sort((a, b) => rank(a) - rank(b))
}
