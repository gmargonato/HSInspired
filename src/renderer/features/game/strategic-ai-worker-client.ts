import type {
  AiSearchWorkerMessage,
  AiSearchWorkerRequest,
  AiSearchWorkerResult
} from '../../../game/match/ai/ai-types'
import {
  createOpeningMatchFromCheckpoint,
  AiTranspositionCache,
  enumerateLegalCommands,
  searchStrategicTurn
} from '../../../game/match'
import { rankWorkerDossiers } from '../../../game/match/ai/worker-ranking'

function runSynchronousTestSearch(
  request: AiSearchWorkerRequest
): AiSearchWorkerResult {
  const startedAt = Date.now()
  const match = createOpeningMatchFromCheckpoint(request.checkpoint)
  const roots =
    request.roots ??
    match
      .analyze((fork) => enumerateLegalCommands(fork, request.perspectivePlayerId))
      .slice(0, 128)
      .map((command, index) => ({ actionId: `action-${index}`, command }))
  const result = searchStrategicTurn(
    match,
    request.perspectivePlayerId,
    roots,
    request.limits,
    request.plan,
    new AiTranspositionCache(request.limits.transpositionCapacity)
  )
  return rankWorkerDossiers(
    request,
    result.dossiers,
    {
      exploredNodes: result.exploredNodes,
      cacheHits: result.cacheHits,
      partial: result.partial
    },
    startedAt,
    roots
  )
}

/** One persistent worker per match controller with deterministic crash fallback. */
export class StrategicAiWorkerClient {
  private worker: Worker | null = null
  private destroyed = false
  private readonly pending = new Map<
    string,
    Readonly<{
      resolve: (result: AiSearchWorkerResult) => void
      reject: (error: Error) => void
      timeout: ReturnType<typeof setTimeout>
    }>
  >()
  private activeRequestId: string | null = null

  constructor() {
    this.createWorker()
  }

  private createWorker(): void {
    if (this.destroyed || typeof Worker === 'undefined') return
    const worker = new Worker(new URL('./strategic-ai-worker.ts', import.meta.url), {
      type: 'module',
      name: 'strategic-ai-v3'
    })
    this.worker = worker
    worker.onmessage = (event: MessageEvent<AiSearchWorkerResult>): void => {
      if (this.worker !== worker) return
      const entry = this.pending.get(event.data.requestId)
      if (!entry) return
      this.pending.delete(event.data.requestId)
      if (this.activeRequestId === event.data.requestId) this.activeRequestId = null
      clearTimeout(entry.timeout)
      entry.resolve(event.data)
    }
    worker.onerror = (): void => {
      if (this.worker !== worker) return
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timeout)
        entry.reject(new Error('Strategic AI worker crashed.'))
      }
      this.pending.clear()
      this.activeRequestId = null
      worker.terminate()
      this.worker = null
      this.createWorker()
    }
  }

  async search(request: AiSearchWorkerRequest): Promise<AiSearchWorkerResult> {
    if (!this.worker) {
      if (import.meta.env.MODE === 'test') return runSynchronousTestSearch(request)
      throw new Error('Strategic AI worker is unavailable.')
    }
    this.cancelActive()
    this.activeRequestId = request.requestId
    return new Promise<AiSearchWorkerResult>((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          this.pending.delete(request.requestId)
          if (this.activeRequestId === request.requestId) this.activeRequestId = null
          const timedOutWorker = this.worker
          timedOutWorker?.postMessage({
            type: 'cancel-search',
            requestId: request.requestId
          } satisfies AiSearchWorkerMessage)
          timedOutWorker?.terminate()
          if (this.worker === timedOutWorker) {
            this.worker = null
            this.createWorker()
          }
          reject(new Error('Strategic AI worker search timed out.'))
        },
        Math.max(250, request.limits.timeBudgetMs + 500)
      )
      this.pending.set(request.requestId, { resolve, reject, timeout })
      this.worker!.postMessage(request)
    })
  }

  cancelActive(): void {
    if (!this.activeRequestId) return
    const requestId = this.activeRequestId
    this.activeRequestId = null
    this.worker?.postMessage({
      type: 'cancel-search',
      requestId
    } satisfies AiSearchWorkerMessage)
    const entry = this.pending.get(requestId)
    if (!entry) return
    this.pending.delete(requestId)
    clearTimeout(entry.timeout)
    entry.reject(new Error('Strategic AI worker search was cancelled.'))
  }

  destroy(): void {
    this.destroyed = true
    this.cancelActive()
    this.worker?.terminate()
    this.worker = null
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timeout)
      entry.reject(new Error('Strategic AI worker was destroyed.'))
    }
    this.pending.clear()
  }
}
