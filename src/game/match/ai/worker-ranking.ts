import type { AiSearchWorkerRequest, AiSearchWorkerResult } from './ai-types'

/** Serializable deterministic final aggregation performed inside the worker. */
export function rankWorkerDossiers(
  request: AiSearchWorkerRequest,
  startedAt = Date.now()
): AiSearchWorkerResult {
  const riskWeight = 0.24
  const worstCaseWeight = 0.16
  const ordered = [...request.candidateDossiers].sort((left, right) => {
    const leftValue =
      left.meanScenarioValue +
      left.downsideScenarioValue * riskWeight +
      left.worstCaseScenarioValue * worstCaseWeight
    const rightValue =
      right.meanScenarioValue +
      right.downsideScenarioValue * riskWeight +
      right.worstCaseScenarioValue * worstCaseWeight
    return rightValue - leftValue || left.actionId.localeCompare(right.actionId)
  })
  return {
    type: 'search-result',
    requestId: request.requestId,
    observationRevision: request.observationRevision,
    candidateDossiers: ordered.slice(0, 8),
    exploredNodes: 0,
    cacheHits: 0,
    partial: ordered.some((candidate) => candidate.uncertainty.incomplete),
    elapsedMs: Date.now() - startedAt
  }
}
