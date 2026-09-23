import type {
  CardEffectBlock,
  CardEventType,
  CardId,
  CardKeyword,
  CardTrigger,
  HeroId,
  HeroPowerId
} from '../content/cards'
import type { Deck } from '../decks'
import type { ResolutionCorrelation } from './contracts'
import type { ControllerKind, MatchSetup, PlayerId } from './match-types'
import type { AiInformationPolicy, AiObservation } from './ai/ai-types'

export type OpeningPhase = 'mulligan' | 'turns' | 'ended'

export interface OpeningCard {
  readonly instanceId: string
  readonly cardId: CardId
  /** True only for cards copied from the original, submitted deck. */
  readonly startedInDeck?: boolean
  /** The original owner remains stable when control-changing effects occur. */
  readonly ownerId?: PlayerId
  readonly controllerId?: PlayerId
  readonly creationOrdinal?: number
  /** Timestamp for the entity's most recent entry into the play zone. */
  readonly playOrder?: number
  readonly baseCost?: number
  readonly currentCost?: number
  readonly zone?: 'deck' | 'hand' | 'revealed' | 'discarded'
  readonly revealed?: boolean
  /** Participant ids that have been told this card identity. */
  readonly knownTo?: readonly PlayerId[]
  readonly costAdjustments?: readonly RuntimeCostAdjustment[]
  readonly attack?: number
  readonly health?: number
  readonly enchantments?: readonly RuntimeEnchantment[]
  /** Owner-only Fatespinner choice retained while it is bounced to hand. */
  readonly concealedDeathrattleChoice?: number
}

export type RuntimeEntityKind =
  'card' | 'minion' | 'hero' | 'hero-power' | 'weapon' | 'secret'

export type RuntimeZone =
  | 'deck'
  | 'hand'
  | 'board'
  | 'hero'
  | 'hero-power'
  | 'weapon'
  | 'secret'
  | 'graveyard'
  | 'discarded'
  | 'revealed'

export interface RuntimeEntityReference {
  readonly instanceId: string
  readonly kind: RuntimeEntityKind
  readonly zone: RuntimeZone
  readonly ownerId: PlayerId
  readonly controllerId: PlayerId
}

export interface RuntimeEnchantment {
  /** Identifies a cultist enhancement independently of ordinary stat buffs. */
  readonly cthun?: boolean
  readonly id: string
  readonly sourceInstanceId: string
  readonly sourceCardId: CardId | null
  readonly attackDelta?: number
  readonly healthDelta?: number
  readonly maximumHealthDelta?: number
  readonly durabilityDelta?: number
  readonly costDelta?: number
  readonly spellDamageDelta?: number
  readonly spellDamageMultiplier?: number
  readonly healingMultiplier?: number
  readonly heroPowerMultiplier?: number
  readonly triggerMultipliers?: Readonly<Record<string, number>>
  readonly attackMultiplier?: number
  readonly healthMultiplier?: number
  /** Overrides the number of times a hero may attack in the current turn. */
  readonly maxAttacksPerTurn?: number
  readonly unlimitedAttacks?: boolean
  /** Captured swap values override earlier stat modifiers, but not later ones. */
  readonly attackOverride?: number
  readonly healthOverride?: number
  readonly targetingGranted?: string | null
  readonly minimumHealth?: number
  /** A hero enchantment protecting its controller's current and future minions. */
  readonly friendlyMinionMinimumHealth?: number
  /** Caps one incoming damage event before damage-taken multipliers apply. */
  readonly maximumDamageTaken?: number
  /** Multiplies damage after per-event caps and before Armor absorbs it. */
  readonly damageTakenMultiplier?: number
  /** Event type replaced by this enchantment when no event frame is open. */
  readonly replacesEvent?: CardEventType
  readonly eventReplacement?: string
  readonly keywords?: readonly CardKeyword[]
  readonly removedKeywords?: readonly CardKeyword[]
  /** Controller restored when a temporary control enchantment ends or is silenced. */
  readonly returnControllerId?: PlayerId
  /** Card id recorded by a destroy action so a later deathrattle can summon it. */
  readonly storedCardId?: CardId | null
  /** Controller the recorded card's minion belonged to when it was destroyed. */
  readonly storedControllerId?: PlayerId | null
  readonly duration?: string
  readonly startsOnTurn?: number
  readonly expiresOnTurn?: number
  readonly expiresOnAttack?: number
  /** Removes this Hero Power cost modifier immediately after one use. */
  readonly consumeOnHeroPowerUse?: boolean
  readonly silenceable?: boolean
  readonly continuous?: boolean
}

export interface RuntimeCostAdjustment {
  readonly id: string
  readonly sourceInstanceId: string
  readonly amount: number
  readonly duration?: string
  readonly startsOnTurn?: number
  readonly expiresOnTurn?: number
  readonly continuous?: boolean
}

export interface RuntimeGrantedTrigger {
  readonly id: string
  readonly trigger: CardTrigger
  readonly actions: readonly Record<string, unknown>[]
  readonly sourceInstanceId: string
  readonly duration?: string
  readonly startsOnTurn?: number
  readonly expiresOnTurn?: number
}

/**
 * A delayed effect attached to a minion rather than to the match timeline.
 * It follows that minion through control changes, is removed by Silence or a
 * definition-reset transform, and is duplicated by exact board-copy effects.
 */
export interface RuntimeAttachedEffect {
  readonly id: string
  readonly sourceInstanceId: string
  readonly sourceCardId: CardId | null
  readonly controllerId: PlayerId
  readonly trigger: 'start-of-turn' | 'end-of-turn'
  readonly actions: readonly Record<string, unknown>[]
  readonly executeOnTurn: number
}

export interface SecretState {
  readonly instanceId: string
  readonly cardId: CardId
  readonly ownerId: PlayerId
  readonly controllerId: PlayerId
  readonly creationOrdinal: number
  /** Timestamp for the secret's most recent entry into the play zone. */
  readonly playOrder?: number
  readonly revealed: boolean
}

export interface GraveyardMinion {
  readonly minion: BoardMinion
  readonly ownerId: PlayerId
  readonly controllerId: PlayerId
  readonly diedOnTurn: number
  readonly deathOrdinal: number
}

export interface MatchHistory {
  readonly cardsPlayedThisTurn: readonly string[]
  readonly cardsCastThisTurn: readonly string[]
  readonly cardsDrawnThisTurn: readonly string[]
  readonly minionsSummonedThisTurn: readonly string[]
  readonly minionsDiedThisTurn: readonly string[]
  readonly damageDealtThisTurn: number
  readonly damageTakenThisTurn: number
  readonly healingThisTurn: number
  readonly armorGainedThisTurn: number
  readonly cardsPlayedThisGame: readonly string[]
  readonly spellsCastThisGameByPlayer: Readonly<Record<string, number>>
  readonly totemsSummonedThisGameByPlayer: Readonly<Record<string, number>>
  readonly secretsPlayedThisGameByPlayer: Readonly<Record<string, number>>
  readonly cardsDiedThisGame: readonly string[]
  readonly cardsDiscardedThisGameByPlayer?: Readonly<Record<string, number>>
  readonly overloadedManaThisGameByPlayer?: Readonly<Record<string, number>>
  readonly offClassCardsAddedToHandThisGameByPlayer?: Readonly<Record<string, number>>
  readonly beastsSummonedByPlayer: Readonly<Record<string, number>>
  readonly heroPowersUsedByPlayer: Readonly<Record<string, number>>
}

