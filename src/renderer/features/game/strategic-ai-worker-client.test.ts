import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AiSearchWorkerRequest,
  AiSearchWorkerResult
} from '../../../game/match/ai'
import { StrategicAiWorkerClient } from './strategic-ai-worker-client'

class FakeWorker {
  static latest: FakeWorker | null = null
  readonly messages: unknown[] = []
  onmessage: ((event: MessageEvent<AiSearchWorkerResult>) => void) | null = null
  onerror: (() => void) | null = null
  terminated = false

  constructor() {
    FakeWorker.latest = this
  }

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  terminate(): void {
    this.terminated = true
  }
}

function request(requestId: string): AiSearchWorkerRequest {
  return {
    type: 'search',
    requestId,
    observationRevision: 7,
    checkpoint: {} as AiSearchWorkerRequest['checkpoint'],
    perspectivePlayerId: 'ai' as AiSearchWorkerRequest['perspectivePlayerId'],
    roots: [],
    plan: {},
    limits: {
      timeBudgetMs: 1_000,
      nodeLimit: 100,
      atomicDepth: 4,
      ownTurnBeam: 4,
      opponentTurnBeam: 2,
      determinizations: 0,
      randomOutcomeSamples: 0,
      transpositionCapacity: 100
    },
    deterministicSampleSeed: 1
  }
}

function result(requestId: string): AiSearchWorkerResult {
  return {
    type: 'search-result',
    requestId,
    observationRevision: 7,
    roots: [],
    candidateDossiers: [],
    exploredNodes: 0,
    cacheHits: 0,
    partial: false,
    elapsedMs: 2
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakeWorker.latest = null
})

describe('StrategicAiWorkerClient', () => {
  it('cancels obsolete work before starting a newer revision request', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const client = new StrategicAiWorkerClient()
    const worker = FakeWorker.latest!
    const first = client.search(request('first'))
    const firstRejection = expect(first).rejects.toThrow('cancelled')

    const second = client.search(request('second'))
    expect(worker.messages).toEqual([
      expect.objectContaining({ type: 'search', requestId: 'first' }),
      { type: 'cancel-search', requestId: 'first' },
      expect.objectContaining({ type: 'search', requestId: 'second' })
    ])
    worker.onmessage?.({ data: result('second') } as MessageEvent<AiSearchWorkerResult>)

    await firstRejection
    await expect(second).resolves.toEqual(result('second'))
    client.destroy()
    expect(worker.terminated).toBe(true)
  })

  it('recreates a crashed worker for the next decision', () => {
    vi.stubGlobal('Worker', FakeWorker)
    const client = new StrategicAiWorkerClient()
    const crashed = FakeWorker.latest!

    crashed.onerror?.()

    expect(crashed.terminated).toBe(true)
    expect(FakeWorker.latest).not.toBe(crashed)
    client.destroy()
  })
})
