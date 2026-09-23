import {
  AiRequestError,
  type AiDecisionApi,
  type AiDecisionIdentity,
  type AiDecisionRequest,
  type AiDecisionResponse,
  type AiSettings
} from '../../../shared/ipc/ai'
import { createFairHypothesisCheckpoint } from '../../../game/match/ai/fair-hypothesis-checkpoint'
import { enumerateLegalCommands } from '../../../game/match'
import { sameAiIntent, type AiActionIntent } from '../../../shared/ipc/ai-deliberation'
import type { GameBoardSession } from './game-board-session'
import { aiActionIntent } from './ai-action-intent'
import { aiActions } from './ai-context'
import {
  EXPERT_AI_DECISION_SEARCH_BUDGET_MS,
  EXPERT_AI_DISPATCH_RESERVE_MS,
  EXPERT_AI_PRESENTATION_RESERVE_MS,
  EXPERT_AI_SEARCH_BUDGET_MS,
  EXPERT_AI_TURN_BUDGET_MS
} from './expert-ai-worker-protocol'
import type {
  ExpertAiWorkerRequest,
  ExpertAiWorkerResponse
} from './expert-ai-worker-protocol'

export {
  EXPERT_AI_DECISION_SEARCH_BUDGET_MS,
  EXPERT_AI_DISPATCH_RESERVE_MS,
  EXPERT_AI_PRESENTATION_RESERVE_MS,
  EXPERT_AI_SEARCH_BUDGET_MS,
  EXPERT_AI_TURN_BUDGET_MS
} from './expert-ai-worker-protocol'

const EXPERT_AI_MULLIGAN_BUDGET_MS = 3_000

interface PendingDecision {
  readonly request: AiDecisionRequest
  readonly startedAt: number
  readonly resolve: (response: AiDecisionResponse) => void
  readonly reject: (error: unknown) => void
  readonly timer: ReturnType<typeof setTimeout>
}

interface ExpertContinuation {
  readonly turn: number
  readonly expectedRevision: number
  readonly nextIndex: number
  readonly actions: readonly AiActionIntent[]
}

interface ExpertPlanCommit {
  readonly matchId: string
  readonly turn: number
  readonly revision: number
  readonly response: AiDecisionResponse
}

type WorkerFactory = () => Worker

function createExpertWorker(): Worker {
  return new Worker(new URL('./expert-ai.worker.ts', import.meta.url), {
    type: 'module'
  })
}

function requestSeed(request: AiDecisionRequest): number {
  const input =
    request.matchId + ':' + request.requestId + ':' + request.expectedRevision
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index++)
    hash = Math.imul(hash ^ input.charCodeAt(index), 0x01000193)
  return hash >>> 0
}

function isAiActionIntent(value: unknown): value is AiActionIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const intent = value as Record<string, unknown>
  return (
    typeof intent.type === 'string' &&
    (intent.source === null || typeof intent.source === 'string') &&
    Array.isArray(intent.targets) &&
    intent.targets.every((target) => typeof target === 'string') &&
    (intent.position === null || Number.isSafeInteger(intent.position)) &&
    (intent.option === null || Number.isSafeInteger(intent.option))
  )
}

/**
 * Expert local AI runs only on a redacted match checkpoint in a disposable
 * module worker. The easy local opponent remains the in-renderer default.
 */
export class ExpertAiDecisionApi implements AiDecisionApi {
  private worker: Worker | null = null
  private readonly pending = new Map<string, PendingDecision>()
  private disposed = false
  private activeTurn: number | null = null
  private turnStartedAt = 0
  private searchUsedMs = 0
  private continuation: ExpertContinuation | null = null
  private planCommit: ExpertPlanCommit | null = null
  private readonly unsubscribe: () => void

  constructor(
    private readonly session: GameBoardSession,
    private readonly workerFactory: WorkerFactory = createExpertWorker,
    private readonly now: () => number = () => performance.now()
  ) {
    this.unsubscribe = session.subscribe((result) => {
      this.observeTurn(result.state)
    })
    this.observeTurn(session.getState())
  }

  async settings(): Promise<AiSettings> {
    return {
      enabled: true,
      provider: 'none',
      modelId: 'hardware-local-v2',
      reasoningEffort: 'none',
      maxCompletionTokens: 1,
      maxContextBytes: 200_000
    }
  }

