import { describe, expect, it } from 'vitest'
import { StateTransaction, runStateTransaction } from './runtime-state'

describe('scoped match transactions', () => {
  it('commits only after validation and clones snapshots', () => {
    const before = { value: 1, nested: { count: 2 } }
    const clone = (value: typeof before) => ({ ...value, nested: { ...value.nested } })
    const transaction = new StateTransaction(before, clone, (value) => {
      if (value.value < 0) throw new Error('invalid')
    })
    transaction.replace({ value: 3, nested: { count: 2 } })
    const committed = transaction.commit()
    expect(committed).toEqual({ value: 3, nested: { count: 2 } })
    expect(before.value).toBe(1)
  })

  it('rolls back a draft before any caller can observe it', () => {
    const before = { value: 1 }
    const result = runStateTransaction({
      state: before,
      clone: (value) => ({ ...value }),
      validate: () => undefined,
      work: (draft) => {
        draft.value = 99
        return 'failure'
      }
    })
    expect(result.result).toBe('failure')
    expect(result.state.value).toBe(99)

    const transaction = new StateTransaction(
      before,
      (value) => ({ ...value }),
      () => undefined
    )
    transaction.value.value = 99
    expect(transaction.rollback()).toEqual(before)
  })
})
