import { cpus, platform, release, totalmem } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  generateConstructedOpponent,
  OPPONENT_GENERATOR_VERSION
} from '../../../game/decks/opponent-generator'
import {
  asPlayerId,
  createSeededRng,
  enumerateLegalCommands,
  type MatchSetup,
  type OpeningMatchCheckpoint,
  type PlayerId,
  type TurnMatchCommand
} from '../../../game/match'
import { createFairHypothesisCheckpoint } from '../../../game/match/ai/fair-hypothesis-checkpoint'
import { canonicalCommandKey } from '../../../game/match/ai/legal-commands'
import type { AiDecisionRequest } from '../../../shared/ipc/ai'
import { sameAiIntent, type AiActionIntent } from '../../../shared/ipc/ai-deliberation'
import {
  EXPERT_AI_DECISION_SEARCH_BUDGET_MS,
  EXPERT_AI_DISPATCH_RESERVE_MS,
  EXPERT_AI_PRESENTATION_RESERVE_MS,
  EXPERT_AI_SEARCH_BUDGET_MS,
  EXPERT_AI_TURN_BUDGET_MS
} from './expert-ai-worker-protocol'
import { aiActions } from './ai-context'
import { selectExpertTimeoutFallbackAction } from './expert-ai-timeout-fallback'
import { aiActionIntent } from './ai-action-intent'
import { chooseExpertConsensus, type ExpertEvaluatedWorld } from './expert-ai-consensus'
import { GameBoardSession } from './game-board-session'
import { LocalAiDecisionApi, type LocalAiDecisionTrace } from './local-ai-decision-api'

type LocalProfile = 'easy' | 'expert' | 'random'
type MctsProfile = NonNullable<LocalAiDecisionTrace['mctsProfile']>
type MctsProfileTimingKey = Extract<keyof MctsProfile, `${string}Ms`>
const ENABLED = process.env.RUN_LOCAL_AI_BENCHMARK === '1'
const FIRST_ID = asPlayerId('benchmark-player-one')
const SECOND_ID = asPlayerId('benchmark-player-two')
const DEFAULT_TURN_BUDGET_MS = EXPERT_AI_TURN_BUDGET_MS
const EXPERT_MULLIGAN_BUDGET_MS = 3_000

interface BenchmarkOptions {
  readonly games: number
  readonly seed: number
  readonly baseline: 'easy' | 'random'
  readonly maxActions: number
  readonly turnBudgetMs: number
  readonly workBudget?: number
  readonly traceLosses: boolean
}

interface MutableProfileMetrics {
  wins: number
  losses: number
  draws: number
  cappedGames: number
  decisions: number
  commands: number
  endTurns: number
  worldsEvaluated: number
  fallbacks: number
  timeoutFallbacks: number
  continuedLineFallbacks: number
  failedFallbacks: number
  failedDecisions: number
  invalidSelections: number
  rejectedCommands: number
  timedOutSearches: number
  continuationPreferencesOffered: number
  continuationPreferencesMatched: number
  evaluatedCandidates: number
  mctsIterations: number
  mctsOpponentActionsSimulated: number
  mctsOpponentCardPlaysSimulated: number
  mctsCandidateCacheHits: number
  mctsCandidateCacheMisses: number
  mctsTreeDepthTotal: number
  mctsRolloutDepthTotal: number
  mctsMaximumRolloutDepth: number
  mctsProfileTimingMs: Record<MctsProfileTimingKey, number>
  sequenceNodes: number
  responseNodes: number
  responseCardPlayNodes: number
  workUnits: number
  workBudgetHits: number
  readonly rootEvaluationMs: number[]
  readonly sequenceSearchMs: number[]
  readonly responseSearchMs: number[]
  readonly responseCandidateAnalysisMs: number[]
  readonly responseCandidateDispatchMs: number[]
  readonly responseCandidateObservationMs: number[]
  readonly responseCandidateScoringMs: number[]
  readonly responseActionGenerationMs: number[]
  readonly responseReplayMs: number[]
  readonly decisionMs: number[]
  readonly turnMs: number[]
  readonly turnActions: number[]
}

interface MatchResult {
  readonly seed: number
  readonly expertPlayer: string
  readonly decks: readonly {
    readonly id: string
    readonly heroId: string
    readonly archetype: string
  }[]
  readonly status: 'completed' | 'draw' | 'capped'
  readonly winner: LocalProfile | null
  readonly actions: number
  readonly turnNumber: number
}

interface ExpertDecisionDiagnostic {
  readonly turnNumber: number
  readonly revision: number
  readonly self: {
    readonly heroId: string
    readonly health: number
    readonly armor: number
    readonly mana: { readonly available: number; readonly maximum: number }
    readonly hand: readonly string[]
    readonly board: readonly {
      readonly cardId: string
      readonly attack: number
      readonly health: number
      readonly keywords: readonly string[]
    }[]
    readonly weapon: {
      readonly cardId: string
      readonly attack: number
      readonly durability: number
    } | null
  }
  readonly opponent: {
    readonly heroId: string
    readonly health: number
    readonly armor: number
    readonly mana: { readonly available: number; readonly maximum: number }
    readonly handCount: number
    readonly deckCount: number
    readonly secretCount: number
    readonly board: readonly {
      readonly cardId: string
      readonly attack: number
      readonly health: number
      readonly keywords: readonly string[]
    }[]
    readonly weapon: {
      readonly cardId: string
      readonly attack: number
      readonly durability: number
    } | null
  }
  readonly selectedAction: string | null
  readonly selectedCommand: TurnMatchCommand | null
  readonly executedCommand: TurnMatchCommand
  readonly usedFallback: boolean
  readonly worlds: readonly {
    readonly chosenActionId: string | null
    readonly chosenCandidate: {
      readonly description: string
      readonly score: number
      readonly scoreComponents: LocalAiDecisionTrace['candidates'][number]['scoreComponents']
    } | null
    readonly chosenSequence?: readonly string[]
    readonly responseScore?: number | null
    readonly sequenceNodes?: number
    readonly responseNodes?: number
    readonly responseCardPlayNodes?: number
    readonly workUnits?: number
    readonly workBudgetHit?: boolean
    readonly rootEvaluationMs?: number
    readonly sequenceSearchMs?: number
    readonly responseSearchMs?: number
    readonly responseCandidateAnalysisMs?: number
    readonly responseCandidateDispatchMs?: number
    readonly responseCandidateObservationMs?: number
    readonly responseCandidateScoringMs?: number
    readonly responseActionGenerationMs?: number
    readonly responseReplayMs?: number
    readonly mctsDurationMs?: number
    readonly mctsProfile?: MctsProfile
    readonly timedOut: boolean
    readonly topCandidates: readonly {
      readonly rank: number
      readonly description: string
      readonly score: number
      readonly scoreComponents: LocalAiDecisionTrace['candidates'][number]['scoreComponents']
    }[]
  }[]
}

