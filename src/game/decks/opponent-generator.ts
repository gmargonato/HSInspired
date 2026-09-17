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
import { assessmentCounts } from './opponent-card-assessment'
import {
  dynamicOpponentPool,
  assessDynamicCard,
  dependencyRequirements,
  isOpponentPowerCard
} from './opponent-dynamic-pool'
import { OPPONENT_GENERATION_CONFIG } from './opponent-generation-config'
import { OPPONENT_ARCHETYPES } from './opponent-archetypes'
import type { OpponentArchetype, CuratedPackage } from './opponent-archetype'
import {
  assessCuratedCard,
  curatedCounts,
  curatedRequirements,
  validateCuratedComposition,
  type CuratedCardFacts
} from './opponent-curated-assessment'
import {
  OPPONENT_STRATEGIES,
  opponentMetrics,
  type OpponentMetric,
  type OpponentStrategyBrief
} from './opponent-strategy'

export const OPPONENT_GENERATOR_VERSION = 6
export interface OpponentConstructionStep {
  readonly layer: string
  readonly selected: string
  readonly reason: string
  readonly candidates: number
  readonly deckSize: number
}
export interface OpponentPowerCardSkip {
  readonly kind: 'quest' | 'hero'
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
  readonly variant: string
  readonly construction: readonly OpponentConstructionStep[]
  readonly version: number
  readonly seed: number
  readonly heroId: HeroId
  readonly cards: Deck['cards']
  readonly powerCards: GeneratedOpponentPowerCards
  readonly strategy: OpponentStrategyBrief
  readonly diagnostics: {
    readonly attempts: number
    readonly requestedTheme: string
    readonly fallback: boolean
    readonly metrics: Readonly<Record<OpponentMetric, number>>
    readonly requirements: readonly {
      tag: string
      minimum: number
      maximum: number
      actual: number
    }[]
    readonly rejected: readonly {
      candidate: string
      attempts: number
      reason: string
    }[]
    readonly warnings: readonly string[]
  }
}
export interface GeneratedOpponent {
  readonly deck: Deck
  readonly metadata: GeneratedOpponentMetadata
}
function pick<T>(values: readonly T[], rng: DeterministicRng): T {
  if (!values.length) throw new Error('No eligible curated opponent candidates.')
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
  values: readonly CuratedCardFacts[],
  weight: (card: CuratedCardFacts) => number,
  rng: DeterministicRng
): CuratedCardFacts {
  const weights = values.map(weight)
  let roll = rng.next() * weights.reduce((a, b) => a + b, 0)
  for (let index = 0; index < values.length; index++) {
    roll -= weights[index]
    if (roll < 0) return values[index]
  }
  return values[values.length - 1]
}

const supportedCapabilities = runtimeCapabilityKeys()
const factsCache = new WeakMap<object, CuratedCardFacts>()
function facts(id: string, catalog: CardCatalog): CuratedCardFacts {
  const card = catalog.require(id)
  const cached = factsCache.get(card)
  if (cached) return cached
  const capability = inspectCardCapabilities(card, supportedCapabilities)
  if (!capability.supported)
    throw new Error(`Curated card ${id} has unsupported runtime mechanics.`)
  const raw = assessDynamicCard(card) ?? assessCuratedCard(card)
  const result = {
    ...raw,
    tags: [
      ...new Set([
        ...raw.tags,
        ...(raw.threat ? ['threat'] : []),
        ...(card.cardClass !== 'Neutral' ? ['class-card'] : [])
      ])
    ]
  }
  factsCache.set(card, result)
  return result
}

/** Power cards occupy deck slots but do not count as ordinary archetype support. */
function powerFacts(card: CardDefinition): CuratedCardFacts {
  const raw = assessCuratedCard(card)
  return {
    ...raw,
    quality: 0,
    board: false,
    early: false,
    interaction: false,
    resource: false,
    threat: false,
    narrow: false,
    dependent: false,
    tags: [],
    provides: [],
    needs: []
  }
}

interface PowerCardSelection {
  readonly kind: 'quest' | 'hero'
  readonly card: CuratedCardFacts | null
  readonly cardId: CardId | null
  readonly candidates: number
  readonly warning?: string
}

interface ForcedCard {
  readonly card: CuratedCardFacts
  readonly layer: 'quest' | 'hero-card' | 'anchor'
  readonly reason: string
  readonly candidates: number
}

