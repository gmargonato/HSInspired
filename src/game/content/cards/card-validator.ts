import {
  asCardId,
  asClassId,
  asExpansionId,
  CARD_CLASSES,
  CARD_RARITIES,
  CARD_TYPES,
  type CardDefinition,
  type CardRarity,
  type CardType,
  type ExpansionId
} from './card-definition'
import {
  CARD_ACTIONS,
  CARD_ACTION_DESTINATIONS,
  CARD_ACTION_FIELDS,
  CARD_ACTION_PLAYERS,
  CARD_ACTION_RESOURCES,
  CARD_ACTION_SOURCES,
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
  type CardActionName,
  type CardKeyword,
  type CardEffectBlock
} from './card-effects'

export interface RawCardRecord {
  readonly id?: unknown
  readonly name?: unknown
  readonly rarity?: unknown
  readonly cardClass?: unknown
  readonly type?: unknown
  readonly subtype?: unknown
  readonly spellSchool?: unknown
  readonly cost?: unknown
  readonly attack?: unknown
  readonly health?: unknown
  readonly armor?: unknown
  readonly rulesText?: unknown
  readonly keywords?: unknown
  readonly effects?: unknown
  readonly collectible?: unknown
  readonly deckLegal?: unknown
}

export interface RawHeroPowerRecord extends RawCardRecord {
  readonly type: 'Hero Power'
}

export class ContentValidationError extends Error {
  readonly path: string

  constructor(path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'ContentValidationError'
    this.path = path
  }
}

const NON_COLLECTIBLE_RARITIES = new Set(['None', 'Summon', 'Dream'])
const NON_COSTED_CARD_IDS = new Set([
  'classic_hogger_smash',
  'classic_millhouse_manastorm'
])

function fail(path: string, message: string): never {
  throw new ContentValidationError(path, message)
}

function recordObject(value: unknown, path: string): RawCardRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(path, 'expected an object')
  }
  return value as RawCardRecord
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    return fail(path, 'expected a non-empty string')
  }
  return value.trim()
}

function optionalString(value: unknown, path: string): string | null {
  if (value === undefined || value === null || value === '') return null
  const normalized = stringValue(value, path)
  return normalized === 'General' ? null : normalized
}

function textValue(value: unknown, path: string): string {
  if (typeof value !== 'string') return fail(path, 'expected text')
  return value
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string
): T {
  const candidate = stringValue(value, path)
  if (!allowed.includes(candidate as T)) {
    return fail(path, `unknown value ${JSON.stringify(candidate)}`)
  }
  return candidate as T
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fail(path, 'expected a finite non-negative number')
  }
  return value
}

function statistic(value: unknown, path: string, required: boolean): number | null {
  if (value === undefined || value === null || value === '') {
    if (required) return fail(path, 'is required for this card type')
    return null
  }
  return finiteNumber(value, path)
}

function booleanValue(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') return fail(path, 'expected a boolean')
  return value
}

function keywordsValue(value: unknown, path: string): readonly CardKeyword[] {
  if (!Array.isArray(value)) return fail(path, 'expected an array')
  return value.map((keyword, index) =>
    enumValue(keyword, CARD_KEYWORDS, `${path}[${index}]`)
  )
}

function actionRecord(value: unknown, path: string): CardActionName {
  const record = recordObject(value, path) as Record<string, unknown>
  return enumValue(record['action'], CARD_ACTIONS, `${path}.action`)
}

const ACTION_FIELDS = new Set([
  'action',
  'amount',
  'actions',
  'asNewAttackTarget',
  'asNewSpellTarget',
  'attack',
  'cardId',
  'chance',
  'count',
  'controller',
  'crystal',
  'destination',
  'durability',
  'duration',
  'event',
  'field',
  'filter',
  'handSize',
  'health',
  'hits',
  'healingMultiplier',
  'heroPowerMultiplier',
  'keyword',
  'keywords',
  'minimum',
  'minimumHealth',
  'modifyDrawnCard',
  'multiplier',
  'player',
  'pool',
  'power',
  'preserveMaximum',
  'replacement',
  'resource',
  'reveal',
  'seconds',
  'selection',
  'source',
  'spellDamageMultiplier',
  'target',
  'targetType',
  'trigger',
  'upgradedPower'
])

