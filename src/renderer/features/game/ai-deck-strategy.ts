import type { Deck } from '../../../game/decks'
import {
  CARD_CONDITIONS,
  CARD_CATALOG,
  isCardEffectObject,
  type CardDefinition
} from '../../../game/content/cards'
import type {
  AiCardRole,
  AiDeckPlan,
  AiDeckPlanCombo,
  AiDeckPlanRequest,
  JsonObject
} from '../../../shared/ipc/ai'

export const AI_DECK_PLAN_PROMPT_VERSION = 'automatic-deck-plan-v1'
export const AI_DECK_PLAN_SCHEMA_VERSION = 1

interface CardSignals {
  readonly produces: readonly string[]
  readonly requires: readonly string[]
  readonly actions: readonly string[]
}

const CARD_CONDITION_TYPES = new Set<string>(CARD_CONDITIONS)

export interface DeckSynergy {
  readonly producerCardId: string
  readonly consumerCardId: string
  readonly signal: string
}

function toJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject
}

function walkRecords(
  value: unknown,
  visit: (record: Record<string, unknown>) => void
): void {
  if (Array.isArray(value)) {
    for (const entry of value) walkRecords(entry, visit)
    return
  }
  if (typeof value !== 'object' || value === null) return
  const record = value as Record<string, unknown>
  visit(record)
  for (const nested of Object.values(record)) walkRecords(nested, visit)
}

function normalizedConditionSignal(type: string): string | null {
  // Event names and target descriptors also use a `type` field. Only authored
  // condition types describe a resource the deck must deliberately provide.
  if (!CARD_CONDITION_TYPES.has(type)) return null
  const normalized = type
    .replace(/^target-/, '')
    .replace(/^player-/, '')
    .replace(/^character-/, '')
    .replace(/^has-/, '')
    .replace(/^controls-/, '')
  if (normalized === 'not-frozen') return null
  if (normalized.includes('frozen')) return 'frozen'
  if (normalized.includes('damage')) return 'damaged'
  if (normalized.includes('secret')) return 'secret'
  if (normalized.includes('weapon')) return 'weapon'
  if (normalized.includes('demon')) return 'demon'
  if (normalized.includes('minion')) return 'minion'
  if (normalized.includes('spell')) return 'spell'
  return null
}

function signalsFor(definition: CardDefinition): CardSignals {
  const actions = new Set<string>()
  const produces = new Set<string>()
  const requires = new Set<string>()
  walkRecords(definition.effects, (record) => {
    if (typeof record['action'] === 'string') {
      const action = record['action']
      actions.add(action)
      if (action === 'freeze') produces.add('frozen')
      if (action === 'damage') produces.add('damaged')
      if (
        action === 'summon' ||
        action === 'summon-copy' ||
        action === 'summon-for-each' ||
        action === 'summon-random' ||
        action === 'put-into-play' ||
        action === 'resurrect'
      )
        produces.add('minion')
      if (action === 'equip' || action === 'equip-random') produces.add('weapon')
    }
    if (typeof record['keyword'] === 'string') produces.add(record['keyword'])
    if (typeof record['type'] === 'string') {
      const signal = normalizedConditionSignal(record['type'])
      if (signal) requires.add(signal)
      // A friendly target/filter is also a real structural dependency (for
      // example Deadly Poison needs a weapon). Do not treat `any` or opposing
      // targets as deck synergies: that would make removal such as Polymorph
      // look dependent on running minions in our own deck.
      if (record['controller'] === 'self') {
        if (record['type'] === 'minion') requires.add('minion')
        if (record['type'] === 'weapon') requires.add('weapon')
      }
    }
  })
  for (const keyword of definition.keywords ?? []) produces.add(keyword)
  if (definition.type === 'Minion') {
    produces.add('minion')
    if (definition.subtype && definition.subtype !== 'General')
      produces.add(String(definition.subtype).toLowerCase())
  }
  if (definition.type === 'Weapon') produces.add('weapon')
  if (definition.type === 'Spell') {
    produces.add('spell')
    if (definition.spellSchool)
      produces.add(String(definition.spellSchool).toLowerCase())
  }
  return { actions: [...actions], produces: [...produces], requires: [...requires] }
}

export function deriveDeckSynergies(deck: Deck): readonly DeckSynergy[] {
  const definitions = Object.keys(deck.cards).map((cardId) =>
    CARD_CATALOG.require(cardId)
  )
  const signals = new Map(
    definitions.map((definition) => [definition.id, signalsFor(definition)])
  )
  const result: DeckSynergy[] = []
  for (const producer of definitions) {
    const producerSignals = signals.get(producer.id)!
    for (const consumer of definitions) {
      if (producer.id === consumer.id && (deck.cards[producer.id] ?? 0) < 2) continue
      const consumerSignals = signals.get(consumer.id)!
      for (const signal of producerSignals.produces) {
        if (!consumerSignals.requires.includes(signal)) continue
        result.push({
          producerCardId: producer.id,
          consumerCardId: consumer.id,
          signal
        })
      }
    }
  }
  return result
}

