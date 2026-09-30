import { applyCthunToCard } from '../cthun'
import type { OpeningCard, OpeningPlayerState } from '../opening-match-types'

export type CardZone = 'deck' | 'hand' | 'revealed' | 'discarded'

export interface CardLocation {
  readonly zone: CardZone
  readonly index: number
  readonly card: OpeningCard
}

export interface RemovedCard {
  readonly card: OpeningCard
  readonly zone: CardZone
  readonly index: number
  readonly player: OpeningPlayerState
}

export function cardsInZone(
  player: OpeningPlayerState,
  zone: CardZone
): readonly OpeningCard[] {
  if (zone === 'deck') return player.deck
  if (zone === 'revealed') return player.revealedCards ?? []
  if (zone === 'discarded') return player.discardedCards ?? []
  return player.hand
}

/** Finds a card only in an authoritative card zone. */
export function locateCard(
  player: OpeningPlayerState,
  instanceId: string
): CardLocation | null {
  for (const zone of ['hand', 'deck', 'revealed', 'discarded'] as const) {
    const cards = cardsInZone(player, zone)
    const index = cards.findIndex((card) => card.instanceId === instanceId)
    if (index >= 0) return { zone, index, card: cards[index]! }
  }
  return null
}

/** Removes a card and returns the updated player without mutating the input. */
export function removeCardFromPlayer(
  player: OpeningPlayerState,
  instanceId: string
): RemovedCard | null {
  const location = locateCard(player, instanceId)
  if (!location) return null
  const cards = [...cardsInZone(player, location.zone)]
  const [card] = cards.splice(location.index, 1)
  if (!card) return null
  const updated =
    location.zone === 'deck'
      ? { ...player, deck: cards }
      : location.zone === 'revealed'
        ? { ...player, revealedCards: cards }
        : location.zone === 'discarded'
          ? { ...player, discardedCards: cards }
          : { ...player, hand: cards }
  return { card, zone: location.zone, index: location.index, player: updated }
}

/** Inserts a card into an authoritative card zone and normalizes ownership metadata. */
export function insertCardIntoPlayer(
  player: OpeningPlayerState,
  card: OpeningCard,
  zone: CardZone,
  index?: number
): OpeningPlayerState {
  const knownTo = new Set(card.knownTo ?? [])
  if (zone === 'hand' || zone === 'revealed') knownTo.add(player.participantId)
  const normalized: OpeningCard = {
    ...applyCthunToCard(card, player),
    controllerId: player.participantId,
    zone,
    revealed: zone === 'hand' || zone === 'revealed',
    knownTo: [...knownTo]
  }
  const cards = [...cardsInZone(player, zone)]
  const insertion =
    index === undefined
      ? cards.length
      : Math.max(0, Math.min(cards.length, Math.floor(index)))
  cards.splice(insertion, 0, normalized)
  return zone === 'deck'
    ? { ...player, deck: cards }
    : zone === 'revealed'
      ? { ...player, revealedCards: cards }
      : zone === 'discarded'
        ? { ...player, discardedCards: cards }
        : { ...player, hand: cards }
}

/** Moves a card between authoritative card zones while preserving its stable identity. */
export function moveCardForPlayer(
  player: OpeningPlayerState,
  instanceId: string,
  destination: CardZone,
  index?: number
): {
  readonly player: OpeningPlayerState
  readonly card: OpeningCard
  readonly from: CardZone
} | null {
  const removed = removeCardFromPlayer(player, instanceId)
  if (!removed) return null
  return {
    player: insertCardIntoPlayer(removed.player, removed.card, destination, index),
    card: removed.card,
    from: removed.zone
  }
}

/** Returns all authoritative entity IDs owned by a player, including combat zones. */
export function authoritativeEntityIds(player: OpeningPlayerState): readonly string[] {
  return [
    ...player.deck.map((card) => card.instanceId),
    ...player.hand.map((card) => card.instanceId),
    ...(player.revealedCards ?? []).map((card) => card.instanceId),
    ...player.board.map((minion) => minion.instanceId),
    ...(player.weapon ? [player.weapon.instanceId] : []),
    ...(player.secrets ?? []).map((secret) => secret.instanceId),
    ...(player.graveyard ?? []).map((entry) => entry.minion.instanceId),
    ...(player.discardedCards ?? []).map((card) => card.instanceId)
  ]
}
