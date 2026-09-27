import { cpus, platform, release, totalmem } from 'node:os'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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
import { canonicalCommandKey } from '../../../game/match/ai/legal-commands'
import {
  AiRequestError,
  type AiDecisionRequest,
  type AiDecisionResponse
} from '../../../shared/ipc/ai'
import {
  expertAiBudgetForTurn,
  EXPERT_AI_TURN_BUDGET_MS
} from './expert-ai-worker-protocol'
import { aiActions } from './ai-context'
import { selectExpertTimeoutFallbackAction } from './expert-ai-timeout-fallback'
import { forcedLegalCommand } from './ai-forced-command'
import {
  ExpertAiDecisionApi,
  invalidatesExpertContinuation
} from './expert-ai-decision-api'
import { runExpertAiWorkerDecision } from './expert-ai.worker'
import type {
  ExpertAiWorkerRequest,
  ExpertAiWorkerResponse
} from './expert-ai-worker-protocol'
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
// The headless benchmark evaluates three concurrent production worlds serially.
const SERIAL_BENCHMARK_WORKER_TIMEOUT_MULTIPLIER = 3

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
  forcedActionCommands: number
  searchedActionCommands: number
  continuedActionCommands: number
  fallbackActionCommands: number
  fallbackTimeoutActions: number
  fallbackWorkerFailureActions: number
  fallbackInvalidActions: number
  continuationInvalidations: number
  commands: number
  endTurns: number
  worldsEvaluated: number
  fallbacks: number
  timeoutFallbacks: number
  continuedLineFallbacks: number
  failedFallbacks: number
  failedDecisions: number
  decisionFailureMessages: string[]
  timeoutMessages: string[]
  invalidSelections: number
  rejectedCommands: number
  timedOutSearches: number
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
  readonly workerDecisionMs: number[]
  readonly turnMs: number[]
  readonly workerTurnMs: number[]
  readonly turnActions: number[]
  readonly turnBudgetMisses: {
    readonly participantId: string
    readonly turn: number
    readonly durationMs: number
  }[]
  readonly worldIterations: number[]
  readonly rootActionCoverage: number[]
  readonly topRootActionShare: number[]
}

interface MatchResult {
  readonly seed: number
  readonly expertPlayer: string
  readonly decks: readonly {
    readonly id: string
    readonly heroId: string
    readonly archetype: string
    readonly cards: readonly { readonly cardId: string; readonly count: number }[]
    readonly sha256: string
  }[]
  readonly status: 'completed' | 'draw' | 'capped'
  readonly winner: LocalProfile | null
  readonly actions: number
  readonly turnNumber: number
  readonly invalidSelections: number
  readonly rejectedCommands: number
}

interface InvalidSelectionDiagnostic {
  readonly gameIndex: number
  readonly seed: number
  readonly profile: LocalProfile
  readonly phase: 'mulligan' | 'action'
  readonly turnNumber: number
  readonly revision: number
  readonly participantId: string
  readonly source: 'no-command' | 'rejected-command'
  readonly actionSource: DecisionOutcome['actionSource'] | null
  readonly fallbackKind: DecisionOutcome['fallbackKind'] | null
  readonly selectedActionId: string | null
  readonly selectedDescription: string | null
  readonly failureMessage: string | null
  readonly attemptedCommand: TurnMatchCommand | null
  readonly rejectionCode?: string
  readonly rejectionMessage?: string
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
  readonly actionSource: DecisionOutcome['actionSource'] | null
  readonly fallbackKind: DecisionOutcome['fallbackKind'] | null
  readonly timedOut: boolean
  readonly failureMessage: string | null
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
  readonly selectedActionId?: string | null
  readonly selectedDescription?: string | null
  readonly actionSource?: 'forced' | 'search' | 'continuation' | 'fallback'
  readonly fallbackKind?: 'timeout' | 'worker-failure' | 'invalid' | 'continued-line'
  readonly workerDurationMs?: number
  readonly failureMessage?: string
  readonly failed?: boolean
}

interface DecisionRequestOptions {
  readonly request: AiDecisionRequest
  readonly profile: LocalProfile
  readonly participantId: PlayerId
  readonly checkpoint: OpeningMatchCheckpoint
  readonly workBudget?: number
  readonly phase: 'action' | 'mulligan'
  readonly liveLegalCommands?: readonly TurnMatchCommand[]
  readonly liveSession?: GameBoardSession
  readonly expertRuntime?: ExpertBenchmarkRuntime
  readonly planBeforeAction?: boolean
}

class InlineExpertWorker {
  private readonly listeners = new Map<
    string,
    Set<EventListenerOrEventListenerObject>
  >()
  private readonly cancelled = new Set<string>()
  private readonly activeApis = new Map<string, LocalAiDecisionApi[]>()
  private readonly traces: LocalAiDecisionTrace[] = []