  async decide(request: AiDecisionRequest): Promise<AiDecisionResponse> {
    if (this.disposed) throw new Error('Expert AI worker has been disposed.')
    if (request.phase === 'plan') this.planCommit = null
    else if (request.phase === 'action') {
      const cachedPlanAction = this.takePlanCommit(request)
      if (cachedPlanAction) return cachedPlanAction
    }
    const startedAt = this.now()
    let remainingBudgetMs = this.remainingBudget(request)
    if (remainingBudgetMs <= 100) {
      const continuedAction = this.takeApplicableContinuation(request)
      if (continuedAction) return continuedAction
      throw new AiRequestError('Expert AI reached its allocated turn search budget.', {
        failureKind: 'timeout',
        budgetMs: EXPERT_AI_TURN_BUDGET_MS
      })
    }

    const seed = requestSeed(request)
    const checkpoint = createFairHypothesisCheckpoint(
      this.session.match.getCheckpoint(),
      this.session.remoteParticipantId,
      seed
    )
    const worker = this.getWorker()
    remainingBudgetMs = this.remainingBudget(request)
    if (remainingBudgetMs <= 100) {
      const continuedAction = this.takeApplicableContinuation(request)
      if (continuedAction) return continuedAction
      throw new AiRequestError('Expert AI reached its allocated turn search budget.', {
        failureKind: 'timeout',
        budgetMs: EXPERT_AI_TURN_BUDGET_MS
      })
    }
    const preferredContinuation = this.preferredContinuation(request)
    const message: ExpertAiWorkerRequest = {
      type: 'decide',
      request,
      checkpoint,
      perspectivePlayerId: this.session.remoteParticipantId,
      seed,
      remainingSearchBudgetMs: Math.min(
        EXPERT_AI_DECISION_SEARCH_BUDGET_MS,
        EXPERT_AI_SEARCH_BUDGET_MS,
        remainingBudgetMs
      ),
      ...(preferredContinuation ? { preferredContinuation } : {})
    }

    return new Promise<AiDecisionResponse>((resolve, reject) => {
      if (this.pending.has(request.requestId)) {
        reject(new Error('Expert AI already has this request in progress.'))
        return
      }

      const timeoutMs = remainingBudgetMs
      const timer = setTimeout(() => {
        const pending = this.takePending(request.requestId)
        if (!pending) return
        try {
          worker.postMessage({ type: 'cancel', identity: request })
        } catch {
          // The timeout response remains authoritative if the worker has exited.
        }
        const continuedAction = this.takeApplicableContinuation(pending.request)
        if (continuedAction) {
          pending.resolve(continuedAction)
          return
        }
        reject(
          new AiRequestError('Expert AI exceeded its allocated turn search budget.', {
            failureKind: 'timeout',
            budgetMs: EXPERT_AI_TURN_BUDGET_MS
          })
        )
      }, timeoutMs)

      this.pending.set(request.requestId, {
        request,
        startedAt,
        resolve,
        reject,
        timer
      })
      try {
        worker.postMessage(message)
      } catch (error) {
        const pending = this.takePending(request.requestId)
        if (!pending) return
        const continuedAction = this.takeApplicableContinuation(pending.request)
        if (continuedAction) pending.resolve(continuedAction)
        else pending.reject(error)
      }
    })
  }

