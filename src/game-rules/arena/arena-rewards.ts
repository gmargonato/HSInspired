import { CARD_CATALOG, type CardDefinition, type CardId } from '../content/cards'
import type { DeterministicRng } from '../match'
import { premiumUpgradeCost } from '../progression/arcane-dust'

export type ArenaReward =
  | { readonly kind: 'dust'; readonly amount: number }
  | { readonly kind: 'premium'; readonly cardId: CardId; readonly refundValue: number }

export interface ArenaRewardReceipt {
  readonly runId: string
  readonly wins: number
  readonly prizes: readonly ArenaReward[]
}

// One row per win count: boxes, minimum dust, maximum dust, premium probability.
export const ARENA_REWARD_TIERS = [
  [1, 10, 20, 0.1],
  [2, 10, 20, 0.12],
  [2, 15, 25, 0.14],
  [3, 15, 25, 0.16],
  [3, 20, 30, 0.18],
  [3, 25, 35, 0.2],
  [4, 30, 40, 0.24],
  [4, 35, 50, 0.28],
  [4, 40, 60, 0.3],
  [4, 50, 70, 0.32],
  [4, 60, 80, 0.35],
  [4, 70, 95, 0.38],
  [5, 80, 120, 0.4]
] as const

export const ARENA_PREMIUM_RARITY_WEIGHTS = [
  [85, 15, 0, 0],
  [60, 35, 5, 0],
  [30, 50, 18, 2],
  [10, 50, 30, 10],
  [0, 60, 30, 10]
] as const

function rarityIndex(card: CardDefinition): number {
  return card.rarity === 'Free'
    ? 0
    : ['Common', 'Rare', 'Epic', 'Legendary'].indexOf(card.rarity)
}

/** Arena premium prizes exclude Hero cards even though constructed upgrades support them. */
function arenaPremiumRewardValue(card: CardDefinition): number | null {
  return card.type === 'Hero' ? null : premiumUpgradeCost(card)
}

export function createArenaRewards(
  runId: string,
  wins: number,
  owned: Readonly<Record<string, number>>,
  rng: DeterministicRng,
  catalog: readonly CardDefinition[] = CARD_CATALOG.all
): ArenaRewardReceipt {
  if (!Number.isInteger(wins) || wins < 0 || wins > 12)
    throw new Error('Invalid Arena reward wins.')
  const [count, minimum, maximum, premiumChance] = ARENA_REWARD_TIERS[wins]
  const weights = ARENA_PREMIUM_RARITY_WEIGHTS[Math.min(4, Math.floor(wins / 3))]
  const pools = [0, 1, 2, 3].map((tier) =>
    catalog.filter(
      (card) =>
        rarityIndex(card) === tier &&
        arenaPremiumRewardValue(card) !== null &&
        !Object.hasOwn(owned, card.id)
    )
  )
  const prizes: ArenaReward[] = []
  for (let box = 0; box < count; box++) {
    if (rng.next() < premiumChance) {
      let roll = rng.next() * 100
      let tier = 0
      while (tier < 3 && roll >= weights[tier]) roll -= weights[tier++]
      const pool = pools[tier]
      if (pool.length) {
        const index = Math.min(pool.length - 1, Math.floor(rng.next() * pool.length))
        const [card] = pool.splice(index, 1)
        prizes.push({
          kind: 'premium',
          cardId: card.id,
          refundValue: arenaPremiumRewardValue(card)!
        })
        continue
      }
    }
    const steps = (maximum - minimum) / 5 + 1
    prizes.push({
      kind: 'dust',
      amount: minimum + Math.min(steps - 1, Math.floor(rng.next() * steps)) * 5
    })
  }
  return { runId, wins, prizes }
}