  constructor(private readonly clock: BenchmarkWorkerClock) {}

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  postMessage(message: ExpertAiWorkerRequest): void {
    if (message.type === 'cancel') {
      const requestId = message.identity.requestId
      this.cancelled.add(requestId)
      for (const api of this.activeApis.get(requestId) ?? [])
        void api.cancel(message.identity)
      return
    }

    const requestId = message.request.requestId
    const apis: LocalAiDecisionApi[] = []
    const firstTraceIndex = this.traces.length
    this.activeApis.set(requestId, apis)
    this.cancelled.delete(requestId)
    void runExpertAiWorkerDecision(message, {
      isCancelled: () => this.cancelled.has(requestId),
      onApiCreated: (api) => apis.push(api),
      onWorldCompleted: (_response, trace) => {
        if (trace) this.traces.push(trace)
      }
    })
      .then((response) => {
        if (!response || this.cancelled.has(requestId)) return
        const workerDurationMs = Math.max(
          0,
          ...this.traces.slice(firstTraceIndex).map((trace) => trace.durationMs)
        )
        this.clock.advance(workerDurationMs)
        this.emit({
          type: 'decision',
          requestId,
          response: { ...response, durationMs: workerDurationMs }
        })
      })
      .catch((error: unknown) => {
        if (this.cancelled.has(requestId)) return
        this.emit({
          type: 'failure',
          requestId,
          error: error instanceof Error ? error.message : String(error)
        })
      })
      .finally(() => {
        this.activeApis.delete(requestId)
        this.cancelled.delete(requestId)
      })
  }

  takeTraces(): LocalAiDecisionTrace[] {
    return this.traces.splice(0)
  }

  terminate(): void {
    for (const requestId of this.activeApis.keys()) this.cancelled.add(requestId)
    this.listeners.clear()
  }

  private emit(message: ExpertAiWorkerResponse): void {
    const event = { data: message } as MessageEvent<ExpertAiWorkerResponse>
    for (const listener of this.listeners.get('message') ?? []) {
      if (typeof listener === 'function') listener(event as MessageEvent)
      else listener.handleEvent(event as MessageEvent)
    }
  }
}

interface ExpertBenchmarkRuntime {
  readonly api: ExpertAiDecisionApi
  readonly takeTraces: () => LocalAiDecisionTrace[]
  readonly now: () => number
}

class BenchmarkWorkerClock {
  private value = performance.now()

  now = (): number => this.value

  advance(milliseconds: number): void {
    if (Number.isFinite(milliseconds)) this.value += Math.max(0, milliseconds)
  }
}

function createExpertBenchmarkRuntime(
  session: GameBoardSession,
  perspectiveParticipantId: PlayerId,
  turnBudgetMs: number
): ExpertBenchmarkRuntime {
  let worker: InlineExpertWorker | null = null
  const clock = new BenchmarkWorkerClock()
  const api = new ExpertAiDecisionApi(
    session,
    () => {
      worker = new InlineExpertWorker(clock)
      return worker as unknown as Worker
    },
    clock.now,
    perspectiveParticipantId,
    SERIAL_BENCHMARK_WORKER_TIMEOUT_MULTIPLIER,
    expertAiBudgetForTurn(turnBudgetMs)
  )
  return { api, takeTraces: () => worker?.takeTraces() ?? [], now: clock.now }
}

function emptyProfileMetrics(): MutableProfileMetrics {
  return {
    wins: 0,
    losses: 0,
    draws: 0,
    cappedGames: 0,
    decisions: 0,
    forcedActionCommands: 0,
    searchedActionCommands: 0,
    continuedActionCommands: 0,
    fallbackActionCommands: 0,
    fallbackTimeoutActions: 0,
    fallbackWorkerFailureActions: 0,
    fallbackInvalidActions: 0,
    continuationInvalidations: 0,
    commands: 0,
    endTurns: 0,
    worldsEvaluated: 0,
    fallbacks: 0,
    timeoutFallbacks: 0,
    continuedLineFallbacks: 0,
    failedFallbacks: 0,
    failedDecisions: 0,
    decisionFailureMessages: [],
    timeoutMessages: [],
    invalidSelections: 0,
    rejectedCommands: 0,
    timedOutSearches: 0,
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
    workerDecisionMs: [],
    turnMs: [],
    workerTurnMs: [],
    turnActions: [],
    turnBudgetMisses: [],
    worldIterations: [],
    rootActionCoverage: [],
    topRootActionShare: []
  }
}

function percentile(values: readonly number[], percentileValue: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  return Math.round(
    sorted[Math.max(0, Math.ceil(sorted.length * percentileValue) - 1)]!
  )
}

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

