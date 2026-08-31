import type { Deck } from '../../../game/decks'
import { CARD_CATALOG, type CardDefinition } from '../../../game/content/cards'
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
  const normalized = type
    .replace(/^target-/, '')
    .replace(/^player-/, '')
    .replace(/^character-/, '')
    .replace(/^has-/, '')
    .replace(/^controls-/, '')
  if (normalized === 'not-frozen') return null
  if (normalized.includes('frozen')) return 'frozen'
  if (normalized.includes('damaged')) return 'damaged'
  if (normalized.includes('secret')) return 'secret'
  if (normalized.includes('weapon')) return 'weapon'
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
      if (action === 'summon' || action === 'summon-copy') produces.add('minion')
      if (action === 'equip-weapon') produces.add('weapon')
    }
    if (typeof record['keyword'] === 'string') produces.add(record['keyword'])
    if (typeof record['type'] === 'string') {
      const signal = normalizedConditionSignal(record['type'])
      if (signal) requires.add(signal)
    }
  })
  for (const keyword of definition.keywords ?? []) produces.add(keyword)
  if (definition.type === 'Minion') produces.add('minion')
  if (definition.type === 'Weapon') produces.add('weapon')
  if (definition.type === 'Spell') produces.add('spell')
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
    cost: definition.cost,
    rulesText: definition.rulesText,
    keywords: definition.keywords,
    effects: definition.effects,
    ...(definition.type === 'Minion'
      ? { attack: definition.attack, health: definition.health }
      : {}),
    ...(definition.type === 'Weapon'
      ? { attack: definition.attack, durability: definition.durability }
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
  if (signals.actions.includes('draw')) roles.add('draw')
  if (signals.actions.includes('damage') || signals.actions.includes('destroy')) {
    roles.add('removal')
    roles.add('finisher')
  }
  if (
    signals.actions.includes('heal') ||
    signals.actions.includes('gain-armor') ||
    signals.actions.includes('give-armor')
  ) {
    roles.add('survival')
  }
  if (definition.type === 'Minion' || signals.actions.includes('summon'))
    roles.add('tempo')
  if (signals.requires.length > 0) roles.add('combo-piece')
  if (roles.size === 0) roles.add('flex')
  return [...roles]
}

function fallbackCombos(deck: Deck): readonly AiDeckPlanCombo[] {
  return deriveDeckSynergies(deck)
    .slice(0, 12)
    .map((synergy) => ({
      cardIds: [synergy.producerCardId, synergy.consumerCardId],
      purpose: `${synergy.producerCardId} creates ${synergy.signal} for ${synergy.consumerCardId}.`
    }))
}

export function createFallbackDeckPlan(deck: Deck): AiDeckPlan {
  const definitions = Object.keys(deck.cards).map((cardId) =>
    CARD_CATALOG.require(cardId)
  )
  const combos = fallbackCombos(deck)
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
    combos.length > 0 ? 'combo' : averageCost <= 3 ? 'aggro' : 'midrange'
  const lowCostCards = definitions
    .filter((definition) => definition.cost <= 2)
    .sort((left, right) => left.cost - right.cost)
    .slice(0, 15)
    .map((definition) => definition.id)
  const comboCardIds = [...new Set(combos.flatMap((combo) => combo.cardIds))]
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
    resourceRules:
      comboCardIds.length === 0
        ? []
        : [
            {
              cardIds: comboCardIds,
              preserveUntil: 'The linked synergy can be completed efficiently.',
              releaseWhen:
                'Use for lethal, forced survival, or a clearly stronger winning line.'
            }
          ],
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
  return plan
}

export function reservedCardIds(plan: AiDeckPlan): ReadonlySet<string> {
  return new Set(plan.resourceRules.flatMap((rule) => rule.cardIds))
}
