import {
  mctsRootRecommendationScore,
  type MctsRootStat
} from '../../../game-rules/match/ai/information-set-mcts'
import type { TurnMatchCommand } from '../../../game-rules/match'

export interface ExpertContinuationSample {
  readonly visits: number
  readonly valueSum: number
  readonly valueSquaredSum?: number
  readonly commands: readonly TurnMatchCommand[]
}

export const EXPERT_CONTINUATION_POLICY = {
  minimumSamples: 4,
  exploratorySamples: 2,
  comparisonVisits: 16,
  priorVisits: 8,
  varianceFloor: 0.0025
} as const

type ComparisonRoot = Pick<MctsRootStat, 'visits' | 'meanValue'> & {
  readonly comparisonVisits?: number
}

export function expertRootRecommendationValue(root: ComparisonRoot): number {
  return root.visits < 2 && root.meanValue > 0
    ? mctsRootRecommendationScore(root)
    : root.meanValue
}

/** Shrink a selected suffix toward its root, with a variance floor for tiny samples. */
export function estimateExpertContinuation(
  line: ExpertContinuationSample,
  root: ComparisonRoot
) {
  // A neutral prior artificially improves a losing, lightly sampled pass.
  // Suffix support may improve the observed root value, never replace it with zero.
  const rootValue = expertRootRecommendationValue(root)
  const meanValue = line.visits ? line.valueSum / line.visits : root.meanValue
  const variance = Math.max(
    0,
    (line.valueSquaredSum ?? line.visits * meanValue * meanValue) /
      Math.max(1, line.visits) -
      meanValue * meanValue
  )
  const uncertainty = Math.sqrt(
    Math.max(EXPERT_CONTINUATION_POLICY.varianceFloor, variance) /
      Math.max(1, line.visits)
  )
  const comparisonVisits = root.comparisonVisits ?? root.visits
  const evidenceMature = comparisonVisits >= EXPERT_CONTINUATION_POLICY.comparisonVisits
  const requiredSamples = evidenceMature
    ? EXPERT_CONTINUATION_POLICY.minimumSamples
    : EXPERT_CONTINUATION_POLICY.exploratorySamples
  const supported = line.visits >= requiredSamples
  return {
    rootValue,
    meanValue,
    variance,
    uncertainty,
    supported,
    supportVisits: line.visits,
    comparisonVisits,
    evidenceMature,
    requiredSamples,
    value: supported
      ? !evidenceMature
        ? Math.max(rootValue, meanValue)
        : Math.max(
            rootValue,
            rootValue +
              ((meanValue - rootValue) * line.visits) /
                (line.visits + EXPERT_CONTINUATION_POLICY.priorVisits) -
              uncertainty
          )
      : rootValue
  }
}

export function bestExpertContinuation(
  lines: readonly ExpertContinuationSample[],
  root: ComparisonRoot
) {
  return lines
    .filter((line) => line.commands.length > 1)
    .map((line) => ({ line, estimate: estimateExpertContinuation(line, root) }))
    .filter((candidate) => candidate.estimate.supported)
    .sort(
      (a, b) =>
        b.estimate.value - a.estimate.value ||
        b.line.visits - a.line.visits ||
        a.line.commands.length - b.line.commands.length
    )[0]
}
