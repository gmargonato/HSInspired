import {
  cardCostResource,
  cardPaymentCost,
  canPayCardCost
} from '../../../game-rules/match/rules/card-cost-resource'
import {
  CARD_CATALOG,
  HERO_POWER_CATALOG,
  cardHasTribe
} from '../../../game-rules/content'
import {
  searchTactics,
  inspectTacticalLine,
  type TacticalOutcome
} from '../../../game-rules/match/ai/tactical-search'
import {
  enumerateLegalCommands,
  canonicalCommandKey,
  createSeededRng,
  type TurnMatchCommand,
  type TurnMatchState
} from '../../../game-rules/match'
import {
  InformationSetMcts,
  mctsRootRecommendationScore,
  type MctsCandidate,
  type MctsSelection
} from '../../../game-rules/match/ai/information-set-mcts'
import {
  boardMinionAttacksUsed,
  effectiveBoardMinionKeywords
} from '../../../game-rules/match/rules/minion-attack-state'
import type { AiObservation, AiObservedPlayer } from '../../../game-rules/match/ai'
import { createFairHypothesisCheckpoint } from '../../../game-rules/match/ai/fair-hypothesis-checkpoint'
import {
  expertCoinHeroPowerSequencePenalty,
  EXPERT_COIN_HERO_POWER_PENALTY
} from './expert-coin-hero-power-policy'
import type {
  AiDecisionApi,
  AiDecisionIdentity,
  AiDecisionRequest,
  AiDecisionResponse,
  JsonObject,
  AiSettings
} from '../../../desktop/contracts/ipc/ai'
import {
  sameAiIntent,
  type AiActionIntent,
  type AiDecisionChoice
} from '../../../desktop/contracts/ipc/ai-deliberation'
import { aiActionIntent } from './ai-action-intent'
import { aiActions } from './ai-context'
import { EXPERT_AI_POLICY_REVISION } from './expert-ai-worker-protocol'
import {
  hasKnownCthunPayoff,
  unpaidFriendlyDamageHeroPowerPenalty,
  unpaidActionPenalty
} from './expert-ai-action-safety'
import { LOCAL_AI_POLICY } from './local-ai-policy'
import { CTHUN_ID } from '../../../game-rules/match/cthun'
import { expertDrawPreference } from './expert-draw-preference'
import {
  expertAttackSetupPreference,
  expertResourceSetupPreference
} from './expert-resource-preference'
import { expertSingletonCleanupSeeds } from './expert-cleanup-seeds'
import { inspectExpertPublicThreat } from './expert-public-threat'
import { createExpertAttackOrderInspector } from './expert-action-ordering'
import { identicalSupportedContinuation } from './expert-completed-attack-order'
import {
  inspectExpertAction,
  expertContinuationPenalty,
  evaluateExpertBoundary,
  type ExpertActionOutcome
} from './expert-action-outcome'
import { GameBoardSession } from '../game-board-session'
import type { ExpertDeckStrategyBinding } from '../../../game-rules/decks/expert-deck-strategy'
import {
  ExpertDeckEvaluator,
  type ExpertDeckEvaluation
} from './expert-deck-evaluation'

import {
  LOCAL_AI_RESOURCE_PROFILES,
  type LocalAiDifficulty
} from './local-ai-resources'

const EXPERT_MODEL_ID = 'hardware-local-v2'
const MCTS_POSITION_VALUE_SCALE = 900
const MCTS_POSITION_VALUE_LIMIT = 0.9
const MCTS_MAX_CACHED_INFORMATION_SETS = 4_096

export interface LocalAiDecisionOptions {
  readonly publicThreat?: ReturnType<typeof inspectExpertPublicThreat>
  readonly profile?: LocalAiDifficulty
  readonly deckStrategy?: ExpertDeckStrategyBinding
  readonly budgetMs?: number
  /** Deterministic test/benchmark cap; production requests use the wall-clock budget. */
  readonly workBudget?: number
  readonly preferredContinuation?: AiActionIntent
  readonly expertPlanSearchLimitMs?: number
  readonly expertReplanSearchLimitMs?: number
  readonly onSearchProgress?: (progress: LocalAiSearchProgress) => void
  /** True only when the session was built from a fair-hypothesis checkpoint. */
  readonly fairHypothesis?: boolean
}

export interface LocalAiSearchProgress {
  readonly actionId: string
  readonly command: TurnMatchCommand
  readonly description: string
  readonly recommendationValue: number
  readonly iterations: number
}

// Search/evaluation policy is shared; difficulty only bounds available time.
const SEARCH_LIMITS = {
  maxThinkMs: 54_500,
  rootSearchLimit: 64,
  traceCandidateLimit: 192
} as const

export interface LocalAiScoreComponents {
  readonly positionDelta: number
  readonly commandPreference: number
  readonly continuationPreference: number
  readonly threatDefense: number
  readonly opponentBoardRemoval: number
  readonly friendlyBoardLoss: number
  readonly sequenceRefinement: number
}
type LocalAction = ReturnType<typeof aiActions>[number]

/** A compact, serializable explanation of one candidate considered by the CPU search. */
export interface LocalAiCandidateTrace {
  /** Exact sequence is certified against public attacks under a root lethal threat. */
  readonly publicAttackThreat?: boolean
  readonly publicAttackSurvival?: boolean
  readonly outcome?: TacticalOutcome
  readonly provenWin?: boolean
  readonly publicReply?: 'lethal' | 'clear' | 'unknown'
  readonly actionId: string
  readonly type: TurnMatchCommand['type']
  readonly description: string
  readonly score: number
  readonly scoreComponents: LocalAiScoreComponents
  readonly accepted: boolean
  readonly phase: TurnMatchState['phase'] | null
  readonly winnerId: string | null
  readonly sequenceIntents?: readonly AiActionIntent[]
  /** Same sampled prefix, same supporting visits; review evidence only, not a plan. */
  readonly resourceReviewIntents?: readonly AiActionIntent[]
  readonly visits?: number
  readonly meanValue?: number
  /** Mean added position points across this root action's sampled leaves. */
  readonly meanDeckStrategyAdjustment?: number
  readonly prior?: number
  /** Value of the best continuation sampled at least twice. */
  readonly recommendationValue?: number
  readonly recommendationRiskAdjustment?: number
  readonly recommendationPreferenceAdjustment?: number
  /** Expert action/sequence penalties, also applied during world consensus. */
  readonly recommendationTacticalPenalty?: number
  readonly actionOutcomeReason?: string
}

/** Diagnostics for one local decision; kept small enough to persist with a match log. */
export interface LocalAiDecisionTrace {
  readonly boundaryEvaluations?: number
  readonly publicThreatReview?: ReturnType<typeof inspectExpertPublicThreat>['stats']
  readonly tacticalNodes?: number
  readonly orderingReview?: {
    readonly dispatches: number
    readonly comparisons: number
    readonly cacheHits: number
    readonly abstentions: number
    readonly durationMs: number
  }
  readonly tacticalExhausted?: boolean
  readonly decisionPriority?: 'verified-win' | 'survival' | 'strategy'
  /** Root position only; diagnostic contributions do not establish action causality. */
  readonly deckStrategy?: ExpertDeckEvaluation
  readonly requestId: string
  readonly phase: 'plan' | 'action' | 'mulligan'
  readonly durationMs: number
  readonly evaluatedActions: number
  readonly refinedActions: number
  readonly continuations: number
  readonly timedOut: boolean
  readonly baseScore: number | null
  readonly visibleThreat: number | null
  readonly chosenActionId: string | null
  readonly candidates: readonly LocalAiCandidateTrace[]
  readonly rootLegalActionCount?: number
  /** Every visited root edge, retained for unbiased search diagnostics. */
  readonly rootVisitDistribution?: readonly {
    readonly actionId: string
    readonly visits: number
    readonly meanValue: number
  }[]
  readonly chosenSequence?: readonly string[]
  readonly chosenSequenceDepth?: number
  /** Time spent scoring the current legal actions before sequence search. */
  readonly rootEvaluationMs?: number
  /** Full sequence-search duration, including any public-response scoring. */
  readonly sequenceSearchMs?: number
  /** Time spent inside public opponent-response evaluation; included above. */
  readonly responseSearchMs?: number
  readonly responseCandidateAnalysisMs?: number
  readonly responseCandidateDispatchMs?: number
  readonly responseCandidateObservationMs?: number
  readonly responseCandidateScoringMs?: number
  readonly responseActionGenerationMs?: number
  readonly responseReplayMs?: number
  readonly sequenceNodes?: number
  /** Public response branches evaluated after candidate turn endings. */
  readonly responseNodes?: number
  /** Sampled opponent card-play branches evaluated by Expert response search. */
  readonly responseCardPlayNodes?: number
  readonly responseScore?: number | null
  readonly sampleCount?: number
  readonly sampleWinRate?: number
  /** Count of root, sequence, and response branches processed in this decision. */
  readonly workUnits?: number
  /** True when the deterministic work cap was exhausted during this decision. */
  readonly workBudgetHit?: boolean
  readonly mctsProfile?: {
    readonly hypothesisSetupMs: number
    readonly analysisSnapshotRestoreMs: number
    readonly observationMs: number
    readonly informationKeyMs: number
    readonly legalActionGenerationMs: number
    readonly actionPriorMs: number
    readonly treeSelectionMs: number
    readonly rolloutSelectionMs: number
    readonly simulationDispatchMs: number
    readonly leafEvaluationMs: number
    readonly candidateCacheHits: number
    readonly candidateCacheMisses: number
    readonly opponentActionsSimulated: number
    readonly opponentCardPlaysSimulated: number
    readonly averageTreeDepth: number
    readonly averageRolloutDepth: number
    readonly maximumRolloutDepth: number
  }
}

export type LocalAiTraceListener = (trace: LocalAiDecisionTrace) => void

interface Simulation {
  readonly accepted: boolean
  readonly observation?: AiObservation
  readonly phase?: TurnMatchState['phase']
  readonly winnerId?: TurnMatchState['winnerId']
  readonly score?: number
  readonly sampleCount?: number
  readonly sampleWinRate?: number
}

interface ScoredAction {
  readonly action: LocalAction
  score: number
  readonly reason: string
  scoreComponents: LocalAiScoreComponents
  readonly simulation: Simulation
  readonly rootPreference?: number
  sequence?: readonly TurnMatchCommand[]
  sequenceLabels?: readonly string[]
  sequenceNodes?: number
  sequenceResponseScore?: number | null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stableSeed(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++)
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193)
  return hash >>> 0
}

function sampledContinuation(
  lines:
    | Map<
        string,
        { visits: number; valueSum: number; commands: readonly TurnMatchCommand[] }
      >
    | undefined
): readonly TurnMatchCommand[] | undefined {
  if (!lines) return undefined
  // Prefer the strongest recurring continuation; length only breaks value ties.
  return [...lines.values()]
    .filter((line) => line.commands.length > 1 && line.visits >= 2)
    .sort(
      (left, right) =>
        right.valueSum / right.visits - left.valueSum / left.visits ||
        left.commands.length - right.commands.length ||
        right.visits - left.visits ||
        JSON.stringify(left.commands.map(canonicalCommandKey)).localeCompare(
          JSON.stringify(right.commands.map(canonicalCommandKey))
        )
    )[0]?.commands
}

function stableObservation(value: unknown): string {
  return (
    JSON.stringify(value, (key, nested) => (key === 'revision' ? undefined : nested)) ??
    'undefined'
  )
}

function informationSetKey(observation: AiObservation): string {
  return stableObservation(observation)
}

function directCharacterDamage(value: unknown): number {
  if (Array.isArray(value))
    return value.reduce((total, entry) => total + directCharacterDamage(entry), 0)
  if (!value || typeof value !== 'object') return 0
  const entry = value as Record<string, unknown>
  const target = record(entry.target)
  const ownDamage =
    entry.action === 'damage' &&
    target.type === 'character' &&
    target.controller === 'any' &&
    typeof entry.amount === 'number'
      ? Math.max(0, entry.amount)
      : 0
  return (
    ownDamage +
    Object.entries(entry).reduce(
      (total, [key, nested]) =>
        key === 'target' || key === 'amount'
          ? total
          : total + directCharacterDamage(nested),
      0
    )
  )
}

