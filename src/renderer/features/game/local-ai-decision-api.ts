import { CARD_CATALOG, HERO_POWER_CATALOG, cardHasTribe } from '../../../game/content'
import {
  enumerateLegalCommands,
  canonicalCommandKey,
  createSeededRng,
  type TurnMatchCommand,
  type TurnMatchState
} from '../../../game/match'
import {
  InformationSetMcts,
  mctsRootRecommendationScore,
  type MctsCandidate,
  type MctsSelection
} from '../../../game/match/ai/information-set-mcts'
import {
  boardMinionAttacksUsed,
  effectiveBoardMinionKeywords
} from '../../../game/match/rules/minion-attack-state'
import type { OpeningMatchAnalysis } from '../../../game/match/opening-match-types'
import type { AiObservation, AiObservedPlayer } from '../../../game/match/ai'
import {
  createFairHypothesisCheckpoint,
  EXPERT_FAIR_HYPOTHESIS_PREFIX
} from '../../../game/match/ai/fair-hypothesis-checkpoint'
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
} from '../../../shared/ipc/ai'
import {
  sameAiIntent,
  type AiActionIntent,
  type AiDecisionChoice
} from '../../../shared/ipc/ai-deliberation'
import { aiActionIntent } from './ai-action-intent'
import { aiActions } from './ai-context'
import { EXPERT_AI_PLAN_SEARCH_LIMIT_MS } from './expert-ai-worker-protocol'
import { LOCAL_AI_POLICY } from './local-ai-policy'
import { GameBoardSession } from './game-board-session'

const EASY_MODEL_ID = 'hardware-local-v1'
const EXPERT_MODEL_ID = 'hardware-local-v2'
const MCTS_POSITION_VALUE_SCALE = 900
const MCTS_POSITION_VALUE_LIMIT = 0.9
const MCTS_MAX_CACHED_INFORMATION_SETS = 4_096
type LocalAiSearchProfile = 'easy' | 'expert'

interface LocalAiSearchLimits {
  readonly maxThinkMs: number
  readonly sequenceThinkMs: number
  readonly rootSearchLimit: number
  readonly sequenceBranchLimit: number
  readonly sequenceMaxDepth: number
  readonly sequenceNodeLimit: number
  readonly sequenceRootNodeLimit: number
  readonly traceCandidateLimit: number
  readonly randomSampleSeeds: readonly number[]
}

export interface LocalAiDecisionOptions {
  readonly profile?: LocalAiSearchProfile
  readonly budgetMs?: number
  /** Deterministic test/benchmark cap; production requests use the wall-clock budget. */
  readonly workBudget?: number
  readonly preferredContinuation?: AiActionIntent
  readonly expertPlanSearchLimitMs?: number
  readonly expertReplanSearchLimitMs?: number
  /** True only when the session was built from a fair-hypothesis checkpoint. */
  readonly fairHypothesis?: boolean
}

const SEARCH_LIMITS: Readonly<Record<LocalAiSearchProfile, LocalAiSearchLimits>> = {
  easy: {
    maxThinkMs: 2_850,
    sequenceThinkMs: 900,
    rootSearchLimit: 14,
    sequenceBranchLimit: 8,
    sequenceMaxDepth: 7,
    sequenceNodeLimit: 240,
    sequenceRootNodeLimit: 8,
    traceCandidateLimit: 8,
    randomSampleSeeds: [0x1f123bb5, 0x8a5cd789, 0xc3ef14a1, 0x5eeded42]
  },
  expert: {
    maxThinkMs: 26_000,
    sequenceThinkMs: 26_000,
    rootSearchLimit: 64,
    sequenceBranchLimit: 12,
    sequenceMaxDepth: 10,
    sequenceNodeLimit: 4_000,
    sequenceRootNodeLimit: 96,
    traceCandidateLimit: 192,
    randomSampleSeeds: [
      0x1f123bb5, 0x8a5cd789, 0xc3ef14a1, 0x5eeded42, 0x73a9c21d, 0xb50d66f3,
      0x2cae8841, 0xe1437b95
    ]
  }
}
const EXPERT_REPLY_ACTION_LIMIT = 16
const EXPERT_REPLY_NODE_LIMIT = 24
const EXPERT_ROOT_COMMAND_PREFERENCE_SCALE = 0.5
const EXPERT_REPLAN_SEARCH_LIMIT_MS = 1_500

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
  readonly actionId: string
  readonly type: TurnMatchCommand['type']
  readonly description: string
  readonly score: number
  readonly scoreComponents: LocalAiScoreComponents
  readonly accepted: boolean
  readonly phase: TurnMatchState['phase'] | null
  readonly winnerId: string | null
  readonly sequenceIntents?: readonly AiActionIntent[]
  readonly visits?: number
  readonly meanValue?: number
  readonly prior?: number
  readonly recommendationRiskAdjustment?: number
  readonly recommendationPreferenceAdjustment?: number
  /** Hard Expert penalty for a first-turn Coin followed by a non-exempt hero power. */
  readonly recommendationTacticalPenalty?: number
}

