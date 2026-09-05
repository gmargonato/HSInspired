import type { Deck } from '../../../game/decks'
import {
  AiStrategicTracker,
  STRATEGIC_AI_SEARCH_LIMITS,
  commandUsesUncertainty,
  type AiCandidateDossier,
  type AiEvaluationComponents,
  type AiStrategicPlanView
} from '../../../game/match/ai'
import {
  CARD_CATALOG,
  isCardEffectObject,
  type CardDefinition
} from '../../../game/content/cards'
import { HERO_CATALOG } from '../../../game/content/heroes'
import { HERO_POWER_CATALOG } from '../../../game/content/hero-powers'
import type {
  AttackCharacterRef,
  CardPlayTargetRef,
  ConfirmMulliganCommand,
  OpeningCard,
  PlayCardInput,
  PlayerId,
  TurnMatchCommand,
  TurnMatchResult,
  TurnMatchState
} from '../../../game/match'
import type {
  AiActionKind,
  AiActionAnalysis,
  AiDeckPlan,
  AiDecisionClass,
  AiDecisionApi,
  AiDecisionRequest,
  AiDecisionResponse,
  AiLegalAction,
  AiStrategyReviewRequest,
  JsonObject
} from '../../../shared/ipc/ai'
import type { RendererLogger } from '../../ui/logger'
import {
  createDeckPlanRequest,
  createFallbackDeckPlan,
  reservedCardIds,
  validateDeckPlanForDeck
} from './ai-deck-strategy'
import { StrategicAiWorkerClient } from './strategic-ai-worker-client'
import type { GameBoardSession } from './game-board-session'

interface CandidateAction {
  readonly public: AiLegalAction
  readonly command: TurnMatchCommand
  readonly previewCommands?: readonly TurnMatchCommand[]
  readonly analysis?: AiActionAnalysis
}

export interface AiActionDecision {
  readonly expectedRevision: number
  readonly actionId: string
  readonly command: TurnMatchCommand
  readonly source: 'model' | 'fallback'
}

export interface AiTurnControllerOptions {
  readonly api?: AiDecisionApi
  readonly session: GameBoardSession
  readonly decks: readonly Deck[]
  readonly logger: RendererLogger
  readonly policy?: 'legacy' | 'strategic-v3'
}

export const STRATEGIC_AI_POLICY: 'legacy' | 'strategic-v3' =
  import.meta.env.VITE_STRATEGIC_AI_V3 === 'false' ? 'legacy' : 'strategic-v3'

const AI_PROMPT_VERSION = 'strategic-fair-ranker-v2'
const AI_CONTEXT_VERSION = 4
const AI_SCHEMA_VERSION = 3
const MAX_PREVIEWED_CANDIDATES = 256
const MAX_MODEL_CANDIDATES = 12
const MAX_DECISION_TIME_MS = 20_000
const STRATEGIC_MAX_DECISION_TIME_MS = 20_000
const NORMAL_PROVIDER_PASS_MS = 5_000
const COMPLEX_PROVIDER_PASS_MS = 8_000
const STRATEGIC_DISPATCH_RESERVE_MS = 2_000
const NORMAL_LOCAL_SEARCH_MS = 750
const COMPLEX_LOCAL_SEARCH_MS = 5_000
const SIMPLE_SCORE_MARGIN = 0.75
const CLOSE_SCORE_MARGIN = 0.35
const MAX_DECK_PLAN_TIME_MS = 60_000
const MAX_STRATEGY_REVIEW_TIME_MS = 20_000
const MAX_PROVIDER_PUBLIC_EVENTS = 96
const RESERVED_RESOURCE_PENALTY = 120
const LINE_SEARCH_MAX_DEPTH = 12
const LINE_SEARCH_BEAM_WIDTH = 32
const LINE_SEARCH_NODE_LIMIT = 4_000
const LINE_SEARCH_TIME_MS = 250

const ZERO_EVALUATION: AiEvaluationComponents = {
  terminal: 0,
  lethalPressure: 0,
  effectiveHealth: 0,
  incomingReach: 0,
  boardAttack: 0,
  boardHealth: 0,
  boardKeywords: 0,
  initiative: 0,
  boardSlots: 0,
  handQuality: 0,
  cardAdvantage: 0,
  manaEfficiency: 0,
  futureCurve: 0,
  weapon: 0,
  heroPower: 0,
  removal: 0,
  draw: 0,
  informationValue: 0,
  fatigue: 0,
  burnRisk: 0,
  matchupProgress: 0,
  comboProgress: 0,
  threatExposure: 0,
  reservedResourceCost: 0
}

function toJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject
}

/** Removes stable ordering metadata from card backs so it cannot encode hidden order. */
function sanitizePrivateIdentifiers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizePrivateIdentifiers)
  if (typeof value !== 'object' || value === null) return value
  const record = value as Record<string, unknown>
  const hiddenCard = 'cardId' in record && record['cardId'] === null
  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(record)) {
    if (key === 'creationOrdinal' || key === 'playOrder') continue
    if (hiddenCard && (key === 'id' || key === 'instanceId')) continue
    result[key] = sanitizePrivateIdentifiers(nested)
  }
  return hiddenCard ? { ...result, hidden: true } : result
}

function compactCardDefinition(definition: CardDefinition): JsonObject {
  return toJsonObject({
    id: definition.id,
    name: definition.name,
    type: definition.type,
    cardClass: definition.cardClass,
    subtype: definition.subtype,
    spellSchool: definition.spellSchool,
    cost: definition.cost,
    rulesText: definition.rulesText,
    keywords: definition.keywords,
    effects: definition.effects,
    ...(definition.type === 'Minion'
      ? { attack: definition.attack, health: definition.health }
      : {}),
    ...(definition.type === 'Weapon'
      ? { attack: definition.attack, durability: definition.durability }
      : {}),
    ...(definition.type === 'Hero'
      ? { armor: definition.armor, replacementHeroId: definition.replacementHeroId }
      : {})
  })
}

function cardName(cardId: string | null | undefined): string {
  if (!cardId) return 'hidden card'
  return CARD_CATALOG.get(cardId)?.name ?? cardId
}

function cardSnapshot(card: OpeningCard): JsonObject {
  return toJsonObject({
    ...card,
    instanceId: card.instanceId,
    cardId: card.cardId,
    name: cardName(card.cardId)
  })
}

function collectReferencedCardIds(
  value: unknown,
  result = new Set<string>()
): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) collectReferencedCardIds(entry, result)
    return result
  }
  if (typeof value !== 'object' || value === null) return result
  for (const [key, entry] of Object.entries(value)) {
    if ((key === 'cardId' || key.endsWith('CardId')) && typeof entry === 'string') {
      result.add(entry)
    }
    if ((key === 'cardIds' || key.endsWith('CardIds')) && Array.isArray(entry)) {
      for (const cardId of entry) {
        if (typeof cardId === 'string') result.add(cardId)
      }
    }
    collectReferencedCardIds(entry, result)
  }
  return result
}

function targetKey(target: CardPlayTargetRef): string {
  return target.kind === 'hero'
    ? `hero:${target.participantId}`
    : `${target.kind}:${target.participantId}:${target.instanceId}`
}

function targetAssignments(
  input: PlayCardInput
): readonly (readonly CardPlayTargetRef[])[] {
  if (input.targetSelectors.length === 0) return [[]]
  const assignments: CardPlayTargetRef[][] = []
  const visit = (
    index: number,
    selected: CardPlayTargetRef[],
    used: Set<string>
  ): void => {
    if (index >= input.legalTargetOptions.length) {
      assignments.push([...selected])
      return
    }
    for (const target of input.legalTargetOptions[index] ?? []) {
      const key = targetKey(target)
      if (used.has(key)) continue
      used.add(key)
      selected.push(target)
      visit(index + 1, selected, used)
      selected.pop()
      used.delete(key)
    }
  }
  visit(0, [], new Set())
  return assignments
}

function describeAttackCharacter(
  ref: AttackCharacterRef,
  ownerId: PlayerId,
  state: TurnMatchState
): string {
  if (ref.kind === 'hero') {
    const heroId = state.players.find(
      (player) => player.participantId === ownerId
    )?.heroId
    return heroId ? HERO_CATALOG.require(heroId).displayName : 'hero'
  }
  for (const player of state.players) {
    const minion = player.board.find(
      (candidate) => candidate.instanceId === ref.instanceId
    )
    if (minion) return `${cardName(minion.cardId)} (${minion.attack}/${minion.health})`
  }
  return ref.instanceId
}

function isHiddenOpponentTarget(target: CardPlayTargetRef, selfId: PlayerId): boolean {
  if (target.participantId === selfId) return false
  return (
    target.kind === 'secret' ||
    (target.kind === 'card' && (target.zone === 'deck' || target.zone === 'hand'))
  )
}

function publicCardTargetRef(target: CardPlayTargetRef, selfId: PlayerId): JsonObject {
  if (!isHiddenOpponentTarget(target, selfId)) return toJsonObject(target)
  return toJsonObject({
    kind: target.kind,
    participantId: target.participantId,
    role: 'opponent',
    hidden: true,
    ...(target.kind === 'card' && target.zone ? { zone: target.zone } : {})
  })
}

function describeCardTarget(
  target: CardPlayTargetRef,
  state: TurnMatchState,
  selfId: PlayerId
): string {
  const owner = state.players.find(
    (player) => player.participantId === target.participantId
  )
  const side = target.participantId === selfId ? 'friendly' : 'enemy'
  if (target.kind === 'hero') {
    return `${side} ${owner ? HERO_CATALOG.require(owner.heroId).displayName : 'hero'}`
  }
  if (target.kind === 'minion') {
    const minion = owner?.board.find(
      (candidate) => candidate.instanceId === target.instanceId
    )
    return `${side} ${minion ? cardName(minion.cardId) : target.instanceId}`
  }
  if (target.kind === 'weapon') return `${side} weapon ${target.instanceId}`
  if (target.kind === 'secret')
    return target.participantId === selfId
      ? `${side} secret ${target.instanceId}`
      : `${side} facedown secret`
  if (isHiddenOpponentTarget(target, selfId))
    return `${side} hidden card from ${target.zone ?? 'private zone'}`
  return `${side} ${cardName(target.cardId)} from ${target.zone ?? 'card zone'}`
}

