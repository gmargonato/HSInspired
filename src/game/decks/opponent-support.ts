import type { CardDefinition } from '../content/cards'
import {
  assessCuratedCard,
  opponentEffectNodes,
  opponentActionSignals
} from './opponent-curated-assessment'

export interface OpponentSupportRequirement {
  readonly tag: string
  readonly min: number
}
export interface OpponentSupportGap extends OpponentSupportRequirement {
  readonly index: number
  readonly actual: number
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
const CTHUN = 'whispers_of_the_old_gods_cthun'
const requirementsCache = new WeakMap<
  CardDefinition,
  readonly OpponentSupportRequirement[]
>()
const tagsCache = new WeakMap<CardDefinition, readonly string[]>()

// Small explicit rules for abilities whose support is not expressed as a hand condition.
const SUPPORT_GROUPS: readonly { tag: string; min: number; ids: string }[] = [
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
  { tag: 'recruit-source', min: 3, ids: 'goblins_vs_gnomes_quartermaster' }
]

/** Requirements use actual card copies; an archetype label never supplies support. */
export function opponentSupportRequirements(
  card: CardDefinition
): readonly OpponentSupportRequirement[] {
  const cached = requirementsCache.get(card)
  if (cached) return cached
  const requirements = new Map<string, number>()
  const addRequirement = (tag: string, min: number): void => {
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
      addRequirement(`tribe:${targetTribe === 'Mechanical' ? 'Mech' : targetTribe}`, 5)
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
      if (typeof tribe === 'string')
        addRequirement(`tribe:${tribe === 'Mechanical' ? 'Mech' : tribe}`, 5)
    }
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

export function opponentSupportTags(card: CardDefinition): readonly string[] {
  const cached = tagsCache.get(card)
  if (cached) return cached
  const tags = new Set(assessCuratedCard(card).tags)
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

export function opponentSupportGaps(
  cards: readonly CardDefinition[]
): OpponentSupportGap[] {
  const counts = new Map<string, number>()
  for (const card of cards) {
    for (const tag of opponentSupportTags(card))
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return cards.flatMap((card, index) =>
    opponentSupportRequirements(card).flatMap((requirement) => {
      const actual =
        (counts.get(requirement.tag) ?? 0) -
        Number(opponentSupportTags(card).includes(requirement.tag))
      return actual < requirement.min ? [{ ...requirement, index, actual }] : []
    })
  )
}
