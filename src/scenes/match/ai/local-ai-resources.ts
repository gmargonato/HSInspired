import {
  EXPERT_AI_DEFAULT_BUDGET,
  expertAiBudgetForTurn,
  type ExpertAiBudget
} from './expert-ai-worker-protocol'

export type LocalAiDifficulty = 'easy' | 'expert'

/**
 * Difficulty changes only the search allowance. Both profiles use the same
 * Expert policy, fair information, deck strategy, worker and safety checks.
 * Easy is an initial resource reduction, not a calibrated strength target.
 */
export const LOCAL_AI_RESOURCE_PROFILES: Readonly<
  Record<LocalAiDifficulty, ExpertAiBudget>
> = {
  easy: expertAiBudgetForTurn(10_000),
  // Keep this exact object and its values as the production Expert baseline.
  expert: EXPERT_AI_DEFAULT_BUDGET
}