export interface ScheduledEffect {
  readonly id: string
  readonly sourceInstanceId: string
  readonly sourceCardId: CardId | null
  readonly controllerId: PlayerId
  /** Snapshot of the source/target context captured when the effect was queued. */
  readonly source?: RuntimeEntityReference
  readonly target?: RuntimeEntityReference
  readonly trigger: CardTrigger
  readonly actions: readonly Record<string, unknown>[]
  readonly executeOnTurn: number
  readonly duration?: string
}

export interface EffectTraceEntry {
  readonly revision: number
  readonly sourceInstanceId: string
  readonly sourceCardId: CardId | null
  readonly actionPath: string
  readonly trigger?: CardTrigger
  readonly eventType?: CardEventType
  readonly publicEventType?: string
  readonly correlation?: ResolutionCorrelation
}

/** Resolved movement from a visible board minion, independent of the effect's card. */
export interface MinionCardMovement {
  readonly sourceInstanceId: string
  readonly participantId: PlayerId
  readonly destination: 'hand' | 'deck' | 'discarded'
  readonly copy: boolean
  readonly cards: readonly OpeningCard[]
  /** Board/hand swaps consume a hand card and can retain its slot. */
  readonly replacedHandCard?: {
    readonly participantId: PlayerId
    readonly instanceId: string
  }
  /** Board/deck swaps consume a deck card and can retain its slot. */
  readonly replacedDeckCard?: {
    readonly participantId: PlayerId
    readonly instanceId: string
  }
  readonly handIndex?: number
}

export interface EffectDomainEvent {
  readonly type: 'effect-resolved'
  readonly revision: number
  readonly sourceInstanceId: string
  readonly sourceCardId: CardId | null
  /** Participant that owns the resolving effect context. */
  readonly controllerId: PlayerId
  readonly action: string
  readonly actionPath: string
  readonly cardMovement?: MinionCardMovement
  readonly eventType?: CardEventType
  readonly data?: Readonly<Record<string, unknown>>
  readonly correlation?: ResolutionCorrelation
}

/**
 * One concrete trigger frame that passed its runtime checks and is about to
 * resolve.  This is deliberately emitted from the resolver's trigger frame,
 * rather than reconstructed from the final state, so nested queues and repeat
 * activations retain their exact execution order.
 */
export interface TriggerActivatedEvent {
  readonly type: 'trigger-activated'
  readonly activationId: string
  readonly parentActivationId: string | null
  readonly eventSequence: number
  readonly eventType: CardEventType
  readonly participantId: PlayerId
  readonly source: {
    readonly instanceId: string
    readonly kind: RuntimeEntityKind
    readonly cardId: CardId | null
  }
  readonly trigger: CardTrigger
  readonly correlation: ResolutionCorrelation
}

/** An entity captured during one simultaneous death creation step. */
export interface DeathBatchEntry {
  readonly instanceId: string
  readonly participantId: PlayerId
  readonly kind: 'minion' | 'weapon'
  readonly cardId: CardId
  readonly position?: number
  readonly hasDeathrattle: boolean
}

/** Emitted after a death batch is captured and before its death events resolve. */
export interface DeathBatchStartedEvent {
  readonly type: 'death-batch-started'
  readonly batchId: string
  readonly deaths: readonly DeathBatchEntry[]
}

/** Emitted after all triggers and nested consequences for one death batch. */
export interface DeathBatchCompletedEvent {
  readonly type: 'death-batch-completed'
  readonly batchId: string
}

/** A generated minion entering play before its summon-trigger phase begins. */
export interface MinionSummonedEvent {
  readonly type: 'minion-summoned'
  readonly participantId: PlayerId
  readonly minion: BoardMinion
  readonly position: number
}

export interface ResolutionDiagnostic {
  readonly code:
    'unsupported-capability' | 'resolution-budget-exhausted' | 'resolution-failed'
  readonly message: string
  readonly sourceCardId: CardId | null
  readonly actionPath: string
  readonly recentQueue: readonly string[]
}

/** A minion in play. Stats are current values (base today; buffs later). */
export interface BoardMinion {
  readonly instanceId: string
  readonly cardId: CardId
  readonly attack: number
  readonly health: number
  readonly maxHealth: number
  /** Turn on which the minion entered play; it cannot attack the same turn (summoning sickness). */
  readonly summonedOnTurn: number
  /** Most recent turn on which control changed; normal control changes also exhaust it. */
  readonly controllerChangedOnTurn?: number
  /** Global turn number on which this minion last attacked, or null if it has not attacked. */
  readonly lastAttackedOnTurn: number | null
  readonly ownerId?: PlayerId
  readonly controllerId?: PlayerId
  readonly creationOrdinal?: number
  /** Timestamp for the minion's most recent entry into the play zone. */
  readonly playOrder?: number
  readonly baseAttack?: number
  readonly baseHealth?: number
  readonly keywords?: readonly CardKeyword[]
  readonly enchantments?: readonly RuntimeEnchantment[]
  readonly grantedTriggers?: readonly RuntimeGrantedTrigger[]
  readonly attachedEffects?: readonly RuntimeAttachedEffect[]
  readonly deathrattles?: readonly CardEffectBlock[]
  /** Private branch selected by a concealed Deathrattle effect. */
  readonly concealedDeathrattleChoice?: number
  readonly silenced?: boolean
  readonly frozenUntilTurn?: number | null
  readonly divineShield?: boolean
  readonly divineShieldConsumed?: boolean
  readonly stealth?: boolean
  readonly stealthRevealed?: boolean
  readonly immune?: boolean
  readonly spellImmune?: boolean
  readonly attacksUsedThisTurn?: number
  readonly maxAttacksPerTurn?: number
  /** Additional attacks earned this turn by effects such as Giant Sand Worm. */
  readonly extraAttacksThisTurn?: number
  readonly damageTaken?: number
  readonly triggerMultipliers?: Readonly<Record<string, number>>
  readonly spellDamage?: number
  readonly spellDamageMultiplier?: number
  readonly healingMultiplier?: number
  readonly heroPowerMultiplier?: number
  readonly dormant?: boolean
  readonly dormantProgress?: number
  readonly dormantProgressTurn?: number
  readonly rememberedSpellIds?: readonly CardId[]
}

