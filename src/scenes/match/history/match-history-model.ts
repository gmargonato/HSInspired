import type {
  CardBurnedEvent,
  HistoryActionResolvedEvent,
  HistoryActionOutcome
} from '../../../game-rules/match'
import { projectHistoryAction } from '../../../game-rules/match/history-visibility'

export interface MatchHistoryTarget {
  readonly target: HistoryActionOutcome['target']
  readonly outcomes: readonly HistoryActionOutcome[]
}
export interface MatchHistoryActionEntry {
  readonly id: number
  readonly participantId: string
  readonly kind: 'action'
  readonly action: HistoryActionResolvedEvent['action']
  readonly source: HistoryActionResolvedEvent['source']
  readonly outcomes: readonly HistoryActionOutcome[]
  readonly sourceOutcomes: readonly HistoryActionOutcome[]
  readonly targets: readonly MatchHistoryTarget[]
}
export interface MatchHistoryBurnEntry {
  readonly id: number
  readonly participantId: string
  readonly kind: 'burn'
  readonly action: 'burn'
  readonly card: CardBurnedEvent['card']
}
export type MatchHistoryEntry = MatchHistoryActionEntry | MatchHistoryBurnEntry

/** Append-only data; the view requests just its visible window. */
export class MatchHistoryModel {
  private readonly entries: MatchHistoryEntry[] = []
  private readonly latestSource = new Map<string, number>()
  constructor(
    private readonly viewerId: string,
    private readonly capacity = Infinity
  ) {}

  record(input: HistoryActionResolvedEvent): MatchHistoryEntry {
    let event = projectHistoryAction(input, this.viewerId)
    const previousIndex = input.append
      ? this.latestSource.get(input.source.id)
      : undefined
    const previous =
      previousIndex === undefined ? undefined : this.entries[previousIndex]
    if (previous?.kind === 'action')
      event = {
        ...event,
        source: previous.source,
        action: previous.action,
        outcomes: [...previous.outcomes, ...event.outcomes]
      }
    const sourceOutcomes: HistoryActionOutcome[] = []
    const targets: MatchHistoryTarget[] = []
    const groups = new Map<string, number>()
    let source = event.source
    for (const outcome of event.outcomes) {
      if (outcome.kind === 'reveal') {
        const result = { target: outcome.target, outcomes: [outcome] }
        const remoteIndex = targets.findIndex(
          (candidate) =>
            candidate.outcomes[0]?.revealGroupId === outcome.revealGroupId &&
            candidate.target.participantId !== this.viewerId
        )
        if (outcome.target.participantId === this.viewerId && remoteIndex >= 0)
          targets.splice(remoteIndex, 0, result)
        else targets.push(result)
        // Inserting a comparison can move existing target indexes.
        groups.clear()
        continue
      }
      if (outcome.kind === 'draw') {
        const last = targets.at(-1)?.outcomes[0]
        const revealed =
          last?.kind === 'reveal'
            ? targets.findIndex(
                (candidate) =>
                  candidate.target.id === outcome.target.id &&
                  candidate.outcomes[0]?.kind === 'reveal' &&
                  candidate.outcomes[0].revealGroupId === last.revealGroupId
              )
            : -1
        if (revealed >= 0) {
          targets[revealed] = {
            target: targets[revealed].target,
            outcomes: [...targets[revealed].outcomes, outcome]
          }
          continue
        }
      }
      if (outcome.kind === 'damage' && (outcome.amount ?? 0) <= 0) continue
      const self =
        outcome.target.id === source.id && outcome.target.cardId === source.cardId
      if (self) {
        source = {
          ...source,
          ...outcome.target,
          currentCost: event.source.currentCost,
          baseCost: event.source.baseCost,
          rulesText: event.source.rulesText
        }
        if (outcome.kind !== 'summon-board') sourceOutcomes.push(outcome)
        continue
      }
      if (
        event.action === 'hero-power' &&
        outcome.target.kind === 'hero' &&
        outcome.target.participantId === event.participantId &&
        ['armor', 'buff', 'state'].includes(outcome.kind)
      )
        continue
      const transition = [
        'transform',
        'return-hand',
        'shuffle-deck',
        'control',
        'summon-board'
      ].includes(outcome.kind)
      const key =
        outcome.target.id + ':' + outcome.target.cardId + ':' + outcome.target.zone
      if (transition) groups.delete(key)
      const index = groups.get(key)
      if (index !== undefined)
        targets[index] = {
          target: outcome.target,
          outcomes: [...targets[index].outcomes, outcome]
        }
      else {
        groups.set(key, targets.length)
        targets.push({ target: outcome.target, outcomes: [outcome] })
      }
      if (outcome.kind === 'death' || outcome.kind === 'destroy') groups.delete(key)
    }
    const id = previous?.kind === 'action' ? previous.id : this.entries.length
    const entry: MatchHistoryActionEntry = {
      id,
      kind: 'action',
      action: event.action,
      participantId: event.participantId,
      source,
      outcomes: event.outcomes,
      sourceOutcomes,
      targets
    }
    this.entries[id] = entry
    this.latestSource.set(event.source.id, id)
    return entry
  }

  recordBurn(event: CardBurnedEvent): MatchHistoryBurnEntry {
    const entry: MatchHistoryBurnEntry = {
      id: this.entries.length,
      kind: 'burn',
      action: 'burn',
      participantId: event.participantId,
      card: event.card
    }
    this.entries.push(entry)
    return entry
  }
  get count(): number {
    return Math.min(this.entries.length, this.capacity)
  }
  visible(offset: number, count: number): readonly MatchHistoryEntry[] {
    const end = this.entries.length - Math.min(offset, this.count)
    return this.entries
      .slice(Math.max(this.entries.length - this.count, end - count), end)
      .reverse()
  }
  all(): readonly MatchHistoryEntry[] {
    return this.visible(0, this.count)
  }
}
