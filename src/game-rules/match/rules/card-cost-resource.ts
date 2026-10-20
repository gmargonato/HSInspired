import { cardHasTribe, type CardDefinition } from '../../content/cards'
import type { OpeningPlayerState } from '../opening-match-types'

export type CardCostResource = 'mana' | 'health' | 'opponent-health'

/** The resource paid for a hand card, independently of whether it is playable. */
export function cardCostResource(
  card: CardDefinition,
  player: Pick<
    OpeningPlayerState,
    'nextSpellCostsHealth' | 'nextMurlocCostsHealth' | 'nextCardCostsOpponentHealth'
  >
): CardCostResource {
  if (player.nextCardCostsOpponentHealth) return 'opponent-health'
  if (card.type === 'Spell' && player.nextSpellCostsHealth) return 'health'
  if (
    card.type === 'Minion' &&
    cardHasTribe(card, 'Murloc') &&
    player.nextMurlocCostsHealth
  )
    return 'health'
  return 'mana'
}

/** The full current cost paid in the selected resource; eligibility is checked separately. */
export function cardPaymentCost(
  card: CardDefinition,
  _player: Parameters<typeof cardCostResource>[1],
  currentCost: number = card.cost
): number {
  return Math.max(0, currentCost)
}

/** Opponent Health allows costs up to 10, even when the full payment is lethal. */
export function canPayCardCost(
  card: CardDefinition,
  player: Parameters<typeof cardCostResource>[1] &
    Pick<OpeningPlayerState, 'hero' | 'mana'>,
  currentCost: number = card.cost
): boolean {
  const cost = cardPaymentCost(card, player, currentCost)
  switch (cardCostResource(card, player)) {
    case 'opponent-health':
      return cost <= 10
    case 'health':
      return player.hero.health >= cost
    case 'mana':
      return player.mana.available >= cost
  }
}