interface PublicActionDiagnostic {
  readonly turnNumber: number
  readonly actor: LocalProfile
  readonly command: string
  readonly actorVitals: {
    readonly before: { readonly health: number; readonly armor: number }
    readonly after: { readonly health: number; readonly armor: number }
  }
  readonly opponentVitals: {
    readonly before: { readonly health: number; readonly armor: number }
    readonly after: { readonly health: number; readonly armor: number }
  }
  readonly phaseAfter: ReturnType<GameBoardSession['getState']>['phase']
  readonly winnerId: string | null
}

interface DecisionOutcome {
  readonly command: TurnMatchCommand | null
  readonly traces: readonly LocalAiDecisionTrace[]
  readonly worlds: number
  readonly timedOut: boolean
  readonly selectedDescription?: string | null
  readonly plannedActionIntents?: readonly AiActionIntent[]
  readonly continuedLineFallback?: boolean
  readonly continuationPreferenceOffered?: boolean
  readonly continuationPreferenceMatched?: boolean
  readonly failed?: boolean
}

interface DecisionRequestOptions {
  readonly request: AiDecisionRequest
  readonly profile: LocalProfile
  readonly participantId: PlayerId
  readonly checkpoint: OpeningMatchCheckpoint
  readonly remainingTurnMs: number
  readonly remainingSearchMs: number
  readonly workBudget?: number
  readonly preferredContinuation?: AiActionIntent
  readonly exhaustedBudgetContinuation?: readonly AiActionIntent[]
  readonly phase: 'action' | 'mulligan'
  readonly liveLegalCommands?: readonly TurnMatchCommand[]
}

interface BenchmarkContinuation {
  readonly turn: number
  readonly expectedRevision: number
  readonly nextIndex: number
  readonly actions: readonly AiActionIntent[]
}

function emptyProfileMetrics(): MutableProfileMetrics {
  return {
    wins: 0,
    losses: 0,
    draws: 0,
    cappedGames: 0,
    decisions: 0,
    commands: 0,
    endTurns: 0,
    worldsEvaluated: 0,
    fallbacks: 0,
    timeoutFallbacks: 0,
    continuedLineFallbacks: 0,
    failedFallbacks: 0,
    failedDecisions: 0,
    invalidSelections: 0,
    rejectedCommands: 0,
    timedOutSearches: 0,
    continuationPreferencesOffered: 0,
    continuationPreferencesMatched: 0,
    evaluatedCandidates: 0,
    mctsIterations: 0,
    mctsOpponentActionsSimulated: 0,
    mctsOpponentCardPlaysSimulated: 0,
    mctsCandidateCacheHits: 0,
    mctsCandidateCacheMisses: 0,
    mctsTreeDepthTotal: 0,
    mctsRolloutDepthTotal: 0,
    mctsMaximumRolloutDepth: 0,
    mctsProfileTimingMs: {
      hypothesisSetupMs: 0,
      analysisSnapshotRestoreMs: 0,
      observationMs: 0,
      informationKeyMs: 0,
      legalActionGenerationMs: 0,
      actionPriorMs: 0,
      treeSelectionMs: 0,
      rolloutSelectionMs: 0,
      simulationDispatchMs: 0,
      leafEvaluationMs: 0
    },
    sequenceNodes: 0,
    responseNodes: 0,
    responseCardPlayNodes: 0,
    workUnits: 0,
    workBudgetHits: 0,
    rootEvaluationMs: [],
    sequenceSearchMs: [],
    responseSearchMs: [],
    responseCandidateAnalysisMs: [],
    responseCandidateDispatchMs: [],
    responseCandidateObservationMs: [],
    responseCandidateScoringMs: [],
    responseActionGenerationMs: [],
    responseReplayMs: [],
    decisionMs: [],
    turnMs: [],
    turnActions: []
  }
}

function percentile(values: readonly number[], percentileValue: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  return Math.round(
    sorted[Math.max(0, Math.ceil(sorted.length * percentileValue) - 1)]!
  )
}

function latencySummary(values: readonly number[]) {
  return {
    count: values.length,
    meanMs: values.length
      ? Math.round(values.reduce((total, value) => total + value, 0) / values.length)
      : null,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: values.length ? Math.round(Math.max(...values)) : null
  }
}

function countSummary(values: readonly number[]) {
  return {
    count: values.length,
    mean: values.length
      ? Math.round(values.reduce((total, value) => total + value, 0) / values.length)
      : null,
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.length ? Math.max(...values) : null
  }
}

function uint32(value: number): number {
  return value >>> 0
}

function requestSeed(request: AiDecisionRequest): number {
  const input =
    request.matchId + ':' + request.requestId + ':' + request.expectedRevision
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index++)
    hash = Math.imul(hash ^ input.charCodeAt(index), 0x01000193)
  return hash >>> 0
}

function nextWorldSeed(seed: number, index: number): number {
  return (seed + Math.imul(index + 1, 0x9e3779b9)) >>> 0
}

function expertSearchBudget(
  remainingTurnMs: number,
  remainingSearchMs: number
): {
  readonly searchBudgetMs: number
  readonly worldCount: number
} {
  const searchBudgetMs = Math.max(
    0,
    Math.min(
      EXPERT_AI_SEARCH_BUDGET_MS,
      EXPERT_AI_DECISION_SEARCH_BUDGET_MS,
      remainingSearchMs,
      remainingTurnMs -
        EXPERT_AI_PRESENTATION_RESERVE_MS -
        EXPERT_AI_DISPATCH_RESERVE_MS
    )
  )
  return {
    searchBudgetMs,
    worldCount: Math.max(
      1,
      Math.min(3, Math.floor(Math.max(0, searchBudgetMs - 1_000) / 5_000) + 1)
    )
  }
}

function swapPerspective(
  checkpoint: OpeningMatchCheckpoint,
  participantId: PlayerId
): OpeningMatchCheckpoint {
  const participants = checkpoint.setup.participants.map((participant) => ({
    ...participant,
    controllerKind:
      participant.participantId === participantId ? ('ai' as const) : ('human' as const)
  })) as unknown as MatchSetup['participants']
  const controllerById = new Map(
    participants.map((participant) => [
      participant.participantId,
      participant.controllerKind
    ])
  )
  const players = checkpoint.state.players.map((player) => ({
    ...player,
    controllerKind: controllerById.get(player.participantId)!
  })) as unknown as typeof checkpoint.state.players
  const setup = { ...checkpoint.setup, participants }
  return {
    ...checkpoint,
    setup,
    state: { ...checkpoint.state, players }
  }
}

