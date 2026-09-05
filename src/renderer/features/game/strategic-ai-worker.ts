/// <reference lib="webworker" />

import { createOpeningMatchFromCheckpoint } from '../../../game/match'
import type { TurnMatchCommand } from '../../../game/match'
import {
  AiTranspositionCache,
  enumerateLegalCommands,
  searchStrategicTurn,
  type AiCandidateDossier,
  type AiSearchWorkerMessage,
  type AiSearchWorkerRequest
} from '../../../game/match/ai'
import { rankWorkerDossiers } from '../../../game/match/ai/worker-ranking'

const scope = self as DedicatedWorkerGlobalScope
const cancelled = new Set<string>()
const cache = new AiTranspositionCache<Readonly<{ readonly score: number }>>(50_000)

function mergeDossiers(
  target: Map<string, AiCandidateDossier>,
  source: readonly AiCandidateDossier[]
): boolean {
  let improved = false
  for (const dossier of source) {
    const current = target.get(dossier.actionId)
    if (
      !current ||
      dossier.score > current.score ||
      (current.uncertainty.incomplete && !dossier.uncertainty.incomplete)
    ) {
      target.set(dossier.actionId, dossier)
      improved = true
    }
  }
  return improved
}

async function runSearch(request: AiSearchWorkerRequest): Promise<void> {
  const startedAt = Date.now()
  const deadlineAtMs = startedAt + Math.max(1, request.limits.timeBudgetMs)
  const match = createOpeningMatchFromCheckpoint(request.checkpoint)
  const commandPriority = (command: TurnMatchCommand): number => {
    if (
      command.type === 'choose-discover-card' ||
      command.type === 'choose-card-option'
    )
      return 5
    if (command.type === 'attack-character')
      return command.defender.kind === 'hero' ? 4 : 2
    if (command.type === 'play-card') return 3
    if (command.type === 'use-hero-power') return 2
    if (command.type === 'end-turn') return 1
    return 0
  }
  const roots =
    request.roots ??
    [
      ...match.analyze((fork) =>
        enumerateLegalCommands(fork, request.perspectivePlayerId)
      )
    ]
      .sort((left, right) => commandPriority(right) - commandPriority(left))
      .slice(0, 128)
      .map((command, index) => ({ actionId: `action-${index}`, command }))
  const dossiers = new Map<string, AiCandidateDossier>()
  let exploredNodes = 0
  let cacheHits = 0
  let partial = false

  const baseline = searchStrategicTurn(
    match,
    request.perspectivePlayerId,
    roots,
    {
      ...request.limits,
      timeBudgetMs: Math.max(1, Math.min(250, deadlineAtMs - Date.now()))
    },
    request.plan,
    cache,
    { baselineOnly: true }
  )
  mergeDossiers(dossiers, baseline.dossiers)
  exploredNodes += baseline.exploredNodes
  cacheHits += baseline.cacheHits
  partial ||= baseline.partial

  const provenLethal = baseline.dossiers.some((dossier) =>
    dossier.tacticalProofs.some(
      (proof) => proof.proven && proof.complete && proof.kind === 'guaranteed-lethal'
    )
  )

  if (!provenLethal) {
    for (let round = 0; round < 256; round += 1) {
      let improvedAny = false
      const start = roots.length === 0 ? 0 : round % roots.length
      const roundRoots = [...roots.slice(start), ...roots.slice(0, start)]
      for (const root of roundRoots) {
        if (
          cancelled.has(request.requestId) ||
          Date.now() >= deadlineAtMs ||
          exploredNodes >= request.limits.nodeLimit
        ) {
          partial = true
          break
        }
        const result = searchStrategicTurn(
          match,
          request.perspectivePlayerId,
          [root],
          {
            ...request.limits,
            timeBudgetMs: Math.max(1, Math.min(75, deadlineAtMs - Date.now())),
            nodeLimit: Math.max(
              1,
              Math.min(6_250, request.limits.nodeLimit - exploredNodes)
            )
          },
          request.plan,
          cache,
          { baselinePass: false }
        )
        exploredNodes += result.exploredNodes
        cacheHits += result.cacheHits
        partial ||= result.partial
        improvedAny = mergeDossiers(dossiers, result.dossiers) || improvedAny
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      if (
        !improvedAny ||
        cancelled.has(request.requestId) ||
        Date.now() >= deadlineAtMs ||
        exploredNodes >= request.limits.nodeLimit
      )
        break
    }
  }

  if (cancelled.delete(request.requestId)) return
  scope.postMessage(
    rankWorkerDossiers(
      request,
      [...dossiers.values()],
      { exploredNodes, cacheHits, partial },
      startedAt,
      roots
    )
  )
}

scope.onmessage = (event: MessageEvent<AiSearchWorkerMessage>): void => {
  const request = event.data
  if (request?.type === 'cancel-search') {
    cancelled.add(request.requestId)
    return
  }
  if (request?.type === 'search') {
    void runSearch(request).catch((error) => {
      setTimeout(() => {
        throw error
      }, 0)
    })
  }
}

export {}
