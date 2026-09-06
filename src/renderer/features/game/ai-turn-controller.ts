import { CARD_CATALOG } from '../../../game/content/cards'
import { HERO_POWER_CATALOG } from '../../../game/content/hero-powers'
import type { Deck } from '../../../game/decks'
import {
  buildEngineVerifiedPolicies,
  canonicalCommandKey,
  enumerateLegalCommands,
  type AiObservation,
  type AiPolicyOutcome,
  type EngineVerifiedPolicy
} from '../../../game/match/ai'
import type {
  ConfirmMulliganCommand,
  TurnMatchCommand,
  TurnMatchState
} from '../../../game/match'
import type {
  AiDecisionApi,
  AiDecisionRequest,
  AiDeckPlan,
  AiPolicyOption,
  JsonObject,
  JsonValue
} from '../../../shared/ipc/ai'
import type { RendererLogger } from '../../ui/logger'
import {
  createDeckPlanRequest,
  createFallbackDeckPlan,
  validateDeckPlan
} from './ai-deck-plan'
import type { GameBoardSession } from './game-board-session'
import type { MatchRecorder } from './match-recorder'

interface CandidatePolicy {
  readonly id: string
  readonly commands: readonly TurnMatchCommand[]
  readonly view: AiPolicyOption
  readonly outcome?: AiPolicyOutcome
  readonly fallbackRank?: number
}

export interface AiActionDecision {
  readonly expectedRevision: number
  readonly actionId: string
  readonly command: TurnMatchCommand
  readonly source: 'model' | 'fallback'
}

export interface AiTurnControllerOptions {
  readonly recorder?: MatchRecorder
  readonly api?: AiDecisionApi
  readonly session: GameBoardSession
  readonly decks: readonly Deck[]
  readonly logger: RendererLogger
}

interface QueuedPolicy {
  readonly decisionId: string
  readonly id: string
  readonly source: AiActionDecision['source']
  readonly commands: readonly TurnMatchCommand[]
}

const PLAN_DEADLINE_MS = 60_000
const DECISION_DEADLINE_MS = 30_000
const MAX_PUBLIC_EVENTS = 64

export const AI_DECISION_LIMITS = {
  planDeadlineMs: PLAN_DEADLINE_MS,
  decisionDeadlineMs: DECISION_DEADLINE_MS,
  maxPublicEvents: MAX_PUBLIC_EVENTS
} as const

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function jsonObject(value: unknown): JsonObject {
  return jsonValue(value) as JsonObject
}

function effectiveHealth(player: AiPolicyOutcome['self']): number {
  return player.health + player.armor
}

function boardThreat(player: AiPolicyOutcome['self']): number {
  return player.board.reduce((total, minion) => {
    const text = minion.rulesText.toLowerCase()
    const repeatable = /whenever|after you|at the (?:start|end)|inspire/.test(text)
    const delayed = /deathrattle/.test(text)
    return (
      total +
      Math.max(0, minion.attack) +
      Math.max(0, minion.health) * 0.25 +
      (repeatable ? 4 : 0) +
      (delayed ? 1 : 0)
    )
  }, 0)
}