function attackCharacterSnapshot(
  ref: AttackCharacterRef,
  ownerId: PlayerId,
  state: TurnMatchState,
  selfId: PlayerId
): JsonObject {
  const player = state.players.find((candidate) => candidate.participantId === ownerId)
  if (!player) return toJsonObject({ kind: ref.kind, participantId: ownerId })
  const role = ownerId === selfId ? 'self' : 'opponent'
  if (ref.kind === 'hero') {
    return toJsonObject({
      kind: 'hero',
      participantId: ownerId,
      role,
      heroId: player.heroId,
      name: HERO_CATALOG.require(player.heroId).displayName,
      hero: player.hero,
      weapon: player.weapon
    })
  }
  const minion = player.board.find(
    (candidate) => candidate.instanceId === ref.instanceId
  )
  return toJsonObject({
    kind: 'minion',
    participantId: ownerId,
    role,
    instanceId: ref.instanceId,
    ...(minion
      ? { name: cardName(minion.cardId), minion }
      : { name: 'stale minion reference' })
  })
}

function cardTargetSnapshot(
  target: CardPlayTargetRef,
  state: TurnMatchState,
  selfId: PlayerId
): JsonObject {
  if (isHiddenOpponentTarget(target, selfId)) {
    return publicCardTargetRef(target, selfId)
  }
  const player = state.players.find(
    (candidate) => candidate.participantId === target.participantId
  )
  const role = target.participantId === selfId ? 'self' : 'opponent'
  if (!player) return toJsonObject({ ...target, role })
  if (target.kind === 'hero') {
    return toJsonObject({
      ...target,
      role,
      heroId: player.heroId,
      name: HERO_CATALOG.require(player.heroId).displayName,
      hero: player.hero,
      weapon: player.weapon
    })
  }
  if (target.kind === 'minion') {
    const minion = player.board.find(
      (candidate) => candidate.instanceId === target.instanceId
    )
    return toJsonObject({
      ...target,
      role,
      name: minion ? cardName(minion.cardId) : 'stale minion reference',
      minion: minion ?? null
    })
  }
  if (target.kind === 'weapon') {
    return toJsonObject({
      ...target,
      role,
      name: cardName(player.weapon?.cardId),
      weapon: player.weapon
    })
  }
  if (target.kind === 'secret') {
    const secret = player.secrets?.find(
      (candidate) => candidate.instanceId === target.instanceId
    )
    return toJsonObject({
      ...target,
      role,
      name: cardName(secret?.cardId),
      secret: secret ?? null
    })
  }
  const card = [
    ...player.deck,
    ...player.hand,
    ...(player.revealedCards ?? []),
    ...(player.discardedCards ?? [])
  ].find((candidate) => candidate.instanceId === target.instanceId)
  return toJsonObject({
    ...target,
    role,
    name: cardName(card?.cardId ?? target.cardId),
    card: card ?? null
  })
}

function isPermanentProviderError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return (
    message.includes('ai configuration') ||
    message.includes('key is missing') ||
    message.includes('external game ai is disabled') ||
    message.includes('http 400') ||
    message.includes('http 401') ||
    message.includes('http 403') ||
    message.includes('http 404')
  )
}

function isSharedPermanentProviderError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return (
    message.includes('ai configuration') ||
    message.includes('key is missing') ||
    message.includes('external game ai is disabled') ||
    message.includes('http 401') ||
    message.includes('http 403') ||
    message.includes('http 404')
  )
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function participantSummary(state: TurnMatchState, participantId: PlayerId) {
  const player = state.players.find(
    (candidate) => candidate.participantId === participantId
  )
  if (!player) throw new Error(`Unknown preview participant ${participantId}.`)
  return {
    effectiveHealth: player.hero.health + player.hero.armor,
    boardAttack: player.board.reduce((total, minion) => total + minion.attack, 0),
    boardHealth: player.board.reduce((total, minion) => total + minion.health, 0),
    mana: player.mana.available
  }
}

function actionAnalysis(
  result: TurnMatchResult,
  before: TurnMatchState,
  selfId: PlayerId,
  opponentId: PlayerId,
  planResourceCost: number
): AiActionAnalysis {
  const beforeSelf = participantSummary(before, selfId)
  const beforeOpponent = participantSummary(before, opponentId)
  const self = participantSummary(result.state, selfId)
  const opponent = participantSummary(result.state, opponentId)
  const terminal =
    result.state.winnerId === selfId
      ? 'win'
      : result.state.loserId === selfId
        ? 'loss'
        : 'none'
  const score =
    (result.accepted ? 0 : -1_000_000) +
    (terminal === 'win' ? 500_000 : terminal === 'loss' ? -500_000 : 0) +
    (self.effectiveHealth - beforeSelf.effectiveHealth) * 12 -
    (opponent.effectiveHealth - beforeOpponent.effectiveHealth) * 12 +
    (self.boardAttack - beforeSelf.boardAttack) * 8 -
    (opponent.boardAttack - beforeOpponent.boardAttack) * 8 +
    (self.boardHealth - beforeSelf.boardHealth) * 2 -
    (opponent.boardHealth - beforeOpponent.boardHealth) * 2 -
    planResourceCost
  return {
    accepted: result.accepted,
    terminal,
    selfEffectiveHealth: self.effectiveHealth,
    opponentEffectiveHealth: opponent.effectiveHealth,
    selfBoardAttack: self.boardAttack,
    opponentBoardAttack: opponent.boardAttack,
    score,
    ...(planResourceCost > 0 ? { planResourceCost } : {})
  }
}

function candidateCardId(candidate: CandidateAction): string | null {
  const card = candidate.public.details['card']
  if (typeof card !== 'object' || card === null || Array.isArray(card)) return null
  const cardId = (card as Record<string, unknown>)['cardId']
  return typeof cardId === 'string' ? cardId : null
}

function candidatePlanResourceCost(
  candidate: CandidateAction,
  deckPlan: AiDeckPlan,
  activeReservedCardIds?: ReadonlySet<string>
): number {
  const cardId = candidateCardId(candidate)
  const reserved = activeReservedCardIds ?? reservedCardIds(deckPlan)
  if (!cardId || !reserved.has(cardId)) return 0
  const plannedCardIdsValue = candidate.public.details['plannedCardIds']
  const plannedCardIds = Array.isArray(plannedCardIdsValue)
    ? plannedCardIdsValue.filter((entry): entry is string => typeof entry === 'string')
    : [cardId]
  const completesPackage = deckPlan.combos.some(
    (combo) =>
      combo.cardIds.includes(cardId) &&
      combo.cardIds.every((comboCardId) => plannedCardIds.includes(comboCardId))
  )
  return completesPackage ? 0 : RESERVED_RESOURCE_PENALTY
}

function candidateMayResolvePrivateInformation(
  candidate: CandidateAction,
  state: TurnMatchState
): boolean {
  return commandUsesUncertainty(candidate.command, state)
}

function uncertainAnalysis(
  state: TurnMatchState,
  selfId: PlayerId,
  opponentId: PlayerId,
  planResourceCost: number
): AiActionAnalysis {
  const self = participantSummary(state, selfId)
  const opponent = participantSummary(state, opponentId)
  return {
    accepted: true,
    terminal: 'none',
    selfEffectiveHealth: self.effectiveHealth,
    opponentEffectiveHealth: opponent.effectiveHealth,
    selfBoardAttack: self.boardAttack,
    opponentBoardAttack: opponent.boardAttack,
    score: -planResourceCost,
    ...(planResourceCost > 0 ? { planResourceCost } : {}),
    uncertain: true
  }
}

function previewPriority(candidate: CandidateAction): number {
  if (candidate.public.kind === 'end-turn') return 1
  if (candidate.public.kind === 'attack-character') {
    const defender = candidate.public.details['defender']
    if (
      typeof defender === 'object' &&
      defender !== null &&
      defender['kind'] === 'hero'
    ) {
      return 4
    }
  }
  if (candidate.public.kind === 'play-card') return 3
  if (candidate.public.kind === 'use-hero-power') return 2
  return 0
}

export class AiTurnController {
  private decisionSequence = 0
  private planningProviderDisabled = false
  private decisionProviderDisabled = false
  private deckPlan: AiDeckPlan | null = null
  private deckPlanPromise: Promise<AiDeckPlan> | null = null
  private strategicTracker: AiStrategicTracker | null = null
  private opponentAssessment: string | null = null
  private lastStrategyReviewTurn = -1
  private strategyReviewPromise: Promise<void> | null = null
  private disposed = false
  private workerClient: StrategicAiWorkerClient | null = null
  private lastLocalSearchElapsedMs = 0

  constructor(private readonly options: AiTurnControllerOptions) {}

  dispose(): void {
    this.disposed = true
    this.workerClient?.destroy()
    this.workerClient = null
  }

  private recordPermanentProviderFailure(
    error: unknown,
    capability: 'planning' | 'decision'
  ): void {
    if (!isPermanentProviderError(error)) return
    if (isSharedPermanentProviderError(error)) {
      this.planningProviderDisabled = true
      this.decisionProviderDisabled = true
      return
    }
    if (capability === 'planning') this.planningProviderDisabled = true
    else this.decisionProviderDisabled = true
  }