function createPerspectiveSession(
  checkpoint: OpeningMatchCheckpoint,
  participantId: PlayerId
) {
  const perspectiveCheckpoint = swapPerspective(checkpoint, participantId)
  return new GameBoardSession({
    setup: perspectiveCheckpoint.setup,
    decks: perspectiveCheckpoint.decks,
    checkpoint: perspectiveCheckpoint
  })
}

function legalCommands(session: GameBoardSession, participantId: PlayerId) {
  return enumerateLegalCommands(
    {
      getState: () => session.match.getState(),
      getPlayInput: (id, instanceId, choice) =>
        session.match.getPlayInput!(id, instanceId, choice),
      getLegality: (id) => session.match.getLegality!(id)
    },
    participantId
  )
}

async function decideProfile(
  options: DecisionRequestOptions
): Promise<DecisionOutcome> {
  const {
    request,
    profile,
    participantId,
    checkpoint,
    remainingTurnMs,
    remainingSearchMs,
    preferredContinuation,
    phase,
    liveLegalCommands
  } = options
  if (profile === 'random') {
    if (phase === 'mulligan')
      return {
        command: {
          type: 'confirm-mulligan',
          participantId,
          replaceInstanceIds: []
        },
        traces: [],
        worlds: 0,
        timedOut: false
      }
    const commands = liveLegalCommands ?? []
    if (!commands.length)
      return { command: null, traces: [], worlds: 0, timedOut: false }
    const rng = createSeededRng(requestSeed(request))
    const command = commands[Math.floor(rng.next() * commands.length)]!
    return {
      command,
      traces: [],
      worlds: 0,
      timedOut: false,
      selectedDescription: canonicalCommandKey(command)
    }
  }
  if (
    profile === 'expert' &&
    phase === 'action' &&
    options.workBudget === undefined &&
    (remainingTurnMs <= 100 ||
      remainingSearchMs <= 100 ||
      remainingTurnMs <=
        EXPERT_AI_PRESENTATION_RESERVE_MS + EXPERT_AI_DISPATCH_RESERVE_MS + 100)
  ) {
    const nextIntent = options.exhaustedBudgetContinuation?.[0]
    const opponentId = checkpoint.setup.participants.find(
      (participant) => participant.participantId !== participantId
    )?.participantId
    const continuedCommand =
      phase === 'action' && nextIntent && opponentId
        ? liveLegalCommands?.find((command) =>
            sameAiIntent(nextIntent, aiActionIntent(command, opponentId))
          )
        : undefined
    if (continuedCommand && options.exhaustedBudgetContinuation?.length)
      return {
        command: continuedCommand,
        traces: [],
        worlds: 0,
        timedOut: false,
        plannedActionIntents: options.exhaustedBudgetContinuation.slice(0, 6),
        continuedLineFallback: true
      }
    return { command: null, traces: [], worlds: 0, timedOut: true }
  }

  const seed = requestSeed(request)
  const initialFairCheckpoint = createFairHypothesisCheckpoint(
    checkpoint,
    participantId,
    seed
  )
  const { searchBudgetMs, worldCount: suggestedWorldCount } =
    profile === 'expert'
      ? phase === 'mulligan'
        ? { searchBudgetMs: EXPERT_MULLIGAN_BUDGET_MS - 500, worldCount: 1 }
        : expertSearchBudget(
            options.workBudget === undefined
              ? remainingTurnMs
              : EXPERT_AI_TURN_BUDGET_MS,
            options.workBudget === undefined
              ? remainingSearchMs
              : EXPERT_AI_SEARCH_BUDGET_MS
          )
      : { searchBudgetMs: 2_850, worldCount: 1 }
  const worldCount =
    options.workBudget === undefined
      ? suggestedWorldCount
      : Math.min(suggestedWorldCount, options.workBudget)
  const perWorldBudgetMs = Math.max(1, searchBudgetMs / worldCount)
  const worldResults: ExpertEvaluatedWorld[] = []
  const traces: LocalAiDecisionTrace[] = []
  let firstActions: ReturnType<typeof aiActions> = []
  let selectedCommand: TurnMatchCommand | null = null

  for (let worldIndex = 0; worldIndex < worldCount; worldIndex++) {
    const worldCheckpoint =
      profile === 'expert'
        ? createFairHypothesisCheckpoint(
            initialFairCheckpoint,
            participantId,
            nextWorldSeed(seed, worldIndex)
          )
        : initialFairCheckpoint
    const session = createPerspectiveSession(worldCheckpoint, participantId)
    const legal = legalCommands(session, participantId)
    const actions = aiActions(session, legal)
    if (worldIndex === 0) firstActions = actions
    const worldRequest = {
      ...request,
      actionIds: actions.map((action) => action.id)
    }
    const api = new LocalAiDecisionApi(session, undefined, {
      profile,
      budgetMs: perWorldBudgetMs,
      ...(options.workBudget !== undefined
        ? {
            workBudget:
              Math.floor(options.workBudget / worldCount) +
              (worldIndex < options.workBudget % worldCount ? 1 : 0)
          }
        : {}),
      fairHypothesis: profile === 'expert',
      ...(profile === 'expert' && preferredContinuation
        ? { preferredContinuation }
        : {})
    })
    const response = await api.decide(worldRequest)
    const trace = api.getLastTrace()
    if (trace) traces.push(trace)
    worldResults.push({ response, trace })
  }

  if (phase === 'mulligan') {
    const choice = worldResults[0]?.response.choice
    if (choice && 'replace' in choice) {
      const currentHand = checkpoint.state.players.find(
        (player) => player.participantId === participantId
      )?.hand
      const handIds = new Set(currentHand?.map((card) => card.instanceId) ?? [])
      const replace = new Set(choice.replace.filter((id) => handIds.has(id)))
      selectedCommand = {
        type: 'confirm-mulligan',
        participantId,
        replaceInstanceIds: [...replace]
      }
    }
    return {
      command: selectedCommand,
      traces,
      worlds: worldResults.length,
      timedOut: false
    }
  }

  if (!firstActions.length) {
    return {
      command: null,
      traces,
      worlds: worldResults.length,
      timedOut: false
    }
  }
  const legalIds = firstActions.map((action) => action.id)
  const firstChoice = worldResults[0]?.response.choice
  const consensus =
    profile === 'expert' ? chooseExpertConsensus(worldResults, legalIds) : null
  const selectedId =
    consensus?.actionId ??
    (firstChoice && 'plan' in firstChoice
      ? firstChoice.plan.firstActionId
      : firstChoice && 'actionId' in firstChoice
        ? firstChoice.actionId
        : null)
  const selectedAction = firstActions.find((action) => action.id === selectedId)
  selectedCommand = selectedAction?.command ?? null

  if (
    selectedCommand &&
    liveLegalCommands &&
    !liveLegalCommands.some(
      (command) =>
        canonicalCommandKey(command) === canonicalCommandKey(selectedCommand!)
    )
  )
    selectedCommand = null

  let plannedActionIntents: readonly AiActionIntent[] | undefined
  if (profile === 'expert' && selectedCommand && selectedAction) {
    const opponentId = checkpoint.setup.participants.find(
      (participant) => participant.participantId !== participantId
    )?.participantId
    if (opponentId) {
      const selectedIntent = aiActionIntent(selectedCommand, opponentId)
      const candidateIntents = consensus?.scores.get(selectedAction.id)?.trace
        ?.sequenceIntents
      plannedActionIntents =
        candidateIntents?.length && sameAiIntent(candidateIntents[0]!, selectedIntent)
          ? candidateIntents.slice(0, 6)
          : [selectedIntent]
    }
  }
  const continuationPreferenceMatched =
    Boolean(profile === 'expert' && preferredContinuation) &&
    traces.some((trace) =>
      trace.candidates.some(
        (candidate) => candidate.scoreComponents.continuationPreference > 0
      )
    )

  return {
    command: selectedCommand,
    traces,
    worlds: worldResults.length,
    timedOut: false,
    ...(plannedActionIntents ? { plannedActionIntents } : {}),
    ...(profile === 'expert' && preferredContinuation
      ? {
          continuationPreferenceOffered: true,
          continuationPreferenceMatched
        }
      : {}),
    selectedDescription: selectedAction?.description ?? null
  }
}