/** A weapon equipped to a hero. Durability is current and maxDurability is its original value. */
export interface BoardWeapon {
  readonly instanceId: string
  readonly cardId: CardId
  /** Minions this exact weapon entity killed in combat. */
  readonly killedMinionCardIds?: readonly CardId[]
  readonly attack: number
  readonly durability: number
  readonly maxDurability: number
  readonly ownerId?: PlayerId
  readonly controllerId?: PlayerId
  readonly creationOrdinal?: number
  /** Timestamp for the weapon's most recent entry into the play zone. */
  readonly playOrder?: number
  readonly enchantments?: readonly RuntimeEnchantment[]
}

/**
 * A hero's own combat state. `attack` deliberately excludes weapon Attack;
 * `getHeroAttack` combines the two at the point where combat is resolved.
 * This keeps temporary/inherent hero Attack distinct from an equipped weapon.
 */
export interface PlayerHeroState {
  readonly health: number
  readonly maxHealth: number
  readonly armor: number
  readonly attack: number
  readonly lastAttackedOnTurn: number | null
  readonly instanceId?: string
  readonly creationOrdinal?: number
  readonly baseAttack?: number
  readonly baseMaxHealth?: number
  /** Immutable hero keywords before runtime enchantments are applied. */
  readonly baseKeywords?: readonly CardKeyword[]
  readonly keywords?: readonly CardKeyword[]
  readonly enchantments?: readonly RuntimeEnchantment[]
  readonly frozenUntilTurn?: number | null
  readonly immune?: boolean
  readonly spellImmune?: boolean
  readonly attacksUsedThisTurn?: number
  readonly maxAttacksPerTurn?: number
  readonly damageTaken?: number
  readonly spellDamage?: number
  readonly spellDamageMultiplier?: number
  readonly healingMultiplier?: number
  readonly heroPowerMultiplier?: number
  readonly maximumDamageTaken?: number
  readonly damageTakenMultiplier?: number
}

/** A player's mana crystals: available spendable mana and the grown maximum. */
export interface PlayerMana {
  readonly available: number
  readonly maximum: number
  /** Temporary mana that may raise available above permanent crystals this turn. */
  readonly temporary?: number
  readonly overloadLocked?: number
  readonly overloadNextTurn?: number
}

/**
 * A player's hero power. `cost` starts at the class definition's cost; future
 * card effects may raise or lower it (the renderer tints the cost red/green
 * accordingly). `available` is reset at the start of the owner's turn.
 */
export interface PlayerHeroPower {
  readonly id: HeroPowerId
  readonly creationOrdinal?: number
  readonly cost: number
  readonly available: boolean
  /** Activations made with the current power this turn; reset when an effect replaces it. */
  readonly usesThisTurn?: number
  readonly baseCost?: number
  readonly targetType?: string
  readonly targetingGranted?: string | null
  readonly effectOverride?: Readonly<{ readonly damage?: number }>
  readonly enchantments?: readonly RuntimeEnchantment[]
}

export interface PendingCostModifier {
  readonly operation?: 'set'
  readonly id: string
  readonly sourceInstanceId: string
  readonly amount: number
  readonly filter: Readonly<Record<string, unknown>>
  readonly duration?: string
  readonly startsOnTurn?: number
  readonly expiresOnTurn?: number
  /** Removes this modifier after the first matching card is played. */
  readonly consumeOnMatch?: boolean
}

export interface CthunProgression {
  readonly attack: number
  readonly health: number
  readonly taunt: boolean
}

export interface OpeningPlayerState {
  /** Original C'Thun ritual totals, independent of any physical card instance. */
  readonly cthun?: CthunProgression
  readonly cthunDied?: boolean
  readonly participantId: PlayerId
  readonly controllerKind: ControllerKind
  readonly heroId: HeroId
  readonly hero: PlayerHeroState
  readonly playerNumber: 1 | 2
  readonly deck: readonly OpeningCard[]
  /** Original drawable cards, used by effects that rebuild the starting deck. */
  readonly originalDeckCardIds?: readonly CardId[]
  readonly elementalPlayedLastTurn?: boolean
  readonly elementalsPlayedLastTurn?: number
  readonly quest?: {
    readonly cardId: CardId
    readonly rewardCardId: CardId
    readonly goal: NonNullable<
      import('../content/cards/card-definition').SpellCardDefinition['quest']
    >['goal']
    readonly progress: number
    readonly target: number
    readonly seenCardInstanceIds?: readonly string[]
    readonly playedNames?: Readonly<Record<string, number>>
  } | null
  readonly hand: readonly OpeningCard[]
  readonly revealedCards?: readonly OpeningCard[]
  readonly board: readonly BoardMinion[]
  readonly weapon: BoardWeapon | null
  readonly mana: PlayerMana
  readonly heroPower: PlayerHeroPower
  /** Persistent replacement cost for the player's current and future hero power. */
  readonly heroPowerCostOverride?: number
  /** Whether the original deck list contained at most one copy of every card. */
  readonly deckHasNoDuplicates?: boolean
  /** Damage dealt by the next failed draw; starts at 1 and rises after each fatigue hit. */
  readonly fatigueDamage: number
  readonly mulliganConfirmed: boolean
  readonly secrets?: readonly SecretState[]
  readonly graveyard?: readonly GraveyardMinion[]
  /** Cards that were discarded or burned and are no longer playable entities. */
  readonly discardedCards?: readonly OpeningCard[]
  readonly overload?: number
  /** The next spell played this turn consumes Health instead of Mana. */
  readonly nextSpellCostsHealth?: boolean
  /** One-shot discounts that apply when the next matching card is played. */
  readonly pendingCostModifiers?: readonly PendingCostModifier[]
  /** Turn-scoped count of Lock and Load rewards. */
  readonly lockAndLoadCount?: number
  readonly lockAndLoadTurn?: number
  /** Persistent counters used by expansion mechanics such as Jade Golems. */
  readonly counters?: Readonly<Record<string, number>>
}

export interface OpeningMatchState {
  /** Opening effect snapshots retained for skipped mulligans and checkpoint presentation. */
  readonly openingHistory?: readonly HistoryActionResolvedEvent[]
  readonly phase: OpeningPhase
  readonly playerOneId: PlayerId
  readonly playerTwoId: PlayerId
  readonly activePlayerId: PlayerId | null
  readonly turnNumber: number
  readonly winnerId: PlayerId | null
  readonly loserId: PlayerId | null
  readonly players: readonly [OpeningPlayerState, OpeningPlayerState]
  readonly revision: number
  readonly history?: MatchHistory
  readonly effectTrace?: readonly EffectTraceEntry[]
  readonly nextEntityOrdinal?: number
  readonly turnLimitSeconds?: number | null
  readonly turnStartedAtRevision?: number | null
  readonly pendingResolution?: boolean
  /** A private, blocking card choice created by a Discover effect. */
  readonly pendingDiscover?: PendingDiscoverChoice
  /** A blocking after-placement Choice owned by one participant. */
  readonly pendingCardChoice?: PendingCardChoice
  readonly scheduledEffects?: readonly ScheduledEffect[]
}