  /** Starts the once-per-match strategy request without delaying scene setup. */
  prewarmDeckPlan(): void {
    const planning = this.ensureDeckPlan()
    void planning.catch((error) => {
      this.options.logger.warn(
        '[Game AI] could not prewarm the deterministic deck strategy',
        errorDetails(error)
      )
    })
  }

  async chooseMulligan(): Promise<AiActionDecision> {
    return this.measureDecision('mulligan', () =>
      this.choose('mulligan', this.mulliganCandidates())
    )
  }

  async chooseTurnAction(): Promise<AiActionDecision> {
    return this.measureDecision('turn', () =>
      this.options.policy === 'strategic-v3'
        ? this.chooseStrategic('turn', [])
        : this.choose('turn', this.turnLineCandidates())
    )
  }

  private async measureDecision(
    phase: 'mulligan' | 'turn',
    operation: () => Promise<AiActionDecision>
  ): Promise<AiActionDecision> {
    const startedAt = performance.now()
    try {
      return await operation()
    } finally {
      this.options.logger.info('[Game AI] decision timing', {
        phase,
        elapsedMs: Number((performance.now() - startedAt).toFixed(2))
      })
    }
  }

  private aiDeck(): Deck {
    const participant = this.options.session.match.setup.participants.find(
      (candidate) =>
        candidate.participantId === this.options.session.remoteParticipantId
    )
    const deck = this.options.decks.find(
      (candidate) => candidate.id === participant?.deckId
    )
    if (!deck) throw new Error('The AI deck is unavailable for strategic planning.')
    return deck
  }

  private strategicPlanView(plan: AiDeckPlan): AiStrategicPlanView {
    const snapshot = this.strategicTracker?.snapshot
    return {
      selfCombos: plan.combos,
      reservedCardIds: [...reservedCardIds(plan)],
      ...(snapshot ? { activeReservedCardIds: snapshot.activeReservedCardIds } : {}),
      selfDeckCardCounts: this.aiDeck().cards,
      observedOpponentThreatCardIds: snapshot?.observedOpponentCardIds ?? [],
      resourceRules: plan.resourceRules.map((rule) => ({
        cardIds: rule.cardIds,
        releaseTriggers: rule.releaseTriggers
      }))
    }
  }

  private async ensureDeckPlan(): Promise<AiDeckPlan> {
    if (this.deckPlan) return this.deckPlan
    if (this.deckPlanPromise) return this.deckPlanPromise
    const deck = this.aiDeck()
    const fallback = createFallbackDeckPlan(deck)
    const planningStartedAt = performance.now()
    this.deckPlanPromise = (async () => {
      if (!this.options.api?.planDeck || this.planningProviderDisabled) return fallback
      try {
        const response = await this.options.api.planDeck(
          createDeckPlanRequest(deck, Date.now() + MAX_DECK_PLAN_TIME_MS)
        )
        if (
          this.options.policy === 'strategic-v3' &&
          !response.modelId.toLowerCase().includes('gpt-5.4-nano')
        ) {
          throw new Error(`Deck planner returned disallowed model ${response.modelId}.`)
        }
        const plan = validateDeckPlanForDeck(response.plan, deck)
        this.options.logger.info('[Game AI] prepared match deck plan', {
          archetype: plan.archetype,
          primaryWinCondition: plan.primaryWinCondition,
          rationale: response.rationale,
          modelId: response.modelId
        })
        return plan
      } catch (error) {
        this.recordPermanentProviderFailure(error, 'planning')
        this.options.logger.warn(
          '[Game AI] deck planning failed; using deterministic strategy',
          errorDetails(error)
        )
        return fallback
      }
    })().finally(() => {
      this.options.logger.info('[Game AI] deck planning timing', {
        elapsedMs: Number((performance.now() - planningStartedAt).toFixed(2))
      })
    })
    this.deckPlan = await this.deckPlanPromise
    if (this.options.policy === 'strategic-v3' && !this.strategicTracker) {
      this.strategicTracker = new AiStrategicTracker(
        this.options.session.remoteParticipantId,
        this.strategicPlanView(this.deckPlan),
        this.options.session.getState()
      )
    }
    return this.deckPlan
  }

  private deckPlanForDecision(phase: 'mulligan' | 'turn'): Promise<AiDeckPlan> {
    if (this.options.policy === 'strategic-v3') return this.ensureDeckPlan()
    if (phase !== 'mulligan') return this.ensureDeckPlan()

    // Mulligan ranking can run beside the richer remote analysis. The local plan
    // already understands structured synergies, while later turns automatically
    // inherit the remote plan as soon as the prewarmed promise completes.
    this.prewarmDeckPlan()
    return Promise.resolve(this.deckPlan ?? createFallbackDeckPlan(this.aiDeck()))
  }

  private async reviewStrategyIfNeeded(plan: AiDeckPlan): Promise<AiDeckPlan> {
    if (this.options.policy !== 'strategic-v3' || !this.strategicTracker) return plan
    const state = this.options.session.getState()
    const memory = this.strategicTracker.update(
      state,
      this.options.session.getAiObservedEvents()
    )
    if (
      memory.reviewReasons.length === 0 ||
      state.turnNumber === this.lastStrategyReviewTurn ||
      !this.options.api?.reviewStrategy ||
      this.planningProviderDisabled
    ) {
      return plan
    }
    if (this.strategyReviewPromise) {
      await this.strategyReviewPromise
      return this.deckPlan ?? plan
    }
    this.lastStrategyReviewTurn = state.turnNumber
    const reviewCardIds = new Set([
      ...Object.keys(this.aiDeck().cards),
      ...memory.observedOpponentCardIds,
      ...memory.possibleOpponentSecretCardIds
    ])
    const cardDefinitions = Object.fromEntries(
      [...reviewCardIds]
        .map((cardId) => CARD_CATALOG.get(cardId))
        .filter((definition): definition is CardDefinition => definition !== undefined)
        .map((definition) => [definition.id, compactCardDefinition(definition)])
    )
    const request: AiStrategyReviewRequest = {
      reviewId: `strategy-review-${state.revision}-${this.decisionSequence}`,
      decisionClass: 'strategy-review',
      promptVersion: 'fair-strategy-review-v1',
      schemaVersion: 1,
      deadlineAtMs: Date.now() + MAX_STRATEGY_REVIEW_TIME_MS,
      previousPlan: toJsonObject(plan),
      strategicMemory: toJsonObject({
        ...memory,
        previousOpponentAssessment: this.opponentAssessment
      }),
      gameState: toJsonObject({
        informationPolicy: 'fair',
        observation: this.options.session.getAiObservation(),
        cardDefinitions,
        newEvidence: memory.evidence.filter((entry) =>
          memory.reviewReasons.includes(entry.summary)
        )
      })
    }
    const reviewStartedAt = performance.now()
    this.strategyReviewPromise = (async () => {
      try {
        const response = await this.options.api!.reviewStrategy!(request)
        if (!response.modelId.toLowerCase().includes('gpt-5.4-nano')) {
          throw new Error(
            `Strategy review returned disallowed model ${response.modelId}.`
          )
        }
        const revised = response.review.changed
          ? validateDeckPlanForDeck(response.review.revisedPlan, this.aiDeck())
          : plan
        const planChanged = JSON.stringify(revised) !== JSON.stringify(plan)
        if (response.review.changed && !planChanged) {
          throw new Error(
            'Strategy review reported a change but returned the existing plan.'
          )
        }
        if (
          response.review.changed &&
          !response.review.changeReasons.some((reason) =>
            memory.reviewReasons.includes(reason)
          )
        ) {
          throw new Error(
            'Strategy review changed the plan without citing supplied public evidence.'
          )
        }
        if (response.review.changed) {
          this.deckPlan = revised
          this.strategicTracker!.replacePlan(
            this.strategicPlanView(revised),
            this.options.session.getState()
          )
        }
        this.opponentAssessment = response.review.opponentAssessment
        this.strategicTracker!.markReviewed(memory.evidenceFingerprint)
        this.options.logger.info('[Game AI] reviewed match strategy', {
          changed: response.review.changed,
          changeReasons: response.review.changeReasons,
          opponentAssessment: response.review.opponentAssessment,
          modelId: response.modelId
        })
      } catch (error) {
        this.recordPermanentProviderFailure(error, 'planning')
        this.options.logger.warn(
          '[Game AI] strategy review failed; retaining current plan',
          errorDetails(error)
        )
      } finally {
        this.options.logger.info('[Game AI] strategy review timing', {
          elapsedMs: Number((performance.now() - reviewStartedAt).toFixed(2))
        })
        this.strategyReviewPromise = null
      }
    })()
    await this.strategyReviewPromise
    return this.deckPlan ?? plan
  }

  private mulliganCandidates(): readonly CandidateAction[] {
    const state = this.options.session.getState()
    const player = this.options.session.findPlayer(
      state,
      this.options.session.remoteParticipantId
    )
    const candidates: CandidateAction[] = []
    for (let mask = 0; mask < 1 << player.hand.length; mask += 1) {
      const cards = player.hand.filter((_card, index) => (mask & (1 << index)) !== 0)
      const id = `mulligan-${mask}`
      const command: ConfirmMulliganCommand = {
        type: 'confirm-mulligan',
        participantId: this.options.session.remoteParticipantId,
        replaceInstanceIds: cards.map((card) => card.instanceId)
      }
      candidates.push({
        command,
        public: {
          id,
          kind: 'confirm-mulligan',
          description:
            cards.length === 0
              ? 'Keep the entire opening hand.'
              : `Replace ${cards.map((card) => cardName(card.cardId)).join(', ')}.`,
          details: toJsonObject({
            replaceInstanceIds: command.replaceInstanceIds,
            cards: cards.map(cardSnapshot)
          })
        }
      })
    }
    return candidates
  }