function directSpellDamageForPlayer(
  effects: unknown,
  player: TurnMatchState['players'][number]
): number {
  const triggeredEffects = (Array.isArray(effects) ? effects : [effects])
    .map(record)
    .filter((effect) => effect.trigger === 'cast')
  let damage = 0
  const uncertainAlternatives = new Map<string, number>()
  for (const effect of triggeredEffects) {
    const effectDamage = directCharacterDamage(effect.actions)
    if (!effect.condition) {
      damage += effectDamage
      continue
    }
    const condition = record(effect.condition)
    const filter = record(condition.filter)
    const tribe = filter.tribe
    const hasMinion =
      typeof tribe === 'string' &&
      player.board.some((minion) =>
        cardHasTribe(CARD_CATALOG.get(minion.cardId), tribe)
      )
    if (condition.type === 'player-has-minion' && typeof tribe === 'string') {
      if (hasMinion) damage += effectDamage
      continue
    }
    if (condition.type === 'player-lacks-minion' && typeof tribe === 'string') {
      if (!hasMinion) damage += effectDamage
      continue
    }
    const trigger = String(effect.trigger)
    uncertainAlternatives.set(
      trigger,
      Math.max(uncertainAlternatives.get(trigger) ?? 0, effectDamage)
    )
  }
  return (
    damage + [...uncertainAlternatives.values()].reduce((sum, value) => sum + value, 0)
  )
}

function summonedMinionTribes(value: unknown): ReadonlySet<string> {
  const tribes = new Set<string>()
  const visit = (nested: unknown) => {
    if (Array.isArray(nested)) {
      nested.forEach(visit)
      return
    }
    if (!nested || typeof nested !== 'object') return
    const entry = record(nested)
    if (entry.action === 'summon' && typeof entry.cardId === 'string') {
      const definition = CARD_CATALOG.get(entry.cardId)
      if (definition) {
        if (definition.subtype) tribes.add(definition.subtype)
        for (const tribe of definition.tribes ?? []) tribes.add(tribe)
      }
    }
    Object.values(entry).forEach(visit)
  }
  visit(value)
  return tribes
}

function hasPlayerMinionTribeCondition(value: unknown, tribe: string): boolean {
  if (Array.isArray(value))
    return value.some((nested) => hasPlayerMinionTribeCondition(nested, tribe))
  if (!value || typeof value !== 'object') return false
  const entry = record(value)
  const condition = record(entry.condition)
  if (
    condition.type === 'player-has-minion' &&
    record(condition.filter).tribe === tribe
  )
    return true
  return Object.values(entry).some((nested) =>
    hasPlayerMinionTribeCondition(nested, tribe)
  )
}

function conditionalMinionPayoffPrior(
  effects: unknown,
  player: TurnMatchState['players'][number],
  playedCardInstanceId: string,
  playedCardCost: number
): number {
  const tribes = summonedMinionTribes(effects)
  if (!tribes.size) return 0
  const remainingMana = number(player.mana.available) - playedCardCost
  if (remainingMana < 0) return 0
  const enablesPayoff = player.hand.some((card) => {
    if (card.instanceId === playedCardInstanceId) return false
    const definition = CARD_CATALOG.get(card.cardId)
    return (
      definition !== undefined &&
      number(card.currentCost, definition.cost) <= remainingMana &&
      [...tribes].some((tribe) =>
        hasPlayerMinionTribeCondition(definition.effects, tribe)
      )
    )
  })
  return enablesPayoff ? 8 : 0
}

function deathrattleAreaDamage(effects: unknown): number {
  const findDamage = (value: unknown): number => {
    if (Array.isArray(value)) return Math.max(0, ...value.map(findDamage))
    if (!value || typeof value !== 'object') return 0
    const entry = record(value)
    const target = record(entry.target)
    const ownDamage =
      entry.action === 'damage' &&
      target.controller === 'any' &&
      target.type === 'minion' &&
      target.selection === 'all'
        ? number(entry.amount)
        : 0
    return Math.max(ownDamage, ...Object.values(entry).map(findDamage))
  }

  const triggers = (Array.isArray(effects) ? effects : [effects])
    .map(record)
    .filter((effect) => effect.trigger === 'deathrattle')
  return Math.max(0, ...triggers.map((effect) => findDamage(effect.actions)))
}

function deathrattleClearPrior(
  effects: unknown,
  opponent: TurnMatchState['players'][number],
  turnNumber: number
): number {
  const damage = deathrattleAreaDamage(effects)
  if (!damage) return 0
  const removableMinions = opponent.board.filter((minion) => {
    const keywords = effectiveBoardMinionKeywords(minion, turnNumber)
    return (
      number(minion.health) <= damage &&
      !keywords.includes('divine-shield') &&
      !keywords.includes('immune')
    )
  }).length
  return Math.min(12, removableMinions * 3)
}

function damageHeroPowerAmount(player: TurnMatchState['players'][number]): number {
  const effect = HERO_POWER_CATALOG.get(player.heroPower.id)?.effect
  return effect?.kind === 'damage-character' ||
    effect?.kind === 'damage-and-summon-on-kill'
    ? number(effect.amount)
    : 0
}

function deathrattleSetupPrior(
  effects: unknown,
  playedMinionHealth: number,
  player: TurnMatchState['players'][number],
  opponent: TurnMatchState['players'][number],
  playedCardCost: number,
  turnNumber: number
): number {
  const power = HERO_POWER_CATALOG.get(player.heroPower.id)
  const remainingMana = number(player.mana.available) - playedCardCost
  const heroPowerDamage = damageHeroPowerAmount(player)
  if (
    !power ||
    !player.heroPower.available ||
    heroPowerDamage <= 0 ||
    playedMinionHealth > heroPowerDamage ||
    remainingMana < number(player.heroPower.cost, power.cost)
  )
    return 0
  return deathrattleClearPrior(effects, opponent, turnNumber)
}

function containsEffectAction(value: unknown, action: string): boolean {
  if (Array.isArray(value))
    return value.some((entry) => containsEffectAction(entry, action))
  if (!value || typeof value !== 'object') return false
  const entry = record(value)
  return (
    entry.action === action ||
    Object.values(entry).some((nested) => containsEffectAction(nested, action))
  )
}

function cthunAttackThresholds(value: unknown): readonly number[] {
  if (Array.isArray(value))
    return value.flatMap((entry) => cthunAttackThresholds(entry))
  if (!value || typeof value !== 'object') return []
  const entry = record(value)
  const ownThreshold =
    entry.type === 'cthun-attack-at-least' && typeof entry.value === 'number'
      ? [entry.value]
      : []
  return [
    ...ownThreshold,
    ...Object.values(entry).flatMap((nested) => cthunAttackThresholds(nested))
  ]
}

function cthunBuffAmount(effects: unknown): number {
  if (Array.isArray(effects))
    return effects.reduce((total, entry) => total + cthunBuffAmount(entry), 0)
  if (!effects || typeof effects !== 'object') return 0
  const entry = record(effects)
  const ownBuff = entry.action === 'buff-cthun' ? number(entry.attack) : 0
  return (
    ownBuff +
    Object.values(entry).reduce<number>(
      (total, nested) => total + cthunBuffAmount(nested),
      0
    )
  )
}

/** Thresholds compare total ritual attack; linear body value remains bonus-only. */
function cthunThresholdAttack(attackBonus: number): number {
  const definition = CARD_CATALOG.get(CTHUN_ID)
  return (definition?.type === 'Minion' ? definition.attack : 0) + attackBonus
}

function cthunPayoffValue(
  hand: readonly { readonly cardId: string }[],
  attack: number
): number {
  if (attack <= 0) return 0
  return hand.reduce((total, card) => {
    const definition = CARD_CATALOG.get(card.cardId)
    if (!definition || !containsEffectAction(definition.effects, 'summon')) return total
    const thresholds = cthunAttackThresholds(definition.effects)
    return (
      total +
      thresholds.reduce(
        (value, threshold) =>
          value +
          Math.min(8, (attack / threshold) * 8) +
          (attack >= threshold ? 20 : 0),
        0
      )
    )
  }, 0)
}

function cthunBuffPrior(
  effects: unknown,
  player: TurnMatchState['players'][number]
): number {
  const attackBuff = cthunBuffAmount(effects)
  const attack = cthunThresholdAttack(number(player.cthun?.attack))
  if (!attackBuff) return 0
  const before = cthunPayoffValue(player.hand, attack)
  const after = cthunPayoffValue(player.hand, attack + attackBuff)
  return Math.min(16, Math.max(0, after - before))
}

function hasMinionHealDrawTrigger(effects: unknown): boolean {
  if (!Array.isArray(effects)) return false
  return effects.some((effect) => {
    const definition = record(effect)
    const event = record(definition.event)
    const target = record(event.target)
    return (
      event.type === 'health-restored' &&
      target.type === 'minion' &&
      containsEffectAction(definition.actions, 'draw')
    )
  })
}

function healingPowerAmount(player: TurnMatchState['players'][number]): number {
  const effect = HERO_POWER_CATALOG.get(player.heroPower.id)?.effect
  if (
    effect?.kind === 'restore-character' ||
    effect?.kind === 'restore-and-buff-minion'
  )
    return effect.amount
  return 0
}

function hasDamagedFriendlyMinion(player: TurnMatchState['players'][number]): boolean {
  return player.board.some(
    (minion) => number(minion.health) < number(minion.maxHealth, minion.health)
  )
}

function healingSynergyPrior(
  player: TurnMatchState['players'][number],
  effects: unknown,
  cardCost: number
): number {
  const healAmount = healingPowerAmount(player)
  const power = HERO_POWER_CATALOG.get(player.heroPower.id)
  const availableAfterPlay = number(player.mana.available) - cardCost
  if (
    !hasMinionHealDrawTrigger(effects) ||
    !player.heroPower.available ||
    !healAmount ||
    !power ||
    availableAfterPlay < number(player.heroPower.cost, power.cost) ||
    !hasDamagedFriendlyMinion(player)
  )
    return 0
  return 8
}

function returnedMinionCostReduction(value: unknown): number {
  if (Array.isArray(value))
    return Math.max(0, ...value.map(returnedMinionCostReduction))
  if (value === null || typeof value !== 'object') return 0
  const entry = record(value)
  const ownReduction =
    entry.action === 'change-cost' && number(entry.amount) < 0
      ? -number(entry.amount)
      : 0
  return Math.max(
    ownReduction,
    ...Object.values(entry).map(returnedMinionCostReduction)
  )
}

function heroPowerBlocksDiscountedChargeReplay(
  player: TurnMatchState['players'][number],
  turnNumber: number,
  heroPowerCost: number
): boolean {
  const availableMana = number(player.mana.available)
  if (heroPowerCost <= 0 || availableMana < heroPowerCost) return false
  return player.hand.some((card) => {
    const definition = CARD_CATALOG.get(card.cardId)
    if (!definition || !containsEffectAction(definition.effects, 'return-to-hand'))
      return false
    const costReduction = returnedMinionCostReduction(definition.effects)
    if (costReduction <= 0) return false
    return player.board.some((minion) => {
      const minionDefinition = CARD_CATALOG.get(minion.cardId)
      if (
        minionDefinition?.type !== 'Minion' ||
        !effectiveBoardMinionKeywords(minion, turnNumber).includes('charge') ||
        boardMinionAttacksUsed(minion, turnNumber) === 0
      )
        return false
      const replayCost = Math.max(0, minionDefinition.cost - costReduction)
      return replayCost <= availableMana && replayCost > availableMana - heroPowerCost
    })
  })
}

