import { CARD_CATALOG } from './card-catalog'
import type { CardDefinition } from './card-definition'
import {
  CARD_ACTION_DESTINATIONS,
  CARD_ACTION_FIELDS,
  CARD_ACTION_PLAYERS,
  CARD_ACTION_RESOURCES,
  CARD_ACTION_SOURCES,
  CARD_ACTIONS,
  CARD_CONDITIONS,
  CARD_CRYSTAL_MODES,
  CARD_DURATIONS,
  CARD_EVENT_TYPES,
  CARD_FILTER_FIELDS,
  CARD_KEYWORDS,
  CARD_OPERATORS,
  CARD_SELECTOR_CONTROLLERS,
  CARD_SELECTOR_EXCLUDES,
  CARD_SELECTOR_FIELDS,
  CARD_SELECTOR_SELECTIONS,
  CARD_SELECTOR_TYPES,
  CARD_SELECTOR_ZONES,
  CARD_TRIGGERS,
  CARD_VALUE_OPERATIONS,
  CARD_VALUE_REFERENCES,
  type CardActionName
} from './card-effects'

/** The phase responsible for implementing a closed content-language construct. */
export type CapabilityPhase =
  0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14

export type CapabilityFamily =
  | 'action'
  | 'trigger'
  | 'event'
  | 'condition'
  | 'duration'
  | 'keyword'
  | 'selector-controller'
  | 'selector-type'
  | 'selector-selection'
  | 'selector-exclude'
  | 'selector-zone'
  | 'selector-field'
  | 'filter-field'
  | 'operator'
  | 'value-reference'
  | 'value-operation'
  | 'action-player'
  | 'action-source'
  | 'action-destination'
  | 'action-resource'
  | 'action-field'
  | 'crystal-mode'

export interface CapabilityOwner {
  readonly family: CapabilityFamily
  readonly name: string
  readonly phase: CapabilityPhase
}

export interface CapabilityUsage extends CapabilityOwner {
  readonly usageCount: number
  readonly cardIds: readonly string[]
}

export interface CapabilityInventory {
  readonly generatedAt: 'catalog-load'
  readonly cardCount: number
  readonly effectCardCount: number
  readonly owners: readonly CapabilityOwner[]
  readonly usage: readonly CapabilityUsage[]
}

/**
 * One owner per member of every closed vocabulary. Keeping this table next to the
 * schema makes adding a new vocabulary item fail the inventory test immediately.
 */
