import { cloneOpeningMatchState, cloneUnknown } from './match-state-snapshot'
import { projectHistoryAction } from './history-visibility'
import type { PlayerId } from './match-types'
import type {
  OpeningCard,
  OpeningPublicCard,
  OpeningMatchState,
  OpeningMatchPublicState,
  OpeningPublicPlayerState,
  EffectDomainEvent,
  OpeningMatchPublicEvent,
  OpeningMatchEvent,
  CoinGrantedEvent,
  OpeningCardDrawnEvent,
  CardDrawnEvent,
  CardGeneratedEvent,
  CardBurnedEvent,
  DevCardAddedEvent
} from './opening-match-types'

/** Masks private card identity while preserving immutable public snapshot data. */
function maskPublicCard(
  card: OpeningCard,
  viewerId: PlayerId,
  forceVisible = false
): OpeningPublicCard {
  const {
    knownTo: _knownTo,
    startedInDeck: _startedInDeck,
    ...withoutKnowledge
  } = cloneUnknown(card)
  void _startedInDeck
  const visible =
    forceVisible ||
    (card.zone !== 'deck' &&
      (card.knownTo?.includes(viewerId) === true ||
        (card.zone === 'hand' && card.controllerId === viewerId)))
  if (visible) return withoutKnowledge as OpeningPublicCard
  return {
    ...withoutKnowledge,
    cardId: null,
    baseCost: null,
    currentCost: null,
    attack: null,
    health: null,
    costAdjustments: [],
    enchantments: []
  }
}

export function getOpeningMatchPublicState(
  state: OpeningMatchState,
  viewerId: PlayerId
): OpeningMatchPublicState {
  const snapshot = cloneOpeningMatchState(state)
  const {
    history: _history,
    effectTrace: _effectTrace,
    scheduledEffects: _scheduledEffects,
    pendingDiscover: _pendingDiscover,
    pendingCardChoice: _pendingCardChoice,
    openingHistory,
    ...publicSnapshot
  } = snapshot
  const players = snapshot.players.map((player) => {
    const { originalDeckCardIds: _originalDeckCardIds, ...visiblePlayer } = player
    void _originalDeckCardIds
    return {
      ...visiblePlayer,
      // Deck order and identity are private even to its owner in a public snapshot.
      deck: player.deck.map((card) => maskPublicCard(card, viewerId)),
      hand: player.hand.map((card) => maskPublicCard(card, viewerId)),
      ...(player.revealedCards
        ? {
            revealedCards: player.revealedCards.map((card) =>
              maskPublicCard(card, viewerId)
            )
          }
        : {}),
      ...(player.discardedCards
        ? {
            discardedCards: player.discardedCards.map((card) =>
              maskPublicCard(card, viewerId)
            )
          }
        : {}),
      secrets: (player.secrets ?? []).map((secret) => ({
        ...secret,
        cardId:
          secret.controllerId === viewerId || secret.revealed ? secret.cardId : null
      }))
    }
  }) as unknown as [OpeningPublicPlayerState, OpeningPublicPlayerState]
  void _history
  void _effectTrace
  void _scheduledEffects
  void _pendingDiscover
  void _pendingCardChoice
  const pendingDiscover =
    snapshot.pendingDiscover?.participantId === viewerId
      ? (() => {
          const { continuation: _continuation, ...withoutContinuation } =
            snapshot.pendingDiscover!
          void _continuation
          return {
            ...withoutContinuation,
            candidates: snapshot.pendingDiscover.candidates.map((card) =>
              maskPublicCard(card, viewerId, true)
            )
          }
        })()
      : undefined
  const pendingCardChoice =
    snapshot.pendingCardChoice?.participantId === viewerId
      ? snapshot.pendingCardChoice
      : undefined
  return {
    ...publicSnapshot,
    ...(openingHistory
      ? {
          openingHistory: openingHistory.map((event) =>
            projectHistoryAction(event, viewerId)
          )
        }
      : {}),
    players,
    ...(pendingDiscover ? { pendingDiscover } : {}),
    ...(pendingCardChoice ? { pendingCardChoice } : {})
  }
}

