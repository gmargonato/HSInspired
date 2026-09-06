import { describe, expect, it } from 'vitest'
import { PresentationQueue } from './presentation-queue'

describe('PresentationQueue', () => {
  it('runs presentation work in submission order without delaying submission', async () => {
    const queue = new PresentationQueue()
    const order: string[] = []
    let releaseFirst: (() => void) | undefined
    const first = queue.enqueue(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = () => {
            order.push('first')
            resolve()
          }
        })
    )
    const second = queue.enqueue(async () => {
      order.push('second')
    })

    await Promise.resolve()
    expect(queue.busy).toBe(true)
    expect(order).toEqual([])

    releaseFirst?.()
    await Promise.all([first, second])
    expect(order).toEqual(['first', 'second'])
    expect(queue.busy).toBe(false)
  })

  it('continues after a failed presentation', async () => {
    const queue = new PresentationQueue()
    const failed = queue.enqueue(async () => {
      throw new Error('presentation failed')
    })
    const next = queue.enqueue(async () => 'presented')

    await expect(failed).rejects.toThrow('presentation failed')
    await expect(next).resolves.toBe('presented')
  })
})