export interface PendingDiscoverChoice {
  /** Public source for a bonus with no physical played card. */
  readonly publicSourceCardId?: CardId
  readonly participantId: PlayerId
  readonly sourceCardInstanceId: string
  readonly candidates: readonly OpeningCard[]
  readonly origin?:
    | 'deck'
    | 'deck-copy'
    | 'dead-minions'
    | 'generated'
    | 'opponent-deck'
    | 'opponent-deck-guess'
  /** Private answer for effects that offer a hidden correct Discover choice. */
  readonly correctCandidateInstanceId?: string
  readonly continuation?: PendingDiscoverContinuation
  readonly queued?: readonly Omit<PendingDiscoverChoice, 'queued'>[]
}

export interface PendingDiscoverContinuation {
  readonly source: Readonly<{
    readonly instanceId: string
    readonly kind: RuntimeEntityKind
    readonly participantId: PlayerId
    readonly zone: RuntimeZone
    readonly cardId?: CardId
  }>
  readonly sourceCardId: CardId | null
  readonly controllerId: PlayerId
  readonly chosenTargets: readonly Readonly<{
    readonly instanceId: string
    readonly kind: RuntimeEntityKind
    readonly participantId: PlayerId
    readonly zone: RuntimeZone
    readonly cardId?: CardId
  }>[]
  readonly choiceIndex?: number
  readonly actions: readonly Record<string, unknown>[]
  readonly actionPath: string
  readonly event?: Readonly<Record<string, unknown>>
  readonly storeAs?: string
}

export interface CardChoiceOption {
  readonly choice: number
  readonly label: string
  /** Existing card definition used to render a full-card option when available. */
  readonly presentationCardId?: CardId
  /** Parent card's printed cost, displayed without charging for the choice again. */
  readonly presentationCost?: number
  /** Hero power rendered as a constructed discovery option when present. */
  readonly presentationHeroPowerId?: HeroPowerId
}

export interface PendingCardChoice {
  readonly participantId: PlayerId
  readonly sourceCardInstanceId: string
  readonly sourceCardId: CardId
  readonly options: readonly CardChoiceOption[]
  readonly resolution?:
    | { readonly type: 'bonus-spell' }
    | {
        readonly type: 'adapt'
        readonly targetInstanceId: string
        readonly remaining: number
      }
    | {
        readonly type: 'hero-power'
        readonly heroPowerIds: readonly HeroPowerId[]
      }
    | {
        readonly type: 'hero-power-use'
        readonly heroPowerId: HeroPowerId
      }
    | {
        readonly type: 'kazakus-potion'
        readonly stage: 'cost' | 'first-ingredient' | 'second-ingredient'
        readonly costOptions: readonly KazakusPotionCostOption[]
        readonly selectedCostOption?: KazakusPotionCostOption
        readonly firstIngredientOffers?: readonly CardId[]
        readonly selectedFirstIngredient?: CardId
        readonly secondIngredientOffers?: readonly CardId[]
      }
  readonly queued?: readonly Omit<PendingCardChoice, 'queued'>[]
}

export interface KazakusPotionCostOption {
  readonly cost: number
  readonly presentationCardId: CardId
  readonly ingredientPool: readonly CardId[]
  readonly recipes: readonly KazakusPotionRecipe[]
}

export interface KazakusPotionRecipe {
  readonly ingredients: readonly CardId[]
  readonly cardId: CardId
}

export interface ConfirmMulliganCommand {
  readonly type: 'confirm-mulligan'
  readonly participantId: PlayerId
  readonly replaceInstanceIds: readonly string[]
}

export interface EndTurnCommand {
  readonly type: 'end-turn'
  readonly participantId: PlayerId
}

export interface UseHeroPowerCommand {
  readonly type: 'use-hero-power'
  readonly participantId: PlayerId
  readonly target?: HeroPowerTargetRef
  readonly choice?: number
}

export type HeroPowerTargetRef =
  | { readonly kind: 'hero'; readonly participantId: PlayerId }
  | {
      readonly kind: 'minion'
      readonly participantId: PlayerId
      readonly instanceId: string
    }

export type CardPlayTargetRef =
  | { readonly kind: 'hero'; readonly participantId: PlayerId }
  | {
      readonly kind: 'minion'
      readonly participantId: PlayerId
      readonly instanceId: string
    }
  | {
      readonly kind: 'weapon'
      readonly participantId: PlayerId
      readonly instanceId: string
    }
  | {
      readonly kind: 'card'
      readonly participantId: PlayerId
      readonly instanceId: string
      /** Presentation metadata for card-choice interfaces such as Tracking. */
      readonly cardId?: CardId
      readonly zone?: 'deck' | 'hand' | 'revealed' | 'discarded'
    }
  | {
      readonly kind: 'secret'
      readonly participantId: PlayerId
      readonly instanceId: string
    }

/** Canonical card-play request for every card type. */
export interface PlayCardCommand {
  readonly type: 'play-card'
  readonly participantId: PlayerId
  readonly cardInstanceId: string
  readonly position?: number
  readonly targets?: readonly CardPlayTargetRef[]
  readonly choice?: number
}

export interface ChooseDiscoverCardCommand {
  readonly type: 'choose-discover-card'
  readonly participantId: PlayerId
  readonly cardInstanceId: string
}

export interface ChooseCardOptionCommand {
  readonly type: 'choose-card-option'
  readonly participantId: PlayerId
  readonly sourceCardInstanceId: string
  readonly choice: number
}

export interface TimeoutCommand {
  readonly type: 'timeout'
  readonly participantId: PlayerId
  /** Monotonic domain-provided elapsed time; wall-clock access stays outside the match. */
  readonly elapsedSeconds?: number
}

export type AttackCharacterRef =
  { readonly kind: 'hero' } | { readonly kind: 'minion'; readonly instanceId: string }

/** General direct-attack command. References are relative to the command owner. */
export interface AttackCharacterCommand {
  readonly type: 'attack-character'
  readonly participantId: PlayerId
  readonly attacker: AttackCharacterRef
  readonly defender: AttackCharacterRef
}

export interface DevAddCardCommand {
  readonly type: 'dev-add-card'
  readonly participantId: PlayerId
  readonly cardId: CardId
}

export interface DevSetManaCommand {
  readonly type: 'dev-set-mana'
  readonly participantId: PlayerId
  readonly available: number
  readonly maximum: number
}

export type DevDeckAction = 'destroy' | 'refill'

export interface DevModifyDeckCommand {
  readonly type: 'dev-modify-deck'
  readonly participantId: PlayerId
  readonly action: DevDeckAction
}

