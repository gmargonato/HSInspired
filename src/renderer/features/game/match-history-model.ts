import type {
  CardBurnedEvent,
  HistoryActionResolvedEvent,
  HistoryActionOutcome
} from '../../../game/match'

interface MatchHistoryEntryBase {
  readonly id: number
  readonly participantId: string
}

export interface MatchHistoryActionEntry extends MatchHistoryEntryBase {
  readonly kind: 'action'
  readonly action: HistoryActionResolvedEvent['action']
  readonly source: HistoryActionResolvedEvent['source']
  readonly outcomes: readonly HistoryActionOutcome[]
  readonly targets: readonly MatchHistoryTarget[]
}

export interface MatchHistoryBurnEntry extends MatchHistoryEntryBase {
  readonly kind: 'burn'
  readonly action: 'burn'
  readonly card: CardBurnedEvent['card']
}

export type MatchHistoryEntry = MatchHistoryActionEntry | MatchHistoryBurnEntry

/** Several raw effects on one entity are rendered as one target preview. */
export interface MatchHistoryTarget {
  readonly target: HistoryActionOutcome['target']
  readonly outcomes: readonly HistoryActionOutcome[]
}

/** Pure capped feed used by the Pixi history rail. */
export class MatchHistoryModel {
  private nextId = 0
  private entries: readonly MatchHistoryEntry[] = []

  constructor(private readonly capacity = 8) {}

  record(event: HistoryActionResolvedEvent): MatchHistoryEntry {
    const byTarget = new Map<string, MatchHistoryTarget>()
    for (const outcome of event.outcomes) {
      if (outcome.kind === 'damage' && (outcome.amount ?? 0) <= 0) continue
      if (
        outcome.target.id === event.source.id &&
        (outcome.kind === 'summon-board' ||
          outcome.kind === 'death' ||
          outcome.kind === 'destroy')
      )
        continue
      const existing = byTarget.get(outcome.target.id)
      byTarget.set(outcome.target.id, {
        target: outcome.target,
        outcomes: existing ? [...existing.outcomes, outcome] : [outcome]
      })
    }
    const entry: MatchHistoryEntry = {
      ...event,
      id: this.nextId++,
      kind: 'action',
      targets: [...byTarget.values()]
    }
    this.entries = [entry, ...this.entries].slice(0, this.capacity)
    return entry
  }

  recordBurn(event: CardBurnedEvent): MatchHistoryBurnEntry {
    const entry: MatchHistoryBurnEntry = {
      id: this.nextId++,
      kind: 'burn',
      action: 'burn',
      participantId: event.participantId,
      card: event.card
    }
    this.entries = [entry, ...this.entries].slice(0, this.capacity)
    return entry
  }

  all(): readonly MatchHistoryEntry[] {
    return this.entries
  }
}
