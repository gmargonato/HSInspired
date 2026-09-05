import type {
  AiCandidateDossier,
  AiSearchWorkerRequest,
  AiSearchWorkerResult
} from './ai-types'

/** Serializable deterministic final aggregation performed inside the worker. */
export function rankWorkerDossiers(
  request: AiSearchWorkerRequest,
  candidateDossiers: readonly AiCandidateDossier[],
  searchMetrics: Readonly<{
    exploredNodes: number
    cacheHits: number
    partial: boolean
  }> = { exploredNodes: 0, cacheHits: 0, partial: false },
  startedAt = Date.now(),
  roots = request.roots ?? []
): AiSearchWorkerResult {
  const riskWeight = 0.24
  const worstCaseWeight = 0.16
  const reservedResourceWeight = 1
  // A partially analyzed action must not outrank a fully searched action with
  // a comparable scenario value; partial coverage is a quality deficit.
  const incompletePenalty = 0.4
  const scenarioValue = (candidate: AiCandidateDossier): number =>
    candidate.meanScenarioValue +
    candidate.downsideScenarioValue * riskWeight +
    candidate.worstCaseScenarioValue * worstCaseWeight -
    candidate.resourceUsage.reservedResourceCost * reservedResourceWeight -
    (candidate.uncertainty.incomplete ? incompletePenalty : 0)
  const ordered = [...candidateDossiers].sort(
    (left, right) =>
      scenarioValue(right) - scenarioValue(left) ||
      left.actionId.localeCompare(right.actionId)
  )
  return {
    type: 'search-result',
    requestId: request.requestId,
    observationRevision: request.observationRevision,
    roots,
    candidateDossiers: ordered.slice(0, 8),
    exploredNodes: searchMetrics.exploredNodes,
    cacheHits: searchMetrics.cacheHits,
    partial:
      searchMetrics.partial ||
      ordered.some((candidate) => candidate.uncertainty.incomplete),
    elapsedMs: Date.now() - startedAt
  }
}