  private turnCandidates(): readonly CandidateAction[] {
    const state = this.options.session.getState()
    const participantId = this.options.session.remoteParticipantId
    const player = this.options.session.findPlayer(state, participantId)
    if (state.pendingDiscover?.participantId === participantId) {
      return state.pendingDiscover.candidates.map((card, index) => ({
        command: {
          type: 'choose-discover-card',
          participantId,
          cardInstanceId: card.instanceId
        },
        public: {
          id: `discover-${index}`,
          kind: 'choose-discover-card',
          description: `Choose ${cardName(card.cardId)} from Discover.`,
          details: toJsonObject({ card: cardSnapshot(card) })
        }
      }))
    }
    const legality = this.options.session.match.getLegality?.(participantId)
    if (!legality) throw new Error('The match engine does not expose legal AI actions.')
    const candidates: CandidateAction[] = []
    let sequence = 0
    const add = (
      kind: AiActionKind,
      description: string,
      details: unknown,
      command: TurnMatchCommand
    ): void => {
      candidates.push({
        command,
        public: {
          id: `action-${sequence++}`,
          kind,
          description,
          details: toJsonObject(details)
        }
      })
    }

    for (const cardInstanceId of legality.playableCardInstanceIds) {
      const card = player.hand.find(
        (candidate) => candidate.instanceId === cardInstanceId
      )
      if (!card) continue
      const baseInput = this.options.session.match.getPlayInput?.(
        participantId,
        cardInstanceId
      )
      if (!baseInput) continue
      const choices = baseInput.choiceCount > 0 ? baseInput.legalChoices : [undefined]
      for (const choice of choices) {
        const input =
          choice === undefined
            ? baseInput
            : this.options.session.match.getPlayInput?.(
                participantId,
                cardInstanceId,
                choice
              )
        if (!input) continue
        const positions = input.requiresPosition ? input.legalPositions : [undefined]
        for (const position of positions) {
          for (const targets of targetAssignments(input)) {
            const command: TurnMatchCommand = {
              type: 'play-card',
              participantId,
              cardInstanceId,
              ...(position === undefined ? {} : { position }),
              ...(targets.length === 0 ? {} : { targets }),
              ...(choice === undefined ? {} : { choice })
            }
            const choiceIndex =
              choice === undefined ? -1 : input.legalChoices.indexOf(choice)
            const choiceLabel =
              choiceIndex < 0 ? undefined : input.choiceOptions[choiceIndex]?.label
            const targetLabels = targets.map((target) =>
              describeCardTarget(target, state, participantId)
            )
            add(
              'play-card',
              [
                `Play ${cardName(card.cardId)} for ${input.currentCost} mana`,
                choiceLabel ? `choose ${choiceLabel}` : '',
                position === undefined ? '' : `at board position ${position}`,
                targetLabels.length === 0 ? '' : `targeting ${targetLabels.join(', ')}`
              ]
                .filter(Boolean)
                .join('; '),
              {
                card: cardSnapshot(card),
                choice: choiceLabel ?? null,
                position: position ?? null,
                targets: targets.map((target) =>
                  publicCardTargetRef(target, participantId)
                ),
                targetLabels,
                targetSnapshots: targets.map((target) =>
                  cardTargetSnapshot(target, state, participantId)
                )
              },
              command
            )
          }
        }
      }
    }

    const opponentId = state.players.find(
      (candidate) => candidate.participantId !== participantId
    )?.participantId
    if (opponentId) {
      for (const [attackerId, targets] of Object.entries(legality.legalAttackTargets)) {
        const attacker: AttackCharacterRef =
          attackerId === `${participantId}:hero`
            ? { kind: 'hero' }
            : { kind: 'minion', instanceId: attackerId }
        for (const defender of targets) {
          add(
            'attack-character',
            `${describeAttackCharacter(attacker, participantId, state)} attacks ${describeAttackCharacter(defender, opponentId, state)}.`,
            {
              attacker,
              defender,
              attackerSnapshot: attackCharacterSnapshot(
                attacker,
                participantId,
                state,
                participantId
              ),
              defenderSnapshot: attackCharacterSnapshot(
                defender,
                opponentId,
                state,
                participantId
              )
            },
            {
              type: 'attack-character',
              participantId,
              attacker,
              defender
            }
          )
        }
      }
    }

    if (legality.legalHeroPower) {
      const power = HERO_POWER_CATALOG.require(player.heroPower.id)
      const targets =
        legality.legalHeroPowerTargets.length === 0
          ? [undefined]
          : legality.legalHeroPowerTargets
      for (const target of targets) {
        add(
          'use-hero-power',
          `Use ${power.displayName}${target ? ` on ${describeCardTarget(target, state, participantId)}` : ''}.`,
          {
            heroPower: power,
            target: target ?? null,
            targetSnapshot: target
              ? cardTargetSnapshot(target, state, participantId)
              : null
          },
          {
            type: 'use-hero-power',
            participantId,
            ...(target ? { target } : {})
          }
        )
      }
    }

    if (legality.canEndTurn) {
      add('end-turn', 'End the current turn.', {}, { type: 'end-turn', participantId })
    }
    return candidates
  }

  /** Adds model-facing descriptions after the worker has enumerated legal roots. */
  private candidatesFromWorkerRoots(
    roots: readonly Readonly<{
      readonly actionId: string
      readonly command: TurnMatchCommand
    }>[]
  ): readonly CandidateAction[] {
    const state = this.options.session.getState()
    const participantId = this.options.session.remoteParticipantId
    const player = this.options.session.findPlayer(state, participantId)
    const opponentId = this.options.session.localParticipantId
    return roots.map(({ actionId, command }) => {
      let kind: AiActionKind
      let description: string
      let details: JsonObject
      if (command.type === 'play-card') {
        const card = player.hand.find(
          (candidate) => candidate.instanceId === command.cardInstanceId
        )
        const definition = card ? CARD_CATALOG.get(card.cardId) : undefined
        const input = this.options.session.match.getPlayInput?.(
          participantId,
          command.cardInstanceId,
          command.choice
        )
        const targetLabels = (command.targets ?? []).map((target) =>
          describeCardTarget(target, state, participantId)
        )
        kind = 'play-card'
        description = `Play ${cardName(card?.cardId)} for ${input?.currentCost ?? card?.currentCost ?? definition?.cost ?? 0} mana${targetLabels.length > 0 ? ` targeting ${targetLabels.join(', ')}` : ''}.`
        details = toJsonObject({
          card: card ? cardSnapshot(card) : null,
          choice: command.choice ?? null,
          position: command.position ?? null,
          targets: (command.targets ?? []).map((target) =>
            publicCardTargetRef(target, participantId)
          ),
          targetLabels,
          targetSnapshots: (command.targets ?? []).map((target) =>
            cardTargetSnapshot(target, state, participantId)
          )
        })
      } else if (command.type === 'attack-character') {
        kind = 'attack-character'
        description = `${describeAttackCharacter(command.attacker, participantId, state)} attacks ${describeAttackCharacter(command.defender, opponentId, state)}.`
        details = toJsonObject({
          attacker: command.attacker,
          defender: command.defender,
          attackerSnapshot: attackCharacterSnapshot(
            command.attacker,
            participantId,
            state,
            participantId
          ),
          defenderSnapshot: attackCharacterSnapshot(
            command.defender,
            opponentId,
            state,
            participantId
          )
        })
      } else if (command.type === 'use-hero-power') {
        const power = HERO_POWER_CATALOG.require(player.heroPower.id)
        kind = 'use-hero-power'
        description = `Use ${power.displayName}${command.target ? ` on ${describeCardTarget(command.target, state, participantId)}` : ''}.`
        details = toJsonObject({
          heroPower: power,
          target: command.target ?? null,
          targetSnapshot: command.target
            ? cardTargetSnapshot(command.target, state, participantId)
            : null
        })
      } else if (command.type === 'choose-discover-card') {
        const card = state.pendingDiscover?.candidates.find(
          (candidate) => candidate.instanceId === command.cardInstanceId
        )
        kind = 'choose-discover-card'
        description = `Choose ${cardName(card?.cardId)} from Discover.`
        details = toJsonObject({ card: card ? cardSnapshot(card) : null })
      } else if (command.type === 'choose-card-option') {
        const option = state.pendingCardChoice?.options.find(
          (candidate) => candidate.choice === command.choice
        )
        kind = 'choose-discover-card'
        description = `Choose ${option?.label ?? `option ${command.choice}`}.`
        details = toJsonObject({ choice: command.choice, label: option?.label ?? null })
      } else {
        kind = 'end-turn'
        description = 'End the current turn.'
        details = {}
      }
      return { command, public: { id: actionId, kind, description, details } }
    })
  }

