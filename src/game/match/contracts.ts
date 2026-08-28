import type { CardEventType, CardId } from '../content/cards'
import type { PlayerId } from './match-types'

/** Correlates internal trigger work and public resolver events within one command. */
export interface ResolutionCorrelation {
  readonly resolutionId: string
  readonly queueSequence: number
  readonly parentQueueSequence: number | null
}

/** Internal fact emitted by the resolver before public presentation events. */
export interface TriggerEventContract {
  readonly type: 'trigger-event'
  readonly sequence: number
  readonly eventType: CardEventType
  readonly sourceInstanceId: string | null
  readonly targetInstanceId: string | null
  readonly correlation: ResolutionCorrelation
}
export type RuntimeZone =
  | 'deck'
  | 'hand'
  | 'board'
  | 'hero'
  | 'hero-power'
  | 'weapon'
  | 'secret'
  | 'graveyard'
  | 'revealed'
  | 'discarded'

export type RuntimeEntityKind =
  'card' | 'minion' | 'hero' | 'hero-power' | 'weapon' | 'secret'

export interface RuntimeEntityRef {
  readonly instanceId: string
  readonly kind: RuntimeEntityKind
  readonly zone: RuntimeZone
  readonly ownerId: PlayerId
  readonly controllerId: PlayerId
}

export interface RuntimeCardRef extends RuntimeEntityRef {
  readonly kind: 'card'
  readonly cardId: CardId
}

export interface MatchContractSnapshot {
  readonly revision: number
  readonly entityIds: readonly string[]
  readonly zones: Readonly<Record<string, RuntimeZone>>
  readonly rngCursor: number
}

/** Stable ordering contract used by selectors and trigger queues. */
export function compareRuntimeOrder(
  left: {
    readonly zoneOrder: number
    readonly boardOrder: number
    readonly creationOrdinal: number
  },
  right: {
    readonly zoneOrder: number
    readonly boardOrder: number
    readonly creationOrdinal: number
  }
): number {
  return (
    left.zoneOrder - right.zoneOrder ||
    left.boardOrder - right.boardOrder ||
    left.creationOrdinal - right.creationOrdinal
  )
}

/** Simultaneous death batches are captured before any deathrattle is resolved. */
export function captureDeathBatch<T>(
  items: readonly T[],
  isDead: (item: T) => boolean
): readonly T[] {
  return items.filter(isDead)
}

/** A rejected command must return the exact prior revision and no public events. */
export function isRejectedWithoutMutation(
  before: MatchContractSnapshot,
  after: MatchContractSnapshot,
  events: readonly unknown[]
): boolean {
  return (
    before.revision === after.revision &&
    before.rngCursor === after.rngCursor &&
    events.length === 0
  )
}