function compareVectors(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function outcomeFallbackVector(policy: CandidatePolicy): readonly number[] {
  const result = policy.outcome
  if (!result) return [0, 0, 0, 0, 0, 0, policy.fallbackRank ?? 0]
  return [
    result.winner === 'self' ? 3 : result.winner === 'opponent' ? -3 : 1,
    -boardThreat(result.opponent),
    effectiveHealth(result.self),
    boardThreat(result.self),
    typeof result.self.hand === 'number' ? result.self.hand : result.self.hand.length,
    -effectiveHealth(result.opponent),
    policy.view.completeTurn ? 1 : 0,
    policy.fallbackRank ?? 0
  ]
}

export class AiTurnController {
  private decisionId = ''
  private sequence = 0
  private deckPlan: AiDeckPlan | null = null
  private deckPlanPromise: Promise<AiDeckPlan> | null = null
  private queuedPolicy: QueuedPolicy | null = null
  private disposed = false

  constructor(private readonly options: AiTurnControllerOptions) {}

  dispose(): void {
    this.disposed = true
    this.queuedPolicy = null
  }

  prewarmDeckPlan(): void {
    void this.ensureDeckPlan()
  }

  private beginDecision(phase: 'mulligan' | 'turn'): void {
    this.decisionId = `${phase}-${this.options.session.getState().revision}-${this.sequence++}`
    if (this.options.recorder) {
      this.options.recorder.decisionId = this.decisionId
    }
  }

  async chooseMulligan(): Promise<AiActionDecision> {
    return this.measure('mulligan', async () => {
      this.beginDecision('mulligan')
      const state = this.options.session.getState()
      const player = this.options.session.findPlayer(
        state,
        this.options.session.remoteParticipantId
      )
      const policies: CandidatePolicy[] = []
      for (let mask = 0; mask < 1 << player.hand.length; mask += 1) {
        const replaced = player.hand.filter(
          (_card, index) => (mask & (1 << index)) !== 0
        )
        const command: ConfirmMulliganCommand = {
          type: 'confirm-mulligan',
          participantId: player.participantId,
          replaceInstanceIds: replaced.map((card) => card.instanceId)
        }
        const expensiveKept = player.hand.filter(
          (card, index) =>
            (mask & (1 << index)) === 0 &&
            card.cardId !== 'system_the_coin' &&
            (card.currentCost ?? card.baseCost ?? 0) >= 4
        ).length
        policies.push({
          id: `mulligan-${mask}`,
          commands: [command],
          fallbackRank: -expensiveKept,
          view: {
            id: `mulligan-${mask}`,
            actions: [
              replaced.length === 0
                ? 'Keep the entire opening hand.'
                : `Replace ${replaced
                    .map(
                      (card) =>
                        `${CARD_CATALOG.require(card.cardId).name} (${card.cardId})`
                    )
                    .join(', ')}.`
            ],
            completeTurn: true,
            stopsAtNewInformation: true
          }
        })
      }
      return this.choosePolicy('mulligan', policies)
    })
  }

  async chooseTurnAction(): Promise<AiActionDecision> {
    return this.measure('turn', async () => {
      const continuation = this.continuePolicy()
      if (continuation) return continuation
      this.beginDecision('turn')
      const policies = (
        await buildEngineVerifiedPolicies(
          this.options.session.match,
          this.options.session.remoteParticipantId
        )
      ).map((policy) => this.candidatePolicy(policy))
      if (policies.length === 0) {
        this.options.recorder?.record('decisions', 'selection', {
          source: 'fallback',
          policyId: 'fallback-end-turn',
          reason: 'No generated policies.'
        })
        const participantId = this.options.session.remoteParticipantId
        return {
          expectedRevision: this.options.session.getState().revision,
          actionId: 'fallback-end-turn',
          command: { type: 'end-turn', participantId },
          source: 'fallback'
        }
      }
      return this.choosePolicy('turn', policies)
    })
  }

  private aiDeck(): Deck {
    const participant = this.options.session.match.setup.participants.find(
      (candidate) =>
        candidate.participantId === this.options.session.remoteParticipantId
    )
    const deck = this.options.decks.find(
      (candidate) => candidate.id === participant?.deckId
    )
    if (!deck) throw new Error('The AI deck is unavailable.')
    return deck
  }

  private async ensureDeckPlan(): Promise<AiDeckPlan> {
    if (this.deckPlan) return this.deckPlan
    if (this.deckPlanPromise) return this.deckPlanPromise
    const fallback = createFallbackDeckPlan()
    this.deckPlanPromise = (async () => {
      if (!this.options.api) return fallback
      try {
        const logMatchId = await this.options.recorder?.ready
        const request = {
          ...createDeckPlanRequest(this.aiDeck(), Date.now() + PLAN_DEADLINE_MS),
          ...(logMatchId ? { logMatchId } : {})
        }
        const response = await this.options.api.planDeck(request)
        if (!response.modelId.toLowerCase().includes('gpt-5.4-nano')) {
          throw new Error(`Deck plan used disallowed model ${response.modelId}.`)
        }
        const plan = validateDeckPlan(response.plan, this.aiDeck())
        this.options.logger.info('[Game AI] exact-deck plan ready', {
          strategy: plan.strategy,
          preserve: plan.preserve,
          modelId: response.modelId
        })
        return plan
      } catch (error) {
        this.options.logger.warn(
          '[Game AI] deck plan failed; using generic plan',
          error
        )
        return fallback
      }
    })()
    this.deckPlan = await this.deckPlanPromise
    this.options.recorder?.record(
      'decisions',
      'deck-plan-active',
      { plan: this.deckPlan },
      'deck-plan'
    )
    return this.deckPlan
  }

  private candidatePolicy(policy: EngineVerifiedPolicy): CandidatePolicy {
    return {
      id: policy.id,
      commands: policy.commands,
      outcome: policy.outcome,
      view: {
        id: policy.id,
        actions: policy.actions,
        completeTurn: policy.completeTurn,
        stopsAtNewInformation: policy.stopsAtNewInformation,
        ...(policy.outcome ? { result: jsonObject(policy.outcome) } : {})
      }
    }
  }

  private legalCommands(): readonly TurnMatchCommand[] {
    return this.options.session.match.analyze((fork) =>
      enumerateLegalCommands(fork, this.options.session.remoteParticipantId)
    )
  }

  private continuePolicy(): AiActionDecision | null {
    const queued = this.queuedPolicy
    if (!queued || queued.commands.length === 0) return null
    this.decisionId = queued.decisionId
    if (this.options.recorder) this.options.recorder.decisionId = this.decisionId
    const state = this.options.session.getState()
    if (
      state.phase !== 'turns' ||
      state.activePlayerId !== this.options.session.remoteParticipantId
    ) {
      this.queuedPolicy = null
      return null
    }
    const next = queued.commands[0]!
    const legal = new Set(this.legalCommands().map(canonicalCommandKey))
    if (!legal.has(canonicalCommandKey(next))) {
      this.options.logger.info('[Game AI] policy diverged; replanning', {
        policyId: queued.id,
        next: canonicalCommandKey(next)
      })
      this.queuedPolicy = null
      return null
    }
    this.queuedPolicy =
      queued.commands.length > 1
        ? { ...queued, commands: queued.commands.slice(1) }
        : null
    this.options.logger.info('[Game AI] continuing engine-verified policy', {
      revision: state.revision,
      policyId: queued.id,
      command: canonicalCommandKey(next),
      remaining: queued.commands.length - 1
    })
    return {
      expectedRevision: state.revision,
      actionId: `${queued.id}:continuation`,
      command: next,
      source: queued.source
    }
  }

  private visibleCardIds(
    observation: AiObservation,
    state: TurnMatchState
  ): readonly string[] {
    const ids = new Set<string>()
    for (const player of observation.players) {
      for (const card of player.hand) ids.add(card.cardId)
      for (const minion of player.board) ids.add(minion.cardId)
      for (const cardId of player.graveyardCardIds) ids.add(cardId)
      if (player.weapon) ids.add(player.weapon.cardId)
      for (const secret of player.secrets) if (secret.cardId) ids.add(secret.cardId)
    }
    if (state.pendingDiscover?.participantId === observation.perspectivePlayerId) {
      for (const card of state.pendingDiscover.candidates) ids.add(card.cardId)
    }
    if (state.pendingCardChoice?.participantId === observation.perspectivePlayerId) {
      for (const option of state.pendingCardChoice.options) {
        if (option.presentationCardId) ids.add(option.presentationCardId)
      }
    }
    return [...ids].sort()
  }

  private modelState(): JsonObject {
    const observation = this.options.session.getAiObservation()
    const state = this.options.session.getState()
    const visibleCards = this.visibleCardIds(observation, state).map((cardId) => {
      const definition = CARD_CATALOG.require(cardId)
      return {
        cardId,
        name: definition.name,
        cost: definition.cost,
        type: definition.type,
        rulesText: definition.rulesText,
        keywords: definition.keywords ?? [],
        effects: definition.effects
      }
    })
    const visibleHeroPowers = observation.players.map((player) => {
      const definition = HERO_POWER_CATALOG.require(player.heroPower.id)
      return {
        participantId: player.participantId,
        id: definition.id,
        name: definition.displayName,
        cost: player.heroPower.cost,
        available: player.heroPower.available,
        rulesText: definition.rulesText
      }
    })
    return jsonObject({
      observation,
      visibleCards,
      visibleHeroPowers,
      recentPublicEvents: this.options.session.getAiObservedEvents(MAX_PUBLIC_EVENTS)
    })
  }

  private fallback(policies: readonly CandidatePolicy[]): CandidatePolicy {
    return [...policies].sort((left, right) => {
      const vectorOrder = compareVectors(
        outcomeFallbackVector(right),
        outcomeFallbackVector(left)
      )
      return vectorOrder || left.id.localeCompare(right.id)
    })[0]!
  }

  private decisionFrom(
    policy: CandidatePolicy,
    source: AiActionDecision['source'],
    rationale: string,
    phase: 'mulligan' | 'turn',
    considered: readonly CandidatePolicy[]
  ): AiActionDecision {
    const state = this.options.session.getState()
    const [command, ...remaining] = policy.commands
    if (!command) throw new Error(`AI policy ${policy.id} has no command.`)
    this.queuedPolicy =
      phase === 'turn' && remaining.length > 0
        ? { id: policy.id, source, commands: remaining, decisionId: this.decisionId }
        : null
    this.options.recorder?.record('decisions', 'selection', {
      source,
      phase,
      policyId: policy.id,
      actions: policy.view.actions,
      rationale,
      commands: policy.commands
    })
    this.options.logger.info('[Game AI] selected policy', {
      revision: state.revision,
      phase,
      source,
      policyId: policy.id,
      actions: policy.view.actions,
      rationale,
      considered: considered.map((candidate) => ({
        id: candidate.id,
        actions: candidate.view.actions,
        completeTurn: candidate.view.completeTurn,
        stopsAtNewInformation: candidate.view.stopsAtNewInformation,
        result: candidate.view.result
      }))
    })
    return {
      expectedRevision: state.revision,
      actionId: policy.id,
      command,
      source
    }
  }

  private async choosePolicy(
    phase: 'mulligan' | 'turn',
    policies: readonly CandidatePolicy[]
  ): Promise<AiActionDecision> {
    if (this.disposed) throw new Error('AI controller was disposed.')
    const lethal = policies.filter((policy) => policy.outcome?.winner === 'self')
    const considered = lethal.length > 0 ? lethal : policies
    const fallback = this.fallback(considered)
    if (!this.options.api || considered.length === 1) {
      return this.decisionFrom(
        fallback,
        'fallback',
        lethal.length > 0 ? 'Engine-verified lethal.' : 'Remote choice unavailable.',
        phase,
        considered
      )
    }

    const plan = await this.ensureDeckPlan()
    const logMatchId = await this.options.recorder?.ready
    const request: AiDecisionRequest = {
      requestId: this.decisionId,
      ...(logMatchId ? { logMatchId } : {}),
      phase,
      deadlineAtMs: Date.now() + DECISION_DEADLINE_MS,
      plan,
      state: this.modelState(),
      policies: considered.map((policy) => policy.view)
    }
    try {
      const response = await this.options.api.decide(request)
      if (response.requestId !== request.requestId) {
        throw new Error('AI returned a stale request ID.')
      }
      if (!response.modelId.toLowerCase().includes('gpt-5.4-nano')) {
        throw new Error(`Decision used disallowed model ${response.modelId}.`)
      }
      const selected = considered.find((policy) => policy.id === response.policyId)
      if (!selected) throw new Error(`AI selected unknown policy ${response.policyId}.`)
      return this.decisionFrom(selected, 'model', response.rationale, phase, considered)
    } catch (error) {
      this.options.logger.warn(
        '[Game AI] decision failed; using transparent fallback',
        {
          error: error instanceof Error ? error.message : String(error),
          fallbackPolicyId: fallback.id,
          fallbackActions: fallback.view.actions
        }
      )
      return this.decisionFrom(
        fallback,
        'fallback',
        'Provider failed; selected by the small public-state fallback.',
        phase,
        considered
      )
    }
  }

  private async measure(
    phase: 'mulligan' | 'turn',
    operation: () => Promise<AiActionDecision>
  ): Promise<AiActionDecision> {
    const startedAt = performance.now()
    let continuation = false
    try {
      const decision = await operation()
      continuation = decision.actionId.endsWith(':continuation')
      return decision
    } finally {
      this.options.recorder?.record(
        'decisions',
        continuation ? 'continuation-timing' : 'decision-timing',
        {
          phase,
          elapsedMs: Number((performance.now() - startedAt).toFixed(2))
        }
      )
      this.options.logger.info('[Game AI] decision timing', {
        phase,
        elapsedMs: Number((performance.now() - startedAt).toFixed(2))
      })
    }
  }
}