export const CAPABILITY_OWNERSHIP: readonly CapabilityOwner[] = [
  ...CARD_ACTIONS.map((name): CapabilityOwner => ({
    family: 'action',
    name,
    phase: actionPhase(name)
  })),
  ...CARD_TRIGGERS.map((name): CapabilityOwner => ({
    family: 'trigger',
    name,
    phase: triggerPhase(name)
  })),
  ...CARD_EVENT_TYPES.map((name): CapabilityOwner => ({
    family: 'event',
    name,
    phase: 13
  })),
  ...CARD_CONDITIONS.map((name): CapabilityOwner => ({
    family: 'condition',
    name,
    phase: 4
  })),
  ...CARD_DURATIONS.map((name): CapabilityOwner => ({
    family: 'duration',
    name,
    phase: 7
  })),
  ...CARD_KEYWORDS.map((name): CapabilityOwner => ({
    family: 'keyword',
    name,
    phase: keywordPhase(name)
  })),
  ...CARD_SELECTOR_CONTROLLERS.map((name): CapabilityOwner => ({
    family: 'selector-controller',
    name,
    phase: 4
  })),
  ...CARD_SELECTOR_TYPES.map((name): CapabilityOwner => ({
    family: 'selector-type',
    name,
    phase: 4
  })),
  ...CARD_SELECTOR_SELECTIONS.map((name): CapabilityOwner => ({
    family: 'selector-selection',
    name,
    phase: 4
  })),
  ...CARD_SELECTOR_EXCLUDES.map((name): CapabilityOwner => ({
    family: 'selector-exclude',
    name,
    phase: 4
  })),
  ...CARD_SELECTOR_ZONES.map((name): CapabilityOwner => ({
    family: 'selector-zone',
    name,
    phase: 4
  })),
  ...CARD_SELECTOR_FIELDS.map((name): CapabilityOwner => ({
    family: 'selector-field',
    name,
    phase: 4
  })),
  ...CARD_FILTER_FIELDS.map((name): CapabilityOwner => ({
    family: 'filter-field',
    name,
    phase: 4
  })),
  ...CARD_OPERATORS.map((name): CapabilityOwner => ({
    family: 'operator',
    name,
    phase: 4
  })),
  ...CARD_VALUE_REFERENCES.map((name): CapabilityOwner => ({
    family: 'value-reference',
    name,
    phase: 4
  })),
  ...CARD_VALUE_OPERATIONS.map((name): CapabilityOwner => ({
    family: 'value-operation',
    name,
    phase: 4
  })),
  ...CARD_ACTION_PLAYERS.map((name): CapabilityOwner => ({
    family: 'action-player',
    name,
    phase: 4
  })),
  ...CARD_ACTION_SOURCES.map((name): CapabilityOwner => ({
    family: 'action-source',
    name,
    phase: 6
  })),
  ...CARD_ACTION_DESTINATIONS.map((name): CapabilityOwner => ({
    family: 'action-destination',
    name,
    phase: 6
  })),
  ...CARD_ACTION_RESOURCES.map((name): CapabilityOwner => ({
    family: 'action-resource',
    name,
    phase: 6
  })),
  ...CARD_ACTION_FIELDS.map((name): CapabilityOwner => ({
    family: 'action-field',
    name,
    phase: 7
  })),
  ...CARD_CRYSTAL_MODES.map((name): CapabilityOwner => ({
    family: 'crystal-mode',
    name,
    phase: 6
  }))
]

function actionPhase(name: CardActionName): CapabilityPhase {
  if (
    [
      'add-to-hand',
      'combine-choose-one',
      'spend-all-mana',
      'buff-cthun',
      'copy-stats',
      'summon-jade-golem',
      'shuffle-dead-cthun',
      'cast-random-spells',
      'modify-hero-attacks',
      'refresh-mana',
      'refresh-hero-power',
      'set-hero-power-cost',
      'create-kazakus-potion',
      'change-cost',
      'copy',
      'discard',
      'discover',
      'draw',
      'draw-until',
      'gain-mana',
      'destroy-mana-crystal',
      'overload',
      'unlock-overload',
      'shuffle-into-deck',
      'refill-original-decks',
      'steal-minion-from-deck'
    ].includes(name)
  )
    return 6
  if (
    [
      'grant-keyword',
      'lock-and-load',
      'grant-keywords',
      'grant-random-keyword',
      'modify',
      'remove-keyword',
      'silence',
      'swap-stats'
    ].includes(name)
  )
    return 7
  if (
    [
      'damage',
      'damage-group',
      'destroy',
      'destroy-all-but-highest-attack',
      'destroy-and-gain-stats',
      'gain-armor',
      'restore',
      'sacrifice-and-damage',
      'set-health',
      'trigger-deathrattle'
    ].includes(name)
  )
    return 8
  if (
    [
      'put-into-play',
      'resurrect',
      'return-to-hand',
      'return-to-play',
      'summon',
      'summon-copy',
      'summon-for-each',
      'summon-random',
      'swap',
      'take-control',
      'transform',
      'transform-random',
      'shuffle-random-minions',
      'summon-weapon-kills',
      'adapt'
    ].includes(name)
  )
    return 9
  if (name === 'freeze') return 10
  if (
    ['grant-deathrattle', 'grant-trigger', 'multiply-trigger', 'schedule'].includes(
      name
    )
  )
    return 11
  if (
    [
      'counter-event',
      'destroy-secrets',
      'grant-targeting',
      'prevent-lethal',
      'redirect-damage',
      'replace-event',
      'reveal',
      'joust'
    ].includes(name)
  )
    return 13
  if (
    [
      'equip',
      'equip-random',
      'modify-hero-power-uses',
      'modify-hero-power-damage',
      'modify-weapon-on-hero-power',
      'redirect-hero-damage',
      'set-hero-power-drawn-card-cost',
      'replace-hero',
      'set-hero-power',
      'set-turn-limit'
    ].includes(name)
  )
    return 14
  throw new Error(`No capability owner for action ${name}`)
}

