import { CARD_CATALOG } from '../../content/cards'
import type {
  OpeningMatchInstance,
  OpeningMatchState,
  OpeningMatchCommand as TurnMatchCommand
} from '../opening-match-types'
import type { PlayerId } from '../match-types'
import type {
  AiCandidateDossier,
  AiSearchLimits,
  AiStrategicPlanView
} from './ai-types'
import { evaluatePosition } from './evaluator'
import {
  activeParticipant,
  canonicalCommandKey,
  enumerateLegalCommands
} from './legal-commands'
import { hashAiState, AiTranspositionCache } from './state-hash'
import { classifyTacticalLine, proveGuaranteedLethal } from './tactics'

export interface AiSearchRootAction {
  readonly actionId: string
  readonly command: TurnMatchCommand
}

export interface AiCompetitiveSearchResult {
  readonly dossiers: readonly AiCandidateDossier[]
  readonly exploredNodes: number
  readonly cacheHits: number
  readonly partial: boolean
  readonly elapsedMs: number
}

interface SearchLine {
  readonly commands: readonly TurnMatchCommand[]
  readonly state: OpeningMatchState
  readonly score: number
  readonly completeTurn: boolean
}

function simulate(
  match: OpeningMatchInstance,
  commands: readonly TurnMatchCommand[]
): Readonly<{ readonly accepted: boolean; readonly state: OpeningMatchState }> {
  return match.analyze((fork) => {
    let state = fork.getState()
    for (const command of commands) {
      const result = fork.dispatch(command)
      state = result.state
      if (!result.accepted) return { accepted: false, state }
    }
    return { accepted: true, state }
  })
}

function legalAfter(
  match: OpeningMatchInstance,
  commands: readonly TurnMatchCommand[],
  participantId: PlayerId
): readonly TurnMatchCommand[] {
  return match.analyze((fork) => {
    for (const command of commands) {
      if (!fork.dispatch(command).accepted) return []
    }
    return enumerateLegalCommands(fork, participantId)
  })
}

function commandUsesUncertainty(
  command: TurnMatchCommand,
  state: OpeningMatchState
): boolean {
  const opponent = state.players.find(
    (player) => player.participantId !== command.participantId
  )
  if ((opponent?.secrets ?? []).some((secret) => !secret.revealed)) return true
  if (command.type !== 'play-card') return false
  const card = state.players
    .find((player) => player.participantId === command.participantId)
    ?.hand.find((candidate) => candidate.instanceId === command.cardInstanceId)
  const effects = JSON.stringify(
    card ? (CARD_CATALOG.get(card.cardId)?.effects ?? []) : []
  ).toLowerCase()
  return /random|discover|shuffle|generate|draw/.test(effects)
}

function effectiveHealth(state: OpeningMatchState, playerId: PlayerId): number {
  const player = state.players.find((candidate) => candidate.participantId === playerId)
  return player ? player.hero.health + player.hero.armor : 0
}

function boardAttack(state: OpeningMatchState, playerId: PlayerId): number {
  return (
    state.players
      .find((candidate) => candidate.participantId === playerId)
      ?.board.reduce((total, minion) => total + minion.attack, 0) ?? 0
  )
}

function resourceUsage(
  before: OpeningMatchState,
  after: OpeningMatchState,
  playerId: PlayerId,
  plan?: AiStrategicPlanView
): AiCandidateDossier['resourceUsage'] {
  const first = before.players.find((player) => player.participantId === playerId)!
  const last = after.players.find((player) => player.participantId === playerId)!
  const reserved = new Set(plan?.reservedCardIds ?? [])
  const reservedBefore = first.hand.filter((card) =>
    reserved.has(String(card.cardId))
  ).length
  const reservedAfter = last.hand.filter((card) =>
    reserved.has(String(card.cardId))
  ).length
  return {
    manaSpent: Math.max(0, first.mana.available - last.mana.available),
    cardsSpent: Math.max(0, first.hand.length - last.hand.length),
    reservedResourceCost: Math.max(0, reservedBefore - reservedAfter)
  }
}

