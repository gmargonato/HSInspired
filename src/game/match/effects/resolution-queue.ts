/**
 * Deterministic work queue used by the effect resolver.
 *
 * Queue entries are intentionally small and callback based.  The resolver can
 * enqueue a trigger while an action is running and `execute` drains that entry
 * before returning to its caller, preserving authored action order while still
 * giving tests and diagnostics one ordered stream of work.
 */

export const DEFAULT_RESOLUTION_BUDGET = 10_000
export const RECENT_RESOLUTION_QUEUE_SIZE = 24

export type ResolutionQueueKind =
  | 'action'
  | 'branch'
  | 'repeat'
  | 'trigger'
  | 'death-batch'
  | 'expiration'
  | 'checkpoint'
  | 'match-end'

export interface ResolutionQueueEntry<T = unknown> {
  readonly sequence: number
  readonly kind: ResolutionQueueKind
  readonly label: string
  readonly task: () => T
}

export interface ResolutionQueueSnapshot {
  readonly steps: number
  readonly pending: number
  readonly activeSequence: number | null
  readonly recent: readonly string[]
}

export class ResolutionQueueBudgetError extends Error {
  readonly label: string
  readonly steps: number
  readonly budget: number
  readonly recent: readonly string[]

  constructor(label: string, steps: number, budget: number, recent: readonly string[]) {
    super(`Resolution budget exhausted after ${budget} steps at ${label}.`)
    this.name = 'ResolutionQueueBudgetError'
    this.label = label
    this.steps = steps
    this.budget = budget
    this.recent = [...recent]
  }
}

interface PendingEntry<T = unknown> extends ResolutionQueueEntry<T> {
  result?: T
  completed: boolean
}

/**
 * A small re-entrant FIFO queue.
 *
 * `enqueue` is useful for deferred work, while `execute` is the resolver's
 * normal boundary: nested work is inserted at the front and drained before
 * the parent continues. The effect runtime owns damage-step buffering and
 * phase/death checkpoints; enqueuing work alone does not create a death
 * checkpoint between authored actions.
 */
export class ResolutionQueue {
  private readonly pending: PendingEntry[] = []
  private readonly recentLabels: string[] = []
  private nextSequence = 0
  private stepCount = 0
  private activeSequence: number | null = null
  private draining = false

  constructor(
    readonly budget = DEFAULT_RESOLUTION_BUDGET,
    readonly recentLimit = RECENT_RESOLUTION_QUEUE_SIZE
  ) {
    if (!Number.isInteger(budget) || budget < 1)
      throw new Error('Resolution queue budget must be a positive integer.')
    if (!Number.isInteger(recentLimit) || recentLimit < 1)
      throw new Error('Resolution queue recent limit must be a positive integer.')
  }

  get steps(): number {
    return this.stepCount
  }

  get currentSequence(): number | null {
    return this.activeSequence
  }

  get recent(): readonly string[] {
    return [...this.recentLabels]
  }

  snapshot(): ResolutionQueueSnapshot {
    return {
      steps: this.stepCount,
      pending: this.pending.length,
      activeSequence: this.activeSequence,
      recent: this.recent
    }
  }

  /** Records a non-callback resolver boundary such as selector/value work. */
  record(label: string, _kind: ResolutionQueueKind = 'action'): number {
    const sequence = this.nextSequence++
    this.consume(sequence, label)
    return sequence
  }

  enqueue<T>(
    label: string,
    task: () => T,
    kind: ResolutionQueueKind = 'action'
  ): number {
    const sequence = this.nextSequence++
    this.pending.push({ sequence, kind, label, task, completed: false })
    return sequence
  }

  enqueueFront<T>(
    label: string,
    task: () => T,
    kind: ResolutionQueueKind = 'action'
  ): number {
    const sequence = this.nextSequence++
    this.pending.unshift({ sequence, kind, label, task, completed: false })
    return sequence
  }

  /** Executes a queue entry and resolves nested entries before returning. */
  execute<T>(label: string, task: () => T, kind: ResolutionQueueKind = 'action'): T {
    const sequence = this.enqueueFront(label, task, kind)
    this.drainUntil(sequence)
    const entry = this.findCompleted(sequence)
    return entry.result as T
  }

  /** Drains all deferred entries in stable insertion order. */
  drain(): void {
    try {
      this.drainUntil(null)
    } finally {
      this.completedResults.clear()
    }
  }

  private drainUntil(sequence: number | null): void {
    const alreadyDraining = this.draining
    const previousSequence = this.activeSequence
    this.draining = true
    try {
      while (this.pending.length > 0) {
        const entry = this.pending.shift()!
        this.activeSequence = entry.sequence
        try {
          this.consume(entry.sequence, entry.label)
          entry.result = entry.task()
          entry.completed = true
          this.completedResults.set(entry.sequence, entry)
        } finally {
          this.activeSequence = previousSequence
        }
        if (sequence !== null && entry.sequence === sequence) break
      }
    } finally {
      this.draining = alreadyDraining
    }
  }

  private findCompleted(sequence: number): PendingEntry {
    // Entries are removed as they execute.  A completed entry's result is
    // copied onto the temporary slot below by `completedResults`.
    const result = this.completedResults.get(sequence)
    if (!result) throw new Error(`Resolution queue entry ${sequence} did not resolve.`)
    this.completedResults.delete(sequence)
    return result
  }

  private readonly completedResults = new Map<number, PendingEntry>()

  private consume(sequence: number, label: string): void {
    this.stepCount += 1
    this.recentLabels.push(`${sequence}:${label}`)
    if (this.recentLabels.length > this.recentLimit) this.recentLabels.shift()
    if (this.stepCount > this.budget)
      throw new ResolutionQueueBudgetError(
        label,
        this.stepCount,
        this.budget,
        this.recentLabels
      )
  }
}
