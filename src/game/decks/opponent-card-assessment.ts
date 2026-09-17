import { CARD_CATALOG, type CardDefinition, type CardId } from '../content/cards'
import { isCollectibleDeckCard } from './deck-rules'
import {
  OPPONENT_CARD_RATINGS,
  REVIEWED_FRIENDLY_DAMAGE
} from './opponent-card-ratings'

type EffectRecord = Readonly<Record<string, unknown>>

export interface OpponentSupport {
  readonly key: string
  readonly minimum: number
  readonly earlyMinimum: number
}

export interface OpponentCardAssessment {
  readonly card: CardDefinition
  readonly quality: number
  readonly board: boolean
  readonly early: boolean
  readonly interaction: boolean
  readonly resource: boolean
  readonly threat: boolean
  readonly narrow: boolean
  readonly dependent: boolean
  readonly provides: readonly string[]
  readonly needs: readonly OpponentSupport[]
}

function record(value: unknown): EffectRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as EffectRecord)
    : {}
}

function records(value: unknown): EffectRecord[] {
  if (Array.isArray(value)) return value.flatMap(records)
  const entry = record(value)
  return Object.keys(entry).length
    ? [entry, ...Object.values(entry).flatMap(records)]
    : []
}

const SAFE_ACTIONS = new Set([
  'damage',
  'damage-group',
  'draw',
  'restore',
  'gain-armor',
  'summon',
  'summon-random',
  'summon-jade-golem',
  'add-to-hand',
  'discover',
  'modify',
  'grant-keyword',
  'grant-keywords',
  'silence',
  'freeze',
  'destroy',
  'equip',
  'overload',
  'change-cost',
  'transform',
  'unlock-overload',
  'gain-mana'
])
const SAFE_CONDITIONS = new Set([
  'player-has-card-in-hand',
  'player-has-minion',
  'player-lacks-minion',
  'player-has-weapon',
  'source-damaged',
  'combo',
  'not-combo',
  'combo-active',
  'target-died',
  'target-survived',
  'target-damaged',
  'player-turn'
])
const SAFE_TRIGGERS = new Set([
  'cast',
  'battlecry',
  'deathrattle',
  'aura',
  'end-of-turn',
  'start-of-turn',
  'on-summon',
  'on-cast',
  'on-damage',
  'on-death',
  'on-heal',
  'on-overload',
  'inspire',
  'while-in-hand',
  'on-attack',
  'on-play'
])

function tribeKey(filter: EffectRecord): string | undefined {
  if (typeof filter.tribe === 'string') return `tribe:${filter.tribe}`
  if (typeof filter.cardId === 'string') return `card:${filter.cardId}`
  return undefined
}

