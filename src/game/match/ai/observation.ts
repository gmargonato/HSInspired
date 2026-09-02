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

function observedCard(card: OpeningCard): AiObservedCard {
  return {
    cardId: card.cardId,
    baseCost: card.baseCost ?? null,
    currentCost: card.currentCost ?? null
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
    // Sorting exposes the exact multiset without leaking draw/insertion order.
    hand: player.hand.map(observedCard).sort(compareObservedCards),
    deckSize: player.deck.length,
    board: player.board.map((minion) => withoutOrderingFields(minion)),
    weapon: player.weapon ? withoutOrderingFields(player.weapon) : null,
    mana: structuredClone(player.mana),
    heroPower: withoutOrderingFields(player.heroPower),
    fatigueDamage: player.fatigueDamage,
    secrets: (player.secrets ?? []).map((secret) => ({
      revealed: secret.revealed,
      cardId: secret.revealed ? secret.cardId : null
    })),
    graveyardCardIds: (player.graveyard ?? [])
      .map((entry) => entry.minion.cardId)
      .sort((left, right) => String(left).localeCompare(String(right)))
  })) as [AiObservedPlayer, AiObservedPlayer]
  const originalDecks = state.players.map((player) => {
    const participant = participants.get(player.participantId)
    const deck = decks.find((candidate) => candidate.id === participant?.deckId)
    if (!deck)
      throw new Error(`AI observation cannot resolve deck for ${player.participantId}.`)
    return observedDeck(deck)
  }) as [AiObservedDeck, AiObservedDeck]

  return {
    schemaVersion: 2,
    informationPolicy: 'opponent-deck-and-hand',
    revision: state.revision,
    phase: state.phase,
    turnNumber: state.turnNumber,
    activePlayerId: state.activePlayerId,
    perspectivePlayerId,
    players,
    originalDecks
  }
}