function recordDecision(
  metrics: MutableProfileMetrics,
  elapsedMs: number,
  outcome: DecisionOutcome
): void {
  metrics.decisions++
  metrics.decisionMs.push(elapsedMs)
  metrics.worldsEvaluated += outcome.worlds
  if (outcome.continuationPreferenceOffered) metrics.continuationPreferencesOffered++
  if (outcome.continuationPreferenceMatched) metrics.continuationPreferencesMatched++
  if (outcome.continuedLineFallback) metrics.continuedLineFallbacks++
  if (outcome.failed) metrics.failedDecisions++
  if (outcome.timedOut && !outcome.traces.length) metrics.timedOutSearches++
  for (const trace of outcome.traces) {
    metrics.evaluatedCandidates += trace.evaluatedActions
    if (trace.mctsProfile) {
      const profile = trace.mctsProfile
      const iterations = trace.sequenceNodes ?? 0
      metrics.mctsIterations += iterations
      metrics.mctsOpponentActionsSimulated += profile.opponentActionsSimulated
      metrics.mctsOpponentCardPlaysSimulated += profile.opponentCardPlaysSimulated
      metrics.mctsCandidateCacheHits += profile.candidateCacheHits
      metrics.mctsCandidateCacheMisses += profile.candidateCacheMisses
      metrics.mctsTreeDepthTotal += profile.averageTreeDepth * iterations
      metrics.mctsRolloutDepthTotal += profile.averageRolloutDepth * iterations
      metrics.mctsMaximumRolloutDepth = Math.max(
        metrics.mctsMaximumRolloutDepth,
        profile.maximumRolloutDepth
      )
      for (const key of Object.keys(
        metrics.mctsProfileTimingMs
      ) as MctsProfileTimingKey[])
        metrics.mctsProfileTimingMs[key] += profile[key]
    } else {
      metrics.sequenceNodes += trace.sequenceNodes ?? 0
      metrics.responseNodes += trace.responseNodes ?? 0
      metrics.responseCardPlayNodes += trace.responseCardPlayNodes ?? 0
      if (trace.rootEvaluationMs !== undefined)
        metrics.rootEvaluationMs.push(trace.rootEvaluationMs)
      if (trace.sequenceSearchMs !== undefined)
        metrics.sequenceSearchMs.push(trace.sequenceSearchMs)
      if (trace.responseSearchMs !== undefined)
        metrics.responseSearchMs.push(trace.responseSearchMs)
      if (trace.responseCandidateAnalysisMs !== undefined)
        metrics.responseCandidateAnalysisMs.push(trace.responseCandidateAnalysisMs)
      if (trace.responseCandidateDispatchMs !== undefined)
        metrics.responseCandidateDispatchMs.push(trace.responseCandidateDispatchMs)
      if (trace.responseCandidateObservationMs !== undefined)
        metrics.responseCandidateObservationMs.push(
          trace.responseCandidateObservationMs
        )
      if (trace.responseCandidateScoringMs !== undefined)
        metrics.responseCandidateScoringMs.push(trace.responseCandidateScoringMs)
      if (trace.responseActionGenerationMs !== undefined)
        metrics.responseActionGenerationMs.push(trace.responseActionGenerationMs)
      if (trace.responseReplayMs !== undefined)
        metrics.responseReplayMs.push(trace.responseReplayMs)
    }
    metrics.workUnits += trace.workUnits ?? 0
    if (trace.workBudgetHit) metrics.workBudgetHits++
    if (trace.timedOut) metrics.timedOutSearches++
  }
}

function profileForWinner(
  winnerId: string | null,
  profileByParticipant: ReadonlyMap<string, LocalProfile>
): LocalProfile | null {
  return winnerId ? (profileByParticipant.get(winnerId) ?? null) : null
}

function readOptions(): BenchmarkOptions {
  const positiveInteger = (
    name: string,
    fallback: number,
    max = Number.MAX_SAFE_INTEGER
  ): number => {
    const value = Number(process.env[name] ?? fallback)
    if (!Number.isInteger(value) || value <= 0 || value > max)
      throw new Error(name + ' must be an integer from 1 to ' + max + '.')
    return value
  }
  const seed = Number(process.env.LOCAL_AI_BENCHMARK_SEED ?? 0x4c414932)
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error('LOCAL_AI_BENCHMARK_SEED must be a uint32.')
  const workBudget =
    process.env.LOCAL_AI_BENCHMARK_WORK_BUDGET === undefined
      ? undefined
      : positiveInteger(
          'LOCAL_AI_BENCHMARK_WORK_BUDGET',
          Number(process.env.LOCAL_AI_BENCHMARK_WORK_BUDGET),
          1_000_000
        )
  return {
    games: positiveInteger('LOCAL_AI_BENCHMARK_GAMES', 2, 100),
    seed,
    baseline: (() => {
      const baseline = process.env.LOCAL_AI_BENCHMARK_BASELINE ?? 'easy'
      if (baseline !== 'easy' && baseline !== 'random')
        throw new Error('LOCAL_AI_BENCHMARK_BASELINE must be easy or random.')
      return baseline
    })(),
    maxActions: positiveInteger('LOCAL_AI_BENCHMARK_MAX_ACTIONS', 300, 10_000),
    turnBudgetMs: positiveInteger(
      'LOCAL_AI_BENCHMARK_TURN_BUDGET_MS',
      DEFAULT_TURN_BUDGET_MS,
      DEFAULT_TURN_BUDGET_MS
    ),
    ...(workBudget === undefined ? {} : { workBudget }),
    traceLosses: process.env.LOCAL_AI_BENCHMARK_TRACE_LOSSES === '1'
  }
}

