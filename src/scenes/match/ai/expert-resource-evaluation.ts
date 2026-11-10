import { CARD_CATALOG } from '../../../game-rules/content'
import type { AiObservedPlayer } from '../../../game-rules/match/ai'
import { LOCAL_AI_POLICY } from './local-ai-policy'

type DrawSource = Pick<
  AiObservedPlayer['board'][number],
  'cardId' | 'silenced' | 'dormant'
>

/** Only unconditional, authored draws; never forecast a random or conditional trigger. */
export function predictableEndTurnDraws(player: {
  readonly board: readonly DrawSource[]
}): number {
  return player.board.reduce((total, minion) => {
    if (minion.silenced || minion.dormant) return total
    return (
      total +
      (CARD_CATALOG.get(minion.cardId)?.effects.reduce((sum, effect) => {
        if (effect.trigger !== 'end-of-turn' || effect.condition) return sum
        return (
          sum +
          (effect.actions?.reduce(
            (draws, action) =>
              action.action === 'draw' &&
              action.player === 'self' &&
              !action.condition &&
              (action.count === undefined || typeof action.count === 'number')
                ? draws + Math.max(0, action.count ?? 1)
                : draws,
            0
          ) ?? 0)
        )
      }, 0) ?? 0)
    )
  }, 0)
}

/** Shared hand/deck resource estimate, independent of concealed card order. */
export function expertCardResourceValue(cardId: string): number {
  const card = CARD_CATALOG.get(cardId)
  if (!card) return 0
  const body =
    card.type === 'Minion'
      ? card.attack * 1.4 + card.health * 1.1
      : card.type === 'Weapon'
        ? card.attack * 1.25 + card.durability
        : card.type === 'Hero'
          ? 6
          : 4
  return (
    (body + card.effects.length * 2 + Math.max(0, 6 - card.cost)) *
    0.22 *
    LOCAL_AI_POLICY.weights.handCard
  )
}

/** Future access matters, but an undrawn card is less useful than one already held. */
export function expertDeckResourceValue(
  cards: readonly {
    readonly cardId: string
    readonly startedInDeck?: boolean
    readonly knownTo?: readonly string[]
  }[],
  actorId: string
): number {
  return cards.reduce(
    (sum, card) =>
      sum +
      (card.startedInDeck || card.knownTo?.includes(actorId)
        ? expertCardResourceValue(card.cardId) * 0.5
        : LOCAL_AI_POLICY.weights.deckCard),
    0
  )
}

/** Value only the printed-deathrattle resurrection grammar, with a held payoff. */
export function expertResurrectionValue(player: AiObservedPlayer): number {
  const nextMana = Math.max(
    0,
    Math.min(10, player.mana.maximum + 1) - (player.mana.overloadNextTurn ?? 0)
  )
  const payoff = player.hand.some((held) => {
    const card = CARD_CATALOG.get(held.cardId)
    return (
      (held.currentCost ?? card?.cost ?? Infinity) <= nextMana &&
      card?.effects.some(
        (effect) =>
          effect.trigger === 'battlecry' &&
          !effect.condition &&
          effect.actions?.some((action) => {
            const filter = action.filter as Record<string, unknown> | undefined
            return (
              action.action === 'resurrect' &&
              action.player === 'self' &&
              action.source === 'friendly-minions-died-this-game' &&
              action.selection === 'all' &&
              filter?.hasDeathrattle === true &&
              filter.printedOnly === true
            )
          })
      )
    )
  })
  if (!payoff) return 0
  const body = (cardId: string) => {
    const card = CARD_CATALOG.get(cardId)
    return card?.type === 'Minion' &&
      card.effects.some((effect) => effect.trigger === 'deathrattle')
      ? card.attack * 0.8 + card.health * 0.5 + 2
      : 0
  }
  const pool = player.graveyardCardIds.map(body).filter((value) => value > 0)
  // N'Zoth occupies one slot; random selection means average pool value, not best six.
  const resurrection = pool.length
    ? (pool.reduce((sum, value) => sum + value, 0) * Math.min(6, pool.length)) /
      pool.length
    : 0
  const preparation = player.board.reduce(
    (sum, minion) => sum + (minion.silenced ? 0 : body(minion.cardId) * 0.15),
    0
  )
  return Math.min(24, resurrection * 0.6 + preparation)
}
