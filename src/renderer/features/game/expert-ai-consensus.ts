import type { AiDecisionResponse } from '../../../shared/ipc/ai'
import type { AiDecisionChoice } from '../../../shared/ipc/ai-deliberation'
import type {
  LocalAiCandidateTrace,
  LocalAiDecisionTrace
} from './local-ai-decision-api'
import { mctsRootRecommendationScore } from '../../../game/match/ai/information-set-mcts'

export interface ExpertCandidateTrace extends LocalAiCandidateTrace {
  readonly sequence?: readonly string[]
}

export interface ExpertCandidateScore {
  score: number
  votes: number
  samples: number
  visits: number
  trace?: ExpertCandidateTrace
}

export interface ExpertEvaluatedWorld {
  readonly response: AiDecisionResponse
  readonly trace: LocalAiDecisionTrace | null
}

function actionId(choice: AiDecisionChoice): string | null {
  if ('actionId' in choice) return choice.actionId
  if ('plan' in choice) return choice.plan.firstActionId
  return null
}

export function rankExpertCandidateWorlds(
  results: readonly ExpertEvaluatedWorld[]
): Map<string, ExpertCandidateScore> {
  const scores = new Map<string, ExpertCandidateScore>()
  for (const result of results) {
    const candidates = (result.trace?.candidates ?? []).filter(
      (candidate) => candidate.accepted
    )
    for (const candidate of candidates) {
      const score = scores.get(candidate.actionId) ?? {
        score: 0,
        votes: 0,
        samples: 0,
        visits: 0
      }
      const visits = candidate.visits ?? 0
      const meanValue = candidate.meanValue ?? candidate.score
      const recommendation =
        visits > 0
          ? (candidate.recommendationValue ??
              mctsRootRecommendationScore({ visits, meanValue })) -
            (candidate.recommendationRiskAdjustment ?? 0) -
            (candidate.recommendationPreferenceAdjustment ?? 0) -
            (candidate.recommendationTacticalPenalty ?? 0)
          : meanValue
      score.score += recommendation
      score.samples++
      score.visits += visits
      score.trace =
        candidate.actionId === result.trace?.chosenActionId &&
        result.trace.chosenSequence?.length
          ? { ...candidate, sequence: result.trace.chosenSequence }
          : candidate
      scores.set(candidate.actionId, score)
    }

    const chosenId = actionId(result.response.choice)
    if (chosenId) {
      const score = scores.get(chosenId) ?? {
        score: 0,
        votes: 0,
        samples: 0,
        visits: 0
      }
      score.votes++
      scores.set(chosenId, score)
    }
  }
  return scores
}

export function chooseExpertConsensus(
  results: readonly ExpertEvaluatedWorld[],
  legalActionIds: readonly string[]
): {
  readonly actionId: string | null
  readonly scores: Map<string, ExpertCandidateScore>
} {
  const scores = rankExpertCandidateWorlds(results)
  const preferredId =
    [...scores.entries()].sort(
      ([leftId, left], [rightId, right]) =>
        right.score / Math.max(1, right.samples) -
          left.score / Math.max(1, left.samples) ||
        right.votes - left.votes ||
        leftId.localeCompare(rightId)
    )[0]?.[0] ?? null
  const legalIds = new Set(legalActionIds)
  const firstChoiceId = results[0] ? actionId(results[0].response.choice) : null
  return {
    actionId:
      (preferredId && legalIds.has(preferredId) ? preferredId : null) ??
      (firstChoiceId && legalIds.has(firstChoiceId) ? firstChoiceId : null) ??
      legalActionIds[0] ??
      null,
    scores
  }
}