function triggerPhase(name: (typeof CARD_TRIGGERS)[number]): CapabilityPhase {
  if (name === 'aura' || name === 'while-in-hand' || name === 'while-in-deck') return 12
  if (name === 'secret' || name === 'on-secret-played' || name === 'on-secret-revealed')
    return 13
  return 11
}

function keywordPhase(name: (typeof CARD_KEYWORDS)[number]): CapabilityPhase {
  if (name === 'secret') return 13
  if (name === 'spell-damage') return 12
  return 10
}

function increment(
  counts: Map<string, { count: number; cardIds: Set<string> }>,
  family: CapabilityFamily,
  name: string,
  cardId: string
): void {
  const key = `${family}:${name}`
  const current = counts.get(key) ?? { count: 0, cardIds: new Set<string>() }
  current.count += 1
  current.cardIds.add(cardId)
  counts.set(key, current)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function scanValue(
  value: unknown,
  card: CardDefinition,
  counts: Map<string, { count: number; cardIds: Set<string> }>,
  parentKey = ''
): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => scanValue(entry, card, counts, parentKey))
    return
  }
  if (!isRecord(value)) return

  for (const [key, nested] of Object.entries(value)) {
    if (key === 'action' && typeof nested === 'string')
      increment(counts, 'action', nested, card.id)
    if (
      (parentKey.includes('selector') ||
        parentKey === 'target' ||
        parentKey === 'source') &&
      (CARD_SELECTOR_FIELDS as readonly string[]).includes(key)
    )
      increment(counts, 'selector-field', key, card.id)

    if (key === 'trigger' && typeof nested === 'string')
      increment(counts, 'trigger', nested, card.id)
    if (key === 'type' && typeof nested === 'string') {
      if (parentKey.includes('condition'))
        increment(counts, 'condition', nested, card.id)
      else if (parentKey.includes('event')) increment(counts, 'event', nested, card.id)
      else if (
        parentKey.includes('selector') ||
        parentKey === 'target' ||
        parentKey === 'source'
      )
        increment(counts, 'selector-type', nested, card.id)
      else if (parentKey.includes('filter'))
        increment(counts, 'filter-field', nested, card.id)
    }
    if (key === 'duration' && typeof nested === 'string')
      increment(counts, 'duration', nested, card.id)
    if (key === 'keyword' && typeof nested === 'string')
      increment(counts, 'keyword', nested, card.id)
    if (key === 'keywords' && Array.isArray(nested))
      nested.forEach((entry) => {
        if (typeof entry === 'string') increment(counts, 'keyword', entry, card.id)
      })
    if (key === 'event' && typeof nested === 'string')
      increment(counts, 'event', nested, card.id)
    if (key === 'reference' && typeof nested === 'string')
      increment(counts, 'value-reference', nested, card.id)
    if (key === 'operation' && typeof nested === 'string')
      increment(counts, 'value-operation', nested, card.id)
    if (key === 'operator' && typeof nested === 'string')
      increment(counts, 'operator', nested, card.id)
    if (key === 'controller' && typeof nested === 'string')
      increment(counts, 'selector-controller', nested, card.id)
    if (key === 'selection' && typeof nested === 'string')
      increment(counts, 'selector-selection', nested, card.id)
    if (key === 'exclude' && typeof nested === 'string')
      increment(counts, 'selector-exclude', nested, card.id)
    if (key === 'zone' && typeof nested === 'string')
      increment(counts, 'selector-zone', nested, card.id)
    if (key === 'player' && typeof nested === 'string')
      increment(counts, 'action-player', nested, card.id)
    if (key === 'source' && typeof nested === 'string')
      increment(counts, 'action-source', nested, card.id)
    if (key === 'destination' && typeof nested === 'string')
      increment(counts, 'action-destination', nested, card.id)
    if (key === 'resource' && typeof nested === 'string')
      increment(counts, 'action-resource', nested, card.id)
    if (key === 'field' && typeof nested === 'string')
      increment(counts, 'action-field', nested, card.id)
    if (key === 'crystal' && typeof nested === 'string')
      increment(counts, 'crystal-mode', nested, card.id)
    if (key === 'filter' && isRecord(nested)) {
      Object.keys(nested).forEach((field) =>
        increment(counts, 'filter-field', field, card.id)
      )
    }
    scanValue(nested, card, counts, key)
  }
}

