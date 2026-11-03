import type { CardId } from '../../content/cards'
import type { Deck } from '../../decks'
import type {
  CardChoiceOption,
  OpeningCard,
  OpeningMatchState,
  OpeningPlayerState
} from '../opening-match-types'
import type { PlayerId } from '../match-types'

/** Normal opponents receive exactly the information available to their player. */
export type AiInformationPolicy = 'fair'

export interface AiObservedCard {
  readonly instanceId: string
  readonly modifications?: Pick<
    OpeningCard,
    'attack' | 'health' | 'enchantments' | 'costAdjustments' | 'baseStatsOverride'
  >
  readonly cardId: CardId
  readonly baseCost: number | null
  readonly currentCost: number | null
}

export type AiObservedQuest = Pick<
  NonNullable<OpeningPlayerState['quest']>,
  | 'cardId'
  | 'rewardCardId'
  | 'goal'
  | 'progress'
  | 'target'
  | 'objectives'
  | 'completedObjectives'
>

export interface AiObservedPlayer {
  readonly participantId: PlayerId
  readonly role: 'self' | 'opponent'
  readonly playerNumber: 1 | 2
  readonly heroId: OpeningPlayerState['heroId']
  readonly hero: Omit<OpeningPlayerState['hero'], 'creationOrdinal'>
  /** Quests are visible objectives for both players. */
  readonly quest: AiObservedQuest | null
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
  readonly effects: Pick<
    OpeningPlayerState,
    | 'cthun'
    | 'cthunDied'
    | 'overload'
    | 'pendingCostModifiers'
    | 'counters'
    | 'lockAndLoadCount'
    | 'lockAndLoadTurn'
    | 'heroPowerCostOverride'
    | 'minionBaseStats'
    | 'murlocSummonBonus'
    | 'ninjaCycle'
    | 'futureAdaptations'
    | 'nextSpellCostsHealth'
    | 'nextMurlocCostsHealth'
    | 'nextCardCostsOpponentHealth'
  >
  readonly fatigueDamage: number
  readonly secrets: readonly Readonly<{
    readonly instanceId: string
    readonly revealed: boolean
    readonly cardId: CardId | null
  }>[]
  readonly graveyardCardIds: readonly CardId[]
}

export interface AiObservedDeck {
  readonly heroId: Deck['heroId']
  readonly cards: readonly Readonly<{
    readonly cardId: CardId
    readonly count: number
  }>[]
}

export interface AiObservation {
  readonly schemaVersion: 1
  readonly informationPolicy: AiInformationPolicy
  readonly revision: number
  readonly phase: OpeningMatchState['phase']
  readonly turnNumber: number
  readonly activePlayerId: PlayerId | null
  readonly extraTurnQueue?: readonly PlayerId[]
  readonly nextRegularPlayerId?: PlayerId
  readonly isExtraTurn?: boolean
  readonly perspectivePlayerId: PlayerId
  readonly players: readonly [AiObservedPlayer, AiObservedPlayer]
  /** Only the choosing player sees the offered cards; never expose the hidden answer or continuation. */
  readonly pendingDiscover?: {
    readonly participantId: PlayerId
    readonly sourceCardInstanceId: string
    readonly candidates: readonly AiObservedCard[]
  }
  /** Current options and already made choices; never include raw resolution or future queued offers. */
  readonly pendingCardChoice?: {
    readonly participantId: PlayerId
    readonly sourceCardInstanceId: string
    readonly sourceCardId: CardId
    readonly prompt?: string
    /** Already selected potion ingredients are known to the chooser; future offers are not. */
    readonly resolutionContext?: {
      readonly type: 'kazakus-potion'
      readonly stage: 'cost' | 'first-ingredient' | 'second-ingredient'
      readonly selectedCost?: number
      readonly selectedCostCardId?: CardId
      readonly selectedFirstIngredient?: CardId
    }
    readonly options: readonly Pick<
      CardChoiceOption,
      | 'choice'
      | 'label'
      | 'presentationCardId'
      | 'presentationCost'
      | 'presentationHeroPowerId'
    >[]
  }
  readonly selfOriginalDeck: AiObservedDeck
}