function sourceProvenance() {
  const sourceRoots = [
    'src/renderer/features/game',
    'src/game/match',
    'src/game/content/cards',
    'src/game/decks/opponent-generator.ts'
  ]
  const files: string[] = []
  const visit = (absolutePath: string): void => {
    const entries = readdirSync(absolutePath, { withFileTypes: true })
    for (const entry of entries) {
      const path = resolve(absolutePath, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (
        /\.(ts|tsx|json)$/.test(entry.name) &&
        !/\.(test|spec)\.tsx?$/.test(entry.name) &&
        !entry.name.endsWith('.d.ts')
      )
        files.push(path)
    }
  }
  for (const relativePath of sourceRoots) {
    const absolutePath = resolve(REPOSITORY_ROOT, relativePath)
    if (relativePath.endsWith('.ts')) files.push(absolutePath)
    else visit(absolutePath)
  }
  files.sort()
  const hash = createHash('sha256')
  for (const path of files) {
    hash.update(path.slice(REPOSITORY_ROOT.length).replaceAll('\\', '/') + '\0')
    hash.update(readFileSync(path))
  }
  return {
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8'
    }).trim(),
    dirtyFiles: execFileSync('git', ['status', '--short'], {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8'
    })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean),
    sourceFileCount: files.length,
    sourceSha256: hash.digest('hex')
  }
}

function deckManifest(deck: {
  readonly id: string
  readonly heroId: string
  readonly cards: Readonly<Record<string, number>>
}) {
  const cards = Object.entries(deck.cards)
    .map(([cardId, count]) => ({ cardId, count }))
    .sort((left, right) => left.cardId.localeCompare(right.cardId))
  const sha256 = createHash('sha256')
    .update(JSON.stringify({ heroId: deck.heroId, cards }))
    .digest('hex')
  return { id: deck.id, heroId: deck.heroId, cards, sha256 }
}

function studentTCritical95(sampleCount: number): number {
  const table: Record<number, number> = {
    1: 12.706,
    2: 4.303,
    3: 3.182,
    4: 2.776,
    5: 2.571,
    6: 2.447,
    7: 2.365,
    8: 2.306,
    9: 2.262,
    10: 2.228
  }
  const degreesOfFreedom = sampleCount - 1
  if (degreesOfFreedom <= 0) return Number.POSITIVE_INFINITY
  if (table[degreesOfFreedom]) return table[degreesOfFreedom]!
  const z = 1.959963984540054
  const df = degreesOfFreedom
  return (
    z +
    (z ** 3 + z) / (4 * df) +
    (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2) +
    (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * df ** 3)
  )
}

function pairedWinRate(matches: readonly MatchResult[]) {
  const bySeed = new Map<number, MatchResult[]>()
  for (const match of matches) {
    const pair = bySeed.get(match.seed) ?? []
    pair.push(match)
    bySeed.set(match.seed, pair)
  }
  const scores: number[] = []
  let omittedPairs = 0
  for (const pair of bySeed.values()) {
    if (
      pair.length !== 2 ||
      pair.some((match) => match.status === 'capped') ||
      pair[0]!.expertPlayer === pair[1]!.expertPlayer
    ) {
      omittedPairs++
      continue
    }
    scores.push(
      pair.reduce(
        (total, match) =>
          total + (match.winner === 'expert' ? 1 : match.winner === null ? 0.5 : 0),
        0
      ) / pair.length
    )
  }
  const mean = scores.length
    ? scores.reduce((total, score) => total + score, 0) / scores.length
    : null
  const variance =
    scores.length > 1 && mean !== null
      ? scores.reduce((total, score) => total + (score - mean) ** 2, 0) /
        (scores.length - 1)
      : null
  const margin =
    mean !== null && variance !== null
      ? (studentTCritical95(scores.length) * Math.sqrt(variance)) /
        Math.sqrt(scores.length)
      : null
  return {
    pairedSeedCount: scores.length,
    omittedPairCount: omittedPairs,
    pointEstimate: mean,
    confidence95:
      margin === null
        ? null
        : {
            lower: Math.max(0, mean! - margin),
            upper: Math.min(1, mean! + margin),
            method: 'Student-t interval over paired seat-rotated seed scores.'
          }
  }
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
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null
  }
}

