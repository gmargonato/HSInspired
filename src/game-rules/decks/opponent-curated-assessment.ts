import { CARD_CATALOG, cardHasTribe, type CardDefinition } from '../content/cards'
import {
  OPPONENT_CARD_RATINGS,
  REVIEWED_FRIENDLY_DAMAGE
} from './opponent-card-ratings'

/** Disjoint mana-curve buckets; every drawable card belongs to exactly one. */
export const OPPONENT_CURVE_TAGS = [
  'cost:0-1',
  'cost:2',
  'cost:3',
  'cost:4',
  'cost:5',
  'cost:6+'
] as const
export type OpponentCurveTag = (typeof OPPONENT_CURVE_TAGS)[number]

/** Every tag the deck generator understands. Typos fail type checking. */
export type OpponentTag =
  | OpponentCurveTag
  | 'cost:8+'
  | 'board'
  | 'early'
  | 'interaction'
  | 'resource'
  | 'threat'
  | 'minion'
  | 'cost-1-minion'
  | 'weapon'
  | 'spell'
  | 'cheap-spell'
  | 'spell-damage'
  | 'taunt'
  | 'secret'
  | 'heal'
  | 'deathrattle'
  | 'cthun-buff'
  | 'ramp'
  | 'jade'
  | 'overload'
  | 'totem'
  | 'recruit-source'
  | 'token-source'
  | 'friendly-damage'
  | 'discard'
  | 'murloc-source'
  | 'egg-enabler'
  | `tribe:${string}`
  | `card:${string}`

export function opponentCurveTag(cost: number): OpponentCurveTag {
  if (cost <= 1) return 'cost:0-1'
  if (cost >= 6) return 'cost:6+'
  return `cost:${cost}` as OpponentCurveTag
}

type Node = Record<string, unknown>
const record = (value: unknown): Node =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Node) : {}
export function opponentEffectNodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(opponentEffectNodes)
  const node = record(value)
  return Object.keys(node).length
    ? [node, ...Object.values(node).flatMap(opponentEffectNodes)]
    : []
}

/** Keep timing and nested conditions attached to the actions they govern. */
export function opponentActionSignals(card: CardDefinition): readonly {
  readonly action: Node
  readonly reliability: number
}[] {
  const visit = (
    value: unknown,
    reliability: number
  ): { action: Node; reliability: number }[] => {
    if (Array.isArray(value)) return value.flatMap((entry) => visit(entry, reliability))
    const node = record(value)
    const weight =
      node.condition || node.choice || node.action === 'schedule'
        ? Math.min(reliability, 0.5)
        : reliability
    return [
      ...(typeof node.action === 'string'
        ? [{ action: node, reliability: weight }]
        : []),
      ...Object.entries(node)
        .filter(([key]) => !['condition', 'event', 'target', 'filter'].includes(key))
        .flatMap(([, entry]) => visit(entry, weight))
    ]
  }
  return card.effects.flatMap((effect) =>
    visit(
      effect,
      ['cast', 'battlecry'].includes(effect.trigger) ||
        (effect.trigger === 'deathrattle' && card.type === 'Minion' && card.attack > 0)
        ? 1
        : 0.5
    )
  )
}

/** Structural facts every fill candidate carries. Tags drive floors and archetype bias. */
export interface OpponentCardFacts {
  readonly card: CardDefinition
  readonly tags: readonly OpponentTag[]
  readonly quality: number
  readonly board: boolean
  readonly early: boolean
  readonly interaction: boolean
  readonly resource: boolean
  readonly usefulFeature: boolean
  readonly threat: boolean
}

