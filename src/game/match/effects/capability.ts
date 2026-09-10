import type { CardDefinition } from '../../content/cards'
import {
  CAPABILITY_OWNERSHIP,
  type CapabilityFamily,
  type CapabilityPhase
} from '../../content/cards/capability-inventory'

export interface UnsupportedCapability {
  readonly family: CapabilityFamily
  readonly name: string
  readonly phase: CapabilityPhase
  readonly path: string
}

export interface CardCapabilityReport {
  readonly cardId: string
  readonly supported: boolean
  readonly capabilities: readonly UnsupportedCapability[]
}

function owner(family: CapabilityFamily, name: string) {
  return CAPABILITY_OWNERSHIP.find(
    (entry) => entry.family === family && entry.name === name
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reports every closed-language construct used by a card. The report is intentionally
 * conservative until the owning phase registers its runtime capability: an absent entry
 * is observable in tests/development and can never silently turn an effect into vanilla.
 */
export function inspectCardCapabilities(
  card: CardDefinition,
  supported: ReadonlySet<string> = new Set()
): CardCapabilityReport {
  const capabilities: UnsupportedCapability[] = []
  const add = (family: CapabilityFamily, name: string, path: string): void => {
    const entry = owner(family, name)
    if (!entry) return
    const key = `${family}:${name}`
    if (!supported.has(key)) capabilities.push({ ...entry, path })
  }
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`))
      return
    }
    if (!isRecord(value)) return
    for (const [key, nested] of Object.entries(value)) {
      const nestedPath = `${path}.${key}`
      if (key === 'action' && typeof nested === 'string')
        add('action', nested, nestedPath)
      if (key === 'trigger' && typeof nested === 'string')
        add('trigger', nested, nestedPath)
      if (key === 'duration' && typeof nested === 'string')
        add('duration', nested, nestedPath)
      if (key === 'keyword' && typeof nested === 'string')
        add('keyword', nested, nestedPath)
      if (key === 'keywords' && Array.isArray(nested))
        nested.forEach((entry, index) => {
          if (typeof entry === 'string')
            add('keyword', entry, `${nestedPath}[${index}]`)
        })
      if (key === 'reference' && typeof nested === 'string')
        add('value-reference', nested, nestedPath)
      if (key === 'operation' && typeof nested === 'string')
        add('value-operation', nested, nestedPath)
      if (key === 'operator' && typeof nested === 'string')
        add('operator', nested, nestedPath)
      if (key === 'controller' && typeof nested === 'string')
        add('selector-controller', nested, nestedPath)
      if (key === 'selection' && typeof nested === 'string')
        add('selector-selection', nested, nestedPath)
      if (key === 'exclude' && typeof nested === 'string')
        add('selector-exclude', nested, nestedPath)
      if (key === 'zone' && typeof nested === 'string')
        add('selector-zone', nested, nestedPath)
      if (key === 'player' && typeof nested === 'string')
        add('action-player', nested, nestedPath)
      if (key === 'source' && typeof nested === 'string')
        add('action-source', nested, nestedPath)
      if (key === 'destination' && typeof nested === 'string')
        add('action-destination', nested, nestedPath)
      if (key === 'resource' && typeof nested === 'string')
        add('action-resource', nested, nestedPath)
      if (key === 'field' && typeof nested === 'string')
        add('action-field', nested, nestedPath)
      if (key === 'crystal' && typeof nested === 'string')
        add('crystal-mode', nested, nestedPath)
      if (key === 'event' && typeof nested === 'string')
        add('event', nested, nestedPath)
      if (key === 'type' && typeof nested === 'string') {
        if (path.includes('.condition')) add('condition', nested, nestedPath)
        else if (path.includes('.event')) add('event', nested, nestedPath)
        else if (path.includes('.filter')) add('filter-field', nested, nestedPath)
        else if (
          path.endsWith('.target') ||
          path.endsWith('.source') ||
          path.includes('.selector')
        )
          add('selector-type', nested, nestedPath)
      }
      if (key === 'filter' && isRecord(nested))
        Object.keys(nested).forEach((field) =>
          add('filter-field', field, `${nestedPath}.${field}`)
        )
      walk(nested, nestedPath)
    }
  }
  card.keywords.forEach((keyword, index) =>
    add('keyword', keyword, `.keywords[${index}]`)
  )
  walk(card.effects, '.effects')
  return {
    cardId: card.id,
    supported: capabilities.length === 0,
    capabilities
  }
}

export class UnsupportedEffectCapabilityError extends Error {
  readonly report: CardCapabilityReport

  constructor(report: CardCapabilityReport) {
    super(
      `Card ${report.cardId} uses unsupported effect capabilities: ` +
        report.capabilities
          .map((entry) => `${entry.family}:${entry.name} at ${entry.path}`)
          .join(', ')
    )
    this.name = 'UnsupportedEffectCapabilityError'
    this.report = report
  }
}

/**
 * Explicit runtime capability ownership. The schema vocabularies are closed, but they
 * are not themselves evidence that a resolver branch exists. New vocabulary entries
 * stay unsupported until they are added here and exercised through catalog smoke.
 */
export interface RuntimeCapabilityRegistration {
  readonly family: CapabilityFamily
  readonly name: string
  readonly phase: CapabilityPhase
}

const RUNTIME_CAPABILITY_NAMES: Readonly<Record<CapabilityFamily, readonly string[]>> =
  {
    action: [
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
      'counter-event',
      'damage',
      'destroy',
      'destroy-all-but-highest-attack',
      'destroy-and-gain-stats',
      'destroy-mana-crystal',
      'destroy-secrets',
      'discover',
      'discard',
      'draw',
      'draw-until',
      'equip',
      'equip-random',
      'freeze',
      'gain-armor',
      'gain-mana',
      'joust',
      'grant-deathrattle',
      'grant-keyword',
      'lock-and-load',
      'grant-keywords',
      'grant-random-keyword',
      'grant-targeting',
      'grant-trigger',
      'modify',
      'modify-hero-power-uses',
      'modify-hero-power-damage',
      'modify-weapon-on-hero-power',
      'redirect-hero-damage',
      'set-hero-power-drawn-card-cost',
      'multiply-trigger',
      'overload',
      'unlock-overload',
      'prevent-lethal',
      'put-into-play',
      'redirect-damage',
      'replace-hero',
      'remove-keyword',
      'replace-event',
      'restore',
      'return-to-play',
      'resurrect',
      'return-to-hand',
      'reveal',
      'sacrifice-and-damage',
      'schedule',
      'set-health',
      'set-hero-power',
      'set-turn-limit',
      'shuffle-into-deck',
      'silence',
      'summon',
      'summon-copy',
      'summon-for-each',
      'summon-random',
      'swap',
      'swap-stats',
      'take-control',
      'transform',
      'transform-random',
      'trigger-deathrattle'
    ],
    trigger: [
      'aura',
      'battlecry',
      'cast',
      'deathrattle',
      'end-of-turn',
      'inspire',
      'on-attack',
      'on-card-played',
      'on-cast',
      'on-damage',
      'on-death',
      'on-discard',
      'on-draw',
      'on-equip',
      'on-gain-armor',
      'on-heal',
      'overheal',
      'on-overload',
      'on-play',
      'on-secret-played',
      'on-secret-revealed',
      'on-summon',
      'secret',
      'start-of-turn',
      'while-in-hand',
      'while-in-deck'
    ],
    event: [
      'card-played',
      'card-discarded',
      'character-attacked',
      'attack-resolved',
      'damage-dealt',
      'first-minion-played-this-turn',
      'friendly-minion-attacked',
      'health-restored',
      'hero-attacked',
      'hero-damaged',
      'hero-power-used',
      'hero-would-die',
      'minion-attacked',
      'minion-attacks-hero',
      'minion-destroyed',
      'minion-died',
      'minion-played',
      'minion-summoned',
      'overload-applied',
      'weapon-died',
      'weapon-equipped',
      'secret-played',
      'secret-revealed',
      'spell-cast',
      'spell-resolved',
      'spell',
      'spell-targeted-minion',
      'turn-ended',
      'turn-started'
    ],
    condition: [
      'card-died-this-game',
      'board-has-minion-count',
      'event-player-had-minion-count',
      'combo',
      'combo-active',
      'drawn-card-matches',
      'not-combo',
      'player-controls-secret',
      'player-has-damaged-minion',
      'player-has-hand-count',
      'player-has-card-in-hand',
      'player-has-minion',
      'player-has-minion-count',
      'player-deck-has-no-duplicates',
      'cthun-attack-at-least',
      'defender-died-from-combat',
      'player-has-secret',
      'player-has-spell-damage',
      'player-has-weapon',
      'player-health-gt',
      'player-health-lte',
      'player-lacks-minion',
      'player-lacks-weapon',
      'source-damaged',
      'target-damaged',
      'target-died',
      'target-frozen',
      'target-is-friendly-demon',
      'target-is-not-friendly-demon',
      'target-not-frozen',
      'target-matches',
      'target-survived'
    ],
    duration: [
      'next-turn',
      'permanent',
      'this-attack',
      'this-turn',
      'this-game',
      'until-next-turn',
      'while-condition',
      'while-damaged',
      'while-in-hand',
      'while-source-in-play',
      'while-source-equipped'
    ],
    keyword: [
      'attack-wrong-enemy-chance-50',
      'cannot-attack',
      'cannot-attack-heroes',
      'charge',
      'lifesteal',
      'rush',
      'divine-shield',
      'immune',
      'mega-windfury',
      'secret',
      'spell-damage',
      'spell-immune',
      'stealth',
      'taunt',
      'windfury'
    ],
    'selector-controller': ['self', 'opponent', 'any'],
    'selector-type': [
      'added-card',
      'card',
      'character',
      'drawn-card',
      'event-card',
      'hero',
      'hero-power',
      'minion',
      'minion-card',
      'secret',
      'spell',
      'spell-card',
      'weapon'
    ],
    'selector-selection': [
      'adjacent',
      'all',
      'chosen',
      'chosen-and-adjacent',
      'event-source',
      'event-target',
      'hero',
      'next',
      'other-player-hand',
      'random',
      'source',
      'stored'
    ],
    'selector-exclude': ['event-target', 'source'],
    'selector-zone': ['deck', 'hand', 'revealed'],
    'selector-field': [
      'adjacentTo',
      'controller',
      'count',
      'distinct',
      'distinctDeathEvents',
      'exclude',
      'excludeCardId',
      'filter',
      'preserve',
      'position',
      'reference',
      'selection',
      'order',
      'type',
      'zone'
    ],
    'filter-field': [
      'cardId',
      'cardClassIn',
      'cardClass',
      'cardType',
      'cost',
      'damaged',
      'frozen',
      'collectible',
      'hasBattlecry',
      'hasDeathrattle',
      'keyword',
      'negate',
      'operator',
      'overload',
      'rarity',
      'sparePart',
      'stat',
      'mortallyWounded',
      'printedOnly',
      'tribe',
      'type',
      'value'
    ],
    operator: ['eq', 'gt', 'gte', 'lt', 'lte'],
    'value-reference': [
      'available-board-slots',
      'beasts-summoned-this-game',
      'friendly-spells-cast-this-game',
      'friendly-totems-summoned-this-game',
      'friendly-secrets-played-this-game',
      'cards-played-earlier-this-turn',
      'damage-dealt',
      'last-damage-amount',
      'destroyed-weapon.attack',
      'destroyed-weapon.durability',
      'drawn-card.cost',
      'event-target.attack',
      'event-target.durability',
      'event.damage',
      'event.amount',
      'event-card-cost',
      'hand-size-difference',
      'health',
      'hero-damage',
      'hero-powers-used-this-game',
      'matching-entity-count',
      'minions-died-this-turn',
      'other-cards-in-hand',
      'other-minions-on-board',
      'removed-keyword-count',
      'self.hero.armor',
      'self.hero.attack',
      'source.attack',
      'source.health',
      'source.weapon.attack',
      'target.attack',
      'target.health',
      'destroyed-target.attack',
      'destroyed-target.health',
      'manaSpent',
      'secretsDestroyed.count',
      'summonedJade',
      'returnedCard',
      'discoveredCard.cost',
      'target.baseCost'
    ],
    'value-operation': ['multiply', 'set', 'subtract'],
    'action-player': ['each', 'opponent', 'self', 'turn-player'],
    'action-source': [
      'deck',
      'deck-top',
      'destroyed-minions',
      'friendly-minions-died-this-turn',
      'friendly-minions-died-this-game',
      'minions-died-this-game',
      'hand',
      'discarded-event-card',
      'opponent-deck',
      'random-card'
    ],
    'action-destination': ['cast-on-source', 'deck', 'hand'],
    'action-resource': ['weapon-durability'],
    'action-field': ['health'],
    'crystal-mode': ['empty', 'full']
  }

function createRuntimeCapabilityRegistry(): readonly RuntimeCapabilityRegistration[] {
  const registrations: RuntimeCapabilityRegistration[] = []
  const seen = new Set<string>()
  for (const [family, names] of Object.entries(RUNTIME_CAPABILITY_NAMES) as [
    CapabilityFamily,
    readonly string[]
  ][]) {
    for (const name of names) {
      const key = `${family}:${name}`
      if (seen.has(key)) throw new Error(`Duplicate runtime capability ${key}.`)
      const ownerEntry = owner(family, name)
      if (!ownerEntry) throw new Error(`Runtime capability ${key} has no schema owner.`)
      seen.add(key)
      registrations.push(ownerEntry)
    }
  }
  const ownerKeys = new Set(
    CAPABILITY_OWNERSHIP.map((entry) => `${entry.family}:${entry.name}`)
  )
  for (const key of ownerKeys) {
    if (!seen.has(key))
      throw new Error(`Schema capability ${key} has no runtime owner.`)
  }
  return registrations
}

export const RUNTIME_CAPABILITY_REGISTRY = createRuntimeCapabilityRegistry()

export function runtimeCapabilityKeys(): ReadonlySet<string> {
  return new Set(
    RUNTIME_CAPABILITY_REGISTRY.map((entry) => `${entry.family}:${entry.name}`)
  )
}