function playerValue(
  player: AiObservedPlayer,
  turnNumber: number,
  knownOriginalDeck: AiObservation['selfOriginalDeck']['cards']
): number {
  const hero = record(player.hero)
  const armor = number(hero.armor)
  const health = number(hero.health)
  const heroHealthValue =
    Math.min(15, health) * LOCAL_AI_POLICY.weights.heroHealth +
    Math.max(0, health - 15) * 2
  const board = player.board.reduce((total, minion) => {
    const entry = record(minion)
    const keywords = effectiveBoardMinionKeywords(minion, turnNumber)
    const keywordValue = keywords.length * LOCAL_AI_POLICY.weights.boardKeyword
    const attack = number(entry.attack)
    const minionHealth = number(entry.health)
    const summonedOnTurn = number(entry.summonedOnTurn, -1)
    const controllerChangedOnTurn = number(entry.controllerChangedOnTurn, -1)
    const frozenUntilTurn = number(entry.frozenUntilTurn, -1)
    const attacksUsed = number(entry.attacksUsedThisTurn)
    const maxAttacks = Math.max(1, number(entry.maxAttacksPerTurn, 1))
    const ready =
      attack > 0 &&
      summonedOnTurn < turnNumber &&
      controllerChangedOnTurn < turnNumber &&
      frozenUntilTurn < turnNumber &&
      attacksUsed < maxAttacks
    const readiness = ready ? 1.2 : 0.35
    return (
      total +
      attack * LOCAL_AI_POLICY.weights.boardAttack * readiness +
      minionHealth * LOCAL_AI_POLICY.weights.boardHealth +
      keywordValue
    )
  }, 0)
  const hand = player.hand.reduce((total, card) => {
    const definition = CARD_CATALOG.get(card.cardId)
    if (!definition) return total
    const body =
      definition.type === 'Minion'
        ? definition.attack * 1.4 + definition.health * 1.1
        : definition.type === 'Weapon'
          ? definition.attack * 1.25 + definition.durability
          : definition.type === 'Hero'
            ? 6
            : 4
    const effect = definition.effects.length * 2
    return total + (body + effect + Math.max(0, 6 - definition.cost)) * 0.22
  }, 0)
  // Opponent card identities remain hidden, but the public hand size is still
  // meaningful card advantage. Never inspect the concealed card IDs here.
  const hiddenHand = Math.max(0, player.handSize - player.hand.length)
  const mana = number(record(player.mana).available)
  const weapon = record(player.weapon)
  const weaponValue = player.weapon
    ? number(weapon.attack) * LOCAL_AI_POLICY.weights.weaponAttack +
      number(weapon.durability) * LOCAL_AI_POLICY.weights.weaponDurability
    : 0
  const secretValue = player.secrets.length * LOCAL_AI_POLICY.weights.secret
  const effects = record(player.effects)
  const cthun = record(effects.cthun)
  const cthunAttack = number(cthun.attack)
  const cthunBodyAvailable =
    !cthunAttack ||
    player.role !== 'self' ||
    hasKnownCthunPayoff([...player.hand, ...player.board, ...knownOriginalDeck], false)
  const cthunBodyProgress =
    effects.cthunDied === true || !cthunAttack || !cthunBodyAvailable
      ? 0
      : cthunAttack * 3 + number(cthun.health) * 2
  // A held conditional payoff still uses ritual totals after C'Thun has died.
  const cthunProgress =
    cthunBodyProgress + cthunPayoffValue(player.hand, cthunThresholdAttack(cthunAttack))
  const overloadLocked = number(record(player.mana).overloadLocked)
  const handOverflow = Math.max(0, player.handSize - 8)
  return (
    heroHealthValue +
    armor * LOCAL_AI_POLICY.weights.heroArmor +
    board +
    cthunProgress +
    hand * LOCAL_AI_POLICY.weights.handCard +
    hiddenHand * LOCAL_AI_POLICY.weights.handCard * 0.6 +
    mana * LOCAL_AI_POLICY.weights.manaAvailable +
    weaponValue +
    secretValue +
    Math.min(player.deckSize, 10) * LOCAL_AI_POLICY.weights.deckCard -
    player.fatigueDamage * LOCAL_AI_POLICY.weights.fatigueRisk +
    handOverflow * LOCAL_AI_POLICY.weights.handOverflow +
    number(effects.overload) * LOCAL_AI_POLICY.weights.overloadLocked +
    overloadLocked * LOCAL_AI_POLICY.weights.overloadLocked
  )
}

/** Public recurring benefits omitted by the ordinary attack/health body score. */
function expertEngineValue(player: AiObservedPlayer, turn: number): number {
  return player.board.reduce((sum, minion) => {
    const keywords = effectiveBoardMinionKeywords(minion, turn)
    const healing = keywords.includes('lifesteal')
      ? Math.min(
          number(minion.attack),
          Math.max(0, number(player.hero.maxHealth) - number(player.hero.health))
        ) * LOCAL_AI_POLICY.weights.heroHealth
      : 0
    const recurring =
      CARD_CATALOG.get(minion.cardId)
        ?.effects.filter((effect) =>
          ['start-of-turn', 'end-of-turn'].includes(effect.trigger)
        )
        .flatMap((effect) => effect.actions ?? [])
        .reduce((value, action) => {
          const entry = record(action)
          if (
            entry.action === 'change-cost' &&
            number(entry.amount) < 0 &&
            record(entry.target).zone === 'hand' &&
            record(entry.target).controller === 'self'
          )
            return (
              value +
              Math.min(player.handSize, 10) * Math.min(2, -number(entry.amount)) * 2
            )
          if (entry.action === 'draw') return value + LOCAL_AI_POLICY.weights.handCard
          return value
        }, 0) ?? 0
    const triggerSupport =
      CARD_CATALOG.get(minion.cardId)
        ?.effects.filter((effect) => effect.trigger === 'aura')
        .flatMap((effect) => effect.actions ?? [])
        .reduce((value, action) => {
          const entry = record(action)
          if (entry.action !== 'multiply-trigger' || entry.trigger !== 'battlecry')
            return value
          // Public hand size bounds the opportunity; never inspect hidden card IDs.
          return (
            value +
            Math.min(3, player.handSize) *
              Math.max(0, number(entry.multiplier, 1) - 1) *
              4
          )
        }, 0) ?? 0
    return sum + healing + (minion.silenced ? 0 : recurring + triggerSupport)
  }, 0)
}

function stateScore(observation: AiObservation, selfId: string): number {
  const self = observation.players.find((player) => player.participantId === selfId)
  const opponent = observation.players.find((player) => player.participantId !== selfId)
  if (!self || !opponent) return -Infinity
  const selfHero = record(self.hero)
  const opponentHero = record(opponent.hero)
  const selfHealth = number(selfHero.health) + number(selfHero.armor) * 0.7
  const opponentHealth = number(opponentHero.health) + number(opponentHero.armor) * 0.7
  // Hero health is already part of playerValue. Keep only a small face-pressure
  // term for Expert so the same damage is not counted twice against trading.
  const pressure = (30 - opponentHealth) * LOCAL_AI_POLICY.weights.faceDamage * 0.1
  const danger = Math.max(0, 12 - selfHealth) * LOCAL_AI_POLICY.weights.heroHealth
  const boardPresence =
    (Math.min(3, self.board.length) - Math.min(3, opponent.board.length)) *
    LOCAL_AI_POLICY.weights.expertBoardPresence
  return (
    playerValue(self, observation.turnNumber, observation.selfOriginalDeck.cards) -
    playerValue(opponent, observation.turnNumber, observation.selfOriginalDeck.cards) +
    boardPresence +
    (expertEngineValue(self, observation.turnNumber) -
      expertEngineValue(opponent, observation.turnNumber)) +
    pressure -
    danger
  )
}

function containsAdjacentMechanic(value: unknown): boolean {
  if (typeof value === 'string') return value.toLowerCase().includes('adjacent')
  if (Array.isArray(value)) return value.some(containsAdjacentMechanic)
  if (value && typeof value === 'object')
    return Object.values(value).some(containsAdjacentMechanic)
  return false
}

const cardScoreCache = new Map<string, number>()

function cardScore(cardId: string): number {
  const cached = cardScoreCache.get(cardId)
  if (cached !== undefined) return cached
  const definition = CARD_CATALOG.get(cardId)
  if (!definition) return 0
  const body =
    definition.type === 'Minion'
      ? definition.attack * 1.5 + definition.health * 1.2
      : definition.type === 'Weapon'
        ? definition.attack * 1.4 + definition.durability
        : definition.type === 'Hero'
          ? 12
          : 5
  const mechanics =
    `${definition.rulesText} ${JSON.stringify(definition.effects)}`.toLowerCase()
  const utility =
    (mechanics.includes('discover') ? 10 : 0) +
    (mechanics.includes('draw') ? 5 : 0) +
    (mechanics.includes('destroy') || mechanics.includes('remove') ? 10 : 0) +
    (mechanics.includes('damage') ? 4 : 0) +
    (mechanics.includes('restore') || mechanics.includes('heal') ? 4 : 0) +
    (mechanics.includes('summon') ? 4 : 0) +
    (mechanics.includes('choose one') ? 3 : 0)
  const score = body + definition.effects.length * 3 + utility - definition.cost * 0.7
  cardScoreCache.set(cardId, score)
  return score
}

function mulliganReplace(self: AiObservedPlayer): readonly string[] {
  const hand = self.hand
  const ordered = hand.map((card) => {
    const definition = CARD_CATALOG.get(card.cardId)
    const cost = card.currentCost ?? definition?.cost ?? 99
    const body =
      definition?.type === 'Minion' ? definition.attack + definition.health : 0
    const keep =
      cost <= 2
        ? 100 + body
        : cost === 3
          ? 60 + body
          : cost === 4
            ? 12 + body * 0.4
            : -cost * 7 + body * 0.2
    return { ref: card.instanceId, cost, keep }
  })
  const low = ordered.filter((entry) => entry.cost <= 2).length
  const keepCount =
    low === ordered.length ? ordered.length : low > 0 ? Math.min(3, low + 1) : 1
  const keep = new Set(
    [...ordered]
      .sort((left, right) => right.keep - left.keep)
      .filter((entry) => entry.keep > 0)
      .slice(0, keepCount)
      .map((entry) => entry.ref)
  )
  return ordered.filter((entry) => !keep.has(entry.ref)).map((entry) => entry.ref)
}