function selectPowerCard(
  kind: PowerCardSelection['kind'],
  heroClass: string,
  heroId: HeroId,
  rng: DeterministicRng,
  catalog: CardCatalog,
  rules: DeckRules,
  enabled: boolean
): PowerCardSelection {
  if (!enabled) return { kind, card: null, cardId: null, candidates: 0 }

  const candidates = catalog.all
    .filter((card) => {
      const correctType =
        kind === 'quest'
          ? card.type === 'Spell' && card.quest !== undefined
          : card.type === 'Hero'
      return (
        correctType &&
        card.cardClass === heroClass &&
        rules.isCardAllowedInDeck({ heroId }, card)
      )
    })
    .sort((a, b) => a.id.localeCompare(b.id))

  if (!candidates.length) {
    return {
      kind,
      card: null,
      cardId: null,
      candidates: 0,
      warning: `No legal ${kind} Card ID is available for ${heroClass}; skipped this bonus card.`
    }
  }

  const selected = pick(candidates, rng)
  return {
    kind,
    card: powerFacts(selected),
    cardId: selected.id,
    candidates: candidates.length
  }
}

function configuredAnchorCards(
  archetype: OpponentArchetype,
  heroId: HeroId,
  catalog: CardCatalog,
  rules: DeckRules
): ForcedCard[] {
  const configured =
    OPPONENT_GENERATION_CONFIG.archetypeExtraCardIds[archetype.id] ?? []
  const seen = new Set<string>()
  return configured.map((cardId) => {
    if (seen.has(cardId))
      throw new Error(
        `Opponent generation config repeats anchor Card ID ${cardId} for ${archetype.id}.`
      )
    seen.add(cardId)
    const card = catalog.get(cardId)
    if (!card)
      throw new Error(
        `Opponent generation config references missing anchor Card ID ${cardId} for ${archetype.id}.`
      )
    if (isOpponentPowerCard(card))
      throw new Error(
        `Opponent generation anchor Card ID ${cardId} for ${archetype.id} must not be a Quest or Hero card.`
      )
    if (!rules.isCardAllowedInDeck({ heroId }, card))
      throw new Error(
        `Opponent generation anchor Card ID ${cardId} is not legal for ${archetype.classId}.`
      )
    return {
      card: facts(cardId, catalog),
      layer: 'anchor' as const,
      reason: `Configured Card ID anchor for ${archetype.id}; the remaining deck is still filled from the live catalog.`,
      candidates: 1
    }
  })
}

