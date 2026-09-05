import type { Deck } from '../../decks'
import type { CardId } from '../../content/cards'
import type {
  OpeningMatchCheckpoint,
  OpeningMatchState,
  OpeningPlayerState,
  OpeningMatchCommand as TurnMatchCommand
} from '../opening-match-types'
import type { PlayerId } from '../match-types'

/**
 * The AI receives exactly the information available to the player it controls.
 * Keeping this as a single literal makes privileged observations impossible to
 * request accidentally through the public match boundary.
 */
export type AiInformationPolicy = 'fair'

export interface AiSearchLimits {
  readonly timeBudgetMs: number
  readonly nodeLimit: number
  readonly atomicDepth: number
  readonly ownTurnBeam: number
  readonly opponentTurnBeam: number
  readonly determinizations: number
  readonly randomOutcomeSamples: number
  readonly transpositionCapacity: number
}

export const STRATEGIC_AI_SEARCH_LIMITS: AiSearchLimits = {
  timeBudgetMs: 8_000,
  nodeLimit: 50_000,
  atomicDepth: 16,
  ownTurnBeam: 64,
  opponentTurnBeam: 32,
  // Fair belief-state sampling is not implemented yet. Keep these truthful so
  // downstream consumers never mistake one authoritative hidden state for a
  // sampled uncertainty distribution.
  determinizations: 0,
  randomOutcomeSamples: 0,
  transpositionCapacity: 50_000
}

export interface AiObservedCard {
  readonly cardId: CardId
  readonly baseCost: number | null
  readonly currentCost: number | null
}

export interface AiObservedSecret {
  readonly revealed: boolean
  readonly cardId: CardId | null
}

export interface AiObservedPlayer {
  readonly participantId: PlayerId
  readonly role: 'self' | 'opponent'
  readonly playerNumber: 1 | 2
  readonly heroId: OpeningPlayerState['heroId']
  readonly hero: Omit<OpeningPlayerState['hero'], 'creationOrdinal'>
  /**
   * Exact self cards, or the subset of opponent cards explicitly revealed to
   * this player. `handSize` remains the authoritative total.
   */
  readonly hand: readonly AiObservedCard[]
  readonly handSize: number
  readonly deckSize: number
  readonly board: readonly Omit<
    OpeningPlayerState['board'][number],
    'creationOrdinal' | 'playOrder'
  >[]
  readonly weapon: Omit<
    NonNullable<OpeningPlayerState['weapon']>,
    'creationOrdinal' | 'playOrder'
  > | null
  readonly mana: OpeningPlayerState['mana']
  readonly heroPower: Omit<OpeningPlayerState['heroPower'], 'creationOrdinal'>
  readonly fatigueDamage: number
  readonly secrets: readonly AiObservedSecret[]
  readonly graveyardCardIds: readonly CardId[]
}

export interface AiObservedDeck {
  readonly id: string
  readonly name: string
  readonly heroId: Deck['heroId']
  readonly cards: readonly Readonly<{
    readonly cardId: CardId
    readonly count: number
  }>[]
}

/**
 * Model/search input. It contains the AI's exact hand and submitted deck plus
 * public opponent information, but never an unrevealed opposing hand/deck
 * identity, remaining deck order, RNG cursor, hidden entity id, creation
 * ordinal, or facedown secret identity.
 */
export interface AiObservation {
  readonly schemaVersion: 3
  readonly informationPolicy: AiInformationPolicy
  readonly revision: number
  readonly phase: OpeningMatchState['phase']
  readonly turnNumber: number
  readonly activePlayerId: PlayerId | null
  readonly perspectivePlayerId: PlayerId
  readonly players: readonly [AiObservedPlayer, AiObservedPlayer]
  /** A player knows the deck it brought, never the opponent's submitted list. */
  readonly selfOriginalDeck: AiObservedDeck
}