function yieldToRenderer(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Shared fair-state search used by local world workers and headless tests.
 * Both difficulties use the Expert policy with different time allowances.
 */
export class LocalAiDecisionApi implements AiDecisionApi {
  private readonly cancelled = new Set<string>()
  private lastTrace: LocalAiDecisionTrace | null = null
  private readonly limits = SEARCH_LIMITS
  private readonly budgetMs: number
  private readonly workBudget?: number
  private workUnits = 0
  private workBudgetHit = false
  private readonly preferredContinuation?: AiActionIntent
  private readonly onSearchProgress?: (progress: LocalAiSearchProgress) => void
  private readonly publicThreat?: ReturnType<typeof inspectExpertPublicThreat>
  private readonly fairHypothesis: boolean
  private readonly expertPlanSearchLimitMs: number
  private readonly expertReplanSearchLimitMs: number
  private readonly deckEvaluator: ExpertDeckEvaluator | null

  constructor(
    private readonly session: GameBoardSession,
    private readonly onTrace?: LocalAiTraceListener,
    options: LocalAiDecisionOptions = {}
  ) {
    const resources = LOCAL_AI_RESOURCE_PROFILES[options.profile ?? 'easy']
    this.deckEvaluator =
      options.deckStrategy?.participantId === session.remoteParticipantId
        ? ExpertDeckEvaluator.create(options.deckStrategy)
        : null
    this.budgetMs = options.budgetMs ?? Number.POSITIVE_INFINITY
    if (
      options.workBudget !== undefined &&
      (!Number.isSafeInteger(options.workBudget) || options.workBudget < 1)
    )
      throw new RangeError('Local AI workBudget must be a positive safe integer.')
    this.workBudget = options.workBudget
    this.preferredContinuation = options.preferredContinuation
    this.onSearchProgress = options.onSearchProgress
    this.publicThreat = options.publicThreat
    this.fairHypothesis = options.fairHypothesis ?? false
    this.expertPlanSearchLimitMs =
      options.expertPlanSearchLimitMs ?? resources.planSearchLimitMs
    this.expertReplanSearchLimitMs =
      options.expertReplanSearchLimitMs ?? resources.replanSearchLimitMs
  }

  /** Returns the last completed search for development diagnostics and scenario tests. */
  getLastTrace(): LocalAiDecisionTrace | null {
    return this.lastTrace
  }

  async settings(): Promise<AiSettings> {
    return {
      enabled: true,
      provider: 'none',
      modelId: EXPERT_MODEL_ID,
      reasoningEffort: 'none',
      maxCompletionTokens: 1,
      maxContextBytes: 200_000
    }
  }

  async decide(request: AiDecisionRequest): Promise<AiDecisionResponse> {
    const started = performance.now()
    await yieldToRenderer()
    if (this.cancelled.delete(request.requestId))
      throw new Error('AI request cancelled.')

    if (request.phase === 'mulligan') {
      const observation = this.session.getAiObservation()
      const self = observation.players.find((player) => player.role === 'self')
      if (!self) throw new Error('Local AI cannot find its fair player observation.')
      const replace = mulliganReplace(self)
      this.publishTrace({
        requestId: request.requestId,
        phase: 'mulligan',
        durationMs: performance.now() - started,
        evaluatedActions: self.hand.length,
        refinedActions: 0,
        continuations: 0,
        timedOut: false,
        baseScore: null,
        visibleThreat: null,
        chosenActionId: null,
        candidates: []
      })
      return this.response(
        request,
        {
          replace,
          planUpdate: null
        },
        'Keep the best early curve and replace slow opening cards.',
        started,
        this.lastTrace
      )
    }

    const legal = enumerateLegalCommands(
      {
        getState: () => this.session.getState(),
        getPlayInput: this.session.match.getPlayInput!,
        getLegality: this.session.match.getLegality!
      },
      this.session.remoteParticipantId
    )
    if (!legal.length) throw new Error('Local AI has no legal command.')
    const actions = aiActions(this.session, legal)
    const search = await this.chooseExpertMctsAction(
      actions,
      request.requestId,
      request.phase === 'plan' ? 'plan' : 'action'
    )
    if (!search) throw new Error('Local AI could not score a legal command.')
    const { best } = search

    if (request.phase === 'plan') {
      return this.response(
        request,
        {
          plan: {
            objective: best.reason,
            winCheck:
              'Take an immediate win when the engine proves one; otherwise improve the position.',
            lossRisk:
              'Recheck visible damage and preserve enough health for the opponent turn.',
            candidates: [
              {
                sequence: (best.sequenceLabels ?? [best.action.description]).map(
                  (label) => label.slice(0, 580)
                ),
                budget:
                  'Replan after each public result; preserve this sequence only while its prerequisites remain legal.',
                endPosition: 'Keep the resulting board and hand advantage.',
                opponentReply:
                  'Compare the opponent’s visible attacks and public board before ending the turn.'
              }
            ],
            preferred: 0,
            firstActionId: best.action.id,
            checks: []
          }
        },
        best.reason,
        started,
        this.lastTrace
      )
    }

    const choice = {
      actionId: best.action.id,
      intent: aiActionIntent(best.action.command, this.session.localParticipantId),
      expectedResult: best.reason,
      planUpdate: null
    } satisfies AiDecisionChoice
    return this.response(request, choice, best.reason, started, this.lastTrace)
  }

  async cancel(identity: AiDecisionIdentity): Promise<void> {
    this.cancelled.add(identity.requestId)
  }

  private hasWorkRemaining(): boolean {
    if (this.workBudget === undefined || this.workUnits < this.workBudget) return true
    this.workBudgetHit = true
    return false
  }

  private tryUseWorkUnit(): boolean {
    if (!this.hasWorkRemaining()) {
      if (this.workBudget !== undefined) this.workBudgetHit = true
      return false
    }
    this.workUnits++
    return true
  }

  private async chooseExpertMctsAction(
    actions: readonly LocalAction[],
    requestId: string,
    phase: 'plan' | 'action'
  ): Promise<{ best: ScoredAction; trace: LocalAiDecisionTrace } | null> {
    this.workUnits = 0
    this.workBudgetHit = false
    const started = performance.now()
    const thinkLimitMs =
      phase === 'plan' ? this.expertPlanSearchLimitMs : this.expertReplanSearchLimitMs
    const deadline =
      this.workBudget === undefined
        ? started + Math.min(this.budgetMs, this.limits.maxThinkMs, thinkLimitMs)
        : Number.POSITIVE_INFINITY
    const rootId = this.session.remoteParticipantId
    const mctsProfile = {
      hypothesisSetupMs: 0,
      analysisSnapshotRestoreMs: 0,
      observationMs: 0,
      informationKeyMs: 0,
      legalActionGenerationMs: 0,
      actionPriorMs: 0,
      treeSelectionMs: 0,
      rolloutSelectionMs: 0,
      simulationDispatchMs: 0,
      leafEvaluationMs: 0,
      candidateCacheHits: 0,
      candidateCacheMisses: 0,
      opponentActionsSimulated: 0,
      opponentCardPlaysSimulated: 0,
      averageTreeDepth: 0,
      averageRolloutDepth: 0,
      maximumRolloutDepth: 0
    }
    const hypothesisSetupStarted = performance.now()
    const simulationSession = this.fairHypothesis
      ? this.session
      : (() => {
          const checkpoint = createFairHypothesisCheckpoint(
            this.session.match.getCheckpoint(),
            rootId,
            stableSeed(requestId)
          )
          return new GameBoardSession({
            setup: checkpoint.setup,
            decks: checkpoint.decks,
            opponentStrategy: this.session.opponentStrategy,
            checkpoint
          })
        })()
    mctsProfile.hypothesisSetupMs = performance.now() - hypothesisSetupStarted
    const tacticalDeadline = Math.min(
      started + (deadline - started) * 0.2,
      performance.now() + 2_000
    )
    const tactical = simulationSession.match.analyze((fork) =>
      searchTactics(fork, rootId, {
        commands: actions.map((action) => action.command),
        maxNodes:
          this.workBudget === undefined ? 2_000 : Math.min(256, this.workBudget),
        shouldStop: () =>
          this.workBudget === undefined && performance.now() >= tacticalDeadline,
        prior: (command, state) => this.commandPrior(command, state, rootId),
        evaluate: (child) => {
          const observation = child.getAiObservation?.(rootId, 'fair')
          return observation
            ? this.scoreObservation(observation, child.getState().winnerId)
            : 0
        }
      })
    )
    if (tactical.win) {
      const line = tactical.win
      const action = actions.find(
        (entry) =>
          canonicalCommandKey(entry.command) === canonicalCommandKey(line.commands[0]!)
      )!
      const scoreComponents: LocalAiScoreComponents = {
        positionDelta: 1,
        commandPreference: 0,
        continuationPreference: 0,
        threatDefense: 0,
        opponentBoardRemoval: 0,
        friendlyBoardLoss: 0,
        sequenceRefinement: 0
      }
      const sequenceLabels = line.commands.map((command) => JSON.stringify(command))
      const best: ScoredAction = {
        action,
        score: 1,
        reason: 'Verified winning sequence.',
        simulation: { accepted: true, winnerId: rootId },
        sequence: line.commands,
        sequenceLabels,
        scoreComponents
      }
      const trace: LocalAiDecisionTrace = {
        requestId,
        phase,
        durationMs: performance.now() - started,
        evaluatedActions: tactical.nodes,
        refinedActions: 0,
        continuations: 0,
        timedOut: false,
        baseScore: null,
        visibleThreat: null,
        chosenActionId: action.id,
        chosenSequence: sequenceLabels,
        decisionPriority: 'verified-win',
        tacticalNodes: tactical.nodes,
        tacticalExhausted: tactical.exhausted,
        candidates: [
          {
            actionId: action.id,
            type: action.command.type,
            description: best.reason,
            score: 1,
            recommendationValue: 1,
            outcome: 'win',
            provenWin: true,
            scoreComponents,
            accepted: true,
            phase: 'ended',
            winnerId: rootId,
            sequenceIntents: line.commands.map((command) =>
              aiActionIntent(command, this.session.localParticipantId)
            )
          }
        ]
      }
      this.publishTrace(trace)
      return { best, trace }
    }
    // Establish the threat before rollout resource allocation. A defense is a
    // search seed, not a verdict about an unfinished continuation.
    const publicThreat =
      (this.publicThreat?.rootRevision === simulationSession.getState().revision &&
      this.publicThreat.actorId === rootId
        ? this.publicThreat
        : undefined) ??
      inspectExpertPublicThreat(
        simulationSession.match.getCheckpoint(),
        rootId,
        actions.map((action) => action.command),
        () => performance.now() >= deadline
      )
    const rootSequencePreferences = simulationSession.match.analyze((fork) => {
      const preferences = new Map<string, number>()
      for (const action of actions) {
        if (performance.now() >= deadline) break
        preferences.set(
          canonicalCommandKey(action.command),
          expertDrawPreference(fork, rootId, action.command) +
            expertAttackSetupPreference(
              fork,
              rootId,
              action.command,
              () => this.workBudget === undefined && performance.now() >= deadline
            ) +
            expertResourceSetupPreference(
              fork,
              rootId,
              action.command,
              () => this.workBudget === undefined && performance.now() >= deadline
            )
        )
      }
      return preferences
    })
    // Compare actual sequence outcomes, then guide initial rollouts through the best
    // sequence for each root action. These are real samples, never invented visits.
    const seedByRoot = new Map<string, (typeof tactical.lines)[number]>()
    for (const line of tactical.lines) {
      if (!line.proven || line.commands.length < 2) continue
      const key = canonicalCommandKey(line.commands[0]!)
      const previous = seedByRoot.get(key)
      if (
        !previous ||
        line.value > previous.value ||
        (line.value === previous.value &&
          line.commands.length < previous.commands.length)
      )
        seedByRoot.set(key, line)
    }
    const tacticalSeedLines = [...seedByRoot.values()]
      .sort((a, b) => b.value - a.value)
      .slice(0, 24)
    // Sample useful information and resource setups omitted by the tactical line.
    // Seed only the setup; subsequent choices use its actual resolved state.
    const informationAndSetupSeeds = actions
      .filter(
        (action) =>
          (rootSequencePreferences.get(canonicalCommandKey(action.command)) ?? 0) > 0
      )
      .sort(
        (a, b) =>
          rootSequencePreferences.get(canonicalCommandKey(b.command))! -
          rootSequencePreferences.get(canonicalCommandKey(a.command))!
      )
      .slice(0, 8)
      .map((action) => ({ commands: [action.command] }))
    const cleanupSeedLines = simulationSession.match.analyze((fork) =>
      expertSingletonCleanupSeeds(
        fork,
        rootId,
        tactical.lines,
        () => this.workBudget === undefined && performance.now() >= deadline
      )
    )
    const seedLines = [
      ...publicThreat.defenses,
      ...informationAndSetupSeeds,
      ...cleanupSeedLines,
      ...tacticalSeedLines
    ]
    const searchDeadline =
      this.workBudget === undefined
        ? Math.max(
            performance.now() + 1,
            deadline - Math.min(1_500, (deadline - started) * 0.15)
          )
        : deadline
    const tree = new InformationSetMcts<TurnMatchCommand>()
    const rootChoices = new Map(
      actions.map((action) => [canonicalCommandKey(action.command), action])
    )
    const candidateCache = new Map<string, readonly MctsCandidate<TurnMatchCommand>[]>()
    const rootCandidatePriors = new Map<string, number>()
    const rootCandidateRiskAdjustments = new Map<string, number>()
    const rootCandidatePreferenceAdjustments = new Map<string, number>()
    const rootCandidateTacticalPenalties = new Map<string, number>()
    let boundaryEvaluations = 0
    const inspectOrder = createExpertAttackOrderInspector(
      simulationSession.match.getCheckpoint(),
      rootId,
      () => this.workBudget === undefined && performance.now() >= searchDeadline
    )
    const rootActionOutcomes = simulationSession.match.analyze((fork) => {
      const outcomes = new Map<string, ExpertActionOutcome>()
      for (const action of actions) {
        if (this.workBudget === undefined && performance.now() >= searchDeadline) break
        const outcome = inspectExpertAction(
          fork,
          rootId,
          action.command,
          () => this.workBudget === undefined && performance.now() >= searchDeadline
        )
        outcomes.set(
          canonicalCommandKey(action.command),
          outcome.penalty < 0.25 && inspectOrder(action.command)
            ? { penalty: 0.25, reason: 'attack-before-setup' }
            : outcome
        )
      }
      return outcomes
    })
    const strategySamples = new Map<string, { total: number; samples: number }>()
    const rootKeyStarted = performance.now()
    const rootInformationKey = informationSetKey(simulationSession.getAiObservation())
    mctsProfile.informationKeyMs += performance.now() - rootKeyStarted
    const pathLimit = 48
    const iterationLimit = 12_000
    let iterations = 0
    let totalDepth = 0
    let totalTreeDepth = 0
    let totalRolloutDepth = 0
    let maximumRolloutDepth = 0
    let cancelled = false
    const sampledTurnLines = new Map<
      string,
      Map<
        string,
        { visits: number; valueSum: number; commands: readonly TurnMatchCommand[] }
      >
    >()

    while (
      iterations < iterationLimit &&
      (iterations === 0 || performance.now() < searchDeadline) &&
      this.tryUseWorkUnit()
    ) {
      if (iterations > 0 && iterations % 8 === 0) {
        await yieldToRenderer()
        if (this.cancelled.has(requestId)) {
          cancelled = true
          break
        }
      }

      const iterationSeed = stableSeed(`${requestId}:${iterations}`)
      const seedLine = seedLines[Math.floor(iterations / 2)]?.commands
      const selectedPath: MctsSelection<TurnMatchCommand>[] = []
      const searchedTurnLine: TurnMatchCommand[] = []
      let firstRootActionKey: string | null = null
      let rootTurnPassed = false
      let depth = 0
      let treeDepth = 0
      let rolloutDepth = 0
      let ownTurnEnds = 0
      let reward = 0
      let deckStrategyAdjustment = 0
      const analysisStarted = performance.now()
      let callbackElapsedMs = 0
      simulationSession.match.analyzeWithSeed(iterationSeed, (fork) => {
        const callbackStarted = performance.now()
        const rolloutRng = createSeededRng(iterationSeed ^ 0xa511e9b3)
        let expanded = false
        while (depth < pathLimit) {
          if (
            this.workBudget === undefined &&
            performance.now() >= searchDeadline &&
            depth > 0
          )
            break
          const state = fork.getState()
          if (state.phase === 'ended') {
            reward = this.terminalMctsValue(state.winnerId, rootId, depth)
            break
          }
          const actorId =
            state.pendingDiscover?.participantId ??
            state.pendingCardChoice?.participantId ??
            state.activePlayerId
          if (!actorId) break
          const observationStarted = performance.now()
          const observation = fork.getAiObservation?.(actorId, 'fair')
          mctsProfile.observationMs += performance.now() - observationStarted
          if (!observation) break
          const informationKeyStarted = performance.now()
          const nodeKey = informationSetKey(observation)
          mctsProfile.informationKeyMs += performance.now() - informationKeyStarted
          let candidates = candidateCache.get(nodeKey)
          if (!candidates) {
            const actionGenerationStarted = performance.now()
            const commands = enumerateLegalCommands(fork, actorId)
            mctsProfile.legalActionGenerationMs +=
              performance.now() - actionGenerationStarted
            if (!commands.length) break
            const priorState = fork.getState()
            const priorStarted = performance.now()
            candidates = commands.map((command) => ({
              key: canonicalCommandKey(command),
              action: command,
              prior:
                this.commandPrior(command, priorState, actorId) +
                (nodeKey === rootInformationKey
                  ? (rootSequencePreferences.get(canonicalCommandKey(command)) ?? 0) *
                    50
                  : 0)
            }))
            if (nodeKey === rootInformationKey)
              for (const candidate of candidates) {
                rootCandidatePriors.set(candidate.key, candidate.prior)
                rootCandidateRiskAdjustments.set(
                  candidate.key,
                  this.unrevealedSecretRisk(candidate.action, priorState, actorId)
                )
                rootCandidatePreferenceAdjustments.set(
                  candidate.key,
                  -this.continuationPreference(candidate.action) * 0.1 -
                    (rootSequencePreferences.get(candidate.key) ?? 0)
                )
                const unpaidDamagePenalty =
                  (rootActionOutcomes.get(candidate.key)?.penalty ?? 0) +
                  unpaidActionPenalty(candidate.action, priorState, actorId)
                if (unpaidDamagePenalty > 0)
                  rootCandidateTacticalPenalties.set(candidate.key, unpaidDamagePenalty)
              }
            mctsProfile.actionPriorMs += performance.now() - priorStarted
            mctsProfile.candidateCacheMisses++
            if (candidateCache.size < MCTS_MAX_CACHED_INFORMATION_SETS)
              candidateCache.set(nodeKey, candidates)
          } else mctsProfile.candidateCacheHits++

          const seededCommand =
            actorId === rootId && !rootTurnPassed ? seedLine?.[depth] : undefined
          const seededCandidate = seededCommand
            ? candidates.find(
                (candidate) => candidate.key === canonicalCommandKey(seededCommand)
              )
            : undefined
          if (expanded && !seededCandidate) {
            const rolloutStarted = performance.now()
            const command = this.rolloutCommand(candidates, rolloutRng)
            mctsProfile.rolloutSelectionMs += performance.now() - rolloutStarted
            const dispatchStarted = performance.now()
            const result = fork.dispatch(command)
            mctsProfile.simulationDispatchMs += performance.now() - dispatchStarted
            if (!result.accepted) break
            if (actorId === rootId && !rootTurnPassed) {
              searchedTurnLine.push(command)
              if (command.type === 'end-turn') rootTurnPassed = true
            }
            if (actorId !== rootId) {
              mctsProfile.opponentActionsSimulated++
              if (command.type === 'play-card') mctsProfile.opponentCardPlaysSimulated++
            }
            depth++
            rolloutDepth++
            if (actorId === rootId && command.type === 'end-turn') ownTurnEnds++
            else if (
              actorId !== rootId &&
              command.type === 'end-turn' &&
              ownTurnEnds > 0
            ) {
              const responseState = fork.getState()
              if (
                responseState.phase === 'ended' ||
                responseState.activePlayerId === rootId
              )
                break
            }
            continue
          }

          const selectionStarted = performance.now()
          const selection = tree.select(
            nodeKey,
            seededCandidate ? [seededCandidate] : candidates,
            actorId === rootId,
            nodeKey === rootInformationKey ? this.limits.rootSearchLimit : 1
          )
          mctsProfile.treeSelectionMs += performance.now() - selectionStarted
          if (!selection) break
          selectedPath.push(selection)
          if (actorId === rootId && !rootTurnPassed) {
            if (firstRootActionKey === null)
              firstRootActionKey = selection.candidate.key
            if (selection.candidate.action.type === 'end-turn') {
              searchedTurnLine.push(selection.candidate.action)
              rootTurnPassed = true
            } else searchedTurnLine.push(selection.candidate.action)
          }
          const dispatchStarted = performance.now()
          const result = fork.dispatch(selection.candidate.action)
          mctsProfile.simulationDispatchMs += performance.now() - dispatchStarted
          if (!result.accepted) break
          if (actorId !== rootId) {
            mctsProfile.opponentActionsSimulated++
            if (selection.candidate.action.type === 'play-card')
              mctsProfile.opponentCardPlaysSimulated++
          }
          depth++
          treeDepth++
          if (actorId === rootId && selection.candidate.action.type === 'end-turn')
            ownTurnEnds++
          else if (
            actorId !== rootId &&
            selection.candidate.action.type === 'end-turn' &&
            ownTurnEnds > 0
          ) {
            const responseState = fork.getState()
            if (
              responseState.phase === 'ended' ||
              responseState.activePlayerId === rootId
            )
              break
          }
          expanded = selection.expanded
        }

        const state = fork.getState()
        if (state.phase === 'ended')
          reward = this.terminalMctsValue(state.winnerId, rootId, depth)
        else {
          const leafEvaluationStarted = performance.now()
          const leafObservationStarted = performance.now()
          const leafObservation = fork.getAiObservation?.(rootId, 'fair')
          mctsProfile.observationMs += performance.now() - leafObservationStarted
          if (leafObservation && this.deckEvaluator)
            deckStrategyAdjustment = this.deckEvaluator.evaluate(
              leafObservation,
              state.players.find((player) => player.participantId === rootId)?.deck ??
                []
            ).adjustment
          reward = evaluateExpertBoundary(fork, (boundary) => {
            if (boundary !== fork) boundaryEvaluations++
            const resolved = boundary.getState()
            if (resolved.phase === 'ended')
              return this.terminalMctsValue(resolved.winnerId, rootId, depth)
            const observation =
              boundary === fork
                ? leafObservation
                : boundary.getAiObservation?.(rootId, 'fair')
            const adjustment =
              observation && this.deckEvaluator
                ? this.deckEvaluator.evaluate(
                    observation,
                    resolved.players.find((p) => p.participantId === rootId)?.deck ?? []
                  ).adjustment
                : deckStrategyAdjustment
            return observation
              ? MCTS_POSITION_VALUE_LIMIT *
                  Math.tanh(
                    (this.scoreObservation(observation, resolved.winnerId) +
                      adjustment) /
                      MCTS_POSITION_VALUE_SCALE
                  )
              : -MCTS_POSITION_VALUE_LIMIT
          })
          mctsProfile.leafEvaluationMs += performance.now() - leafEvaluationStarted
        }
        callbackElapsedMs = performance.now() - callbackStarted
      })
      const analysisElapsedMs = performance.now() - analysisStarted
      mctsProfile.analysisSnapshotRestoreMs += Math.max(
        0,
        analysisElapsedMs - callbackElapsedMs
      )

      tree.backup(selectedPath, reward)
      if (this.deckEvaluator && firstRootActionKey) {
        const stats = strategySamples.get(firstRootActionKey) ?? {
          total: 0,
          samples: 0
        }
        stats.total += deckStrategyAdjustment
        stats.samples++
        strategySamples.set(firstRootActionKey, stats)
      }
      if (firstRootActionKey && searchedTurnLine.length) {
        const lines = sampledTurnLines.get(firstRootActionKey) ?? new Map()
        for (let length = 1; length <= searchedTurnLine.length; length++) {
          const commands = searchedTurnLine.slice(0, length)
          const lineKey = JSON.stringify(commands.map(canonicalCommandKey))
          const line = lines.get(lineKey) ?? {
            visits: 0,
            valueSum: 0,
            commands
          }
          line.visits++
          line.valueSum += reward
          lines.set(lineKey, line)
        }
        sampledTurnLines.set(firstRootActionKey, lines)
      }
      iterations++
      totalDepth += depth
      totalTreeDepth += treeDepth
      totalRolloutDepth += rolloutDepth
      maximumRolloutDepth = Math.max(maximumRolloutDepth, rolloutDepth)
      if (this.onSearchProgress && (iterations === 1 || iterations % 64 === 0)) {
        const provisional = tree
          .rootStats(rootInformationKey)
          .map((stat) => {
            const action = rootChoices.get(stat.key)
            if (!action) return null
            const recommendationValue =
              mctsRootRecommendationScore(stat) -
              (rootCandidatePreferenceAdjustments.get(stat.key) ?? 0) -
              (rootCandidateRiskAdjustments.get(stat.key) ?? 0) -
              (rootCandidateTacticalPenalties.get(stat.key) ?? 0)
            return { stat, action, recommendationValue }
          })
          .filter((candidate) => candidate !== null)
          .sort(
            (left, right) =>
              right.recommendationValue - left.recommendationValue ||
              right.stat.visits - left.stat.visits ||
              right.stat.meanValue - left.stat.meanValue ||
              left.action.id.localeCompare(right.action.id)
          )[0]
        if (provisional) {
          try {
            this.onSearchProgress({
              actionId: provisional.action.id,
              command: provisional.action.command,
              description: provisional.action.description,
              recommendationValue: provisional.recommendationValue,
              iterations
            })
          } catch {
            // Progress reporting must not interrupt the actual search.
          }
        }
      }
    }

    if (cancelled || this.cancelled.has(requestId)) return null
    const rootObservation = simulationSession.getAiObservation()
    const rootStats = tree.rootStats(informationSetKey(rootObservation))
    const visited = rootStats
      .map((stat) => ({ stat, action: rootChoices.get(stat.key) }))
      .filter(
        (entry): entry is { stat: (typeof rootStats)[number]; action: LocalAction } =>
          entry.action !== undefined
      )
    const rootState = simulationSession.getState()
    const rootCandidateContinuations = new Map<string, readonly TurnMatchCommand[]>()
    const reviewedLineValues = new Map<string, number>()
    const certifiedCompletions = new Set<string>()
    const continuationOutcomes = new Map<
      string,
      ReturnType<typeof inspectTacticalLine>
    >()
    // A terminal root dispatch remains certain even when the later shortlist
    // inspection runs out of time. Otherwise a lightly sampled immediate loss
    // can outrank alternatives whose next-turn public threats were inspected.
    const rootTerminalOutcomes = new Map(
      tactical.lines
        .filter(
          (line) =>
            line.proven && line.commands.length === 1 && line.outcome !== 'ongoing'
        )
        .map((line) => [canonicalCommandKey(line.commands[0]!), line.outcome])
    )
    const safetyCandidates = new Set(
      [...visited]
        .sort((a, b) => b.stat.meanValue - a.stat.meanValue)
        .slice(0, 12)
        .map(({ stat }) => stat.key)
    )
    for (const { stat, action } of visited) {
      let continuation = sampledContinuation(sampledTurnLines.get(stat.key)) ?? [
        action.command
      ]
      let supportedCoinPayoff:
        | {
            readonly commands: readonly TurnMatchCommand[]
            readonly visits: number
            readonly valueSum: number
          }
        | undefined
      const rootSelf = rootState.players.find(
        (player) => player.participantId === rootId
      )
      const coinInstanceId =
        action.command.type === 'play-card' ? action.command.cardInstanceId : null
      const isCoinAction =
        coinInstanceId !== null &&
        rootSelf?.hand.some(
          (card) =>
            card.instanceId === coinInstanceId && card.cardId === 'basic_the_coin'
        ) === true
      if (isCoinAction) {
        const sampledLines = [...(sampledTurnLines.get(stat.key)?.values() ?? [])]
          .filter((line) => line.commands.length > 1)
          .map((line) => ({
            ...line,
            actions: line.commands.filter((command) => command.type !== 'end-turn')
          }))
          .filter((line) => line.actions.length > 1)
          .map((line) => {
            const afterHeroPower = simulationSession.match.analyze((fork) => {
              let dispatchedActions = 0
              for (const command of line.commands) {
                if (command.type === 'end-turn') break
                if (!fork.dispatch(command).accepted) break
                dispatchedActions++
                if (dispatchedActions === 2) break
              }
              return fork.getState()
            })
            return {
              ...line,
              penalty: expertCoinHeroPowerSequencePenalty(
                line.commands,
                rootState,
                afterHeroPower,
                rootId
              )
            }
          })
        const payoffs = sampledLines.filter((line) => line.penalty === 0)
        const bestPayoff = payoffs
          .filter((line) => line.visits >= 2)
          .sort(
            (left, right) =>
              right.valueSum / right.visits - left.valueSum / left.visits ||
              left.commands.length - right.commands.length ||
              right.visits - left.visits
          )[0]
        if (bestPayoff) {
          continuation = bestPayoff.commands
          supportedCoinPayoff = bestPayoff
        } else if (payoffs.length) {
          // A single lucky payoff cannot supply a supported continuation value.
          continuation = [action.command]
        } else if (sampledLines.some((line) => line.penalty > 0)) {
          rootCandidateTacticalPenalties.set(
            stat.key,
            (rootCandidateTacticalPenalties.get(stat.key) ?? 0) +
              EXPERT_COIN_HERO_POWER_PENALTY
          )
          const badLine = [...sampledLines].sort(
            (left, right) =>
              right.valueSum / right.visits - left.valueSum / left.visits ||
              left.commands.length - right.commands.length
          )[0]
          if (badLine) continuation = badLine.commands
        }
      }
      if (
        safetyCandidates.has(stat.key) &&
        (this.workBudget !== undefined || performance.now() < deadline)
      ) {
        // Review at most three supported lines per shortlisted root. Do not let
        // an execution-rejected later action inflate the value of its first move.
        const lines = isCoinAction
          ? supportedCoinPayoff
            ? [supportedCoinPayoff]
            : []
          : [...(sampledTurnLines.get(stat.key)?.values() ?? [])]
              .filter((line) => line.visits >= 2)
              .sort((a, b) => b.valueSum / b.visits - a.valueSum / a.visits)
              .slice(0, 3)
        const candidates = lines.length
          ? lines
          : [
              {
                commands: continuation,
                visits: 1,
                valueSum: mctsRootRecommendationScore(stat)
              }
            ]
        let best: { value: number; commands: readonly TurnMatchCommand[] } | undefined
        for (const line of candidates) {
          if (this.workBudget === undefined && performance.now() >= deadline) break
          const opening = line.commands[0]
          const supported =
            rootSelf?.weapon?.durability === 1 &&
            opening?.type === 'attack-character' &&
            opening.attacker.kind === 'hero'
              ? identicalSupportedContinuation(line, [
                  ...(sampledTurnLines.get(stat.key)?.values() ?? [])
                ])
              : line
          const penalty = simulationSession.match.analyze((fork) =>
            expertContinuationPenalty(
              fork,
              rootId,
              supported.commands,
              () => this.workBudget === undefined && performance.now() >= deadline
            )
          )
          if (penalty > 0) continue
          const value = line.valueSum / line.visits
          if (!best || value > best.value)
            best = { value, commands: supported.commands }
        }
        if (best) {
          continuation = best.commands
          reviewedLineValues.set(stat.key, best.value)
        } else {
          // A rejected follow-up does not make the opening move itself bad.
          // Remove its optimistic line support and replan after the root action.
          continuation = [action.command]
          reviewedLineValues.set(stat.key, mctsRootRecommendationScore(stat))
        }
      }
      const immediateOutcome = rootTerminalOutcomes.get(stat.key)
      let inspection: ReturnType<typeof inspectTacticalLine> = immediateOutcome
        ? { outcome: immediateOutcome, reply: 'unknown' as const }
        : safetyCandidates.has(stat.key) && performance.now() < deadline
          ? simulationSession.match.analyze((fork) =>
              inspectTacticalLine(
                fork,
                rootId,
                continuation,
                () => this.workBudget === undefined && performance.now() >= deadline,
                this.workBudget === undefined ? 96 : 12
              )
            )
          : { outcome: 'unknown' as const, reply: 'unknown' as const }
      // A broader clear reply to a partial line describes its available pass
      // completion. Retain that exact completion only with repeated real samples.
      if (
        publicThreat.reply === 'lethal' &&
        inspection.reply === 'clear' &&
        inspection.outcome === 'ongoing' &&
        continuation.at(-1)?.type !== 'end-turn'
      ) {
        const complete = [
          ...continuation,
          { type: 'end-turn' as const, participantId: rootId }
        ]
        const sample = sampledTurnLines
          .get(stat.key)
          ?.get(JSON.stringify(complete.map(canonicalCommandKey)))
        if (sample && sample.visits >= 2 && performance.now() < deadline) {
          const checked = simulationSession.match.analyze((fork) =>
            inspectTacticalLine(
              fork,
              rootId,
              complete,
              () => performance.now() >= deadline,
              96
            )
          )
          if (checked.reply === 'clear' && checked.outcome === 'ongoing') {
            continuation = complete
            inspection = checked
            reviewedLineValues.set(stat.key, sample.valueSum / sample.visits)
          }
        }
      }
      // A certificate belongs to its exact completion, never another suffix.
      // Require repeated real visits to that completion, and keep any discovered
      // own win ahead of this conservative immediate-survival preference.
      const certified =
        publicThreat.reply === 'lethal'
          ? publicThreat.defenses.find(
              (line) => canonicalCommandKey(line.commands[0]!) === stat.key
            )
          : undefined
      const certifiedSample =
        certified &&
        sampledTurnLines
          .get(stat.key)
          ?.get(JSON.stringify(certified.commands.map(canonicalCommandKey)))
      if (
        certified &&
        certifiedSample &&
        certifiedSample.visits >= 2 &&
        inspection.outcome !== 'win' &&
        !(
          inspection.reply === 'clear' &&
          continuation.at(-1)?.type === 'end-turn' &&
          (sampledTurnLines
            .get(stat.key)
            ?.get(JSON.stringify(continuation.map(canonicalCommandKey)))?.visits ??
            0) >= 2
        ) &&
        performance.now() < deadline
      ) {
        const contrary = simulationSession.match.analyze((fork) =>
          inspectTacticalLine(
            fork,
            rootId,
            certified.commands,
            () => performance.now() >= deadline,
            96
          )
        )
        // Stronger adverse evidence for this exact line beats attack-only safety.
        // Unknown alternatives retain neutral truth labels; this is a policy.
        if (contrary.outcome !== 'loss' && contrary.reply !== 'lethal') {
          continuation = certified.commands
          inspection = contrary
          reviewedLineValues.set(
            stat.key,
            certifiedSample.valueSum / certifiedSample.visits
          )
          certifiedCompletions.add(stat.key)
        }
      }
      continuationOutcomes.set(stat.key, inspection)
      rootCandidateContinuations.set(stat.key, continuation)
    }
    // Score achievable continuations instead of averaging good setups with
    // avoidable mistakes later in the same turn. Require repeated samples.
    const supportedLineValue = (
      key: string,
      fallback: (typeof rootStats)[number]
    ): number => {
      const inspection = continuationOutcomes.get(key)
      if (inspection?.outcome === 'win') return 1
      if (inspection?.outcome === 'loss') return -1
      if (inspection?.outcome === 'draw') return 0
      if (inspection?.reply === 'lethal') return -0.925
      const reviewed = reviewedLineValues.get(key)
      if (reviewed !== undefined) return reviewed
      const lines = [...(sampledTurnLines.get(key)?.values() ?? [])].filter(
        (line) => line.visits >= 2
      )
      return lines.length
        ? Math.max(...lines.map((line) => line.valueSum / line.visits))
        : mctsRootRecommendationScore(fallback)
    }
    const survivalPreference = (key: string) =>
      publicThreat.reply === 'lethal' &&
      (certifiedCompletions.has(key) ||
        (continuationOutcomes.get(key)?.reply === 'clear' &&
          rootCandidateContinuations.get(key)?.at(-1)?.type === 'end-turn'))
    const selected = [...visited].sort(
      (left, right) =>
        Number(continuationOutcomes.get(right.stat.key)?.outcome === 'win') -
          Number(continuationOutcomes.get(left.stat.key)?.outcome === 'win') ||
        Number(continuationOutcomes.get(left.stat.key)?.outcome === 'loss') -
          Number(continuationOutcomes.get(right.stat.key)?.outcome === 'loss') ||
        Number(survivalPreference(right.stat.key)) -
          Number(survivalPreference(left.stat.key)) ||
        Number(continuationOutcomes.get(left.stat.key)?.reply === 'lethal') -
          Number(continuationOutcomes.get(right.stat.key)?.reply === 'lethal') ||
        supportedLineValue(right.stat.key, right.stat) -
          (rootCandidatePreferenceAdjustments.get(right.stat.key) ?? 0) -
          (rootCandidateRiskAdjustments.get(right.stat.key) ?? 0) -
          (rootCandidateTacticalPenalties.get(right.stat.key) ?? 0) -
          (supportedLineValue(left.stat.key, left.stat) -
            (rootCandidatePreferenceAdjustments.get(left.stat.key) ?? 0) -
            (rootCandidateRiskAdjustments.get(left.stat.key) ?? 0) -
            (rootCandidateTacticalPenalties.get(left.stat.key) ?? 0)) ||
        right.stat.visits - left.stat.visits ||
        right.stat.meanValue - left.stat.meanValue ||
        left.action.id.localeCompare(right.action.id)
    )[0]
    if (!selected) return null

    const candidates: LocalAiCandidateTrace[] = [...visited]
      .sort(
        (left, right) =>
          (certifiedCompletions.size > 0 || survivalPreference(selected.stat.key)
            ? Number(right.stat.key === selected.stat.key) -
              Number(left.stat.key === selected.stat.key)
            : 0) ||
          Number(certifiedCompletions.has(right.stat.key)) -
            Number(certifiedCompletions.has(left.stat.key)) ||
          right.stat.visits - left.stat.visits ||
          right.stat.meanValue - left.stat.meanValue
      )
      .slice(0, this.limits.traceCandidateLimit)
      .map(({ stat, action }) => ({
        ...(() => {
          const selectedLine = rootCandidateContinuations.get(stat.key) ??
            sampledContinuation(sampledTurnLines.get(stat.key)) ?? [action.command]
          const sample = sampledTurnLines
            .get(stat.key)
            ?.get(JSON.stringify(selectedLine.map(canonicalCommandKey)))
          const complete =
            sample &&
            identicalSupportedContinuation(sample, [
              ...(sampledTurnLines.get(stat.key)?.values() ?? [])
            ])
          return {
            ...(complete?.commands.at(-1)?.type === 'end-turn' && complete.visits >= 2
              ? {
                  resourceReviewIntents: complete.commands.map((command) =>
                    aiActionIntent(command, this.session.localParticipantId)
                  )
                }
              : {}),
            sequenceIntents: selectedLine.map((command) =>
              aiActionIntent(command, this.session.localParticipantId)
            )
          }
        })(),
        publicAttackThreat: publicThreat.reply === 'lethal',
        publicAttackSurvival: certifiedCompletions.has(stat.key),
        actionId: action.id,
        type: action.command.type,
        description: action.description,
        score: stat.meanValue,
        scoreComponents: {
          positionDelta: stat.meanValue,
          commandPreference: 0,
          continuationPreference: this.continuationPreference(action.command),
          threatDefense: 0,
          opponentBoardRemoval: 0,
          friendlyBoardLoss: 0,
          sequenceRefinement: 0
        },
        accepted: true,
        phase: simulationSession.getState().phase,
        winnerId: null,
        outcome: continuationOutcomes.get(stat.key)?.outcome,
        provenWin: continuationOutcomes.get(stat.key)?.outcome === 'win',
        publicReply: continuationOutcomes.get(stat.key)?.reply,
        visits: stat.visits,
        meanValue: stat.meanValue,
        ...(this.deckEvaluator
          ? {
              meanDeckStrategyAdjustment:
                (strategySamples.get(stat.key)?.total ?? 0) /
                Math.max(1, strategySamples.get(stat.key)?.samples ?? 0)
            }
          : {}),
        prior: rootCandidatePriors.get(stat.key),
        recommendationValue: supportedLineValue(stat.key, stat),
        recommendationRiskAdjustment: rootCandidateRiskAdjustments.get(stat.key),
        recommendationPreferenceAdjustment: rootCandidatePreferenceAdjustments.get(
          stat.key
        ),
        recommendationTacticalPenalty: rootCandidateTacticalPenalties.get(stat.key),
        actionOutcomeReason: rootActionOutcomes.get(stat.key)?.reason
      }))
    const executableSequence = rootCandidateContinuations.get(selected.stat.key) ??
      sampledContinuation(sampledTurnLines.get(selected.stat.key)) ?? [
        selected.action.command
      ]
    const executableSequenceLabels = executableSequence.map(
      (command) =>
        rootChoices.get(canonicalCommandKey(command))?.description ??
        canonicalCommandKey(command)
    )
    const durationMs = performance.now() - started
    mctsProfile.averageTreeDepth = totalTreeDepth / Math.max(1, iterations)
    mctsProfile.averageRolloutDepth = totalRolloutDepth / Math.max(1, iterations)
    mctsProfile.maximumRolloutDepth = maximumRolloutDepth
    const reason =
      `MCTS selected ${selected.action.description} after ${iterations} ` +
      `iterations (mean value ${selected.stat.meanValue.toFixed(3)}).`
    const best: ScoredAction = {
      action: selected.action,
      score: selected.stat.meanValue,
      reason,
      simulation: { accepted: true },
      sequence: executableSequence,
      sequenceLabels: executableSequenceLabels,
      scoreComponents: {
        positionDelta: selected.stat.meanValue,
        commandPreference: 0,
        continuationPreference: this.continuationPreference(selected.action.command),
        threatDefense: 0,
        opponentBoardRemoval: 0,
        friendlyBoardLoss: 0,
        sequenceRefinement: 0
      }
    }
    const trace: LocalAiDecisionTrace = {
      publicThreatReview: publicThreat.stats,
      boundaryEvaluations,
      orderingReview: { ...inspectOrder.stats },
      requestId,
      phase,
      ...(this.deckEvaluator
        ? {
            deckStrategy: this.deckEvaluator.evaluate(
              rootObservation,
              rootState.players.find((player) => player.participantId === rootId)
                ?.deck ?? []
            )
          }
        : {}),
      durationMs,
      tacticalNodes: tactical.nodes,
      tacticalExhausted: tactical.exhausted,
      decisionPriority:
        continuationOutcomes.get(selected.stat.key)?.outcome === 'win'
          ? 'verified-win'
          : [...continuationOutcomes.values()].some((entry) => entry.reply === 'lethal')
            ? 'survival'
            : 'strategy',
      evaluatedActions: visited.length,
      refinedActions: visited.length,
      continuations: 0,
      timedOut: performance.now() >= deadline,
      baseScore: null,
      visibleThreat: null,
      chosenActionId: selected.action.id,
      candidates,
      rootLegalActionCount: rootChoices.size,
      rootVisitDistribution: visited.map(({ stat, action }) => ({
        actionId: action.id,
        visits: stat.visits,
        meanValue: stat.meanValue
      })),
      chosenSequence: executableSequenceLabels,
      chosenSequenceDepth: Math.round(totalDepth / Math.max(1, iterations)),
      sequenceSearchMs: durationMs,
      sequenceNodes: iterations,
      sampleCount: iterations,
      workUnits: this.workUnits,
      workBudgetHit: this.workBudgetHit,
      mctsProfile
    }
    this.publishTrace(trace)
    return { best, trace }
  }

  private commandPrior(
    command: TurnMatchCommand,
    state: TurnMatchState,
    actorId: string
  ): number {
    const continuationPreference =
      this.continuationPreference(command) * 2 -
      unpaidActionPenalty(command, state, actorId) * 20
    if (command.type === 'end-turn') return -2 + continuationPreference
    if (command.type === 'attack-character')
      return this.attackCommandPrior(command, state, actorId) + continuationPreference
    if (command.type === 'play-card') {
      const player = state.players.find((entry) => entry.participantId === actorId)
      const opponent = state.players.find((entry) => entry.participantId !== actorId)
      const card = player?.hand.find(
        (card) => card.instanceId === command.cardInstanceId
      )
      const cardId = card?.cardId
      const definition = cardId ? CARD_CATALOG.get(cardId) : undefined
      const adjacent = definition && containsAdjacentMechanic(definition.effects)
      const boardLength = player?.board.length ?? 0
      const neighbors =
        adjacent && command.position !== undefined
          ? Math.min(command.position, boardLength - command.position)
          : 0
      return (
        3 +
        Math.max(-2, Math.min(5, (definition ? cardScore(definition.id) : 0) * 0.04)) +
        neighbors * 0.5 +
        (player && definition
          ? healingSynergyPrior(
              player,
              definition.effects,
              player.nextCardCostsOpponentHealth
                ? 0
                : number(card?.currentCost, definition.cost)
            )
          : 0) +
        (player && definition ? cthunBuffPrior(definition.effects, player) : 0) +
        (player && definition && card
          ? conditionalMinionPayoffPrior(
              definition.effects,
              player,
              card.instanceId,
              player.nextCardCostsOpponentHealth
                ? 0
                : number(card.currentCost, definition.cost)
            )
          : 0) +
        (player && opponent && definition?.type === 'Minion' && card
          ? deathrattleSetupPrior(
              definition.effects,
              number(definition.health),
              player,
              opponent,
              player.nextCardCostsOpponentHealth
                ? 0
                : number(card.currentCost, definition.cost),
              state.turnNumber
            )
          : 0) +
        Math.min(12, this.lethalBurstPrior(command, state, actorId) * 0.04) +
        continuationPreference
      )
    }
    if (command.type === 'use-hero-power') {
      const player = state.players.find((entry) => entry.participantId === actorId)
      if (!player) return 2.5 + continuationPreference
      const power = HERO_POWER_CATALOG.get(player.heroPower.id)
      const replayPenalty =
        power &&
        heroPowerBlocksDiscountedChargeReplay(
          player,
          state.turnNumber,
          number(power.cost)
        )
          ? -6
          : 0
      const basePrior =
        2.5 +
        replayPenalty +
        continuationPreference -
        unpaidFriendlyDamageHeroPowerPenalty(command, state, actorId)
      const targetRef = command.target
      if (targetRef?.kind !== 'minion') return basePrior
      const targetPlayer = state.players.find(
        (entry) => entry.participantId === targetRef.participantId
      )
      const target = targetPlayer?.board.find(
        (entry) => entry.instanceId === targetRef.instanceId
      )
      const targetDefinition = target ? CARD_CATALOG.get(target.cardId) : undefined
      const opponent = state.players.find((entry) => entry.participantId !== actorId)
      const heroPowerDamage = damageHeroPowerAmount(player)
      if (
        target &&
        targetDefinition?.type === 'Minion' &&
        targetPlayer?.participantId === player.participantId &&
        opponent &&
        heroPowerDamage > 0 &&
        number(target.health) <= heroPowerDamage
      ) {
        const clearPrior = deathrattleClearPrior(
          targetDefinition.effects,
          opponent,
          state.turnNumber
        )
        if (clearPrior > 0) return basePrior + clearPrior
      }
      const healAmount = healingPowerAmount(player)
      if (
        !target ||
        targetPlayer?.participantId !== player.participantId ||
        !healAmount
      )
        return basePrior
      const restored = Math.min(
        healAmount,
        Math.max(0, number(target.maxHealth, target.health) - number(target.health))
      )
      const hasDrawTrigger = player.board.some((minion) => {
        const definition = CARD_CATALOG.get(minion.cardId)
        return definition && hasMinionHealDrawTrigger(definition.effects)
      })
      return basePrior + restored * 1.5 + (restored > 0 && hasDrawTrigger ? 6 : 0)
    }
    return 2 + continuationPreference
  }

  private continuationPreference(command: TurnMatchCommand): number {
    return this.preferredContinuation &&
      sameAiIntent(
        this.preferredContinuation,
        aiActionIntent(command, this.session.localParticipantId)
      )
      ? LOCAL_AI_POLICY.weights.expertContinuationPreference
      : 0
  }

  private attackCommandPrior(
    command: Extract<TurnMatchCommand, { readonly type: 'attack-character' }>,
    state: TurnMatchState,
    actorId: string
  ): number {
    const attackerPlayer = state.players.find(
      (player) => player.participantId === actorId
    )
    const defenderPlayer = state.players.find(
      (player) => player.participantId !== actorId
    )
    if (!attackerPlayer || !defenderPlayer) return 1
    const attackerRef = command.attacker
    const attacker =
      attackerRef.kind === 'minion'
        ? attackerPlayer?.board.find(
            (minion) => minion.instanceId === attackerRef.instanceId
          )
        : undefined
    if (command.defender.kind === 'hero') {
      if (
        command.attacker.kind !== 'minion' ||
        !attacker ||
        !defenderPlayer.secrets?.some((secret) => !secret.revealed)
      )
        return 3

      const turnNumber = state.turnNumber
      const readyAttackers = attackerPlayer.board.filter((minion) => {
        const keywords = effectiveBoardMinionKeywords(minion, turnNumber)
        return (
          number(minion.attack) > 0 &&
          number(minion.summonedOnTurn, -1) < turnNumber &&
          number(minion.controllerChangedOnTurn, -1) < turnNumber &&
          number(minion.frozenUntilTurn, -1) < turnNumber &&
          boardMinionAttacksUsed(minion, turnNumber) <
            Math.max(1, number(minion.maxAttacksPerTurn, 1)) &&
          !keywords.includes('immune')
        )
      })
      if (readyAttackers.length < 2) return 3

      const threatValue = (minion: (typeof readyAttackers)[number]) =>
        number(minion.attack) + number(minion.health) * 1.25
      const leastValuableAttacker = Math.min(...readyAttackers.map(threatValue))
      const excessValue = Math.max(0, threatValue(attacker) - leastValuableAttacker)
      return excessValue === 0 ? 4.5 : 3 - Math.min(9, excessValue * 0.9)
    }
    const defenderRef = command.defender
    if (defenderRef.kind !== 'minion') return 1
    const defender = defenderPlayer.board.find(
      (minion) => minion.instanceId === defenderRef.instanceId
    )
    if (!attackerPlayer || !defenderPlayer || !defender) return 1

    const turnNumber = state.turnNumber
    const attackerKeywords = attacker
      ? effectiveBoardMinionKeywords(attacker, turnNumber)
      : (attackerPlayer.hero.keywords ?? [])
    const defenderKeywords = effectiveBoardMinionKeywords(defender, turnNumber)
    const attackerAttack = attacker
      ? number(attacker.attack)
      : number(attackerPlayer.hero.attack) +
        (attackerPlayer.weapon && attackerPlayer.weapon.durability > 0
          ? attackerPlayer.weapon.attack
          : 0)
    const attackerHealth = attacker
      ? number(attacker.health)
      : number(attackerPlayer.hero.health) + number(attackerPlayer.hero.armor)
    const defenderAttack = number(defender.attack)
    const defenderHealth = number(defender.health)
    const attackerShield = attackerKeywords.includes('divine-shield')
    const defenderShield = defenderKeywords.includes('divine-shield')
    const attackerPoisonous = attackerKeywords.includes('poisonous')
    const defenderPoisonous = defenderKeywords.includes('poisonous')
    const attackerImmune = attackerKeywords.includes('immune')
    const defenderImmune = defenderKeywords.includes('immune')
    const removesDefender =
      !defenderShield &&
      !defenderImmune &&
      attackerAttack > 0 &&
      (attackerPoisonous || attackerAttack >= defenderHealth)
    const losesAttacker =
      !attackerImmune &&
      !attackerShield &&
      ((defenderPoisonous && defenderAttack > 0) || defenderAttack >= attackerHealth)

    let prior = defenderKeywords.includes('taunt') ? 3 : 2
    if (defenderShield) {
      if (attackerShield && attackerAttack <= 1) prior += 9
      else if (attackerAttack <= 1) prior += 4
      else prior += 1
    }
    if (removesDefender) {
      prior += Math.min(6, 2 + (defenderAttack + defenderHealth) * 0.25)
      if (!losesAttacker) prior += 2
    }
    if (losesAttacker) prior -= removesDefender ? 1 : 6
    if (!removesDefender && !defenderShield && !defenderImmune) {
      const remainingDamage = Math.max(0, attackerAttack)
      const healthAfterAttack = defenderHealth - remainingDamage
      const followUpAttack = attackerPlayer.board.reduce((total, minion) => {
        if (minion.instanceId === attacker?.instanceId || number(minion.attack) <= 0)
          return total
        const keywords = effectiveBoardMinionKeywords(minion, turnNumber)
        const ready =
          number(minion.summonedOnTurn, -1) < turnNumber &&
          number(minion.controllerChangedOnTurn, -1) < turnNumber &&
          number(minion.frozenUntilTurn, -1) < turnNumber &&
          boardMinionAttacksUsed(minion, turnNumber) <
            Math.max(1, number(minion.maxAttacksPerTurn, 1)) &&
          !keywords.includes('immune')
        return total + (ready ? number(minion.attack) : 0)
      }, 0)
      if (healthAfterAttack > 0 && healthAfterAttack <= followUpAttack) prior += 8
    }
    return prior
  }

  private lethalBurstPrior(
    command: TurnMatchCommand,
    state: TurnMatchState,
    actorId: string
  ): number {
    if (command.type !== 'play-card') return 0
    const player = state.players.find((entry) => entry.participantId === actorId)
    const opponent = state.players.find((entry) => entry.participantId !== actorId)
    const current = player?.hand.find(
      (card) => card.instanceId === command.cardInstanceId
    )
    const currentDefinition = current ? CARD_CATALOG.get(current.cardId) : undefined
    let opponentHealth = opponent
      ? number(record(opponent.hero).health) + number(record(opponent.hero).armor)
      : Number.POSITIVE_INFINITY
    if (!player || !opponent || !current || !currentDefinition) return 0
    if (
      player.nextCardCostsOpponentHealth &&
      !canPayCardCost(
        currentDefinition,
        player,
        number(current.currentCost, currentDefinition.cost)
      )
    )
      return 0

    let availableMana = number(record(player.mana).available)
    const resource = cardCostResource(currentDefinition, player)
    if (resource !== 'opponent-health')
      availableMana -= number(current.currentCost, currentDefinition.cost)
    const opponentHealthPayment =
      resource === 'opponent-health'
        ? cardPaymentCost(
            currentDefinition,
            player,
            number(current.currentCost, currentDefinition.cost)
          )
        : 0
    // Health payment bypasses Armor; subsequent spell damage does not.
    if (opponentHealthPayment > 0) {
      if (opponentHealthPayment >= opponent.hero.health) return 300
      opponentHealth -= opponentHealthPayment
    }
    if (availableMana < 0) return 0

    let spellPower = player.board.reduce(
      (total, minion) =>
        total +
        (effectiveBoardMinionKeywords(minion, state.turnNumber).includes('spell-damage')
          ? 1
          : 0),
      0
    )
    const isSpellPower = (definition: NonNullable<typeof currentDefinition>) =>
      definition.keywords.includes('spell-damage') ||
      definition.rulesText.toLowerCase().includes('spell damage +')
    if (isSpellPower(currentDefinition)) spellPower++

    const targetsEnemyHero =
      command.targets?.some(
        (target) =>
          target.kind === 'hero' && target.participantId === opponent.participantId
      ) === true
    let candidateDamage = targetsEnemyHero
      ? directSpellDamageForPlayer(currentDefinition.effects, player)
      : 0
    if (candidateDamage > 0) candidateDamage += spellPower
    const currentEffects = JSON.stringify(currentDefinition.effects).toLowerCase()
    if (
      candidateDamage <= 0 &&
      opponentHealthPayment <= 0 &&
      !isSpellPower(currentDefinition) &&
      !currentEffects.includes('mana')
    )
      return 0

    const burstCards = player.hand
      .filter((card) => card.instanceId !== current.instanceId)
      .map((card) => {
        const definition = CARD_CATALOG.get(card.cardId)
        return definition
          ? {
              card,
              definition,
              cost: number(card.currentCost, definition.cost),
              damage: directSpellDamageForPlayer(definition.effects, player),
              spellPower: isSpellPower(definition)
            }
          : null
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    const powerOptions = [
      { extraPower: 0, extraCost: 0 },
      ...burstCards
        .filter((entry) => entry.spellPower)
        .map((entry) => ({ extraPower: 1, extraCost: entry.cost }))
    ]

    for (const powerOption of powerOptions) {
      const costLimit = availableMana - powerOption.extraCost
      if (costLimit < 0) continue
      const power = spellPower + powerOption.extraPower
      const damageCards = burstCards.filter(
        (entry) => entry.damage > 0 && !(powerOption.extraPower && entry.spellPower)
      )
      const bestAtCost = Array<number>(costLimit + 1).fill(Number.NEGATIVE_INFINITY)
      bestAtCost[0] = candidateDamage
      for (const entry of damageCards) {
        for (let cost = costLimit; cost >= entry.cost; cost--) {
          const previous = bestAtCost[cost - entry.cost]!
          if (previous === Number.NEGATIVE_INFINITY) continue
          bestAtCost[cost] = Math.max(
            bestAtCost[cost]!,
            previous + entry.damage + power
          )
        }
      }
      if (Math.max(...bestAtCost) >= opponentHealth) return 300
    }
    return 0
  }

  private unrevealedSecretRisk(
    command: TurnMatchCommand,
    state: TurnMatchState,
    actorId: string
  ): number {
    const attackerRef = command.type === 'attack-character' ? command.attacker : null
    if (
      command.type === 'attack-character' &&
      command.defender.kind === 'hero' &&
      attackerRef?.kind === 'minion'
    ) {
      const actor = state.players.find((player) => player.participantId === actorId)
      const opponent = state.players.find((player) => player.participantId !== actorId)
      const attacker = actor?.board.find(
        (entry) => entry.instanceId === attackerRef.instanceId
      )
      if (!actor || !attacker || !opponent?.secrets?.some((secret) => !secret.revealed))
        return 0

      // A lethal attack is not guaranteed through an unknown defensive Secret.
      // Clear it first when public hand/mana facts provide that option.
      if (
        attacker.attack >= opponent.hero.health + opponent.hero.armor &&
        actor.hand.some((card) => {
          const definition = CARD_CATALOG.get(card.cardId)
          return (
            definition &&
            (actor.nextCardCostsOpponentHealth
              ? canPayCardCost(
                  definition,
                  actor,
                  number(card.currentCost, definition.cost)
                )
              : number(card.currentCost, definition.cost) <= actor.mana.available) &&
            containsEffectAction(definition.effects, 'destroy-secrets')
          )
        })
      )
        return 0.65

      const readyAttackers = actor.board.filter((minion) => {
        const keywords = effectiveBoardMinionKeywords(minion, state.turnNumber)
        return (
          number(minion.attack) > 0 &&
          number(minion.summonedOnTurn, -1) < state.turnNumber &&
          number(minion.controllerChangedOnTurn, -1) < state.turnNumber &&
          number(minion.frozenUntilTurn, -1) < state.turnNumber &&
          boardMinionAttacksUsed(minion, state.turnNumber) <
            Math.max(1, number(minion.maxAttacksPerTurn, 1)) &&
          !keywords.includes('immune')
        )
      })
      if (readyAttackers.length < 2) return 0

      const threatValue = (minion: (typeof readyAttackers)[number]) =>
        number(minion.attack) + number(minion.health) * 1.25
      const leastValuable = Math.min(...readyAttackers.map(threatValue))
      return Math.min(0.2, Math.max(0, threatValue(attacker) - leastValuable) * 0.025)
    }

    if (command.type !== 'play-card') return 0
    const actor = state.players.find((player) => player.participantId === actorId)
    const opponent = state.players.find((player) => player.participantId !== actorId)
    const card = actor?.hand.find(
      (entry) => entry.instanceId === command.cardInstanceId
    )
    const definition = card ? CARD_CATALOG.get(card.cardId) : undefined
    const opponentHealth = opponent
      ? number(record(opponent.hero).health) + number(record(opponent.hero).armor)
      : Number.POSITIVE_INFINITY
    const hasUnrevealedSecret =
      opponent?.secrets?.some((secret) => !secret.revealed) ?? false
    if (
      !actor ||
      !opponent ||
      !card ||
      definition?.type !== 'Spell' ||
      !hasUnrevealedSecret ||
      (!containsEffectAction(definition.effects, 'destroy-secrets') &&
        (!command.targets?.some(
          (target) =>
            target.kind === 'hero' && target.participantId === opponent.participantId
        ) ||
          this.lethalBurstPrior(command, state, actorId) <= 0))
    )
      return 0

    const availableMana = number(actor.mana.available)
    const hasFreeNonDamageSpell = actor.hand.some((entry) => {
      if (entry.instanceId === card.instanceId) return false
      const candidate = CARD_CATALOG.get(entry.cardId)
      return (
        candidate?.type === 'Spell' &&
        number(entry.currentCost, candidate.cost) === 0 &&
        availableMana >= number(card.currentCost, definition.cost) &&
        directSpellDamageForPlayer(candidate.effects, actor) === 0
      )
    })
    const lethalCost = number(card.currentCost, definition.cost)
    const hasCheaperDamageProbe = actor.hand.some((entry) => {
      if (entry.instanceId === card.instanceId) return false
      const candidate = CARD_CATALOG.get(entry.cardId)
      const candidateCost = number(entry.currentCost, candidate?.cost ?? Infinity)
      return (
        candidate?.type === 'Spell' &&
        directSpellDamageForPlayer(candidate.effects, actor) > 0 &&
        directSpellDamageForPlayer(candidate.effects, actor) < opponentHealth &&
        candidateCost < lethalCost &&
        availableMana >= lethalCost + candidateCost
      )
    })
    if (hasFreeNonDamageSpell || hasCheaperDamageProbe) return 0.65
    return 0
  }

  private rolloutCommand(
    candidates: readonly MctsCandidate<TurnMatchCommand>[],
    rng: ReturnType<typeof createSeededRng>
  ): TurnMatchCommand {
    const maximumPrior = Math.max(...candidates.map((candidate) => candidate.prior))
    const weights = candidates.map((candidate) =>
      Math.exp(Math.max(-30, (candidate.prior - maximumPrior) / 8))
    )
    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0)
    let draw = rng.next() * weightTotal
    for (let index = 0; index < candidates.length; index++) {
      draw -= weights[index]!
      if (draw < 0) return candidates[index]!.action
    }
    return candidates[0]!.action
  }

  private terminalMctsValue(
    winnerId: string | null,
    rootId: string,
    depth: number
  ): number {
    if (!winnerId) return 0
    const speedPreference = Math.min(0.02, Math.max(0, depth) * 0.0004)
    return winnerId === rootId ? 1 - speedPreference : -1 + speedPreference
  }

  private scoreObservation(
    observation: AiObservation,
    winnerId: TurnMatchState['winnerId'] | undefined
  ): number {
    const score = stateScore(observation, this.session.remoteParticipantId)
    // Keep terminal outcomes independent of the positional evaluator.
    if (winnerId === this.session.remoteParticipantId)
      return (
        LOCAL_AI_POLICY.weights.terminalWin + LOCAL_AI_POLICY.weights.immediateLethal
      )
    if (winnerId) return LOCAL_AI_POLICY.weights.terminalLoss
    return score
  }

  private response(
    request: AiDecisionRequest,
    choice: AiDecisionChoice,
    reason: string,
    started: number,
    trace: LocalAiDecisionTrace | null
  ): AiDecisionResponse {
    return {
      matchId: request.matchId,
      requestId: request.requestId,
      expectedRevision: request.expectedRevision,
      modelId: EXPERT_MODEL_ID,
      reason: reason.slice(0, 580),
      choice,
      durationMs: performance.now() - started,
      finishReason: 'local-search',
      ...(trace
        ? {
            usage: {
              mode: 'local-search',
              policyRevision: EXPERT_AI_POLICY_REVISION,
              trace: traceAsJson(trace)
            }
          }
        : {})
    }
  }

  private publishTrace(trace: LocalAiDecisionTrace): void {
    this.lastTrace = trace
    try {
      this.onTrace?.(trace)
    } catch {
      // Diagnostics are deliberately non-authoritative and must never abort a turn.
    }
  }
}

function traceAsJson(trace: LocalAiDecisionTrace): JsonObject {
  return JSON.parse(JSON.stringify(trace)) as JsonObject
}
