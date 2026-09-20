import type { CardDefinition } from '../content/cards'
import { OPPONENT_CARD_RATINGS } from './opponent-card-ratings'

type Node = Record<string, unknown>
const record = (value: unknown): Node =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Node) : {}
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  const node = record(value)
  return Object.keys(node).length ? [node, ...Object.values(node).flatMap(nodes)] : []
}

/** Structural facts every fill candidate carries. Tags drive floors and archetype bias. */
export interface OpponentCardFacts {
  readonly card: CardDefinition
  readonly tags: readonly string[]
  readonly quality: number
  readonly board: boolean
  readonly early: boolean
  readonly interaction: boolean
  readonly resource: boolean
  readonly threat: boolean
}

/** Tags describe live mechanics: roles, tribes, cost buckets and keyword packages. */
export function assessCuratedCard(card: CardDefinition): OpponentCardFacts {
  const effects = nodes(card.effects)
  const actions = effects.filter((node) => typeof node.action === 'string')
  const immediate = card.effects
    .filter((effect) => ['cast', 'battlecry'].includes(effect.trigger))
    .flatMap(nodes)
    .filter((node) => typeof node.action === 'string')
  const has = (action: string): boolean =>
    actions.some((node) => node.action === action)
  const tags = new Set<string>()
  const minion = card.type === 'Minion'
  const body = minion && card.attack > 0
  const summons = immediate.filter((node) =>
    ['summon', 'summon-random', 'summon-jade-golem'].includes(String(node.action))
  )
  const board = body || summons.length > 0
  const early =
    card.cost <= 3 && (body || summons.some((node) => Number(node.count) >= 2))
  const interaction =
    card.type === 'Weapon' ||
    immediate.some((node) => {
      const target = record(node.target)
      return (
        [
          'damage',
          'destroy',
          'silence',
          'transform',
          'return-to-hand',
          'freeze'
        ].includes(String(node.action)) &&
        target.controller !== 'self' &&
        target.selection !== 'source'
      )
    })
  const resource = actions.some(
    (node) =>
      (['draw', 'discover'].includes(String(node.action)) &&
        node.player !== 'opponent') ||
      (node.action === 'add-to-hand' &&
        node.player !== 'opponent' &&
        node.cardId !== 'basic_the_coin')
  )
  if (board) tags.add('board')
  if (early) tags.add('early')
  if (interaction) tags.add('interaction')
  if (resource) tags.add('resource')
  if (minion) tags.add(`tribe:${card.subtype}`)
  if (card.type === 'Weapon') tags.add('weapon')
  if (card.type === 'Spell') {
    tags.add('spell')
    if (card.cost <= 3) tags.add('cheap-spell')
  }
  if (card.keywords.includes('taunt')) tags.add('taunt')
  if (card.keywords.includes('secret')) tags.add('secret')
  if (
    actions.some(
      (node) =>
        node.action === 'restore' &&
        record(node.target).controller !== 'opponent' &&
        record(node.target).type !== 'minion'
    )
  )
    tags.add('heal')
  if (minion && card.effects.some((effect) => effect.trigger === 'deathrattle'))
    tags.add('deathrattle')
  if (actions.some((node) => node.action === 'buff-cthun' && Number(node.attack) > 0))
    tags.add('cthun-buff')
  if (has('gain-mana')) tags.add('ramp')
  if (has('summon-jade-golem')) tags.add('jade')
  if (has('overload')) tags.add('overload')
  if (minion && card.subtype === 'Totem') tags.add('totem')
  for (const action of actions) {
    if (!['summon', 'summon-random'].includes(String(action.action))) continue
    if (action.cardId === 'basic_silver_hand_recruit') tags.add('recruit-source')
    if (record(action.filter).tribe === 'Totem') tags.add('totem')
    if (Number(action.count) >= 2 || (body && immediate.includes(action)))
      tags.add('token-source')
  }
  if (card.id === 'classic_violet_teacher') tags.add('token-source')
  if (card.cost <= 3) tags.add('cost:cheap')
  if (card.cost >= 8) tags.add('cost:8+')
  if (card.cost >= 6) tags.add('cost:6+')
  return {
    card,
    tags: [...tags],
    quality: Math.max(3, OPPONENT_CARD_RATINGS[card.id] ?? 4),
    board,
    early,
    interaction,
    resource,
    threat: body && card.cost >= 5
  }
}