/** Conservative mechanics recognition. Unknown restrictions never become free synergy. */
export function assessOpponentCard(
  card: CardDefinition
): OpponentCardAssessment | undefined {
  if (
    !isCollectibleDeckCard(card) ||
    card.type === 'Hero' ||
    card.cost > 10 ||
    card.playCondition
  )
    return undefined
  if (
    card.keywords.some((key) =>
      [
        'cannot-attack',
        'cannot-attack-heroes',
        'secret',
        'attack-wrong-enemy-chance-50'
      ].includes(key)
    )
  )
    return undefined
  const nodes = records(card.effects)
  const actions = nodes.filter((node) => typeof node.action === 'string')
  const reviewed = OPPONENT_CARD_RATINGS[card.id]
  if (reviewed === 0) return undefined
  if (
    actions.some((node) => !SAFE_ACTIONS.has(String(node.action))) ||
    card.effects.some((effect) => !SAFE_TRIGGERS.has(effect.trigger))
  )
    return undefined
  const conditions = nodes.flatMap((node) =>
    node.condition ? [record(node.condition)] : []
  )
  if (conditions.some((condition) => !SAFE_CONDITIONS.has(String(condition.type))))
    return undefined
  // Dynamic formulae need review; stats alone cannot assess their dependency or downside.
  if (
    !reviewed &&
    nodes.some((node) => node.reference !== undefined || node.operation !== undefined)
  )
    return undefined
  if (
    nodes.some(
      (node) =>
        node.player === 'opponent' ||
        node.player === 'both' ||
        node.player === 'each' ||
        (node.controller === 'opponent' &&
          ['summon', 'summon-random', 'modify', 'restore'].includes(
            String(node.action)
          ))
    )
  )
    return undefined
  if (
    actions.some((action) => {
      const target = record(action.target)
      if (action.action === 'restore' && target.controller === 'opponent') return true
      if (action.action === 'silence' && target.controller === 'self') return true
      if (
        action.action === 'damage' &&
        (target.controller === 'self' ||
          (target.controller === 'any' && target.selection === 'all') ||
          target.selection === 'source')
      )
        return !REVIEWED_FRIENDLY_DAMAGE.has(card.id)
      return (
        action.action === 'destroy' &&
        (target.controller === 'self' || target.selection === 'all')
      )
    })
  )
    return undefined

  const provides = new Set<string>()
  const needs = new Map<string, OpponentSupport>()
  const need = (key: string, minimum: number, earlyMinimum = 0): void => {
    const previous = needs.get(key)
    needs.set(key, {
      key,
      minimum: Math.max(minimum, previous?.minimum ?? 0),
      earlyMinimum: Math.max(earlyMinimum, previous?.earlyMinimum ?? 0)
    })
  }
  const body = card.type === 'Minion' && card.attack > 0 && card.health > 0
  if (card.type === 'Minion') {
    provides.add(`deck:minion-cost:${card.cost}`)
    provides.add(`deck:card:${card.id}`)
    if (card.subtype && card.subtype !== 'General')
      provides.add(`deck:tribe:${card.subtype}`)
  }
  if (body) {
    provides.add('board')
    provides.add(`board:card:${card.id}`)
    provides.add(`hand:card:${card.id}`)
    if (card.subtype && card.subtype !== 'General') {
      provides.add(`board:tribe:${card.subtype}`)
      provides.add(`hand:tribe:${card.subtype}`)
    }
  }
  if (card.type === 'Spell' && card.cost <= 3) provides.add('spells')
  if (card.type === 'Spell') provides.add(`spell-cost:${card.cost}`)
  if (card.type === 'Weapon') provides.add('weapons')
  let summonBoard = false
  let resilient = card.keywords.includes('divine-shield')
  let interaction = card.type === 'Weapon' && card.attack >= 2
  let resource = false
  let narrow = false
  let hasBuff = false

  for (const condition of conditions) {
    const filter = record(condition.filter)
    const key = tribeKey(filter)
    if (condition.type === 'player-has-card-in-hand') {
      if (
        (condition.player !== undefined && condition.player !== 'self') ||
        !key ||
        Object.keys(filter).some((k) => !['tribe', 'cardId'].includes(k))
      )
        return undefined
      need(`hand:${key}`, 8)
    } else if (
      condition.type === 'player-has-minion' ||
      condition.type === 'player-lacks-minion'
    ) {
      if (
        (condition.player !== undefined && condition.player !== 'self') ||
        !key ||
        Object.keys(filter).some((k) => !['tribe', 'cardId'].includes(k))
      )
        return undefined
      need(`board:${key}`, 8, 4)
    } else if (condition.type === 'player-has-weapon') need('weapons', 4)
    else if (condition.type === 'combo' || condition.type === 'combo-active')
      need('cheap-plays', 6)
  }

  for (const effect of card.effects) {
    const event = record(effect.event)
    const eventFilter = record(event.filter)
    const targetFilter = record(record(event.target).filter)
    const eventTribe = tribeKey(eventFilter) ?? tribeKey(targetFilter)
    if (effect.trigger === 'on-summon' || effect.trigger === 'on-death')
      need(
        eventTribe ? `board:${eventTribe}` : 'board',
        eventTribe ? 8 : 14,
        eventTribe ? 4 : 6
      )
    if (effect.trigger === 'on-cast' && event.controller !== 'opponent') {
      // Restricted spell triggers need matching providers, not arbitrary spells.
      if (Object.keys(eventFilter).some((key) => key !== 'cost')) return undefined
      if (eventFilter.cost !== undefined) {
        if (!Number.isInteger(eventFilter.cost) || Number(eventFilter.cost) < 0)
          return undefined
        need(`spell-cost:${String(eventFilter.cost)}`, 6)
      } else need('spells', 6)
    }
    if (effect.trigger === 'on-heal')
      need(record(event.target).type === 'minion' ? 'minion-healing' : 'healing', 3)
    if (effect.trigger === 'on-overload') need('overload', 4)
    // Source-damage rewards can also activate through normal minion combat.
    if (effect.trigger === 'on-damage' && record(event.source).selection !== 'source') {
      provides.add('damage-beneficiary')
      if (!body || (card.type === 'Minion' && card.attack < 2))
        need('friendly-damage', 4)
    }
    for (const action of records(effect).filter(
      (node) => typeof node.action === 'string'
    )) {
      const target = record(action.target)
      const filter = record(target.filter)
      const key = tribeKey(filter)
      const immediate = ['cast', 'battlecry', 'deathrattle'].includes(effect.trigger)
      const unconditional =
        !effect.condition && !nodes.some((node) => node.then !== undefined)
      const friendly = target.controller === 'self' || target.selection === 'source'
      if (action.action === 'overload') provides.add('overload')
      if (action.action === 'equip') provides.add('weapons')
      if (action.action === 'restore' && target.controller !== 'opponent')
        provides.add('healing')
      if (
        action.action === 'restore' &&
        ['minion', 'character'].includes(String(target.type)) &&
        ['chosen', 'all'].includes(String(target.selection))
      )
        provides.add('minion-healing')
      if (
        ['draw', 'add-to-hand', 'discover'].includes(String(action.action)) &&
        action.player === 'self' &&
        !record(action.filter).cardId
      ) {
        const source = record(action.source)
        const drawFilter = record(action.filter)
        if (action.action === 'draw' && Object.keys(drawFilter).length) {
          const drawKey =
            tribeKey(drawFilter) ??
            (drawFilter.cardType === 'Minion' && typeof drawFilter.cost === 'number'
              ? `minion-cost:${drawFilter.cost}`
              : undefined)
          if (!drawKey) return undefined
          need(
            `deck:${drawKey}`,
            typeof action.count === 'number' ? Math.max(3, action.count * 2) : 6
          )
        }
        if (source.zone === 'deck') {
          const sourceKey = tribeKey(record(source.filter))
          if (!sourceKey) return undefined
          need(`deck:${sourceKey}`, 6)
        }
        if (record(action.count).reference === 'matching-entity-count') {
          const countFilter = record(record(record(action.count).selector).filter)
          if (countFilter.damaged !== true) return undefined
          need('friendly-damage', 4)
          need('damage-body', 8)
        }
        // Conditional or repeated draw is credited only with supported dependencies.
        const generatedCard =
          typeof action.cardId === 'string'
            ? CARD_CATALOG.get(action.cardId)
            : undefined
        const onlyMana = generatedCard?.effects.every((block) =>
          block.actions?.every((entry) => entry.action === 'gain-mana')
        )
        if (onlyMana) continue
        if (unconditional && (immediate || effect.trigger === 'end-of-turn'))
          resource = true
        else if (needs.size > 0 && !nodes.some((node) => node.then !== undefined))
          resource = true
      }
      if (action.action === 'damage') {
        if (
          target.type !== 'hero' &&
          (target.controller === 'opponent' || target.selection === 'chosen')
        ) {
          if (typeof action.amount === 'number' && action.amount >= 2 && immediate)
            interaction = true
          if (
            target.selection === 'chosen' &&
            target.controller !== 'opponent' &&
            Number(action.amount) <= 2
          )
            provides.add('friendly-damage')
        }
        if (
          target.selection === 'all' &&
          Number(action.amount) <= 2 &&
          REVIEWED_FRIENDLY_DAMAGE.has(card.id)
        )
          provides.add('friendly-damage')
      }
      if (
        ['silence', 'destroy', 'transform'].includes(String(action.action)) &&
        immediate &&
        (target.controller === 'opponent' || target.selection === 'chosen') &&
        !friendly
      ) {
        interaction = true
        if (Object.keys(filter).length > 0) narrow = true
      }
      if (
        action.action === 'modify' ||
        action.action === 'grant-keyword' ||
        action.action === 'grant-keywords'
      ) {
        for (const amount of [action.attack, action.health]) {
          const selector = record(record(amount).selector)
          const selectedKey = tribeKey(record(selector.filter))
          if (selectedKey && selector.controller === 'self')
            need(`board:${selectedKey}`, 6, 2)
        }
        if (
          target.type === 'weapon' ||
          record(action.attack).reference === 'source.weapon.attack'
        )
          need('weapons', 4)
        if (
          target.selection !== 'source' &&
          target.selection !== 'last-summoned' &&
          target.selection !== 'stored' &&
          (friendly || target.selection === 'chosen') &&
          (Number(action.attack) > 0 ||
            Number(action.health) > 0 ||
            action.keyword === 'taunt')
        ) {
          hasBuff = true
          if (key)
            need(
              `${target.zone === 'hand' ? 'hand' : 'board'}:${key}`,
              key.startsWith('card:') ? 4 : 8,
              target.zone === 'hand' ? 0 : key.startsWith('card:') ? 2 : 4
            )
          else if (target.type === 'minion') need('board', 14, 6)
          if (
            Number(action.attack) > 0 &&
            !key &&
            !target.zone &&
            target.type === 'minion'
          )
            provides.add('activators')
        }
      }
      if (action.action === 'change-cost') {
        // Taxing enemy spells is disruption, not a dependency on our own spells.
        if (target.controller === 'opponent') continue
        const actionFilter = record(target.filter)
        const costKey = tribeKey(actionFilter)
        if (costKey) need(`hand:${costKey}`, 8)
        else if (actionFilter.cardType === 'Spell') need('spells', 6)
        else if (
          record(action.amount).reference === 'friendly-totems-summoned-this-game'
        )
          need('board:tribe:Totem', 6, 2)
        else return undefined
      }
      if (action.action === 'summon-jade-golem') {
        provides.add('jade')
        need('jade', 5)
        if (immediate) summonBoard = true
      }
      if (
        ['summon', 'summon-random'].includes(String(action.action)) &&
        immediate &&
        !effect.condition &&
        target.controller !== 'opponent'
      ) {
        // Random pools supply general board presence, never a guaranteed tribe/card.
        summonBoard = true
        if (effect.trigger === 'deathrattle' && body) resilient = true
        const summonFilter = record(action.filter)
        if (typeof summonFilter.tribe === 'string')
          provides.add(`board:tribe:${summonFilter.tribe}`)
        if (typeof action.cardId === 'string') {
          const token = CARD_CATALOG.get(action.cardId)
          if (token?.type === 'Minion' && token.attack > 0) {
            provides.add(`board:card:${token.id}`)
            if (token.subtype && token.subtype !== 'General')
              provides.add(`board:tribe:${token.subtype}`)
          }
        }
      }
    }
  }
  if (card.type === 'Minion' && card.attack === 0 && summonBoard) {
    need('activators', 4)
    summonBoard = false // An egg cannot establish useful pressure without an activator.
    provides.clear()
  }
  const board = body || summonBoard
  if (board) provides.add('board')
  if (resilient && body) provides.add('resilient')
  if (hasBuff) provides.add('buffs')
  if (card.type === 'Minion' && card.attack >= 2 && card.health >= 3)
    provides.add('damage-body')
  const bodyScore =
    card.type === 'Minion'
      ? ((card.attack + card.health) / (2 * Math.max(1, card.cost) + 1)) * 3
      : card.type === 'Weapon'
        ? (card.attack * card.durability) / Math.max(1, card.cost)
        : interaction &&
            actions.some(
              (action) =>
                action.action === 'damage' &&
                Number(action.amount) >= Math.max(2, card.cost)
            )
          ? 3
          : resource && card.cost >= 1 && card.cost <= 3
            ? 3
            : 0
  const quality =
    reviewed ??
    Math.min(
      4,
      bodyScore +
        (resilient ? 0.8 : 0) +
        (resource ? 0.7 : 0) +
        (interaction ? 0.5 : 0) +
        (card.keywords.includes('taunt') ? 0.2 : 0)
    )
  if (
    quality < 2.7 ||
    (narrow && !reviewed) ||
    (!board && !interaction && !resource && !hasBuff && !needs.has('activators'))
  )
    return undefined
  if (
    !reviewed &&
    card.type === 'Minion' &&
    !resilient &&
    !interaction &&
    !resource &&
    (card.health < card.cost ||
      card.attack < Math.max(1, Math.floor(card.cost / 2)) ||
      card.cost >= 6)
  )
    return undefined
  const dependent =
    needs.size > 0 &&
    [...needs.keys()].some((key) => key !== 'jade') &&
    (card.type !== 'Minion' ||
      card.attack === 0 ||
      card.attack + card.health < 2 * card.cost)
  // Unknown low-stat engines are not automatically treated as strong early drops.
  const early =
    card.cost > 0 &&
    card.cost <= 3 &&
    !dependent &&
    board &&
    (summonBoard ||
      (card.type === 'Minion' &&
        card.attack > 0 &&
        (card.attack + card.health >= card.cost * 2 ||
          card.keywords.includes('divine-shield'))))
  if (early && card.cost <= 2) provides.add('cheap-plays')
  return {
    card,
    quality,
    board,
    early,
    interaction,
    resource,
    threat:
      card.cost >= 5 &&
      needs.size === 0 &&
      board &&
      (summonBoard || (card.type === 'Minion' && card.attack >= 4)),
    narrow,
    dependent,
    provides: [...provides],
    needs: [...needs.values()]
  }
}

/** Assessments are cached once; source definitions are immutable. */
let assessments: readonly OpponentCardAssessment[] | undefined
export function getOpponentCardAssessments(): readonly OpponentCardAssessment[] {
  return (assessments ??= CARD_CATALOG.all
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .flatMap((card) => {
      const assessment = assessOpponentCard(card)
      return assessment ? [assessment] : []
    }))
}

export function assessmentCounts(
  cards: readonly OpponentCardAssessment[]
): Record<CardId, number> {
  const counts: Record<CardId, number> = {}
  for (const { card } of cards) counts[card.id] = (counts[card.id] ?? 0) + 1
  return counts
}