function assemble(
  archetype: OpponentArchetype,
  variant: CuratedPackage,
  rng: DeterministicRng,
  trace: OpponentConstructionStep[],
  pool: readonly CuratedCardFacts[],
  catalog: CardCatalog,
  heroId: HeroId,
  forcedCards: readonly ForcedCard[]
): { cards: CuratedCardFacts[]; errors: string[] } {
  const limit = (card: CuratedCardFacts): number =>
    Math.min(getCardCopyLimit(card.card), archetype.maxCopies?.[card.card.id] ?? 2)
  const cards: CuratedCardFacts[] = []
  const counts = new Map<string, number>()
  const add = (
    card: CuratedCardFacts,
    layer: string,
    reason: string,
    candidates: number
  ): void => {
    cards.push(card)
    counts.set(card.card.id, (counts.get(card.card.id) ?? 0) + 1)
    trace.push({
      layer,
      selected: card.card.id,
      reason,
      candidates,
      deckSize: cards.length
    })
  }
  for (const forced of forcedCards.filter((entry) => entry.layer !== 'anchor')) {
    if ((counts.get(forced.card.card.id) ?? 0) >= limit(forced.card))
      return {
        cards,
        errors: [`${forced.card.card.id}: mandatory/package copy conflict`]
      }
    add(forced.card, forced.layer, forced.reason, forced.candidates)
  }
  for (const [layer, slots] of [['core', archetype.core]] as const) {
    for (const slot of slots)
      for (let copy = 0; copy < slot.count; copy++) {
        const card = facts(slot.id, catalog)
        if ((counts.get(slot.id) ?? 0) >= limit(card))
          return { cards, errors: [`${slot.id}: core/package copy conflict`] }
        add(
          card,
          layer,
          'Defining archetype card; supporting cards are chosen from live mechanics.',
          1
        )
      }
  }
  for (const forced of forcedCards.filter((entry) => entry.layer === 'anchor')) {
    if ((counts.get(forced.card.card.id) ?? 0) >= limit(forced.card))
      return {
        cards,
        errors: [`${forced.card.card.id}: mandatory/package copy conflict`]
      }
    add(forced.card, forced.layer, forced.reason, forced.candidates)
  }
  const requirementsFor = (selected: readonly CuratedCardFacts[]) => {
    const merged = new Map<string, { tag: string; minimum: number; maximum: number }>()
    for (const rule of [
      ...curatedRequirements(archetype, selected),
      ...variant.requirements,
      ...dependencyRequirements(selected, heroId)
    ]) {
      const previous = merged.get(rule.tag)
      merged.set(rule.tag, {
        tag: rule.tag,
        minimum: Math.max(rule.minimum, previous?.minimum ?? 0),
        maximum: Math.min(rule.maximum, previous?.maximum ?? 30)
      })
    }
    return [...merged.values()]
  }
  while (cards.length < 30) {
    const requirements = requirementsFor(cards)
    const current = curatedCounts(cards)
    const legal = pool.filter(
      (card) =>
        (counts.get(card.card.id) ?? 0) < limit(card) &&
        requirements.every(
          (rule) =>
            (current[rule.tag] ?? 0) + Number(card.tags.includes(rule.tag)) <=
            rule.maximum
        )
    )
    const gaps = requirements.filter((rule) => (current[rule.tag] ?? 0) < rule.minimum)
    // Resolve the most constrained unmet role before spending flexible slots.
    const capacity = (tag: string): number =>
      legal
        .filter((card) => card.tags.includes(tag))
        .reduce(
          (total, card) => total + limit(card) - (counts.get(card.card.id) ?? 0),
          0
        )
    gaps.sort(
      (a, b) =>
        capacity(a.tag) / (a.minimum - (current[a.tag] ?? 0)) -
        capacity(b.tag) / (b.minimum - (current[b.tag] ?? 0))
    )
    const target = gaps[0]
    const choices = legal
      .filter((card) => !target || card.tags.includes(target.tag))
      .filter((card) => {
        const future = [...cards, card]
        const totals = curatedCounts(future)
        return requirementsFor(future).every((rule) => {
          const actual = totals[rule.tag] ?? 0
          if (actual > rule.maximum || rule.minimum - actual > 30 - future.length)
            return false
          const available = pool
            .filter((entry) => entry.tags.includes(rule.tag))
            .reduce(
              (total, entry) =>
                total +
                Math.max(
                  0,
                  limit(entry) -
                    (counts.get(entry.card.id) ?? 0) -
                    Number(entry === card)
                ),
              0
            )
          return actual + available >= rule.minimum
        })
      })
    if (!choices.length)
      return {
        cards,
        errors: [
          `No compatible slots remain for ${target?.tag ?? 'completion'} at ${cards.length}/30. Unreachable: ${requirements
            .filter(
              (rule) => (current[rule.tag] ?? 0) + capacity(rule.tag) < rule.minimum
            )
            .map(
              (rule) =>
                rule.tag +
                ':' +
                (current[rule.tag] ?? 0) +
                '+' +
                capacity(rule.tag) +
                '<' +
                rule.minimum
            )
            .join(', ')}.`
        ]
      }
    // Avoid weak filler when stronger cards can satisfy the same role.
    const best = Math.max(...choices.map((card) => card.quality))
    const competitive = choices.filter((card) => card.quality >= best - 1)
    const selected = weightedPick(
      competitive,
      (card) =>
        card.quality ** 5 *
        (archetype.preferences.some((tag) => card.tags.includes(tag)) ? 3 : 1) *
        (variant.preferences.some((tag) => card.tags.includes(tag)) ? 1.8 : 1) *
        (card.card.cardClass === archetype.classId ? 2 : 1) *
        (1 + gaps.filter((rule) => card.tags.includes(rule.tag)).length * 2) *
        ((counts.get(card.card.id) ?? 0) === 1 ? 1.5 : 1),
      rng
    )
    add(
      selected,
      target ? 'support-role' : 'flex',
      target
        ? `${target.tag}: ${current[target.tag] ?? 0}/${target.minimum}; choose a live-catalog card by quality, archetype/variant affinity, overlapping gaps and copy consistency.`
        : 'Live-catalog flexible slot; preserve dependencies and curve limits. Weighted by quality, archetype/variant affinity and copy consistency.',
      competitive.length
    )
  }
  return {
    cards,
    errors: validateCuratedComposition(
      archetype,
      cards,
      requirementsFor(cards),
      new Set([
        ...pool.map((card) => card.card.id),
        ...archetype.core.map((slot) => slot.id),
        ...forcedCards.map((entry) => entry.card.card.id)
      ])
    )
  }
}

