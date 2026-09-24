import type { AiDecisionResponse } from '../../../shared/ipc/ai'
import type { AiDecisionChoice } from '../../../shared/ipc/ai-deliberation'
import { aiActionIntent } from './ai-action-intent'
import {
  chooseExpertConsensus,
  type ExpertCandidateTrace,
  type ExpertEvaluatedWorld
} from './expert-ai-consensus'
import { EXPERT_AI_SEARCH_BUDGET_MS } from './expert-ai-worker-protocol'
import {
  cancelExpertAiWorlds,
  evaluateExpertAiWorldInWorker
} from './expert-ai-world-pool'
import {
  evaluateExpertAiWorld,
  type ExpertAiWorldEvaluation,
  type ExpertWorldAction,
  type ExpertWorldRequest
} from './expert-ai-world-runner'
import { LocalAiDecisionApi } from './local-ai-decision-api'
import type {
  ExpertAiWorkerRequest,
  ExpertAiWorkerResponse
} from './expert-ai-worker-protocol'

interface WorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<ExpertAiWorkerRequest>) => void
  ): void
  postMessage(message: ExpertAiWorkerResponse): void
}

type LocalAction = ExpertWorldAction

const workerScope =
  typeof self === 'undefined' ? null : (self as unknown as WorkerScope)
const cancelled = new Set<string>()
const activeSearches = new Map<string, LocalAiDecisionApi[]>()

function sequenceFor(candidate: ExpertCandidateTrace | undefined): readonly string[] {
  const sequence = candidate?.sequence?.slice(0, 6)
  return sequence?.length
    ? sequence
    : [candidate?.description ?? 'Take the selected legal action.']
}

function aggregateResponse(
  request: Extract<ExpertAiWorkerRequest, { readonly type: 'decide' }>,
  results: readonly ExpertEvaluatedWorld[],
  actions: Map<string, LocalAction>,
  opponentPlayerId: string,
  elapsedMs: number
): AiDecisionResponse {
  const first = results[0]?.response
  if (!first) throw new Error('Expert search did not complete a fair hypothesis.')

  if (request.request.phase === 'mulligan')
    return {
      ...first,
      durationMs: elapsedMs,
      usage: { mode: 'expert-sampled-search', worldsEvaluated: results.length }
    }

  const { actionId: selectedId, scores } = chooseExpertConsensus(results, [
    ...actions.keys()
  ])
  if (!selectedId) throw new Error('Expert search did not find a legal action.')

  const candidate = scores.get(selectedId)?.trace
  const selectedAction = actions.get(selectedId)
  if (!selectedAction) throw new Error('Expert search lost the selected legal action.')
  const reason = candidate?.description ?? selectedAction.description ?? first.reason
  const plannedActionIntents = (
    candidate?.sequenceIntents ?? [
      aiActionIntent(selectedAction.command, opponentPlayerId)
    ]
  ).slice(0, 6)

  let choice: AiDecisionChoice
  if (request.request.phase === 'plan') {
    choice = {
      plan: {
        objective: reason,
        winCheck:
          'Take a win when the engine proves one; otherwise improve the position.',
        lossRisk:
          'Recheck visible damage and keep the hero alive through the public response.',
        candidates: [
          {
            sequence: sequenceFor(candidate),
            budget: 'Replan after each action and any newly revealed result.',
            endPosition: 'Keep the best state reached before passing the turn.',
            opponentReply:
              'Compare the opponent responses across public-information samples.'
          }
        ],
        preferred: 0,
        firstActionId: selectedId,
        checks: []
      }
    }
  } else {
    choice = {
      actionId: selectedId,
      intent: aiActionIntent(selectedAction.command, opponentPlayerId),
      expectedResult: reason,
      planUpdate: null
    }
  }

  return {
    matchId: request.request.matchId,
    requestId: request.request.requestId,
    expectedRevision: request.request.expectedRevision,
    modelId: 'hardware-local-v2',
    reason: reason.slice(0, 580),
    choice,
    durationMs: elapsedMs,
    finishReason: 'expert-sampled-search',
    usage: {
      mode: 'expert-sampled-search',
      worldsEvaluated: results.length,
      plannedActionIntents: plannedActionIntents.map((intent) => ({
        type: intent.type,
        source: intent.source,
        targets: [...intent.targets],
        position: intent.position,
        option: intent.option
      })),
      candidateConsensus: [...scores.entries()]
        .sort(
          (left, right) =>
            right[1].score / Math.max(1, right[1].samples) -
              left[1].score / Math.max(1, left[1].samples) ||
            right[1].votes - left[1].votes
        )
        .slice(0, 8)
        .map(([candidateId, score]) => ({
          candidateId,
          votes: score.votes,
          expectedValue: score.score / Math.max(1, score.samples),
          sampledWorlds: score.samples
        }))
    }
  }
}

