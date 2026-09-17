import { CARD_CATALOG, type CardDefinition, type HeroId } from '../content/cards'
import { isCollectibleDeckCard } from './deck-rules'
import { assessOpponentCard } from './opponent-card-assessment'
import { assessCuratedCard, type CuratedCardFacts } from './opponent-curated-assessment'
import type { OpponentArchetype } from './opponent-archetype'
import {
  inspectCardCapabilities,
  runtimeCapabilityKeys
} from '../match/effects/capability'
import { heroSupport } from './opponent-strategy'
import { OPPONENT_CARD_RATINGS } from './opponent-card-ratings'

type Node = Record<string, unknown>
const record = (value: unknown): Node =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Node) : {}
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  const node = record(value)
  return Object.keys(node).length ? [node, ...Object.values(node).flatMap(nodes)] : []
}
const capabilities = runtimeCapabilityKeys()

/** Quest and Hero cards are injected as deliberate power cards, not support picks. */
export function isOpponentPowerCard(card: CardDefinition): boolean {
  return card.type === 'Hero' || (card.type === 'Spell' && card.quest !== undefined)
}

// Supplemental families are recognized structurally. Unknown actions/conditions stay out.
const actionsUnderstood = new Set(
  `damage damage-group draw restore gain-armor summon summon-random summon-jade-golem add-to-hand discover modify grant-keyword grant-keywords silence freeze destroy equip overload change-cost transform unlock-overload gain-mana destroy-mana buff-cthun grant-deathrattle resurrect return-to-hand discard reveal schedule combine-choose-one put-into-play`.split(
    ' '
  )
)
const conditionsUnderstood = new Set(
  `player-has-card-in-hand player-has-minion player-lacks-minion player-has-weapon source-damaged combo not-combo combo-active target-died target-survived target-damaged player-turn cthun-attack-at-least player-has-hand-count`.split(
    ' '
  )
)