  async cancel(identity: AiDecisionIdentity): Promise<void> {
    const pending = this.pending.get(identity.requestId)
    if (pending) {
      this.takePending(identity.requestId)?.reject(new Error('AI request cancelled.'))
    }
    this.worker?.postMessage({ type: 'cancel', identity })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const requestId of [...this.pending.keys()])
      this.takePending(requestId)?.reject(
        new Error('Expert AI worker has been disposed.')
      )
    this.continuation = null
    this.planCommit = null
    this.unsubscribe()
    this.worker?.terminate()
    this.worker = null
  }

  private remainingBudget(request: AiDecisionRequest): number {
    if (request.phase === 'mulligan') return EXPERT_AI_MULLIGAN_BUDGET_MS

    const state = this.session.getState()
    if (
      state.phase !== 'turns' ||
      state.activePlayerId !== this.session.remoteParticipantId
    )
      return 0

    this.observeTurn(state)
    const elapsedTurnMs = Math.max(0, this.now() - this.turnStartedAt)
    const remainingTurnMs = Math.max(
      0,
      EXPERT_AI_TURN_BUDGET_MS -
        elapsedTurnMs -
        EXPERT_AI_PRESENTATION_RESERVE_MS -
        EXPERT_AI_DISPATCH_RESERVE_MS
    )
    const remainingSearchMs = Math.max(
      0,
      EXPERT_AI_SEARCH_BUDGET_MS - this.searchUsedMs
    )
    return Math.min(remainingTurnMs, remainingSearchMs)
  }

  private preferredContinuation(
    request: AiDecisionRequest
  ): AiActionIntent | undefined {
    if (request.phase !== 'action') return undefined
    const continuation = this.continuation
    const state = this.session.getState()
    if (
      !continuation ||
      state.phase !== 'turns' ||
      state.activePlayerId !== this.session.remoteParticipantId ||
      state.turnNumber !== continuation.turn ||
      state.revision !== request.expectedRevision
    )
      return undefined
    if (continuation.nextIndex === 0) {
      if (request.expectedRevision !== continuation.expectedRevision) return undefined
    } else if (state.revision <= continuation.expectedRevision) {
      return undefined
    }
    return continuation.actions[continuation.nextIndex]
  }

  private takePlanCommit(request: AiDecisionRequest): AiDecisionResponse | null {
    const cached = this.planCommit
    this.planCommit = null
    if (!cached || request.phase !== 'action') return null

    const state = this.session.getState()
    if (
      cached.matchId !== request.matchId ||
      cached.turn !== state.turnNumber ||
      cached.revision !== request.expectedRevision ||
      state.revision !== request.expectedRevision ||
      state.phase !== 'turns' ||
      state.activePlayerId !== this.session.remoteParticipantId ||
      cached.response.matchId !== request.matchId ||
      cached.response.expectedRevision !== request.expectedRevision ||
      !('plan' in cached.response.choice)
    )
      return null

    const selectedActionId = cached.response.choice.plan.firstActionId
    if (!request.actionIds.includes(selectedActionId)) return null
    const selectedAction = this.currentLegalActions().find(
      (action) => action.id === selectedActionId
    )
    if (!selectedAction) return null

    const response: AiDecisionResponse = {
      ...cached.response,
      matchId: request.matchId,
      requestId: request.requestId,
      expectedRevision: request.expectedRevision,
      choice: {
        actionId: selectedAction.id,
        intent: aiActionIntent(selectedAction.command, this.session.localParticipantId),
        expectedResult: cached.response.reason,
        planUpdate: null
      },
      durationMs: 0,
      finishReason: 'expert-plan-commit-cache'
    }
    this.rememberContinuation(request, response)
    return response
  }

  private takeApplicableContinuation(
    request: AiDecisionRequest
  ): AiDecisionResponse | null {
    const continuation = this.continuation
    if (
      request.phase !== 'action' ||
      !continuation ||
      continuation.nextIndex === 0 ||
      !this.preferredContinuation(request)
    )
      return null

    const plannedIntent = continuation.actions[continuation.nextIndex]
    if (!plannedIntent) return null
    const selectedAction = this.currentLegalActions().find(
      (action) =>
        request.actionIds.includes(action.id) &&
        sameAiIntent(
          plannedIntent,
          aiActionIntent(action.command, this.session.localParticipantId)
        )
    )
    if (!selectedAction) return null

    const remainingLine = continuation.actions.slice(
      continuation.nextIndex,
      continuation.nextIndex + 6
    )
    const response: AiDecisionResponse = {
      matchId: request.matchId,
      requestId: request.requestId,
      expectedRevision: request.expectedRevision,
      modelId: 'hardware-local-v2',
      reason: 'Continue the still-legal selected line after the search budget expires.',
      choice: {
        actionId: selectedAction.id,
        intent: aiActionIntent(selectedAction.command, this.session.localParticipantId),
        expectedResult:
          'Continue the previously searched line while its next step remains legal.',
        planUpdate: null
      },
      durationMs: 0,
      finishReason: 'expert-continuation-fallback',
      usage: {
        mode: 'expert-continuation-fallback',
        plannedActionIntents: remainingLine.map((intent) => ({
          type: intent.type,
          source: intent.source,
          targets: [...intent.targets],
          position: intent.position,
          option: intent.option
        }))
      }
    }
    this.rememberContinuation(request, response)
    return response
  }

  private currentLegalActions() {
    const legal = enumerateLegalCommands(
      {
        getState: () => this.session.getState(),
        getPlayInput: (participantId, cardInstanceId, choice) =>
          this.session.match.getPlayInput!(participantId, cardInstanceId, choice),
        getLegality: (participantId) => this.session.match.getLegality!(participantId)
      },
      this.session.remoteParticipantId
    )
    return aiActions(this.session, legal)
  }

  private rememberPlanCommit(
    request: AiDecisionRequest,
    response: AiDecisionResponse
  ): void {
    this.planCommit = null
    if (
      request.phase !== 'plan' ||
      response.matchId !== request.matchId ||
      response.requestId !== request.requestId ||
      response.expectedRevision !== request.expectedRevision ||
      !('plan' in response.choice)
    )
      return

    const state = this.session.getState()
    const actionId = response.choice.plan.firstActionId
    if (
      state.phase !== 'turns' ||
      state.activePlayerId !== this.session.remoteParticipantId ||
      state.revision !== request.expectedRevision ||
      !request.actionIds.includes(actionId)
    )
      return

    if (!this.currentLegalActions().some((action) => action.id === actionId)) return

    this.planCommit = {
      matchId: request.matchId,
      turn: state.turnNumber,
      revision: request.expectedRevision,
      response
    }
  }

  private rememberContinuation(
    request: AiDecisionRequest,
    response: AiDecisionResponse
  ): void {
    this.continuation = null
    if (request.phase !== 'plan' && request.phase !== 'action') return
    const state = this.session.getState()
    if (
      state.phase !== 'turns' ||
      state.activePlayerId !== this.session.remoteParticipantId ||
      state.revision !== request.expectedRevision
    )
      return

    const rawIntents = response.usage?.plannedActionIntents
    if (
      !Array.isArray(rawIntents) ||
      rawIntents.length === 0 ||
      rawIntents.length > 6 ||
      !rawIntents.every(isAiActionIntent)
    )
      return

    const selectedActionId =
      request.phase === 'plan' && 'plan' in response.choice
        ? response.choice.plan.firstActionId
        : request.phase === 'action' && 'actionId' in response.choice
          ? response.choice.actionId
          : null
    if (!selectedActionId || !request.actionIds.includes(selectedActionId)) return

    const selectedAction = this.currentLegalActions().find(
      (action) => action.id === selectedActionId
    )
    if (!selectedAction) return
    const selectedIntent = aiActionIntent(
      selectedAction.command,
      this.session.localParticipantId
    )
    if (!sameAiIntent(rawIntents[0]!, selectedIntent)) return

    this.continuation = {
      turn: state.turnNumber,
      expectedRevision: request.expectedRevision,
      nextIndex: request.phase === 'plan' ? 0 : 1,
      actions: rawIntents
    }
  }

  private observeTurn(state: ReturnType<GameBoardSession['getState']>): void {
    if (
      state.phase !== 'turns' ||
      state.activePlayerId !== this.session.remoteParticipantId
    ) {
      this.activeTurn = null
      this.continuation = null
      this.planCommit = null
      return
    }
    if (this.activeTurn === state.turnNumber) return
    this.activeTurn = state.turnNumber
    this.turnStartedAt = this.now()
    this.searchUsedMs = 0
    this.continuation = null
    this.planCommit = null
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker
    const worker = this.workerFactory()
    worker.addEventListener('message', this.handleMessage)
    worker.addEventListener('error', this.handleWorkerError)
    this.worker = worker
    return worker
  }

  private readonly handleMessage = (
    event: MessageEvent<ExpertAiWorkerResponse>
  ): void => {
    const response = event.data
    const pending = this.takePending(response.requestId)
    if (!pending) return
    if (response.type === 'decision') {
      this.rememberPlanCommit(pending.request, response.response)
      this.rememberContinuation(pending.request, response.response)
      pending.resolve(response.response)
    } else {
      const continuedAction = this.takeApplicableContinuation(pending.request)
      if (continuedAction) pending.resolve(continuedAction)
      else pending.reject(new Error(response.error))
    }
  }

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    if (event.currentTarget !== this.worker) return
    const error = new Error(event.message || 'Expert AI worker failed.')
    this.worker?.terminate()
    this.worker = null
    for (const requestId of [...this.pending.keys()]) {
      const pending = this.takePending(requestId)
      if (!pending) continue
      const continuedAction = this.takeApplicableContinuation(pending.request)
      if (continuedAction) pending.resolve(continuedAction)
      else pending.reject(error)
    }
  }

  private takePending(requestId: string): PendingDecision | undefined {
    const pending = this.pending.get(requestId)
    if (!pending) return undefined
    clearTimeout(pending.timer)
    this.pending.delete(requestId)
    if (pending.request.phase !== 'mulligan') {
      this.searchUsedMs += Math.max(0, this.now() - pending.startedAt)
    }
    return pending
  }
}