export interface DevSummonMinionCommand {
  readonly type: 'dev-summon-minion'
  readonly participantId: PlayerId
  readonly cardId: CardId
}

export interface DevEndMatchCommand {
  readonly type: 'dev-end-match'
  readonly participantId: PlayerId
  readonly winnerId: PlayerId
}

export interface DevSetHeroCommand {
  readonly type: 'dev-set-hero'
  readonly participantId: PlayerId
  readonly health?: number
  readonly armor?: number
  readonly attack?: number
}
export interface DevSetHeroPowerCommand {
  readonly type: 'dev-set-hero-power'
  readonly participantId: PlayerId
  readonly cost?: number
  readonly available?: boolean
}
export interface DevClearZoneCommand {
  readonly type: 'dev-clear-zone'
  readonly participantId: PlayerId
  readonly zone: 'hand' | 'board'
}
export interface DevSetFatigueCommand {
  readonly type: 'dev-set-fatigue'
  readonly participantId: PlayerId
  readonly nextDamage: number
}
export interface DevRemoveWeaponCommand {
  readonly type: 'dev-remove-weapon'
  readonly participantId: PlayerId
}
export interface DevDrawCommand {
  readonly type: 'dev-draw'
  readonly participantId: PlayerId
}

export type OpeningMatchCommand =
  | { readonly type: 'concede'; readonly participantId: PlayerId }
  | ConfirmMulliganCommand
  | EndTurnCommand
  | UseHeroPowerCommand
  | PlayCardCommand
  | ChooseDiscoverCardCommand
  | ChooseCardOptionCommand
  | TimeoutCommand
  | AttackCharacterCommand
  | DevAddCardCommand
  | DevSetManaCommand
  | DevModifyDeckCommand
  | DevSummonMinionCommand
  | DevEndMatchCommand
  | DevSetHeroCommand
  | DevSetHeroPowerCommand
  | DevClearZoneCommand
  | DevSetFatigueCommand
  | DevRemoveWeaponCommand
  | DevDrawCommand

export interface MulliganResolvedEvent {
  readonly type: 'mulligan-resolved'
  readonly participantId: PlayerId
  readonly returnedCards: readonly OpeningCard[]
  readonly replacementCards: readonly OpeningCard[]
}

export interface CoinGrantedEvent {
  readonly type: 'coin-granted'
  readonly participantId: PlayerId
  readonly card: OpeningCard
}

export interface OpeningTurnStartedEvent {
  readonly type: 'opening-turn-started'
  readonly participantId: PlayerId
  readonly playerNumber: 1 | 2
  readonly mana: PlayerMana
}

export interface OpeningCardDrawnEvent {
  readonly type: 'opening-card-drawn'
  readonly participantId: PlayerId
  readonly card: OpeningCard
}

export interface TurnStartedEvent {
  readonly type: 'turn-started'
  readonly participantId: PlayerId
  readonly turnNumber: number
  readonly mana: PlayerMana
}

export interface CardDrawnEvent {
  readonly type: 'card-drawn'
  /** Absent for choice results and other additions that are not deck draws. */
  readonly origin?: 'deck'
  readonly participantId: PlayerId
  readonly card: OpeningCard
}

/** A newly-created card entering a hand as the result of an effect, not a deck draw. */
export interface DiscoverStartedEvent {
  readonly type: 'discover-started'
  readonly participantId: PlayerId
  readonly sourceCardInstanceId: string
  readonly candidates: readonly OpeningCard[]
}

export interface CardChoiceStartedEvent {
  readonly type: 'card-choice-started'
  readonly participantId: PlayerId
  readonly sourceCardInstanceId: string
  readonly sourceCardId: CardId
  readonly options: readonly CardChoiceOption[]
}

export interface CardGeneratedEvent {
  readonly type: 'card-generated'
  readonly participantId: PlayerId
  readonly card: OpeningCard
  readonly origin:
    | { readonly kind: 'minion'; readonly instanceId: string }
    | { readonly kind: 'deck'; readonly participantId: PlayerId }
    | { readonly kind: 'screen-center' }
}

export interface CardBurnedEvent {
  readonly type: 'card-burned'
  /** Distinguishes overdraw from cards explicitly destroyed in the deck. */
  readonly origin?: 'deck' | 'deck-destruction'
  readonly participantId: PlayerId
  readonly card: OpeningCard
}

export interface HeroPowerUsedEvent {
  readonly type: 'hero-power-used'
  readonly participantId: PlayerId
  readonly heroPowerId: HeroPowerId
  readonly target?: HeroPowerTargetRef
  readonly cost: number
  readonly mana: PlayerMana
}

/** A presentation-safe cue emitted when one Hero Power identity replaces another. */
export interface HeroPowerReplacedEvent {
  readonly type: 'hero-power-replaced'
  readonly participantId: PlayerId
  readonly previousHeroPowerId: HeroPowerId
  readonly heroPowerId: HeroPowerId
  /**
   * Presentation-safe identity of the effect source that replaced the power
   * (e.g. the Justicar Trueheart instance). Optional so older history and
   * tests stay valid; appearance lookups only.
   */
  readonly sourceInstanceId?: string
  readonly sourceCardId?: CardId | null
}

export interface CharacterDamagedEvent {
  readonly type: 'character-damaged'
  readonly source: 'hero-power' | 'fatigue'
  readonly participantId: PlayerId
  readonly character:
    { readonly kind: 'hero' } | { readonly kind: 'minion'; readonly instanceId: string }
  readonly amount: number
  /** Full resolved damage used by presentation before effective-loss caps. */
  readonly attemptedAmount?: number
  readonly healthBefore: number
  readonly healthAfter: number
  readonly armorBefore: number
  readonly armorAfter: number
  readonly destroyed: boolean
}

export interface CharacterHealedEvent {
  readonly type: 'character-healed'
  readonly participantId: PlayerId
  readonly character:
    { readonly kind: 'hero' } | { readonly kind: 'minion'; readonly instanceId: string }
  readonly amount: number
  /** Full resolved healing used by presentation before over-healing caps. */
  readonly attemptedAmount?: number
  readonly healthBefore: number
  readonly healthAfter: number
}

export interface ArmorGainedEvent {
  readonly type: 'armor-gained'
  readonly participantId: PlayerId
  readonly amount: number
  readonly armorBefore: number
  readonly armorAfter: number
}

export interface HeroPowerMinionSummonedEvent {
  readonly type: 'hero-power-minion-summoned'
  readonly participantId: PlayerId
  readonly minion: BoardMinion
  readonly position: number
}

export interface FatigueEvent {
  readonly type: 'fatigue'
  readonly participantId: PlayerId
  readonly amount: number
  readonly nextDamage: number
}

export interface MinionPlayedEvent {
  readonly type: 'minion-played'
  readonly participantId: PlayerId
  readonly minion: BoardMinion
  readonly position: number
}