/** Reassessed by definition identity, so added/replaced catalog cards never inherit stale facts. */
const cache = new WeakMap<CardDefinition, CuratedCardFacts | null>()
export function assessDynamicCard(card: CardDefinition): CuratedCardFacts | undefined {
  if (cache.has(card)) return cache.get(card) ?? undefined
  const result = assess(card)
  cache.set(card, result ?? null)
  return result
}
function assess(card: CardDefinition): CuratedCardFacts | undefined {
  if (
    !isCollectibleDeckCard(card) ||
    isOpponentPowerCard(card) ||
    card.cost > 10 ||
    card.playCondition
  )
    return undefined
  if (
    card.keywords.some((key) =>
      [
        'cannot-attack',
        'cannot-attack-heroes',
        'attack-wrong-enemy-chance-50'
      ].includes(key)
    )
  )
    return undefined
  if (!inspectCardCapabilities(card, capabilities).supported) return undefined
  if (OPPONENT_CARD_RATINGS[card.id] === 0) return undefined
  // This catalog entry currently omits its attack restriction from structured effects.
  if (card.id === 'whispers_of_the_old_gods_silithid_swarmer') return undefined
  const baseline = assessOpponentCard(card)
  const all = nodes(card.effects)
  const actions = all.filter((node) => typeof node.action === 'string')
  const has = (action: string): boolean =>
    actions.some((node) => node.action === action)
  const secret = card.keywords.includes('secret')
  if (has('discard') && !(card.type === 'Minion' && card.subtype === 'Demon'))
    return undefined
  if (
    actions.some(
      (node) => node.action === 'discard' && record(node.source).selection === 'all'
    )
  )
    return undefined
  if (card.type === 'Minion' && card.health <= 1 && has('overload')) return undefined
  if (
    card.type === 'Spell' &&
    actions.length &&
    actions.every(
      (node) => node.action === 'damage' && record(node.target).type === 'hero'
    )
  )
    return undefined
  const cultist =
    actions.some(
      (node) =>
        node.action === 'buff-cthun' && node.cardId === 'whispers_of_the_old_gods_cthun'
    ) || all.some((node) => record(node.condition).type === 'cthun-attack-at-least')
  const choices = all.some((node) => Array.isArray(record(node.choice).options))
  const extra =
    card.keywords.includes('spell-damage') ||
    has('gain-mana') ||
    (card.type === 'Spell' &&
      actions.some(
        (node) => node.action === 'damage' && record(node.target).controller !== 'self'
      )) ||
    (card.type === 'Minion' &&
      card.subtype === 'Demon' &&
      actions.some((node) => record(record(node.target).filter).tribe === 'Demon')) ||
    secret ||
    cultist ||
    choices ||
    has('grant-deathrattle') ||
    has('return-to-hand') ||
    (card.type === 'Minion' && card.subtype === 'Demon' && has('discard'))
  if (!baseline) {
    const triggers = new Set(
      'cast battlecry deathrattle aura end-of-turn start-of-turn on-summon on-cast on-damage on-death inspire while-in-hand on-attack on-play secret on-secret-played on-secret-revealed'.split(
        ' '
      )
    )
    if (card.effects.some((effect) => !triggers.has(effect.trigger))) return undefined
    if (all.some((node) => node.operation !== undefined)) return undefined
    if (!extra || actions.some((node) => !actionsUnderstood.has(String(node.action))))
      return undefined
    if (
      all.some(
        (node) =>
          node.condition &&
          !conditionsUnderstood.has(String(record(node.condition).type))
      )
    )
      return undefined
    if (
      all.some(
        (node) =>
          node.player === 'opponent' || node.player === 'both' || node.player === 'each'
      )
    )
      return undefined
    if (
      actions.some((node) => {
        const target = record(node.target)
        return (
          (node.action === 'damage' &&
            (target.controller === 'self' || target.selection === 'source')) ||
          (node.action === 'destroy' && target.controller === 'self') ||
          (node.action === 'return-to-hand' && target.controller === 'self')
        )
      })
    )
      return undefined
    if (
      all.some(
        (node) =>
          node.reference &&
          !['source.attack', 'event.amount'].includes(String(node.reference))
      )
    )
      return undefined
  }
  const raw = assessCuratedCard(card)
  const tags = new Set(raw.tags)
  if (baseline) for (const tag of baseline.provides) tags.add(tag)
  if (card.cardClass !== 'Neutral') tags.add('class-card')
  if (raw.threat) tags.add('threat')
  if (card.type === 'Minion') {
    for (const zone of ['board', 'hand', 'deck'])
      tags.add(`${zone}:tribe:${card.subtype}`)
    if (
      card.attack + card.health < Math.max(3, 2 * card.cost) &&
      !card.keywords.includes('divine-shield') &&
      !raw.resource &&
      !raw.interaction &&
      !has('summon') &&
      !has('summon-random') &&
      !has('summon-jade-golem') &&
      !has('change-cost') &&
      !has('modify') &&
      !cultist
    )
      tags.add('weak-body')
    if (card.subtype === 'Demon' && card.cost >= 5 && card.attack >= 4)
      tags.add('demon-target')
    if (
      card.keywords.includes('divine-shield') ||
      (raw.tags.includes('deathrattle') && (has('summon') || has('summon-random')))
    )
      tags.add('resilient')
  }
  for (const node of all) {
    const condition = record(node.condition)
    const tribe = record(condition.filter).tribe
    if (tribe === 'Dragon') tags.add('dragon-payoff')
    if (tribe === 'Mech') tags.add('mech-payoff')
    if (condition.type === 'cthun-attack-at-least') tags.add('cthun-payoff')
    if (record(node.event).type === 'secret-played') tags.add('secret-payoff')
    if (node.trigger === 'on-cast' && record(node.event).controller !== 'opponent')
      tags.add('spell-payoff')
    if (
      node.trigger === 'on-cast' &&
      record(node.event).controller === 'self' &&
      nodes(node).some((child) => child.action === 'summon')
    )
      tags.add('token-source')
  }
  for (const node of actions) {
    const target = record(node.target)
    if (node.action === 'add-to-hand' && record(node.filter).sparePart === true)
      tags.add('spare-parts')
    if (node.action === 'change-cost' && record(target.filter).tribe === 'Mech')
      tags.add('mech-payoff')
    if (
      node.action === 'modify' &&
      target.controller !== 'opponent' &&
      target.type === 'minion' &&
      Number(node.attack) > 0 &&
      target.selection !== 'source'
    ) {
      tags.add('buff')
      if (!record(target.filter).tribe && !record(target.filter).cardId)
        tags.add('egg-activator')
      if (target.selection === 'all' || target.selection === 'adjacent')
        tags.add('board-buff')
    }
    if (
      node.action === 'grant-deathrattle' &&
      target.controller === 'self' &&
      target.selection === 'all'
    )
      tags.add('board-buff')
  }
  // Keep generated tokens distinct from minions that are actually drawn into hand.
  if (secret) tags.add('secret-kind')
  const bodyScore =
    card.type === 'Minion'
      ? (3 * (card.attack + card.health)) / (2 * Math.max(1, card.cost) + 1)
      : 3
  const quality =
    baseline?.quality ??
    Math.min(
      4.5,
      bodyScore +
        (raw.resource ? 0.6 : 0) +
        (card.keywords.includes('spell-damage') ? 1.5 : 0) +
        (raw.interaction ? 1 : 0) +
        (raw.board && card.type === 'Spell' ? 0.7 : 0) +
        (card.type === 'Minion' && actions.some((node) => node.action === 'summon')
          ? 0.7
          : 0) +
        (card.type === 'Minion' &&
        card.subtype === 'Demon' &&
        actions.some((node) => record(record(node.target).filter).tribe === 'Demon')
          ? 0.8
          : 0) +
        (tags.has('resilient') ? 0.6 : 0) +
        (cultist ? 0.8 : 0)
    )
  if (raw.early) for (const tag of [...tags]) tags.add(`early:${tag}`)
  return {
    ...raw,
    quality,
    tags: [...tags],
    provides: [...tags],
    needs: baseline?.needs ?? []
  }
}

