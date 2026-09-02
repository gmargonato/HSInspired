import type {
  AiSearchWorkerRequest,
  AiSearchWorkerResult
} from '../../../game/match/ai/ai-types'
import { rankWorkerDossiers } from '../../../game/match/ai/worker-ranking'

/** One persistent worker per match controller with deterministic crash fallback. */
export class CompetitiveAiWorkerClient {
  private worker: Worker | null = null
  private readonly pending = new Map<
    string,
    Readonly<{
      resolve: (result: AiSearchWorkerResult) => void
      reject: (error: Error) => void
      timeout: ReturnType<typeof setTimeout>
    }>
  >()

  constructor() {
    if (typeof Worker === 'undefined') return
    this.worker = new Worker(new URL('./competitive-ai-worker.ts', import.meta.url), {
      type: 'module',
      name: 'competitive-ai-v2'
    })
    this.worker.onmessage = (event: MessageEvent<AiSearchWorkerResult>): void => {
      const entry = this.pending.get(event.data.requestId)
      if (!entry) return
      this.pending.delete(event.data.requestId)
      clearTimeout(entry.timeout)
      entry.resolve(event.data)
    }
    this.worker.onerror = (): void => {
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timeout)
        entry.reject(new Error('Competitive AI worker crashed.'))
      }
      this.pending.clear()
      this.worker?.terminate()
      this.worker = null
    }
  }

  async rank(request: AiSearchWorkerRequest): Promise<AiSearchWorkerResult> {
    if (!this.worker) return rankWorkerDossiers(request)
    return new Promise<AiSearchWorkerResult>((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          this.pending.delete(request.requestId)
          resolve(rankWorkerDossiers(request))
        },
        Math.max(1, Math.min(8_000, request.limits.timeBudgetMs))
      )
      this.pending.set(request.requestId, { resolve, reject, timeout })
      this.worker!.postMessage(request)
    }).catch(() => rankWorkerDossiers(request))
  }

  destroy(): void {
    this.worker?.terminate()
    this.worker = null
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timeout)
      entry.reject(new Error('Competitive AI worker was destroyed.'))
    }
    this.pending.clear()
  }
}