  /**
   * Builds short coherent lines on an isolated engine fork. Lines are disabled
   * when their first action could reveal a private secret or future RNG result.
   */
  private turnLineCandidates(): readonly CandidateAction[] {
    const atomic = this.turnCandidates()
    const state = this.options.session.getState()
    const immediateWins = atomic.filter((candidate) => {
      if (candidateMayResolvePrivateInformation(candidate, state)) {
        return false
      }
      const result = this.options.session.match.preview(candidate.command)
      return (
        result.accepted &&
        result.state.winnerId === this.options.session.remoteParticipantId
      )
    })
    if (immediateWins.length > 0) {
      return immediateWins.map((candidate, index) => ({
        ...candidate,
        previewCommands: [candidate.command],
        public: { ...candidate.public, id: `lethal-${index}` }
      }))
    }
    const firstActions = [...atomic]
      .sort((left, right) => previewPriority(right) - previewPriority(left))
      .slice(0, 96)
    interface LineNode {
      readonly actions: readonly CandidateAction[]
    }
    const materialize = (node: LineNode, id: string): CandidateAction => {
      const first = node.actions[0]!
      return {
        command: first.command,
        previewCommands: node.actions.map((action) => action.command),
        public: {
          id,
          kind: first.public.kind,
          description: node.actions
            .map((action, index) =>
              index === 0
                ? action.public.description
                : `Then: ${action.public.description}`
            )
            .join(' '),
          details: toJsonObject({
            ...first.public.details,
            plannedActionKinds: node.actions.map((action) => action.public.kind),
            plannedCardIds: node.actions
              .map(candidateCardId)
              .filter((cardId): cardId is string => cardId !== null)
          })
        }
      }
    }
    const linePriority = (node: LineNode): number =>
      node.actions.reduce(
        (total, action, index) =>
          total + previewPriority(action) * (index === 0 ? 10 : 1),
        node.actions.length
      )
    const completed: LineNode[] = firstActions.map((first) => ({ actions: [first] }))
    let frontier: LineNode[] = firstActions
      .filter(
        (first) =>
          first.public.kind !== 'end-turn' &&
          !candidateMayResolvePrivateInformation(first, state)
      )
      .map((first) => ({ actions: [first] }))
      .sort((left, right) => linePriority(right) - linePriority(left))
      .slice(0, LINE_SEARCH_BEAM_WIDTH)
    const startedAt = performance.now()
    let exploredNodes = 0

    for (
      let depth = 1;
      depth < LINE_SEARCH_MAX_DEPTH && frontier.length > 0;
      depth += 1
    ) {
      if (
        exploredNodes >= LINE_SEARCH_NODE_LIMIT ||
        performance.now() - startedAt >= LINE_SEARCH_TIME_MS
      )
        break
      const nextFrontier: LineNode[] = []
      for (const node of frontier) {
        if (
          exploredNodes >= LINE_SEARCH_NODE_LIMIT ||
          performance.now() - startedAt >= LINE_SEARCH_TIME_MS
        )
          break
        exploredNodes += 1
        const nextActions = this.options.session.match.analyze((fork) => {
          let latest: TurnMatchResult | null = null
          for (const action of node.actions) {
            latest = fork.dispatch(action.command)
            if (!latest.accepted) return [] as CandidateAction[]
          }
          if (
            !latest ||
            latest.state.activePlayerId !== this.options.session.remoteParticipantId ||
            latest.state.phase !== 'turns'
          ) {
            return [] as CandidateAction[]
          }
          const candidates = [...this.turnCandidates()].filter(
            (candidate) =>
              !candidateMayResolvePrivateInformation(candidate, latest!.state)
          )
          const productive = candidates
            .filter((candidate) => candidate.public.kind !== 'end-turn')
            .sort((left, right) => previewPriority(right) - previewPriority(left))
            .slice(0, 3)
          const endTurn = candidates.find(
            (candidate) => candidate.public.kind === 'end-turn'
          )
          return endTurn ? [...productive, endTurn] : productive
        })
        if (nextActions.length === 0) {
          completed.push(node)
          continue
        }
        for (const next of nextActions) {
          const expanded = { actions: [...node.actions, next] }
          if (next.public.kind === 'end-turn') completed.push(expanded)
          else nextFrontier.push(expanded)
        }
      }
      frontier = nextFrontier
        .sort((left, right) => linePriority(right) - linePriority(left))
        .slice(0, LINE_SEARCH_BEAM_WIDTH)
    }
    completed.push(...frontier)

    const lines: CandidateAction[] = []
    let sequence = 0
    const seen = new Set<string>()
    for (const node of completed) {
      const key = node.actions.map((action) => JSON.stringify(action.command)).join('|')
      if (seen.has(key)) continue
      seen.add(key)
      lines.push(materialize(node, `line-${sequence++}`))
    }
    return lines.length > 0 ? lines : atomic
  }

  private gameState(
    phase: 'mulligan' | 'turn',
    deckPlan: AiDeckPlan,
    candidates: readonly CandidateAction[] = []
  ): JsonObject {
    if (this.options.policy === 'strategic-v3') {
      this.strategicTracker?.update(
        this.options.session.getState(),
        this.options.session.getAiObservedEvents()
      )
      const observation = this.options.session.getAiObservation()
      const strategicMemory = this.strategicTracker?.snapshot ?? null
      const allPublicEvents = this.options.session.getAiObservedEvents()
      const retainedPublicEvents = allPublicEvents.slice(-MAX_PROVIDER_PUBLIC_EVENTS)
      const publicEventLedger = sanitizePrivateIdentifiers(retainedPublicEvents)
      const referencedIds = collectReferencedCardIds({
        players: observation.players,
        strategicMemory,
        publicEventLedger,
        candidateDetails: candidates.map((candidate) => candidate.public.details)
      })
      const cardDefinitions = Object.fromEntries(
        [...referencedIds]
          .map((cardId) => CARD_CATALOG.get(cardId))
          .filter(
            (definition): definition is CardDefinition => definition !== undefined
          )
          .map((definition) => [definition.id, compactCardDefinition(definition)])
      )
      const heroDefinitions = Object.fromEntries(
        observation.players.map((player) => [
          player.heroId,
          HERO_CATALOG.require(player.heroId)
        ])
      )
      const heroPowerDefinitions = Object.fromEntries(
        observation.players.map((player) => [
          player.heroPower.id,
          HERO_POWER_CATALOG.require(player.heroPower.id)
        ])
      )
      return toJsonObject({
        contextVersion: 6,
        informationPolicy: 'fair',
        phase,
        observation,
        deckPlan,
        strategicMemory,
        opponentAssessment: this.opponentAssessment,
        cardDefinitions,
        heroDefinitions,
        heroPowerDefinitions,
        publicEventLedger,
        publicEventLedgerWindow: {
          totalEvents: allPublicEvents.length,
          retainedEvents: retainedPublicEvents.length,
          truncated: retainedPublicEvents.length < allPublicEvents.length
        },
        stateConventions: {
          opponentOriginalDeckKnown: false,
          opponentHiddenHandIdentitiesKnown: false,
          explicitlyRevealedOpponentCardsKnown: true,
          remainingDeckOrderKnown: false,
          futureRandomValuesKnown: false,
          facedownSecretIdentityKnown: false,
          authority:
            'Structured runtime state, authored card effects, and engine-issued legal actions override display rules text.',
          actionGranularity: 'Dispatch only the selected first command.'
        }
      })
    }
    const publicState = this.options.session.getAiPublicState()
    const fairPublicState = toJsonObject(sanitizePrivateIdentifiers(publicState))
    const recentEvents = toJsonObject(
      sanitizePrivateIdentifiers(this.options.session.getAiObservedEvents(24))
    )
    const selfId = this.options.session.remoteParticipantId
    const opponentId = this.options.session.localParticipantId
    const referencedIds = collectReferencedCardIds(fairPublicState)
    collectReferencedCardIds(recentEvents, referencedIds)
    const selfDeck = this.aiDeck()
    const opponentPublic = publicState.players.find(
      (player) => player.participantId === opponentId
    )
    const opponentClass = opponentPublic
      ? HERO_CATALOG.require(opponentPublic.heroId).classId
      : null
    const possibleOpponentSecrets =
      (opponentPublic?.secrets.length ?? 0) > 0 && opponentClass
        ? CARD_CATALOG.all
            .filter(
              (definition) =>
                definition.cardClass === opponentClass &&
                definition.keywords?.includes('secret')
            )
            .map((definition) => definition.id)
        : []
    for (const cardId of possibleOpponentSecrets) referencedIds.add(cardId)
    const cardDefinitions = Object.fromEntries(
      [...referencedIds]
        .map((cardId) => CARD_CATALOG.get(cardId))
        .filter((definition): definition is CardDefinition => definition !== undefined)
        .map((definition) => [definition.id, compactCardDefinition(definition)])
    )
    const legality = this.options.session.match.getLegality?.(selfId)
    const participants = publicState.players.map((player) => {
      const role = player.participantId === selfId ? 'self' : 'opponent'
      const hero = HERO_CATALOG.require(player.heroId)
      const heroPower = HERO_POWER_CATALOG.require(player.heroPower.id)
      return {
        participantId: player.participantId,
        role,
        playerNumber: player.playerNumber,
        heroDefinition: hero,
        heroPowerDefinition: heroPower,
        tacticalSummary: {
          effectiveHealth: player.hero.health + player.hero.armor,
          health: player.hero.health,
          armor: player.hero.armor,
          manaAvailable: player.mana.available,
          manaMaximum: player.mana.maximum,
          handSize: player.hand.length,
          remainingDeckSize: player.deck.length,
          nextFatigueDamage: player.fatigueDamage,
          boardSize: player.board.length,
          openBoardSlots: Math.max(0, 7 - player.board.length),
          totalBoardAttack: player.board.reduce(
            (total, minion) => total + minion.attack,
            0
          ),
          totalBoardHealth: player.board.reduce(
            (total, minion) => total + minion.health,
            0
          ),
          secretCount: player.secrets?.length ?? 0,
          graveyardSize: player.graveyard?.length ?? 0,
          weapon: player.weapon,
          heroPower: player.heroPower,
          ...(role === 'self' && legality
            ? {
                playableCardInstanceIds: legality.playableCardInstanceIds,
                legalAttackerInstanceIds: legality.legalAttackerInstanceIds,
                heroPowerLegal: legality.legalHeroPower,
                canEndTurn: legality.canEndTurn
              }
            : {})
        }
      }
    })
    return toJsonObject({
      contextVersion: AI_CONTEXT_VERSION,
      mode: {
        id: this.options.session.match.setup.modeId ?? 'constructed',
        objective: 'Defeat the opposing hero.'
      },
      informationPolicy: 'fair',
      perspective: {
        selfParticipantId: selfId,
        opponentParticipantId: opponentId,
        selfController: 'remote-ai',
        opponentController: 'local-human',
        hiddenHandsKnown: false,
        hiddenSecretsKnown: false,
        exactRemainingDeckOrderKnown: false
      },
      phase,
      stateConventions: {
        remainingDeckOrder:
          'Deck arrays contain public card backs only. No remaining order or identity may be inferred.',
        actionGranularity:
          'Select one legal atomic action. A fresh resolved state follows.',
        authority:
          'Structured runtime state, card effects, and legal actions override display rulesText.'
      },
      deckPlan,
      selfOriginalDeck: {
        id: selfDeck.id,
        name: selfDeck.name,
        heroId: selfDeck.heroId,
        cards: Object.entries(selfDeck.cards).map(([cardId, count]) => ({
          cardId,
          count
        }))
      },
      opponentKnowledge: {
        originalDeckKnown: false,
        possibleSecretCardIds: possibleOpponentSecrets,
        secretPrior:
          possibleOpponentSecrets.length > 0 ? 'uniform-without-meta-prior' : 'none'
      },
      participants,
      cardDefinitions,
      currentState: fairPublicState,
      recentPublicEvents: recentEvents
    })
  }