function expertDecisionDiagnostic(
  state: ReturnType<GameBoardSession['getState']>,
  participantId: PlayerId,
  outcome: DecisionOutcome,
  executedCommand: TurnMatchCommand
): ExpertDecisionDiagnostic {
  const self = state.players.find((player) => player.participantId === participantId)!
  const opponent = state.players.find(
    (player) => player.participantId !== participantId
  )!
  const summarizeBoard = (player: typeof self) =>
    player.board.map((minion) => ({
      cardId: minion.cardId,
      attack: minion.attack,
      health: minion.health,
      keywords: [...(minion.keywords ?? [])]
    }))
  const summarizeWeapon = (player: typeof self) =>
    player.weapon
      ? {
          cardId: player.weapon.cardId,
          attack: player.weapon.attack,
          durability: player.weapon.durability
        }
      : null

  return {
    turnNumber: state.turnNumber,
    revision: state.revision,
    self: {
      heroId: self.heroId,
      health: self.hero.health,
      armor: self.hero.armor,
      mana: { available: self.mana.available, maximum: self.mana.maximum },
      hand: self.hand.map((card) => card.cardId),
      board: summarizeBoard(self),
      weapon: summarizeWeapon(self)
    },
    opponent: {
      heroId: opponent.heroId,
      health: opponent.hero.health,
      armor: opponent.hero.armor,
      mana: {
        available: opponent.mana.available,
        maximum: opponent.mana.maximum
      },
      handCount: opponent.hand.length,
      deckCount: opponent.deck.length,
      secretCount: opponent.secrets?.length ?? 0,
      board: summarizeBoard(opponent),
      weapon: summarizeWeapon(opponent)
    },
    selectedAction: outcome.selectedDescription ?? null,
    selectedCommand: outcome.command,
    executedCommand,
    usedFallback:
      !outcome.command ||
      canonicalCommandKey(outcome.command) !== canonicalCommandKey(executedCommand),
    worlds: outcome.traces.map((trace) => {
      const chosenCandidate =
        trace.candidates.find(
          (candidate) => candidate.actionId === trace.chosenActionId
        ) ?? null
      return {
        chosenActionId: trace.chosenActionId,
        chosenCandidate: chosenCandidate
          ? {
              description: chosenCandidate.description,
              score: chosenCandidate.score,
              scoreComponents: chosenCandidate.scoreComponents
            }
          : null,
        ...(trace.chosenSequence ? { chosenSequence: trace.chosenSequence } : {}),
        ...(trace.responseScore !== undefined
          ? { responseScore: trace.responseScore }
          : {}),
        ...(!trace.mctsProfile && trace.sequenceNodes !== undefined
          ? { sequenceNodes: trace.sequenceNodes }
          : {}),
        ...(!trace.mctsProfile && trace.responseNodes !== undefined
          ? { responseNodes: trace.responseNodes }
          : {}),
        ...(!trace.mctsProfile && trace.responseCardPlayNodes !== undefined
          ? { responseCardPlayNodes: trace.responseCardPlayNodes }
          : {}),
        ...(trace.workUnits !== undefined ? { workUnits: trace.workUnits } : {}),
        ...(trace.workBudgetHit ? { workBudgetHit: true } : {}),
        ...(!trace.mctsProfile && trace.rootEvaluationMs !== undefined
          ? { rootEvaluationMs: trace.rootEvaluationMs }
          : {}),
        ...(!trace.mctsProfile && trace.sequenceSearchMs !== undefined
          ? { sequenceSearchMs: trace.sequenceSearchMs }
          : {}),
        ...(!trace.mctsProfile && trace.responseSearchMs !== undefined
          ? { responseSearchMs: trace.responseSearchMs }
          : {}),
        ...(!trace.mctsProfile && trace.responseCandidateAnalysisMs !== undefined
          ? { responseCandidateAnalysisMs: trace.responseCandidateAnalysisMs }
          : {}),
        ...(!trace.mctsProfile && trace.responseCandidateDispatchMs !== undefined
          ? { responseCandidateDispatchMs: trace.responseCandidateDispatchMs }
          : {}),
        ...(!trace.mctsProfile && trace.responseCandidateObservationMs !== undefined
          ? { responseCandidateObservationMs: trace.responseCandidateObservationMs }
          : {}),
        ...(!trace.mctsProfile && trace.responseCandidateScoringMs !== undefined
          ? { responseCandidateScoringMs: trace.responseCandidateScoringMs }
          : {}),
        ...(!trace.mctsProfile && trace.responseActionGenerationMs !== undefined
          ? { responseActionGenerationMs: trace.responseActionGenerationMs }
          : {}),
        ...(!trace.mctsProfile && trace.responseReplayMs !== undefined
          ? { responseReplayMs: trace.responseReplayMs }
          : {}),
        ...(trace.mctsProfile ? { mctsDurationMs: trace.durationMs } : {}),
        ...(trace.mctsProfile ? { mctsProfile: trace.mctsProfile } : {}),
        timedOut: trace.timedOut,
        topCandidates: trace.candidates.slice(0, 3).map((candidate, index) => ({
          rank: index + 1,
          description: candidate.description,
          score: candidate.score,
          scoreComponents: candidate.scoreComponents
        }))
      }
    })
  }
}

