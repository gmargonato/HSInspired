import { afterEach, describe, expect, it } from 'vitest'
import type {
  ExpertAiWorldEvaluation,
  ExpertAiWorldWorkerRequest,
  ExpertAiWorldWorkerResponse,
  ExpertWorldRequest
} from './expert-ai-world-runner'
import { ExpertAiWorldPool } from './expert-ai-world-pool'

const workers: TestWorldWorker[] = []
let completeImmediately = true

class TestWorldWorker {
  private readonly listeners = new Map<string, ((event: MessageEvent) => void)[]>()
  readonly requests: ExpertAiWorldWorkerRequest[] = []

  constructor() {
    workers.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  postMessage(message: ExpertAiWorldWorkerRequest): void {
    this.requests.push(message)
    if (message.type === 'cancel') {
      this.emit({ type: 'cancelled', taskId: message.taskId })
      return
    }
    if (completeImmediately) {
      this.emit({
        type: 'result',
        taskId: message.taskId,
        result: makeWorldResult(message.worldIndex)
      })
    }
  }

  terminate(): void {}

  private emit(data: ExpertAiWorldWorkerResponse): void {
    queueMicrotask(() => {
      for (const listener of this.listeners.get('message') ?? [])
        listener({ data } as MessageEvent)
    })
  }
}

function makeWorldResult(worldIndex: number): ExpertAiWorldEvaluation {
  return {
    evaluation: {
      response: {} as ExpertAiWorldEvaluation['evaluation']['response'],
      trace: null
    },
    actions: [
      { id: `world-${worldIndex}` } as ExpertAiWorldEvaluation['actions'][number]
    ]
  }
}

function makeRequest(requestId: string): ExpertWorldRequest {
  return {
    type: 'decide',
    request: {
      matchId: 'world-pool-test-match',
      requestId,
      expectedRevision: 0,
      phase: 'action',
      allowInspection: false,
      messages: [],
      actionIds: []
    },
    checkpoint: {} as ExpertWorldRequest['checkpoint'],
    perspectivePlayerId:
      'world-pool-player' as ExpertWorldRequest['perspectivePlayerId'],
    seed: 1,
    remainingSearchBudgetMs: 5_000
  }
}

afterEach(() => {
  completeImmediately = true
  workers.length = 0
})

describe('Expert hidden-world worker pool', () => {
  it('runs independent worlds on separate workers and returns their own results', async () => {
    const pool = new ExpertAiWorldPool(() => new TestWorldWorker() as unknown as Worker)
    const request = makeRequest('parallel-worlds')
    const results = await Promise.all([
      pool.evaluate(request, 0, 2_000),
      pool.evaluate(request, 1, 2_000)
    ])

    expect(workers).toHaveLength(2)
    expect(workers.map((worker) => worker.requests[0]?.type)).toEqual([
      'evaluate',
      'evaluate'
    ])
    expect(results.map((result) => result?.actions[0]?.id)).toEqual([
      'world-0',
      'world-1'
    ])
  })

  it('cancels active world tasks and settles their requests promptly', async () => {
    const pool = new ExpertAiWorldPool(() => new TestWorldWorker() as unknown as Worker)
    completeImmediately = false
    const request = makeRequest('cancelled-worlds')
    const result = pool.evaluate(request, 0, 2_000)

    pool.cancel(request.request.requestId)

    await expect(result).resolves.toBeNull()
    expect(workers[0]?.requests.map((entry) => entry.type)).toEqual([
      'evaluate',
      'cancel'
    ])
  })
})