/** Diagnostics for one local decision; kept small enough to persist with a match log. */
export interface LocalAiDecisionTrace {
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

interface SequenceSearchResult {
  readonly score: number
  readonly sequence: readonly TurnMatchCommand[]
  readonly labels: readonly string[]
  readonly nodes: number
  readonly responseScore: number | null
}

interface VisibleResponseScore {
  readonly score: number | null
  readonly nodes: number
  readonly cardPlayNodes: number
  readonly candidateAnalysisMs: number
  readonly candidateDispatchMs: number
  readonly candidateObservationMs: number
  readonly candidateScoringMs: number
  readonly actionGenerationMs: number
  readonly replayMs: number
}

interface SequenceSearchSummary {
  readonly candidates: ReadonlyMap<string, SequenceSearchResult>
  readonly responseNodes: number
  readonly responseCardPlayNodes: number
  readonly responseSearchMs: number
  readonly responseCandidateAnalysisMs: number
  readonly responseCandidateDispatchMs: number
  readonly responseCandidateObservationMs: number
  readonly responseCandidateScoringMs: number
  readonly responseActionGenerationMs: number
  readonly responseReplayMs: number
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
  // Prefer the longest line that recurred, instead of repeatedly choosing
  // the already-selected first action.
  return [...lines.values()]
    .filter((line) => line.commands.length > 1 && line.visits >= 2)
    .sort(
      (left, right) =>
        right.commands.length - left.commands.length ||
        right.visits - left.visits ||
        right.valueSum / Math.max(1, right.visits) -
          left.valueSum / Math.max(1, left.visits) ||
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
  return effect?.kind === 'damage-character' ? number(effect.amount) : 0
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
  const attack = number(player.cthun?.attack)
  if (!attackBuff || !attack || player.cthunDied) return 0
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

function playerValue(player: AiObservedPlayer, turnNumber: number): number {
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
  const cthunProgress =
    effects.cthunDied === true || !cthunAttack
      ? 0
      : cthunAttack * 3 +
        number(cthun.health) * 2 +
        cthunPayoffValue(player.hand, cthunAttack)
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

function stateScore(
  observation: AiObservation,
  selfId: string,
  profile: LocalAiSearchProfile
): number {
  const self = observation.players.find((player) => player.participantId === selfId)
  const opponent = observation.players.find((player) => player.participantId !== selfId)
  if (!self || !opponent) return -Infinity
  const selfHero = record(self.hero)
  const opponentHero = record(opponent.hero)
  const selfHealth = number(selfHero.health) + number(selfHero.armor) * 0.7
  const opponentHealth = number(opponentHero.health) + number(opponentHero.armor) * 0.7
  // Hero health is already part of playerValue. Keep only a small face-pressure
  // term for Expert so the same damage is not counted twice against trading.
  const pressure =
    (30 - opponentHealth) *
    LOCAL_AI_POLICY.weights.faceDamage *
    (profile === 'expert' ? 0.1 : 1)
  const danger =
    profile === 'expert'
      ? Math.max(0, 12 - selfHealth) * LOCAL_AI_POLICY.weights.heroHealth
      : (30 - selfHealth) * LOCAL_AI_POLICY.weights.heroHealth
  const boardPresence =
    profile === 'expert'
      ? (Math.min(3, self.board.length) - Math.min(3, opponent.board.length)) *
        LOCAL_AI_POLICY.weights.expertBoardPresence
      : 0
  return (
    playerValue(self, observation.turnNumber) -
    playerValue(opponent, observation.turnNumber) +
    boardPresence +
    pressure -
    danger
  )
}

function visibleThreat(
  player: AiObservedPlayer,
  turnNumber = Number.POSITIVE_INFINITY
): number {
  return player.board.reduce((total, minion) => {
    const entry = record(minion)
    if (number(entry.attack) <= 0) return total
    if (number(entry.summonedOnTurn, -1) >= turnNumber) return total
    if (number(entry.controllerChangedOnTurn, -1) >= turnNumber) return total
    if (number(entry.frozenUntilTurn, -1) >= turnNumber) return total
    const keywords = effectiveBoardMinionKeywords(minion, turnNumber)
    if (entry.immune === true || keywords.includes('immune')) return total
    if (
      number(entry.attacksUsedThisTurn) >=
      Math.max(1, number(entry.maxAttacksPerTurn, 1))
    )
      return total
    return total + number(entry.attack)
  }, 0)
}

/** Damage that can currently reach the hero; a visible friendly Taunt blocks face attacks. */
function visibleHeroThreat(
  attacker: AiObservedPlayer,
  defender: AiObservedPlayer,
  turnNumber: number
): number {
  const hasTaunt = defender.board.some((minion) => {
    return effectiveBoardMinionKeywords(minion, turnNumber).includes('taunt')
  })
  if (hasTaunt) return 0

  const hero = record(attacker.hero)
  const heroAttack = number(hero.attack)
  const heroAttacksUsed = number(hero.attacksUsedThisTurn)
  const heroMaxAttacks = Math.max(1, number(hero.maxAttacksPerTurn, 1))
  const frozenUntilTurn = number(hero.frozenUntilTurn, -1)
  const weapon = record(attacker.weapon)
  const weaponAttack = number(weapon.durability) > 0 ? number(weapon.attack) : 0
  const readyHeroAttack =
    heroAttack + weaponAttack > 0 &&
    heroAttacksUsed < heroMaxAttacks &&
    frozenUntilTurn < turnNumber

  return (
    visibleThreat(attacker, turnNumber) +
    (readyHeroAttack ? heroAttack + weaponAttack : 0)
  )
}

/**
 * Builds only engine-legal attacks from the opponent's public board and hero.
 * The attack-only legality query avoids enumerating hidden-hand actions.
 */
function visibleOpponentAttackCommands(
  fork: OpeningMatchAnalysis,
  observation: AiObservation
): readonly TurnMatchCommand[] {
  const attacker = observation.players.find((player) => player.role === 'opponent')
  if (!attacker || observation.activePlayerId !== attacker.participantId) return []

  const legalTargets =
    fork.getAttackLegality?.(attacker.participantId).legalAttackTargets ??
    fork.getLegality(attacker.participantId).legalAttackTargets
  const commands: TurnMatchCommand[] = []
  for (const [attackerId, targets] of Object.entries(legalTargets)) {
    const attackerRef =
      attackerId === `${attacker.participantId}:hero`
        ? { kind: 'hero' as const }
        : { kind: 'minion' as const, instanceId: attackerId }
    for (const defenderRef of targets)
      commands.push({
        type: 'attack-character',
        participantId: attacker.participantId,
        attacker: attackerRef,
        defender: defenderRef
      })
  }
  return commands
}

/** Keeps Easy/V1's existing approximate public-response generator unchanged. */
function easyOpponentAttackCommands(
  observation: AiObservation,
  selfId: string
): readonly TurnMatchCommand[] {
  const attacker = observation.players.find((player) => player.role === 'opponent')
  const defender = observation.players.find((player) => player.participantId === selfId)
  if (!attacker || !defender || observation.activePlayerId !== attacker.participantId)
    return []
  const turn = observation.turnNumber
  const allTargets: readonly (
    { kind: 'hero' } | { kind: 'minion'; instanceId: string }
  )[] = [
    { kind: 'hero' },
    ...defender.board.map((minion) => ({
      kind: 'minion' as const,
      instanceId: minion.instanceId
    }))
  ]
  const tauntTargets = defender.board
    .filter((minion) => effectiveBoardMinionKeywords(minion, turn).includes('taunt'))
    .map((minion) => ({
      kind: 'minion' as const,
      instanceId: minion.instanceId
    }))
  const targets = tauntTargets.length > 0 ? tauntTargets : allTargets
  const commands: TurnMatchCommand[] = []
  for (const minion of attacker.board) {
    const attacksUsed = number(minion.attacksUsedThisTurn)
    const maxAttacks = Math.max(1, number(minion.maxAttacksPerTurn, 1))
    if (
      number(minion.attack) <= 0 ||
      number(minion.summonedOnTurn, -1) >= turn ||
      number(minion.controllerChangedOnTurn, -1) >= turn ||
      attacksUsed >= maxAttacks ||
      number(minion.frozenUntilTurn, -1) >= turn
    )
      continue
    for (const defenderRef of targets)
      commands.push({
        type: 'attack-character',
        participantId: attacker.participantId,
        attacker: { kind: 'minion', instanceId: minion.instanceId },
        defender: defenderRef
      })
  }
  const hero = attacker.hero
  const heroAttack = number(hero.attack) + number(attacker.weapon?.attack)
  const heroMaxAttacks = Math.max(1, number(hero.maxAttacksPerTurn, 1))
  if (
    heroAttack > 0 &&
    number(hero.attacksUsedThisTurn) < heroMaxAttacks &&
    number(hero.frozenUntilTurn, -1) < turn
  )
    for (const defenderRef of targets)
      commands.push({
        type: 'attack-character',
        participantId: attacker.participantId,
        attacker: { kind: 'hero' },
        defender: defenderRef
      })
  return commands
}

function remainingPublicAttackDamage(
  attacker: AiObservedPlayer,
  command: Extract<TurnMatchCommand, { type: 'attack-character' }>,
  turnNumber: number
): number {
  const attackerRef = command.attacker
  if (attackerRef.kind === 'hero') {
    const hero = record(attacker.hero)
    const keywords = Array.isArray(hero.keywords) ? (hero.keywords as string[]) : []
    const defaultAttackLimit = keywords.includes('mega-windfury')
      ? 4
      : keywords.includes('windfury')
        ? 2
        : 1
    const attackLimit = Math.max(1, number(hero.maxAttacksPerTurn, defaultAttackLimit))
    const attacksUsed = number(
      hero.attacksUsedThisTurn,
      number(hero.lastAttackedOnTurn, -1) === turnNumber ? 1 : 0
    )
    const weapon = record(attacker.weapon)
    const weaponAttack = number(weapon.durability) > 0 ? number(weapon.attack) : 0
    return Math.max(0, attackLimit - attacksUsed) * (number(hero.attack) + weaponAttack)
  }

  const minion = attacker.board.find(
    (candidate) => candidate.instanceId === attackerRef.instanceId
  )
  if (!minion) return 0
  const keywords = effectiveBoardMinionKeywords(minion, turnNumber)
  const defaultAttackLimit = keywords.includes('mega-windfury')
    ? 4
    : keywords.includes('windfury')
      ? 2
      : 1
  const attackLimit = Math.max(1, number(minion.maxAttacksPerTurn, defaultAttackLimit))
  return (
    Math.max(0, attackLimit - boardMinionAttacksUsed(minion, turnNumber)) *
    number(minion.attack)
  )
}

/** Builds legal public hero-power replies without enumerating the opponent's hand. */
function visibleOpponentHeroPowerCommands(
  fork: OpeningMatchAnalysis,
  observation: AiObservation
): readonly TurnMatchCommand[] {
  const opponent = observation.players.find((player) => player.role === 'opponent')
  if (!opponent || observation.activePlayerId !== opponent.participantId) return []
  const legality = fork.getLegality(opponent.participantId)
  if (!legality.legalHeroPower) return []
  if (!legality.legalHeroPowerTargets.length)
    return [{ type: 'use-hero-power', participantId: opponent.participantId }]
  return legality.legalHeroPowerTargets.map((target) => ({
    type: 'use-hero-power',
    participantId: opponent.participantId,
    target
  }))
}

function containsRandomMechanic(value: unknown): boolean {
  if (typeof value === 'string') return value.toLowerCase().includes('random')
  if (Array.isArray(value)) return value.some(containsRandomMechanic)
  if (value && typeof value === 'object')
    return Object.entries(value).some(
      ([key, nested]) =>
        key.toLowerCase().includes('random') || containsRandomMechanic(nested)
    )
  return false
}

function containsAdjacentMechanic(value: unknown): boolean {
  if (typeof value === 'string') return value.toLowerCase().includes('adjacent')
  if (Array.isArray(value)) return value.some(containsAdjacentMechanic)
  if (value && typeof value === 'object')
    return Object.values(value).some(containsAdjacentMechanic)
  return false
}

/** Finds a board-count threshold that gates a card's conditional effect. */
function requiredBoardCount(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const requirement = requiredBoardCount(entry)
      if (requirement !== null) return requirement
    }
    return null
  }
  if (!value || typeof value !== 'object') return null
  const entry = value as Record<string, unknown>
  const condition =
    entry.condition && typeof entry.condition === 'object'
      ? (entry.condition as Record<string, unknown>)
      : null
  if (
    condition?.type === 'event-player-had-minion-count' &&
    (condition.operator === 'gte' || condition.operator === 'gt')
  ) {
    const threshold = number(condition.value, NaN)
    if (Number.isFinite(threshold))
      return condition.operator === 'gt' ? threshold + 1 : threshold
  }
  for (const [key, nested] of Object.entries(entry)) {
    if (key === 'condition') continue
    const requirement = requiredBoardCount(nested)
    if (requirement !== null) return requirement
  }
  return null
}

/**
 * Avoids spending mana on a conditional minion before its public prerequisite
 * is true. This is deliberately a small bias: lethal/removal signals still
 * outrank it, while cheap setup cards can be explored first in a turn plan.
 */
function conditionalBoardBias(
  cardId: string,
  state: TurnMatchState,
  participantId: string
): number {
  const definition = CARD_CATALOG.get(cardId)
  if (!definition) return 0
  const threshold = requiredBoardCount(definition.effects)
  if (threshold === null) return 0
  const boardCount =
    state.players.find((player) => player.participantId === participantId)?.board
      .length ?? 0
  return boardCount >= threshold ? 18 : -(threshold - boardCount) * 100
}

function hasRandomText(cardId: string): boolean {
  const definition = CARD_CATALOG.get(cardId)
  if (!definition) return false
  return (
    containsRandomMechanic({
      name: definition.name,
      rulesText: definition.rulesText,
      effects: definition.effects
    }) || /adapt/.test(`${definition.name} ${definition.rulesText}`.toLowerCase())
  )
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

function choiceOptionBias(
  pending: NonNullable<TurnMatchState['pendingCardChoice']>,
  option: NonNullable<TurnMatchState['pendingCardChoice']>['options'][number],
  before: AiObservation,
  selfId: string
): number {
  const self = before.players.find((player) => player.participantId === selfId)
  const opponent = before.players.find((player) => player.participantId !== selfId)
  if (!self || !opponent) return 0
  const presentationId = option.presentationCardId
  const definition = presentationId ? CARD_CATALOG.get(presentationId) : undefined
  const text =
    `${definition?.name ?? option.label} ${definition?.rulesText ?? ''}`.toLowerCase()

  const resolution = pending.resolution
  if (resolution?.type === 'adapt') {
    const targets = self.board.filter((minion) =>
      resolution.targetInstanceIds.includes(minion.instanceId)
    )
    return targets.reduce((total, target) => {
      const enemyMinions = opponent.board
      const enemyHeroHealth = number(opponent.hero.health) + number(opponent.hero.armor)
      const targetAttack = number(target.attack)
      const targetHealth = number(target.health)
      const largestEnemyAttack = Math.max(
        0,
        ...enemyMinions.map((minion) => number(minion.attack))
      )
      if (text.includes('windfury')) {
        return (
          total + (enemyHeroHealth <= targetAttack * 2 ? 25_000 : targetAttack * 18)
        )
      }
      if (text.includes('poisonous')) {
        return total + (enemyMinions.length > 0 ? 1_800 : -20)
      }
      if (text.includes('divine shield')) {
        const canTrade = enemyMinions.some(
          (minion) => targetAttack >= number(minion.health)
        )
        const wouldDie = largestEnemyAttack >= targetHealth
        return total + (canTrade && wouldDie ? 1_800 : 80)
      }
      if (text.includes('taunt')) {
        const visibleThreat = visibleHeroThreat(opponent, self, before.turnNumber)
        return total + (visibleThreat >= number(self.hero.health) ? 1_800 : 60)
      }
      return total
    }, 0)
  }

  if (pending.sourceCardId === 'classic_druid_of_the_claw') {
    const target = self.board.find(
      (minion) => minion.instanceId === pending.sourceCardInstanceId
    )
    if (target && text.includes('charge')) {
      return number(opponent.hero.health) <= number(target.attack) ? 25_000 : 120
    }
    if (target && text.includes('taunt')) {
      const visibleThreat = visibleHeroThreat(opponent, self, before.turnNumber)
      return visibleThreat >= number(self.hero.health) ? 3_000 : 90
    }
  }

  if (pending.sourceCardId === 'classic_nourish') {
    if (text.includes('mana')) {
      const available = number(record(self.mana).available)
      const hasNearTermPlay = self.hand.some((card) => {
        const cardDefinition = CARD_CATALOG.get(card.cardId)
        const cost = number(card.currentCost, cardDefinition?.cost ?? 99)
        return cost > available && cost <= available + 2
      })
      return hasNearTermPlay ? 600 : 40
    }
    if (text.includes('draw')) return self.deckSize >= 3 ? 20 : -120
  }

  return 0
}

function commandReason(
  action: LocalAction,
  simulation: Simulation,
  score: number,
  selfId: string
): string {
  if (simulation.winnerId === selfId) return 'This line wins the game immediately.'
  if (simulation.winnerId) return 'This line loses immediately and is rejected.'
  if (action.command.type === 'end-turn')
    return 'End the turn after preserving the best current position.'
  if (action.command.type === 'attack-character')
    return 'Take the highest value legal combat line.'
  if (action.command.type === 'play-card')
    return 'Improve board, resources, or immediate interaction.'
  if (action.command.type === 'use-hero-power')
    return 'Use the hero power when its current value exceeds saving mana.'
  if (action.command.type === 'choose-discover-card')
    return 'Choose the strongest fair visible option.'
  if (action.command.type === 'choose-card-option')
    return 'Choose the option with the best current value.'
  return `Select the highest scored legal action (${Math.round(score)}).`
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
 * Offline CPU opponent. It consumes the same fair observation boundary as the
 * remote controller and uses isolated engine forks for tactical lookahead.
 */
export class LocalAiDecisionApi implements AiDecisionApi {
  private readonly cancelled = new Set<string>()
  private lastTrace: LocalAiDecisionTrace | null = null
  private readonly profile: LocalAiSearchProfile
  private readonly limits: LocalAiSearchLimits
  private readonly budgetMs: number
  private readonly workBudget?: number
  private workUnits = 0
  private workBudgetHit = false
  private readonly preferredContinuation?: AiActionIntent
  private readonly fairHypothesis: boolean
  private readonly expertPlanSearchLimitMs: number
  private readonly expertReplanSearchLimitMs: number

  constructor(
    private readonly session: GameBoardSession,
    private readonly onTrace?: LocalAiTraceListener,
    options: LocalAiDecisionOptions = {}
  ) {
    this.profile = options.profile ?? 'easy'
    this.limits = SEARCH_LIMITS[this.profile]
    this.budgetMs = options.budgetMs ?? Number.POSITIVE_INFINITY
    if (
      options.workBudget !== undefined &&
      (!Number.isSafeInteger(options.workBudget) || options.workBudget < 1)
    )
      throw new RangeError('Local AI workBudget must be a positive safe integer.')
    this.workBudget = options.workBudget
    this.preferredContinuation = options.preferredContinuation
    this.fairHypothesis = options.fairHypothesis ?? false
    this.expertPlanSearchLimitMs =
      options.expertPlanSearchLimitMs ?? EXPERT_AI_PLAN_SEARCH_LIMIT_MS
    this.expertReplanSearchLimitMs =
      options.expertReplanSearchLimitMs ?? EXPERT_REPLAN_SEARCH_LIMIT_MS
  }

  /** Returns the last completed search for development diagnostics and scenario tests. */
  getLastTrace(): LocalAiDecisionTrace | null {
    return this.lastTrace
  }

  async settings(): Promise<AiSettings> {
    return {
      enabled: true,
      provider: 'none',
      modelId: this.profile === 'expert' ? EXPERT_MODEL_ID : EASY_MODEL_ID,
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
    const search =
      this.profile === 'expert'
        ? await this.chooseExpertMctsAction(
            actions,
            request.requestId,
            request.phase === 'plan' ? 'plan' : 'action'
          )
        : await this.chooseAction(
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
    const tree = new InformationSetMcts<TurnMatchCommand>()
    const rootChoices = new Map(
      actions.map((action) => [canonicalCommandKey(action.command), action])
    )
    const candidateCache = new Map<string, readonly MctsCandidate<TurnMatchCommand>[]>()
    const rootCandidatePriors = new Map<string, number>()
    const rootCandidateRiskAdjustments = new Map<string, number>()
    const rootCandidatePreferenceAdjustments = new Map<string, number>()
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
      performance.now() < deadline &&
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
      const selectedPath: MctsSelection<TurnMatchCommand>[] = []
      const searchedTurnLine: TurnMatchCommand[] = []
      let firstRootActionKey: string | null = null
      let rootTurnPassed = false
      let depth = 0
      let treeDepth = 0
      let rolloutDepth = 0
      let ownTurnEnds = 0
      let reward = 0
      const analysisStarted = performance.now()
      let callbackElapsedMs = 0
      simulationSession.match.analyzeWithSeed(iterationSeed, (fork) => {
        const callbackStarted = performance.now()
        const rolloutRng = createSeededRng(iterationSeed ^ 0xa511e9b3)
        let expanded = false
        while (depth < pathLimit) {
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
              prior: this.commandPrior(command, priorState, actorId)
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
                  -this.continuationPreference(candidate.action) * 0.1
                )
              }
            mctsProfile.actionPriorMs += performance.now() - priorStarted
            mctsProfile.candidateCacheMisses++
            if (candidateCache.size < MCTS_MAX_CACHED_INFORMATION_SETS)
              candidateCache.set(nodeKey, candidates)
          } else mctsProfile.candidateCacheHits++

          if (expanded) {
            const rolloutStarted = performance.now()
            const command = this.rolloutCommand(candidates, rolloutRng)
            mctsProfile.rolloutSelectionMs += performance.now() - rolloutStarted
            const dispatchStarted = performance.now()
            const result = fork.dispatch(command)
            mctsProfile.simulationDispatchMs += performance.now() - dispatchStarted
            if (!result.accepted) break
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
            candidates,
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
          reward = leafObservation
            ? MCTS_POSITION_VALUE_LIMIT *
              Math.tanh(
                this.scoreObservation(leafObservation, state.winnerId) /
                  MCTS_POSITION_VALUE_SCALE
              )
            : -MCTS_POSITION_VALUE_LIMIT
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
    const rootCandidateTacticalPenalties = new Map<string, number>()
    const rootCandidateContinuations = new Map<string, readonly TurnMatchCommand[]>()
    for (const { stat, action } of visited) {
      let continuation = sampledContinuation(sampledTurnLines.get(stat.key)) ?? [
        action.command
      ]
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
        const bestPayoff = [...payoffs].sort(
          (left, right) =>
            right.valueSum / right.visits - left.valueSum / left.visits ||
            right.commands.length - left.commands.length ||
            right.visits - left.visits
        )[0]
        if (bestPayoff) continuation = bestPayoff.commands
        else if (sampledLines.some((line) => line.penalty > 0)) {
          rootCandidateTacticalPenalties.set(
            stat.key,
            EXPERT_COIN_HERO_POWER_PENALTY
          )
          const badLine = [...sampledLines].sort(
            (left, right) =>
              right.valueSum / right.visits - left.valueSum / left.visits ||
              right.commands.length - left.commands.length
          )[0]
          if (badLine) continuation = badLine.commands
        }
      }
      rootCandidateContinuations.set(stat.key, continuation)
    }
    const selected = [...visited].sort(
      (left, right) =>
        mctsRootRecommendationScore(right.stat) +
          Math.max(-8, Math.min(24, rootCandidatePriors.get(right.stat.key) ?? 0)) *
            0.005 -
          (rootCandidatePreferenceAdjustments.get(right.stat.key) ?? 0) -
          (rootCandidateRiskAdjustments.get(right.stat.key) ?? 0) -
          (rootCandidateTacticalPenalties.get(right.stat.key) ?? 0) -
          (mctsRootRecommendationScore(left.stat) +
            Math.max(-8, Math.min(24, rootCandidatePriors.get(left.stat.key) ?? 0)) *
              0.005 -
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
          right.stat.visits - left.stat.visits ||
          right.stat.meanValue - left.stat.meanValue
      )
      .slice(0, this.limits.traceCandidateLimit)
      .map(({ stat, action }) => ({
        ...(() => {
          const selectedLine = rootCandidateContinuations.get(stat.key) ??
            sampledContinuation(sampledTurnLines.get(stat.key)) ?? [action.command]
          return {
            sequenceIntents: selectedLine.map((command) =>
              aiActionIntent(command, this.session.localParticipantId)
            )
          }
        })(),
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
        visits: stat.visits,
        meanValue: stat.meanValue,
        prior: rootCandidatePriors.get(stat.key),
        recommendationRiskAdjustment: rootCandidateRiskAdjustments.get(stat.key),
        recommendationPreferenceAdjustment: rootCandidatePreferenceAdjustments.get(
          stat.key
        ),
        recommendationTacticalPenalty: rootCandidateTacticalPenalties.get(stat.key)
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
      requestId,
      phase,
      durationMs,
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
    const continuationPreference = this.continuationPreference(command) * 2
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
              number(card?.currentCost, definition.cost)
            )
          : 0) +
        (player && definition ? cthunBuffPrior(definition.effects, player) : 0) +
        (player && definition && card
          ? conditionalMinionPayoffPrior(
              definition.effects,
              player,
              card.instanceId,
              number(card.currentCost, definition.cost)
            )
          : 0) +
        (player && opponent && definition?.type === 'Minion' && card
          ? deathrattleSetupPrior(
              definition.effects,
              number(definition.health),
              player,
              opponent,
              number(card.currentCost, definition.cost),
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
      const basePrior = 2.5 + replayPenalty + continuationPreference
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
    return this.profile === 'expert' &&
      this.preferredContinuation &&
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
    const opponentHealth = opponent
      ? number(record(opponent.hero).health) + number(record(opponent.hero).armor)
      : Number.POSITIVE_INFINITY
    if (!player || !opponent || !current || !currentDefinition) return 0

    let availableMana = number(record(player.mana).available)
    availableMana -= number(current.currentCost, currentDefinition.cost)
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
      !command.targets?.some(
        (target) =>
          target.kind === 'hero' && target.participantId === opponent.participantId
      ) ||
      !hasUnrevealedSecret ||
      this.lethalBurstPrior(command, state, actorId) <= 0
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

  private async chooseAction(
    actions: readonly LocalAction[],
    requestId: string,
    phase: 'plan' | 'action'
  ): Promise<{ best: ScoredAction; trace: LocalAiDecisionTrace } | null> {
    this.workUnits = 0
    this.workBudgetHit = false
    const started = performance.now()
    const deadline =
      this.workBudget === undefined
        ? started +
          Math.min(this.limits.maxThinkMs, this.limits.sequenceThinkMs, this.budgetMs)
        : Number.POSITIVE_INFINITY
    const current = this.session.getAiObservation()
    const baseScore = stateScore(
      current,
      this.session.remoteParticipantId,
      this.profile
    )
    const currentSelf = current.players.find(
      (player) => player.participantId === this.session.remoteParticipantId
    )
    const currentOpponent = current.players.find(
      (player) => player.participantId !== this.session.remoteParticipantId
    )
    const threat =
      currentOpponent && currentSelf
        ? visibleHeroThreat(currentOpponent, currentSelf, current.turnNumber)
        : 0
    const currentHero = record(currentSelf?.hero)
    const currentHealth = number(currentHero.health) + number(currentHero.armor)
    const scored: ScoredAction[] = []
    const preferredActionId =
      this.profile === 'expert' && this.preferredContinuation
        ? actions.find((action) =>
            sameAiIntent(
              this.preferredContinuation!,
              aiActionIntent(action.command, this.session.localParticipantId)
            )
          )?.id
        : undefined
    const rootEvaluationStarted = performance.now()

    for (const [index, action] of actions.entries()) {
      if (performance.now() >= deadline || !this.tryUseWorkUnit()) break
      if (index > 0 && index % 8 === 0) {
        await yieldToRenderer()
        if (this.cancelled.has(requestId)) return null
      }
      let simulation: Simulation
      try {
        if (this.isBeneficialHeroPowerAgainstOpponent(action.command, current)) continue
        simulation = this.simulate(action.command)
      } catch {
        // A single unsupported/complex effect must not abandon the whole turn.
        continue
      }
      if (!simulation.accepted || !simulation.observation) continue

      const rootPreference = this.commandScore(
        action.command,
        currentSelf,
        simulation.observation,
        current
      )
      const positionDelta =
        (simulation.score ??
          this.scoreObservation(simulation.observation, simulation.winnerId)) -
        baseScore
      let score = positionDelta
      score += rootPreference
      const continuationPreference =
        action.id === preferredActionId
          ? LOCAL_AI_POLICY.weights.expertContinuationPreference
          : 0
      score += continuationPreference
      const afterSelf = simulation.observation.players.find(
        (player) => player.participantId === this.session.remoteParticipantId
      )
      const afterHero = record(afterSelf?.hero)
      const afterHealth = number(afterHero.health) + number(afterHero.armor)
      const afterOpponent = simulation.observation.players.find(
        (player) => player.participantId !== this.session.remoteParticipantId
      )
      const threatAfter =
        afterOpponent && afterSelf
          ? visibleHeroThreat(
              afterOpponent,
              afterSelf,
              simulation.observation!.turnNumber
            )
          : 0
      let threatDefense = 0
      if (threat >= currentHealth && threatAfter < threat) {
        const improvement =
          (threat - threatAfter) * LOCAL_AI_POLICY.weights.preventVisibleLethal
        score += improvement
        threatDefense += improvement
      }
      if (threat >= currentHealth && afterHealth > currentHealth) {
        score += LOCAL_AI_POLICY.weights.preventVisibleLethal
        threatDefense += LOCAL_AI_POLICY.weights.preventVisibleLethal
      }
      if (threat >= currentHealth && afterHealth <= currentHealth - 4) {
        score -= LOCAL_AI_POLICY.weights.preventVisibleLethal
        threatDefense -= LOCAL_AI_POLICY.weights.preventVisibleLethal
      }
      const currentOpponentBoard = currentOpponent?.board.length ?? 0
      const afterOpponentBoard = afterOpponent?.board.length ?? 0
      const currentSelfBoard = currentSelf?.board.length ?? 0
      const afterSelfBoard = afterSelf?.board.length ?? 0
      const opponentBoardRemoval =
        Math.max(0, currentOpponentBoard - afterOpponentBoard) *
        LOCAL_AI_POLICY.weights.enemyBoardRemoval
      score += opponentBoardRemoval
      const friendlyBoardLoss =
        Math.max(0, currentSelfBoard - afterSelfBoard) *
        LOCAL_AI_POLICY.weights.friendlyMinionLoss
      score += friendlyBoardLoss

      scored.push({
        action,
        score,
        reason: commandReason(
          action,
          simulation,
          score,
          this.session.remoteParticipantId
        ),
        simulation,
        rootPreference,
        scoreComponents: {
          positionDelta,
          commandPreference: rootPreference,
          continuationPreference,
          threatDefense,
          opponentBoardRemoval,
          friendlyBoardLoss,
          sequenceRefinement: 0
        },
        sequence: [action.command],
        sequenceLabels: [action.description]
      })
    }
    const rootEvaluationMs = performance.now() - rootEvaluationStarted
    if (!scored.length) return null

    scored.sort((left, right) => right.score - left.score)
    const sequenceCandidates = scored.slice(0, this.limits.rootSearchLimit)
    const passCandidate = scored.find(
      (candidate) => candidate.action.command.type === 'end-turn'
    )
    if (passCandidate && !sequenceCandidates.includes(passCandidate))
      sequenceCandidates.push(passCandidate)
    const sequenceSearchStarted = performance.now()
    const sequenceSearch = await this.searchSequences(
      sequenceCandidates,
      baseScore,
      deadline,
      requestId
    )
    const sequenceSearchMs = performance.now() - sequenceSearchStarted
    const sequenceStats = sequenceSearch.candidates
    for (const candidate of sequenceCandidates) {
      const result = sequenceStats.get(candidate.action.id)
      if (!result) continue
      const rootScore = candidate.score
      const commandPreference = candidate.rootPreference ?? 0
      const refinedScore =
        result.score +
        (this.profile === 'expert'
          ? commandPreference * EXPERT_ROOT_COMMAND_PREFERENCE_SCALE
          : commandPreference) +
        candidate.scoreComponents.continuationPreference +
        candidate.scoreComponents.threatDefense +
        candidate.scoreComponents.opponentBoardRemoval +
        candidate.scoreComponents.friendlyBoardLoss
      // V1 retains its original root-score floor. Expert instead backs up the
      // completed line so a strong-looking first move can be penalized after a
      // public opponent reply; preserve its explicit tactical root signals.
      candidate.score =
        this.profile === 'expert'
          ? refinedScore
          : Math.max(candidate.score, result.score + (candidate.rootPreference ?? 0))
      candidate.scoreComponents = {
        ...candidate.scoreComponents,
        sequenceRefinement: candidate.score - rootScore
      }
      candidate.sequence = result.sequence
      candidate.sequenceLabels = result.labels
      candidate.sequenceNodes = result.nodes
      candidate.sequenceResponseScore = result.responseScore
    }
    scored.sort((left, right) => right.score - left.score)
    const best = scored[0]
    if (!best) return null
    const trace: LocalAiDecisionTrace = {
      requestId,
      phase,
      durationMs: performance.now() - started,
      evaluatedActions: scored.length,
      refinedActions: sequenceCandidates.length,
      continuations: sequenceStats.size,
      timedOut: performance.now() >= deadline,
      baseScore,
      visibleThreat: threat,
      chosenActionId: best.action.id,
      chosenSequence: best.sequenceLabels,
      chosenSequenceDepth: best.sequence?.length,
      rootEvaluationMs,
      sequenceSearchMs,
      responseSearchMs: sequenceSearch.responseSearchMs,
      sequenceNodes: best.sequenceNodes,
      responseNodes: sequenceSearch.responseNodes,
      responseCardPlayNodes: sequenceSearch.responseCardPlayNodes,
      responseScore: best.sequenceResponseScore ?? null,
      responseCandidateAnalysisMs: sequenceSearch.responseCandidateAnalysisMs,
      responseCandidateDispatchMs: sequenceSearch.responseCandidateDispatchMs,
      responseCandidateObservationMs: sequenceSearch.responseCandidateObservationMs,
      responseCandidateScoringMs: sequenceSearch.responseCandidateScoringMs,
      responseActionGenerationMs: sequenceSearch.responseActionGenerationMs,
      responseReplayMs: sequenceSearch.responseReplayMs,
      sampleCount: best.simulation.sampleCount,
      sampleWinRate: best.simulation.sampleWinRate,
      workUnits: this.workUnits,
      ...(this.workBudgetHit ? { workBudgetHit: true } : {}),
      candidates: scored.slice(0, this.limits.traceCandidateLimit).map((candidate) => ({
        actionId: candidate.action.id,
        type: candidate.action.command.type,
        description: candidate.action.description.slice(0, 180),
        score: Math.round(candidate.score * 100) / 100,
        scoreComponents: candidate.scoreComponents,
        accepted: candidate.simulation.accepted,
        phase: candidate.simulation.phase ?? null,
        winnerId: candidate.simulation.winnerId ?? null,
        ...(candidate.sequenceLabels ? { sequence: candidate.sequenceLabels } : {}),
        ...(this.profile === 'expert' && candidate.sequence
          ? {
              sequenceIntents: candidate.sequence
                .slice(0, 6)
                .map((command) =>
                  aiActionIntent(command, this.session.localParticipantId)
                )
            }
          : {})
      }))
    }
    this.publishTrace(trace)
    return { best, trace }
  }

  private scoreObservation(
    observation: AiObservation,
    winnerId: TurnMatchState['winnerId'] | undefined
  ): number {
    const score = stateScore(
      observation,
      this.session.remoteParticipantId,
      this.profile
    )
    if (this.profile === 'expert') {
      // Terminal results are fixed values in Expert. Keeping the positional
      // score here let an immediate loss look better after dealing damage,
      // even when the alternative was only a predicted loss next turn.
      if (winnerId === this.session.remoteParticipantId)
        return (
          LOCAL_AI_POLICY.weights.terminalWin + LOCAL_AI_POLICY.weights.immediateLethal
        )
      if (winnerId) return LOCAL_AI_POLICY.weights.terminalLoss
      return score
    }
    if (winnerId === this.session.remoteParticipantId)
      return (
        score +
        LOCAL_AI_POLICY.weights.terminalWin +
        LOCAL_AI_POLICY.weights.immediateLethal
      )
    if (winnerId) return score + LOCAL_AI_POLICY.weights.terminalLoss
    return score
  }

  private async searchSequences(
    roots: readonly ScoredAction[],
    baseScore: number,
    deadline: number,
    requestId: string
  ): Promise<SequenceSearchSummary> {
    const results = new Map<string, SequenceSearchResult>()
    let nodes = 0
    let rootNodes = 0
    let responseNodes = 0
    let responseCardPlayNodes = 0
    let responseSearchMs = 0
    let responseCandidateAnalysisMs = 0
    let responseCandidateDispatchMs = 0
    let responseCandidateObservationMs = 0
    let responseCandidateScoringMs = 0
    let responseActionGenerationMs = 0
    let responseReplayMs = 0
    const selfId = this.session.remoteParticipantId

    const update = (
      root: ScoredAction,
      sequence: readonly TurnMatchCommand[],
      labels: readonly string[],
      fork: OpeningMatchAnalysis,
      response: VisibleResponseScore | null
    ): void => {
      const state = fork.getState()
      const observation = fork.getAiObservation?.(selfId, 'fair')
      if (!observation) return
      const ownScore = this.scoreObservation(observation, state.winnerId)
      const responseScore = response?.score ?? null
      let score = (responseScore === null ? ownScore : responseScore) - baseScore
      if (state.winnerId === selfId)
        score += Math.max(0, this.limits.sequenceMaxDepth - sequence.length) * 20_000
      const previous = results.get(root.action.id)
      if (!previous || score > previous.score)
        results.set(root.action.id, {
          score,
          sequence,
          labels,
          nodes,
          responseScore
        })
    }

    const visit = (
      root: ScoredAction,
      fork: OpeningMatchAnalysis,
      sequence: readonly TurnMatchCommand[],
      labels: readonly string[],
      depth: number
    ): void => {
      if (
        nodes >= this.limits.sequenceNodeLimit ||
        rootNodes >= this.limits.sequenceRootNodeLimit ||
        performance.now() >= deadline ||
        this.cancelled.has(requestId) ||
        !this.tryUseWorkUnit()
      )
        return
      nodes++
      rootNodes++
      const state = fork.getState()
      const observation = fork.getAiObservation?.(selfId, 'fair')
      if (!observation) return
      const last = sequence[sequence.length - 1]
      const shouldStop =
        state.phase === 'ended' ||
        state.activePlayerId !== selfId ||
        last?.type === 'end-turn' ||
        depth >= this.limits.sequenceMaxDepth
      if (shouldStop) {
        let response: VisibleResponseScore | null = null
        if (state.phase === 'turns' && state.activePlayerId !== selfId) {
          const responseStarted = performance.now()
          response = this.scoreVisibleOpponentResponse(fork, observation, deadline)
          responseSearchMs += performance.now() - responseStarted
        }
        responseNodes += response?.nodes ?? 0
        responseCardPlayNodes += response?.cardPlayNodes ?? 0
        if (response) {
          responseCandidateAnalysisMs += response.candidateAnalysisMs
          responseCandidateDispatchMs += response.candidateDispatchMs
          responseCandidateObservationMs += response.candidateObservationMs
          responseCandidateScoringMs += response.candidateScoringMs
          responseActionGenerationMs += response.actionGenerationMs
          responseReplayMs += response.replayMs
        }
        update(root, sequence, labels, fork, response)
        return
      }

      const commands = enumerateLegalCommands(fork, selfId)
      if (!commands.length) {
        update(root, sequence, labels, fork, null)
        return
      }
      const orderedAll = this.orderSequenceCommands(commands, fork)
      const ordered = orderedAll.slice(0, this.limits.sequenceBranchLimit)
      const pass = orderedAll.find((command) => command.type === 'end-turn')
      if (pass && !ordered.includes(pass)) ordered.push(pass)
      for (const command of ordered) {
        if (
          nodes >= this.limits.sequenceNodeLimit ||
          performance.now() >= deadline ||
          !this.hasWorkRemaining()
        )
          break
        const label = this.commandLabel(fork, command)
        fork.analyze((child) => {
          const result = child.dispatch(command)
          if (!result.accepted) return
          visit(root, child, [...sequence, command], [...labels, label], depth + 1)
        })
      }
    }

    for (const root of roots) {
      if (
        nodes >= this.limits.sequenceNodeLimit ||
        performance.now() >= deadline ||
        this.cancelled.has(requestId) ||
        !this.hasWorkRemaining()
      )
        break
      try {
        rootNodes = 0
        this.session.match.analyze((fork) => {
          fork.analyze((child) => {
            const result = child.dispatch(root.action.command)
            if (!result.accepted) return
            visit(root, child, [root.action.command], [root.action.description], 1)
          })
        })
      } catch {
        // A complex effect may fail in analysis; the root action remains usable.
      }
      await yieldToRenderer()
    }

    return {
      candidates: results,
      responseNodes,
      responseCardPlayNodes,
      responseSearchMs,
      responseCandidateAnalysisMs,
      responseCandidateDispatchMs,
      responseCandidateObservationMs,
      responseCandidateScoringMs,
      responseActionGenerationMs,
      responseReplayMs
    }
  }

  private isBeneficialHeroPowerAgainstOpponent(
    command: TurnMatchCommand,
    observation: AiObservation
  ): boolean {
    if (command.type !== 'use-hero-power' || !command.target) return false
    const self = observation.players.find(
      (player) => player.participantId === this.session.remoteParticipantId
    )
    const power = self ? HERO_POWER_CATALOG.get(self.heroPower.id) : undefined
    return (
      power?.effect.kind === 'restore-character' &&
      command.target.participantId !== this.session.remoteParticipantId
    )
  }

  private hasFairOpponentHypothesis(
    fork: OpeningMatchAnalysis,
    opponentId: AiObservedPlayer['participantId']
  ): boolean {
    if (!this.fairHypothesis) return false
    const opponent = fork
      .getState()
      .players.find((player) => player.participantId === opponentId)
    if (!opponent) return false
    return [...opponent.hand, ...opponent.deck].every(
      (card) =>
        card.knownTo?.includes(this.session.remoteParticipantId) === true ||
        card.instanceId.startsWith(EXPERT_FAIR_HYPOTHESIS_PREFIX)
    )
  }

  private orderExpertResponseCommands(
    commands: readonly TurnMatchCommand[],
    fork: OpeningMatchAnalysis,
    opponentId: AiObservedPlayer['participantId']
  ): readonly TurnMatchCommand[] {
    const state = fork.getState()
    const opponent = state.players.find((player) => player.participantId === opponentId)
    const priority = (command: TurnMatchCommand): number => {
      if (
        command.type === 'choose-discover-card' ||
        command.type === 'choose-card-option'
      )
        return 2_000
      if (command.type === 'play-card') {
        const card = opponent?.hand.find(
          (entry) => entry.instanceId === command.cardInstanceId
        )
        const definition = card ? CARD_CATALOG.get(card.cardId) : undefined
        return 1_000 + (definition ? cardScore(definition.id) : 0)
      }
      if (command.type === 'use-hero-power') return 850
      if (command.type === 'attack-character')
        return command.defender.kind === 'hero' ? 800 : 750
      if (command.type === 'end-turn') return -1_000
      return 0
    }
    const group = (command: TurnMatchCommand): string => {
      if (command.type === 'play-card') return `play:${command.cardInstanceId}`
      if (command.type === 'attack-character')
        return command.attacker.kind === 'hero'
          ? `attack:${opponentId}:hero`
          : `attack:${command.attacker.instanceId}`
      if (command.type === 'use-hero-power') return 'hero-power'
      if (command.type === 'choose-discover-card') return 'discover'
      if (command.type === 'choose-card-option')
        return `choice:${command.sourceCardInstanceId}`
      return command.type
    }
    const groupLimit = (command: TurnMatchCommand): number => {
      if (command.type === 'play-card') return 2
      if (command.type === 'attack-character') return 4
      if (command.type === 'use-hero-power') return 4
      if (command.type === 'choose-discover-card') return 8
      if (command.type === 'choose-card-option') return 8
      return 1
    }
    const ordered = [...commands].sort(
      (left, right) =>
        priority(right) - priority(left) ||
        canonicalCommandKey(left).localeCompare(canonicalCommandKey(right))
    )
    const selected: TurnMatchCommand[] = []
    const counts = new Map<string, number>()
    for (const command of ordered) {
      const key = group(command)
      const count = counts.get(key) ?? 0
      if (count >= groupLimit(command)) continue
      selected.push(command)
      counts.set(key, count + 1)
      if (selected.length >= EXPERT_REPLY_NODE_LIMIT) break
    }
    return selected
  }

  private expertResponseCommands(
    fork: OpeningMatchAnalysis,
    observation: AiObservation,
    opponentId: AiObservedPlayer['participantId'],
    sampledHandAvailable: boolean
  ): readonly TurnMatchCommand[] {
    if (sampledHandAvailable)
      return this.orderExpertResponseCommands(
        enumerateLegalCommands(fork, opponentId),
        fork,
        opponentId
      )
    return [
      ...visibleOpponentAttackCommands(fork, observation),
      ...visibleOpponentHeroPowerCommands(fork, observation)
    ]
  }

  private orderSequenceCommands(
    commands: readonly TurnMatchCommand[],
    fork: OpeningMatchAnalysis
  ): readonly TurnMatchCommand[] {
    return [...commands].sort((left, right) => {
      const priority = (command: TurnMatchCommand): number => {
        if (command.type === 'end-turn') return -100
        if (command.type === 'attack-character')
          return command.defender.kind === 'hero' ? 40 : 32
        if (command.type === 'play-card') {
          const cardId = this.cardIdForCommand(command, fork.getState())
          const definition = CARD_CATALOG.get(cardId)
          const position = command.position ?? 0
          const boardLength =
            fork
              .getState()
              .players.find(
                (player) => player.participantId === this.session.remoteParticipantId
              )?.board.length ?? 0
          const adjacentNeighbors =
            command.position !== undefined &&
            definition &&
            containsAdjacentMechanic(definition.effects)
              ? Math.min(command.position, boardLength - command.position)
              : 0
          return (
            60 +
            (definition ? cardScore(definition.id) : 0) +
            (definition
              ? conditionalBoardBias(
                  definition.id,
                  fork.getState(),
                  this.session.remoteParticipantId
                )
              : 0) +
            adjacentNeighbors * 12 +
            (position === 0 ? 0.01 : 0)
          )
        }
        if (command.type === 'use-hero-power') return 28
        return 8
      }
      return (
        priority(right) - priority(left) ||
        canonicalCommandKey(left).localeCompare(canonicalCommandKey(right))
      )
    })
  }

  private scoreVisibleOpponentResponse(
    fork: OpeningMatchAnalysis,
    observation: AiObservation,
    deadline: number
  ): VisibleResponseScore {
    const commandGenerationStarted = performance.now()
    const attacks =
      this.profile === 'expert'
        ? visibleOpponentAttackCommands(fork, observation)
        : easyOpponentAttackCommands(observation, this.session.remoteParticipantId)
    const heroPowers =
      this.profile === 'expert'
        ? visibleOpponentHeroPowerCommands(fork, observation)
        : []
    const opponent = observation.players.find((player) => player.role === 'opponent')
    const sampledHandAvailable =
      this.profile === 'expert' &&
      opponent !== undefined &&
      this.hasFairOpponentHypothesis(fork, opponent.participantId)
    const responses =
      this.profile === 'expert' && sampledHandAvailable && opponent
        ? this.expertResponseCommands(fork, observation, opponent.participantId, true)
        : [...attacks, ...heroPowers]
    const commandGenerationMs = performance.now() - commandGenerationStarted
    let candidateScoringMs = 0
    if (!responses.length)
      return {
        score: null,
        nodes: 0,
        cardPlayNodes: 0,
        candidateAnalysisMs: 0,
        candidateDispatchMs: 0,
        candidateObservationMs: 0,
        candidateScoringMs: 0,
        actionGenerationMs: commandGenerationMs,
        replayMs: 0
      }

    if (this.profile === 'expert') {
      const defender = observation.players.find(
        (player) => player.participantId === this.session.remoteParticipantId
      )
      const hasTaunt = defender?.board.some((minion) =>
        effectiveBoardMinionKeywords(minion, observation.turnNumber).includes('taunt')
      )
      if (!hasTaunt) {
        const scoringStarted = performance.now()
        const lethalScore = this.projectedPublicAttackLethalScore(fork, observation)
        candidateScoringMs += performance.now() - scoringStarted
        if (lethalScore !== null)
          return {
            score: lethalScore,
            nodes: 0,
            cardPlayNodes: 0,
            candidateAnalysisMs: 0,
            candidateDispatchMs: 0,
            candidateObservationMs: 0,
            candidateScoringMs,
            actionGenerationMs: commandGenerationMs,
            replayMs: 0
          }
      }

      const response = this.scoreExpertPublicResponse(
        fork,
        observation,
        deadline,
        responses,
        sampledHandAvailable
      )
      return {
        ...response,
        actionGenerationMs: response.actionGenerationMs + commandGenerationMs
      }
    }

    let worst = Number.POSITIVE_INFINITY
    let nodes = 0
    let cardPlayNodes = 0
    let candidateAnalysisMs = 0
    let candidateDispatchMs = 0
    let candidateObservationMs = 0
    for (const response of responses) {
      if (performance.now() >= deadline || !this.tryUseWorkUnit()) break
      nodes++
      if (response.type === 'play-card') cardPlayNodes++
      const candidateStarted = performance.now()
      const score = fork.analyze((child) => {
        const dispatchStarted = performance.now()
        const result = child.dispatch(response)
        candidateDispatchMs += performance.now() - dispatchStarted
        if (!result.accepted) return null
        const observationStarted = performance.now()
        const after = child.getAiObservation?.(this.session.remoteParticipantId, 'fair')
        candidateObservationMs += performance.now() - observationStarted
        if (!after) return null
        const scoringStarted = performance.now()
        const score = this.scoreObservation(after, result.state.winnerId)
        candidateScoringMs += performance.now() - scoringStarted
        return score
      })
      candidateAnalysisMs += performance.now() - candidateStarted
      if (score !== null) worst = Math.min(worst, score)
    }
    return {
      score: Number.isFinite(worst) ? worst : null,
      nodes,
      cardPlayNodes,
      candidateAnalysisMs,
      candidateDispatchMs,
      candidateObservationMs,
      candidateScoringMs,
      actionGenerationMs: commandGenerationMs,
      replayMs: 0
    }
  }

  private projectedPublicAttackLethalScore(
    fork: OpeningMatchAnalysis,
    observation: AiObservation
  ): number | null {
    const attacks = visibleOpponentAttackCommands(fork, observation)
    const faceAttacks = attacks.filter(
      (response): response is Extract<TurnMatchCommand, { type: 'attack-character' }> =>
        response.type === 'attack-character' && response.defender.kind === 'hero'
    )
    if (!faceAttacks.length) return null
    const attacker = observation.players.find((player) => player.role === 'opponent')
    const defender = observation.players.find(
      (player) => player.participantId === this.session.remoteParticipantId
    )
    if (!attacker || !defender) return null
    const heroHealth =
      number(record(defender.hero).health) + number(record(defender.hero).armor)
    const publicThreat = faceAttacks.reduce(
      (total, response) =>
        total + remainingPublicAttackDamage(attacker, response, observation.turnNumber),
      0
    )
    if (heroHealth <= 0 || publicThreat < heroHealth) return null
    // This is a forecast, not an already-terminal result. Keep it slightly
    // above the fixed terminal-loss floor so Expert won't choose an immediate
    // loss just to improve the board before the opposing turn.
    return (
      LOCAL_AI_POLICY.weights.terminalLoss +
      LOCAL_AI_POLICY.weights.preventVisibleLethal
    )
  }

  private scoreExpertPublicResponse(
    fork: OpeningMatchAnalysis,
    observation: AiObservation,
    deadline: number,
    initialResponses: readonly TurnMatchCommand[],
    sampledHandAvailable: boolean
  ): VisibleResponseScore {
    let nodes = 0
    let cardPlayNodes = 0
    let candidateAnalysisMs = 0
    let candidateDispatchMs = 0
    let candidateObservationMs = 0
    let candidateScoringMs = 0
    let actionGenerationMs = 0
    let replayMs = 0
    const score = fork.analyze((replyFork) => {
      const originalAttacker = observation.players.find(
        (player) => player.role === 'opponent'
      )
      if (!originalAttacker) {
        const scoringStarted = performance.now()
        const score = this.scoreObservation(observation, undefined)
        candidateScoringMs += performance.now() - scoringStarted
        return score
      }

      let currentObservation = observation
      const initialScoringStarted = performance.now()
      let currentScore = this.scoreObservation(currentObservation, undefined)
      candidateScoringMs += performance.now() - initialScoringStarted
      for (
        let actionCount = 0;
        actionCount < EXPERT_REPLY_ACTION_LIMIT &&
        performance.now() < deadline &&
        this.hasWorkRemaining();
        actionCount++
      ) {
        let responses = initialResponses
        if (actionCount > 0) {
          const commandGenerationStarted = performance.now()
          responses = this.expertResponseCommands(
            replyFork,
            currentObservation,
            originalAttacker.participantId,
            sampledHandAvailable
          )
          actionGenerationMs += performance.now() - commandGenerationStarted
        }
        if (!responses.length) break

        let worstScore = Number.POSITIVE_INFINITY
        let worstResponse: TurnMatchCommand | null = null
        for (const response of responses) {
          if (
            nodes >= EXPERT_REPLY_NODE_LIMIT ||
            performance.now() >= deadline ||
            !this.tryUseWorkUnit()
          )
            break
          nodes++
          if (response.type === 'play-card') cardPlayNodes++
          const candidateStarted = performance.now()
          const candidateScore = replyFork.analyze((candidateFork) => {
            const dispatchStarted = performance.now()
            const result = candidateFork.dispatch(response)
            candidateDispatchMs += performance.now() - dispatchStarted
            if (!result.accepted) return null
            const observationStarted = performance.now()
            const after = candidateFork.getAiObservation?.(
              this.session.remoteParticipantId,
              'fair'
            )
            candidateObservationMs += performance.now() - observationStarted
            if (!after) return null
            const scoringStarted = performance.now()
            const score =
              this.projectedPublicAttackLethalScore(candidateFork, after) ??
              this.scoreObservation(after, result.state.winnerId)
            candidateScoringMs += performance.now() - scoringStarted
            return score
          })
          candidateAnalysisMs += performance.now() - candidateStarted
          if (candidateScore !== null && candidateScore < worstScore) {
            worstScore = candidateScore
            worstResponse = response
          }
        }
        if (!worstResponse) break

        const replayStarted = performance.now()
        const result = replyFork.dispatch(worstResponse)
        if (!result.accepted) {
          replayMs += performance.now() - replayStarted
          break
        }
        const after = replyFork.getAiObservation?.(
          this.session.remoteParticipantId,
          'fair'
        )
        if (!after) {
          replayMs += performance.now() - replayStarted
          break
        }
        currentObservation = after
        const lethalScore = this.projectedPublicAttackLethalScore(replyFork, after)
        currentScore =
          lethalScore ?? this.scoreObservation(after, result.state.winnerId)
        replayMs += performance.now() - replayStarted
        if (lethalScore !== null) return currentScore
        if (
          result.state.phase === 'ended' ||
          result.state.activePlayerId !== originalAttacker.participantId
        )
          return currentScore
      }
      return currentScore
    })
    return {
      score,
      nodes,
      cardPlayNodes,
      candidateAnalysisMs,
      candidateDispatchMs,
      candidateObservationMs,
      candidateScoringMs,
      actionGenerationMs,
      replayMs
    }
  }

  private simulate(command: TurnMatchCommand): Simulation {
    const cardId = this.cardIdForCommand(command, this.session.getState())
    if (cardId && hasRandomText(cardId)) return this.simulateRandom(command)
    return this.session.match.analyze((fork) => {
      const result = fork.dispatch(command)
      if (!result.accepted) return { accepted: false }
      const observation = fork.getAiObservation?.(
        this.session.remoteParticipantId,
        'fair'
      )
      return {
        accepted: true,
        observation,
        phase: result.state.phase,
        winnerId: result.state.winnerId,
        score: observation
          ? this.scoreObservation(observation, result.state.winnerId)
          : undefined,
        sampleCount: 1,
        sampleWinRate:
          result.state.winnerId === this.session.remoteParticipantId ? 1 : 0
      }
    })
  }

  private simulateRandom(command: TurnMatchCommand): Simulation {
    const samples: {
      observation: AiObservation
      winnerId: TurnMatchState['winnerId']
    }[] = []
    for (const seed of this.limits.randomSampleSeeds) {
      const sample = this.session.match.analyzeWithSeed(seed, (fork) => {
        const result = fork.dispatch(command)
        if (!result.accepted) return null
        const observation = fork.getAiObservation?.(
          this.session.remoteParticipantId,
          'fair'
        )
        return observation ? { observation, winnerId: result.state.winnerId } : null
      })
      if (sample) samples.push(sample)
    }
    if (!samples.length) return { accepted: false }
    const scores = samples.map((sample) =>
      this.scoreObservation(sample.observation, sample.winnerId)
    )
    const wins = samples.filter(
      (sample) => sample.winnerId === this.session.remoteParticipantId
    ).length
    return {
      accepted: true,
      observation: samples[0]!.observation,
      phase: samples[0]!.observation.phase,
      winnerId: wins === samples.length ? this.session.remoteParticipantId : undefined,
      score: scores.reduce((total, score) => total + score, 0) / scores.length,
      sampleCount: samples.length,
      sampleWinRate: wins / samples.length
    }
  }

  private cardIdForCommand(
    command: TurnMatchCommand,
    state = this.session.getState()
  ): string {
    if (command.type === 'play-card') {
      const card = this.session
        .findPlayer(state, this.session.remoteParticipantId)
        .hand.find((entry) => entry.instanceId === command.cardInstanceId)
      return card?.cardId ?? ''
    }
    return ''
  }

  private commandLabel(fork: OpeningMatchAnalysis, command: TurnMatchCommand): string {
    if (command.type === 'play-card') {
      const cardId = this.cardIdForCommand(command, fork.getState())
      const name = CARD_CATALOG.get(cardId)?.name ?? cardId
      const position =
        command.position === undefined ? '' : ` at slot ${command.position}`
      return `play ${name}${position}`
    }
    if (command.type === 'attack-character') {
      const attacker =
        command.attacker.kind === 'hero' ? 'hero' : command.attacker.instanceId
      const defender =
        command.defender.kind === 'hero' ? 'enemy hero' : command.defender.instanceId
      return `attack ${defender} with ${attacker}`
    }
    if (command.type === 'use-hero-power') return 'use hero power'
    if (command.type === 'choose-discover-card')
      return `choose discover ${command.cardInstanceId}`
    if (command.type === 'choose-card-option') return `choose option ${command.choice}`
    return command.type
  }

  private commandScore(
    command: TurnMatchCommand,
    self: AiObservedPlayer | undefined,
    after: AiObservation,
    before: AiObservation
  ): number {
    if (!self) return 0
    const beforeMana = number(record(self.mana).available)
    const afterSelf = after.players.find(
      (entry) => entry.participantId === this.session.remoteParticipantId
    )
    const afterMana = number(record(afterSelf?.mana).available)
    const spentMana = Math.max(0, beforeMana - afterMana)
    const score = spentMana * LOCAL_AI_POLICY.weights.spentMana
    if (command.type === 'end-turn') return score
    if (command.type === 'attack-character' && command.defender.kind === 'minion') {
      const beforeOpponent = before.players.find(
        (entry) => entry.participantId !== this.session.remoteParticipantId
      )
      const beforeSelf = before.players.find(
        (entry) => entry.participantId === this.session.remoteParticipantId
      )
      const afterSelf = after.players.find(
        (entry) => entry.participantId === this.session.remoteParticipantId
      )
      const afterOpponent = after.players.find(
        (entry) => entry.participantId !== this.session.remoteParticipantId
      )
      const beforeTarget = beforeOpponent?.board.find(
        (entry) =>
          command.defender.kind === 'minion' &&
          entry.instanceId === command.defender.instanceId
      )
      const afterTarget = afterOpponent?.board.find(
        (entry) =>
          command.defender.kind === 'minion' &&
          entry.instanceId === command.defender.instanceId
      )
      const targetDamage = Math.max(
        0,
        number(beforeTarget?.health) - number(afterTarget?.health)
      )
      const losesFriendlyMinion =
        (afterSelf?.board.length ?? 0) < (beforeSelf?.board.length ?? 0)
      const attacker = beforeSelf?.board.find(
        (entry) =>
          command.attacker.kind === 'minion' &&
          entry.instanceId === command.attacker.instanceId
      )
      const attackerIsPoisonous =
        attacker !== undefined &&
        effectiveBoardMinionKeywords(attacker, before.turnNumber).includes('poisonous')
      const removesEnemyMinion =
        (afterOpponent?.board.length ?? 0) < (beforeOpponent?.board.length ?? 0)
      const attackerDefinition = attacker
        ? CARD_CATALOG.get(attacker.cardId)
        : undefined
      const hasFriendlyBeastDeathPayoff =
        beforeSelf?.board.some((entry) => {
          if (entry.instanceId === attacker?.instanceId) return false
          const definition = CARD_CATALOG.get(entry.cardId)
          const rulesText = definition?.rulesText.toLowerCase() ?? ''
          return (
            cardHasTribe(definition, 'Beast') &&
            rulesText.includes('friendly beast') &&
            rulesText.includes('dies')
          )
        }) === true
      const feedsFriendlyBeastDeathPayoff =
        losesFriendlyMinion &&
        cardHasTribe(attackerDefinition, 'Beast') &&
        hasFriendlyBeastDeathPayoff
      const targetHealthAfterAttack = number(afterTarget?.health)
      const setsUpImmediateRemoval =
        !attackerIsPoisonous &&
        losesFriendlyMinion &&
        beforeSelf !== undefined &&
        beforeSelf.board.length >= 5 &&
        targetDamage > 0 &&
        targetHealthAfterAttack > 0 &&
        beforeSelf.board.some(
          (entry) =>
            entry.instanceId !== attacker?.instanceId &&
            number(entry.attack) >= targetHealthAfterAttack
        )
      const waitsForFriendlyBeastDeath =
        attackerDefinition?.rulesText.toLowerCase().includes('friendly beast') ===
          true &&
        attackerDefinition.rulesText.toLowerCase().includes('dies') === true &&
        (beforeSelf?.board.some(
          (entry) =>
            entry.instanceId !== attacker?.instanceId &&
            cardHasTribe(CARD_CATALOG.get(entry.cardId), 'Beast')
        ) ??
          false)
      const handDefinitions = self.hand
        .map((card) => CARD_CATALOG.get(card.cardId))
        .filter(
          (definition): definition is NonNullable<typeof definition> =>
            definition !== undefined
        )
      const healingReplacementCost = handDefinitions.find((definition) => {
        const text = definition.rulesText.toLowerCase()
        return (
          text.includes('restore') &&
          text.includes('damage') &&
          text.includes('instead')
        )
      })?.cost
      const healingAreaCost = handDefinitions.find((definition) => {
        const text = definition.rulesText.toLowerCase()
        return text.includes('all minions') && text.includes('restore')
      })?.cost
      const activeHealingReplacement =
        beforeSelf?.board.some((entry) => {
          const text = CARD_CATALOG.get(entry.cardId)?.rulesText.toLowerCase() ?? ''
          return (
            text.includes('restore') &&
            text.includes('damage') &&
            text.includes('instead')
          )
        }) === true
      const holdsForHealingAreaClear =
        (beforeOpponent?.board.length ?? 0) >= 2 &&
        healingAreaCost !== undefined &&
        (activeHealingReplacement ||
          (healingReplacementCost !== undefined &&
            beforeMana >= healingReplacementCost + healingAreaCost))
      const hasFrostLichJaina = self.hand.some(
        (card) => card.cardId === 'knights_of_the_frozen_throne_frost_lich_jaina'
      )
      const holdsElementalForFrostLich =
        hasFrostLichJaina &&
        beforeMana >= 9 &&
        attacker?.cardId === 'basic_water_elemental'
      return (
        score +
        (removesEnemyMinion ? LOCAL_AI_POLICY.weights.enemyBoardRemoval * 10 : 0) -
        (waitsForFriendlyBeastDeath
          ? LOCAL_AI_POLICY.weights.enemyBoardRemoval * 20
          : 0) +
        (setsUpImmediateRemoval ? LOCAL_AI_POLICY.weights.enemyBoardRemoval * 12 : 0) +
        (feedsFriendlyBeastDeathPayoff
          ? LOCAL_AI_POLICY.weights.enemyBoardRemoval * 4
          : 0) +
        (holdsForHealingAreaClear ? -140 : 0) +
        (holdsElementalForFrostLich
          ? -LOCAL_AI_POLICY.weights.immediateLethal * 0.5
          : 0) +
        targetDamage * LOCAL_AI_POLICY.weights.enemyBoardRemoval * 2 +
        (losesFriendlyMinion && !attackerIsPoisonous
          ? LOCAL_AI_POLICY.weights.friendlyMinionLoss * 5
          : 0)
      )
    }
    if (command.type === 'attack-character' && command.defender.kind === 'hero') {
      const beforeSelf = before.players.find(
        (entry) => entry.participantId === this.session.remoteParticipantId
      )
      const beforeOpponent = before.players.find(
        (entry) => entry.participantId !== this.session.remoteParticipantId
      )
      const afterOpponent = after.players.find(
        (entry) => entry.participantId !== this.session.remoteParticipantId
      )
      const selfHealth =
        number(record(beforeSelf?.hero).health) + number(record(beforeSelf?.hero).armor)
      const hasLiveEnemyBoard = (beforeOpponent?.board.length ?? 0) > 0
      const leavesEnemyBoard =
        (afterOpponent?.board.length ?? 0) < (beforeOpponent?.board.length ?? 0)
      const isLethal = (afterOpponent?.hero.health ?? 1) <= 0
      return (
        score +
        LOCAL_AI_POLICY.weights.faceDamage * 2 +
        (hasLiveEnemyBoard && selfHealth <= 6 && !leavesEnemyBoard && !isLethal
          ? -LOCAL_AI_POLICY.weights.preventVisibleLethal * 0.25
          : 0)
      )
    }
    if (command.type === 'play-card') {
      const selfState = this.session.findPlayer(
        this.session.getState(),
        this.session.remoteParticipantId
      )
      const card = selfState.hand.find(
        (entry) => entry.instanceId === command.cardInstanceId
      )
      if (!card) return score
      if (card.cardId === 'basic_the_coin') return score - 8
      const definition = CARD_CATALOG.get(card.cardId)
      let targetBias = 0
      const beforeSelf = before.players.find(
        (entry) => entry.participantId === this.session.remoteParticipantId
      )
      const cthunProgress = beforeSelf?.effects.cthun
      const hasCthunPayoff = beforeSelf?.hand.some(
        (entry) => entry.cardId === 'whispers_of_the_old_gods_cthun'
      )
      if (
        hasCthunPayoff &&
        cthunProgress !== undefined &&
        JSON.stringify(definition?.effects ?? '')
          .toLowerCase()
          .includes('buff-cthun') &&
        cthunProgress.attack < 10
      )
        targetBias += 600
      const beforeOpponent = before.players.find(
        (entry) => entry.participantId !== this.session.remoteParticipantId
      )
      const hasPreResetTrade =
        beforeSelf?.board.some((entry) => number(entry.attack) >= 5) === true &&
        beforeOpponent?.board.some((target) => number(target.health) <= 5) === true
      if (
        card.cardId === 'knights_of_the_frozen_throne_shadowreaper_anduin' &&
        hasPreResetTrade
      )
        targetBias -= LOCAL_AI_POLICY.weights.immediateLethal * 0.8
      const hasHiddenSecret =
        beforeOpponent?.secrets.some((secret) => !secret.revealed) === true
      const doomsayer = beforeOpponent?.board.find(
        (entry) => entry.cardId === 'classic_doomsayer'
      )
      const hasCheapSecretProbe = self.hand.some((entry) => {
        if (entry.cardId === 'basic_the_coin') return true
        const candidate = CARD_CATALOG.get(entry.cardId)
        return candidate?.type === 'Minion' && candidate.cost <= 4
      })
      const targetsEnemyMinion = command.targets?.some(
        (target) =>
          target.kind === 'minion' &&
          target.participantId !== this.session.remoteParticipantId
      )
      const rulesText = definition?.rulesText.toLowerCase() ?? ''
      const targetsFriendlyMinion = command.targets?.some(
        (target) =>
          target.kind === 'minion' &&
          target.participantId === this.session.remoteParticipantId
      )
      if (
        targetsFriendlyMinion &&
        rulesText.includes('return') &&
        rulesText.includes('friendly minion')
      )
        targetBias += 300
      const hasDamagedFriendlyMinion = self.board.some(
        (minion) => number(minion.health) < number(minion.maxHealth)
      )
      const isHealingDrawEngine =
        definition?.type === 'Minion' &&
        rulesText.includes('heal') &&
        rulesText.includes('draw')
      if (isHealingDrawEngine && hasDamagedFriendlyMinion) targetBias += 150
      if (
        doomsayer &&
        definition?.type === 'Minion' &&
        !(
          definition.keywords.includes('charge') &&
          definition.attack >= number(doomsayer.health)
        )
      )
        targetBias -= LOCAL_AI_POLICY.weights.preventVisibleLethal
      if (hasHiddenSecret) {
        if (card.cardId === 'basic_the_coin') targetBias += 500
        else if (definition?.type === 'Minion' && definition.cost <= 4)
          targetBias += 220
        else if (targetsEnemyMinion && definition?.type === 'Spell') targetBias += 320
        else if (
          hasCheapSecretProbe &&
          definition?.type === 'Spell' &&
          command.targets?.some((target) => target.kind === 'hero')
        )
          targetBias -= 280
        else if (
          hasCheapSecretProbe &&
          definition?.type === 'Minion' &&
          definition.cost >= 6
        )
          targetBias -= 220
      }
      for (const target of command.targets ?? []) {
        if (target.kind !== 'minion') continue
        const beforePlayer = before.players.find(
          (entry) => entry.participantId === target.participantId
        )
        const afterPlayer = after.players.find(
          (entry) => entry.participantId === target.participantId
        )
        const beforeTarget = beforePlayer?.board.find(
          (entry) => entry.instanceId === target.instanceId
        )
        const afterTarget = afterPlayer?.board.find(
          (entry) => entry.instanceId === target.instanceId
        )
        if (!beforeTarget) continue
        if (target.participantId === this.session.remoteParticipantId) {
          const attackGain = number(afterTarget?.attack) - number(beforeTarget.attack)
          const healthGain = number(afterTarget?.health) - number(beforeTarget.health)
          if (attackGain > 0)
            targetBias += attackGain * LOCAL_AI_POLICY.weights.boardAttack * 12
          if (healthGain > 0)
            targetBias += healthGain * LOCAL_AI_POLICY.weights.boardHealth * 12
          if (rulesText.includes('deathrattle'))
            targetBias +=
              30 + (number(beforeTarget.attack) + number(beforeTarget.health)) * 2
          const effectText = definition
            ? JSON.stringify(definition.effects).toLowerCase()
            : ''
          if (
            effectText.includes('grant-deathrattle') &&
            effectText.includes('return-to-play')
          )
            targetBias += 100
          // A targeted transform of our own developed body is usually a
          // severe loss of board value; do not let a temporary Taunt hide it.
          if (afterTarget && afterTarget.cardId !== beforeTarget.cardId)
            targetBias -= LOCAL_AI_POLICY.weights.preventVisibleLethal * 6
        } else {
          const suppressesEnemyText =
            afterTarget?.silenced === true && beforeTarget.silenced !== true
          if (suppressesEnemyText) {
            targetBias += LOCAL_AI_POLICY.weights.enemyBoardRemoval * 10
          } else if (
            (!afterTarget || afterTarget.cardId !== beforeTarget.cardId) &&
            (card.currentCost ?? definition?.cost ?? 99) <= 2
          ) {
            // A cheap targeted removal can preserve a ready body for the next
            // trade; give it a modest tempo edge without overpowering lethal.
            targetBias += LOCAL_AI_POLICY.weights.enemyBoardRemoval * 12
          }
        }
      }
      const adjacentNeighbors =
        command.position !== undefined &&
        definition &&
        containsAdjacentMechanic(definition.effects)
          ? Math.min(command.position, self.board.length - command.position)
          : 0
      return (
        score +
        cardScore(card.cardId) +
        targetBias +
        conditionalBoardBias(
          card.cardId,
          this.session.getState(),
          this.session.remoteParticipantId
        ) +
        adjacentNeighbors * 12
      )
    }
    if (command.type === 'choose-discover-card') {
      const candidate = this.session
        .getState()
        .pendingDiscover?.candidates.find(
          (entry) => entry.instanceId === command.cardInstanceId
        )
      return score + (candidate ? cardScore(candidate.cardId) * 1.8 : 0)
    }
    if (command.type === 'choose-card-option') {
      const option = this.session
        .getState()
        .pendingCardChoice?.options.find((entry) => entry.choice === command.choice)
      return (
        score +
        (option?.presentationCardId ? cardScore(option.presentationCardId) : 4) +
        (option
          ? choiceOptionBias(
              this.session.getState().pendingCardChoice!,
              option,
              before,
              this.session.remoteParticipantId
            )
          : 0)
      )
    }
    if (command.type === 'use-hero-power') {
      const player = after.players.find(
        (entry) => entry.participantId === this.session.remoteParticipantId
      )
      const power = player ? HERO_POWER_CATALOG.get(player.heroPower.id) : undefined
      const beforeSelf = before.players.find(
        (entry) => entry.participantId === this.session.remoteParticipantId
      )
      const beforeOpponent = before.players.find(
        (entry) => entry.participantId !== this.session.remoteParticipantId
      )
      const healingDrawOpportunity =
        beforeSelf?.hand.some((card) => {
          const definition = CARD_CATALOG.get(card.cardId)
          const text = definition?.rulesText.toLowerCase() ?? ''
          return (
            definition?.type === 'Minion' &&
            text.includes('heal') &&
            text.includes('draw')
          )
        }) === true &&
        beforeSelf?.board.some(
          (minion) => number(minion.health) < number(minion.maxHealth)
        ) === true
      const afterOpponent = after.players.find(
        (entry) => entry.participantId !== this.session.remoteParticipantId
      )
      const selfHealth =
        number(record(beforeSelf?.hero).health) + number(record(beforeSelf?.hero).armor)
      const visibleThreatValue =
        beforeOpponent && beforeSelf
          ? visibleHeroThreat(beforeOpponent, beforeSelf, before.turnNumber)
          : 0
      const targetsEnemyHero = command.target?.kind === 'hero'
      const targetMinion =
        command.target?.kind === 'minion' ? command.target : undefined
      const beforeTargetOwner = targetMinion
        ? before.players.find(
            (entry) => entry.participantId === targetMinion.participantId
          )
        : undefined
      const afterTargetOwner = targetMinion
        ? after.players.find(
            (entry) => entry.participantId === targetMinion.participantId
          )
        : undefined
      const beforeTarget = beforeTargetOwner?.board.find(
        (entry) => entry.instanceId === targetMinion?.instanceId
      )
      const afterTarget = afterTargetOwner?.board.find(
        (entry) => entry.instanceId === targetMinion?.instanceId
      )
      const targetsFriendlyMinion =
        targetMinion?.participantId === this.session.remoteParticipantId
      const targetHealthGain = Math.max(
        0,
        number(afterTarget?.health) - number(beforeTarget?.health)
      )
      const targetsEnemyMinion =
        targetMinion !== undefined &&
        targetMinion.participantId !== this.session.remoteParticipantId
      const removesEnemyMinion = targetsEnemyMinion && !afterTarget
      const consumesEnemyDivineShield =
        targetsEnemyMinion &&
        beforeTarget?.divineShield === true &&
        afterTarget?.divineShield !== true
      const enemyTargetValue = beforeTarget
        ? number(beforeTarget.attack) * LOCAL_AI_POLICY.weights.boardAttack +
          number(beforeTarget.health) * LOCAL_AI_POLICY.weights.boardHealth +
          effectiveBoardMinionKeywords(beforeTarget, before.turnNumber).length *
            LOCAL_AI_POLICY.weights.boardKeyword
        : 0
      const leavesEnemyBoard =
        (afterOpponent?.board.length ?? 0) < (beforeOpponent?.board.length ?? 0)
      const isLethal = (afterOpponent?.hero.health ?? 1) <= 0
      const hiddenSecretProbe =
        beforeOpponent?.secrets.some((secret) => !secret.revealed) === true &&
        targetsEnemyMinion &&
        number(beforeTarget?.health) <= 1
      const weakestHiddenSecretProbe =
        hiddenSecretProbe && number(beforeTarget?.attack) <= 1
      return (
        score +
        (power ? 3 : 0) +
        (removesEnemyMinion
          ? LOCAL_AI_POLICY.weights.enemyBoardRemoval * 12
          : consumesEnemyDivineShield
            ? LOCAL_AI_POLICY.weights.enemyBoardRemoval * 4 + enemyTargetValue * 3
            : 0) +
        (hiddenSecretProbe ? LOCAL_AI_POLICY.weights.enemyBoardRemoval * 50 : 0) +
        (weakestHiddenSecretProbe
          ? LOCAL_AI_POLICY.weights.enemyBoardRemoval * 25
          : 0) +
        (targetsFriendlyMinion
          ? targetHealthGain * LOCAL_AI_POLICY.weights.boardHealth * 12
          : 0) +
        (healingDrawOpportunity && targetsEnemyHero ? -180 : 0) +
        (targetsEnemyHero &&
        visibleThreatValue >= selfHealth &&
        !leavesEnemyBoard &&
        !isLethal
          ? -LOCAL_AI_POLICY.weights.preventVisibleLethal * 0.5
          : 0)
      )
    }
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
      modelId: this.profile === 'expert' ? EXPERT_MODEL_ID : EASY_MODEL_ID,
      reason: reason.slice(0, 580),
      choice,
      durationMs: performance.now() - started,
      finishReason: 'local-search',
      ...(trace
        ? {
            usage: {
              mode: 'local-search',
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
