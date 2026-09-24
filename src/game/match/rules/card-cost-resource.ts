import { cardHasTribe, type CardDefinition } from '../../content/cards'
import type { OpeningPlayerState } from '../opening-match-types'

export type CardCostResource = 'mana' | 'health'

/** The resource paid for a hand card, independently of whether it is playable. */
export function cardCostResource(
  card: CardDefinition,
  player: Pick<OpeningPlayerState, 'nextSpellCostsHealth' | 'nextMurlocCostsHealth'>
): CardCostResource {
  if (card.type === 'Spell' && player.nextSpellCostsHealth) return 'health'
  if (
    card.type === 'Minion' &&
    cardHasTribe(card, 'Murloc') &&
    player.nextMurlocCostsHealth
  )
    return 'health'
  return 'mana'
}
