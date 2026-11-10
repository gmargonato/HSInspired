import type { JsonObject } from '../../../desktop/contracts/ipc/ai'
import { aiActionIntent } from './ai-action-intent'
import {
  rankExpertCandidateWorlds,
  type ExpertCandidateScore,
  type ExpertEvaluatedWorld
} from './expert-ai-consensus'
import type { ExpertWorldAction, ExpertWorldRequest } from './expert-ai-world-runner'
import type { LocalAiCandidateTrace } from './local-ai-decision-api'
import { EXPERT_AI_PLAN_SEARCH_LIMIT_MS } from './expert-ai-worker-protocol'

const SEQUENCE_LIMITS = { candidatesPerWorld: 12, actionsPerSequence: 6 } as const

/** Serializes retained evidence only. No simulation, RNG, or decision policy lives here. */
export function expertSearchSummary(
  request: ExpertWorldRequest,
  results: readonly ExpertEvaluatedWorld[],
  actions: ReadonlyMap<string, ExpertWorldAction>,
  opponentPlayerId: string,
  selectedActionId: string,
  consensusScores: ReadonlyMap<string, ExpertCandidateScore>,
  worldDetails: readonly { worldIndex: number; status: string }[],
  durationMs: number,
  failedWorlds: readonly string[] = []
): JsonObject {
  const fullResults = results.map((result) => ({
    ...result,
    trace: result.trace
      ? {
          ...result.trace,
          candidates: result.trace.evaluatedCandidates ?? result.trace.candidates
        }
      : null
  }))
  // Same arithmetic as consensus, including adjustments and proof values. The
  // fuller logging list must never feed back into the gameplay shortlist.
  const scores = rankExpertCandidateWorlds(fullResults)
  const worlds = fullResults.map((result, index) => {
    const candidates = result.trace?.candidates ?? []
    const byId = new Map(candidates.map((candidate) => [candidate.actionId, candidate]))
    const sequenceIds = new Set(
      [
        byId.get(selectedActionId),
        byId.get(result.trace?.chosenActionId ?? ''),
        ...candidates
      ]
        .filter((candidate) => candidate?.sequenceIntents?.length)
        .map((candidate) => candidate!.actionId)
        .filter((id, position, ids) => ids.indexOf(id) === position)
        .slice(0, SEQUENCE_LIMITS.candidatesPerWorld)
    )
    return {
      result,
      byId,
      sequenceIds,
      worldIndex: worldDetails[index]?.worldIndex ?? index,
      status: worldDetails[index]?.status ?? 'completed',
      sequencesOmitted:
        candidates.filter((candidate) => candidate.sequenceIntents?.length).length -
        sequenceIds.size
    }
  })
  const sequence = (candidate: LocalAiCandidateTrace): JsonObject | null => {
    const intents = candidate.sequenceIntents
    if (!intents?.length) return null
    return {
      intents: intents.slice(0, SEQUENCE_LIMITS.actionsPerSequence).map((intent) => ({
        ...intent,
        targets: [...intent.targets]
      })),
      originalLength: intents.length,
      truncated: intents.length > SEQUENCE_LIMITS.actionsPerSequence,
      // Inspection may append an implicit pass. Its outcome alone cannot prove
      // that this displayed sampled prefix completed the turn.
      ending:
        candidate.sequenceProvenance === 'tactical-proof'
          ? 'terminal'
          : intents.at(-1)?.type === 'end-turn'
            ? 'end-turn'
            : 'partial',
      supportScope: 'original-sequence',
      provenance: candidate.sequenceProvenance ?? 'retained-line',
      supportVisits:
        candidate.sequenceSupportVisits ??
        candidate.continuationEstimate?.supportVisits ??
        null
    }
  }
  return {
    version: 1,
    searchId:
      request.searchId ??
      `${request.request.requestId}:${request.request.expectedRevision}:${request.seed}`,
    selectedActionId,
    seed: request.seed,
    durationMs,
    failedWorlds: [...failedWorlds],
    settings: {
      ...request.configuredBudget,
      remainingSearchBudgetMs: request.remainingSearchBudgetMs,
      planSearchLimitMs: request.planSearchLimitMs ?? EXPERT_AI_PLAN_SEARCH_LIMIT_MS,
      replanSearchLimitMs: request.replanSearchLimitMs ?? 4_000
    },
    legalActionCount: actions.size,
    evaluatedActionCount: [...actions.keys()].filter((id) =>
      worlds.some((world) => world.byId.has(id))
    ).length,
    sequenceLimits: { ...SEQUENCE_LIMITS },
    worlds: worlds.map((world) => ({
      worldIndex: world.worldIndex,
      status: world.status,
      timedOut: world.result.trace?.timedOut ?? null,
      durationMs: world.result.trace?.durationMs ?? null,
      iterations: world.result.trace?.sampleCount ?? null,
      evaluatedActionCount: world.byId.size,
      sequenceCount: world.sequenceIds.size,
      sequencesOmitted: world.sequencesOmitted
    })),
    options: [...actions.values()].map((action) => {
      const score = scores.get(action.id)
      const consensus = consensusScores.get(action.id)
      // Ranking uses zero internally for missing counts. Logs must distinguish
      // that arithmetic default from observed root visits in every scored world.
      const visitsKnown = worlds.every((world) => {
        const candidate = world.byId.get(action.id)
        return !candidate?.accepted || candidate.visits !== undefined
      })
      return {
        actionId: action.id,
        description: action.description,
        intent: { ...aiActionIntent(action.command, opponentPlayerId) },
        evaluated: worlds.some((world) => world.byId.has(action.id)),
        consensusIncluded: consensusScores.has(action.id),
        consensusExpectedValue: consensus?.samples
          ? consensus.score / consensus.samples
          : null,
        consensusSampledWorlds: consensus?.samples ?? 0,
        expectedValue: score?.samples ? score.score / score.samples : null,
        votes: score?.votes ?? 0,
        visits: score?.samples && visitsKnown ? score.visits : null,
        sampledWorlds: score?.samples ?? 0,
        worlds: worlds.flatMap((world) => {
          const candidate = world.byId.get(action.id)
          if (!candidate) return []
          return [
            {
              worldIndex: world.worldIndex,
              selectedInWorld: world.result.trace?.chosenActionId === action.id,
              rootMean: candidate.meanValue ?? null,
              visits: candidate.visits ?? null,
              recommendationValue: candidate.recommendationValue ?? null,
              finalRecommendationValue: candidate.finalRecommendationValue ?? null,
              rankingComponents: candidate.rankingComponents
                ? { ...candidate.rankingComponents }
                : null,
              continuationEstimate: candidate.continuationEstimate
                ? { ...candidate.continuationEstimate }
                : null,
              provenWin: candidate.provenWin ?? false,
              publicAttackSurvival: candidate.publicAttackSurvival ?? false,
              outcome: candidate.outcome ?? null,
              publicReply: candidate.publicReply ?? null,
              sequence: world.sequenceIds.has(action.id) ? sequence(candidate) : null
            }
          ]
        })
      }
    })
  }
}
