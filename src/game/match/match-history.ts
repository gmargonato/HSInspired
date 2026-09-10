import { historySnapshot } from './history-recorder'
import type { PlayerId } from './match-types'
import type {
  OpeningMatchState,
  AttackCharacterRef,
  HistoryEntitySnapshot,
  HistoryActionOutcome,
  OpeningMatchEvent,
  HistoryActionResolvedEvent,
  PlayCardCommand,
  UseHeroPowerCommand,
  AttackCharacterCommand
} from './opening-match-types'

function historySnapshotForCharacter(
  state: OpeningMatchState,
  participantId: PlayerId,
  character: AttackCharacterRef
): HistoryEntitySnapshot {
  return historySnapshot(
    state,
    participantId,
    character.kind === 'hero' ? participantId + ':hero' : character.instanceId
  )
}

function historyOutcomes(
  _before: OpeningMatchState,
  after: OpeningMatchState,
  events: readonly OpeningMatchEvent[]
): readonly HistoryActionOutcome[] {
  return events.flatMap((event): readonly HistoryActionOutcome[] => {
    if (event.type === 'history-effect-recorded')
      return event.causeId.endsWith(':root') ? event.outcomes : []
    if (event.type === 'hero-power-replaced') {
      const player = after.players.find((p) => p.participantId === event.participantId)!
      return [
        {
          kind: 'state',
          target: {
            id: event.participantId + ':hero-power',
            participantId: event.participantId,
            kind: 'hero',
            cardId: null,
            heroPowerId: event.heroPowerId,
            currentCost: player.heroPower.cost,
            baseCost: player.heroPower.baseCost,
            publicIdentity: true
          }
        }
      ]
    }
    if (event.type === 'hero-replaced')
      return [
        {
          kind: 'transform',
          target: historySnapshot(
            after,
            event.participantId,
            event.participantId + ':hero'
          )
        }
      ]
    return []
  })
}

export function triggerHistoryEvents(
  _before: OpeningMatchState,
  _after: OpeningMatchState,
  events: readonly OpeningMatchEvent[],
  includeRoot = true
): readonly HistoryActionResolvedEvent[] {
  const entries = new Map<string, HistoryActionResolvedEvent>()
  const order = new Map<string, number>()
  for (const [index, event] of events.entries()) {
    if (event.type === 'trigger-activated') order.set(event.activationId, index)
    if (event.type !== 'history-effect-recorded') continue
    const root = event.causeId.endsWith(':root')
    if (root && (!includeRoot || !event.source.cardId)) continue
    const id = root ? event.causeId + ':' + event.source.id : event.causeId
    const existing = entries.get(id)
    entries.set(id, {
      type: 'history-action-resolved',
      entryId: id,
      parentActionId: event.parentActionId,
      participantId: event.source.participantId,
      action: 'trigger',
      source: existing?.source ?? event.source,
      outcomes: [...(existing?.outcomes ?? []), ...event.outcomes]
    })
    if (!order.has(id)) order.set(id, index)
  }
  return [...entries.values()].sort(
    (a, b) => order.get(a.entryId!)! - order.get(b.entryId!)!
  )
}

export function fatigueHistoryEvents(
  before: OpeningMatchState,
  events: readonly OpeningMatchEvent[]
): readonly HistoryActionResolvedEvent[] {
  return events.flatMap((event) => {
    if (event.type !== 'fatigue') return []
    const target = historySnapshotForCharacter(before, event.participantId, {
      kind: 'hero'
    })
    return [
      {
        type: 'history-action-resolved' as const,
        participantId: event.participantId,
        action: 'fatigue' as const,
        source: {
          id: `${event.participantId}:fatigue`,
          participantId: event.participantId,
          kind: 'hidden' as const,
          cardId: null
        },
        outcomes: [{ kind: 'fatigue' as const, target, amount: event.amount }]
      }
    ]
  })
}

export function cardHistoryEvent(
  before: OpeningMatchState,
  after: OpeningMatchState,
  command: PlayCardCommand,
  events: readonly OpeningMatchEvent[]
): HistoryActionResolvedEvent | null {
  const card = before.players
    .find((player) => player.participantId === command.participantId)
    ?.hand.find((candidate) => candidate.instanceId === command.cardInstanceId)
  if (!card) return null
  return {
    type: 'history-action-resolved',
    entryId: 'resolution:' + after.revision + ':root',
    participantId: command.participantId,
    action: 'card',
    source: {
      ...((
        events.find(
          (event) =>
            event.type === 'history-effect-recorded' &&
            event.source.id === card.instanceId
        ) as Extract<OpeningMatchEvent, { type: 'history-effect-recorded' }> | undefined
      )?.source ??
        historySnapshot(before, command.participantId, card.instanceId, card.cardId))
    },
    outcomes: historyOutcomes(before, after, events)
  }
}

export function heroPowerHistoryEvent(
  before: OpeningMatchState,
  after: OpeningMatchState,
  command: UseHeroPowerCommand,
  events: readonly OpeningMatchEvent[]
): HistoryActionResolvedEvent {
  const playerBefore = before.players.find(
    (player) => player.participantId === command.participantId
  )
  return {
    type: 'history-action-resolved',
    entryId: 'resolution:' + after.revision + ':root',
    participantId: command.participantId,
    action: 'hero-power',
    source: {
      id: `${command.participantId}:hero-power`,
      participantId: command.participantId,
      kind: 'hero',
      cardId: null,
      heroPowerId: playerBefore?.heroPower.id,
      heroId: playerBefore?.heroId,
      baseCost: playerBefore?.heroPower.baseCost ?? playerBefore?.heroPower.cost,
      currentCost: playerBefore?.heroPower.cost
    },
    outcomes: historyOutcomes(before, after, events)
  }
}

export function combatHistoryEvent(
  before: OpeningMatchState,
  after: OpeningMatchState,
  command: AttackCharacterCommand,
  events: readonly OpeningMatchEvent[]
): HistoryActionResolvedEvent {
  return {
    type: 'history-action-resolved',
    entryId: 'resolution:' + after.revision + ':root',
    participantId: command.participantId,
    action: 'combat',
    source: historySnapshotForCharacter(
      before,
      command.participantId,
      command.attacker
    ),
    outcomes: historyOutcomes(before, after, events)
  }
}

/** Resumed choices contribute to the original card entry. */
export function choiceHistoryEvent(
  before: OpeningMatchState,
  after: OpeningMatchState,
  sourceId: string,
  participantId: PlayerId,
  events: readonly OpeningMatchEvent[]
): HistoryActionResolvedEvent | null {
  const outcomes = historyOutcomes(before, after, events)
  if (outcomes.length === 0) return null
  return {
    type: 'history-action-resolved',
    append: true,
    participantId,
    action: 'card',
    source: historySnapshot(before, participantId, sourceId),
    outcomes
  }
}

/** Facts are resolver-private; publish only their completed history entries. */
export function withoutHistoryFacts(
  events: readonly OpeningMatchEvent[]
): readonly OpeningMatchEvent[] {
  return events.filter((event) => event.type !== 'history-effect-recorded')
}
