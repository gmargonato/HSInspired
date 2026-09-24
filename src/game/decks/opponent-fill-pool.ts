import { cardHasTribe, type CardDefinition } from '../content/cards'
import { isCollectibleDeckCard } from './deck-rules'
import {
  assessCuratedCard,
  type OpponentCardFacts,
  type OpponentTag
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
const safetyCache = new WeakMap<CardDefinition, OpponentCardFacts | null>()

export interface OpponentFillCard {
  readonly card: CardDefinition
  readonly tags: readonly OpponentTag[]
  readonly quality: number
}

const walk = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) return value.flatMap(walk)
  if (!value || typeof value !== 'object') return []
  return [value as Record<string, unknown>, ...Object.values(value).flatMap(walk)]
}

/** Plain stat bodies carry no ability; printed text and tribes do not change that. */
function isPlainBody(card: CardDefinition): boolean {
  return (
    card.type === 'Minion' &&
    card.effects.length === 0 &&
    card.keywords.length === 0 &&
    (card.spellDamage ?? 0) <= 0
  )
}

/** Discard effects hurt ordinary decks; only Demons built around them may carry one. */
function hasUnwantedDiscard(card: CardDefinition): boolean {
  return (
    walk(card.effects).some((node) => node.action === 'discard') &&
    !(card.type === 'Minion' && cardHasTribe(card, 'Demon'))
  )
}

/**
 * Every legal, runtime-supported card the AI may draw as deck fill. Known-broken or
 * self-harmful cards stay out; only sufficiently strong candidates enter random fill.
 */
export function assessFillCard(card: CardDefinition): OpponentFillCard | undefined {
  const facts = assessOpponentCoreCard(card)
  if (!facts || facts.quality < 3 || hasUnwantedDiscard(card)) return undefined
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
  const facts = assessSafeCard(card)
  return facts && !isPlainBody(card) ? facts : undefined
}

/**
 * Archetype package candidates: the same safety rules, but on-theme plain bodies
 * (e.g. vanilla Murlocs) and weaker enablers down to `minQuality` are allowed.
 * Discard is only accepted by a package built around discarding.
 */
export function assessPackageCard(
  card: CardDefinition,
  tag: OpponentTag,
  minQuality: number
): OpponentFillCard | undefined {
  const facts = assessSafeCard(card)
  if (!facts || !facts.tags.includes(tag)) return undefined
  if (tag !== 'discard' && hasUnwantedDiscard(card)) return undefined
  return assessFillCard(card) ?? (facts.quality >= minQuality ? facts : undefined)
}

function assessSafeCard(card: CardDefinition): OpponentCardFacts | undefined {
  if (safetyCache.has(card)) return safetyCache.get(card) ?? undefined
  const result = assessSafety(card)
  safetyCache.set(card, result ?? null)
  return result
}

function assessSafety(card: CardDefinition): OpponentCardFacts | undefined {
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
  const rating = OPPONENT_CARD_RATINGS[card.id]
  if (rating === 0) return undefined
  // This catalog entry currently omits its attack restriction from structured effects.
  if (card.id === 'whispers_of_the_old_gods_silithid_swarmer') return undefined
  // Unreviewed self-harmful cards stay out; reviewed ratings (e.g. Flame Imp) are trusted.
  if (rating === undefined) {
    const targetsSelf = (node: Record<string, unknown>): boolean => {
      const target = node.target as { controller?: string } | undefined
      return target?.controller === 'self'
    }
    if (
      walk(card.effects).some(
        (node) =>
          (node.action === 'damage' && targetsSelf(node)) ||
          ((node.action === 'destroy' || node.action === 'return-to-hand') &&
            targetsSelf(node))
      )
    )
      return undefined
  }
  return assessCuratedCard(card)
}