export interface AiEvaluationComponents {
  readonly terminal: number
  readonly lethalPressure: number
  readonly effectiveHealth: number
  readonly incomingReach: number
  readonly boardAttack: number
  readonly boardHealth: number
  readonly boardKeywords: number
  readonly initiative: number
  readonly boardSlots: number
  readonly handQuality: number
  readonly cardAdvantage: number
  readonly manaEfficiency: number
  readonly futureCurve: number
  readonly weapon: number
  readonly heroPower: number
  readonly removal: number
  readonly draw: number
  /** Value of learning before committing the rest of the turn. */
  readonly informationValue: number
  readonly fatigue: number
  readonly burnRisk: number
  readonly matchupProgress: number
  readonly comboProgress: number
  readonly threatExposure: number
  readonly reservedResourceCost: number
}

export type AiTacticalProofKind =
  | 'guaranteed-lethal'
  | 'forced-survival'
  | 'board-clear'
  | 'efficient-trade'
  | 'required-combo-sequence'
  | 'unconditionally-profitable'

export interface AiTacticalProof {
  readonly kind: AiTacticalProofKind
  readonly proven: boolean
  readonly complete: boolean
  readonly commands: readonly TurnMatchCommand[]
  readonly verifiedBranches: number
  readonly annotation: string
}

export interface AiCandidateDossier {
  readonly actionId: string
  readonly firstCommand: TurnMatchCommand
  readonly recommendedContinuation: readonly TurnMatchCommand[]
  readonly projectedSuccessor: Readonly<{
    readonly revision: number
    readonly winnerId: PlayerId | null
    readonly selfEffectiveHealth: number
    readonly opponentEffectiveHealth: number
    readonly selfBoardAttack: number
    readonly opponentBoardAttack: number
  }>
  readonly opponentStrongestResponse: readonly TurnMatchCommand[]
  readonly tacticalProofs: readonly AiTacticalProof[]
  readonly evaluation: AiEvaluationComponents
  readonly score: number
  readonly meanScenarioValue: number
  readonly downsideScenarioValue: number
  readonly worstCaseScenarioValue: number
  readonly resourceUsage: Readonly<{
    readonly manaSpent: number
    readonly cardsSpent: number
    readonly reservedResourceCost: number
  }>
  readonly uncertainty: Readonly<{
    readonly determinizations: number
    readonly randomOutcomeSamples: number
    readonly incomplete: boolean
  }>
  readonly strategyProgress: number
}

export interface AiSearchWorkerRequest {
  readonly type: 'search'
  readonly requestId: string
  readonly observationRevision: number
  readonly limits: AiSearchLimits
  readonly checkpoint: OpeningMatchCheckpoint
  readonly perspectivePlayerId: PlayerId
  readonly roots?: readonly Readonly<{
    readonly actionId: string
    readonly command: TurnMatchCommand
  }>[]
  readonly plan: AiStrategicPlanView
  readonly deterministicSampleSeed: number
}

export interface AiSearchWorkerCancelRequest {
  readonly type: 'cancel-search'
  readonly requestId: string
}

export type AiSearchWorkerMessage = AiSearchWorkerRequest | AiSearchWorkerCancelRequest

export interface AiSearchWorkerResult {
  readonly type: 'search-result'
  readonly requestId: string
  readonly observationRevision: number
  readonly roots: readonly Readonly<{
    readonly actionId: string
    readonly command: TurnMatchCommand
  }>[]
  readonly candidateDossiers: readonly AiCandidateDossier[]
  readonly exploredNodes: number
  readonly cacheHits: number
  readonly partial: boolean
  readonly elapsedMs: number
}

export interface AiStrategicPlanView {
  readonly selfCombos?: readonly Readonly<{
    readonly cardIds: readonly string[]
    readonly purpose: string
  }>[]
  readonly reservedCardIds?: readonly string[]
  readonly activeReservedCardIds?: readonly string[]
  readonly selfDeckCardCounts?: Readonly<Record<string, number>>
  readonly observedOpponentThreatCardIds?: readonly string[]
  readonly resourceRules?: readonly Readonly<{
    readonly cardIds: readonly string[]
    readonly releaseTriggers: readonly AiResourceReleaseTrigger[]
  }>[]
}

export type AiResourceReleaseTrigger =
  | 'lethal'
  | 'forced-survival'
  | 'combo-ready'
  | 'redundant-copy'
  | 'invalidated-combo'
  | 'critical-threat'