const ACTION_REQUIRED_FIELDS: Partial<Record<CardActionName, readonly string[]>> = {
  damage: ['target', 'amount'],
  restore: ['target', 'amount'],
  destroy: ['target'],
  'destroy-and-gain-stats': ['target', 'destination'],
  'destroy-mana-crystal': ['player', 'amount'],
  'destroy-secrets': ['player'],
  'change-cost': ['amount'],
  copy: ['target'],
  draw: ['player', 'count'],
  'draw-until': ['player', 'handSize'],
  equip: ['cardId'],
  'equip-random': ['player'],
  freeze: ['target'],
  'gain-armor': ['amount'],
  'gain-mana': ['player', 'amount'],
  'grant-deathrattle': ['target', 'actions'],
  'grant-keyword': ['target', 'keyword'],
  'grant-keywords': ['target', 'keywords'],
  'grant-random-keyword': ['target', 'keywords'],
  'grant-targeting': ['target', 'targetType'],
  'grant-trigger': ['target', 'trigger', 'actions'],
  modify: ['target'],
  'multiply-trigger': ['target', 'trigger', 'multiplier'],
  overload: ['amount'],
  'prevent-lethal': ['target'],
  'put-into-play': ['source'],
  'redirect-damage': ['source', 'target', 'amount'],
  'remove-keyword': ['target', 'keyword'],
  'replace-event': ['event', 'replacement'],
  'return-to-hand': ['target'],
  'return-to-play': ['target'],
  'sacrifice-and-damage': ['source', 'target', 'amount'],
  schedule: ['trigger', 'actions'],
  'set-health': ['target', 'amount'],
  'set-hero-power': ['player', 'power'],
  'set-turn-limit': ['seconds'],
  silence: ['target'],
  summon: ['cardId'],
  'summon-for-each': ['cardId', 'source'],
  'summon-random': ['count'],
  'swap-stats': ['target'],
  'take-control': ['target'],
  transform: ['target', 'cardId'],
  'transform-random': ['target'],
  'trigger-deathrattle': ['target']
}

const MODIFY_FIELDS = [
  'attack',
  'durability',
  'health',
  'healingMultiplier',
  'heroPowerMultiplier',
  'minimumHealth',
  'spellDamageMultiplier'
] as const

const NUMERIC_VALUE_FIELDS = [
  'amount',
  'count',
  'attack',
  'health',
  'durability'
] as const

function signedNumber(value: unknown, path: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, 'expected a finite number')
  }
}

