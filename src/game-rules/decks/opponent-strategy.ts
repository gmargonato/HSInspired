import type { CardDefinition } from '../content/cards'
import type { OpponentArchetype } from './opponent-archetype'
import type { OpponentProfile } from './opponent-profiles'

/** Brief consumed by the AI opponent prompt (original deck plan, overridden by live state). */
export interface OpponentStrategyBrief {
  readonly strategy: string
  readonly theme: string
  readonly text: string
}

const MAX_KEY_CARDS = 12

/**
 * The fixed plan only names guaranteed core cards; the key-card line reflects the
 * finished list so the AI never plans around a card it does not own. `keyCards`
 * arrive in priority order (core, payoffs, package); display is sorted by cost.
 */
export function buildOpponentStrategyBrief(
  archetype: OpponentArchetype,
  profile: OpponentProfile,
  keyCards: readonly CardDefinition[]
): OpponentStrategyBrief {
  const counts = new Map<CardDefinition, number>()
  for (const card of keyCards) counts.set(card, (counts.get(card) ?? 0) + 1)
  const listed = [...counts]
    .slice(0, MAX_KEY_CARDS)
    .sort(([a], [b]) => a.cost - b.cost || a.name.localeCompare(b.name))
    .map(([card, count]) => (count > 1 ? `${card.name} x${count}` : card.name))
  return {
    strategy: profile.strategy,
    theme: archetype.id,
    text:
      `Original deck: ${archetype.name} (${profile.id} curve). Current state overrides this plan. ` +
      `${archetype.plan} Mulligan: ${archetype.mulligan}` +
      (listed.length ? ` Key cards in this list: ${listed.join(', ')}.` : '')
  }
}