  private decisionClass(phase: 'mulligan' | 'turn'): AiDecisionClass {
    if (phase === 'mulligan') return 'mulligan'
    return this.options.session.getState().pendingDiscover ? 'discover' : 'turn'
  }

  private deadlineAtMs(decisionClass: AiDecisionClass): number {
    void decisionClass
    return Date.now() + MAX_DECISION_TIME_MS
  }

  private analyzeAndShortlist(
    candidates: readonly CandidateAction[],
    phase: 'mulligan' | 'turn',
    deckPlan: AiDeckPlan
  ): readonly CandidateAction[] {
    if (candidates.length === 0) return candidates
    if (phase === 'mulligan') return candidates
    const selfId = this.options.session.remoteParticipantId
    const opponentId = this.options.session.localParticipantId
    const state = this.options.session.getState()
    const ordered = [...candidates].sort(
      (left, right) => previewPriority(right) - previewPriority(left)
    )
    const previewable: CandidateAction[] = []
    const addPreview = (candidate: CandidateAction | undefined): void => {
      if (
        candidate &&
        previewable.length < MAX_PREVIEWED_CANDIDATES &&
        !previewable.some((entry) => entry.public.id === candidate.public.id)
      ) {
        previewable.push(candidate)
      }
    }
    for (const kind of [
      'play-card',
      'attack-character',
      'use-hero-power',
      'choose-discover-card',
      'end-turn'
    ] as const) {
      addPreview(ordered.find((candidate) => candidate.public.kind === kind))
    }
    for (const candidate of ordered) addPreview(candidate)
    const analyzed = previewable.map((candidate) => {
      const planResourceCost = candidatePlanResourceCost(
        candidate,
        deckPlan,
        this.options.policy === 'strategic-v3'
          ? new Set(this.strategicTracker?.snapshot.activeReservedCardIds ?? [])
          : undefined
      )
      const analysis = candidateMayResolvePrivateInformation(candidate, state)
        ? uncertainAnalysis(state, selfId, opponentId, planResourceCost)
        : actionAnalysis(
            candidate.previewCommands
              ? this.options.session.match.previewSequence(candidate.previewCommands)
              : this.options.session.match.preview(candidate.command),
            state,
            selfId,
            opponentId,
            planResourceCost
          )
      return {
        ...candidate,
        analysis,
        public: {
          ...candidate.public,
          analysis
        }
      }
    })
    const wins = analyzed.filter((candidate) => candidate.analysis?.terminal === 'win')
    const viable = wins.length > 0 ? wins : analyzed
    const safe = viable.filter((candidate) => candidate.analysis?.terminal !== 'loss')
    const protectedCandidates = safe.length > 0 ? safe : viable
    const sorted = [...protectedCandidates].sort(
      (left, right) =>
        (right.analysis?.score ?? Number.NEGATIVE_INFINITY) -
        (left.analysis?.score ?? Number.NEGATIVE_INFINITY)
    )
    const selected: CandidateAction[] = []
    const add = (candidate: CandidateAction | undefined): void => {
      if (
        candidate &&
        !selected.some((entry) => entry.public.id === candidate.public.id)
      ) {
        selected.push(candidate)
      }
    }
    for (const kind of [
      'play-card',
      'attack-character',
      'use-hero-power',
      'choose-discover-card',
      'end-turn'
    ] as const) {
      add(sorted.find((candidate) => candidate.public.kind === kind))
    }
    for (const candidate of sorted) {
      if (selected.length >= MAX_MODEL_CANDIDATES) break
      add(candidate)
    }
    return selected
  }

  /**
   * Phase-3 defense in depth: direct targeted damage at the AI's own hero or
   * friendly characters is destructive waste unless the resolved outcome is an
   * immediate win. Both the deterministic fallback and provider-selected
   * choices flow through shortlists that exclude proven-dominated variants;
   * this guard protects the raw fallback path when no search dossiers exist.
   */
  private isUnjustifiedSelfDamage(candidate: CandidateAction): boolean {
    const command = candidate.command
    const aiId = this.options.session.remoteParticipantId
    if (command.type === 'play-card') {
      const targets = command.targets ?? []
      if (targets.length === 0) return false
      if (!targets.every((target) => target.participantId === aiId)) return false
      const state = this.options.session.getState()
      const card = state.players
        .find((player) => player.participantId === aiId)
        ?.hand.find((entry) => entry.instanceId === command.cardInstanceId)
      const definition = card ? CARD_CATALOG.get(card.cardId) : undefined
      const targetedDamage = (definition?.effects ?? []).some((trigger) =>
        (trigger.actions ?? []).some((action) => {
          const target = isCardEffectObject(action.target) ? action.target : null
          return (
            action.action === 'damage' &&
            target?.['controller'] === 'any' &&
            target['selection'] === 'chosen'
          )
        })
      )
      if (!targetedDamage) return false
    } else if (command.type === 'use-hero-power') {
      if (!command.target || command.target.participantId !== aiId) return false
      const state = this.options.session.getState()
      const player = state.players.find((entry) => entry.participantId === aiId)
      const power = player ? HERO_POWER_CATALOG.get(player.heroPower.id) : undefined
      if (power?.effect.kind !== 'damage-character') return false
    } else {
      return false
    }
    if (candidate.analysis?.terminal === 'win') return false
    if (candidate.analysis && candidate.analysis.accepted) return true
    // Worker-less fallback deliberately avoids renderer-thread simulation.
    return candidate.analysis ? !candidate.analysis.accepted : true
  }

  private fallback(
    candidates: readonly CandidateAction[],
    deckPlan: AiDeckPlan
  ): CandidateAction {
    if (candidates[0]?.public.kind === 'confirm-mulligan') {
      const priority = new Set(deckPlan.mulliganPriorityCardIds)
      return [...candidates].sort((left, right) => {
        const replacementScore = (candidate: CandidateAction): number => {
          const cards = candidate.public.details['cards']
          if (!Array.isArray(cards)) return Number.NEGATIVE_INFINITY
          return cards.reduce((score, card) => {
            if (typeof card !== 'object' || card === null || Array.isArray(card)) {
              return score
            }
            const cardId = (card as Record<string, unknown>)['cardId']
            if (typeof cardId !== 'string') return score
            if (priority.has(cardId)) return score - 100
            return score + (CARD_CATALOG.get(cardId)?.cost ?? 0)
          }, 0)
        }
        return replacementScore(right) - replacementScore(left)
      })[0]!
    }
    const wins = candidates.filter(
      (candidate) => candidate.analysis?.terminal === 'win'
    )
    const safe = candidates.filter(
      (candidate) => candidate.analysis?.terminal !== 'loss'
    )
    const pool = wins.length > 0 ? wins : safe.length > 0 ? safe : candidates
    const ordered = [...pool].sort(
      (left, right) =>
        (right.analysis?.score ?? Number.NEGATIVE_INFINITY) -
        (left.analysis?.score ?? Number.NEGATIVE_INFINITY)
    )
    return (
      ordered.find((candidate) => !this.isUnjustifiedSelfDamage(candidate)) ??
      ordered[0]!
    )
  }

  private logResponse(request: AiDecisionRequest, response: AiDecisionResponse): void {
    if (!import.meta.env.DEV) return
    if (!response.debug) {
      this.options.logger.info(`[Game AI] response ${request.decisionId}`, {
        actionId: response.actionId,
        rationale: response.rationale,
        decisionClass: response.decisionClass,
        modelId: response.modelId
      })
      return
    }
    console.groupCollapsed(
      `[Game AI] response ${request.decisionId}: ${response.actionId} (${response.debug.durationMs} ms)`
    )
    console.info('Game decision request', request)
    console.info('Model decision', {
      actionId: response.actionId,
      rationale: response.rationale,
      decisionClass: response.decisionClass,
      modelId: response.modelId
    })
    console.info('Provider request', {
      url: response.debug.url,
      body: response.debug.requestBody
    })
    console.info('Provider response', response.debug.responseBody)
    console.info('Provider duration (ms)', response.debug.durationMs)
    console.groupEnd()
  }

  private syntheticDossier(
    candidate: CandidateAction,
    score: number
  ): AiCandidateDossier {
    const state = this.options.session.getState()
    const selfId = this.options.session.remoteParticipantId
    const opponentId = this.options.session.localParticipantId
    const self = participantSummary(state, selfId)
    const opponent = participantSummary(state, opponentId)
    return {
      actionId: candidate.public.id,
      firstCommand: candidate.command,
      recommendedContinuation: [],
      projectedSuccessor: {
        revision: state.revision,
        winnerId: state.winnerId,
        selfEffectiveHealth: self.effectiveHealth,
        opponentEffectiveHealth: opponent.effectiveHealth,
        selfBoardAttack: self.boardAttack,
        opponentBoardAttack: opponent.boardAttack
      },
      opponentStrongestResponse: [],
      tacticalProofs: [],
      evaluation: ZERO_EVALUATION,
      score,
      meanScenarioValue: score,
      downsideScenarioValue: score,
      worstCaseScenarioValue: score,
      resourceUsage: {
        manaSpent: 0,
        cardsSpent: 0,
        reservedResourceCost: 0
      },
      uncertainty: {
        determinizations: 0,
        randomOutcomeSamples: 0,
        incomplete: true
      },
      strategyProgress: 0
    }
  }