function numericEffectValue(value: unknown, path: string, allowFull: boolean): void {
  if (typeof value === 'number') {
    signedNumber(value, path)
    return
  }
  if (typeof value === 'string') {
    if (allowFull && value === 'full') return
    return fail(path, 'unknown numeric value')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(path, 'expected a number or typed value reference')
  }

  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (record['random'] !== undefined) {
    if (keys.length !== 1 || !Array.isArray(record['random'])) {
      return fail(path, 'random values only support an array')
    }
    if (record['random'].length === 0)
      return fail(`${path}.random`, 'must not be empty')
    record['random'].forEach((entry, index) =>
      signedNumber(entry, `${path}.random[${index}]`)
    )
    return
  }

  const allowedKeys = new Set([
    'operation',
    'opponent',
    'keyword',
    'multiplier',
    'reference',
    'selector',
    'value'
  ])
  for (const key of keys) {
    if (!allowedKeys.has(key)) return fail(`${path}.${key}`, 'unknown value field')
  }
  if (record['reference'] !== undefined) {
    enumValue(record['reference'], CARD_VALUE_REFERENCES, `${path}.reference`)
  }
  if (record['operation'] !== undefined) {
    enumValue(record['operation'], CARD_VALUE_OPERATIONS, `${path}.operation`)
  }
  if (record['value'] !== undefined) {
    signedNumber(record['value'], `${path}.value`)
  }
  if (record['selector'] !== undefined) {
    selectorValue(record['selector'], `${path}.selector`)
  }
  if (record['keyword'] !== undefined) {
    enumValue(record['keyword'], CARD_KEYWORDS, `${path}.keyword`)
  }
  if (record['multiplier'] !== undefined) {
    finiteNumber(record['multiplier'], `${path}.multiplier`)
  }
  if (record['opponent'] !== undefined && typeof record['opponent'] !== 'boolean') {
    fail(`${path}.opponent`, 'expected a boolean')
  }
  if (record['reference'] === undefined && record['operation'] === undefined) {
    return fail(path, 'requires a reference, operation, or random value')
  }
  if (
    record['operation'] !== undefined &&
    record['value'] === undefined &&
    record['reference'] === undefined
  ) {
    return fail(path, 'an operation requires a value or reference')
  }
}

function validateActionShape(
  actionName: CardActionName,
  record: Record<string, unknown>,
  path: string
): void {
  for (const field of ACTION_REQUIRED_FIELDS[actionName] ?? []) {
    if (record[field] === undefined) {
      fail(`${path}.${field}`, 'is required for this action')
    }
  }
  if (
    actionName === 'add-to-hand' &&
    record['cardId'] === undefined &&
    record['source'] === undefined
  ) {
    fail(path, 'requires cardId or source')
  }
  if (actionName === 'copy' && record['destination'] === undefined) {
    fail(`${path}.destination`, 'is required for this action')
  }
  if (
    actionName === 'discard' &&
    record['target'] === undefined &&
    record['source'] === undefined
  ) {
    fail(path, 'requires target or source')
  }
  if (
    actionName === 'gain-armor' &&
    record['target'] === undefined &&
    record['player'] === undefined
  ) {
    fail(path, 'requires target or player')
  }
  if (
    actionName === 'modify' &&
    !MODIFY_FIELDS.some((field) => record[field] !== undefined)
  ) {
    fail(path, 'requires a stat field')
  }
  if (
    actionName === 'resurrect' &&
    record['target'] === undefined &&
    record['source'] === undefined
  ) {
    fail(path, 'requires target or source')
  }
  if (
    actionName === 'shuffle-into-deck' &&
    record['target'] === undefined &&
    record['cardId'] === undefined
  ) {
    fail(path, 'requires target or cardId')
  }
  if (
    actionName === 'summon-copy' &&
    record['target'] === undefined &&
    record['source'] === undefined
  ) {
    fail(path, 'requires target or source')
  }
  if (
    actionName === 'summon-random' &&
    record['filter'] === undefined &&
    record['pool'] === undefined
  ) {
    fail(path, 'requires filter or pool')
  }
  if (
    actionName === 'transform-random' &&
    record['filter'] === undefined &&
    record['pool'] === undefined
  ) {
    fail(path, 'requires filter or pool')
  }
  if (
    actionName === 'change-cost' &&
    record['target'] === undefined &&
    record['resource'] === undefined
  ) {
    fail(path, 'requires target or resource')
  }
}

const CONDITION_FIELDS = [
  'cardId',
  'filter',
  'operator',
  'player',
  'type',
  'value'
] as const

const EVENT_FIELDS = [
  'controller',
  'exclude',
  'filter',
  'source',
  'target',
  'type',
  'turnPlayer'
] as const