function compactDefinition(definition: CardDefinition): JsonObject {
  return toJsonObject({
    id: definition.id,
    name: definition.name,
    type: definition.type,
    cardClass: definition.cardClass,
    subtype: definition.subtype,
    spellSchool: definition.spellSchool,
    cost: definition.cost,
    rulesText: definition.rulesText,
    keywords: definition.keywords,
    // Authored effects are the mechanical source of truth. Supplying them is
    // what lets planning work for newly-authored and nonstandard cards without
    // relying on model memory or parsing display-only rules text.
    effects: definition.effects,
    ...(definition.type === 'Minion'
      ? { attack: definition.attack, health: definition.health }
      : {}),
    ...(definition.type === 'Weapon'
      ? { attack: definition.attack, durability: definition.durability }
      : {}),
    ...(definition.type === 'Hero'
      ? { armor: definition.armor, replacementHeroId: definition.replacementHeroId }
      : {})
  })
}

export function createDeckPlanRequest(
  deck: Deck,
  deadlineAtMs: number
): AiDeckPlanRequest {
  const cards = Object.entries(deck.cards).map(([cardId, count]) => {
    const definition = CARD_CATALOG.require(cardId)
    return { count, definition: compactDefinition(definition) }
  })
  return {
    planId: `deck-plan-${deck.id}-${Date.now()}`,
    decisionClass: 'deck-plan',
    promptVersion: AI_DECK_PLAN_PROMPT_VERSION,
    schemaVersion: AI_DECK_PLAN_SCHEMA_VERSION,
    deadlineAtMs,
    mode: toJsonObject({
      id: 'constructed',
      objective: 'Defeat the opposing hero.',
      informationPolicy: 'fair',
      deckSize: 30,
      maximumBoardSize: 7
    }),
    deck: toJsonObject({
      id: deck.id,
      name: deck.name,
      heroId: deck.heroId,
      cards,
      structuredSynergies: deriveDeckSynergies(deck)
    })
  }
}

function rolesFor(definition: CardDefinition): readonly AiCardRole[] {
  const signals = signalsFor(definition)
  const roles = new Set<AiCardRole>()
  if (
    signals.actions.some(
      (action) =>
        action === 'draw' ||
        action === 'draw-until' ||
        action === 'discover' ||
        action === 'add-to-hand'
    )
  )
    roles.add('draw')
  if (
    signals.actions.some(
      (action) =>
        action === 'damage' ||
        action.startsWith('destroy') ||
        action === 'silence' ||
        action.startsWith('transform') ||
        action === 'take-control'
    )
  ) {
    roles.add('removal')
    if (signals.actions.includes('damage')) roles.add('finisher')
  }
  if (
    signals.actions.some(
      (action) =>
        action === 'restore' ||
        action === 'gain-armor' ||
        action === 'set-health' ||
        action === 'prevent-lethal'
    )
  ) {
    roles.add('survival')
  }
  if (
    definition.type === 'Minion' ||
    signals.actions.some(
      (action) =>
        action.startsWith('summon') ||
        action === 'put-into-play' ||
        action === 'resurrect'
    )
  )
    roles.add('tempo')
  if (signals.requires.length > 0) roles.add('combo-piece')
  if (roles.size === 0) roles.add('flex')
  return [...roles]
}

function fallbackCombos(synergies: readonly DeckSynergy[]): readonly AiDeckPlanCombo[] {
  return synergies.map((synergy) => ({
    cardIds: [synergy.producerCardId, synergy.consumerCardId],
    purpose: `${synergy.producerCardId} creates ${synergy.signal} for ${synergy.consumerCardId}.`
  }))
}

/**
 * Reserved resources for the deterministic plan: conditional combo enablers
 * only. A consumer is reserved when it cannot function without its required
 * resource and that resource is not the generic presence of minions (so Ice
 * Lance and Power Overwhelming are preserved while unconditional removal such
 * as Flamestrike stays freely castable). A producer is reserved only when it
 * is one of very few in-deck sources of a specific consumed signal (setup
 * cards like Frostbolt for Ice Lance). Generic payoff bodies are never
 * reserved; reserving every card that merely participates in a synergy starves
 * normal development and poisons both fallback and search scoring.
 */
function reservedResourceCardIds(synergies: readonly DeckSynergy[]): readonly string[] {
  const producersBySignal = new Map<string, Set<string>>()
  for (const synergy of synergies) {
    const producers = producersBySignal.get(synergy.signal) ?? new Set<string>()
    producers.add(synergy.producerCardId)
    producersBySignal.set(synergy.signal, producers)
  }
  const buffsFriendlyMinions = (cardId: string): boolean => {
    const definition = CARD_CATALOG.get(cardId)
    return (definition?.effects ?? []).some((trigger) =>
      (trigger.actions ?? []).some((action) => {
        const target = isCardEffectObject(action.target) ? action.target : null
        return (
          action.action === 'modify' &&
          typeof action.attack === 'number' &&
          action.attack > 0 &&
          (target?.['controller'] === 'self' || target?.['controller'] === 'any') &&
          target['type'] === 'minion'
        )
      })
    )
  }
  const reserved = new Set<string>()
  for (const synergy of synergies) {
    const genericMinionSignal = synergy.signal === 'minion'
    if (
      CARD_CATALOG.get(synergy.consumerCardId)?.type !== 'Minion' &&
      (!genericMinionSignal || buffsFriendlyMinions(synergy.consumerCardId))
    )
      reserved.add(synergy.consumerCardId)
    if (!genericMinionSignal && (producersBySignal.get(synergy.signal)?.size ?? 0) <= 3)
      reserved.add(synergy.producerCardId)
  }
  return [...reserved]
}