  private mulliganScore(candidate: CandidateAction, deckPlan: AiDeckPlan): number {
    const priority = new Set(deckPlan.mulliganPriorityCardIds)
    const cards = candidate.public.details['cards']
    if (!Array.isArray(cards)) return Number.NEGATIVE_INFINITY
    return cards.reduce((score, card) => {
      if (typeof card !== 'object' || card === null || Array.isArray(card)) return score
      const cardId = (card as Record<string, unknown>)['cardId']
      if (typeof cardId !== 'string') return score
      return (
        score + (priority.has(cardId) ? -100 : (CARD_CATALOG.get(cardId)?.cost ?? 0))
      )
    }, 0)
  }

  private hasComplexDecisionSignals(
    candidates: readonly CandidateAction[],
    plan: AiDeckPlan
  ): boolean {
    const state = this.options.session.getState()
    const selfId = this.options.session.remoteParticipantId
    const opponent = state.players.find((player) => player.participantId !== selfId)
    const self = state.players.find((player) => player.participantId === selfId)
    if (!self || !opponent) return true
    if ((opponent.secrets ?? []).some((secret) => !secret.revealed)) return true
    const publicIncoming =
      opponent.board.reduce((total, minion) => total + Math.max(0, minion.attack), 0) +
      Math.max(0, opponent.weapon?.attack ?? 0)
    if (self.hero.health + self.hero.armor <= publicIncoming + 5) return true
    return candidates.some(
      (candidate) =>
        (candidate.public.kind !== 'end-turn' &&
          candidateMayResolvePrivateInformation(candidate, state)) ||
        candidatePlanResourceCost(
          candidate,
          plan,
          new Set(this.strategicTracker?.snapshot.activeReservedCardIds ?? [])
        ) > 0
    )
  }

  private decisionComplexity(
    phase: 'mulligan' | 'turn',
    dossiers: readonly AiCandidateDossier[],
    candidates: readonly CandidateAction[],
    hasComplexSignals: boolean
  ): 'simple' | 'normal' | 'complex' {
    if (phase === 'mulligan') return 'normal'
    const descriptions = new Map(
      candidates.map((candidate) => [candidate.public.id, candidate.public.description])
    )
    const leader = dossiers[0]
    const leaderDescription = leader ? descriptions.get(leader.actionId) : undefined
    const distinctRunner = dossiers
      .slice(1)
      .find((dossier) => descriptions.get(dossier.actionId) !== leaderDescription)
    const topGap = distinctRunner
      ? (leader?.score ?? 0) - distinctRunner.score
      : Number.POSITIVE_INFINITY
    const topDossiers = distinctRunner ? [leader, distinctRunner] : [leader]
    const strategicRisk = topDossiers.some(
      (dossier) =>
        dossier !== undefined &&
        (dossier.resourceUsage.reservedResourceCost > 0 ||
          dossier.evaluation.informationValue > 0)
    )
    if (hasComplexSignals || strategicRisk || topGap <= CLOSE_SCORE_MARGIN)
      return 'complex'
    if (leader?.uncertainty.incomplete || distinctRunner?.uncertainty.incomplete)
      return 'normal'
    return topGap >= SIMPLE_SCORE_MARGIN ? 'simple' : 'normal'
  }

  private async strategicSearchDossiers(
    candidates: readonly CandidateAction[],
    deckPlan: AiDeckPlan,
    totalDeadlineAtMs: number,
    localBudgetMs: number
  ): Promise<
    Readonly<{
      dossiers: readonly AiCandidateDossier[]
      roots: readonly Readonly<{
        readonly actionId: string
        readonly command: TurnMatchCommand
      }>[]
    }>
  > {
    const roots = [...candidates]
      .sort((left, right) => previewPriority(right) - previewPriority(left))
      .slice(0, 128)
      .map((candidate) => ({
        actionId: candidate.public.id,
        command: candidate.command
      }))
    if (this.disposed) throw new Error('AI controller was disposed.')
    this.workerClient ??= new StrategicAiWorkerClient()
    const availableMs = Math.max(
      1,
      Math.min(
        localBudgetMs,
        totalDeadlineAtMs - STRATEGIC_DISPATCH_RESERVE_MS - Date.now()
      )
    )
    const expectedRevision = this.options.session.getState().revision
    const checkpointStartedAt = performance.now()
    const checkpoint = this.options.session.match.getCheckpoint()
    const checkpointCaptureMs = performance.now() - checkpointStartedAt
    const result = await this.workerClient.search({
      type: 'search',
      requestId: `search-${expectedRevision}-${this.decisionSequence++}`,
      observationRevision: expectedRevision,
      checkpoint,
      perspectivePlayerId: this.options.session.remoteParticipantId,
      ...(roots.length > 0 ? { roots } : {}),
      plan: this.strategicPlanView(deckPlan),
      limits: { ...STRATEGIC_AI_SEARCH_LIMITS, timeBudgetMs: availableMs },
      deterministicSampleSeed: Math.imul(expectedRevision + 1, 0x9e3779b1) >>> 0
    })
    if (result.observationRevision !== expectedRevision) {
      throw new Error('Strategic AI worker returned a stale observation revision.')
    }
    this.lastLocalSearchElapsedMs = result.elapsedMs
    this.options.logger.info('[Game AI] worker search completed', {
      revision: expectedRevision,
      elapsedMs: result.elapsedMs,
      exploredNodes: result.exploredNodes,
      cacheHits: result.cacheHits,
      roots: result.roots.length,
      partial: result.partial,
      rendererCheckpointMs: Number(checkpointCaptureMs.toFixed(2))
    })
    if (checkpointCaptureMs > 16.7) {
      this.options.logger.warn('[Game AI] checkpoint capture exceeded one frame', {
        revision: expectedRevision,
        elapsedMs: Number(checkpointCaptureMs.toFixed(2))
      })
    }
    return { dossiers: result.candidateDossiers, roots: result.roots }
  }