function filterValue(value: unknown, path: string): void {
  const filter = recordObject(value, path) as Record<string, unknown>
  for (const key of Object.keys(filter)) {
    if (!CARD_FILTER_FIELDS.includes(key as (typeof CARD_FILTER_FIELDS)[number])) {
      return fail(`${path}.${key}`, 'unknown filter field')
    }
    const candidate = filter[key]
    if (
      key === 'damaged' ||
      key === 'hasBattlecry' ||
      key === 'hasDeathrattle' ||
      key === 'negate' ||
      key === 'overload' ||
      key === 'sparePart'
    ) {
      if (typeof candidate !== 'boolean') {
        return fail(`${path}.${key}`, 'expected a boolean')
      }
    } else if (key === 'operator') {
      enumValue(candidate, CARD_OPERATORS, `${path}.${key}`)
    } else if (key === 'value') {
      finiteNumber(candidate, `${path}.${key}`)
    } else if (key === 'cost') {
      if (typeof candidate === 'string') {
        if (candidate !== 'target-cost') {
          return fail(`${path}.${key}`, 'unknown dynamic cost value')
        }
      } else finiteNumber(candidate, `${path}.${key}`)
    } else {
      stringValue(candidate, `${path}.${key}`)
    }
  }
}

function conditionValue(value: unknown, path: string): void {
  const condition = recordObject(value, path) as Record<string, unknown>
  for (const key of Object.keys(condition)) {
    if (!CONDITION_FIELDS.includes(key as (typeof CONDITION_FIELDS)[number])) {
      return fail(`${path}.${key}`, 'unknown condition field')
    }
  }
  enumValue(condition['type'], CARD_CONDITIONS, `${path}.type`)
  if (condition['filter'] !== undefined)
    filterValue(condition['filter'], `${path}.filter`)
  if (condition['operator'] !== undefined) {
    enumValue(condition['operator'], CARD_OPERATORS, `${path}.operator`)
  }
  if (condition['player'] !== undefined)
    stringValue(condition['player'], `${path}.player`)
  if (condition['cardId'] !== undefined)
    stringValue(condition['cardId'], `${path}.cardId`)
  if (condition['value'] !== undefined)
    finiteNumber(condition['value'], `${path}.value`)
}

function eventValue(value: unknown, path: string): void {
  if (typeof value === 'string') {
    enumValue(value, CARD_EVENT_TYPES, path)
    return
  }
  const event = recordObject(value, path) as Record<string, unknown>
  for (const key of Object.keys(event)) {
    if (!EVENT_FIELDS.includes(key as (typeof EVENT_FIELDS)[number])) {
      return fail(`${path}.${key}`, 'unknown event field')
    }
  }
  if (event['type'] !== undefined)
    enumValue(event['type'], CARD_EVENT_TYPES, `${path}.type`)
  if (event['controller'] !== undefined) {
    enumValue(event['controller'], CARD_SELECTOR_CONTROLLERS, `${path}.controller`)
  }
  if (event['exclude'] !== undefined) {
    enumValue(event['exclude'], CARD_SELECTOR_EXCLUDES, `${path}.exclude`)
  }
  if (event['filter'] !== undefined) filterValue(event['filter'], `${path}.filter`)
  if (event['source'] !== undefined) selectorValue(event['source'], `${path}.source`)
  if (event['target'] !== undefined) selectorValue(event['target'], `${path}.target`)
  if (event['turnPlayer'] !== undefined)
    stringValue(event['turnPlayer'], `${path}.turnPlayer`)
}

function branchValue(value: unknown, path: string): void {
  const branch = recordObject(value, path) as Record<string, unknown>
  for (const key of Object.keys(branch)) {
    if (key !== 'actions' && key !== 'condition') {
      return fail(`${path}.${key}`, 'unknown branch field')
    }
  }
  if (branch['actions'] === undefined) return fail(`${path}.actions`, 'is required')
  actionsValue(branch['actions'], `${path}.actions`)
  if (branch['condition'] !== undefined) {
    conditionValue(branch['condition'], `${path}.condition`)
  }
}

