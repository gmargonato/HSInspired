import { enumerateLegalCommands } from '../../../game-rules/match/ai'
import { createFairHypothesisCheckpoint } from '../../../game-rules/match/ai/fair-hypothesis-checkpoint'
import type { AiDecisionResponse } from '../../../desktop/contracts/ipc/ai'
import { aiActionIntent } from './ai-action-intent'
import { type ExpertEvaluatedWorld } from './expert-ai-consensus'
import type { ExpertAiWorkerRequest } from './expert-ai-worker-protocol'
import { GameBoardSession } from '../game-board-session'
import { LocalAiDecisionApi, type LocalAiSearchProgress } from './local-ai-decision-api'
import { aiActions } from './ai-context'

export type ExpertWorldRequest = Extract<
  ExpertAiWorkerRequest,
  { readonly type: 'decide' }
>
export type ExpertWorldAction = ReturnType<typeof aiActions>[number]

export interface ExpertAiWorldEvaluation {
  readonly worldIndex?: number
  readonly status?: 'completed' | 'partial'
  readonly evaluation: ExpertEvaluatedWorld
  readonly actions: readonly ExpertWorldAction[]
}

export type ExpertAiWorldWorkerRequest =
  | {
      readonly type: 'evaluate'
      readonly taskId: string
      readonly request: ExpertWorldRequest
      readonly worldIndex: number
      readonly budgetMs: number
      /** Shared wall deadline includes module startup and queue time. */
      readonly deadlineEpochMs?: number
    }
  | { readonly type: 'cancel'; readonly taskId: string }

export type ExpertAiWorldWorkerResponse =
  | {
      readonly type: 'progress'
      readonly taskId: string
      readonly response: AiDecisionResponse
      readonly recommendationValue: number
      readonly iterations: number
    }
  | {
      readonly type: 'result'
      readonly taskId: string
      readonly result: ExpertAiWorldEvaluation
    }
  | { readonly type: 'cancelled'; readonly taskId: string }
  | { readonly type: 'failure'; readonly taskId: string; readonly error: string }

function nextWorldSeed(seed: number, index: number): number {
  return (seed + Math.imul(index + 1, 0x9e3779b9)) >>> 0
}

