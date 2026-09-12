import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { post } from './ai-transport'
import { AiRequestError } from '../../shared/ipc/ai'

const https = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('node:https', () => https)
afterEach(() => {
  vi.useRealTimers()
  https.request.mockReset()
})

function setup(status = 200) {
  const request = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() })
  const response = Object.assign(new EventEmitter(), {
    statusCode: status,
    headers: {},
    destroy: vi.fn()
  })
  let deliver!: () => void
  https.request.mockImplementation((_url, _options, callback) => {
    deliver = () => callback(response)
    return request
  })
  const controller = new AbortController()
  const promise = post(
    new URL('https://example.invalid'),
    '{}',
    {},
    'secret-key',
    controller.signal,
    vi.fn(),
    1000
  )
  return { request, response, controller, promise, deliver }
}

describe('AI transport safeguards', () => {
  it('enforces a wall-clock deadline even while bytes arrive', async () => {
    vi.useFakeTimers()
    const { promise, request, response, deliver } = setup()
    const rejected = expect(promise).rejects.toMatchObject({
      details: { failureKind: 'timeout', repairable: false }
    })
    deliver()
    await vi.advanceTimersByTimeAsync(500)
    response.emit('data', Buffer.from(' '))
    await vi.advanceTimersByTimeAsync(500)
    await rejected
    expect(request.destroy).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('bounds and redacts HTTP diagnostics', async () => {
    const { promise, response, deliver } = setup(429)
    deliver()
    response.emit(
      'data',
      Buffer.from('secret-key Bearer another-secret ' + 'x'.repeat(20_000))
    )
    response.emit('end')
    const error = await promise.catch((error) => error)
    if (!(error instanceof AiRequestError))
      throw new Error('Expected an AI transport error')
    expect(error.message).toBe('AI provider HTTP 429.')
    expect(error.details).toMatchObject({
      failureKind: 'provider-http',
      contentTruncated: true
    })
    expect(error.details?.rejectedContent).toHaveLength(16_000)
    expect(JSON.stringify(error)).not.toMatch(/secret-key|another-secret/)
  })
  it('rejects oversized bodies before buffering them', async () => {
    const { promise, request, response, deliver } = setup()
    deliver()
    response.emit('data', Buffer.alloc(4 * 1024 * 1024 + 1))
    await expect(promise).rejects.toMatchObject({
      details: { failureKind: 'response-too-large' }
    })
    expect(request.destroy).toHaveBeenCalledOnce()
    expect(response.destroy).toHaveBeenCalledOnce()
  })
  it('cleans up its deadline on success and caller cancellation', async () => {
    vi.useFakeTimers()
    const success = setup()
    success.deliver()
    success.response.emit('data', Buffer.from('{"ok":true}'))
    success.response.emit('end')
    await expect(success.promise).resolves.toEqual({ ok: true })
    expect(vi.getTimerCount()).toBe(0)
    const cancelled = setup()
    cancelled.controller.abort(new Error('Match exited'))
    await expect(cancelled.promise).rejects.toThrow('Match exited')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('classifies interrupted responses and malformed provider JSON', async () => {
    const interrupted = setup()
    interrupted.deliver()
    interrupted.response.emit('aborted')
    await expect(interrupted.promise).rejects.toMatchObject({
      details: { failureKind: 'network' }
    })
    const malformed = setup()
    malformed.deliver()
    malformed.response.emit('data', Buffer.from('not JSON'))
    malformed.response.emit('end')
    await expect(malformed.promise).rejects.toMatchObject({
      details: { failureKind: 'provider-json', repairable: false }
    })
  })
})
