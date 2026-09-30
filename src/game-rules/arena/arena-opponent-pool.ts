import type { CardDefinition, CardRarity, CardType } from '../content/cards'

export function arenaRarityTier(rarity: CardRarity): number {
  switch (rarity) {
    case 'Free':
    case 'Common':
      return 0
    case 'Rare':
      return 1
    case 'Epic':
      return 2
    case 'Legendary':
      return 3
    default:
      throw new Error(`Unsupported Arena rarity: ${rarity}.`)
  }
}

/** Indexed once per class; candidates retain stable catalog order. */
export class ArenaOpponentPool {
  private readonly byType = new Map<CardType, Map<number, CardDefinition[]>>()
  private readonly byRarity = new Map<number, CardDefinition[]>()

  constructor(cards: readonly CardDefinition[]) {
    if (cards.length === 0) throw new Error('No eligible Arena opponent cards.')
    for (const card of cards) {
      const tier = arenaRarityTier(card.rarity)
      let tiers = this.byType.get(card.type)
      if (!tiers) this.byType.set(card.type, (tiers = new Map()))
      if (!tiers.has(tier)) tiers.set(tier, [])
      tiers.get(tier)!.push(card)
      if (!this.byRarity.has(tier)) this.byRarity.set(tier, [])
      this.byRarity.get(tier)!.push(card)
    }
  }

  candidates(source: CardDefinition, upgrade: boolean): readonly CardDefinition[] {
    const original = arenaRarityTier(source.rarity)
    const requested = upgrade ? Math.min(3, original + 1) : original
    const tiers = this.byType.get(source.type) ?? this.byRarity
    const nearestTier = [...tiers.keys()].sort(
      (a, b) => Math.abs(a - original) - Math.abs(b - original) || a - b
    )[0]
    const cards = tiers.get(requested) ?? tiers.get(original) ?? tiers.get(nearestTier)!
    let distance = Infinity
    const closest: CardDefinition[] = []
    for (const card of cards) {
      const delta = Math.abs(card.cost - source.cost)
      if (delta < distance) {
        distance = delta
        closest.length = 0
      }
      if (delta === distance) closest.push(card)
    }
    return closest
  }
}