/**
 * Emitted right before each repetition pass of a played minion's Battlecry so
 * the presentation layer can gate the visible trigger behind an animation.
 */
export interface BattlecryRepetitionStartedEvent {
  readonly type: 'battlecry-repetition-started'
  readonly participantId: PlayerId
  readonly minion: BoardMinion
  /** Zero-based index of this repetition pass; 0 for single-trigger Battlecries. */
  readonly repetition: number
  /** Total number of passes the Battlecry will run (2 with Brann Bronzebeard). */
  readonly repetitions: number
}

export interface WeaponEquippedEvent {
  readonly type: 'weapon-equipped'
  readonly participantId: PlayerId
  readonly weapon: BoardWeapon
  readonly replacedWeapon: BoardWeapon | null
}

export interface HeroReplacedEvent {
  readonly type: 'hero-replaced'
  readonly participantId: PlayerId
  readonly previousHeroId: HeroId
  readonly heroId: HeroId
  readonly armorGained: number
  /** Presentation-safe identity of the hero card that replaced the hero. */
  readonly sourceInstanceId?: string
  readonly sourceCardId?: CardId | null
}

/**
 * Cue emitted once an attack has passed its redirect/cancellation windows and
 * immediately before combat damage is applied.  Keeping this separate from
 * the resolved result lets the renderer begin the attack motion while damage,
 * reactive triggers, and deaths continue to resolve in their authored order.
 */
export interface CombatStartedCombatant {
  readonly participantId: PlayerId
  readonly character: AttackCharacterRef
  readonly attack: number
  readonly healthBefore: number
  readonly armorBefore: number
  /** Immunity at impact, before this-attack enchantments expire. */
  readonly immune?: boolean
}

export interface CombatStartedEvent {
  readonly type: 'combat-started'
  readonly combatId: string
  readonly attacker: CombatStartedCombatant
  readonly defender: CombatStartedCombatant
}

export interface MinionCombatantResult {
  readonly participantId: PlayerId
  readonly instanceId: string
  readonly attack: number
  readonly damageDealt: number
  /** Incoming damage selected for display before Health caps or prevention. */
  readonly attemptedDamage: number
  readonly healthBefore: number
  readonly healthAfter: number
  readonly destroyed: boolean
  readonly divineShieldConsumed?: boolean
}

export interface MinionCombatPreview {
  readonly attackerHealthAfter: number
  readonly defenderHealthAfter: number
  readonly attackerDestroyed: boolean
  readonly defenderDestroyed: boolean
}

export interface MinionCombatResolvedEvent {
  readonly type: 'minion-combat-resolved'
  readonly combatId?: string
  readonly attacker: MinionCombatantResult
  readonly defender: MinionCombatantResult
}

export interface CharacterCombatantResult {
  readonly participantId: PlayerId
  readonly character: AttackCharacterRef
  readonly attack: number
  readonly damageDealt: number
  /** Incoming damage selected for display before Health or Armor caps. */
  readonly attemptedDamage: number
  readonly healthBefore: number
  readonly healthAfter: number
  readonly armorBefore: number
  readonly armorAfter: number
  readonly destroyed: boolean
  readonly divineShieldConsumed?: boolean
}

export interface CharacterCombatResolvedEvent {
  readonly type: 'character-combat-resolved'
  readonly combatId?: string
  readonly attacker: CharacterCombatantResult
  readonly defender: CharacterCombatantResult
  readonly weapon: {
    readonly participantId: PlayerId
    readonly durabilityBefore: number
    readonly durabilityAfter: number
    readonly destroyed: boolean
  } | null
}

export interface MatchEndedEvent {
  readonly type: 'match-ended'
  /** Both values are null when simultaneous hero lethal ends in a draw. */
  readonly winnerId: PlayerId | null
  readonly loserId: PlayerId | null
  readonly reason:
    'hero-health-depleted' | 'simultaneous-hero-lethal' | 'dev-forced' | 'concede'
}

export interface DevCardAddedEvent {
  readonly type: 'dev-card-added'
  readonly participantId: PlayerId
  readonly card: OpeningCard
}

export interface DevManaSetEvent {
  readonly type: 'dev-mana-set'
  readonly participantId: PlayerId
  readonly mana: PlayerMana
}

export interface DevDeckModifiedEvent {
  readonly type: 'dev-deck-modified'
  readonly participantId: PlayerId
  readonly action: DevDeckAction
  readonly deckCount: number
}

export interface DevMinionSummonedEvent {
  readonly type: 'dev-minion-summoned'
  readonly participantId: PlayerId
  readonly minion: BoardMinion
  readonly position: number
}

export interface DevStateChangedEvent {
  readonly type: 'dev-state-changed'
  readonly participantId: PlayerId
}

/** A stable, presentation-safe character/entity captured when an action resolves. */
export interface HistoryEntitySnapshot {
  readonly zone?: RuntimeZone
  readonly ownerId?: PlayerId
  readonly knownTo?: readonly PlayerId[]
  readonly publicIdentity?: boolean
  readonly attack?: number
  readonly health?: number
  readonly maxHealth?: number
  readonly armor?: number
  readonly durability?: number
  readonly maxDurability?: number
  readonly keywords?: readonly CardKeyword[]
  readonly silenced?: boolean
  readonly frozen?: boolean
  readonly divineShield?: boolean
  readonly immune?: boolean
  readonly spellDamage?: number
  readonly rulesText?: string
  readonly abilities?: readonly string[]
  /** Explicit placeholder for a concealed played Secret; null alone is ambiguous. */
  readonly concealedAs?: 'secret'
  /** Cast-time identity of an automatic Secret, private even if previously known. */
  readonly secretCast?: boolean
  /** Stable action-time identity used to group several effects on one target. */
  readonly id: string
  readonly participantId: PlayerId
  readonly kind: 'hero' | 'minion' | 'weapon' | 'card' | 'hidden'
  readonly cardId: CardId | null
  readonly heroId?: HeroId
  /** Present when a history source represents a hero-power activation. */
  readonly heroPowerId?: HeroPowerId
  readonly baseCost?: number
  readonly currentCost?: number
}

/** One public result belonging to a single played card, power, or combat action. */
export interface HistoryActionOutcome {
  readonly kind:
    | 'cast-spell'
    | 'damage'
    | 'death'
    | 'summon-board'
    | 'create-hand'
    | 'destroy'
    | 'buff'
    | 'heal'
    | 'armor'
    | 'draw'
    | 'fatigue'
    | 'freeze'
    | 'silence'
    | 'shield-lost'
    | 'prevented'
    | 'return-hand'
    | 'shuffle-deck'
    | 'discard'
    | 'burn'
    | 'transform'
    | 'control'
    | 'equip'
    | 'state'
  readonly target: HistoryEntitySnapshot
  readonly before?: HistoryEntitySnapshot
  readonly armorDamage?: number
  readonly healthDamage?: number
  readonly amount?: number
  readonly attackDelta?: number
  readonly healthDelta?: number
}