  private async chooseStrategic(
    phase: 'mulligan' | 'turn',
    candidates: readonly CandidateAction[]
  ): Promise<AiActionDecision> {
    if (phase === 'mulligan' && candidates.length === 0)
      throw new Error(`No legal AI actions exist for ${phase}.`)
    let availableCandidates = candidates
    let deckPlan = await this.ensureDeckPlan()
    if (phase === 'turn') deckPlan = await this.reviewStrategyIfNeeded(deckPlan)
    const expectedRevision = this.options.session.getState().revision
    const totalDeadlineAtMs = Date.now() + STRATEGIC_MAX_DECISION_TIME_MS
    const decisionClass = this.decisionClass(phase)
    let hasComplexSignals = false
    let dossiers: readonly AiCandidateDossier[]
    if (phase === 'turn') {
      try {
        const localSearchStartedAt = Date.now()
        const state = this.options.session.getState()
        const self = this.options.session.findPlayer(
          state,
          this.options.session.remoteParticipantId
        )
        const opponent = this.options.session.findPlayer(
          state,
          this.options.session.localParticipantId
        )
        const visiblyComplex =
          (opponent.secrets ?? []).some((secret) => !secret.revealed) ||
          self.hero.health + self.hero.armor <=
            opponent.board.reduce(
              (total, minion) => total + Math.max(0, minion.attack),
              0
            ) +
              Math.max(0, opponent.weapon?.attack ?? 0) +
              5
        let search = await this.strategicSearchDossiers(
          availableCandidates,
          deckPlan,
          totalDeadlineAtMs,
          visiblyComplex ? COMPLEX_LOCAL_SEARCH_MS : NORMAL_LOCAL_SEARCH_MS
        )
        dossiers = search.dossiers
        if (availableCandidates.length === 0) {
          availableCandidates = this.candidatesFromWorkerRoots(search.roots)
        }
        hasComplexSignals = this.hasComplexDecisionSignals(
          availableCandidates,
          deckPlan
        )
        const needsDeepening =
          !visiblyComplex &&
          this.decisionComplexity(
            phase,
            dossiers,
            availableCandidates,
            hasComplexSignals
          ) === 'complex'
        const remainingDeepSearchMs =
          COMPLEX_LOCAL_SEARCH_MS - (Date.now() - localSearchStartedAt)
        if (needsDeepening && remainingDeepSearchMs > 100) {
          search = await this.strategicSearchDossiers(
            availableCandidates,
            deckPlan,
            totalDeadlineAtMs,
            remainingDeepSearchMs
          )
          dossiers = search.dossiers
        }
      } catch (error) {
        this.options.logger.warn(
          '[Game AI] strategic local search failed; using deterministic fallback',
          errorDetails(error)
        )
        dossiers = []
      }
      if (availableCandidates.length === 0) {
        const participantId = this.options.session.remoteParticipantId
        availableCandidates = [
          {
            command: { type: 'end-turn', participantId },
            public: {
              id: 'worker-fallback-end-turn',
              kind: 'end-turn',
              description: 'End the current turn.',
              details: {}
            }
          }
        ]
      }
    } else {
      dossiers = [...candidates]
        .sort(
          (left, right) =>
            this.mulliganScore(right, deckPlan) - this.mulliganScore(left, deckPlan)
        )
        .slice(0, 8)
        .map((candidate, index) =>
          this.syntheticDossier(candidate, candidates.length - index)
        )
    }
    if (dossiers.length === 0) {
      // A missing/crashed worker must never move expensive preview analysis back
      // onto the rendering thread. Use the cheap deterministic ordering instead.
      const fallback = this.fallback(availableCandidates, deckPlan)
      return {
        expectedRevision,
        actionId: fallback.public.id,
        command: fallback.command,
        source: 'fallback'
      }
    }
    const allRankedDossiers = dossiers.slice(0, 8)
    const complexity = this.decisionComplexity(
      phase,
      allRankedDossiers,
      availableCandidates,
      hasComplexSignals
    )
    const rankedDossiers = allRankedDossiers.slice(0, complexity === 'complex' ? 8 : 5)
    const shortlisted = rankedDossiers
      .map((dossier) =>
        availableCandidates.find(
          (candidate) => candidate.public.id === dossier.actionId
        )
      )
      .filter((candidate): candidate is CandidateAction => candidate !== undefined)
    if (shortlisted.length === 0) {
      const fallback = this.fallback(availableCandidates, deckPlan)
      return {
        expectedRevision,
        actionId: fallback.public.id,
        command: fallback.command,
        source: 'fallback'
      }
    }
    const fallback = shortlisted[0]!
    const forced = allRankedDossiers.find((dossier) =>
      dossier.tacticalProofs.some(
        (proof) => proof.proven && proof.complete && proof.kind === 'guaranteed-lethal'
      )
    )
    if (forced || shortlisted.length === 1) {
      const selected = forced
        ? (shortlisted.find((candidate) => candidate.public.id === forced.actionId) ??
          fallback)
        : fallback
      return {
        expectedRevision,
        actionId: selected.public.id,
        command: selected.command,
        source: 'fallback'
      }
    }
    if (complexity === 'simple') {
      this.options.logger.info('[Game AI] selected clear local strategic action', {
        revision: expectedRevision,
        actionId: fallback.public.id,
        route: complexity,
        localSearchElapsedMs: this.lastLocalSearchElapsedMs
      })
      return {
        expectedRevision,
        actionId: fallback.public.id,
        command: fallback.command,
        source: 'fallback'
      }
    }
    if (!this.options.api || this.decisionProviderDisabled) {
      return {
        expectedRevision,
        actionId: fallback.public.id,
        command: fallback.command,
        source: 'fallback'
      }
    }
    const baseRequest = {
      decisionId: `${phase}-${expectedRevision}-${this.decisionSequence++}`,
      phase,
      decisionClass,
      matchRevision: expectedRevision,
      promptVersion: 'fair-strategic-ranker-v3',
      contextVersion: 6,
      schemaVersion: 5,
      gameState: this.gameState(phase, deckPlan, shortlisted),
      legalActions: shortlisted.map((candidate) => candidate.public),
      candidateDossiers: rankedDossiers
    } as const
    const providerPassMs =
      complexity === 'complex' ? COMPLEX_PROVIDER_PASS_MS : NORMAL_PROVIDER_PASS_MS
    const rankDeadlineAtMs = Math.min(
      Date.now() + providerPassMs,
      totalDeadlineAtMs -
        (complexity === 'complex' ? providerPassMs : 0) -
        STRATEGIC_DISPATCH_RESERVE_MS
    )
    if (Date.now() >= rankDeadlineAtMs) {
      return {
        expectedRevision,
        actionId: fallback.public.id,
        command: fallback.command,
        source: 'fallback'
      }
    }
    let firstPass: CandidateAction
    let ordering: readonly string[]
    try {
      const rankRequest: AiDecisionRequest = {
        ...baseRequest,
        pass: 'rank',
        deadlineAtMs: rankDeadlineAtMs
      }
      const response = await this.options.api.decide(rankRequest)
      this.logResponse(rankRequest, response)
      if (!response.modelId.toLowerCase().includes('gpt-5.4-nano')) {
        throw new Error(`Rank pass returned disallowed model ${response.modelId}.`)
      }
      ordering = response.orderedActionIds ?? []
      const allowed = new Set(shortlisted.map((candidate) => candidate.public.id))
      if (
        ordering.length !== allowed.size ||
        new Set(ordering).size !== allowed.size ||
        ordering[0] !== response.actionId ||
        ordering.some((id) => !allowed.has(id))
      )
        throw new Error('Rank pass did not return a complete valid shortlist ordering.')
      firstPass = shortlisted.find(
        (candidate) => candidate.public.id === response.actionId
      )!
      if (!firstPass)
        throw new Error(`Rank pass selected stale action ${response.actionId}.`)
    } catch (error) {
      this.recordPermanentProviderFailure(error, 'decision')
      this.options.logger.warn(
        '[Game AI] rank pass failed; using local search winner',
        errorDetails(error)
      )
      return {
        expectedRevision,
        actionId: fallback.public.id,
        command: fallback.command,
        source: 'fallback'
      }
    }
    if (complexity !== 'complex') {
      return {
        expectedRevision,
        actionId: firstPass.public.id,
        command: firstPass.command,
        source: 'model'
      }
    }
    const criticDeadlineAtMs = Math.min(
      Date.now() + providerPassMs,
      totalDeadlineAtMs - STRATEGIC_DISPATCH_RESERVE_MS
    )
    if (Date.now() >= criticDeadlineAtMs) {
      return {
        expectedRevision,
        actionId: firstPass.public.id,
        command: firstPass.command,
        source: 'model'
      }
    }
    try {
      const criticActionIds = new Set(ordering.slice(0, 4))
      const criticRequest: AiDecisionRequest = {
        ...baseRequest,
        decisionId: `${baseRequest.decisionId}-critic`,
        pass: 'critic',
        legalActions: baseRequest.legalActions.filter((action) =>
          criticActionIds.has(action.id)
        ),
        candidateDossiers: baseRequest.candidateDossiers.filter((dossier) =>
          criticActionIds.has(dossier.actionId)
        ),
        firstPassRanking: ordering.filter((actionId) => criticActionIds.has(actionId)),
        deadlineAtMs: criticDeadlineAtMs
      }
      const response = await this.options.api.decide(criticRequest)
      this.logResponse(criticRequest, response)
      if (!response.modelId.toLowerCase().includes('gpt-5.4-nano')) {
        throw new Error(`Critic pass returned disallowed model ${response.modelId}.`)
      }
      const selected = shortlisted.find(
        (candidate) => candidate.public.id === response.actionId
      )
      if (!selected)
        throw new Error(`Critic pass selected stale action ${response.actionId}.`)
      return {
        expectedRevision,
        actionId: selected.public.id,
        command: selected.command,
        source: 'model'
      }
    } catch (error) {
      this.recordPermanentProviderFailure(error, 'decision')
      this.options.logger.warn(
        '[Game AI] critic pass failed; retaining validated rank winner',
        errorDetails(error)
      )
      return {
        expectedRevision,
        actionId: firstPass.public.id,
        command: firstPass.command,
        source: 'model'
      }
    }
  }

  private async choose(
    phase: 'mulligan' | 'turn',
    candidates: readonly CandidateAction[]
  ): Promise<AiActionDecision> {
    if (this.options.policy === 'strategic-v3') {
      return this.chooseStrategic(phase, candidates)
    }
    if (candidates.length === 0)
      throw new Error(`No legal AI actions exist for ${phase}.`)
    const deckPlan = await this.deckPlanForDecision(phase)
    // Deck planning is a once-per-match prerequisite with its own deadline. Do not
    // let its latency consume the budget for the mulligan or turn decision itself.
    const totalDeadlineAtMs = Date.now() + MAX_DECISION_TIME_MS
    const expectedRevision = this.options.session.getState().revision
    const decisionClass = this.decisionClass(phase)
    const shortlisted = this.analyzeAndShortlist(candidates, phase, deckPlan)
    const request: AiDecisionRequest = {
      decisionId: `${phase}-${expectedRevision}-${this.decisionSequence++}`,
      phase,
      decisionClass,
      matchRevision: expectedRevision,
      promptVersion: AI_PROMPT_VERSION,
      contextVersion: AI_CONTEXT_VERSION,
      schemaVersion: AI_SCHEMA_VERSION,
      deadlineAtMs: Math.min(this.deadlineAtMs(decisionClass), totalDeadlineAtMs),
      gameState: this.gameState(phase, deckPlan, shortlisted),
      legalActions: shortlisted.map((candidate) => candidate.public)
    }
    const fallback = this.fallback(shortlisted, deckPlan)
    const forced = shortlisted.find(
      (candidate) => candidate.analysis?.terminal === 'win'
    )
    if (forced || shortlisted.length === 1) {
      const selected = forced ?? shortlisted[0]!
      return {
        expectedRevision,
        actionId: selected.public.id,
        command: selected.command,
        source: 'fallback'
      }
    }
    if (
      !this.options.api ||
      this.decisionProviderDisabled ||
      Date.now() + 250 >= request.deadlineAtMs
    ) {
      return {
        expectedRevision,
        actionId: fallback.public.id,
        command: fallback.command,
        source: 'fallback'
      }
    }

    try {
      const response = await this.options.api.decide(request)
      this.logResponse(request, response)
      if (response.decisionClass !== decisionClass) {
        throw new Error(
          `Model returned mismatched decision class ${response.decisionClass}.`
        )
      }
      const selected = shortlisted.find(
        (candidate) => candidate.public.id === response.actionId
      )
      if (!selected)
        throw new Error(`Model selected stale action ${response.actionId}.`)
      return {
        expectedRevision,
        actionId: selected.public.id,
        command: selected.command,
        source: 'model'
      }
    } catch (error) {
      this.recordPermanentProviderFailure(error, 'decision')
      this.options.logger.warn(
        `[Game AI] ${request.decisionId} failed; using local fallback`,
        errorDetails(error)
      )
      return {
        expectedRevision,
        actionId: fallback.public.id,
        command: fallback.command,
        source: 'fallback'
      }
    }
  }
}
