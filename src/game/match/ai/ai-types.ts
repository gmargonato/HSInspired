import type { CardId } from '../../content/cards'
import type { Deck } from '../../decks'
import type {
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
    'attack' | 'health' | 'enchantments' | 'costAdjustments'
  >
  readonly cardId: CardId
  readonly baseCost: number | null
  readonly currentCost: number | null
}

export type AiObservedQuest = Pick<
  NonNullable<OpeningPlayerState['quest']>,
  'cardId' | 'rewardCardId' | 'goal' | 'progress' | 'target'
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
  readonly perspectivePlayerId: PlayerId
  readonly players: readonly [AiObservedPlayer, AiObservedPlayer]
  readonly selfOriginalDeck: AiObservedDeck
}