function publicActionDiagnostic(
  before: ReturnType<GameBoardSession['getState']>,
  after: ReturnType<GameBoardSession['getState']>,
  participantId: PlayerId,
  profile: LocalProfile,
  command: TurnMatchCommand
): PublicActionDiagnostic {
  const beforeActor = before.players.find(
    (player) => player.participantId === participantId
  )!
  const afterActor = after.players.find(
    (player) => player.participantId === participantId
  )!
  const beforeOpponent = before.players.find(
    (player) => player.participantId !== participantId
  )!
  const afterOpponent = after.players.find(
    (player) => player.participantId !== participantId
  )!
  return {
    turnNumber: before.turnNumber,
    actor: profile,
    command: canonicalCommandKey(command),
    actorVitals: {
      before: {
        health: beforeActor.hero.health,
        armor: beforeActor.hero.armor
      },
      after: {
        health: afterActor.hero.health,
        armor: afterActor.hero.armor
      }
    },
    opponentVitals: {
      before: {
        health: beforeOpponent.hero.health,
        armor: beforeOpponent.hero.armor
      },
      after: {
        health: afterOpponent.hero.health,
        armor: afterOpponent.hero.armor
      }
    },
    phaseAfter: after.phase,
    winnerId: after.winnerId ?? null
  }
}

