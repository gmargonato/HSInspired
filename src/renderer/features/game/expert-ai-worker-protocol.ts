import type {
  AiDecisionIdentity,
  AiDecisionRequest,
  AiDecisionResponse
} from '../../../shared/ipc/ai'
import type { AiActionIntent } from '../../../shared/ipc/ai-deliberation'
import type { OpeningMatchCheckpoint } from '../../../game/match/opening-match-types'
import type { PlayerId } from '../../../game/match/match-types'
import type { ExpertDeckStrategyBinding } from '../../../game/decks/expert-deck-strategy'

export const EXPERT_AI_POLICY_REVISION = 'expert-tactics-1'
export const EXPERT_AI_TURN_BUDGET_MS = 60_000
export const EXPERT_AI_PRESENTATION_RESERVE_MS = 5_000
export const EXPERT_AI_DISPATCH_RESERVE_MS = 500
export const EXPERT_AI_REPLAN_RESERVE_MS = 8_000
export const EXPERT_AI_PLAN_SEARCH_LIMIT_MS = 30_000
export const EXPERT_AI_SEARCH_BUDGET_MS =
  EXPERT_AI_TURN_BUDGET_MS -
  EXPERT_AI_PRESENTATION_RESERVE_MS -
  EXPERT_AI_DISPATCH_RESERVE_MS
/**
 * Keep one slow decision from consuming the full turn search allowance, so a
 * later observation can still get a bounded replan before the final reserves.
 */
export const EXPERT_AI_DECISION_SEARCH_BUDGET_MS =
  EXPERT_AI_SEARCH_BUDGET_MS - EXPERT_AI_REPLAN_RESERVE_MS

export interface ExpertAiBudget {
  readonly turnBudgetMs: number
  readonly searchBudgetMs: number
  readonly decisionSearchBudgetMs: number
  readonly planSearchLimitMs: number
  readonly replanSearchLimitMs: number
}

export const EXPERT_AI_DEFAULT_BUDGET: ExpertAiBudget = {
  turnBudgetMs: EXPERT_AI_TURN_BUDGET_MS,
  searchBudgetMs: EXPERT_AI_SEARCH_BUDGET_MS,
  decisionSearchBudgetMs: EXPERT_AI_DECISION_SEARCH_BUDGET_MS,
  planSearchLimitMs: EXPERT_AI_PLAN_SEARCH_LIMIT_MS,
  replanSearchLimitMs: 4_000
}

/** Used by the headless benchmark to allocate search limits for a turn budget. */
export function expertAiBudgetForTurn(turnBudgetMs: number): ExpertAiBudget {
  const searchBudgetMs =
    turnBudgetMs - EXPERT_AI_PRESENTATION_RESERVE_MS - EXPERT_AI_DISPATCH_RESERVE_MS
  if (
    !Number.isSafeInteger(turnBudgetMs) ||
    turnBudgetMs <=
      EXPERT_AI_PRESENTATION_RESERVE_MS + EXPERT_AI_DISPATCH_RESERVE_MS + 1_500
  )
    throw new RangeError('Expert AI turn budget is too small for a replan reserve.')
  const decisionSearchBudgetMs =
    searchBudgetMs - Math.min(EXPERT_AI_REPLAN_RESERVE_MS, searchBudgetMs / 3)
  return {
    turnBudgetMs,
    searchBudgetMs,
    decisionSearchBudgetMs,
    planSearchLimitMs:
      turnBudgetMs <= 10_000
        ? 2_000
        : turnBudgetMs <= 15_000
          ? 3_500
          : Math.min(EXPERT_AI_PLAN_SEARCH_LIMIT_MS, decisionSearchBudgetMs),
    replanSearchLimitMs:
      turnBudgetMs <= 10_000 ? 1_000 : turnBudgetMs <= 15_000 ? 1_500 : 4_000
  }
}

export type ExpertAiWorkerRequest =
  | {
      readonly type: 'decide'
      readonly request: AiDecisionRequest
      /** Already redacted in the renderer; never send the live checkpoint to this worker. */
      readonly checkpoint: OpeningMatchCheckpoint
      readonly perspectivePlayerId: PlayerId
      readonly deckStrategy?: ExpertDeckStrategyBinding
      readonly seed: number
      /** Remaining cumulative search allowance; the renderer owns the turn reserve. */
      readonly remainingSearchBudgetMs: number
      readonly planSearchLimitMs?: number
      readonly replanSearchLimitMs?: number
      /** A previously selected next step, advisory only and matched against legal actions. */
      readonly preferredContinuation?: AiActionIntent
    }
  | { readonly type: 'cancel'; readonly identity: AiDecisionIdentity }

export type ExpertAiWorkerResponse =
  | {
      readonly type: 'progress'
      readonly requestId: string
      readonly response: AiDecisionResponse
      readonly recommendationValue: number
      readonly worldIndex: number
      readonly iterations: number
    }
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