function repeatValue(value: unknown, path: string): void {
  const repeat = recordObject(value, path) as Record<string, unknown>
  for (const key of Object.keys(repeat)) {
    if (key !== 'until' && key !== 'actions') {
      return fail(`${path}.${key}`, 'unknown repeat field')
    }
  }
  if (repeat['until'] === undefined) return fail(`${path}.until`, 'is required')
  if (typeof repeat['until'] === 'string') {
    enumValue(repeat['until'], CARD_CONDITIONS, `${path}.until`)
  } else {
    conditionValue(repeat['until'], `${path}.until`)
  }
  if (repeat['actions'] === undefined) return fail(`${path}.actions`, 'is required')
  actionsValue(repeat['actions'], `${path}.actions`)
}

function selectorValue(value: unknown, path: string): void {
  const selector = recordObject(value, path) as Record<string, unknown>
  for (const key of Object.keys(selector)) {
    if (!CARD_SELECTOR_FIELDS.includes(key as (typeof CARD_SELECTOR_FIELDS)[number])) {
      return fail(`${path}.${key}`, 'unknown selector field')
    }
  }
  if (selector['controller'] !== undefined) {
    enumValue(selector['controller'], CARD_SELECTOR_CONTROLLERS, `${path}.controller`)
  }
  if (selector['type'] !== undefined) {
    enumValue(selector['type'], CARD_SELECTOR_TYPES, `${path}.type`)
  }
  if (selector['selection'] !== undefined) {
    enumValue(selector['selection'], CARD_SELECTOR_SELECTIONS, `${path}.selection`)
  }
  if (selector['exclude'] !== undefined) {
    enumValue(selector['exclude'], CARD_SELECTOR_EXCLUDES, `${path}.exclude`)
  }
  if (selector['zone'] !== undefined) {
    enumValue(selector['zone'], CARD_SELECTOR_ZONES, `${path}.zone`)
  }
  if (selector['adjacentTo'] !== undefined) {
    stringValue(selector['adjacentTo'], `${path}.adjacentTo`)
  }
  if (selector['excludeCardId'] !== undefined) {
    stringValue(selector['excludeCardId'], `${path}.excludeCardId`)
  }
  if (selector['position'] !== undefined) {
    stringValue(selector['position'], `${path}.position`)
  }
  if (selector['filter'] !== undefined)
    filterValue(selector['filter'], `${path}.filter`)
  if (selector['preserve'] !== undefined)
    selectorValue(selector['preserve'], `${path}.preserve`)
}

function nestedActionsValue(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => nestedActionsValue(item, `${path}[${index}]`))
    return
  }
  if (typeof value !== 'object' || value === null) return

  const record = value as Record<string, unknown>
  for (const [key, nested] of Object.entries(record)) {
    if (key === 'actions') {
      actionsValue(nested, `${path}.actions`)
    } else if (
      (key === 'target' ||
        key === 'source' ||
        key === 'destination' ||
        key === 'selector') &&
      nested !== undefined &&
      typeof nested === 'object' &&
      nested !== null
    ) {
      selectorValue(nested, `${path}.${key}`)
    } else if (key === 'condition' && nested !== undefined) {
      conditionValue(nested, `${path}.condition`)
    } else if (key === 'event' && nested !== undefined) {
      eventValue(nested, `${path}.event`)
    } else if (key === 'filter' && nested !== undefined) {
      filterValue(nested, `${path}.filter`)
    } else if (key === 'choice' && nested !== undefined) {
      choiceValue(nested, `${path}.choice`)
    } else if (key === 'then' && nested !== undefined) {
      branchValue(nested, `${path}.then`)
    } else if (key === 'repeat' && nested !== undefined) {
      repeatValue(nested, `${path}.repeat`)
    } else if (key === 'duration' && nested !== undefined) {
      enumValue(nested, CARD_DURATIONS, `${path}.duration`)
    } else if (key === 'targetType' && nested !== undefined) {
      enumValue(nested, CARD_SELECTOR_TYPES, `${path}.targetType`)
    } else if (key === 'keyword' && nested !== undefined) {
      enumValue(nested, CARD_KEYWORDS, `${path}.keyword`)
    } else if (key === 'keywords' && nested !== undefined) {
      keywordsValue(nested, `${path}.keywords`)
    } else if (key === 'trigger' && nested !== undefined) {
      enumValue(nested, CARD_TRIGGERS, `${path}.trigger`)
    } else {
      nestedActionsValue(nested, `${path}.${key}`)
    }
  }
}