/**
 * A complete, immutable history milestone. It deliberately contains snapshots
 * rather than live instance ids, so a later death or transform cannot change
 * what the player saw in their action history.
 */
export interface HistoryActionResolvedEvent {
  readonly entryId?: string
  readonly parentActionId?: string
  readonly append?: boolean
  readonly type: 'history-action-resolved'
  readonly participantId: PlayerId
  readonly action: 'card' | 'hero-power' | 'combat' | 'trigger' | 'fatigue'
  readonly source: HistoryEntitySnapshot
  readonly outcomes: readonly HistoryActionOutcome[]
}

/** Internal, event-time facts. Removed when projecting events to a viewer. */
export interface HistoryEffectRecordedEvent {
  readonly type: 'history-effect-recorded'
  readonly causeId: string
  readonly parentActionId: string
  readonly source: HistoryEntitySnapshot
  readonly outcomes: readonly HistoryActionOutcome[]
}

/** Internal playback boundaries; snapshots must never enter viewer/AI projections. */
export type RandomSpellPresentationEvent = (
  | { readonly type: 'random-spell-started' }
  | { readonly type: 'random-spell-completed' }
) & {
  readonly castId: string
  readonly participantId: PlayerId
  readonly cardId: CardId
  readonly state: OpeningMatchState
}

/** Internal Secret playback gates; never expose their state to viewers or AI. */
export type SecretPresentationEvent = (
  | { readonly type: 'secret-resolution-started' }
  | { readonly type: 'secret-resolution-completed' }
) & {
  readonly secretId: string
  readonly participantId: PlayerId
  readonly cardId: CardId
  readonly state: OpeningMatchState
}

export type OpeningMatchEvent =
  | SecretPresentationEvent
  | RandomSpellPresentationEvent
  | MulliganResolvedEvent
  | CoinGrantedEvent
  | OpeningTurnStartedEvent
  | OpeningCardDrawnEvent
  | TurnStartedEvent
  | CardDrawnEvent
  | DiscoverStartedEvent
  | CardChoiceStartedEvent
  | CardGeneratedEvent
  | CardBurnedEvent
  | HeroPowerUsedEvent
  | HeroPowerReplacedEvent
  | CharacterDamagedEvent
  | CharacterHealedEvent
  | ArmorGainedEvent
  | HeroPowerMinionSummonedEvent
  | FatigueEvent
  | MinionPlayedEvent
  | BattlecryRepetitionStartedEvent
  | WeaponEquippedEvent
  | HeroReplacedEvent
  | CombatStartedEvent
  | MinionCombatResolvedEvent
  | CharacterCombatResolvedEvent
  | MatchEndedEvent
  | DevCardAddedEvent
  | DevManaSetEvent
  | DevDeckModifiedEvent
  | DevMinionSummonedEvent
  | DevStateChangedEvent
  | HistoryActionResolvedEvent
  | HistoryEffectRecordedEvent
  | TriggerActivatedEvent
  | DeathBatchStartedEvent
  | DeathBatchCompletedEvent
  | MinionSummonedEvent
  | EffectDomainEvent

export interface OpeningAcceptedResult {
  readonly accepted: true
  readonly state: OpeningMatchState
  readonly events: readonly OpeningMatchEvent[]
}

export type OpeningRejectionCode =
  | 'invalid-command'
  | 'unknown-participant'
  | 'wrong-phase'
  | 'already-confirmed'
  | 'invalid-card-selection'
  | 'not-active-player'
  | 'hero-power-unavailable'
  | 'insufficient-mana'
  | 'not-a-minion'
  | 'not-a-weapon'
  | 'not-a-hero'
  | 'board-full'
  | 'invalid-position'
  | 'invalid-attacker'
  | 'invalid-target'
  | 'minion-cannot-attack'
  | 'hero-cannot-attack'
  | 'match-ended'
  | 'hand-full'
  | 'unknown-card'
  | 'invalid-mana'
  | 'missing-input'
  | 'extra-input'
  | 'duplicate-target'
  | 'stale-target'
  | 'wrong-zone'
  | 'wrong-controller'
  | 'illegal-target'
  | 'immune-target'
  | 'unsupported-effect'
  | 'resolution-failed'
  | 'resolution-budget-exhausted'
  | 'timeout-unavailable'
  | 'discover-pending'

export interface OpeningRejectedResult {
  readonly accepted: false
  readonly code: OpeningRejectionCode
  readonly message: string
  readonly state: OpeningMatchState
  readonly events: readonly []
  readonly diagnostic?: ResolutionDiagnostic
}

export type OpeningCommandResult = OpeningAcceptedResult | OpeningRejectedResult

export interface OpeningMatchAnalysis {
  getState(): OpeningMatchState
  /** Returns the same fair, perspective-limited observation used by AI players. */
  getAiObservation?(participantId: PlayerId, policy: AiInformationPolicy): AiObservation
  dispatch(command: unknown): OpeningCommandResult
  getPlayInput(
    participantId: PlayerId,
    cardInstanceId: string,
    choice?: number
  ): PlayCardInput | null
  getLegality(participantId: PlayerId): MatchLegality
  getAttackLegality?(
    participantId: PlayerId
  ): Pick<MatchLegality, 'legalAttackerInstanceIds' | 'legalAttackTargets'>
  /** Runs a nested isolated branch from the analysis fork's current state. */
  analyze<T>(operation: (fork: OpeningMatchAnalysis) => T): T
}

/**
 * Structured-clone-safe snapshot used to continue deterministic analysis in a
 * worker without sharing the renderer's live match instance.
 */
export interface OpeningMatchCheckpoint {
  readonly schemaVersion: 1
  readonly setup: MatchSetup
  readonly decks: readonly Deck[]
  readonly state: OpeningMatchState
  readonly rngState: unknown
  readonly nextEntityOrdinal: number
  readonly devDeckRefillCounter: number
}

export interface OpeningMatchInstance {
  readonly setup: MatchSetup
  getState(): OpeningMatchState
  /** Captures every mutable engine value needed for deterministic restoration. */
  getCheckpoint(): OpeningMatchCheckpoint
  dispatch(command: unknown): OpeningCommandResult
  /**
   * Executes a command against an isolated snapshot of the current match.
   * The live state, entity sequence, development counters, and RNG are restored
   * before this method returns.
   */
  preview(command: unknown): OpeningCommandResult
  /** Executes a command sequence against one isolated fork and returns its final result. */
  previewSequence(commands: readonly unknown[]): OpeningCommandResult
  /** Runs bounded analysis against an isolated mutable fork, then restores all live state. */
  analyze<T>(operation: (fork: OpeningMatchAnalysis) => T): T
  /** Runs bounded analysis with an independent deterministic RNG seed. */
  analyzeWithSeed<T>(seed: number, operation: (fork: OpeningMatchAnalysis) => T): T
  getPlayInput?(
    participantId: PlayerId,
    cardInstanceId: string,
    choice?: number
  ): PlayCardInput | null
  getLegality?(participantId: PlayerId): MatchLegality
  getAttackLegality?(
    participantId: PlayerId
  ): Pick<MatchLegality, 'legalAttackerInstanceIds' | 'legalAttackTargets'>
  getEffectTrace?(): readonly EffectTraceEntry[]
  getPublicState?(participantId: PlayerId): OpeningMatchPublicState
  getAiObservation?(participantId: PlayerId, policy: AiInformationPolicy): AiObservation
  getPublicEvents?(
    participantId: PlayerId,
    events: readonly OpeningMatchEvent[]
  ): readonly OpeningMatchPublicEvent[]
}

