import { enumerateLegalCommands } from '../../../game/match/ai'
import { createFairHypothesisCheckpoint } from '../../../game/match/ai/fair-hypothesis-checkpoint'
import type { AiDecisionResponse } from '../../../shared/ipc/ai'
import type { AiDecisionChoice } from '../../../shared/ipc/ai-deliberation'
import { aiActionIntent } from './ai-action-intent'
import { aiActions } from './ai-context'
import {
  chooseExpertConsensus,
  type ExpertCandidateTrace,
  type ExpertEvaluatedWorld
} from './expert-ai-consensus'
import { EXPERT_AI_SEARCH_BUDGET_MS } from './expert-ai-worker-protocol'
import { GameBoardSession } from './game-board-session'
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

type LocalAction = ReturnType<typeof aiActions>[number]

const workerScope =
  typeof self === 'undefined' ? null : (self as unknown as WorkerScope)
const cancelled = new Set<string>()
const activeSearches = new Map<string, LocalAiDecisionApi[]>()

function nextWorldSeed(seed: number, index: number): number {
  return (seed + Math.imul(index + 1, 0x9e3779b9)) >>> 0
}

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

async function decide(
  request: Extract<ExpertAiWorkerRequest, { readonly type: 'decide' }>
): Promise<void> {
  const requestId = request.request.requestId
  const started = performance.now()
  const apis: LocalAiDecisionApi[] = []
  activeSearches.set(requestId, apis)
  cancelled.delete(requestId)
  try {
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
    const results: ExpertEvaluatedWorld[] = []
    const actions = new Map<string, LocalAction>()
    const opponentPlayerId = request.checkpoint.setup.participants.find(
      (participant) => participant.participantId !== request.perspectivePlayerId
    )?.participantId
    if (!opponentPlayerId)
      throw new Error('Expert AI checkpoint is missing its public opponent.')

    for (let index = 0; index < worldCount; index++) {
      if (cancelled.has(requestId)) return
      const checkpoint = createFairHypothesisCheckpoint(
        request.checkpoint,
        request.perspectivePlayerId,
        nextWorldSeed(request.seed, index)
      )
      const session = new GameBoardSession({
        setup: checkpoint.setup,
        decks: checkpoint.decks,
        checkpoint
      })
      const api = new LocalAiDecisionApi(session, undefined, {
        profile: 'expert',
        budgetMs: worldBudgetMs,
        fairHypothesis: true,
        ...(request.preferredContinuation
          ? { preferredContinuation: request.preferredContinuation }
          : {})
      })
      apis.push(api)
      const response = await api.decide(request.request)
      if (cancelled.has(requestId)) return

      if (index === 0) {
        const legal = enumerateLegalCommands(
          {
            getState: () => session.getState(),
            getPlayInput: session.match.getPlayInput!,
            getLegality: session.match.getLegality!
          },
          session.remoteParticipantId
        )
        for (const action of aiActions(session, legal)) actions.set(action.id, action)
      }

      const result = { response, trace: api.getLastTrace() }
      results.push(result)
    }

    if (cancelled.has(requestId)) return
    workerScope?.postMessage({
      type: 'decision',
      requestId,
      response: aggregateResponse(
        request,
        results,
        actions,
        opponentPlayerId,
        performance.now() - started
      )
    })
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
      for (const api of activeSearches.get(requestId) ?? [])
        void api.cancel(request.identity)
      return
    }
    void decide(request)
  })
}
