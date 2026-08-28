export interface RuntimeCounterState {
  readonly nextEntityOrdinal: number
  readonly nextEnchantmentOrdinal: number
  readonly nextResolutionOrdinal: number
}

export interface TransactionContext<T> {
  readonly before: T
  readonly draft: T
  readonly committed: boolean
}

export type StateCloner<T> = (value: T) => T
export type StateValidator<T> = (value: T) => void

/**
 * Small scoped transaction used by the match facade. A transaction never exposes its
 * draft until commit, so a resolver exception cannot leak partial state.
 */
export class StateTransaction<T> {
  private draft: T
  private committed = false

  constructor(
    private readonly before: T,
    private readonly clone: StateCloner<T>,
    private readonly validate: StateValidator<T>
  ) {
    this.draft = clone(before)
  }

  get value(): T {
    return this.draft
  }

  replace(value: T): void {
    this.draft = this.clone(value)
    this.committed = false
  }

  commit(): T {
    this.validate(this.draft)
    this.committed = true
    return this.clone(this.draft)
  }

  rollback(): T {
    this.committed = false
    this.draft = this.clone(this.before)
    return this.clone(this.draft)
  }

  get context(): TransactionContext<T> {
    return {
      before: this.clone(this.before),
      draft: this.clone(this.draft),
      committed: this.committed
    }
  }
}

export function runStateTransaction<T, R>(options: {
  readonly state: T
  readonly clone: StateCloner<T>
  readonly validate: StateValidator<T>
  readonly work: (draft: T) => R
}): { readonly state: T; readonly result: R } {
  const transaction = new StateTransaction(
    options.state,
    options.clone,
    options.validate
  )
  const result = options.work(transaction.value)
  const state = transaction.commit()
  return { state, result }
}