function lineKey(commands: readonly TurnMatchCommand[]): string {
  return commands.map(canonicalCommandKey).join('|')
}

/**
 * Iterative, deterministic complete-turn search. Every simulation is executed
 * on the engine's restoring analysis fork; the authoritative match is never
 * advanced and no private order is serialized to the worker/provider.
 */
export function searchCompetitiveTurn(
  match: OpeningMatchInstance,
  perspectivePlayerId: PlayerId,
  roots: readonly AiSearchRootAction[],
  limits: AiSearchLimits,
  plan?: AiStrategicPlanView,
  cache = new AiTranspositionCache<Readonly<{ readonly score: number }>>(
    limits.transpositionCapacity
  )
): AiCompetitiveSearchResult {
  const startedAt = Date.now()
  const deadlineAtMs = startedAt + limits.timeBudgetMs
  const initial = match.getState()
  const opponentId = initial.players.find(
    (player) => player.participantId !== perspectivePlayerId
  )!.participantId
  let exploredNodes = 0
  let partial = false

  const scoreState = (state: OpeningMatchState): number => {
    const key = `${perspectivePlayerId}:${hashAiState(state)}`
    const cached = cache.get(key)
    if (cached) return cached.score
    const score = evaluatePosition(state, perspectivePlayerId, plan).score
    cache.set(key, { score })
    return score
  }

  const expandTurn = (
    prefix: readonly TurnMatchCommand[],
    participantId: PlayerId,
    beamWidth: number,
    rootAction?: AiSearchRootAction
  ): readonly SearchLine[] => {
    const initialSimulation = simulate(match, prefix)
    if (!initialSimulation.accepted) return []
    let frontier: SearchLine[] = [
      {
        commands: prefix,
        state: initialSimulation.state,
        score: scoreState(initialSimulation.state),
        completeTurn: activeParticipant(initialSimulation.state) !== participantId
      }
    ]
    const completed: SearchLine[] = []
    for (
      let depth = prefix.length;
      depth < limits.atomicDepth && frontier.length > 0;
      depth += 1
    ) {
      if (Date.now() >= deadlineAtMs || exploredNodes >= limits.nodeLimit) {
        partial = true
        break
      }
      const next: SearchLine[] = []
      for (const line of frontier) {
        if (line.completeTurn || line.state.phase === 'ended') {
          completed.push(line)
          continue
        }
        const commands = legalAfter(match, line.commands, participantId)
        for (const command of commands) {
          if (Date.now() >= deadlineAtMs || exploredNodes >= limits.nodeLimit) {
            partial = true
            break
          }
          exploredNodes += 1
          const sequence = [...line.commands, command]
          const result = simulate(match, sequence)
          if (!result.accepted) continue
          const completeTurn =
            result.state.phase === 'ended' ||
            activeParticipant(result.state) !== participantId
          next.push({
            commands: sequence,
            state: result.state,
            score: scoreState(result.state),
            completeTurn
          })
        }
      }
      const collapsed = new Map<string, SearchLine>()
      for (const line of next) {
        const firstKey = rootAction
          ? rootAction.actionId
          : canonicalCommandKey(line.commands[prefix.length] ?? line.commands[0]!)
        const key = `${firstKey}:${hashAiState(line.state)}`
        const current = collapsed.get(key)
        const preferable =
          participantId === perspectivePlayerId
            ? !current || line.score > current.score
            : !current || line.score < current.score
        if (preferable) collapsed.set(key, line)
      }
      frontier = [...collapsed.values()]
        .sort((left, right) =>
          participantId === perspectivePlayerId
            ? right.score - left.score ||
              lineKey(left.commands).localeCompare(lineKey(right.commands))
            : left.score - right.score ||
              lineKey(left.commands).localeCompare(lineKey(right.commands))
        )
        .slice(0, beamWidth)
    }
    completed.push(...frontier)
    return completed
  }

  const lethalProof = proveGuaranteedLethal(match, perspectivePlayerId, {
    depth: Math.min(limits.atomicDepth, 12),
    nodeLimit: Math.min(limits.nodeLimit, 12_000),
    deadlineAtMs
  })
  const dossiers: AiCandidateDossier[] = []
  for (const root of roots) {
    if (Date.now() >= deadlineAtMs || exploredNodes >= limits.nodeLimit) {
      partial = true
      break
    }
    const ownLines = expandTurn(
      [root.command],
      perspectivePlayerId,
      limits.ownTurnBeam,
      root
    )
    let bestDossier: AiCandidateDossier | null = null
    for (const ownLine of ownLines) {
      const opponentLines =
        ownLine.state.phase === 'ended'
          ? []
          : expandTurn(ownLine.commands, opponentId, limits.opponentTurnBeam)
      const strongestResponse =
        opponentLines.length === 0
          ? ownLine
          : [...opponentLines].sort(
              (left, right) =>
                left.score - right.score ||
                lineKey(left.commands).localeCompare(lineKey(right.commands))
            )[0]!
      const opponentCommands = strongestResponse.commands.slice(ownLine.commands.length)
      const evaluation = evaluatePosition(
        strongestResponse.state,
        perspectivePlayerId,
        plan
      )
      const uncertainty = [...ownLine.commands, ...opponentCommands].some(
        (command, index, all) => {
          const prior = simulate(match, all.slice(0, index)).state
          return commandUsesUncertainty(command, prior)
        }
      )
      const matchupPlanProgress =
        evaluation.components.matchupProgress + evaluation.components.comboProgress
      const tacticalProofs = [
        ...classifyTacticalLine(
          initial,
          ownLine.state,
          perspectivePlayerId,
          ownLine.commands
        ),
        ...(lethalProof.proven &&
        canonicalCommandKey(lethalProof.commands[0]!) ===
          canonicalCommandKey(root.command)
          ? [lethalProof]
          : [])
      ]
      const dossier: AiCandidateDossier = {
        actionId: root.actionId,
        firstCommand: root.command,
        recommendedContinuation: ownLine.commands.slice(1),
        projectedSuccessor: {
          revision: strongestResponse.state.revision,
          winnerId: strongestResponse.state.winnerId,
          selfEffectiveHealth: effectiveHealth(
            strongestResponse.state,
            perspectivePlayerId
          ),
          opponentEffectiveHealth: effectiveHealth(strongestResponse.state, opponentId),
          selfBoardAttack: boardAttack(strongestResponse.state, perspectivePlayerId),
          opponentBoardAttack: boardAttack(strongestResponse.state, opponentId)
        },
        opponentStrongestResponse: opponentCommands,
        tacticalProofs,
        evaluation: evaluation.components,
        score: evaluation.score,
        meanScenarioValue: evaluation.score,
        downsideScenarioValue: evaluation.score,
        worstCaseScenarioValue: evaluation.score,
        resourceUsage: resourceUsage(initial, ownLine.state, perspectivePlayerId, plan),
        uncertainty: {
          determinizations: uncertainty ? limits.determinizations : 1,
          randomOutcomeSamples: uncertainty ? limits.randomOutcomeSamples : 1,
          incomplete: uncertainty || partial || !ownLine.completeTurn
        },
        matchupPlanProgress
      }
      if (!bestDossier || dossier.score > bestDossier.score) bestDossier = dossier
    }
    if (bestDossier) dossiers.push(bestDossier)
  }
  dossiers.sort(
    (left, right) =>
      right.score - left.score || left.actionId.localeCompare(right.actionId)
  )
  return {
    dossiers,
    exploredNodes,
    cacheHits: cache.hitCount,
    partial,
    elapsedMs: Date.now() - startedAt
  }
}
