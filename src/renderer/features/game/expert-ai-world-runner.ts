import { enumerateLegalCommands } from '../../../game/match/ai'
import { createFairHypothesisCheckpoint } from '../../../game/match/ai/fair-hypothesis-checkpoint'
import type { AiDecisionResponse } from '../../../shared/ipc/ai'
import { type ExpertEvaluatedWorld } from './expert-ai-consensus'
import type { ExpertAiWorkerRequest } from './expert-ai-worker-protocol'
import { GameBoardSession } from './game-board-session'
import { LocalAiDecisionApi } from './local-ai-decision-api'
import { aiActions } from './ai-context'

export type ExpertWorldRequest = Extract<
  ExpertAiWorkerRequest,
  { readonly type: 'decide' }
>
export type ExpertWorldAction = ReturnType<typeof aiActions>[number]

export interface ExpertAiWorldEvaluation {
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
    }
  | { readonly type: 'cancel'; readonly taskId: string }

export type ExpertAiWorldWorkerResponse =
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
    readonly isCancelled?: () => boolean
    readonly onApiCreated?: (api: LocalAiDecisionApi) => void
  } = {}
): Promise<ExpertAiWorldEvaluation | null> {
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
  const api = new LocalAiDecisionApi(session, undefined, {
    profile: 'expert',
    budgetMs,
    fairHypothesis: true,
    expertPlanSearchLimitMs: request.planSearchLimitMs,
    expertReplanSearchLimitMs: request.replanSearchLimitMs,
    ...(request.preferredContinuation
      ? { preferredContinuation: request.preferredContinuation }
      : {})
  })
  hooks.onApiCreated?.(api)
  const response: AiDecisionResponse = await api.decide(request.request)
  if (isCancelled()) return null

  const actions =
    worldIndex === 0
      ? aiActions(
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
      : []
  return {
    evaluation: { response, trace: api.getLastTrace() },
    actions
  }
}
