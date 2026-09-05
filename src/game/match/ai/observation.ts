import type { Deck } from '../../decks'
import type { CardId } from '../../content/cards'
import type { OpeningCard, OpeningMatchState } from '../opening-match-types'
import type { MatchSetup, PlayerId } from '../match-types'
import type {
  AiObservation,
  AiObservedCard,
  AiObservedDeck,
  AiObservedPlayer
} from './ai-types'

function observedCard(card: OpeningCard, includeCurrentCost = true): AiObservedCard {
  return {
    cardId: card.cardId,
    baseCost: card.baseCost ?? null,
    // Identity can be public while a privately modified opposing cost is not.
    currentCost: includeCurrentCost ? (card.currentCost ?? null) : null
  }
}

function compareObservedCards(left: AiObservedCard, right: AiObservedCard): number {
  return (
    String(left.cardId).localeCompare(String(right.cardId)) ||
    (left.currentCost ?? -1) - (right.currentCost ?? -1) ||
    (left.baseCost ?? -1) - (right.baseCost ?? -1)
  )
}

function observedDeck(deck: Deck): AiObservedDeck {
  return {
    id: deck.id,
    name: deck.name,
    heroId: deck.heroId,
    cards: Object.entries(deck.cards)
      .map(([cardId, count]) => ({ cardId: cardId as CardId, count }))
      .sort((left, right) => String(left.cardId).localeCompare(String(right.cardId)))
  }
}

function withoutOrderingFields<T extends object>(value: T): T {
  const clone = structuredClone(value) as Record<string, unknown>
  delete clone['creationOrdinal']
  delete clone['playOrder']
  return clone as T
}

export function createAiObservation(
  state: OpeningMatchState,
  setup: MatchSetup,
  decks: readonly Deck[],
  perspectivePlayerId: PlayerId
): AiObservation {
  const participants = new Map(
    setup.participants.map((participant) => [participant.participantId, participant])
  )
  const players = state.players.map((player): AiObservedPlayer => ({
    participantId: player.participantId,
    role: player.participantId === perspectivePlayerId ? 'self' : 'opponent',
    playerNumber: player.playerNumber,
    heroId: player.heroId,
    hero: withoutOrderingFields(player.hero),
    // The AI knows its own hand. Opposing cards appear only when the engine has
    // explicitly marked their identities known to this viewer; handSize carries
    // the total without exposing the remaining hidden identities.
    hand:
      player.participantId === perspectivePlayerId
        ? player.hand.map((card) => observedCard(card)).sort(compareObservedCards)
        : player.hand
            .filter((card) => card.knownTo?.includes(perspectivePlayerId))
            .map((card) => observedCard(card, false))
            .sort(compareObservedCards),
    handSize: player.hand.length,
    deckSize: player.deck.length,
    board: player.board.map((minion) => withoutOrderingFields(minion)),
    weapon: player.weapon ? withoutOrderingFields(player.weapon) : null,
    mana: structuredClone(player.mana),
    heroPower: withoutOrderingFields(player.heroPower),
    fatigueDamage: player.fatigueDamage,
    secrets: (player.secrets ?? []).map((secret) => ({
      revealed: secret.revealed,
      cardId:
        secret.revealed || player.participantId === perspectivePlayerId
          ? secret.cardId
          : null
    })),
    graveyardCardIds: (player.graveyard ?? [])
      .map((entry) => entry.minion.cardId)
      .sort((left, right) => String(left).localeCompare(String(right)))
  })) as [AiObservedPlayer, AiObservedPlayer]
  const perspectiveParticipant = participants.get(perspectivePlayerId)
  const selfDeck = decks.find(
    (candidate) => candidate.id === perspectiveParticipant?.deckId
  )
  if (!selfDeck) {
    throw new Error(`AI observation cannot resolve deck for ${perspectivePlayerId}.`)
  }

  return {
    schemaVersion: 3,
    informationPolicy: 'fair',
    revision: state.revision,
    phase: state.phase,
    turnNumber: state.turnNumber,
    activePlayerId: state.activePlayerId,
    perspectivePlayerId,
    players,
    selfOriginalDeck: observedDeck(selfDeck)
  }
}