function actionsValue(value: unknown, path: string): void {
  if (!Array.isArray(value)) return fail(path, 'expected an array')
  if (value.length === 0) return fail(path, 'must contain at least one action')
  value.forEach((action, index) => {
    const actionPath = `${path}[${index}]`
    const record = recordObject(action, actionPath) as Record<string, unknown>
    for (const key of ['condition', 'choice', 'repeat', 'then']) {
      if (record[key] !== undefined) {
        return fail(`${actionPath}.${key}`, 'must be modeled on the effect block')
      }
    }
    for (const key of Object.keys(record)) {
      if (!ACTION_FIELDS.has(key)) {
        return fail(`${actionPath}.${key}`, 'unknown action field')
      }
    }
    const actionName = actionRecord(record, actionPath)
    validateActionShape(actionName, record, actionPath)
    if (record['player'] !== undefined) {
      enumValue(record['player'], CARD_ACTION_PLAYERS, `${actionPath}.player`)
    }
    if (typeof record['source'] === 'string') {
      enumValue(record['source'], CARD_ACTION_SOURCES, `${actionPath}.source`)
    }
    if (typeof record['destination'] === 'string') {
      enumValue(
        record['destination'],
        CARD_ACTION_DESTINATIONS,
        `${actionPath}.destination`
      )
    }
    if (record['resource'] !== undefined) {
      enumValue(record['resource'], CARD_ACTION_RESOURCES, `${actionPath}.resource`)
    }
    if (record['field'] !== undefined) {
      enumValue(record['field'], CARD_ACTION_FIELDS, `${actionPath}.field`)
    }
    if (record['crystal'] !== undefined) {
      enumValue(record['crystal'], CARD_CRYSTAL_MODES, `${actionPath}.crystal`)
    }
    if (record['selection'] !== undefined) {
      enumValue(
        record['selection'],
        CARD_SELECTOR_SELECTIONS,
        `${actionPath}.selection`
      )
    }
    for (const field of NUMERIC_VALUE_FIELDS) {
      if (record[field] !== undefined) {
        numericEffectValue(
          record[field],
          `${actionPath}.${field}`,
          field === 'amount' || field === 'health'
        )
      }
    }
    nestedActionsValue(action, `${path}[${index}]`)
  })
}

function choiceValue(value: unknown, path: string): void {
  const choice = recordObject(value, path) as Record<string, unknown>
  for (const key of Object.keys(choice)) {
    if (key !== 'options') return fail(`${path}.${key}`, 'unknown choice field')
  }
  if (!Array.isArray(choice['options'])) {
    return fail(`${path}.options`, 'expected an array')
  }
  choice['options'].forEach((option, index) => {
    const optionRecord = recordObject(option, `${path}.options[${index}]`) as Record<
      string,
      unknown
    >
    for (const key of Object.keys(optionRecord)) {
      if (key !== 'actions') {
        return fail(`${path}.options[${index}].${key}`, 'unknown choice option field')
      }
    }
    if (optionRecord['actions'] === undefined) {
      return fail(`${path}.options[${index}].actions`, 'is required')
    }
    actionsValue(optionRecord['actions'], `${path}.options[${index}].actions`)
  })
}