function ratioSummary(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right)
  const at = (fraction: number): number | null =>
    sorted.length
      ? Math.round(
          sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]! * 1_000
        ) / 1_000
      : null
  return {
    count: sorted.length,
    mean: sorted.length
      ? Math.round(
          (sorted.reduce((total, value) => total + value, 0) / sorted.length) * 1_000
        ) / 1_000
      : null,
    p50: at(0.5),
    p95: at(0.95),
    min: sorted.length ? Math.round(sorted[0]! * 1_000) / 1_000 : null,
    max: sorted.length ? Math.round(sorted[sorted.length - 1]! * 1_000) / 1_000 : null
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

async function decideExpertProfile(
  options: DecisionRequestOptions
): Promise<DecisionOutcome> {
  const runtime = options.expertRuntime
  const session = options.liveSession
  if (!runtime || !session)
    throw new Error('Expert benchmark requires the live worker/API runtime.')

  if (options.phase === 'action') {
    const legal = options.liveLegalCommands ?? []
    const forced = forcedLegalCommand(legal)
    if (forced)
      return {
        command: forced,
        traces: [],
        worlds: 0,
        timedOut: false,
        actionSource: 'forced'
      }
  }

  const actionSourceFrom = (response: AiDecisionResponse) => {
    if (response.finishReason === 'expert-continuation-fallback')
      return 'fallback' as const
    if (
      response.finishReason === 'expert-continuation' ||
      response.finishReason === 'expert-plan-commit-cache'
    )
      return 'continuation' as const
    return 'search' as const
  }

  try {
    if (options.phase === 'mulligan') {
      const response = await runtime.api.decide(options.request)
      const traces = runtime.takeTraces()
      const choice = response.choice
      const command =
        'replace' in choice
          ? {
              type: 'confirm-mulligan' as const,
              participantId: options.participantId,
              replaceInstanceIds: [...choice.replace]
            }
          : null
      return {
        command,
        traces,
        worlds: traces.length,
        timedOut: false,
        workerDurationMs: response.durationMs,
        failed: !command
      }
    }

    const liveLegal = options.liveLegalCommands ?? []
    const actions = aiActions(session, liveLegal, options.participantId)
    const request: AiDecisionRequest = {
      ...options.request,
      phase: 'action',
      actionIds: actions.map((action) => action.id)
    }
    let response: AiDecisionResponse
    let actionSource: DecisionOutcome['actionSource']
    let traces: LocalAiDecisionTrace[] = []
    let workerDurationMs = 0

    if (options.planBeforeAction) {
      const planResponse = await runtime.api.decide({ ...request, phase: 'plan' })
      traces = runtime.takeTraces()
      workerDurationMs = planResponse.durationMs
      if (!('plan' in planResponse.choice))
        throw new Error('Expert planning returned an executable action.')
      response = await runtime.api.decide(request)
      actionSource = actionSourceFrom(planResponse)
    } else {
      response = await runtime.api.decide(request)
      traces = runtime.takeTraces()
      workerDurationMs = response.durationMs
      actionSource = actionSourceFrom(response)
    }

    if (!('actionId' in response.choice))
      return {
        command: null,
        traces,
        worlds: traces.length,
        timedOut: false,
        actionSource: 'fallback',
        fallbackKind: 'invalid',
        selectedActionId: null,
        selectedDescription: response.reason,
        failureMessage: 'Expert action response did not contain an actionId.'
      }
    const selectedActionId = response.choice.actionId
    const selected = actions.find((action) => action.id === selectedActionId)
    if (
      !selected ||
      !liveLegal.some(
        (command) =>
          canonicalCommandKey(command) === canonicalCommandKey(selected.command)
      )
    )
      return {
        command: null,
        traces,
        worlds: traces.length,
        timedOut: false,
        actionSource: 'fallback',
        fallbackKind: 'invalid',
        selectedActionId,
        selectedDescription: selected?.description ?? null,
        failureMessage: selected
          ? 'Expert selected a command that was absent from the live legal set.'
          : `Expert selected unknown action id ${selectedActionId}.`
      }

    return {
      command: selected.command,
      traces,
      worlds: traces.length,
      timedOut: false,
      selectedActionId,
      selectedDescription: selected.description,
      actionSource,
      workerDurationMs,
      ...(response.finishReason === 'expert-continuation-fallback'
        ? { fallbackKind: 'continued-line' as const }
        : {})
    }
  } catch (error) {
    const timedOut =
      error instanceof AiRequestError && error.details?.failureKind === 'timeout'
    return {
      command: null,
      traces: runtime.takeTraces(),
      worlds: 0,
      timedOut,
      failed: !timedOut,
      failureMessage: error instanceof Error ? error.message : String(error),
      ...(options.phase === 'action'
        ? {
            actionSource: 'fallback' as const,
            fallbackKind: timedOut ? ('timeout' as const) : ('worker-failure' as const)
          }
        : {})
    }
  }
}

async function decideProfile(
  options: DecisionRequestOptions
): Promise<DecisionOutcome> {
  const { request, profile, participantId, checkpoint, phase, liveLegalCommands } =
    options
  if (phase === 'action') {
    const forced = forcedLegalCommand(liveLegalCommands ?? [])
    if (forced)
      return {
        command: forced,
        traces: [],
        worlds: 0,
        timedOut: false,
        actionSource: 'forced'
      }
  }
  if (profile === 'expert') return decideExpertProfile(options)
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
  // V1 is measured in its historical live-information mode; its known fairness
  // limitation is the reason to retire it, not something to repair here.
  const session = createPerspectiveSession(checkpoint, participantId)
  const legal = legalCommands(session, participantId)
  const actions = aiActions(session, legal)
  const budgetMs = phase === 'mulligan' ? EXPERT_MULLIGAN_BUDGET_MS - 500 : 2_850
  const api = new LocalAiDecisionApi(session, undefined, {
    profile: 'easy',
    budgetMs,
    ...(options.workBudget !== undefined ? { workBudget: options.workBudget } : {}),
    fairHypothesis: false
  })
  const response = await api.decide({
    ...request,
    actionIds: actions.map((action) => action.id)
  })
  const trace = api.getLastTrace()
  const traces = trace ? [trace] : []
  let selectedCommand: TurnMatchCommand | null = null

  if (phase === 'mulligan') {
    const choice = response.choice
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
      worlds: 1,
      timedOut: false
    }
  }

  if (!actions.length) {
    return {
      command: null,
      traces,
      worlds: 1,
      timedOut: false
    }
  }
  const selectedId = 'actionId' in response.choice ? response.choice.actionId : null
  const selectedAction = actions.find((action) => action.id === selectedId)
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

  return {
    command: selectedCommand,
    traces,
    worlds: 1,
    timedOut: false,
    workerDurationMs: trace?.durationMs ?? 0,
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
  if (outcome.workerDurationMs !== undefined)
    metrics.workerDecisionMs.push(outcome.workerDurationMs)
  metrics.worldsEvaluated += outcome.worlds
  if (outcome.failed) {
    metrics.failedDecisions++
    if (outcome.failureMessage && metrics.decisionFailureMessages.length < 12)
      metrics.decisionFailureMessages.push(outcome.failureMessage)
  }
  if (
    outcome.timedOut &&
    outcome.failureMessage &&
    metrics.timeoutMessages.length < 12 &&
    !metrics.timeoutMessages.includes(outcome.failureMessage)
  )
    metrics.timeoutMessages.push(outcome.failureMessage)
  if (outcome.timedOut && !outcome.traces.length) metrics.timedOutSearches++
  for (const trace of outcome.traces) {
    metrics.evaluatedCandidates += trace.evaluatedActions
    if (trace.mctsProfile) {
      const profile = trace.mctsProfile
      const iterations = trace.sequenceNodes ?? 0
      metrics.mctsIterations += iterations
      metrics.worldIterations.push(iterations)
      if (trace.rootLegalActionCount && trace.rootLegalActionCount > 0) {
        const distribution = trace.rootVisitDistribution ?? []
        const visits = distribution.reduce((total, action) => total + action.visits, 0)
        metrics.rootActionCoverage.push(
          Math.min(1, distribution.length / trace.rootLegalActionCount)
        )
        metrics.topRootActionShare.push(
          visits > 0
            ? Math.max(...distribution.map((action) => action.visits)) / visits
            : 0
        )
      }
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

function recordActionSource(
  metrics: MutableProfileMetrics,
  source: NonNullable<DecisionOutcome['actionSource']>,
  fallbackKind?: DecisionOutcome['fallbackKind']
): void {
  if (source === 'forced') {
    metrics.forcedActionCommands++
    return
  }
  if (source === 'search') {
    metrics.searchedActionCommands++
    return
  }
  if (source === 'continuation') {
    metrics.continuedActionCommands++
    return
  }
  metrics.fallbackActionCommands++
  metrics.fallbacks++
  if (fallbackKind === 'timeout') metrics.fallbackTimeoutActions++
  else if (fallbackKind === 'worker-failure') metrics.fallbackWorkerFailureActions++
  else if (fallbackKind === 'invalid') metrics.fallbackInvalidActions++
  else if (fallbackKind === 'continued-line') metrics.continuedLineFallbacks++
  if (fallbackKind === 'timeout') metrics.timeoutFallbacks++
  else if (fallbackKind === 'worker-failure') metrics.failedFallbacks++
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
    actionSource: outcome.actionSource ?? null,
    fallbackKind: outcome.fallbackKind ?? null,
    timedOut: outcome.timedOut,
    failureMessage: outcome.failureMessage ?? null,
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
  const benchmarkStartedAt = performance.now()
  const provenance = sourceProvenance()
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
  const invalidSelectionDiagnostics: InvalidSelectionDiagnostic[] = []

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
    const expertRuntime = createExpertBenchmarkRuntime(
      liveSession,
      expertPlayerId,
      options.turnBudgetMs
    )
    const profileById = profileByParticipant as ReadonlyMap<string, LocalProfile>
    const currentTurnStart = new Map<string, number>()
    const currentTurnKey = new Map<string, string>()
    const currentTurnActions = new Map<string, number>()
    const currentTurnWorkerMs = new Map<string, number>()
    const expertDecisionDiagnostics: ExpertDecisionDiagnostic[] = []
    const recentPublicActions: PublicActionDiagnostic[] = []
    let actions = 0
    let capped = false
    let expertPlannedTurn: number | null = null
    const gameInvalidSelectionDiagnostics: InvalidSelectionDiagnostic[] = []
    const recordInvalidSelection = (diagnostic: InvalidSelectionDiagnostic): void => {
      invalidSelectionDiagnostics.push(diagnostic)
      gameInvalidSelectionDiagnostics.push(diagnostic)
      process.stderr.write(
        'LOCAL_AI_BENCHMARK_INVALID ' + JSON.stringify(diagnostic) + '\n'
      )
    }

    const finishTurn = (
      participantId: PlayerId,
      turnNumber: number,
      elapsedMs: number
    ): void => {
      const profile = profileByParticipant.get(participantId)
      if (!profile) return
      profileMetrics[profile].turnMs.push(elapsedMs)
      if (elapsedMs > options.turnBudgetMs)
        profileMetrics[profile].turnBudgetMisses.push({
          participantId,
          turn: turnNumber,
          durationMs: Math.round(elapsedMs)
        })
      profileMetrics[profile].turnActions.push(
        currentTurnActions.get(participantId) ?? 0
      )
      profileMetrics[profile].workerTurnMs.push(
        currentTurnWorkerMs.get(participantId) ?? 0
      )
      currentTurnActions.delete(participantId)
      currentTurnWorkerMs.delete(participantId)
      currentTurnStart.delete(participantId)
      currentTurnKey.delete(participantId)
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
            workBudget: options.workBudget,
            phase: 'mulligan',
            liveSession,
            expertRuntime
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
          else {
            profileMetrics[profile].invalidSelections++
            recordInvalidSelection({
              gameIndex,
              seed,
              profile,
              phase: 'mulligan',
              turnNumber: state.turnNumber,
              revision: state.revision,
              participantId: player.participantId,
              source: 'no-command',
              actionSource: outcome.actionSource ?? null,
              fallbackKind: outcome.fallbackKind ?? 'invalid',
              selectedActionId: outcome.selectedActionId ?? null,
              selectedDescription: outcome.selectedDescription ?? null,
              failureMessage: outcome.failureMessage ?? null,
              attemptedCommand: null
            })
          }
        }
        let result = liveSession.match.dispatch(command)
        if (!result.accepted) {
          profileMetrics[profile].rejectedCommands++
          profileMetrics[profile].fallbacks++
          profileMetrics[profile].invalidSelections++
          recordInvalidSelection({
            gameIndex,
            seed,
            profile,
            phase: 'mulligan',
            turnNumber: state.turnNumber,
            revision: state.revision,
            participantId: player.participantId,
            source: 'rejected-command',
            actionSource: outcome.actionSource ?? null,
            fallbackKind: outcome.fallbackKind ?? null,
            selectedActionId: outcome.selectedActionId ?? null,
            selectedDescription: outcome.selectedDescription ?? null,
            failureMessage: outcome.failureMessage ?? null,
            attemptedCommand: command,
            rejectionCode: result.code,
            rejectionMessage: result.message
          })
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
        currentTurnStart.set(
          participantId,
          profile === 'expert' ? expertRuntime.now() : performance.now()
        )
        currentTurnActions.set(participantId, 0)
        currentTurnWorkerMs.set(participantId, 0)
      }
      const turnStarted = currentTurnStart.get(participantId)!
      const liveLegal = legalCommands(liveSession, participantId)
      if (!liveLegal.length)
        throw new Error(
          'No legal command for ' + participantId + ' on turn ' + state.turnNumber + '.'
        )
      const actionIds = aiActions(liveSession, liveLegal, participantId).map(
        (action) => action.id
      )
      const request: AiDecisionRequest = {
        matchId: 'local-ai-benchmark-' + seed + '-' + gameIndex,
        requestId: 'benchmark-action-' + gameIndex + '-' + state.revision,
        expectedRevision: state.revision,
        phase: 'action',
        allowInspection: false,
        messages: [],
        actionIds
      }
      const decisionStarted =
        profile === 'expert' ? expertRuntime.now() : performance.now()
      let outcome: DecisionOutcome
      try {
        outcome = await decideProfile({
          request,
          profile,
          participantId,
          checkpoint: liveSession.match.getCheckpoint(),
          workBudget: options.workBudget,
          liveSession,
          expertRuntime,
          planBeforeAction:
            profile === 'expert' && expertPlannedTurn !== state.turnNumber,
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
      const decisionElapsedMs =
        (profile === 'expert' ? expertRuntime.now() : performance.now()) -
        decisionStarted
      if (outcome.actionSource !== 'forced') {
        recordDecision(profileMetrics[profile], decisionElapsedMs, outcome)
        currentTurnWorkerMs.set(
          participantId,
          (currentTurnWorkerMs.get(participantId) ?? 0) +
            (outcome.workerDurationMs ?? 0)
        )
      }
      if (profile === 'expert' && outcome.actionSource !== 'forced')
        expertPlannedTurn = state.turnNumber

      let command = outcome.command
      let actionSource = outcome.actionSource ?? 'search'
      let fallbackKind = outcome.fallbackKind
      if (!command) {
        actionSource = 'fallback'
        fallbackKind ??= outcome.timedOut
          ? 'timeout'
          : outcome.failed
            ? 'worker-failure'
            : 'invalid'
        if (fallbackKind === 'invalid') {
          profileMetrics[profile].invalidSelections++
          recordInvalidSelection({
            gameIndex,
            seed,
            profile,
            phase: 'action',
            turnNumber: state.turnNumber,
            revision: state.revision,
            participantId,
            source: 'no-command',
            actionSource: outcome.actionSource ?? null,
            fallbackKind,
            selectedActionId: outcome.selectedActionId ?? null,
            selectedDescription: outcome.selectedDescription ?? null,
            failureMessage: outcome.failureMessage ?? null,
            attemptedCommand: null
          })
        }
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
        profileMetrics[profile].invalidSelections++
        recordInvalidSelection({
          gameIndex,
          seed,
          profile,
          phase: 'action',
          turnNumber: state.turnNumber,
          revision: state.revision,
          participantId,
          source: 'rejected-command',
          actionSource: outcome.actionSource ?? null,
          fallbackKind: outcome.fallbackKind ?? null,
          selectedActionId: outcome.selectedActionId ?? null,
          selectedDescription: outcome.selectedDescription ?? null,
          failureMessage: outcome.failureMessage ?? null,
          attemptedCommand: command,
          rejectionCode: result.code,
          rejectionMessage: result.message
        })
        actionSource = 'fallback'
        fallbackKind = 'invalid'
        const fallback =
          liveLegal.find((entry) => entry.type === 'end-turn') ?? liveLegal[0]!
        result = liveSession.match.dispatch(fallback)
        command = fallback
      }
      if (!result.accepted)
        throw new Error('Benchmark action fallback was rejected: ' + result.message)
      recordActionSource(profileMetrics[profile], actionSource, fallbackKind)
      if (profile === 'expert' && invalidatesExpertContinuation(result.events))
        profileMetrics.expert.continuationInvalidations++
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
        finishTurn(
          participantId,
          state.turnNumber,
          (profile === 'expert' ? expertRuntime.now() : performance.now()) - turnStarted
        )
      } else if (result.state.phase === 'ended') {
        finishTurn(
          participantId,
          state.turnNumber,
          (profile === 'expert' ? expertRuntime.now() : performance.now()) - turnStarted
        )
      }
    }

    expertRuntime.api.dispose()

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
          ...deckManifest(firstDeck),
          archetype: firstGenerated.metadata.archetype
        },
        {
          ...deckManifest(secondDeck),
          archetype: secondGenerated.metadata.archetype
        }
      ],
      status: capped ? 'capped' : winner ? 'completed' : 'draw',
      winner,
      actions,
      turnNumber: finalState.turnNumber,
      invalidSelections: gameInvalidSelectionDiagnostics.length,
      rejectedCommands: gameInvalidSelectionDiagnostics.filter(
        (diagnostic) => diagnostic.source === 'rejected-command'
      ).length
    })
    process.stderr.write(
      'LOCAL_AI_BENCHMARK_GAME ' +
        JSON.stringify({
          completed: gameIndex + 1,
          total: options.games,
          match: {
            seed,
            expertPlayer: matches[matches.length - 1]!.expertPlayer,
            status: matches[matches.length - 1]!.status,
            winner,
            actions,
            turnNumber: finalState.turnNumber,
            invalidSelections: gameInvalidSelectionDiagnostics.length,
            rejectedCommands: gameInvalidSelectionDiagnostics.filter(
              (diagnostic) => diagnostic.source === 'rejected-command'
            ).length
          }
        }) +
        '\n'
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

  const summarize = (metrics: MutableProfileMetrics) => {
    const actionDecisionCount =
      metrics.searchedActionCommands +
      metrics.continuedActionCommands +
      metrics.fallbackActionCommands
    return {
      wins: metrics.wins,
      losses: metrics.losses,
      draws: metrics.draws,
      cappedGames: metrics.cappedGames,
      decisions: metrics.decisions,
      actionSources: {
        forced: metrics.forcedActionCommands,
        search: metrics.searchedActionCommands,
        savedContinuation: metrics.continuedActionCommands,
        fallback: metrics.fallbackActionCommands,
        timeoutFallback: metrics.fallbackTimeoutActions,
        continuedLineFallback: metrics.continuedLineFallbacks,
        workerFailureFallback: metrics.fallbackWorkerFailureActions,
        invalidFallback: metrics.fallbackInvalidActions,
        denominatorExcludesForcedCommandsAndMulligan:
          metrics.searchedActionCommands +
          metrics.continuedActionCommands +
          metrics.fallbackActionCommands,
        fallbackRate:
          actionDecisionCount > 0
            ? metrics.fallbackActionCommands / actionDecisionCount
            : null
      },
      continuationInvalidations: metrics.continuationInvalidations,
      commands: metrics.commands,
      endTurns: metrics.endTurns,
      worldsEvaluated: metrics.worldsEvaluated,
      fallbacks: metrics.fallbacks,
      timeoutFallbacks: metrics.timeoutFallbacks,
      continuedLineFallbacks: metrics.continuedLineFallbacks,
      failedFallbacks: metrics.failedFallbacks,
      failedDecisions: metrics.failedDecisions,
      decisionFailureMessages: metrics.decisionFailureMessages,
      timeoutMessages: metrics.timeoutMessages,
      invalidSelections: metrics.invalidSelections,
      rejectedCommands: metrics.rejectedCommands,
      timedOutSearches: metrics.timedOutSearches,
      turnBudgetViolations: metrics.turnMs.filter(
        (durationMs) => durationMs > options.turnBudgetMs
      ).length,
      turnBudgetMisses: metrics.turnBudgetMisses,
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
            ? Math.round(
                (metrics.mctsRolloutDepthTotal / metrics.mctsIterations) * 100
              ) / 100
            : null,
        maximumRolloutDepth: metrics.mctsMaximumRolloutDepth,
        iterationsPerWorld: countSummary(metrics.worldIterations),
        rootActionCoverage: ratioSummary(metrics.rootActionCoverage),
        topRootActionVisitShare: ratioSummary(metrics.topRootActionShare),
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
      responseCandidateScoringLatency: latencySummary(
        metrics.responseCandidateScoringMs
      ),
      responseActionGenerationLatency: latencySummary(
        metrics.responseActionGenerationMs
      ),
      responseReplayLatency: latencySummary(metrics.responseReplayMs),
      decisionLatency: latencySummary(metrics.decisionMs),
      workerDecisionLatency: latencySummary(metrics.workerDecisionMs),
      fullTurnLatency: latencySummary(metrics.turnMs),
      workerTimePerTurn: latencySummary(metrics.workerTurnMs),
      actionsPerTurn: countSummary(metrics.turnActions)
    }
  }

  clearInterval(memorySampler)
  sampleMemory()
  const endingMemory = process.memoryUsage()
  return {
    benchmark: 'local-ai-midrange-vs-baseline',
    benchmarkVersion: 7,
    generatorVersion: OPPONENT_GENERATOR_VERSION,
    configuration: options,
    source: provenance,
    pairedWinRate: pairedWinRate(matches),
    measurement:
      'Headless domain simulation. Expert hidden-world searches run serially in Vitest, while their turn-time budget models concurrent workers using the slowest world duration. Includes actual benchmark wall time; excludes nested worker startup, Pixi rendering, and animations.',
    runtime: {
      benchmarkWallTimeMs: Math.round(performance.now() - benchmarkStartedAt),
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
    matches,
    invalidSelectionDiagnostics
  }
}

describe.skipIf(!ENABLED)('local AI matchup benchmark', () => {
  it('compares seeded Midrange matches with a mirrored baseline assignment', async () => {
    const options = readOptions()
    const result = await runBenchmark(options)
    const expert = result.profiles.expert
    console.log(
      'LOCAL_AI_BENCHMARK_SUMMARY ' +
        JSON.stringify({
          configuration: result.configuration,
          pairedWinRate: result.pairedWinRate,
          runtimeMs: result.runtime.benchmarkWallTimeMs,
          expert: {
            wins: expert.wins,
            losses: expert.losses,
            draws: expert.draws,
            invalidSelections: expert.invalidSelections,
            rejectedCommands: expert.rejectedCommands,
            turnBudgetViolations: expert.turnBudgetViolations,
            meanDecisionMs: expert.decisionLatency.meanMs,
            meanFullTurnMs: expert.fullTurnLatency.meanMs
          }
        })
    )
    console.log('LOCAL_AI_BENCHMARK_JSON ' + JSON.stringify(result))
    expect(result.matches).toHaveLength(options.games)
    if (options.workBudget === undefined && options.maxActions >= 300) {
      expect(result.matches.every((match) => match.status !== 'capped')).toBe(true)
      expect(result.profiles.expert.invalidSelections).toBe(0)
      expect(result.profiles.expert.rejectedCommands).toBe(0)
      expect(result.profiles.expert.turnBudgetViolations).toBe(0)
      expect(result.profiles.expert.actionSources.fallbackRate ?? 0).toBeLessThan(0.05)
    }
  }, 3_600_000)
})