export function isArchetypeCandidate(
  card: CuratedCardFacts,
  archetype: OpponentArchetype
): boolean {
  if (card.card.cardClass !== 'Neutral' && card.card.cardClass !== archetype.classId)
    return false
  const interests = new Set([
    ...archetype.preferences,
    ...archetype.requirements.map((rule) => rule.tag)
  ])
  const related = archetype.preferences.some((tag) => card.tags.includes(tag))
  if (card.quality < (related ? 3 : card.interaction || card.resource ? 3.3 : 3.6))
    return false
  if (
    (card.tags.includes('cthun-buff') || card.tags.includes('cthun-payoff')) &&
    !interests.has('cthun-buff')
  )
    return false
  if (card.tags.includes('secret') && !interests.has('secret')) return false
  if (card.tags.includes('jade') && !interests.has('jade')) return false
  // Powerful mechanics with substantial dependencies cannot drift into unrelated decks.
  for (const need of card.needs) {
    const tribe = need.key.match(/tribe:(.+)$/)?.[1]
    if (
      tribe &&
      !interests.has(`tribe:${tribe}`) &&
      !(tribe === 'Totem' && interests.has('totem'))
    )
      return false
    if (
      need.key === 'spells' &&
      !interests.has('cheap-spell') &&
      !interests.has('spell-payoff')
    )
      return false
    if (need.key.startsWith('spell-cost:')) return false
    if (need.key.includes(':card:') && !need.key.endsWith('basic_silver_hand_recruit'))
      return false
    if (need.key === 'jade' && !interests.has('jade')) return false
    if (need.key.includes('healing') && archetype.classId !== 'Priest') return false
    if (need.key === 'friendly-damage' && archetype.classId !== 'Warrior') return false
    if (
      need.key === 'activators' &&
      !interests.has('deathrattle') &&
      !interests.has('tribe:Demon')
    )
      return false
  }
  return true
}

export function dynamicOpponentPool(
  archetype: OpponentArchetype,
  definitions: readonly CardDefinition[] = CARD_CATALOG.all
): CuratedCardFacts[] {
  return definitions
    .flatMap((card) => {
      const facts = assessDynamicCard(card)
      return facts && isArchetypeCandidate(facts, archetype) ? [facts] : []
    })
    .sort((a, b) => a.card.id.localeCompare(b.card.id))
}

export function dependencyRequirements(
  cards: readonly CuratedCardFacts[],
  heroId: HeroId
): { tag: string; minimum: number; maximum: number }[] {
  return cards.flatMap((card) =>
    card.needs.flatMap((need) => {
      // Reserve an extra matching copy when the payoff is itself a provider.
      const minimum =
        Math.max(0, need.minimum - heroSupport(heroId, need.key)) +
        Number(card.tags.includes(need.key))
      return [
        { tag: need.key, minimum, maximum: 30 },
        ...(need.earlyMinimum
          ? [{ tag: `early:${need.key}`, minimum: need.earlyMinimum, maximum: 30 }]
          : [])
      ]
    })
  )
}
