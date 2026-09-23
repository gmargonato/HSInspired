import type { CardId, CardEventType } from '../../content/cards'
import type {
  OpeningMatchState,
  OpeningCard,
  BoardMinion,
  RuntimeEntityKind,
  RuntimeZone
} from '../opening-match-types'
import type { PlayerId } from '../match-types'
import type { ResolutionCorrelation } from '../contracts'
import type { DeterministicRng } from '../rng'

export type Mutable<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends readonly (infer U)[]
    ? Mutable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: Mutable<T[K]> }
      : T

export type DraftState = Mutable<OpeningMatchState>
export type DraftPlayer = DraftState['players'][number]
export type DraftMinion = Mutable<BoardMinion>
export type DraftCard = Mutable<OpeningCard>

export interface EntityRef {
  readonly instanceId: string
  readonly kind: RuntimeEntityKind
  readonly participantId: PlayerId
  readonly zone: RuntimeZone
  readonly cardId?: CardId
}

export interface SemanticEvent {
  readonly sequence: number
  readonly type: CardEventType
  readonly source: EntityRef | null
  readonly target: EntityRef | null
  readonly controllerId: PlayerId | null
  readonly targetControllerId?: PlayerId | null
  readonly cardId?: CardId
  readonly cardInstanceId?: string
  readonly damage?: number
  readonly amount?: number
  readonly overheal?: boolean
  /** Board size controlled by the event player before a played minion entered. */
  readonly minionCountBeforePlay?: number
  readonly card?: OpeningCard
  /** Final chosen targets after spell-target redirects, before cast effects resolve. */
  readonly spellTargets?: readonly EntityRef[]
  /** A minion recast this spell; it must not generate further spell copies. */
  readonly spellCopy?: boolean
  /** True when the card was played from hand rather than put into play. */
  readonly playedFromHand?: boolean
  /** Combat-only facts consumed by explicit attack-resolved triggers. */
  readonly defenderDied?: boolean
  readonly attackerDied?: boolean
  readonly kind?:
    | 'play'
    | 'cast'
    | 'discard'
    | 'draw'
    | 'armor'
    | 'heal'
    | 'summon'
    | 'damage'
    | 'turn-start'
    | 'turn-end'
  readonly correlation?: ResolutionCorrelation
  cancelled?: boolean
  prevented?: boolean
  replacement?: string
  redirectTarget?: EntityRef
}

export interface EffectFrame {
  readonly source: EntityRef
  readonly sourceCardId: CardId | null
  readonly correlation: ResolutionCorrelation
  readonly rng: DeterministicRng
  readonly controllerId: PlayerId
  readonly event: SemanticEvent | null
  lastEvent: SemanticEvent | null
  readonly chosenTargets: readonly EntityRef[]
  targetContext: EntityRef | null
  lastActionTarget: EntityRef | null
  readonly choiceIndex: number | undefined
  readonly preserved: Map<string, readonly EntityRef[]>
  /** Entity references captured by action metadata such as storeAs. */
  readonly stored: Map<string, readonly EntityRef[]>
  /** Scalar values captured by action metadata such as spend-all-mana. */
  readonly storedValues: Map<string, number>
  readonly actionPath: string
  selectedTargetCursor: number
  damageDealt: number
  lastDamageAmount: number
  removedKeywordCount: number
  readonly addedCards: EntityRef[]
  readonly drawnCards: EntityRef[]
  readonly destroyedMinions: EntityRef[]
  randomDamageExcluded: Set<string>
  /** Prevents a replacement heal from recursively creating Lifesteal. */
  readonly skipLifesteal?: boolean
  readonly continuous?: boolean
  readonly isHeroPower?: boolean
  /** Evaluates play-time conditions after the source leaves hand and enters play. */
  readonly prospectiveCardPlay?: boolean
  /** Board size controlled by the event player before a played minion entered. */
  readonly minionCountBeforePlay?: number
}