function effectsValue(value: unknown, path: string): readonly CardEffectBlock[] {
  if (!Array.isArray(value)) return fail(path, 'expected an array')
  return value.map((effect, index) => {
    recordObject(effect, `${path}[${index}]`)
    const record = effect as Record<string, unknown>
    for (const key of Object.keys(record)) {
      if (
        ![
          'actions',
          'choice',
          'condition',
          'event',
          'repeat',
          'then',
          'trigger'
        ].includes(key)
      ) {
        return fail(`${path}[${index}].${key}`, 'unknown effect field')
      }
    }
    enumValue(record['trigger'], CARD_TRIGGERS, `${path}[${index}].trigger`)
    const actions = record['actions']
    if (actions !== undefined && !Array.isArray(actions)) {
      return fail(`${path}[${index}].actions`, 'expected an array')
    }
    if (
      actions === undefined &&
      record['choice'] === undefined &&
      record['repeat'] === undefined
    ) {
      return fail(`${path}[${index}]`, 'requires actions, a choice, or a repeat')
    }
    if (Array.isArray(actions)) actionsValue(actions, `${path}[${index}].actions`)
    if (record['choice'] !== undefined) {
      choiceValue(record['choice'], `${path}[${index}].choice`)
    }
    if (record['condition'] !== undefined) {
      conditionValue(record['condition'], `${path}[${index}].condition`)
    }
    if (record['event'] !== undefined) {
      eventValue(record['event'], `${path}[${index}].event`)
    }
    if (record['then'] !== undefined) {
      branchValue(record['then'], `${path}[${index}].then`)
    }
    if (record['repeat'] !== undefined) {
      repeatValue(record['repeat'], `${path}[${index}].repeat`)
    }
    nestedActionsValue(record, `${path}[${index}]`)
    return record as CardEffectBlock
  })
}

function normalizeCost(raw: RawCardRecord, id: string): number {
  if (raw.cost === undefined || raw.cost === null || raw.cost === '') {
    if (NON_COSTED_CARD_IDS.has(id)) return 0
    return fail(`${id}.cost`, 'is required')
  }
  return finiteNumber(raw.cost, `${id}.cost`)
}

function defaultCollectible(_type: CardType, rarity: CardRarity): boolean {
  return !NON_COLLECTIBLE_RARITIES.has(rarity)
}