/** Tags describe live mechanics: roles, tribes, cost buckets and keyword packages. */
export function assessCuratedCard(card: CardDefinition): OpponentCardFacts {
  const effects = opponentEffectNodes(card.effects)
  const actions = effects.filter((node) => typeof node.action === 'string')
  const immediate = card.effects
    .filter((effect) => ['cast', 'battlecry'].includes(effect.trigger))
    .flatMap(opponentEffectNodes)
    .filter((node) => typeof node.action === 'string')
  const has = (action: string): boolean =>
    actions.some((node) => node.action === action)
  const tags = new Set<OpponentTag>()
  const minion = card.type === 'Minion'
  const body = minion && card.attack > 0
  const summons = immediate.filter((node) =>
    ['summon', 'summon-random', 'summon-jade-golem'].includes(String(node.action))
  )
  const board = body || summons.length > 0
  const early =
    card.cost <= 3 &&
    ((body && card.attack + card.health >= 2 * card.cost) ||
      summons.some((node) => Number(node.count) >= 2))
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
  const givesResource = (node: Node): boolean =>
    (['draw', 'discover'].includes(String(node.action)) &&
      node.player !== 'opponent' &&
      node.player !== 'both') ||
    (node.action === 'add-to-hand' &&
      node.player !== 'opponent' &&
      node.player !== 'both' &&
      node.cardId !== 'basic_the_coin')
  const signals = opponentActionSignals(card)
  // Slow or conditional draw cannot fill the reliable resource floor.
  const resource = signals.some(
    ({ action, reliability }) => reliability === 1 && givesResource(action)
  )
  if (board) tags.add('board')
  if (early) tags.add('early')
  if (interaction) tags.add('interaction')
  if (resource) tags.add('resource')
  if (minion)
    for (const tribe of new Set([...(card.tribes ?? []), card.subtype].filter(Boolean)))
      tags.add(`tribe:${tribe === 'Mechanical' ? 'Mech' : tribe}`)
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
  if (minion && cardHasTribe(card, 'Totem')) tags.add('totem')
  for (const action of actions) {
    if (!['summon', 'summon-random'].includes(String(action.action))) continue
    if (action.cardId === 'basic_silver_hand_recruit') tags.add('recruit-source')
    if (record(action.filter).tribe === 'Totem') tags.add('totem')
    if (Number(action.count) >= 2 || (body && immediate.includes(action)))
      tags.add('token-source')
  }
  if (card.id === 'classic_violet_teacher') tags.add('token-source')
  tags.add(opponentCurveTag(card.cost))
  if (card.cost >= 8) tags.add('cost:8+')
  if (minion) tags.add('minion')
  if (minion && card.cost === 1) tags.add('cost-1-minion')
  if (body && card.cost >= 5) tags.add('threat')
  if ((card.spellDamage ?? 0) > 0) tags.add('spell-damage')
  if (
    REVIEWED_FRIENDLY_DAMAGE.has(card.id) ||
    actions.some((node) => {
      const target = record(node.target)
      return (
        node.action === 'damage' &&
        target.type === 'minion' &&
        ['self', 'any'].includes(String(target.controller)) &&
        typeof node.amount === 'number' &&
        node.amount <= 2
      )
    })
  )
    tags.add('friendly-damage')
  if (
    actions.some(
      (node) =>
        node.action === 'discard' &&
        (record(node.target).controller === 'self' || node.player === 'self')
    )
  )
    tags.add('discard')
  if (
    (minion && cardHasTribe(card, 'Murloc')) ||
    actions.some(
      (node) =>
        ['summon', 'summon-random'].includes(String(node.action)) &&
        (record(node.filter).tribe === 'Murloc' ||
          (typeof node.cardId === 'string' &&
            cardHasTribe(CARD_CATALOG.get(node.cardId), 'Murloc')))
    )
  )
    tags.add('murloc-source')
  const keywordBenefit =
    card.keywords.some((keyword) =>
      ['taunt', 'divine-shield', 'rush', 'charge', 'windfury'].includes(keyword)
    ) || (card.spellDamage ?? 0) > 0
  const benefit = (predicate: (node: Node) => boolean): number =>
    Math.max(
      0,
      ...signals
        .filter(({ action }) => predicate(action))
        .map(({ reliability }) => reliability)
    )
  const interactionBenefit =
    card.type === 'Weapon'
      ? 1
      : benefit(
          (node) =>
            [
              'damage',
              'destroy',
              'silence',
              'transform',
              'return-to-hand',
              'freeze'
            ].includes(String(node.action)) &&
            record(node.target).controller !== 'self' &&
            record(node.target).selection !== 'source'
        )
  const resourceBenefit = benefit(givesResource)
  const otherBenefit = benefit((node) => {
    const target = record(node.target)
    if (
      target.controller === 'opponent' ||
      node.controller === 'opponent' ||
      node.player === 'opponent' ||
      node.player === 'both'
    )
      return false
    return (
      ['summon', 'summon-random', 'summon-jade-golem', 'gain-mana'].includes(
        String(node.action)
      ) ||
      (node.action === 'restore' && Number(node.amount) > 0) ||
      (node.action === 'modify' && (Number(node.attack) > 0 || Number(node.health) > 0))
    )
  })
  // A drawing Deathrattle scores once as draw, never again for its trigger.
  const usefulFeature = keywordBenefit || otherBenefit > 0
  const efficientBody = body && card.attack + card.health >= 2 * card.cost + 1
  const weakBody =
    minion && (card.attack === 0 || card.attack + card.health < 2 * card.cost)
  const helpsOpponent = actions.some(
    (node) =>
      ((['restore', 'summon', 'summon-random'].includes(String(node.action)) ||
        (node.action === 'modify' &&
          (Number(node.attack) > 0 || Number(node.health) > 0))) &&
        (record(node.target).controller === 'opponent' ||
          node.player === 'opponent' ||
          node.controller === 'opponent')) ||
      (['draw', 'add-to-hand', 'gain-mana'].includes(String(node.action)) &&
        ['opponent', 'both'].includes(String(node.player))) ||
      (node.action === 'change-cost' &&
        record(node.target).controller === 'opponent' &&
        (Number(node.amount) < 0 ||
          (record(node.amount).operation === 'set' && record(node.amount).value === 0)))
  )
  const hindersSelf = actions.some(
    (node) =>
      (node.action === 'change-cost' &&
        record(node.target).controller === 'self' &&
        Number(node.amount) > 0) ||
      (node.action === 'grant-keyword' &&
        record(node.target).selection === 'source' &&
        [
          'cannot-attack',
          'cannot-attack-heroes',
          'attack-wrong-enemy-chance-50'
        ].includes(String(node.keyword)))
  )
  const automaticQuality = Math.min(
    4,
    Math.max(
      0,
      2 +
        Number(efficientBody) -
        Number(weakBody) +
        interactionBenefit +
        resourceBenefit +
        Math.max(Number(keywordBenefit), otherBenefit) -
        (helpsOpponent ? 2 : 0) -
        (hindersSelf ? 2 : 0)
    )
  )
  return {
    card,
    tags: [...tags],
    quality: OPPONENT_CARD_RATINGS[card.id] ?? automaticQuality,
    board,
    early,
    interaction,
    resource,
    usefulFeature,
    threat: body && card.cost >= 5
  }
}
