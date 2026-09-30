import { describe, expect, it } from 'vitest'
import { captureDeathBatch, isRejectedWithoutMutation } from './contracts'

describe('match contracts', () => {
  it('captures simultaneous deaths before resolution changes the source list', () => {
    const items = [
      { id: 'first', dead: true },
      { id: 'second', dead: false },
      { id: 'third', dead: true }
    ]
    expect(
      captureDeathBatch(items, (item) => item.dead).map((item) => item.id)
    ).toEqual(['first', 'third'])
  })

  it('recognizes rejection without revision, RNG, or public-event changes', () => {
    const snapshot = {
      revision: 4,
      entityIds: ['a'],
      zones: { a: 'hand' as const },
      rngCursor: 7
    }
    expect(isRejectedWithoutMutation(snapshot, { ...snapshot }, [])).toBe(true)
    expect(isRejectedWithoutMutation(snapshot, { ...snapshot, revision: 5 }, [])).toBe(
      false
    )
    expect(
      isRejectedWithoutMutation(snapshot, { ...snapshot }, [{ type: 'unexpected' }])
    ).toBe(false)
  })
})
