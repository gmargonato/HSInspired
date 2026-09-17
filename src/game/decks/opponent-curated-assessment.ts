import { CARD_CATALOG, type CardDefinition } from '../content/cards'
import type { OpponentCardAssessment } from './opponent-card-assessment'
import type { CuratedRequirement, OpponentArchetype } from './opponent-archetype'
import { OPPONENT_CARD_RATINGS } from './opponent-card-ratings'

type Node = Record<string, unknown>
const record = (value: unknown): Node =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Node) : {}
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  const node = record(value)
  return Object.keys(node).length ? [node, ...Object.values(node).flatMap(nodes)] : []
}

export interface CuratedCardFacts extends OpponentCardAssessment {
  readonly tags: readonly string[]
}

/** Tags describe live mechanics; dynamic admission is handled separately. */
export function assessCuratedCard(card: CardDefinition): CuratedCardFacts {
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
  if (card.keywords.includes('secret')) tags.add('secret')
  if (minion && card.effects.some((effect) => effect.trigger === 'deathrattle')) {
    tags.add('deathrattle')
    // Resurrected late bodies must contribute more than a small token or draw.
    if (card.cost >= 4 && card.attack >= 3) tags.add('large-deathrattle')
  }
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
    // A minion plus its summoned body (e.g. Mire Keeper) also develops multiple bodies.
    if (Number(action.count) >= 2 || (body && immediate.includes(action)))
      tags.add('token-source')
  }
  if (card.id === 'classic_violet_teacher') tags.add('token-source')
  if (card.cost >= 8) tags.add('cost:8+')
  if (card.cost >= 6) tags.add('cost:6+')
  if (card.cost >= 4 && card.cost <= 5) tags.add('cost:4-5')
  if (effects.some((node) => Array.isArray(record(node.choice).options)))
    tags.add('choose-one')
  if (card.keywords.includes('spell-damage')) tags.add('spell-damage')
  // These named roles cover reviewed mechanics whose selectors make broad inference unsafe.
  if (
    [
      'classic_power_overwhelming',
      'classic_abusive_sergeant',
      'classic_defender_of_argus',
      'classic_void_terror'
    ].includes(card.id)
  )
    tags.add('egg-activator')
  if (
    [
      'basic_slam',
      'classic_slam',
      'naxxramas_deaths_bite',
      'whispers_of_the_old_gods_blood_to_ichor',
      'whispers_of_the_old_gods_ravaging_ghoul'
    ].includes(card.id)
  )
    tags.add('friendly-damage')
  return {
    card,
    tags: [...tags],
    quality: Math.max(3, OPPONENT_CARD_RATINGS[card.id] ?? 4),
    board,
    early,
    interaction,
    resource,
    threat: body && card.cost >= 5,
    narrow: card.keywords.includes('secret'),
    dependent:
      !body &&
      !summons.length &&
      actions.some(
        (node) =>
          record(node.target).controller === 'self' &&
          record(node.target).type === 'minion'
      ),
    provides: [...tags],
    needs: []
  }
}

export function curatedCounts(
  cards: readonly CuratedCardFacts[]
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const card of cards)
    for (const tag of card.tags) counts[tag] = (counts[tag] ?? 0) + 1
  counts['secret-kind'] = new Set(
    cards.filter((card) => card.tags.includes('secret')).map((card) => card.card.id)
  ).size
  return counts
}

/** Conditional packages are checked even when their cards enter through flexible slots. */
export function curatedRequirements(
  archetype: OpponentArchetype,
  cards: readonly CuratedCardFacts[]
): CuratedRequirement[] {
  const requirements = [...archetype.requirements]
  const has = (id: string): boolean => cards.some((card) => card.card.id === id)
  const add = (tag: string, minimum: number): void => {
    requirements.push({ tag, minimum, maximum: 30 })
  }
  if (has('naxxramas_nerubian_egg')) add('egg-activator', 4)
  if (has('classic_grommash_hellscream')) add('friendly-damage', 2)
  if (has('whispers_of_the_old_gods_fandral_staghelm')) add('choose-one', 4)
  if (has('one_night_in_karazhan_spirit_claws')) add('spell-damage', 3)
  if (has('whispers_of_the_old_gods_thing_from_below')) add('totem', 5)
  if (has('one_night_in_karazhan_the_curator')) {
    add('tribe:Dragon', 6)
    add('tribe:Beast', 2)
    add('tribe:Murloc', 1)
  }
  return requirements
}

export function validateCuratedComposition(
  archetype: OpponentArchetype,
  cards: readonly CuratedCardFacts[],
  requirements: readonly CuratedRequirement[] = curatedRequirements(archetype, cards),
  allowed?: ReadonlySet<string>
): string[] {
  const errors: string[] = []
  for (const card of cards) {
    if (allowed && !allowed.has(card.card.id))
      errors.push(`Ineligible card: ${card.card.id}`)
  }
  for (const [id, maximum] of Object.entries(archetype.maxCopies ?? {})) {
    if (cards.filter((card) => card.card.id === id).length > maximum)
      errors.push(`Curated copy cap exceeded: ${id} (${maximum})`)
  }
  if (cards.length !== 30) errors.push(`Expected 30 cards; found ${cards.length}.`)
  const counts = curatedCounts(cards)
  for (const rule of requirements) {
    const count = counts[rule.tag] ?? 0
    if (count < rule.minimum || count > rule.maximum)
      errors.push(`${rule.tag}: ${count} outside ${rule.minimum}..${rule.maximum}`)
  }
  for (const slot of archetype.core) {
    if (cards.filter((card) => card.card.id === slot.id).length < slot.count)
      errors.push(`Missing core: ${CARD_CATALOG.require(slot.id).name} x${slot.count}`)
  }
  return errors
}
