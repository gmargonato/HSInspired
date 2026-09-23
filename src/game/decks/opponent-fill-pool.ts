import {
  CARD_CATALOG,
  cardHasTribe,
  type CardCatalog,
  type CardDefinition
} from '../content/cards'
import { isCollectibleDeckCard } from './deck-rules'
import {
  assessCuratedCard,
  type OpponentCardFacts
} from './opponent-curated-assessment'
import { OPPONENT_CARD_RATINGS } from './opponent-card-ratings'
import {
  inspectCardCapabilities,
  runtimeCapabilityKeys
} from '../match/effects/capability'

/** Quest and Hero cards are deliberate inclusions (hero mandatory, quest via archetype core). */
export function isOpponentPowerCard(card: CardDefinition): boolean {
  return card.type === 'Hero' || (card.type === 'Spell' && card.quest !== undefined)
}

const capabilities = runtimeCapabilityKeys()
const cache = new WeakMap<CardDefinition, OpponentCardFacts | null>()

export interface OpponentFillCard {
  readonly card: CardDefinition
  readonly tags: readonly string[]
  readonly quality: number
}

/**
 * Every legal, runtime-supported card the AI may draw as deck fill. Known-broken or
 * self-harmful cards stay out; only sufficiently strong candidates enter random fill.
 */
export function assessFillCard(card: CardDefinition): OpponentFillCard | undefined {
  const facts = assessOpponentCoreCard(card)
  if (!facts || facts.quality < 3) return undefined
  if (
    OPPONENT_CARD_RATINGS[card.id] === undefined &&
    card.type === 'Minion' &&
    card.cost >= 6 &&
    !facts.interaction &&
    !facts.resource &&
    !facts.usefulFeature
  )
    return undefined
  return facts
}

/** Curated cores retain their deliberate inclusions, subject to the same safety rules. */
export function assessOpponentCoreCard(
  card: CardDefinition
): OpponentCardFacts | undefined {
  if (cache.has(card)) return cache.get(card) ?? undefined
  const result = assess(card)
  cache.set(card, result ?? null)
  return result
}

function assess(card: CardDefinition): OpponentCardFacts | undefined {
  if (
    !isCollectibleDeckCard(card) ||
    isOpponentPowerCard(card) ||
    card.cost > 10 ||
    card.playCondition
  )
    return undefined
  // Printed text and tribes do not make a plain stat body an ability-bearing minion.
  if (
    card.type === 'Minion' &&
    card.effects.length === 0 &&
    card.keywords.length === 0 &&
    (card.spellDamage ?? 0) <= 0
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
  const rating = OPPONENT_CARD_RATINGS[card.id]
  if (rating === 0) return undefined
  // This catalog entry currently omits its attack restriction from structured effects.
  if (card.id === 'whispers_of_the_old_gods_silithid_swarmer') return undefined
  const facts = assessCuratedCard(card)
  const walk = (value: unknown): Record<string, unknown>[] => {
    if (Array.isArray(value)) return value.flatMap(walk)
    if (!value || typeof value !== 'object') return []
    return [value as Record<string, unknown>, ...Object.values(value).flatMap(walk)]
  }
  const actions = walk(facts.card.effects)
  // Unreviewed self-harmful cards stay out; reviewed ratings (e.g. Flame Imp) are trusted.
  if (rating === undefined) {
    const targetsSelf = (node: Record<string, unknown>): boolean => {
      const target = node.target as { controller?: string } | undefined
      return target?.controller === 'self'
    }
    if (
      actions.some(
        (node) =>
          (node.action === 'damage' && targetsSelf(node)) ||
          ((node.action === 'destroy' || node.action === 'return-to-hand') &&
            targetsSelf(node))
      )
    )
      return undefined
  }
  // Discard effects are only acceptable on Demons built around them.
  if (
    actions.some(
      (node) =>
        node.action === 'discard' &&
        !(card.type === 'Minion' && cardHasTribe(card, 'Demon'))
    )
  )
    return undefined
  return facts
}

export function buildOpponentFillPool(
  catalog: CardCatalog = CARD_CATALOG
): OpponentFillCard[] {
  return catalog.all
    .map(assessFillCard)
    .filter((entry): entry is OpponentFillCard => entry !== undefined)
    .sort((a, b) => a.card.id.localeCompare(b.card.id))
}
