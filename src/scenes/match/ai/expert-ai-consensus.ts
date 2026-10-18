import type { AiDecisionResponse } from '../../../desktop/contracts/ipc/ai'
import {
  sameAiIntent,
  type AiDecisionChoice
} from '../../../desktop/contracts/ipc/ai-deliberation'
import type {
  LocalAiCandidateTrace,
  LocalAiDecisionTrace
} from './local-ai-decision-api'
import { mctsRootRecommendationScore } from '../../../game-rules/match/ai/information-set-mcts'

export interface ExpertCandidateTrace extends LocalAiCandidateTrace {
  readonly sequence?: readonly string[]
  readonly reconsiderAfterPrefix?: number
}

export interface ExpertCandidateScore {
  publicSurvivalPreference?: boolean
  publicAttackSurvival?: boolean
  provenWin?: boolean
  provenLoss?: boolean
  publicLethal?: boolean
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

function safetyRank(candidate: ExpertCandidateTrace): number {
  if (candidate.provenWin) return 0
  if (candidate.outcome === 'loss') return 3
  if (candidate.publicReply === 'lethal') return 2
  return candidate.publicAttackSurvival ||
    (candidate.publicAttackThreat &&
      candidate.publicReply === 'clear' &&
      candidate.sequenceIntents?.at(-1)?.type === 'end-turn')
    ? 0.5
    : 1
}

export function rankExpertCandidateWorlds(
  results: readonly ExpertEvaluatedWorld[]
): Map<string, ExpertCandidateScore> {
  const scores = new Map<string, ExpertCandidateScore>()
  // A stronger disproof in another world defeats the certificate only for the
  // same exact completion. Different suffixes of a root remain independent.
  const contradicted = new Set<string>()
  const completionKey = (candidate: LocalAiCandidateTrace) =>
    JSON.stringify([candidate.actionId, candidate.sequenceIntents])
  for (const result of results)
    for (const candidate of result.trace?.candidates ?? [])
      if (
        candidate.accepted &&
        candidate.sequenceIntents?.length &&
        (candidate.outcome === 'loss' || candidate.publicReply === 'lethal')
      )
        contradicted.add(completionKey(candidate))
  for (const result of results) {
    const candidates = (result.trace?.candidates ?? []).filter(
      (candidate) => candidate.accepted
    )
    for (const rawCandidate of candidates) {
      const candidate =
        (rawCandidate.publicAttackSurvival || rawCandidate.publicAttackThreat) &&
        contradicted.has(completionKey(rawCandidate))
          ? { ...rawCandidate, publicAttackSurvival: false, publicAttackThreat: false }
          : rawCandidate
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
      score.provenWin ||= candidate.provenWin === true
      score.publicAttackSurvival ||=
        candidate.publicAttackSurvival === true &&
        candidate.outcome !== 'loss' &&
        candidate.publicReply !== 'lethal'
      score.publicSurvivalPreference ||= safetyRank(candidate) === 0.5
      // Different worlds may find different continuations for the same root.
      // Keep a safer continuation instead of treating one bad line as inevitable.
      score.provenLoss =
        (score.samples === 0 || score.provenLoss === true) &&
        candidate.outcome === 'loss'
      score.publicLethal =
        (score.samples === 0 || score.publicLethal === true) &&
        (candidate.publicReply === 'lethal' || candidate.outcome === 'loss')
      score.score += candidate.provenWin ? 1 : recommendation
      score.samples++
      score.visits += visits
      if (!score.trace || safetyRank(candidate) <= safetyRank(score.trace))
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

  for (const [chosenId, score] of scores) {
    const representative = score.trace
    const line = representative?.sequenceIntents
    if (!representative || safetyRank(representative) !== 1 || !line || line.length < 2)
      continue
    const endorsingCandidates = results.flatMap((result) => {
      if (actionId(result.response.choice) !== chosenId) return []
      const candidate = result.trace?.candidates.find(
        (entry) => entry.accepted && entry.actionId === chosenId
      )
      return candidate &&
        safetyRank(candidate) === 1 &&
        candidate.sequenceIntents?.length
        ? [candidate]
        : []
    })
    const endorsingLines = endorsingCandidates.map(
      (candidate) => candidate.sequenceIntents!
    )
    if (
      endorsingLines.length < 2 ||
      endorsingLines.some(
        (endorsed) =>
          endorsed.length >= line.length &&
          line.every((intent, index) => sameAiIntent(intent, endorsed[index]!))
      )
    )
      continue

    // Two worlds can select a root while the last equally safe, dissenting
    // world supplies an unrelated follow-up. Request reconsideration after
    // their shared exact prefix, retaining the old line as a timeout backup.
    // Root scores, supported continuations and stronger safety proofs stay intact.
    const prefixLength = line.findIndex((intent, index) =>
      endorsingLines.some(
        (endorsed) => !endorsed[index] || !sameAiIntent(intent, endorsed[index]!)
      )
    )
    // A played card or hero power may already have paid for the selected
    // payoff. Preserve those setup commitments even when worlds disagree.
    if (
      prefixLength < 1 ||
      line.slice(0, prefixLength).some((intent) => intent.type !== 'attack-character')
    )
      continue
    score.trace = {
      ...representative,
      reconsiderAfterPrefix: prefixLength
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
        Number(right.provenWin === true) - Number(left.provenWin === true) ||
        Number(left.provenLoss === true) - Number(right.provenLoss === true) ||
        Number(right.publicSurvivalPreference === true) -
          Number(left.publicSurvivalPreference === true) ||
        Number(left.publicLethal === true) - Number(right.publicLethal === true) ||
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
