import type { CardDefinition, DeckClass } from '../content/cards'
import {
  assessCuratedCard,
  opponentEffectNodes,
  opponentActionSignals,
  type OpponentTag
} from './opponent-curated-assessment'

export interface OpponentSupportRequirement {
  readonly tag: OpponentTag
  readonly min: number
}
export interface OpponentSupportGap extends OpponentSupportRequirement {
  readonly index: number
  readonly actual: number
}

/** Support a class hero power supplies every game, counted as virtual deck copies. */
export const HERO_POWER_SUPPORT: Readonly<
  Partial<Record<DeckClass, Readonly<Partial<Record<OpponentTag, number>>>>>
> = {
  // Totemic Call summons a Totem (sometimes a Spell Damage totem) each use.
  Shaman: { totem: 3, 'spell-damage': 1 },
  // Dagger Mastery equips a weapon every turn it is used.
  Rogue: { weapon: 3 }
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
const CTHUN = 'whispers_of_the_old_gods_cthun'
const requirementsCache = new WeakMap<
  CardDefinition,
  readonly OpponentSupportRequirement[]
>()
const tagsCache = new WeakMap<CardDefinition, readonly OpponentTag[]>()

/** Totem synergy counts Totem minions and Totem summoners alike. */
const tribeTag = (tribe: string): OpponentTag =>
  tribe === 'Totem' ? 'totem' : `tribe:${tribe === 'Mechanical' ? 'Mech' : tribe}`

const FRIENDLY_CARD_EVENTS = [
  'minion-summoned',
  'minion-died',
  'minion-played',
  'card-played'
]
const selfPlayer = (node: Record<string, unknown>): boolean =>
  node.player === undefined || node.player === 'self'

/**
 * Friendly triggers and state checks that only pay off with matching cards, e.g.
 * Starving Buzzard (Beasts), Undertaker (Deathrattles), Gadgetzan Auctioneer (spells),
 * Professor Putricide and Ethereal Arcanist (secrets), Southsea Deckhand (weapons).
 */
function eventSupport(node: Record<string, unknown>): [OpponentTag, number][] {
  const filter = object(node.filter)
  const type = String(node.type)
  const friendlyEvent = node.controller === 'self'
  const result: [OpponentTag, number][] = []
  if (friendlyEvent && FRIENDLY_CARD_EVENTS.includes(type)) {
    if (typeof filter.tribe === 'string') result.push([tribeTag(filter.tribe), 5])
    if (filter.hasDeathrattle === true) result.push(['deathrattle', 5])
    if (filter.overload === true) result.push(['overload', 4])
  }
  if (friendlyEvent && type === 'overload-applied') result.push(['overload', 4])
  if (friendlyEvent && type === 'card-discarded') result.push(['discard', 4])
  if (friendlyEvent && ['spell-cast', 'spell-resolved'].includes(type))
    result.push(['spell', 8])
  if (friendlyEvent && type === 'secret-played') result.push(['secret', 4])
  if (
    ['player-controls-secret', 'player-has-secret'].includes(type) &&
    selfPlayer(node)
  )
    result.push(['secret', 4])
  if (type === 'player-has-weapon' && selfPlayer(node)) result.push(['weapon', 2])
  if (type === 'player-has-spell-damage' && selfPlayer(node))
    result.push(['spell-damage', 3])
  if (type === 'player-played-elemental-last-turn') result.push(['tribe:Elemental', 5])
  if (type === 'drawn-card-matches' && typeof filter.tribe === 'string')
    result.push([tribeTag(filter.tribe), 5])
  return result
}

// Small explicit rules for abilities whose support is not expressed as a hand condition.
const SUPPORT_GROUPS: readonly { tag: OpponentTag; min: number; ids: string }[] = [
  {
    tag: 'secret',
    min: 4,
    ids: 'classic_secretkeeper naxxramas_mad_scientist the_grand_tournament_mysterious_challenger'
  },
  {
    tag: 'tribe:Pirate',
    min: 5,
    ids: 'goblins_vs_gnomes_ships_cannon classic_southsea_captain'
  },
  {
    tag: 'tribe:Mech',
    min: 5,
    ids: 'goblins_vs_gnomes_mechwarper goblins_vs_gnomes_cogmaster goblins_vs_gnomes_goblin_blastmage goblins_vs_gnomes_tinkertown_technician goblins_vs_gnomes_screwjank_clunker goblins_vs_gnomes_iron_sensei goblins_vs_gnomes_junkbot'
  },
  {
    tag: 'tribe:Murloc',
    min: 5,
    ids: 'classic_murloc_warleader classic_murloc_tidecaller classic_coldlight_seer basic_grimscale_oracle league_of_explorers_everyfin_is_awesome'
  },
  {
    tag: 'tribe:Beast',
    min: 5,
    ids: 'basic_houndmaster the_grand_tournament_ram_wrangler'
  },
  {
    tag: 'tribe:Dragon',
    min: 5,
    ids: 'blackrock_mountain_blackwing_technician blackrock_mountain_blackwing_corruptor whispers_of_the_old_gods_deathwing_dragonlord'
  },
  {
    tag: 'cheap-spell',
    min: 6,
    ids: 'blackrock_mountain_flamewaker classic_mana_wyrm classic_sorcerers_apprentice classic_violet_teacher'
  },
  { tag: 'recruit-source', min: 3, ids: 'goblins_vs_gnomes_quartermaster' },
  { tag: 'friendly-damage', min: 4, ids: 'blackrock_mountain_grim_patron' }
]

/** Requirements use actual card copies; an archetype label never supplies support. */
export function opponentSupportRequirements(
  card: CardDefinition
): readonly OpponentSupportRequirement[] {
  const cached = requirementsCache.get(card)
  if (cached) return cached
  const requirements = new Map<OpponentTag, number>()
  const addRequirement = (tag: OpponentTag, min: number): void => {
    requirements.set(tag, Math.max(min, requirements.get(tag) ?? 0))
  }
  for (const group of SUPPORT_GROUPS) {
    if (group.ids.split(' ').includes(card.id)) addRequirement(group.tag, group.min)
  }
  const nodes = opponentEffectNodes(card.effects)
  for (const node of nodes) {
    // Friendly tribal targets also need support, e.g. Clockwork Knight's Mech buff.
    const target = object(node.target)
    const targetTribe = object(target.filter).tribe
    if (
      node.action &&
      target.controller === 'self' &&
      ['minion', 'minion-card'].includes(String(target.type)) &&
      typeof targetTribe === 'string'
    ) {
      addRequirement(tribeTag(targetTribe), 5)
    }
    if (
      [
        'player-has-card-in-hand',
        'player-has-minion',
        'player-has-minion-count'
      ].includes(String(node.type)) &&
      (node.operator === undefined ||
        node.operator === 'gte' ||
        node.operator === 'gt') &&
      (node.player === undefined || node.player === 'self')
    ) {
      const tribe = object(node.filter).tribe
      if (typeof tribe === 'string') addRequirement(tribeTag(tribe), 5)
      // e.g. King's Defender wants a friendly Taunt on board.
      if (object(node.filter).keyword === 'taunt') addRequirement('taunt', 4)
    }
    // Paired payoffs such as Stalagg and Feugen need their partner in the list.
    if (node.type === 'card-died-this-game' && typeof node.cardId === 'string')
      addRequirement(`card:${node.cardId}`, 1)
    for (const [tag, min] of eventSupport(node)) addRequirement(tag, min)
  }
  const cthunBuff = nodes.some((node) => node.action === 'buff-cthun')
  const cthunPayoff =
    card.id === CTHUN || nodes.some((node) => node.type === 'cthun-attack-at-least')
  if (cthunBuff || cthunPayoff) {
    if (card.id !== CTHUN) addRequirement(`card:${CTHUN}`, 1)
    if (cthunPayoff) addRequirement('cthun-buff', 6)
  }
  if (
    card.type === 'Minion' &&
    card.attack === 0 &&
    card.effects.some((effect) => effect.trigger === 'deathrattle')
  ) {
    addRequirement('egg-enabler', 3)
  }
  const result = [...requirements].map(([tag, min]) => ({ tag, min }))
  requirementsCache.set(card, result)
  return result
}

export function opponentSupportTags(card: CardDefinition): readonly OpponentTag[] {
  const cached = tagsCache.get(card)
  if (cached) return cached
  const tags = new Set<OpponentTag>(assessCuratedCard(card).tags)
  tags.add(`card:${card.id}`)
  for (const effect of card.effects) {
    if (!['cast', 'battlecry', 'aura'].includes(effect.trigger) || effect.condition)
      continue
    const actions =
      effect.trigger === 'aura'
        ? (effect.actions ?? []).filter((action) => !action.condition)
        : opponentActionSignals({ ...card, effects: [effect] })
            .filter(({ reliability }) => reliability === 1)
            .map(({ action }) => action)
    const usefulSacrifice = actions.some((node) =>
      ['draw', 'summon', 'summon-random'].includes(String(node.action))
    )
    if (
      actions.some((node) => {
        const target = object(node.target)
        if (
          node.condition ||
          target.type !== 'minion' ||
          !['self', 'any'].includes(String(target.controller)) ||
          !['chosen', 'all', 'adjacent'].includes(String(target.selection)) ||
          target.filter
        )
          return false
        return (
          (node.action === 'modify' && Number(node.attack) > 0) ||
          (node.action === 'destroy' && target.controller === 'self' && usefulSacrifice)
        )
      })
    )
      tags.add('egg-enabler')
  }
  const result = [...tags]
  tagsCache.set(card, result)
  return result
}

/** `bonus` adds support that exists outside the list, such as a class hero power. */
export function opponentSupportGaps(
  cards: readonly CardDefinition[],
  bonus: Readonly<Partial<Record<OpponentTag, number>>> = {}
): OpponentSupportGap[] {
  const counts = supportCounts(cards, bonus)
  return cards.flatMap((card, index) =>
    opponentSupportRequirements(card).flatMap((requirement) => {
      const actual =
        (counts.get(requirement.tag) ?? 0) -
        Number(opponentSupportTags(card).includes(requirement.tag))
      return actual < requirement.min ? [{ ...requirement, index, actual }] : []
    })
  )
}

export interface OpponentSupportSwapResult {
  /** Total missing support across the list after the swap. */
  readonly missing: number
  /** Whether the card placed at the swapped index would itself lack support. */
  readonly swappedCardUnsupported: boolean
}

/**
 * Evaluates single-card swaps incrementally; equivalent to `opponentSupportGaps` on
 * the swapped list but only revisits cards that carry support requirements.
 */
export function opponentSupportSwapEvaluator(
  cards: readonly CardDefinition[],
  bonus: Readonly<Partial<Record<OpponentTag, number>>> = {}
): (index: number, added: CardDefinition) => OpponentSupportSwapResult {
  const counts = supportCounts(cards, bonus)
  const payoffs = cards
    .map((_, index) => index)
    .filter((index) => opponentSupportRequirements(cards[index]).length > 0)
  return (index, added) => {
    const removedTags = opponentSupportTags(cards[index])
    const addedTags = opponentSupportTags(added)
    let missing = 0
    let swappedCardUnsupported = false
    const visit = (card: CardDefinition, position: number): void => {
      const own = opponentSupportTags(card)
      for (const requirement of opponentSupportRequirements(card)) {
        const actual =
          (counts.get(requirement.tag) ?? 0) -
          Number(removedTags.includes(requirement.tag)) +
          Number(addedTags.includes(requirement.tag)) -
          Number(own.includes(requirement.tag))
        if (actual >= requirement.min) continue
        missing += requirement.min - actual
        if (position === index) swappedCardUnsupported = true
      }
    }
    for (const position of payoffs)
      if (position !== index) visit(cards[position], position)
    visit(added, index)
    return { missing, swappedCardUnsupported }
  }
}

function supportCounts(
  cards: readonly CardDefinition[],
  bonus: Readonly<Partial<Record<OpponentTag, number>>>
): Map<OpponentTag, number> {
  const counts = new Map<OpponentTag, number>()
  for (const [tag, amount] of Object.entries(bonus) as [OpponentTag, number][])
    counts.set(tag, amount)
  for (const card of cards) {
    for (const tag of opponentSupportTags(card))
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return counts
}
