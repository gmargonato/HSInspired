import type {
  ExpertAiWorldEvaluation,
  ExpertAiWorldWorkerRequest,
  ExpertAiWorldWorkerResponse,
  ExpertWorldRequest
} from './expert-ai-world-runner'
import type { AiDecisionResponse } from '../../../desktop/contracts/ipc/ai'
import { partialExpertWorld } from './expert-ai-world-runner'

const MAX_EXPERT_AI_WORLD_WORKERS = 3

interface WorldWorkerSlot {
  worker: Worker | null
  activeTaskId: string | null
}

interface PendingWorldTask {
  progress?: {
    response: AiDecisionResponse
    recommendationValue: number
    iterations: number
  }
  readonly taskId: string
  readonly requestId: string
  readonly request: ExpertWorldRequest
  readonly worldIndex: number
  readonly budgetMs: number
  readonly deadlineEpochMs: number
  readonly resolve: (result: ExpertAiWorldEvaluation | null) => void
  readonly reject: (error: Error) => void
  readonly onProgress?: (
    response: AiDecisionResponse,
    recommendationValue: number,
    iterations: number
  ) => void
  settled: boolean
  slotIndex: number | null
  timer: ReturnType<typeof setTimeout> | null
}

export class ExpertAiWorldPool {
  private readonly slots: WorldWorkerSlot[] = Array.from(
    { length: MAX_EXPERT_AI_WORLD_WORKERS },
    () => ({ worker: null, activeTaskId: null })
  )
  private readonly pending = new Map<string, PendingWorldTask>()
  private readonly queue: string[] = []
  private nextTaskOrdinal = 1

  constructor(private readonly createWorker: () => Worker = defaultWorldWorker) {}

  evaluate(
    request: ExpertWorldRequest,
    worldIndex: number,
    budgetMs: number,
    onProgress?: PendingWorldTask['onProgress']
  ): Promise<ExpertAiWorldEvaluation | null> {
    const taskId = `${request.request.requestId}:${worldIndex}:${this.nextTaskOrdinal++}`
    return new Promise((resolve, reject) => {
      this.pending.set(taskId, {
        taskId,
        requestId: request.request.requestId,
        request,
        worldIndex,
        budgetMs,
        deadlineEpochMs: Date.now() + budgetMs,
        resolve,
        reject,
        ...(onProgress ? { onProgress } : {}),
        settled: false,
        slotIndex: null,
        timer: null
      })
      this.queue.push(taskId)
      this.dispatchQueuedTasks()
    })
  }

  cancel(requestId: string): void {
    for (const task of this.pending.values()) {
      if (task.requestId !== requestId) continue
      if (!task.settled) {
        task.settled = true
        task.resolve(null)
      }
      if (task.slotIndex === null) {
        this.clearTask(task)
        continue
      }
      const worker = this.slots[task.slotIndex]?.worker
      if (worker) {
        try {
          worker.postMessage({ type: 'cancel', taskId: task.taskId })
        } catch {
          // The bounded task timeout releases a worker that can no longer receive.
        }
      }
    }
    this.dispatchQueuedTasks()
  }

