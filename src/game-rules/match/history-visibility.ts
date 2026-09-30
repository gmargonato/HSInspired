import { CARD_CATALOG, type CardDefinition } from '../content/cards'
import type {
  HistoryActionResolvedEvent,
  HistoryEntitySnapshot
} from './opening-match-types'

function conceal(target: HistoryEntitySnapshot): HistoryEntitySnapshot {
  return {
    id: target.id,
    participantId: target.participantId,
    kind: 'hidden',
    cardId: null
  }
}

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
    (event.action === 'card' || event.source.secretCast === true) &&
    event.participantId !== viewerId &&
    definition !== undefined &&
    isSecretCardPlay(definition)
  const unknownSource =
    event.action === 'trigger' &&
    event.source.participantId !== viewerId &&
    (event.source.zone === 'hand' || event.source.zone === 'deck') &&
    !event.source.publicIdentity &&
    !event.source.knownTo?.some((id) => id === viewerId)
  const source = hideSecret
    ? {
        id: event.source.id,
        participantId: event.source.participantId,
        kind: event.source.kind,
        cardId: null,
        concealedAs: 'secret' as const
      }
    : unknownSource
      ? conceal(event.source)
      : { ...event.source }
  const hiddenSecrets = new Set(
    event.outcomes
      .filter(({ target }) => target.participantId !== viewerId && target.secretCast)
      .map(({ target }) => target.id)
  )
  if (hideSecret) hiddenSecrets.add(source.id)
  // Grouped outcome previews must not recover a hidden identity from another
  // outcome on the same hand card (for example a generated card plus a buff).
  const hiddenTargets = new Set(
    event.outcomes
      .filter(
        ({ kind, target }) =>
          target.participantId !== viewerId &&
          (target.kind === 'card' || target.kind === 'hidden') &&
          !target.publicIdentity &&
          !target.knownTo?.some((id) => id === viewerId) &&
          (kind === 'draw' ||
            kind === 'create-hand' ||
            target.zone === 'hand' ||
            target.zone === 'deck')
      )
      .map(({ target }) => target.id)
  )
  return {
    ...event,
    source,
    outcomes: event.outcomes.map((outcome) => ({
      ...outcome,
      before:
        hiddenTargets.has(outcome.target.id) || hiddenSecrets.has(outcome.target.id)
          ? undefined
          : outcome.before,
      target:
        // A later hidden movement must not erase an earlier public reveal face.
        outcome.kind === 'reveal' && outcome.target.publicIdentity
          ? { ...outcome.target }
          : hiddenSecrets.has(outcome.target.id)
            ? {
                id: outcome.target.id,
                participantId: outcome.target.participantId,
                kind: outcome.target.kind,
                cardId: null,
                concealedAs: 'secret'
              }
            : hiddenTargets.has(outcome.target.id)
              ? {
                  id: outcome.target.id,
                  participantId: outcome.target.participantId,
                  kind: 'hidden',
                  cardId: null
                }
              : { ...outcome.target }
    }))
  }
}
