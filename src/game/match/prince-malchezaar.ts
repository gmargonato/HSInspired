import { CARD_CATALOG, asCardId } from '../content/cards'
import { HERO_CATALOG } from '../content/heroes'
import type { Deck } from '../decks'
import type {
  OpeningPlayerState,
  OpeningCard,
  HistoryActionResolvedEvent
} from './opening-match-types'
import type { DeterministicRng } from './rng'

export const PRINCE_MALCHEZAAR_ID = asCardId('one_night_in_karazhan_prince_malchezaar')

/** Opening-only effect: the original deck determines eligibility, even after mulligan. */
export function resolvePrinceMalchezaar(
  player: OpeningPlayerState,
  originalDeck: Deck,
  rng: DeterministicRng,
  allocateOrdinal: () => number
): { player: OpeningPlayerState; history?: HistoryActionResolvedEvent } {
  if (!originalDeck.cards[PRINCE_MALCHEZAAR_ID]) return { player }
  const classId = HERO_CATALOG.require(player.heroId).classId
  const pool = CARD_CATALOG.all.filter(
    (card) =>
      card.type === 'Minion' &&
      card.rarity === 'Legendary' &&
      card.collectible &&
      (card.cardClass === 'Neutral' || card.cardClass === classId) &&
      card.id !== PRINCE_MALCHEZAAR_ID &&
      !originalDeck.cards[card.id]
  )
  if (pool.length < 5)
    throw new Error('Prince Malchezaar requires five eligible Legendary minions.')
  const added: OpeningCard[] = []
  for (let index = 0; index < 5; index++) {
    const definition = pool.splice(Math.floor(rng.next() * pool.length), 1)[0]!
    const ordinal = allocateOrdinal()
    added.push({
      instanceId: `${player.participantId}:malchezaar:${ordinal}`,
      creationOrdinal: ordinal,
      cardId: definition.id,
      ownerId: player.participantId,
      controllerId: player.participantId,
      baseCost: definition.cost,
      currentCost: definition.cost,
      zone: 'deck',
      revealed: false
    })
  }
  const deck = [...player.deck, ...added]
  for (let index = deck.length - 1; index > 0; index--) {
    const swap = Math.floor(rng.next() * (index + 1))
    ;[deck[index], deck[swap]] = [deck[swap]!, deck[index]!]
  }
  const source = [...player.hand, ...player.deck].find(
    (card) => card.cardId === PRINCE_MALCHEZAAR_ID
  )!
  return {
    player: {
      ...player,
      deck,
      deckHasNoDuplicates: new Set(deck.map((card) => card.cardId)).size === deck.length
    },
    history: {
      type: 'history-action-resolved',
      entryId: `${player.participantId}:malchezaar-opening`,
      participantId: player.participantId,
      action: 'trigger',
      source: {
        id: source.instanceId,
        participantId: player.participantId,
        kind: 'card',
        cardId: PRINCE_MALCHEZAAR_ID,
        zone: source.zone,
        publicIdentity: true
      },
      outcomes: added.map((card) => ({
        kind: 'shuffle-deck',
        target: {
          id: card.instanceId,
          participantId: player.participantId,
          kind: 'card',
          cardId: card.cardId,
          zone: 'deck',
          publicIdentity: false
        }
      }))
    }
  }
}