export async function evaluateExpertAiWorld(
  request: ExpertWorldRequest,
  worldIndex: number,
  budgetMs: number,
  hooks: {
    /** Optional deterministic search cap for headless validation. */
    readonly workBudget?: number
    readonly isCancelled?: () => boolean
    readonly onApiCreated?: (api: LocalAiDecisionApi) => void
    readonly onProgress?: (
      response: AiDecisionResponse,
      recommendationValue: number,
      iterations: number
    ) => void
  } = {}
): Promise<ExpertAiWorldEvaluation | null> {
  const startedAt = performance.now()
  const isCancelled = hooks.isCancelled ?? (() => false)
  if (isCancelled()) return null
  const checkpoint = createFairHypothesisCheckpoint(
    request.checkpoint,
    request.perspectivePlayerId,
    nextWorldSeed(request.seed, worldIndex)
  )
  const session = new GameBoardSession({
    setup: checkpoint.setup,
    decks: checkpoint.decks,
    checkpoint
  })
  const searchStartedAt = performance.now()
  const api = new LocalAiDecisionApi(session, undefined, {
    profile: 'expert',
    ...(hooks.workBudget === undefined ? {} : { workBudget: hooks.workBudget }),
    budgetMs: Math.max(1, budgetMs - (performance.now() - startedAt) - 250),
    fairHypothesis: true,
    ...(request.deckStrategy?.participantId === request.perspectivePlayerId
      ? { deckStrategy: request.deckStrategy }
      : {}),
    expertPlanSearchLimitMs: request.planSearchLimitMs,
    expertReplanSearchLimitMs: request.replanSearchLimitMs,
    onSearchProgress: (progress: LocalAiSearchProgress) => {
      if (isCancelled() || !request.request.actionIds.includes(progress.actionId))
        return
      const opponentPlayerId = request.checkpoint.setup.participants.find(
        (participant) => participant.participantId !== request.perspectivePlayerId
      )?.participantId
      if (!opponentPlayerId) return
      const intent = aiActionIntent(progress.command, opponentPlayerId)
      const response: AiDecisionResponse = {
        matchId: request.request.matchId,
        requestId: request.request.requestId,
        expectedRevision: request.request.expectedRevision,
        modelId: 'hardware-local-v2',
        reason: `Current best after ${progress.iterations} search iterations: ${progress.description}.`,
        choice:
          request.request.phase === 'plan'
            ? {
                plan: {
                  objective: `Prefer ${progress.description} based on the search completed so far.`,
                  winCheck:
                    'Take an immediate win when the engine proves one; otherwise improve the position.',
                  lossRisk:
                    'Recheck visible damage and preserve enough health for the opponent turn.',
                  candidates: [
                    {
                      sequence: [progress.description],
                      budget: 'Continue evaluating the line after each public result.',
                      endPosition:
                        'Keep the best position reached before passing the turn.',
                      opponentReply:
                        'Recheck the opponent’s visible attacks before ending the turn.'
                    }
                  ],
                  preferred: 0,
                  firstActionId: progress.actionId,
                  checks: []
                }
              }
            : {
                actionId: progress.actionId,
                intent,
                expectedResult:
                  'Current best legal candidate while the search continues.',
                planUpdate: null
              },
        durationMs: performance.now() - searchStartedAt,
        finishReason: 'expert-search-progress',
        usage: {
          mode: 'expert-search-progress',
          iterations: progress.iterations,
          recommendationValue: progress.recommendationValue
        }
      }
      hooks.onProgress?.(response, progress.recommendationValue, progress.iterations)
    },
    ...(request.preferredContinuation
      ? { preferredContinuation: request.preferredContinuation }
      : {})
  })
  hooks.onApiCreated?.(api)
  const response: AiDecisionResponse = await api.decide(request.request)
  if (isCancelled()) return null

  const actions = aiActions(
    session,
    enumerateLegalCommands(
      {
        getState: () => session.getState(),
        getPlayInput: session.match.getPlayInput!,
        getLegality: session.match.getLegality!
      },
      session.remoteParticipantId
    )
  )
  return {
    worldIndex,
    status: 'completed',
    evaluation: { response, trace: api.getLastTrace() },
    actions
  }
}

/** Retain the last searched candidate if a world cannot finish finalization. */
export function partialExpertWorld(
  request: ExpertWorldRequest,
  worldIndex: number,
  response: AiDecisionResponse,
  recommendationValue: number,
  iterations: number
): ExpertAiWorldEvaluation {
  const session = new GameBoardSession({
    setup: request.checkpoint.setup,
    decks: request.checkpoint.decks,
    checkpoint: request.checkpoint
  })
  const actions = aiActions(
    session,
    enumerateLegalCommands(
      {
        getState: session.match.getState,
        getPlayInput: session.match.getPlayInput!,
        getLegality: session.match.getLegality!
      },
      request.perspectivePlayerId
    ),
    request.perspectivePlayerId
  )
  const selectedId =
    'plan' in response.choice
      ? response.choice.plan.firstActionId
      : 'actionId' in response.choice
        ? response.choice.actionId
        : null
  const action = actions.find((entry) => entry.id === selectedId)
  return {
    worldIndex,
    status: 'partial',
    actions,
    evaluation: {
      response,
      trace: action
        ? {
            requestId: request.request.requestId,
            phase: request.request.phase === 'plan' ? 'plan' : 'action',
            durationMs: 0,
            evaluatedActions: 1,
            refinedActions: 0,
            continuations: 0,
            timedOut: true,
            baseScore: null,
            visibleThreat: null,
            chosenActionId: action.id,
            sampleCount: iterations,
            candidates: [
              {
                actionId: action.id,
                type: action.command.type,
                description: action.description,
                score: recommendationValue,
                recommendationValue,
                accepted: true,
                phase: 'turns',
                winnerId: null,
                outcome: 'unknown',
                scoreComponents: {
                  positionDelta: recommendationValue,
                  commandPreference: 0,
                  continuationPreference: 0,
                  threatDefense: 0,
                  opponentBoardRemoval: 0,
                  friendlyBoardLoss: 0,
                  sequenceRefinement: 0
                }
              }
            ]
          }
        : null
    }
  }
}
