import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAiFixture } from '../../../game-rules/match/testing/ai-scenario-builder'
import { GameBoardSession } from '../game-board-session'
import { aiActions } from './ai-context'
import { aiActionIntent } from './ai-action-intent'
import { enumerateLegalCommands } from '../../../game-rules/match'
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

  emit(data: ExpertAiWorldWorkerResponse): void {
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
  vi.useRealTimers()
  completeImmediately = true
  workers.length = 0
})

describe('Expert hidden-world worker pool', () => {
  it('charges queue time to the deadline instead of starting an expired search', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    completeImmediately = false
    const pool = new ExpertAiWorldPool(() => new TestWorldWorker() as unknown as Worker)
    const running = [0, 1, 2].map((index) =>
      pool.evaluate(makeRequest('occupied'), index, 5_000)
    )
    const queued = pool.evaluate(makeRequest('expired'), 0, 500)
    const rejected = expect(queued).rejects.toThrow('deadline expired in the queue')
    await vi.advanceTimersByTimeAsync(501)
    const first = workers[0]!.requests[0]!
    if (first.type !== 'evaluate') throw new Error('Expected evaluate')
    expect(first.deadlineEpochMs).toBeGreaterThan(Date.now())
    workers[0]!.emit({
      type: 'result',
      taskId: first.taskId,
      result: makeWorldResult(0)
    })
    await rejected
    expect(
      workers
        .flatMap((worker) => worker.requests)
        .filter((entry) => entry.type === 'evaluate')
    ).toHaveLength(3)
    pool.cancel('occupied')
    await Promise.all(running)
  })
  it('retains the latest partial result and its real world index when a worker times out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    completeImmediately = false
    const fixture = createAiFixture({
      seed: 29,
      aiHeroId: 'jaina',
      opponentHeroId: 'garrosh'
    })
    const session = new GameBoardSession({
      setup: fixture.setup,
      decks: fixture.decks,
      checkpoint: fixture.checkpoint
    })
    const actions = aiActions(
      session,
      enumerateLegalCommands(
        {
          getState: session.match.getState,
          getLegality: session.match.getLegality!,
          getPlayInput: session.match.getPlayInput!
        },
        session.remoteParticipantId
      )
    )
    const request = {
      ...makeRequest('partial-world'),
      checkpoint: fixture.checkpoint,
      perspectivePlayerId: fixture.aiParticipantId,
      request: {
        ...makeRequest('partial-world').request,
        actionIds: actions.map((action) => action.id)
      }
    }
    const pool = new ExpertAiWorldPool(() => new TestWorldWorker() as unknown as Worker)
    const pending = pool.evaluate(request, 2, 1_000)
    const message = workers[0]!.requests[0]!
    if (message.type !== 'evaluate') throw new Error('Expected evaluate')
    workers[0]!.emit({
      type: 'progress',
      taskId: message.taskId,
      iterations: 8,
      recommendationValue: 0.2,
      response: {
        ...request.request,
        modelId: 'hardware-local-v2',
        reason: 'Partial',
        choice: {
          actionId: actions[0]!.id,
          intent: aiActionIntent(actions[0]!.command, session.localParticipantId),
          expectedResult: 'Partial result.',
          planUpdate: null
        },
        durationMs: 800,
        finishReason: 'expert-search-progress'
      }
    })
    await vi.advanceTimersByTimeAsync(1_751)
    const result = await pending
    expect(result).toMatchObject({ worldIndex: 2, status: 'partial' })
    expect(result?.evaluation.trace?.candidates[0]?.recommendationValue).toBe(0.2)
    expect(result?.evaluation.trace?.sampleCount).toBe(8)
  })
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
