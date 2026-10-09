import type { AiDecisionResponse } from '../../../desktop/contracts/ipc/ai'
import type { AiDecisionChoice } from '../../../desktop/contracts/ipc/ai-deliberation'
import { aiActionIntent } from './ai-action-intent'
import {
  chooseExpertConsensus,
  type ExpertCandidateTrace,
  type ExpertEvaluatedWorld
} from './expert-ai-consensus'
import {
  EXPERT_AI_PLAN_SEARCH_LIMIT_MS,
  EXPERT_AI_SEARCH_BUDGET_MS
} from './expert-ai-worker-protocol'
import { EXPERT_AI_POLICY_REVISION } from './expert-ai-worker-protocol'
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
  elapsedMs: number,
  failedWorlds: readonly string[] = [],
  worldDetails: readonly { worldIndex: number; status: string }[] = []
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
      policyRevision: EXPERT_AI_POLICY_REVISION,
      decisionPriority: candidate?.provenWin
        ? 'verified-win'
        : [...scores.values()].some((score) => score.publicLethal)
          ? 'survival'
          : 'strategy',
      worldDetails: worldDetails.map((entry) => ({ ...entry })),
      mode: 'expert-sampled-search',
      worldsEvaluated: results.length,
      ...(failedWorlds.length ? { failedWorlds: [...failedWorlds] } : {}),
      searchDiagnostics: results.map((result, worldIndex) => ({
        worldIndex: worldDetails[worldIndex]?.worldIndex ?? worldIndex,
        status: worldDetails[worldIndex]?.status ?? 'completed',
        tacticalNodes: result.trace?.tacticalNodes ?? 0,
        tacticalExhausted: result.trace?.tacticalExhausted ?? false,
        durationMs: result.trace?.durationMs ?? null,
        iterations: result.trace?.sampleCount ?? null,
        rootLegalActionCount: result.trace?.rootLegalActionCount ?? null,
        boundaryEvaluations: result.trace?.boundaryEvaluations ?? 0,
        actionOutcomes: (result.trace?.candidates ?? [])
          .filter((candidate) => candidate.actionOutcomeReason)
          .slice(0, 8)
          .map((candidate) => ({
            actionId: candidate.actionId,
            reason: candidate.actionOutcomeReason ?? null,
            penalty: candidate.recommendationTacticalPenalty ?? 0
          })),
        deckStrategyCandidates: result.trace?.deckStrategy
          ? result.trace.candidates.slice(0, 8).map((candidate) => ({
              actionId: candidate.actionId,
              visits: candidate.visits ?? 0,
              meanAdjustment: candidate.meanDeckStrategyAdjustment ?? 0
            }))
          : [],
        deckStrategy: result.trace?.deckStrategy
          ? {
              scope: 'root-position',
              profileId: result.trace.deckStrategy.profileId,
              version: result.trace.deckStrategy.version,
              adjustment: result.trace.deckStrategy.adjustment,
              safetyFactor: result.trace.deckStrategy.safetyFactor,
              features: result.trace.deckStrategy.features.map((feature) => ({
                id: feature.id,
                contribution: feature.contribution
              }))
            }
          : null
      })),
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
      budgetMs: number,
      onProgress: (
        response: AiDecisionResponse,
        recommendationValue: number,
        iterations: number
      ) => void
    ) => Promise<ExpertAiWorldEvaluation | null>
    readonly onProgress?: (
      response: AiDecisionResponse,
      recommendationValue: number,
      worldIndex: number,
      iterations: number
    ) => void
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
  // Concurrent worlds share a wall-clock window, not a divided time allowance.
  const worldBudgetMs = Math.min(
    searchBudgetMs,
    request.request.phase === 'plan'
      ? (request.planSearchLimitMs ?? EXPERT_AI_PLAN_SEARCH_LIMIT_MS)
      : request.request.phase === 'action'
        ? (request.replanSearchLimitMs ?? 4_000)
        : searchBudgetMs
  )
  const runInlineWorld = (
    index: number,
    onProgress: (
      response: AiDecisionResponse,
      recommendationValue: number,
      iterations: number
    ) => void
  ) =>
    evaluateExpertAiWorld(request, index, worldBudgetMs, {
      isCancelled,
      onProgress,
      ...(hooks.onApiCreated ? { onApiCreated: hooks.onApiCreated } : {})
    })

  const completedWorlds = new Map<number, ExpertAiWorldEvaluation>()
  const worldFailures: string[] = []
  const latestProgress = new Map<
    number,
    { response: AiDecisionResponse; recommendationValue: number; iterations: number }
  >()
  const publishBestProgress = () => {
    const best = [...latestProgress.entries()].sort(
      (left, right) =>
        right[1].recommendationValue - left[1].recommendationValue ||
        right[1].iterations - left[1].iterations ||
        left[0] - right[0]
    )[0]
    if (best)
      hooks.onProgress?.(
        best[1].response,
        best[1].recommendationValue,
        best[0],
        best[1].iterations
      )
  }
  const recordProgress = (
    worldIndex: number,
    response: AiDecisionResponse,
    recommendationValue: number,
    iterations: number
  ) => {
    if (isCancelled() || !Number.isFinite(recommendationValue)) return
    latestProgress.set(worldIndex, { response, recommendationValue, iterations })
    publishBestProgress()
  }
  const chosenActionId = (response: AiDecisionResponse): string | null =>
    'actionId' in response.choice
      ? response.choice.actionId
      : 'plan' in response.choice
        ? response.choice.plan.firstActionId
        : null
  const completedRecommendation = (result: ExpertAiWorldEvaluation): number => {
    const actionId = chosenActionId(result.evaluation.response)
    const candidate = result.evaluation.trace?.candidates.find(
      (entry) => entry.actionId === actionId
    )
    return (
      candidate?.recommendationValue ?? candidate?.meanValue ?? candidate?.score ?? 0
    )
  }
  const acceptWorld = (worldIndex: number, result: ExpertAiWorldEvaluation) => {
    completedWorlds.set(worldIndex, result)
    hooks.onWorldCompleted?.(result.evaluation.response, result.evaluation.trace)
    recordProgress(
      worldIndex,
      result.evaluation.response,
      completedRecommendation(result),
      result.evaluation.trace?.sampleCount ?? 0
    )
  }

  if (hooks.evaluateWorld) {
    await Promise.all(
      Array.from({ length: worldCount }, async (_, worldIndex) => {
        if (isCancelled()) return { result: null } as const
        try {
          const result = await hooks.evaluateWorld!(
            request,
            worldIndex,
            worldBudgetMs,
            (response, recommendationValue, iterations) =>
              recordProgress(worldIndex, response, recommendationValue, iterations)
          )
          if (result) acceptWorld(worldIndex, result)
          else if (!isCancelled())
            worldFailures.push(`world ${worldIndex + 1} returned no result`)
          return { result } as const
        } catch (error) {
          worldFailures.push(
            `world ${worldIndex + 1}: ${error instanceof Error ? error.message : String(error)}`
          )
          return { error } as const
        }
      })
    )
    if (isCancelled()) return null
  } else {
    for (let index = 0; index < worldCount; index++) {
      if (isCancelled()) return null
      const result = await runInlineWorld(index, (response, value, iterations) =>
        recordProgress(index, response, value, iterations)
      )
      if (result) acceptWorld(index, result)
      else if (!isCancelled())
        worldFailures.push(`world ${index + 1} returned no result`)
    }
  }
  if (isCancelled()) return null
  const orderedWorlds = [...completedWorlds.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, result]) => result)
  if (!orderedWorlds.length)
    throw new Error(
      worldFailures.length
        ? `Expert AI could not complete a fair hypothesis search: ${worldFailures.join('; ')}`
        : 'Expert AI could not complete any fair hypothesis search.'
    )
  const results = orderedWorlds.map((result) => result.evaluation)
  const actionWorld = orderedWorlds.find((result) => result.actions.length > 0)
  if (!actionWorld)
    throw new Error('Expert AI search did not retain its legal actions.')
  const actions = new Map<string, LocalAction>(
    actionWorld.actions.map((action) => [action.id, action])
  )

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
    performance.now() - started,
    worldFailures,
    [...completedWorlds.entries()]
      .sort(([a], [b]) => a - b)
      .map(([worldIndex, result]) => ({
        worldIndex,
        status: result.status ?? 'completed'
      }))
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
      evaluateWorld: (worldRequest, worldIndex, budgetMs, onProgress) =>
        evaluateExpertAiWorldInWorker(worldRequest, worldIndex, budgetMs, onProgress),
      onProgress: (response, recommendationValue, worldIndex, iterations) =>
        workerScope?.postMessage({
          type: 'progress',
          requestId,
          response,
          recommendationValue,
          worldIndex,
          iterations
        })
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
