import { evaluateExpertAiWorld } from './expert-ai-world-runner'
import type {
  ExpertAiWorldWorkerRequest,
  ExpertAiWorldWorkerResponse
} from './expert-ai-world-runner'
import type { LocalAiDecisionApi } from './local-ai-decision-api'
import type { AiDecisionIdentity } from '../../../shared/ipc/ai'

interface WorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<ExpertAiWorldWorkerRequest>) => void
  ): void
  postMessage(message: ExpertAiWorldWorkerResponse): void
}

const workerScope =
  typeof self === 'undefined' ? null : (self as unknown as WorkerScope)
const cancelled = new Set<string>()
const activeSearches = new Map<
  string,
  { readonly api: LocalAiDecisionApi; readonly identity: AiDecisionIdentity }
>()

async function evaluate(
  request: Extract<ExpertAiWorldWorkerRequest, { readonly type: 'evaluate' }>
): Promise<void> {
  const { taskId } = request
  cancelled.delete(taskId)
  try {
    const result = await evaluateExpertAiWorld(
      request.request,
      request.worldIndex,
      request.budgetMs,
      {
        isCancelled: () => cancelled.has(taskId),
        onApiCreated: (api) =>
          activeSearches.set(taskId, {
            api,
            identity: request.request.request
          })
      }
    )
    if (cancelled.has(taskId) || !result)
      workerScope?.postMessage({ type: 'cancelled', taskId })
    else workerScope?.postMessage({ type: 'result', taskId, result })
  } catch (error) {
    if (cancelled.has(taskId)) workerScope?.postMessage({ type: 'cancelled', taskId })
    else
      workerScope?.postMessage({
        type: 'failure',
        taskId,
        error: error instanceof Error ? error.message : String(error)
      })
  } finally {
    activeSearches.delete(taskId)
    cancelled.delete(taskId)
  }
}

if (workerScope) {
  workerScope.addEventListener('message', (event) => {
    const request = event.data
    if (request.type === 'cancel') {
      cancelled.add(request.taskId)
      const active = activeSearches.get(request.taskId)
      if (active) void active.api.cancel(active.identity)
      return
    }
    void evaluate(request)
  })
}
