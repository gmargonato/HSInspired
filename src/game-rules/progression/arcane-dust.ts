import type { CardDefinition, CardRarity } from '../content/cards'
import { supportsPremiumFormat } from './premium-support'

/** Change this one value to tune both constructed and Arena victory rewards. */
export const WIN_DUST_REWARD = 25
export const PREMIUM_UPGRADE_COSTS: Partial<Record<CardRarity, number>> = {
  Free: 50,
  Common: 50,
  Rare: 100,
  Epic: 150,
  Legendary: 200
}

export function premiumUpgradeCost(
  card: Pick<CardDefinition, 'type' | 'rarity' | 'collectible'>
): number | null {
  return card.collectible && supportsPremiumFormat(card.type)
    ? (PREMIUM_UPGRADE_COSTS[card.rarity] ?? null)
    : null
}