/** Validates and normalizes one authored card record into the domain union. */
export function validateCardRecord(
  value: unknown,
  expansionId: ExpansionId | string,
  indexOrPath = 'card'
): CardDefinition {
  const raw = recordObject(value, indexOrPath)
  const id = stringValue(raw.id, `${indexOrPath}.id`)
  const type = enumValue(raw.type, CARD_TYPES, `${indexOrPath}.type`)
  const rarity = enumValue(raw.rarity, CARD_RARITIES, `${indexOrPath}.rarity`)
  const cardClass = enumValue(raw.cardClass, CARD_CLASSES, `${indexOrPath}.cardClass`)
  const name = stringValue(raw.name, `${indexOrPath}.name`)
  const rulesText = textValue(raw.rulesText, `${indexOrPath}.rulesText`)
  const keywords = keywordsValue(raw.keywords, `${indexOrPath}.keywords`)
  const effects = effectsValue(raw.effects, `${indexOrPath}.effects`)
  const cost = normalizeCost(raw, id)
  const subtype = optionalString(raw.subtype, `${indexOrPath}.subtype`)
  const spellSchool = optionalString(raw.spellSchool, `${indexOrPath}.spellSchool`)
  const collectible = booleanValue(
    raw.collectible,
    `${indexOrPath}.collectible`,
    defaultCollectible(type, rarity)
  )
  const deckLegal = booleanValue(
    raw.deckLegal,
    `${indexOrPath}.deckLegal`,
    type !== 'Hero' && collectible
  )

  if (deckLegal && !collectible) {
    return fail(`${indexOrPath}.deckLegal`, 'cannot be true for a non-collectible card')
  }
  if (type === 'Hero' && deckLegal) {
    return fail(`${indexOrPath}.deckLegal`, 'hero cards are not deck cards')
  }

  const metadata = {
    id: asCardId(id),
    expansionId: asExpansionId(String(expansionId)),
    set: asExpansionId(String(expansionId)),
    name,
    rarity,
    cardClass: asClassId(cardClass),
    subtype,
    spellSchool,
    cost,
    rulesText,
    keywords,
    effects,
    collectible,
    deckLegal
  } as const

  if (type === 'Minion') {
    const attack = statistic(raw.attack, `${indexOrPath}.attack`, true)
    const health = statistic(raw.health, `${indexOrPath}.health`, true)
    if (attack === null || health === null)
      return fail(indexOrPath, 'invalid minion stats')
    if (raw.armor !== undefined && raw.armor !== null) {
      return fail(`${indexOrPath}.armor`, 'is not valid for minions')
    }
    return { ...metadata, type, attack, health }
  }

  if (type === 'Spell') {
    if (raw.attack !== undefined && raw.attack !== null) {
      return fail(`${indexOrPath}.attack`, 'is not valid for spells')
    }
    if (raw.health !== undefined && raw.health !== null) {
      return fail(`${indexOrPath}.health`, 'is not valid for spells')
    }
    if (raw.armor !== undefined && raw.armor !== null) {
      return fail(`${indexOrPath}.armor`, 'is not valid for spells')
    }
    return { ...metadata, type }
  }

  if (type === 'Weapon') {
    const attack = statistic(raw.attack, `${indexOrPath}.attack`, true)
    const durability = statistic(raw.health, `${indexOrPath}.health`, true)
    if (attack === null || durability === null)
      return fail(indexOrPath, 'invalid weapon stats')
    if (raw.armor !== undefined && raw.armor !== null) {
      return fail(`${indexOrPath}.armor`, 'is not valid for weapons')
    }
    return { ...metadata, type, attack, durability }
  }

  const armor = statistic(raw.armor, `${indexOrPath}.armor`, true)
  if (armor === null) return fail(indexOrPath, 'invalid hero stats')
  if (raw.attack !== undefined && raw.attack !== null) {
    return fail(`${indexOrPath}.attack`, 'is not valid for heroes')
  }
  if (raw.health !== undefined && raw.health !== null) {
    return fail(`${indexOrPath}.health`, 'is not valid for heroes')
  }
  return { ...metadata, type, armor }
}

/** Validates one non-card record so hero powers cannot silently enter CardCatalog. */
export function validateHeroPowerRecord(
  value: unknown,
  path = 'hero-power'
): RawHeroPowerRecord {
  const raw = recordObject(value, path)
  if (raw.type !== 'Hero Power') return fail(`${path}.type`, 'expected Hero Power')
  stringValue(raw.id, `${path}.id`)
  stringValue(raw.name, `${path}.name`)
  enumValue(raw.rarity, CARD_RARITIES, `${path}.rarity`)
  enumValue(raw.cardClass, CARD_CLASSES, `${path}.cardClass`)
  textValue(raw.rulesText, `${path}.rulesText`)
  normalizeCost(raw, String(raw.id))
  return raw as RawHeroPowerRecord
}

/** Runs the same record validator used by runtime catalog construction. */
export function validateCardSet(
  value: unknown,
  expansionId: ExpansionId | string,
  sourceName = String(expansionId)
): readonly CardDefinition[] {
  if (!Array.isArray(value)) return fail(sourceName, 'expected an array of records')

  const ids = new Set<string>()
  const cards: CardDefinition[] = []
  value.forEach((record, index) => {
    const raw = recordObject(record, `${sourceName}[${index}]`)
    if (raw.type === 'Hero Power') {
      validateHeroPowerRecord(raw, `${sourceName}[${index}]`)
      return
    }
    const card = validateCardRecord(raw, expansionId, `${sourceName}[${index}]`)
    if (ids.has(card.id))
      return fail(`${sourceName}[${index}].id`, `duplicate id ${card.id}`)
    ids.add(card.id)
    cards.push(card)
  })
  return cards
}