  private dispatchQueuedTasks(): void {
    for (
      let slotIndex = 0;
      slotIndex < this.slots.length && this.queue.length;
      slotIndex++
    ) {
      const slot = this.slots[slotIndex]!
      if (slot.activeTaskId) continue
      let task: PendingWorldTask | undefined
      while (this.queue.length && !task) {
        const taskId = this.queue.shift()!
        const candidate = this.pending.get(taskId)
        if (candidate && !candidate.settled) task = candidate
      }
      if (!task) continue
      const remainingMs = task.deadlineEpochMs - Date.now()
      if (remainingMs <= 0) {
        this.settleFailure(
          task,
          new Error('Expert AI world deadline expired in the queue.')
        )
        slotIndex--
        continue
      }

      let worker: Worker
      try {
        worker = this.getWorker(slotIndex)
      } catch (error) {
        this.settleFailure(task, error)
        continue
      }
      slot.activeTaskId = task.taskId
      task.slotIndex = slotIndex
      task.timer = setTimeout(
        () => {
          if (slot.activeTaskId !== task!.taskId) return
          slot.activeTaskId = null
          worker.terminate()
          slot.worker = null
          if (task!.progress && !task!.settled) {
            const progress = task!.progress
            try {
              const partial = partialExpertWorld(
                task!.request,
                task!.worldIndex,
                progress.response,
                progress.recommendationValue,
                progress.iterations
              )
              task!.settled = true
              task!.resolve(partial)
              this.clearTask(task!)
            } catch (error) {
              this.settleFailure(task!, error)
            }
          } else
            this.settleFailure(task!, new Error('Expert AI world worker timed out.'))
          this.dispatchQueuedTasks()
        },
        Math.max(1, remainingMs + 750)
      )
      try {
        const message: ExpertAiWorldWorkerRequest = {
          type: 'evaluate',
          taskId: task.taskId,
          request: task.request,
          worldIndex: task.worldIndex,
          budgetMs: task.budgetMs,
          deadlineEpochMs: task.deadlineEpochMs
        }
        worker.postMessage(message)
      } catch (error) {
        if (task.timer) clearTimeout(task.timer)
        task.timer = null
        slot.activeTaskId = null
        slot.worker = null
        worker.terminate()
        this.settleFailure(task, error)
      }
    }
  }

  private getWorker(slotIndex: number): Worker {
    const slot = this.slots[slotIndex]!
    if (slot.worker) return slot.worker
    const worker = this.createWorker()
    worker.addEventListener(
      'message',
      (event: MessageEvent<ExpertAiWorldWorkerResponse>) => {
        const taskId = slot.activeTaskId
        if (!taskId) return
        const task = this.pending.get(taskId)
        if (event.data.taskId !== taskId) return
        if (event.data.type === 'progress') {
          if (task && !task.settled) task.progress = event.data
          if (task && !task.settled)
            task.onProgress?.(
              event.data.response,
              event.data.recommendationValue,
              event.data.iterations
            )
          return
        }
        slot.activeTaskId = null
        if (task?.timer) clearTimeout(task.timer)
        if (task) task.timer = null
        if (task) {
          this.pending.delete(taskId)
          task.slotIndex = null
          if (!task.settled) {
            if (event.data.type === 'failure') task.reject(new Error(event.data.error))
            else if (event.data.type === 'result') task.resolve(event.data.result)
            else task.resolve(null)
          }
        }
        this.dispatchQueuedTasks()
      }
    )
    worker.addEventListener('error', (event: ErrorEvent) => {
      if (slot.worker !== worker) return
      const taskId = slot.activeTaskId
      slot.activeTaskId = null
      worker.terminate()
      slot.worker = null
      if (taskId) {
        const task = this.pending.get(taskId)
        if (task)
          this.settleFailure(
            task,
            new Error(event.message || 'Expert AI world worker failed.')
          )
      }
      this.dispatchQueuedTasks()
    })
    slot.worker = worker
    return worker
  }

  private settleFailure(task: PendingWorldTask, error: unknown): void {
    if (task.timer) clearTimeout(task.timer)
    task.timer = null
    this.pending.delete(task.taskId)
    task.slotIndex = null
    if (!task.settled) {
      task.settled = true
      task.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private clearTask(task: PendingWorldTask): void {
    if (task.timer) clearTimeout(task.timer)
    task.timer = null
    this.pending.delete(task.taskId)
    const queueIndex = this.queue.indexOf(task.taskId)
    if (queueIndex >= 0) this.queue.splice(queueIndex, 1)
  }
}

function defaultWorldWorker(): Worker {
  return new Worker(new URL('./expert-ai-world.worker.ts', import.meta.url), {
    type: 'module'
  })
}

const worldPool = new ExpertAiWorldPool()

export function evaluateExpertAiWorldInWorker(
  request: ExpertWorldRequest,
  worldIndex: number,
  budgetMs: number,
  onProgress?: PendingWorldTask['onProgress']
): Promise<ExpertAiWorldEvaluation | null> {
  return worldPool.evaluate(request, worldIndex, budgetMs, onProgress)
}

export function cancelExpertAiWorlds(requestId: string): void {
  worldPool.cancel(requestId)
}
