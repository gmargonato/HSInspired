import { CARD_CATALOG, type CardDefinition } from '../content/cards'
import type { HistoryActionResolvedEvent } from './opening-match-types'

/** A Secret's identity is private when played, even if its card was previously known. */
export function isSecretCardPlay(definition: CardDefinition): boolean {
  return definition.keywords.includes('secret')
}

/** Capture what this viewer could see at action time, without changing engine events. */
export function projectHistoryAction(
  event: HistoryActionResolvedEvent,
  viewerId: string
): HistoryActionResolvedEvent {
  const definition = event.source.cardId
    ? CARD_CATALOG.get(event.source.cardId)
    : undefined
  const hideSecret =
    event.action === 'card' &&
    event.participantId !== viewerId &&
    definition !== undefined &&
    isSecretCardPlay(definition)
  const source = hideSecret
    ? {
        id: event.source.id,
        participantId: event.source.participantId,
        kind: event.source.kind,
        cardId: null,
        concealedAs: 'secret' as const
      }
    : { ...event.source }
  // Grouped outcome previews must not recover a hidden identity from another
  // outcome on the same hand card (for example a generated card plus a buff).
  const hiddenTargets = new Set(
    event.outcomes
      .filter(
        ({ kind, target }) =>
          target.participantId !== viewerId &&
          (target.kind === 'card' || target.kind === 'hidden') &&
          (kind === 'draw' || kind === 'create-hand')
      )
      .map(({ target }) => target.id)
  )
  return {
    ...event,
    source,
    outcomes: event.outcomes.map((outcome) => ({
      ...outcome,
      target: hiddenTargets.has(outcome.target.id)
        ? {
            id: outcome.target.id,
            participantId: outcome.target.participantId,
            kind: 'hidden',
            cardId: null
          }
        : hideSecret && outcome.target.id === source.id
          ? { ...source }
          : { ...outcome.target }
    }))
  }
}
