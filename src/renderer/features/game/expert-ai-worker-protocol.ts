import type {
  AiDecisionIdentity,
  AiDecisionRequest,
  AiDecisionResponse
} from '../../../shared/ipc/ai'
import type { AiActionIntent } from '../../../shared/ipc/ai-deliberation'
import type { OpeningMatchCheckpoint } from '../../../game/match/opening-match-types'
import type { PlayerId } from '../../../game/match/match-types'

export const EXPERT_AI_TURN_BUDGET_MS = 10_000
export const EXPERT_AI_PRESENTATION_RESERVE_MS = 2_000
export const EXPERT_AI_DISPATCH_RESERVE_MS = 500
export const EXPERT_AI_SEARCH_BUDGET_MS =
  EXPERT_AI_TURN_BUDGET_MS -
  EXPERT_AI_PRESENTATION_RESERVE_MS -
  EXPERT_AI_DISPATCH_RESERVE_MS
/**
 * Keep one slow decision from consuming the full turn search allowance, so a
 * later observation can still get a bounded replan before the final reserves.
 */
export const EXPERT_AI_DECISION_SEARCH_BUDGET_MS = 6_000

export type ExpertAiWorkerRequest =
  | {
      readonly type: 'decide'
      readonly request: AiDecisionRequest
      /** Already redacted in the renderer; never send the live checkpoint to this worker. */
      readonly checkpoint: OpeningMatchCheckpoint
      readonly perspectivePlayerId: PlayerId
      readonly seed: number
      /** Remaining cumulative search allowance; the renderer owns the turn reserve. */
      readonly remainingSearchBudgetMs: number
      /** A previously selected next step, advisory only and matched against legal actions. */
      readonly preferredContinuation?: AiActionIntent
    }
  | { readonly type: 'cancel'; readonly identity: AiDecisionIdentity }

export type ExpertAiWorkerResponse =
  | {
      readonly type: 'decision'
      readonly requestId: string
      readonly response: AiDecisionResponse
    }
  | {
      readonly type: 'failure'
      readonly requestId: string
      readonly error: string
    }