/** Pure local generation. No human deck, clock, network, or match RNG is consulted. */
export function generateConstructedOpponent(
  seed: number,
  options: {
    readonly heroId?: HeroId
    readonly strategy?: string
    readonly archetypeId?: string
    readonly variantId?: string
    readonly catalog?: CardCatalog
  } = {}
): GeneratedOpponent {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error('Opponent seed must be uint32.')
  const strategy = OPPONENT_STRATEGIES[options.strategy ?? 'midrange-tempo']
  if (!strategy) throw new Error(`Unsupported opponent strategy: ${options.strategy}`)
  const rng = createSeededRng(seed ^ 0x74656d70)
  const forced = options.archetypeId
    ? OPPONENT_ARCHETYPES.find((entry) => entry.id === options.archetypeId)
    : undefined
  if (options.archetypeId && !forced)
    throw new Error(`Unknown curated archetype: ${options.archetypeId}`)
  if (options.variantId && !forced)
    throw new Error('A forced variant requires an archetype.')
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
  const powerSelections = [
    selectPowerCard(
      'quest',
      heroClass,
      heroId,
      rng,
      catalog,
      rules,
      OPPONENT_GENERATION_CONFIG.alwaysIncludeQuest
    ),
    selectPowerCard(
      'hero',
      heroClass,
      heroId,
      rng,
      catalog,
      rules,
      OPPONENT_GENERATION_CONFIG.alwaysIncludeHero
    )
  ] as const
  const powerCards: ForcedCard[] = powerSelections.flatMap((selection) =>
    selection.card
      ? [
          {
            card: selection.card,
            layer:
              selection.kind === 'quest' ? ('quest' as const) : ('hero-card' as const),
            reason: `Mandatory class-legal ${selection.kind} bonus selected from ${selection.candidates} seeded Card ID candidate${selection.candidates === 1 ? '' : 's'}.`,
            candidates: selection.candidates
          }
        ]
      : []
  )
  const skippedPowerCards: OpponentPowerCardSkip[] = powerSelections.flatMap(
    (selection) =>
      selection.warning ? [{ kind: selection.kind, reason: selection.warning }] : []
  )
  const warnings = skippedPowerCards.map((entry) => entry.reason)
  const available = OPPONENT_ARCHETYPES.filter(
    (entry) =>
      entry.classId === heroClass &&
      entry.strategy === strategy.id &&
      (!forced || entry === forced)
  )
  if (!available.length)
    throw new Error(`No curated ${strategy.id} archetypes for ${heroClass}.`)
  const ordered = shuffled(available, rng)
  const requested = ordered[0].id
  let attempts = 0
  const rejected: { candidate: string; attempts: number; reason: string }[] = []
  for (const archetype of ordered) {
    const variants = shuffled(
      archetype.variants.filter(
        (entry) => !options.variantId || entry.id === options.variantId
      ),
      rng
    )
    if (!variants.length)
      throw new Error(`Unknown variant ${options.variantId} for ${archetype.id}.`)
    for (const variant of variants) {
      const anchors = configuredAnchorCards(archetype, heroId, catalog, rules)
      const forcedCards = [...powerCards, ...anchors]
      const pool = dynamicOpponentPool(archetype, catalog.all).filter(
        (card) => !isOpponentPowerCard(card.card)
      )
      const ids = [
        ...new Set([
          ...archetype.core.map((slot) => slot.id),
          ...forcedCards.map((entry) => entry.card.card.id),
          ...pool.map((card) => card.card.id)
        ])
      ]
      const invalid = archetype.core.find(
        (slot) =>
          !catalog.get(slot.id) ||
          !rules.isCardAllowedInDeck({ heroId }, facts(slot.id, catalog).card)
      )?.id
      if (invalid) {
        rejected.push({
          candidate: `${archetype.id}/${variant.id}`,
          attempts: 0,
          reason: `Ineligible curated card: ${invalid}`
        })
        continue
      }
      let lastError = ''
      for (let attempt = 0; attempt < strategy.attempts; attempt++) {
        attempts++
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
          },
          ...powerSelections.map((selection) => ({
            layer: selection.kind === 'quest' ? 'quest' : 'hero-card',
            selected: selection.cardId ?? 'skipped',
            reason:
              selection.warning ??
              `Mandatory class-legal ${selection.kind} bonus selected from ${selection.candidates} seeded Card ID candidate${selection.candidates === 1 ? '' : 's'}.`,
            candidates: selection.candidates,
            deckSize: 0
          })),
          {
            layer: 'strategy',
            selected: strategy.id,
            reason: strategy.objective,
            candidates: 1,
            deckSize: 0
          },
          {
            layer: 'archetype',
            selected: archetype.id,
            reason: archetype.plan,
            candidates: available.length,
            deckSize: 0
          },
          {
            layer: 'variant',
            selected: variant.id,
            reason: variant.reason,
            candidates: variants.length,
            deckSize: 0
          },
          {
            layer: 'pool-filter',
            selected: archetype.id,
            reason:
              'Scan the current catalog for legal, recognized mechanics that fit this archetype; filter weak cards and unrelated dependencies.',
            candidates: ids.length,
            deckSize: 0
          }
        ]
        if (attempt > 0)
          construction.push({
            layer: 'retry',
            selected: `${archetype.id}/${variant.id}`,
            reason: `Previous assembly rejected: ${lastError}. Retry ${attempt + 1} keeps the same core and package.`,
            candidates: 1,
            deckSize: 0
          })
        for (const entry of rejected)
          construction.push({
            layer: 'fallback',
            selected: entry.candidate,
            reason: `Rejected after ${entry.attempts} attempts: ${entry.reason} Trying another curated package; no generic fallback.`,
            candidates: 0,
            deckSize: 0
          })
        const result = assemble(
          archetype,
          variant,
          rng,
          construction,
          pool,
          catalog,
          heroId,
          forcedCards
        )
        if (result.errors.length) {
          lastError = result.errors.join('; ')
          continue
        }
        const deck: Deck = {
          id: `constructed-opponent-v${OPPONENT_GENERATOR_VERSION}-${seed}-${heroId}`,
          name: 'Challenger',
          heroId,
          cards: assessmentCounts(result.cards),
          createdAt: '1970-01-01T00:00:00.000Z',
          updatedAt: '1970-01-01T00:00:00.000Z'
        }
        const errors = rules.validate(deck)
        if (errors.length)
          throw new Error(`Invalid curated opponent: ${errors.join('; ')}`)
        const totals = curatedCounts(result.cards)
        const requirements = [
          ...curatedRequirements(archetype, result.cards),
          ...variant.requirements,
          ...dependencyRequirements(result.cards, heroId)
        ].map((rule) => ({ ...rule, actual: totals[rule.tag] ?? 0 }))
        construction.push({
          layer: 'validation',
          selected: 'accepted',
          reason: `30 cards; class/copy legality, mandatory core and package support passed. ${requirements.map((rule) => `${rule.tag}=${rule.actual} [${rule.minimum}..${rule.maximum}]`).join('; ')}. Attempts: ${attempts}.`,
          candidates: 1,
          deckSize: 30
        })
        return {
          deck,
          metadata: {
            core: archetype.core[0].id,
            coreCards: archetype.core,
            archetype: archetype.id,
            variant: variant.id,
            version: OPPONENT_GENERATOR_VERSION,
            seed,
            heroId,
            cards: { ...deck.cards },
            powerCards: {
              questCardId:
                powerSelections.find((selection) => selection.kind === 'quest')
                  ?.cardId ?? null,
              heroCardId:
                powerSelections.find((selection) => selection.kind === 'hero')
                  ?.cardId ?? null,
              skipped: skippedPowerCards
            },
            construction,
            strategy: {
              strategy: strategy.id,
              theme: archetype.id,
              text: `Original deck: ${archetype.name} (${variant.id}). Current state overrides this plan. ${archetype.plan} Variant: ${variant.reason} Mulligan: ${archetype.mulligan} Selected support: ${[...new Set(result.cards.filter((card) => archetype.preferences.some((tag) => card.tags.includes(tag))).map((card) => card.card.name))].slice(0, 6).join(', ')}.`
            },
            diagnostics: {
              attempts,
              requestedTheme: requested,
              fallback: rejected.length > 0,
              metrics: opponentMetrics(result.cards),
              requirements,
              rejected,
              warnings
            }
          }
        }
      }
      rejected.push({
        candidate: `${archetype.id}/${variant.id}`,
        attempts: strategy.attempts,
        reason: lastError
      })
    }
  }
  throw new Error(
    `Unable to assemble curated opponent for ${heroClass}: ${rejected.map((entry) => `${entry.candidate}: ${entry.reason}`).join('; ')}`
  )
}