/** Derives usage counts from the immutable live catalog, including nested branches. */
export function createCapabilityInventory(
  cards: readonly CardDefinition[] = CARD_CATALOG.all
): CapabilityInventory {
  const counts = new Map<string, { count: number; cardIds: Set<string> }>()
  for (const card of cards) {
    card.keywords.forEach((keyword) => increment(counts, 'keyword', keyword, card.id))
    scanValue(card.effects, card, counts)
  }

  const usage = CAPABILITY_OWNERSHIP.map((owner) => {
    const value = counts.get(`${owner.family}:${owner.name}`)
    return {
      ...owner,
      usageCount: value?.count ?? 0,
      cardIds: [...(value?.cardIds ?? [])].sort()
    }
  })
  return {
    generatedAt: 'catalog-load',
    cardCount: cards.length,
    effectCardCount: cards.filter((card) => card.effects.length > 0).length,
    owners: CAPABILITY_OWNERSHIP,
    usage
  }
}

export function assertCapabilityOwnership(
  owners: readonly CapabilityOwner[] = CAPABILITY_OWNERSHIP
): void {
  const expected = new Set<string>()
  const duplicates: string[] = []
  for (const owner of owners) {
    const key = `${owner.family}:${owner.name}`
    if (expected.has(key)) duplicates.push(key)
    expected.add(key)
  }
  const declared = new Set<string>([
    ...CARD_ACTIONS.map((name) => `action:${name}`),
    ...CARD_TRIGGERS.map((name) => `trigger:${name}`),
    ...CARD_EVENT_TYPES.map((name) => `event:${name}`),
    ...CARD_CONDITIONS.map((name) => `condition:${name}`),
    ...CARD_DURATIONS.map((name) => `duration:${name}`),
    ...CARD_KEYWORDS.map((name) => `keyword:${name}`),
    ...CARD_SELECTOR_CONTROLLERS.map((name) => `selector-controller:${name}`),
    ...CARD_SELECTOR_TYPES.map((name) => `selector-type:${name}`),
    ...CARD_SELECTOR_SELECTIONS.map((name) => `selector-selection:${name}`),
    ...CARD_SELECTOR_EXCLUDES.map((name) => `selector-exclude:${name}`),
    ...CARD_SELECTOR_ZONES.map((name) => `selector-zone:${name}`),
    ...CARD_SELECTOR_FIELDS.map((name) => `selector-field:${name}`),
    ...CARD_FILTER_FIELDS.map((name) => `filter-field:${name}`),
    ...CARD_OPERATORS.map((name) => `operator:${name}`),
    ...CARD_VALUE_REFERENCES.map((name) => `value-reference:${name}`),
    ...CARD_VALUE_OPERATIONS.map((name) => `value-operation:${name}`),
    ...CARD_ACTION_PLAYERS.map((name) => `action-player:${name}`),
    ...CARD_ACTION_SOURCES.map((name) => `action-source:${name}`),
    ...CARD_ACTION_DESTINATIONS.map((name) => `action-destination:${name}`),
    ...CARD_ACTION_RESOURCES.map((name) => `action-resource:${name}`),
    ...CARD_ACTION_FIELDS.map((name) => `action-field:${name}`),
    ...CARD_CRYSTAL_MODES.map((name) => `crystal-mode:${name}`)
  ])
  const missing = [...declared].filter((key) => !expected.has(key))
  const extra = [...expected].filter((key) => !declared.has(key))
  if (duplicates.length || missing.length || extra.length) {
    throw new Error(
      `Capability ownership is not closed. duplicates=${duplicates.join(',')}; ` +
        `missing=${missing.join(',')}; extra=${extra.join(',')}`
    )
  }
}

export const CAPABILITY_INVENTORY = createCapabilityInventory()