async function runBenchmark(options: BenchmarkOptions) {
  const initialMemory = process.memoryUsage()
  let peakRssBytes = initialMemory.rss
  let peakHeapUsedBytes = initialMemory.heapUsed
  const sampleMemory = (): void => {
    const current = process.memoryUsage()
    peakRssBytes = Math.max(peakRssBytes, current.rss)
    peakHeapUsedBytes = Math.max(peakHeapUsedBytes, current.heapUsed)
  }
  const memorySampler = setInterval(sampleMemory, 100)
  memorySampler.unref()
  const profileMetrics: Record<LocalProfile, MutableProfileMetrics> = {
    easy: emptyProfileMetrics(),
    expert: emptyProfileMetrics(),
    random: emptyProfileMetrics()
  }
  const matches: MatchResult[] = []

  for (let gameIndex = 0; gameIndex < options.games; gameIndex++) {
    const seed = uint32(options.seed + Math.floor(gameIndex / 2) * 0x9e3779b9)
    const firstGenerated = generateConstructedOpponent(seed, {
      archetypeId: 'beast-hunter'
    })
    const secondGenerated = generateConstructedOpponent(uint32(seed ^ 0xa511e9b3), {
      archetypeId: 'recruit-paladin'
    })
    const firstDeck = { ...firstGenerated.deck, id: 'benchmark-first-' + seed }
    const secondDeck = { ...secondGenerated.deck, id: 'benchmark-second-' + seed }
    const expertPlayerId = gameIndex % 2 === 0 ? FIRST_ID : SECOND_ID
    const profileByParticipant = new Map<string, LocalProfile>([
      [FIRST_ID, expertPlayerId === FIRST_ID ? 'expert' : options.baseline],
      [SECOND_ID, expertPlayerId === SECOND_ID ? 'expert' : options.baseline]
    ])
    // Keep the engine's AI-only hero-power bonus fixed to seat one so the mirrored
    // profile assignment gives each profile the same benefit once per pair.
    const setup: MatchSetup = {
      seed,
      startingParticipantId: FIRST_ID,
      participants: [
        {
          participantId: FIRST_ID,
          controllerKind: 'ai',
          heroId: firstDeck.heroId,
          deckId: firstDeck.id
        },
        {
          participantId: SECOND_ID,
          controllerKind: 'human',
          heroId: secondDeck.heroId,
          deckId: secondDeck.id
        }
      ]
    }
    const liveSession = new GameBoardSession({
      setup,
      decks: [firstDeck, secondDeck]
    })
    const profileById = profileByParticipant as ReadonlyMap<string, LocalProfile>
    const currentTurnStart = new Map<string, number>()
    const currentTurnKey = new Map<string, string>()
    const currentTurnActions = new Map<string, number>()
    const currentTurnSearchMs = new Map<string, number>()
    const continuations = new Map<string, BenchmarkContinuation>()
    const expertDecisionDiagnostics: ExpertDecisionDiagnostic[] = []
    const recentPublicActions: PublicActionDiagnostic[] = []
    let actions = 0
    let capped = false

    const finishTurn = (participantId: PlayerId, elapsedMs: number): void => {
      const profile = profileByParticipant.get(participantId)
      if (!profile) return
      profileMetrics[profile].turnMs.push(elapsedMs)
      profileMetrics[profile].turnActions.push(
        currentTurnActions.get(participantId) ?? 0
      )
      currentTurnActions.delete(participantId)
      currentTurnStart.delete(participantId)
      currentTurnKey.delete(participantId)
      currentTurnSearchMs.delete(participantId)
      continuations.delete(participantId)
    }

    while (liveSession.getState().phase !== 'ended' && actions < options.maxActions) {
      const state = liveSession.getState()
      if (state.phase === 'mulligan') {
        const player = state.players.find((entry) => !entry.mulliganConfirmed)
        if (!player)
          throw new Error('Benchmark match is stuck before mulligan completion.')
        const profile = profileByParticipant.get(player.participantId)!
        const started = performance.now()
        let outcome: DecisionOutcome
        const request: AiDecisionRequest = {
          matchId: 'local-ai-benchmark-' + seed + '-' + gameIndex,
          requestId: 'benchmark-mulligan-' + gameIndex + '-' + player.participantId,
          expectedRevision: state.revision,
          phase: 'mulligan',
          allowInspection: false,
          messages: [],
          actionIds: []
        }
        try {
          outcome = await decideProfile({
            request,
            profile,
            participantId: player.participantId,
            checkpoint: liveSession.match.getCheckpoint(),
            remainingTurnMs: EXPERT_MULLIGAN_BUDGET_MS,
            remainingSearchMs: EXPERT_MULLIGAN_BUDGET_MS,
            workBudget: options.workBudget,
            phase: 'mulligan'
          })
        } catch {
          outcome = {
            command: null,
            traces: [],
            worlds: 0,
            timedOut: false,
            failed: true
          }
        }
        recordDecision(profileMetrics[profile], performance.now() - started, outcome)
        const command = outcome.command ?? {
          type: 'confirm-mulligan' as const,
          participantId: player.participantId,
          replaceInstanceIds: []
        }
        if (!outcome.command) {
          profileMetrics[profile].fallbacks++
          if (outcome.timedOut) profileMetrics[profile].timeoutFallbacks++
          else if (outcome.failed) profileMetrics[profile].failedFallbacks++
          else profileMetrics[profile].invalidSelections++
        }
        let result = liveSession.match.dispatch(command)
        if (!result.accepted) {
          profileMetrics[profile].rejectedCommands++
          profileMetrics[profile].fallbacks++
          profileMetrics[profile].invalidSelections++
          result = liveSession.match.dispatch({
            type: 'confirm-mulligan',
            participantId: player.participantId,
            replaceInstanceIds: []
          })
        }
        if (!result.accepted)
          throw new Error('Benchmark mulligan fallback was rejected: ' + result.message)
        profileMetrics[profile].commands++
        continue
      }

      if (state.phase !== 'turns' || !state.activePlayerId)
        throw new Error('Unexpected benchmark match phase: ' + state.phase)

      const participantId = state.activePlayerId
      const profile = profileByParticipant.get(participantId)
      if (!profile) throw new Error('Missing AI profile for ' + participantId + '.')
      const turnKey = String(participantId) + ':' + state.turnNumber
      if (currentTurnKey.get(participantId) !== turnKey) {
        currentTurnKey.set(participantId, turnKey)
        currentTurnStart.set(participantId, performance.now())
        currentTurnActions.set(participantId, 0)
        currentTurnSearchMs.set(participantId, 0)
        continuations.delete(participantId)
      }
      const turnStarted = currentTurnStart.get(participantId)!
      const liveLegal = legalCommands(liveSession, participantId)
      if (!liveLegal.length)
        throw new Error(
          'No legal command for ' + participantId + ' on turn ' + state.turnNumber + '.'
        )
      const opposingPlayerId = state.players.find(
        (player) => player.participantId !== participantId
      )?.participantId
      const queuedContinuation = continuations.get(participantId)
      const exhaustedBudgetContinuation =
        profile === 'expert' &&
        opposingPlayerId &&
        queuedContinuation?.turn === state.turnNumber &&
        state.revision > queuedContinuation.expectedRevision
          ? queuedContinuation.actions.slice(
              queuedContinuation.nextIndex,
              queuedContinuation.nextIndex + 6
            )
          : undefined
      const nextContinuation = exhaustedBudgetContinuation?.[0]
      const preferredContinuation =
        nextContinuation &&
        opposingPlayerId &&
        liveLegal.some((command) =>
          sameAiIntent(nextContinuation, aiActionIntent(command, opposingPlayerId))
        )
          ? nextContinuation
          : undefined
      const request: AiDecisionRequest = {
        matchId: 'local-ai-benchmark-' + seed + '-' + gameIndex,
        requestId: 'benchmark-action-' + gameIndex + '-' + state.revision,
        expectedRevision: state.revision,
        phase: 'action',
        allowInspection: false,
        messages: [],
        actionIds: liveLegal.map((_command, index) => 'a' + index)
      }
      const decisionStarted = performance.now()
      const searchBudgetForTurn = Math.max(
        0,
        Math.min(
          EXPERT_AI_SEARCH_BUDGET_MS,
          options.turnBudgetMs -
            EXPERT_AI_PRESENTATION_RESERVE_MS -
            EXPERT_AI_DISPATCH_RESERVE_MS
        )
      )
      let outcome: DecisionOutcome
      try {
        outcome = await decideProfile({
          request,
          profile,
          participantId,
          checkpoint: liveSession.match.getCheckpoint(),
          remainingTurnMs:
            options.workBudget === undefined
              ? options.turnBudgetMs - (decisionStarted - turnStarted)
              : options.turnBudgetMs,
          remainingSearchMs:
            options.workBudget === undefined
              ? searchBudgetForTurn - (currentTurnSearchMs.get(participantId) ?? 0)
              : searchBudgetForTurn,
          workBudget: options.workBudget,
          preferredContinuation,
          exhaustedBudgetContinuation,
          phase: 'action',
          liveLegalCommands: liveLegal
        })
      } catch {
        outcome = {
          command: null,
          traces: [],
          worlds: 0,
          timedOut: false,
          failed: true
        }
      }
      const decisionElapsedMs = performance.now() - decisionStarted
      currentTurnSearchMs.set(
        participantId,
        (currentTurnSearchMs.get(participantId) ?? 0) + decisionElapsedMs
      )
      recordDecision(profileMetrics[profile], decisionElapsedMs, outcome)

      let command = outcome.command
      if (!command) {
        profileMetrics[profile].fallbacks++
        if (outcome.timedOut) profileMetrics[profile].timeoutFallbacks++
        else if (outcome.failed) profileMetrics[profile].failedFallbacks++
        else profileMetrics[profile].invalidSelections++
        command =
          (profile === 'expert' && outcome.timedOut
            ? selectExpertTimeoutFallbackAction(liveSession, liveLegal)?.command
            : undefined) ??
          liveLegal.find((entry) => entry.type === 'end-turn') ??
          liveLegal[0]!
      }
      let result = liveSession.match.dispatch(command)
      if (!result.accepted) {
        profileMetrics[profile].rejectedCommands++
        profileMetrics[profile].fallbacks++
        profileMetrics[profile].invalidSelections++
        const fallback =
          liveLegal.find((entry) => entry.type === 'end-turn') ?? liveLegal[0]!
        result = liveSession.match.dispatch(fallback)
        command = fallback
      }
      if (!result.accepted)
        throw new Error('Benchmark action fallback was rejected: ' + result.message)
      if (
        profile === 'expert' &&
        outcome.command &&
        outcome.plannedActionIntents?.length &&
        opposingPlayerId &&
        sameAiIntent(
          outcome.plannedActionIntents[0]!,
          aiActionIntent(command, opposingPlayerId)
        )
      ) {
        continuations.set(participantId, {
          turn: state.turnNumber,
          expectedRevision: state.revision,
          nextIndex: 1,
          actions: outcome.plannedActionIntents
        })
      } else {
        continuations.delete(participantId)
      }
      if (options.traceLosses) {
        recentPublicActions.push(
          publicActionDiagnostic(state, result.state, participantId, profile, command)
        )
        if (recentPublicActions.length > 24) recentPublicActions.shift()
      }
      if (options.traceLosses && profile === 'expert')
        expertDecisionDiagnostics.push(
          expertDecisionDiagnostic(state, participantId, outcome, command)
        )
      profileMetrics[profile].commands++
      currentTurnActions.set(
        participantId,
        (currentTurnActions.get(participantId) ?? 0) + 1
      )
      actions++
      if (command.type === 'end-turn') {
        profileMetrics[profile].endTurns++
        finishTurn(participantId, performance.now() - turnStarted)
      } else if (result.state.phase === 'ended') {
        finishTurn(participantId, performance.now() - turnStarted)
      }
    }

    const finalState = liveSession.getState()
    const complete = finalState.phase === 'ended'
    if (!complete) {
      capped = true
      for (const profile of ['expert', options.baseline] as const)
        profileMetrics[profile].cappedGames++
    }
    const winner = complete ? profileForWinner(finalState.winnerId, profileById) : null
    if (winner) {
      profileMetrics[winner].wins++
      profileMetrics[winner === 'expert' ? options.baseline : 'expert'].losses++
    } else if (complete) {
      profileMetrics[options.baseline].draws++
      profileMetrics.expert.draws++
    }
    matches.push({
      seed,
      expertPlayer: expertPlayerId,
      decks: [
        {
          id: firstDeck.id,
          heroId: firstDeck.heroId,
          archetype: firstGenerated.metadata.archetype
        },
        {
          id: secondDeck.id,
          heroId: secondDeck.heroId,
          archetype: secondGenerated.metadata.archetype
        }
      ],
      status: capped ? 'capped' : winner ? 'completed' : 'draw',
      winner,
      actions,
      turnNumber: finalState.turnNumber
    })
    console.log(
      'LOCAL_AI_BENCHMARK_GAME ' + JSON.stringify(matches[matches.length - 1])
    )
    if (options.traceLosses && winner !== 'expert')
      console.log(
        'LOCAL_AI_BENCHMARK_EXPERT_LOSS_TRACE ' +
          JSON.stringify({
            seed,
            gameIndex,
            winner,
            decisions: expertDecisionDiagnostics,
            recentPublicActions,
            finalPublicState: {
              turnNumber: finalState.turnNumber,
              phase: finalState.phase,
              winnerId: finalState.winnerId,
              players: finalState.players.map((player) => ({
                heroId: player.heroId,
                health: player.hero.health,
                armor: player.hero.armor,
                board: player.board.map((minion) => ({
                  cardId: minion.cardId,
                  attack: minion.attack,
                  health: minion.health,
                  keywords: [...(minion.keywords ?? [])]
                }))
              }))
            }
          })
      )
  }

  const summarize = (metrics: MutableProfileMetrics) => ({
    wins: metrics.wins,
    losses: metrics.losses,
    draws: metrics.draws,
    cappedGames: metrics.cappedGames,
    decisions: metrics.decisions,
    commands: metrics.commands,
    endTurns: metrics.endTurns,
    worldsEvaluated: metrics.worldsEvaluated,
    fallbacks: metrics.fallbacks,
    timeoutFallbacks: metrics.timeoutFallbacks,
    continuedLineFallbacks: metrics.continuedLineFallbacks,
    failedFallbacks: metrics.failedFallbacks,
    failedDecisions: metrics.failedDecisions,
    invalidSelections: metrics.invalidSelections,
    rejectedCommands: metrics.rejectedCommands,
    timedOutSearches: metrics.timedOutSearches,
    continuationPreferencesOffered: metrics.continuationPreferencesOffered,
    continuationPreferencesMatched: metrics.continuationPreferencesMatched,
    turnBudgetViolations: metrics.turnMs.filter(
      (durationMs) => durationMs > options.turnBudgetMs
    ).length,
    evaluatedCandidates: metrics.evaluatedCandidates,
    mcts: {
      iterations: metrics.mctsIterations,
      opponentActionsSimulated: metrics.mctsOpponentActionsSimulated,
      opponentCardPlaysSimulated: metrics.mctsOpponentCardPlaysSimulated,
      candidateCacheHits: metrics.mctsCandidateCacheHits,
      candidateCacheMisses: metrics.mctsCandidateCacheMisses,
      averageTreeDepth:
        metrics.mctsIterations > 0
          ? Math.round((metrics.mctsTreeDepthTotal / metrics.mctsIterations) * 100) /
            100
          : null,
      averageRolloutDepth:
        metrics.mctsIterations > 0
          ? Math.round((metrics.mctsRolloutDepthTotal / metrics.mctsIterations) * 100) /
            100
          : null,
      maximumRolloutDepth: metrics.mctsMaximumRolloutDepth,
      profileTimingMs: metrics.mctsProfileTimingMs
    },
    sequenceNodes: metrics.sequenceNodes,
    responseNodes: metrics.responseNodes,
    responseCardPlayNodes: metrics.responseCardPlayNodes,
    workUnits: metrics.workUnits,
    workBudgetHits: metrics.workBudgetHits,
    rootEvaluationLatency: latencySummary(metrics.rootEvaluationMs),
    sequenceSearchLatency: latencySummary(metrics.sequenceSearchMs),
    responseSearchLatency: latencySummary(metrics.responseSearchMs),
    responseCandidateAnalysisLatency: latencySummary(
      metrics.responseCandidateAnalysisMs
    ),
    responseCandidateDispatchLatency: latencySummary(
      metrics.responseCandidateDispatchMs
    ),
    responseCandidateObservationLatency: latencySummary(
      metrics.responseCandidateObservationMs
    ),
    responseCandidateScoringLatency: latencySummary(metrics.responseCandidateScoringMs),
    responseActionGenerationLatency: latencySummary(metrics.responseActionGenerationMs),
    responseReplayLatency: latencySummary(metrics.responseReplayMs),
    decisionLatency: latencySummary(metrics.decisionMs),
    fullTurnLatency: latencySummary(metrics.turnMs),
    actionsPerTurn: countSummary(metrics.turnActions)
  })

  clearInterval(memorySampler)
  sampleMemory()
  const endingMemory = process.memoryUsage()
  return {
    benchmark: 'local-ai-midrange-vs-baseline',
    benchmarkVersion: 3,
    generatorVersion: OPPONENT_GENERATOR_VERSION,
    configuration: options,
    measurement:
      'Headless CPU decision plus synchronous domain dispatch; excludes Pixi rendering and animations.',
    runtime: {
      nodeVersion: process.version,
      platform: platform(),
      osRelease: release(),
      architecture: process.arch,
      cpuModel: cpus()[0]?.model ?? null,
      logicalCpuCount: cpus().length,
      totalMemoryBytes: totalmem()
    },
    memory: {
      scope: 'Whole Vitest benchmark process, sampled every 100 ms; not worker-only.',
      startingRssBytes: initialMemory.rss,
      peakRssBytes,
      endingRssBytes: endingMemory.rss,
      peakHeapUsedBytes
    },
    profiles: {
      baseline: options.baseline,
      matchup: summarize(profileMetrics[options.baseline]),
      expert: summarize(profileMetrics.expert)
    },
    matches
  }
}

describe.skipIf(!ENABLED)('local AI matchup benchmark', () => {
  it('compares seeded Midrange matches with a mirrored baseline assignment', async () => {
    const options = readOptions()
    const result = await runBenchmark(options)
    console.log('LOCAL_AI_BENCHMARK_JSON ' + JSON.stringify(result))
    expect(result.matches).toHaveLength(options.games)
    expect(result.profiles.expert.invalidSelections).toEqual(expect.any(Number))
    expect(result.profiles.expert.rejectedCommands).toBe(0)
  }, 3_600_000)
})