export function createFallbackDeckPlan(deck: Deck): AiDeckPlan {
  const definitions = Object.keys(deck.cards).map((cardId) =>
    CARD_CATALOG.require(cardId)
  )
  const synergies = deriveDeckSynergies(deck).slice(0, 12)
  const combos = fallbackCombos(synergies)
  const averageCost =
    definitions.reduce(
      (total, definition) => total + definition.cost * (deck.cards[definition.id] ?? 0),
      0
    ) /
    Math.max(
      1,
      Object.values(deck.cards).reduce((total, count) => total + count, 0)
    )
  const archetype =
    combos.length > 0
      ? 'detected synergy / combo plan'
      : averageCost <= 3
        ? 'low-curve board pressure'
        : 'board-centric value and pressure'
  const lowCostCards = definitions
    .filter((definition) => definition.cost <= 2)
    .sort((left, right) => left.cost - right.cost)
    .slice(0, 15)
    .map((definition) => definition.id)
  // Reserve only conditional combo enablers (see reservedResourceCardIds).
  const reservedComboCardIds = new Set(reservedResourceCardIds(synergies))
  const seenResourceRules = new Set<string>()
  const resourceRules = combos.flatMap((combo) => {
    const cardIds = [
      ...new Set(combo.cardIds.filter((cardId) => reservedComboCardIds.has(cardId)))
    ]
    if (cardIds.length === 0) return []
    const key = [...cardIds].sort().join('|')
    if (seenResourceRules.has(key)) return []
    seenResourceRules.add(key)
    return [
      {
        cardIds,
        preserveUntil: `The linked package is ready: ${combo.purpose}`,
        releaseWhen:
          'Use for lethal, forced survival, a completed combo, redundancy, a critical threat, or an invalidated plan.',
        releaseTriggers: [
          'lethal',
          'forced-survival',
          'combo-ready',
          'redundant-copy',
          'invalidated-combo',
          'critical-threat'
        ] as const
      }
    ]
  })
  return {
    planVersion: 1,
    archetype,
    primaryWinCondition:
      combos.length > 0
        ? 'Assemble the detected synergy packages and convert them into decisive tempo or damage.'
        : 'Develop efficient threats and convert board advantage into lethal damage.',
    secondaryWinCondition: 'Win through sustained board, card, and health advantage.',
    earlyGamePriority:
      'Contest the board efficiently while retaining essential synergy pieces.',
    midGamePriority:
      'Advance the strongest detected package without conceding forced survival.',
    lateGamePriority: 'Convert retained damage and board resources into lethal.',
    cardRoles: definitions.map((definition) => ({
      cardId: definition.id,
      roles: rolesFor(definition)
    })),
    combos,
    resourceRules,
    mulliganPriorityCardIds: lowCostCards
  }
}

export function validateDeckPlanForDeck(plan: AiDeckPlan, deck: Deck): AiDeckPlan {
  const available = new Set(Object.keys(deck.cards))
  const referenced = [
    ...plan.cardRoles.map((entry) => entry.cardId),
    ...plan.combos.flatMap((entry) => entry.cardIds),
    ...plan.resourceRules.flatMap((entry) => entry.cardIds),
    ...plan.mulliganPriorityCardIds
  ]
  const invalid = referenced.find((cardId) => !available.has(cardId))
  if (invalid)
    throw new Error(`AI deck plan references card ${invalid} outside its deck.`)
  const roleCardIds = plan.cardRoles.map((entry) => entry.cardId)
  if (
    new Set(roleCardIds).size !== roleCardIds.length ||
    roleCardIds.length !== available.size ||
    [...available].some((cardId) => !roleCardIds.includes(cardId))
  ) {
    throw new Error('AI deck plan must assign roles to every distinct deck card once.')
  }
  for (const combo of plan.combos) {
    if (combo.cardIds.length === 0) {
      throw new Error('AI deck plan combos must contain at least one card.')
    }
    const required = new Map<string, number>()
    for (const cardId of combo.cardIds) {
      required.set(cardId, (required.get(cardId) ?? 0) + 1)
    }
    for (const [cardId, count] of required) {
      if (count > (deck.cards[cardId] ?? 0)) {
        throw new Error(
          `AI deck plan combo requires ${count} copies of ${cardId}, but the deck has fewer.`
        )
      }
    }
  }
  if (plan.resourceRules.some((rule) => rule.cardIds.length === 0)) {
    throw new Error('AI deck plan resource rules must contain at least one card.')
  }
  return plan
}

export function reservedCardIds(plan: AiDeckPlan): ReadonlySet<string> {
  return new Set(plan.resourceRules.flatMap((rule) => rule.cardIds))
}