export async function runExpertAiWorkerDecision(
  request: Extract<ExpertAiWorkerRequest, { readonly type: 'decide' }>,
  hooks: {
    readonly isCancelled?: () => boolean
    readonly onApiCreated?: (api: LocalAiDecisionApi) => void
    readonly evaluateWorld?: (
      request: ExpertWorldRequest,
      worldIndex: number,
      budgetMs: number
    ) => Promise<ExpertAiWorldEvaluation | null>
    readonly onWorldCompleted?: (
      response: AiDecisionResponse,
      trace: ReturnType<LocalAiDecisionApi['getLastTrace']>
    ) => void
  } = {}
): Promise<AiDecisionResponse | null> {
  const started = performance.now()
  const isCancelled = hooks.isCancelled ?? (() => false)
  const searchBudgetMs = Math.max(
    0,
    Math.min(EXPERT_AI_SEARCH_BUDGET_MS, request.remainingSearchBudgetMs)
  )
  if (searchBudgetMs <= 0)
    throw new Error('Expert AI has no remaining turn search budget.')
  const worldCount = Math.max(
    1,
    Math.min(3, Math.floor(Math.max(0, searchBudgetMs - 1_000) / 5_000) + 1)
  )
  const worldBudgetMs = searchBudgetMs / worldCount
  const runInlineWorld = (index: number) =>
    evaluateExpertAiWorld(request, index, worldBudgetMs, {
      isCancelled,
      ...(hooks.onApiCreated ? { onApiCreated: hooks.onApiCreated } : {})
    })
  let worldResults: (ExpertAiWorldEvaluation | null)[]
  if (hooks.evaluateWorld) {
    const attempts = await Promise.all(
      Array.from({ length: worldCount }, async (_, index) => {
        if (isCancelled()) return { result: null } as const
        try {
          return {
            result: await hooks.evaluateWorld!(request, index, worldBudgetMs)
          } as const
        } catch (error) {
          return { error } as const
        }
      })
    )
    if (isCancelled()) return null
    worldResults = []
    for (let index = 0; index < attempts.length; index++) {
      const attempt = attempts[index]!
      if ('error' in attempt || attempt.result === null)
        worldResults.push(await runInlineWorld(index))
      else worldResults.push(attempt.result)
    }
  } else {
    worldResults = []
    for (let index = 0; index < worldCount; index++) {
      if (isCancelled()) return null
      worldResults.push(await runInlineWorld(index))
    }
  }
  if (isCancelled() || worldResults.some((result) => result === null)) return null
  const completedWorlds = worldResults as ExpertAiWorldEvaluation[]
  const results = completedWorlds.map((result) => result.evaluation)
  const actions = new Map<string, LocalAction>(
    completedWorlds[0]!.actions.map((action) => [action.id, action])
  )
  for (const result of results) hooks.onWorldCompleted?.(result.response, result.trace)

  const opponentPlayerId = request.checkpoint.setup.participants.find(
    (participant) => participant.participantId !== request.perspectivePlayerId
  )?.participantId
  if (!opponentPlayerId)
    throw new Error('Expert AI checkpoint is missing its public opponent.')
  return aggregateResponse(
    request,
    results,
    actions,
    opponentPlayerId,
    performance.now() - started
  )
}

async function decide(
  request: Extract<ExpertAiWorkerRequest, { readonly type: 'decide' }>
): Promise<void> {
  const requestId = request.request.requestId
  const apis: LocalAiDecisionApi[] = []
  activeSearches.set(requestId, apis)
  cancelled.delete(requestId)
  try {
    const response = await runExpertAiWorkerDecision(request, {
      isCancelled: () => cancelled.has(requestId),
      onApiCreated: (api) => apis.push(api),
      evaluateWorld: (worldRequest, worldIndex, budgetMs) =>
        evaluateExpertAiWorldInWorker(worldRequest, worldIndex, budgetMs)
    })
    if (!response || cancelled.has(requestId)) return
    workerScope?.postMessage({ type: 'decision', requestId, response })
  } catch (error) {
    if (!cancelled.has(requestId))
      workerScope?.postMessage({
        type: 'failure',
        requestId,
        error: error instanceof Error ? error.message : String(error)
      })
  } finally {
    activeSearches.delete(requestId)
    cancelled.delete(requestId)
  }
}

if (workerScope) {
  workerScope.addEventListener('message', (event) => {
    const request = event.data
    if (request.type === 'cancel') {
      const requestId = request.identity.requestId
      cancelled.add(requestId)
      cancelExpertAiWorlds(requestId)
      for (const api of activeSearches.get(requestId) ?? [])
        void api.cancel(request.identity)
      return
    }
    void decide(request)
  })
}