function maskPublicEffectData(value: unknown, viewerId: PlayerId): unknown {
  if (Array.isArray(value))
    return value.map((entry) => maskPublicEffectData(entry, viewerId))
  if (!isRecord(value)) return value
  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'cardId' || key === 'sourceCardId') {
      result[key] = null
    } else if (
      key === 'card' &&
      isRecord(nested) &&
      typeof nested.cardId === 'string'
    ) {
      result[key] = maskPublicCard(nested as unknown as OpeningCard, viewerId)
    } else if (key === 'cardIds' && Array.isArray(nested)) {
      result[key] = nested.map(() => null)
    } else {
      result[key] = maskPublicEffectData(nested, viewerId)
    }
  }
  return result
}

function maskPublicEffectEvent(
  event: EffectDomainEvent,
  viewerId: PlayerId
): OpeningMatchPublicEvent {
  // Only board-origin movements carry this cue. Their faces were already public;
  // do not expose private knowledge lists or relax masking for other effects.
  const cardMovement = event.cardMovement
    ? {
        ...event.cardMovement,
        cards: event.cardMovement.cards.map((card) =>
          maskPublicCard(card, viewerId, true)
        )
      }
    : undefined
  if (event.controllerId === viewerId)
    return { ...event, ...(cardMovement ? { cardMovement } : {}) }
  const data = event.data
    ? (maskPublicEffectData(event.data, viewerId) as Readonly<Record<string, unknown>>)
    : undefined
  return {
    ...event,
    sourceCardId: null,
    ...(cardMovement ? { cardMovement } : {}),
    ...(data ? { data } : {})
  }
}

/** Projects card-bearing events without exposing identities unknown to the viewer. */
export function getOpeningMatchPublicEvents(
  events: readonly OpeningMatchEvent[],
  viewerId: PlayerId
): readonly OpeningMatchPublicEvent[] {
  return events
    .filter(
      (event) =>
        event.type !== 'history-effect-recorded' &&
        event.type !== 'random-spell-started' &&
        event.type !== 'random-spell-completed'
    )
    .map((event) => {
      switch (event.type) {
        case 'trigger-activated':
          return event.participantId !== viewerId &&
            (event.source.kind === 'card' || event.source.kind === 'secret')
            ? { ...event, source: { ...event.source, cardId: null } }
            : event
        case 'effect-resolved':
          return maskPublicEffectEvent(event, viewerId)
        case 'mulligan-resolved':
          return {
            ...event,
            returnedCards: event.returnedCards.map((card) =>
              maskPublicCard(card, viewerId, event.participantId === viewerId)
            ),
            replacementCards: event.replacementCards.map((card) =>
              maskPublicCard(card, viewerId, event.participantId === viewerId)
            )
          }
        case 'discover-started':
          return {
            ...event,
            candidates: event.candidates.map((card) =>
              maskPublicCard(card, viewerId, event.participantId === viewerId)
            )
          }
        case 'card-choice-started':
          return event.participantId === viewerId ? event : { ...event, options: [] }
        case 'card-generated':
        case 'coin-granted':
        case 'opening-card-drawn':
        case 'card-drawn':
        case 'dev-card-added':
          return {
            ...event,
            card: maskPublicCard(
              cardForEvent(event),
              viewerId,
              event.participantId === viewerId
            )
          }
        case 'card-burned':
          return {
            ...event,
            card: maskPublicCard(cardForEvent(event), viewerId, true)
          }
        case 'history-action-resolved':
          return projectHistoryAction(event, viewerId)
        default:
          return event
      }
    }) as readonly OpeningMatchPublicEvent[]
}

function cardForEvent(
  event:
    | CoinGrantedEvent
    | OpeningCardDrawnEvent
    | CardDrawnEvent
    | CardGeneratedEvent
    | CardBurnedEvent
    | DevCardAddedEvent
): OpeningCard {
  return event.card
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