export type PublicizeOpeningMatchEvent<E> = E extends
  RandomSpellPresentationEvent | SecretPresentationEvent
  ? never
  : E extends EffectDomainEvent
    ? Omit<E, 'sourceCardId' | 'data' | 'cardMovement'> & {
        readonly sourceCardId: CardId | null
        readonly data?: Readonly<Record<string, unknown>>
        readonly cardMovement?: Omit<MinionCardMovement, 'cards'> & {
          readonly cards: readonly OpeningPublicCard[]
        }
      }
    : E extends MulliganResolvedEvent
      ? Omit<E, 'returnedCards' | 'replacementCards'> & {
          readonly returnedCards: readonly OpeningPublicCard[]
          readonly replacementCards: readonly OpeningPublicCard[]
        }
      : E extends DiscoverStartedEvent
        ? Omit<E, 'candidates'> & { readonly candidates: readonly OpeningPublicCard[] }
        : E extends
              | CoinGrantedEvent
              | OpeningCardDrawnEvent
              | CardDrawnEvent
              | CardGeneratedEvent
              | CardBurnedEvent
              | DevCardAddedEvent
          ? Omit<E, 'card'> & { readonly card: OpeningPublicCard }
          : E

export type OpeningMatchPublicEvent = PublicizeOpeningMatchEvent<OpeningMatchEvent>
type PublicPendingDiscoverEntry = Omit<
  PendingDiscoverChoice,
  'candidates' | 'continuation' | 'correctCandidateInstanceId' | 'queued'
> & {
  readonly candidates: readonly OpeningPublicCard[]
}

export interface OpeningMatchPublicState extends Omit<
  OpeningMatchState,
  | 'players'
  | 'history'
  | 'effectTrace'
  | 'pendingDiscover'
  | 'pendingCardChoice'
  | 'scheduledEffects'
> {
  readonly players: readonly [OpeningPublicPlayerState, OpeningPublicPlayerState]
  readonly pendingDiscover?: PublicPendingDiscoverEntry & {
    readonly queued?: readonly PublicPendingDiscoverEntry[]
  }
  readonly pendingCardChoice?: PendingCardChoice
}

export type OpeningPublicCard = Omit<
  OpeningCard,
  | 'cardId'
  | 'baseCost'
  | 'currentCost'
  | 'attack'
  | 'health'
  | 'costAdjustments'
  | 'enchantments'
  | 'knownTo'
  | 'startedInDeck'
  | 'concealedDeathrattleChoice'
> & {
  readonly cardId: CardId | null
  readonly concealedDeathrattleChoice?: number
  readonly baseCost?: number | null
  readonly currentCost?: number | null
  readonly attack?: number | null
  readonly health?: number | null
  readonly costAdjustments?: readonly RuntimeCostAdjustment[]
  readonly enchantments?: readonly RuntimeEnchantment[]
}

export type OpeningPublicPlayerState = Omit<
  OpeningPlayerState,
  | 'secrets'
  | 'deck'
  | 'hand'
  | 'revealedCards'
  | 'discardedCards'
  | 'pendingCostModifiers'
  | 'originalDeckCardIds'
> & {
  readonly deck: readonly OpeningPublicCard[]
  readonly hand: readonly OpeningPublicCard[]
  readonly revealedCards?: readonly OpeningPublicCard[]
  readonly discardedCards?: readonly OpeningPublicCard[]
  readonly secrets: readonly (Omit<SecretState, 'cardId'> & {
    readonly cardId: CardId | null
  })[]
}

export interface PlayCardInput {
  /** Own-hand condition facts only; not a prediction of targets or intervening effects. */
  readonly battlecryConditions?: readonly BattlecryConditionFact[]
  readonly participantId: PlayerId
  readonly cardInstanceId: string
  readonly cardId: CardId
  readonly currentCost: number
  readonly requiresPosition: boolean
  readonly legalPositions: readonly number[]
  readonly targetSelectors: readonly Readonly<Record<string, unknown>>[]
  /** Candidate references for each selector, in selector order, after immunity filtering. */
  readonly legalTargetOptions: readonly (readonly CardPlayTargetRef[])[]
  /** Engine-selected targets when Mayor Noggenfogger's aura is active. */
  readonly randomizedTargetSelectors?: readonly Readonly<Record<string, unknown>>[]
  readonly targetSelectionRandomized?: boolean
  readonly choiceCount: number
  readonly skipTargetedBattlecry: boolean
  /** Zero-based choices accepted by the command, exposed for renderer input. */
  readonly legalChoices: readonly number[]
  /** Stable, presentation-ready descriptors aligned with legalChoices. */
  readonly choiceOptions: readonly CardChoiceOption[]
  /** Self-transforming minions enter play before asking the owning player. */
  readonly choiceTiming: 'before-play' | 'after-placement'
  /** Whether the current condition enhances the card's active effect. */
  readonly effectPreview: CardPlayEffectPreview | null
}

export interface BattlecryConditionFact {
  readonly effectIndex: number
  readonly status: 'met' | 'not-met' | 'unknown'
  readonly requirement: string
  readonly qualifyingCardInstanceIds?: readonly string[]
}

/** Domain-derived presentation data for a card about to be played. */
export interface CardPlayEffectPreview {
  /** True when an active conditional branch is stronger than an alternative branch. */
  readonly conditionallyEnhanced: boolean
}

export interface MatchLegality {
  readonly canEndTurn: boolean
  readonly playableCardInstanceIds: readonly string[]
  readonly legalAttackerInstanceIds: readonly string[]
  readonly legalAttackTargets: Readonly<Record<string, readonly AttackCharacterRef[]>>
  readonly legalHeroPower: boolean
  /** Legal targets for the effective hero power, after aura-derived targeting changes. */
  readonly legalHeroPowerTargets: readonly HeroPowerTargetRef[]
  /** Active Mayor Noggenfogger auras resolve manual target choices randomly. */
  readonly targetSelectionRandomized?: boolean
  readonly legalTargets: Readonly<Record<string, readonly CardPlayTargetRef[]>>
}
