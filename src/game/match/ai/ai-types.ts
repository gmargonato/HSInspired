import type { Deck } from '../../decks'
import type { CardId } from '../../content/cards'
import type {
  OpeningMatchState,
  OpeningPlayerState,
  OpeningMatchCommand as TurnMatchCommand
} from '../opening-match-types'
import type { PlayerId } from '../match-types'

export type AiInformationPolicy = 'opponent-deck-and-hand'

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

export const COMPETITIVE_AI_SEARCH_LIMITS: AiSearchLimits = {
  timeBudgetMs: 8_000,
  nodeLimit: 50_000,
  atomicDepth: 16,
  ownTurnBeam: 64,
  opponentTurnBeam: 32,
  determinizations: 8,
  randomOutcomeSamples: 4,
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
  readonly hand: readonly AiObservedCard[]
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
 * Model/search input. It intentionally contains exact hand multisets and both
 * original decklists, but never a remaining deck order, RNG cursor, hidden
 * entity id, creation ordinal, or facedown secret identity.
 */
export interface AiObservation {
  readonly schemaVersion: 2
  readonly informationPolicy: AiInformationPolicy
  readonly revision: number
  readonly phase: OpeningMatchState['phase']
  readonly turnNumber: number
  readonly activePlayerId: PlayerId | null
  readonly perspectivePlayerId: PlayerId
  readonly players: readonly [AiObservedPlayer, AiObservedPlayer]
  readonly originalDecks: readonly [AiObservedDeck, AiObservedDeck]
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
  readonly matchupPlanProgress: number
}

export interface AiSearchWorkerRequest {
  readonly type: 'search'
  readonly requestId: string
  readonly observationRevision: number
  readonly limits: AiSearchLimits
  readonly candidateDossiers: readonly AiCandidateDossier[]
  readonly deterministicSampleSeed: number
}

export interface AiSearchWorkerResult {
  readonly type: 'search-result'
  readonly requestId: string
  readonly observationRevision: number
  readonly candidateDossiers: readonly AiCandidateDossier[]
  readonly exploredNodes: number
  readonly cacheHits: number
  readonly partial: boolean
  readonly elapsedMs: number
}

export interface AiStrategicPlanView {
  readonly selfComboCardIds?: readonly string[]
  readonly reservedCardIds?: readonly string[]
  readonly opponentThreatCardIds?: readonly string[]
}
