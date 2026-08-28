import { describe, expect, it } from 'vitest'
import { ResolutionQueue, ResolutionQueueBudgetError } from './resolution-queue'

describe('resolution queue', () => {
  it('resolves nested work before the parent continues', () => {
    const queue = new ResolutionQueue()
    const order: string[] = []

    queue.execute('action.a', () => {
      order.push('a:start')
      queue.execute('trigger.a', () => order.push('trigger'), 'trigger')
      order.push('a:end')
    })
    queue.execute('action.b', () => order.push('b'))

    expect(order).toEqual(['a:start', 'trigger', 'a:end', 'b'])
    expect(queue.recent.map((entry) => entry.replace(/^\d+:/, ''))).toEqual([
      'action.a',
      'trigger.a',
      'action.b'
    ])
  })

  it('keeps stable FIFO order for deferred trigger frames and death batches', () => {
    const queue = new ResolutionQueue()
    const order: string[] = []
    queue.enqueue('trigger.active.first', () => order.push('active-first'), 'trigger')
    queue.enqueue('trigger.active.second', () => order.push('active-second'), 'trigger')
    queue.enqueue(
      'death-batch.capture',
      () => order.push('death-capture'),
      'death-batch'
    )
    queue.enqueue('expiration.turn', () => order.push('expiration'), 'expiration')
    queue.drain()

    expect(order).toEqual([
      'active-first',
      'active-second',
      'death-capture',
      'expiration'
    ])
  })

  it('runs queued callbacks from captured values after a source is removed', () => {
    const queue = new ResolutionQueue()
    const source = { id: 'source', removed: false }
    const observed: string[] = []
    const sourceId = source.id
    queue.enqueue('source-removal', () => {
      source.removed = true
      observed.push('removed')
    })
    queue.enqueue('queued-source-effect', () => observed.push(sourceId))
    queue.drain()

    expect(source.removed).toBe(true)
    expect(observed).toEqual(['removed', 'source'])
  })

  it('treats an empty queue as an empty resolution without advancing work', () => {
    const queue = new ResolutionQueue()
    queue.drain()
    expect(queue.snapshot()).toMatchObject({
      steps: 0,
      pending: 0,
      activeSequence: null
    })
    expect(queue.recent).toEqual([])
  })

  it('reports a finite budget with the recent queue trace', () => {
    const queue = new ResolutionQueue(2, 2)
    queue.enqueue('first', () => undefined)
    queue.enqueue('second', () => undefined)
    queue.enqueue('third', () => undefined)

    let failure: unknown
    try {
      queue.drain()
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ResolutionQueueBudgetError)
    expect((failure as ResolutionQueueBudgetError).recent).toEqual([
      '1:second',
      '2:third'
    ])
  })
})
