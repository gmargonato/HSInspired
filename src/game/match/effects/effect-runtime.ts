import {
  CARD_CATALOG,
  CARD_KEYWORDS,
  CARD_TRIGGERS,
  GENERATED_CARD_DEFINITIONS,
  type CardAction,
  type CardDefinition,
  type CardEffectBlock,
  type CardEventType,
  type CardId,
  type CardKeyword,
  type CardSummonPlacement,
  type CardTrigger
} from '../../content/cards'
import { HERO_CATALOG } from '../../content/heroes'
import { BASIC_HERO_POWER_UPGRADES, HERO_POWER_CATALOG } from '../../content/hero-powers'
import { createSeededRng, type DeterministicRng } from '../rng'
import type {
  CardPlayTargetRef,
  CardChoiceOption,
  CardPlayEffectPreview,
  AttackCharacterRef,
  CombatStartedEvent,
  DeathBatchCompletedEvent,
  DeathBatchStartedEvent,
  EffectDomainEvent,
  EffectTraceEntry,
  GraveyardMinion,
  MatchHistory,
  MatchLegality,
  MinionSummonedEvent,
  OpeningCard,
  OpeningMatchEvent,
  OpeningMatchState,
  OpeningPlayerState,
  PlayCardInput,
  HeroPowerTargetRef,
  RuntimeCostAdjustment,
  RuntimeAttachedEffect,
  RuntimeEnchantment,
  RuntimeEntityKind,
  RuntimeEntityReference,
  RuntimeGrantedTrigger,
  RuntimeZone,
  ScheduledEffect,
  SecretState,
  TriggerActivatedEvent
} from '../opening-match-types'
import type {
  PlayerHeroState,
  BoardMinion,
  BoardWeapon,
  ResolutionDiagnostic,
  CharacterCombatantResult
} from '../opening-match-types'
import type { PlayerId } from '../match-types'
import {
  UnsupportedEffectCapabilityError,
  inspectCardCapabilities,
  runtimeCapabilityKeys
} from './capability'
import { insertCardIntoPlayer, removeCardFromPlayer } from '../rules/zone-state'
import { assertOpeningMatchInvariants } from '../rules/invariants'
import {
  boardMinionAttacksUsed,
  effectiveBoardMinionKeywords,
  hasBoardMinionEntryExhaustion
} from '../rules/minion-attack-state'
import type { ResolutionCorrelation, TriggerEventContract } from '../contracts'
import {
  DEFAULT_RESOLUTION_BUDGET,
  ResolutionQueue,
  ResolutionQueueBudgetError,
  type ResolutionQueueKind
} from './resolution-queue'

const MAX_HAND_SIZE = 10
const MAX_BOARD_SIZE = 7
const MAX_MANA = 10
const MAX_RESOLUTION_STEPS = DEFAULT_RESOLUTION_BUDGET

type Mutable<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends readonly (infer U)[]
    ? Mutable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: Mutable<T[K]> }
      : T

type DraftState = Mutable<OpeningMatchState>
type DraftPlayer = DraftState['players'][number]
type DraftMinion = Mutable<BoardMinion>
type DraftCard = Mutable<OpeningCard>

interface EntityRef {
  readonly instanceId: string
  readonly kind: RuntimeEntityKind
  readonly participantId: PlayerId
  readonly zone: RuntimeZone
  readonly cardId?: CardId
}

interface SemanticEvent {
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

interface EffectFrame {
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
  readonly actionPath: string
  selectedTargetCursor: number
  damageDealt: number
  removedKeywordCount: number
  readonly addedCards: EntityRef[]
  readonly drawnCards: EntityRef[]
  readonly destroyedMinions: EntityRef[]
  randomDamageExcluded: Set<string>
  readonly continuous?: boolean
  readonly isHeroPower?: boolean
  /** Evaluates play-time conditions after the source leaves hand and enters play. */
  readonly prospectiveCardPlay?: boolean
}

export interface EffectRuntimeOptions {
  readonly state: OpeningMatchState
  readonly rng?: DeterministicRng
  readonly participantId: PlayerId
  readonly cardInstanceId: string
  readonly position?: number
  readonly targets?: readonly CardPlayTargetRef[]
  readonly choice?: number
  /** Defers an explicitly after-placement Choice instead of selecting a branch now. */
  readonly deferChoice?: boolean
  readonly nextEntityOrdinal?: number
  readonly recordTrace?: boolean
}

export interface PendingCardChoiceRuntimeOptions {
  readonly state: OpeningMatchState
  readonly rng?: DeterministicRng
  readonly participantId: PlayerId
  readonly sourceCardInstanceId: string
  readonly choice: number
  readonly nextEntityOrdinal?: number
  readonly recordTrace?: boolean
}

export interface AttackRuntimeOptions {
  readonly state: OpeningMatchState
  readonly rng?: DeterministicRng
  readonly participantId: PlayerId
  readonly attacker: AttackCharacterRef
  readonly defender: AttackCharacterRef
  readonly legacyMinionEvent?: boolean
  readonly nextEntityOrdinal?: number
  readonly recordTrace?: boolean
}

export interface HeroPowerRuntimeOptions {
  readonly state: OpeningMatchState
  readonly rng?: DeterministicRng
  readonly participantId: PlayerId
  readonly target?: HeroPowerTargetRef
  readonly nextEntityOrdinal?: number
  readonly recordTrace?: boolean
}

export interface TurnTransitionRuntimeOptions {
  readonly state: OpeningMatchState
  readonly rng?: DeterministicRng
  readonly participantId: PlayerId
  readonly nextEntityOrdinal?: number
  readonly recordTrace?: boolean
}

export interface EffectResolutionSuccess {
  readonly accepted: true
  readonly state: OpeningMatchState
  readonly events: readonly OpeningMatchEvent[]
  readonly trace: readonly EffectTraceEntry[]
  readonly nextEntityOrdinal: number
  readonly triggerEvents: readonly TriggerEventContract[]
}

export interface EffectResolutionFailure {
  readonly accepted: false
  readonly code:
    | 'missing-input'
    | 'extra-input'
    | 'duplicate-target'
    | 'stale-target'
    | 'wrong-zone'
    | 'wrong-controller'
    | 'illegal-target'
    | 'immune-target'
    | 'insufficient-mana'
    | 'board-full'
    | 'invalid-position'
    | 'unsupported-effect'
    | 'resolution-failed'
    | 'resolution-budget-exhausted'
    | 'invalid-target'
    | 'invalid-attacker'
    | 'minion-cannot-attack'
    | 'hero-cannot-attack'
    | 'hero-power-unavailable'
  readonly message: string
  readonly state: OpeningMatchState
  readonly events: readonly []
  readonly trace: readonly EffectTraceEntry[]
  readonly nextEntityOrdinal: number
  readonly triggerEvents: readonly TriggerEventContract[]
  readonly diagnostic: {
    readonly code:
      'unsupported-capability' | 'resolution-budget-exhausted' | 'resolution-failed'
    readonly message: string
    readonly sourceCardId: CardId | null
    readonly actionPath: string
    readonly recentQueue: readonly string[]
  }
}

export type EffectResolutionResult = EffectResolutionSuccess | EffectResolutionFailure

export class ResolutionBudgetError extends Error {
  readonly frame: EffectFrame | null

  constructor(message: string, frame: EffectFrame | null) {
    super(message)
    this.name = 'ResolutionBudgetError'
    this.frame = frame
  }
}

class ResolutionInputError extends Error {
  readonly code:
    | 'missing-input'
    | 'extra-input'
    | 'duplicate-target'
    | 'stale-target'
    | 'wrong-zone'
    | 'wrong-controller'
    | 'illegal-target'
    | 'immune-target'
    | 'insufficient-mana'
    | 'board-full'
    | 'invalid-position'
    | 'resolution-failed'
    | 'invalid-target'
    | 'invalid-attacker'
    | 'minion-cannot-attack'
    | 'hero-cannot-attack'
    | 'hero-power-unavailable'
  readonly actionPath: string

  constructor(
    code: ResolutionInputError['code'],
    message: string,
    actionPath = 'play-card.input'
  ) {
    super(message)
    this.name = 'ResolutionInputError'
    this.code = code
    this.actionPath = actionPath
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clonePlain<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => clonePlain(entry)) as T
  if (!isRecord(value)) return value
  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) result[key] = clonePlain(nested)
  return result as T
}

function copyPlainArray<T>(value: readonly T[]): T[] {
  return value.map((entry) => clonePlain(entry))
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function integer(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, integer(value)))
}

/**
 * Hearthstone raises current Health with maximum Health, but a maximum reduction
 * only clamps current Health when it no longer fits under the new maximum.
 */
function healthAfterMaximumChange(
  currentHealth: number,
  previousMaximum: number,
  nextMaximum: number
): number {
  if (nextMaximum > previousMaximum)
    return clamp(currentHealth + nextMaximum - previousMaximum, 0, nextMaximum)
  return clamp(currentHealth, 0, nextMaximum)
}

function createHistory(): MatchHistory {
  return {
    cardsPlayedThisTurn: [],
    cardsCastThisTurn: [],
    cardsDrawnThisTurn: [],
    minionsSummonedThisTurn: [],
    minionsDiedThisTurn: [],
    damageDealtThisTurn: 0,
    damageTakenThisTurn: 0,
    healingThisTurn: 0,
    armorGainedThisTurn: 0,
    cardsPlayedThisGame: [],
    cardsDiedThisGame: [],
    beastsSummonedByPlayer: {},
    heroPowersUsedByPlayer: {}
  }
}

function historyOf(state: DraftState): Mutable<MatchHistory> {
  return (
    state.history ? clonePlain(state.history) : createHistory()
  ) as Mutable<MatchHistory>
}

function attacksPerTurnForKeywords(keywords: ReadonlySet<CardKeyword>): number {
  if (keywords.has('mega-windfury')) return 4
  return keywords.has('windfury') ? 2 : 1
}

function cardDefinition(cardId: CardId): CardDefinition | undefined {
  return CARD_CATALOG.get(cardId)
}

function cardHasTrigger(card: CardDefinition, trigger: CardTrigger): boolean {
  return card.effects.some((effect) => effect.trigger === trigger)
}

function isMindControlSpell(card: CardDefinition): boolean {
  return (
    card.type === 'Spell' &&
    card.effects.some(
      (effect) =>
        effect.trigger === 'cast' &&
        (effect.actions ?? []).some((action) => action.action === 'take-control')
    )
  )
}

function sourceCardId(source: EntityRef | null): CardId | null {
  return source?.cardId ?? null
}

function entityKey(ref: EntityRef): string {
  return `${ref.kind}:${ref.instanceId}`
}

function eventController(event: SemanticEvent): PlayerId | null {
  if (
    event.type === 'character-attacked' ||
    event.type === 'hero-attacked' ||
    event.type === 'hero-damaged' ||
    event.type === 'hero-would-die' ||
    event.type === 'friendly-minion-attacked'
  )
    return (
      event.targetControllerId ??
      event.target?.participantId ??
      event.controllerId ??
      event.source?.participantId ??
      null
    )
  return event.controllerId ?? event.source?.participantId ?? null
}

function triggerEventType(trigger: CardTrigger): CardEventType | null {
  switch (trigger) {
    case 'on-attack':
      return 'character-attacked'
    case 'inspire':
      return 'hero-power-used'
    case 'on-card-played':
      return 'card-played'
    case 'on-cast':
      return 'spell-cast'
    case 'on-damage':
      return 'damage-dealt'
    case 'on-death':
      return 'minion-died'
    case 'on-draw':
      return null
    case 'on-discard':
      return 'card-discarded'
    case 'on-equip':
      return 'weapon-equipped'
    case 'on-gain-armor':
      return null
    case 'on-heal':
      return 'health-restored'
    case 'on-overload':
      return 'overload-applied'
    case 'on-play':
      return 'card-played'
    case 'on-secret-played':
      return 'secret-played'
    case 'on-secret-revealed':
      return 'secret-revealed'
    case 'on-summon':
      return 'minion-summoned'
    default:
      return null
  }
}

function cloneFrame(frame: EffectFrame, actionPath: string): EffectFrame {
  return {
    ...frame,
    lastEvent: frame.lastEvent,
    chosenTargets: frame.chosenTargets.map((target) => ({ ...target })),
    targetContext: frame.targetContext,
    lastActionTarget: frame.lastActionTarget,
    preserved: new Map(
      [...frame.preserved.entries()].map(([key, targets]) => [
        key,
        targets.map((target) => ({ ...target }))
      ])
    ),
    actionPath,
    choiceIndex: frame.choiceIndex,
    selectedTargetCursor: 0,
    damageDealt: 0,
    removedKeywordCount: 0,
    addedCards: [],
    drawnCards: [],
    randomDamageExcluded: new Set(),
    continuous: frame.continuous
  }
}

function publicTarget(value: EntityRef): CardPlayTargetRef | null {
  if (value.kind === 'hero') return { kind: 'hero', participantId: value.participantId }
  if (value.kind === 'minion')
    return {
      kind: 'minion',
      participantId: value.participantId,
      instanceId: value.instanceId
    }
  if (value.kind === 'weapon')
    return {
      kind: 'weapon',
      participantId: value.participantId,
      instanceId: value.instanceId
    }
  if (value.kind === 'card')
    return {
      kind: 'card',
      participantId: value.participantId,
      instanceId: value.instanceId,
      cardId: value.cardId,
      zone: ['deck', 'hand', 'revealed', 'discarded'].includes(value.zone)
        ? (value.zone as 'deck' | 'hand' | 'revealed' | 'discarded')
        : undefined
    }
  if (value.kind === 'secret')
    return {
      kind: 'secret',
      participantId: value.participantId,
      instanceId: value.instanceId
    }
  return null
}

function makeEffectEvent(
  revision: number,
  frame: EffectFrame,
  action: string,
  actionPath: string,
  eventType?: CardEventType,
  data?: Readonly<Record<string, unknown>>
): EffectDomainEvent {
  return {
    type: 'effect-resolved',
    revision,
    sourceInstanceId: frame.source.instanceId,
    sourceCardId: frame.sourceCardId,
    controllerId: frame.controllerId,
    correlation: frame.correlation,
    action,
    actionPath,
    ...(eventType ? { eventType } : {}),
    ...(data ? { data: clonePlain(data) } : {})
  }
}

function collectTargetSelectors(
  value: unknown,
  path: string,
  result: { selector: Readonly<Record<string, unknown>>; path: string }[],
  choiceIndex?: number
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectTargetSelectors(entry, `${path}[${index}]`, result, choiceIndex)
    )
    return
  }
  if (!isRecord(value)) return
  const choice = value.choice
  if (isRecord(choice) && Array.isArray(choice.options) && choiceIndex !== undefined) {
    const option = choice.options[choiceIndex]
    if (option !== undefined)
      collectTargetSelectors(
        option,
        `${path}.choice[${choiceIndex}]`,
        result,
        choiceIndex
      )
  }
  if (value.selection === 'chosen' || value.selection === 'chosen-and-adjacent')
    result.push({ selector: value, path })
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'choice') continue
    collectTargetSelectors(nested, `${path}.${key}`, result, choiceIndex)
  }
}

function collectChoiceOptions(value: unknown): readonly unknown[] | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const options = collectChoiceOptions(entry)
      if (options) return options
    }
    return null
  }
  if (!isRecord(value)) return null
  if (isRecord(value.choice) && Array.isArray(value.choice.options))
    return value.choice.options
  for (const nested of Object.values(value)) {
    const options = collectChoiceOptions(nested)
    if (options) return options
  }
  return null
}

function collectSelectedEffectActions(
  value: unknown,
  choiceIndex: number | undefined,
  result: Readonly<Record<string, unknown>>[]
): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectSelectedEffectActions(entry, choiceIndex, result)
    return
  }
  if (!isRecord(value)) return
  if (typeof value.action === 'string') result.push(value)
  const choice = value.choice
  if (isRecord(choice) && Array.isArray(choice.options) && choiceIndex !== undefined) {
    const option = choice.options[choiceIndex]
    if (option !== undefined) collectSelectedEffectActions(option, choiceIndex, result)
  }
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'choice' || key === 'target' || key === 'source') continue
    collectSelectedEffectActions(nested, choiceIndex, result)
  }
}

/**
 * The shared declarative effect interpreter. It owns selection, value evaluation,
 * action ordering, semantic trigger facts, checkpoint processing, and rollback-ready
 * draft state. It deliberately has no renderer or platform dependencies.
 */
export class EffectRuntime {
  private readonly initialState: OpeningMatchState
  private readonly draft: DraftState
  private readonly events: OpeningMatchEvent[] = []
  private readonly trace: EffectTraceEntry[] = []
  private readonly recordTrace: boolean
  private readonly resolutionQueue = new ResolutionQueue()
  private readonly resolutionId: string
  private readonly triggerEvents: TriggerEventContract[] = []
  private readonly firedTriggers = new Set<string>()
  private readonly deadSources = new Map<
    string,
    {
      readonly source: EntityRef
      readonly blocks: readonly CardEffectBlock[]
      readonly position?: number
      readonly playOrder?: number
    }
  >()
  private readonly pendingWeaponDeaths = new Map<
    string,
    {
      readonly source: EntityRef
      readonly blocks: readonly CardEffectBlock[]
      readonly playOrder?: number
    }
  >()
  private readonly rng: DeterministicRng
  private readonly rngSnapshot: unknown
  private nextEntityOrdinal: number
  private semanticSequence = 0
  private presentationSequence = 0
  private combatSequence = 0
  private activeFrame: EffectFrame | null = null
  private readonly activeTriggerIds: string[] = []
  private deathBatchSequence = 0
  private deathResolutionDepth = 0
  private deriving = false

  constructor(
    state: OpeningMatchState,
    rng: DeterministicRng = createSeededRng(),
    nextEntityOrdinal = state.nextEntityOrdinal ?? 0,
    recordTrace = true
  ) {
    this.initialState = clonePlain(state) as OpeningMatchState
    this.resolutionId = `resolution:${state.revision + 1}`
    this.draft = clonePlain(state) as unknown as DraftState
    this.rng = rng
    this.rngSnapshot = rng.snapshot()
    this.nextEntityOrdinal = nextEntityOrdinal
    this.recordTrace = recordTrace
    this.draft.pendingResolution = true
    this.draft.history = historyOf(this.draft)
    this.recomputeContinuousEffects()
  }

  private get revision(): number {
    return this.draft.revision + 1
  }

  private step(path: string, kind: ResolutionQueueKind = 'action'): number {
    try {
      return this.resolutionQueue.record(path, kind)
    } catch (error) {
      if (error instanceof ResolutionQueueBudgetError)
        throw new ResolutionBudgetError(error.message, this.activeFrame)
      throw error
    }
  }

  private executeQueued<T>(
    path: string,
    task: () => T,
    kind: ResolutionQueueKind = 'action'
  ): T {
    try {
      return this.resolutionQueue.execute(path, task, kind)
    } catch (error) {
      if (error instanceof ResolutionQueueBudgetError)
        throw new ResolutionBudgetError(error.message, this.activeFrame)
      throw error
    }
  }

  private correlationFor(queueSequence?: number): ResolutionCorrelation {
    const activeSequence = this.resolutionQueue.currentSequence
    return {
      resolutionId: this.resolutionId,
      queueSequence: queueSequence ?? activeSequence ?? 0,
      parentQueueSequence: activeSequence
    }
  }

  private allocateId(prefix: string): string {
    const id = `${prefix}:${this.nextEntityOrdinal}`
    this.nextEntityOrdinal += 1
    return id
  }

  private players(): DraftPlayer[] {
    return this.draft.players as DraftPlayer[]
  }

  private playerIndex(participantId: PlayerId): 0 | 1 {
    if (this.draft.players[0].participantId === participantId) return 0
    if (this.draft.players[1].participantId === participantId) return 1
    throw new Error(`Unknown participant ${participantId}.`)
  }

  private player(participantId: PlayerId): DraftPlayer {
    return this.players()[this.playerIndex(participantId)]
  }

  private sourcePlayer(frame: EffectFrame): DraftPlayer {
    return this.player(frame.controllerId)
  }

  private emit(
    frame: EffectFrame,
    action: string,
    actionPath: string,
    data?: Readonly<Record<string, unknown>>
  ): void {
    if (this.deriving) return
    this.events.push(
      makeEffectEvent(this.revision, frame, action, actionPath, frame.event?.type, data)
    )
    if (this.recordTrace)
      this.trace.push({
        revision: this.revision,
        sourceInstanceId: frame.source.instanceId,
        sourceCardId: frame.sourceCardId,
        correlation: frame.correlation,
        actionPath,
        ...(frame.event ? { eventType: frame.event.type } : {}),
        publicEventType: 'effect-resolved'
      })
  }

  /** Records one concrete trigger frame before any of its consequences run. */
  private emitTriggerActivated(
    frame: EffectFrame,
    trigger: CardTrigger
  ): TriggerActivatedEvent | null {
    const event = frame.event
    if (!event) return null
    const activationId = `${this.resolutionId}:trigger:${this.presentationSequence++}`
    const activation: TriggerActivatedEvent = {
      type: 'trigger-activated',
      activationId,
      parentActivationId:
        this.activeTriggerIds[this.activeTriggerIds.length - 1] ?? null,
      eventSequence: event.sequence,
      eventType: event.type,
      participantId: frame.controllerId,
      source: {
        instanceId: frame.source.instanceId,
        kind: frame.source.kind,
        // Hand cards and Secrets can still be hidden from the opponent. The
        // activation cue preserves queue parentage, but never leaks their id.
        cardId:
          frame.source.kind === 'secret' || frame.source.kind === 'card'
            ? null
            : frame.sourceCardId
      },
      trigger,
      correlation: frame.correlation
    }
    this.events.push(activation)
    return activation
  }

  private historyUpdate(update: (history: Mutable<MatchHistory>) => void): void {
    const history = historyOf(this.draft)
    update(history)
    this.draft.history = history
  }

  findEntity(instanceId: string, preferredParticipant?: PlayerId): EntityRef | null {
    const order = preferredParticipant
      ? [
          this.playerIndex(preferredParticipant),
          this.playerIndex(preferredParticipant) === 0 ? 1 : 0
        ]
      : [0, 1]
    for (const index of order) {
      const player = this.draft.players[index]
      const card = [
        ...player.hand,
        ...player.deck,
        ...(player.revealedCards ?? [])
      ].find((candidate) => candidate.instanceId === instanceId)
      if (card) {
        return {
          instanceId,
          kind: 'card',
          participantId: player.participantId,
          zone:
            card.zone === 'deck'
              ? 'deck'
              : card.zone === 'revealed'
                ? 'revealed'
                : 'hand',
          cardId: card.cardId
        }
      }
      const minion = player.board.find(
        (candidate) => candidate.instanceId === instanceId
      )
      if (minion) {
        return {
          instanceId,
          kind: 'minion',
          participantId: player.participantId,
          zone: 'board',
          cardId: minion.cardId
        }
      }
      if (player.weapon?.instanceId === instanceId) {
        return {
          instanceId,
          kind: 'weapon',
          participantId: player.participantId,
          zone: 'weapon',
          cardId: player.weapon.cardId
        }
      }
      const secret = (player.secrets ?? []).find(
        (candidate) => candidate.instanceId === instanceId
      )
      if (secret) {
        return {
          instanceId,
          kind: 'secret',
          participantId: player.participantId,
          zone: 'secret',
          cardId: secret.cardId
        }
      }
    }
    for (const player of this.draft.players) {
      if (`${player.participantId}:hero` === instanceId)
        return {
          instanceId,
          kind: 'hero',
          participantId: player.participantId,
          zone: 'hero'
        }
      if (`${player.participantId}:hero-power` === instanceId)
        return {
          instanceId,
          kind: 'hero-power',
          participantId: player.participantId,
          zone: 'hero-power'
        }
      const graveyardEntry = (player.graveyard ?? []).find(
        (entry) => entry.minion.instanceId === instanceId
      )
      if (graveyardEntry) {
        return {
          instanceId,
          kind: 'minion',
          participantId: player.participantId,
          zone: 'graveyard',
          cardId: graveyardEntry.minion.cardId
        }
      }
    }
    return null
  }

  private sourceIsInPlay(instanceId: string): boolean {
    const source = this.findEntity(instanceId)
    return (
      source?.zone === 'board' ||
      source?.zone === 'weapon' ||
      source?.zone === 'hero' ||
      source?.zone === 'hero-power' ||
      source?.zone === 'secret'
    )
  }

  private currentCard(ref: EntityRef): DraftCard | null {
    if (ref.kind !== 'card') return null
    const player = this.player(ref.participantId)
    return ([...player.hand, ...player.deck, ...(player.revealedCards ?? [])].find(
      (card) => card.instanceId === ref.instanceId
    ) ?? null) as DraftCard | null
  }

  private currentMinion(ref: EntityRef): DraftMinion | null {
    if (ref.kind !== 'minion') return null
    const player = this.player(ref.participantId)
    const board = player.board.find((minion) => minion.instanceId === ref.instanceId)
    if (board) return board as DraftMinion
    const graveyard = (player.graveyard ?? []).find(
      (entry) => entry.minion.instanceId === ref.instanceId
    )
    return graveyard?.minion ? (graveyard.minion as DraftMinion) : null
  }

  /** Returns the timestamp used to order simultaneous trigger queues. */
  private playOrderFor(ref: EntityRef): number | null {
    const dead = this.deadSources.get(ref.instanceId)
    if (dead?.source.kind === ref.kind) return dead.playOrder ?? null
    const pendingWeapon = this.pendingWeaponDeaths.get(ref.instanceId)
    if (pendingWeapon?.source.kind === ref.kind) return pendingWeapon.playOrder ?? null

    if (ref.kind === 'card') {
      const card = this.currentCard(ref)
      return card?.playOrder ?? card?.creationOrdinal ?? null
    }
    if (ref.kind === 'minion') {
      const minion = this.currentMinion(ref)
      return minion?.playOrder ?? minion?.creationOrdinal ?? null
    }
    if (ref.kind === 'weapon') {
      const weapon = this.player(ref.participantId).weapon
      return weapon?.instanceId === ref.instanceId
        ? (weapon.playOrder ?? weapon.creationOrdinal ?? null)
        : null
    }
    if (ref.kind === 'secret') {
      const secret = this.player(ref.participantId).secrets?.find(
        (candidate) => candidate.instanceId === ref.instanceId
      )
      return secret?.playOrder ?? secret?.creationOrdinal ?? null
    }
    return null
  }

  private entityCard(ref: EntityRef): CardDefinition | undefined {
    if (!ref.cardId) return undefined
    return cardDefinition(ref.cardId)
  }

  private persistentReference(ref: EntityRef): RuntimeEntityReference {
    let ownerId = ref.participantId
    let controllerId = ref.participantId
    if (ref.kind === 'card') {
      const card = this.currentCard(ref)
      ownerId = card?.ownerId ?? ownerId
      controllerId = card?.controllerId ?? controllerId
    } else if (ref.kind === 'minion') {
      const minion = this.currentMinion(ref)
      ownerId = minion?.ownerId ?? ownerId
      controllerId = minion?.controllerId ?? controllerId
    } else if (ref.kind === 'weapon') {
      const weapon = this.player(ref.participantId).weapon
      ownerId = weapon?.ownerId ?? ownerId
      controllerId = weapon?.controllerId ?? controllerId
    } else if (ref.kind === 'secret') {
      const secret = this.player(ref.participantId).secrets?.find(
        (candidate) => candidate.instanceId === ref.instanceId
      )
      ownerId = secret?.ownerId ?? ownerId
      controllerId = secret?.controllerId ?? controllerId
    }
    return { ...ref, ownerId, controllerId }
  }

  private fromPersistentReference(ref: RuntimeEntityReference): EntityRef {
    return {
      instanceId: ref.instanceId,
      kind: ref.kind,
      participantId: ref.controllerId,
      zone: ref.zone,
      ...(ref.kind === 'minion' ||
      ref.kind === 'card' ||
      ref.kind === 'weapon' ||
      ref.kind === 'secret'
        ? { cardId: this.findEntity(ref.instanceId, ref.controllerId)?.cardId }
        : {})
    }
  }

  private allEntities(): EntityRef[] {
    const result: EntityRef[] = []
    for (const player of this.draft.players) {
      for (const card of player.deck)
        result.push({
          instanceId: card.instanceId,
          kind: 'card',
          participantId: player.participantId,
          zone: 'deck',
          cardId: card.cardId
        })
      for (const card of player.hand)
        result.push({
          instanceId: card.instanceId,
          kind: 'card',
          participantId: player.participantId,
          zone: 'hand',
          cardId: card.cardId
        })
      for (const card of player.revealedCards ?? [])
        result.push({
          instanceId: card.instanceId,
          kind: 'card',
          participantId: player.participantId,
          zone: 'revealed',
          cardId: card.cardId
        })
      for (const minion of player.board)
        result.push({
          instanceId: minion.instanceId,
          kind: 'minion',
          participantId: player.participantId,
          zone: 'board',
          cardId: minion.cardId
        })
      result.push({
        instanceId: `${player.participantId}:hero`,
        kind: 'hero',
        participantId: player.participantId,
        zone: 'hero'
      })
      result.push({
        instanceId: `${player.participantId}:hero-power`,
        kind: 'hero-power',
        participantId: player.participantId,
        zone: 'hero-power'
      })
      if (player.weapon)
        result.push({
          instanceId: player.weapon.instanceId,
          kind: 'weapon',
          participantId: player.participantId,
          zone: 'weapon',
          cardId: player.weapon.cardId
        })
      for (const secret of player.secrets ?? [])
        result.push({
          instanceId: secret.instanceId,
          kind: 'secret',
          participantId: player.participantId,
          zone: 'secret',
          cardId: secret.cardId
        })
    }
    return result
  }

  /**
   * The card that caused an event may already have left its authoritative zone
   * by the time reactive effects resolve.  It is nevertheless a valid, typed
   * selector candidate for event-card effects (for example Gallywix).
   */
  private eventCard(frame: EffectFrame): EntityRef | null {
    const event = frame.event
    if (!event?.cardId) return null
    return {
      instanceId: event.cardInstanceId ?? `event-card:${event.sequence}`,
      kind: 'card',
      participantId: event.controllerId ?? frame.controllerId,
      zone: 'revealed',
      cardId: event.cardId
    }
  }

  private relativeController(value: unknown, frame: EffectFrame): PlayerId | null {
    if (value === 'self') return frame.controllerId
    if (value === 'opponent') return this.otherPlayer(frame.controllerId)
    if (value === 'any' || value === undefined) return null
    return typeof value === 'string' &&
      this.draft.players.some((player) => player.participantId === value)
      ? (value as PlayerId)
      : null
  }

  private otherPlayer(participantId: PlayerId): PlayerId {
    return this.draft.players[this.playerIndex(participantId) === 0 ? 1 : 0]
      .participantId
  }

  private matchesType(ref: EntityRef, type: unknown): boolean {
    if (typeof type !== 'string') return true
    const definition = this.entityCard(ref)
    switch (type) {
      case 'card':
      case 'event-card':
      case 'added-card':
      case 'drawn-card':
        return ref.kind === 'card'
      case 'minion-card':
        return ref.kind === 'card' && definition?.type === 'Minion'
      case 'spell-card':
        return ref.kind === 'card' && definition?.type === 'Spell'
      case 'character':
        return ref.kind === 'hero' || ref.kind === 'minion'
      case 'hero':
        return ref.kind === 'hero'
      case 'hero-power':
        return ref.kind === 'hero-power'
      case 'minion':
        return ref.kind === 'minion'
      case 'secret':
        return ref.kind === 'secret'
      case 'weapon':
        return ref.kind === 'weapon'
      default:
        return false
    }
  }

  private targetForFrame(frame: EffectFrame): EntityRef | null {
    return (
      frame.targetContext ??
      frame.event?.target ??
      frame.chosenTargets[0] ??
      frame.lastEvent?.target ??
      null
    )
  }

  private eventTargetForFrame(frame: EffectFrame): EntityRef | null {
    return (
      frame.event?.target ??
      frame.lastActionTarget ??
      frame.targetContext ??
      frame.lastEvent?.target ??
      frame.chosenTargets[0] ??
      null
    )
  }

  private withTarget<T>(frame: EffectFrame, target: EntityRef, task: () => T): T {
    const previous = frame.targetContext
    frame.targetContext = target
    try {
      return task()
    } finally {
      frame.targetContext = previous
    }
  }

  private matchesFilter(
    ref: EntityRef,
    filterValue: unknown,
    frame: EffectFrame
  ): boolean {
    if (!isRecord(filterValue)) return true
    const filter = filterValue
    const minion = this.currentMinion(ref)
    const card = this.currentCard(ref)
    const definition = this.entityCard(ref)
    let matches = true
    for (const [key, value] of Object.entries(filter)) {
      if (key === 'negate') continue
      let condition = true
      if (key === 'cardId') condition = ref.cardId === value
      else if (key === 'cardType') condition = definition?.type === value
      else if (key === 'cardClass') {
        const selfClass = HERO_CATALOG.get(
          this.player(frame.controllerId).heroId
        )?.classId
        const expected =
          value === 'opponent'
            ? HERO_CATALOG.get(this.player(this.otherPlayer(frame.controllerId)).heroId)
                ?.classId
            : value
        condition =
          value === 'self'
            ? definition?.cardClass === selfClass
            : value === 'self-or-neutral'
              ? definition?.cardClass === selfClass ||
                definition?.cardClass === 'Neutral'
              : definition?.cardClass === expected
      } else if (key === 'cost') {
        const cost = card?.currentCost ?? card?.baseCost ?? definition?.cost
        const valueRecord = isRecord(value) ? value : null
        const rawExpected = valueRecord
          ? (valueRecord.value ?? valueRecord.reference ?? valueRecord.cost)
          : value
        const comparisonTarget = this.targetForFrame(frame)
        const targetCost =
          rawExpected === 'target-cost'
            ? this.costForEntity(comparisonTarget ?? undefined)
            : rawExpected === 'event-card-cost'
              ? (frame.event?.card?.currentCost ??
                frame.event?.card?.baseCost ??
                (frame.event?.cardId
                  ? cardDefinition(frame.event.cardId)?.cost
                  : undefined))
              : rawExpected
        const operator =
          typeof valueRecord?.operator === 'string'
            ? valueRecord.operator
            : typeof filter.operator === 'string'
              ? filter.operator
              : 'eq'
        condition =
          typeof cost === 'number' &&
          typeof targetCost === 'number' &&
          this.compare(cost, operator, targetCost)
      } else if (key === 'damaged') {
        const damaged = minion
          ? minion.health < minion.maxHealth
          : ref.kind === 'hero'
            ? this.player(ref.participantId).hero.health <
              this.player(ref.participantId).hero.maxHealth
            : false
        condition = typeof value === 'boolean' ? damaged === value : damaged
      } else if (key === 'hasBattlecry') {
        const hasBattlecry = definition
          ? cardHasTrigger(definition, 'battlecry')
          : false
        condition = typeof value === 'boolean' ? hasBattlecry === value : hasBattlecry
      } else if (key === 'hasDeathrattle') {
        const hasDeathrattle = definition
          ? cardHasTrigger(definition, 'deathrattle') ||
            Boolean(minion?.deathrattles?.length)
          : false
        condition =
          typeof value === 'boolean' ? hasDeathrattle === value : hasDeathrattle
      } else if (key === 'keyword')
        condition = minion
          ? this.hasKeyword(ref, value as CardKeyword)
          : ref.kind === 'hero'
            ? this.hasKeyword(ref, value as CardKeyword)
            : Boolean(definition?.keywords.includes(value as CardKeyword))
      else if (key === 'overload')
        condition = Boolean(
          (definition?.effects ?? []).some((effect) =>
            effect.actions?.some((action) => action.action === 'overload')
          ) === value
        )
      else if (key === 'rarity') condition = definition?.rarity === value
      else if (key === 'sparePart')
        condition =
          definition?.id.includes('spare') === value ||
          definition?.name.toLowerCase().includes('spare') === value
      else if (key === 'tribe') condition = definition?.subtype === value
      else if (key === 'type')
        condition = definition?.type === value || definition?.subtype === value
      else if (key === 'stat') {
        const actual =
          value === 'health' ? this.readMaximumHealth(ref) : this.readAttack(ref)
        const expected = isRecord(filter.value)
          ? this.evaluate(filter.value, frame)
          : filter.value
        condition =
          typeof actual === 'number' &&
          typeof expected === 'number' &&
          this.compare(actual, filter.operator, expected)
      } else if (key === 'operator' || key === 'value') continue
      if (!condition) matches = false
    }
    if (isRecord(filter.negate))
      return matches && !this.matchesFilter(ref, filter.negate, frame)
    return filter.negate === true ? !matches : matches
  }

  private compare(left: number, operator: unknown, right: number): boolean {
    switch (operator) {
      case 'gt':
        return left > right
      case 'gte':
        return left >= right
      case 'lt':
        return left < right
      case 'lte':
        return left <= right
      case 'eq':
      default:
        return left === right
    }
  }

  private adjacentTo(ref: EntityRef): EntityRef[] {
    if (ref.kind !== 'minion') return []
    const player = this.player(ref.participantId)
    const index = player.board.findIndex(
      (minion) => minion.instanceId === ref.instanceId
    )
    if (index < 0) return []
    return [player.board[index - 1], player.board[index + 1]]
      .filter((minion): minion is DraftMinion => Boolean(minion))
      .map((minion) => ({
        instanceId: minion.instanceId,
        kind: 'minion' as const,
        participantId: player.participantId,
        zone: 'board' as const,
        cardId: minion.cardId
      }))
  }

  private selectorPositionMatches(
    candidate: EntityRef,
    selector: Record<string, unknown>
  ): boolean {
    const rawPosition = selector.position
    if (rawPosition === undefined) return true
    const position = typeof rawPosition === 'string' ? rawPosition : null
    if (candidate.kind === 'card' && candidate.zone === 'deck') {
      const deck = this.player(candidate.participantId).deck
      const index = deck.findIndex((card) => card.instanceId === candidate.instanceId)
      if (index < 0) return false
      if (position === 'top' || position === 'first') {
        const count =
          typeof selector.count === 'number'
            ? Math.max(0, Math.floor(selector.count))
            : 1
        return index < count
      }
      if (position === 'bottom' || position === 'last') {
        const count =
          typeof selector.count === 'number'
            ? Math.max(0, Math.floor(selector.count))
            : 1
        return index >= Math.max(0, deck.length - count)
      }
      const numeric =
        typeof rawPosition === 'number' ? rawPosition : Number(rawPosition)
      return Number.isInteger(numeric) && numeric >= 0 && index === numeric
    }
    if (candidate.kind === 'minion' && candidate.zone === 'board') {
      const board = this.player(candidate.participantId).board
      const index = board.findIndex(
        (minion) => minion.instanceId === candidate.instanceId
      )
      const numeric =
        typeof rawPosition === 'number' ? rawPosition : Number(rawPosition)
      return Number.isInteger(numeric) && numeric >= 0 && index === numeric
    }
    return false
  }
  private selectorMatches(
    candidate: EntityRef,
    selector: Record<string, unknown>,
    frame: EffectFrame
  ): boolean {
    const controller = this.relativeController(selector.controller, frame)
    if (controller && candidate.participantId !== controller) return false
    if (selector.zone && candidate.zone !== selector.zone) return false
    if (!this.selectorPositionMatches(candidate, selector)) return false
    if (!this.matchesType(candidate, selector.type)) return false
    if (
      selector.exclude === 'source' &&
      entityKey(candidate) === entityKey(frame.source)
    )
      return false
    if (
      selector.exclude === 'event-target' &&
      frame.event?.target &&
      entityKey(candidate) === entityKey(frame.event.target)
    )
      return false
    if (selector.excludeCardId && candidate.cardId === selector.excludeCardId)
      return false
    return this.matchesFilter(candidate, selector.filter, frame)
  }

  private selectorCandidates(
    selector: Record<string, unknown>,
    frame: EffectFrame
  ): EntityRef[] {
    const selectorType = selector.type
    const eventCard = this.eventCard(frame)
    const contextualCards =
      selectorType === 'event-card'
        ? eventCard
          ? [eventCard]
          : []
        : selectorType === 'drawn-card'
          ? [
              ...frame.drawnCards,
              ...(frame.event?.kind === 'draw' && frame.event.target?.kind === 'card'
                ? [frame.event.target]
                : [])
            ]
          : selectorType === 'added-card'
            ? [...frame.addedCards]
            : null
    let candidates = (contextualCards ?? this.allEntities())
      .filter(
        (candidate, index, all) =>
          all.findIndex((other) => entityKey(other) === entityKey(candidate)) === index
      )
      .filter((candidate) => this.selectorMatches(candidate, selector, frame))
    const selection = selector.selection
    if (selection === 'other-player-hand') {
      candidates = candidates.filter(
        (candidate) =>
          candidate.kind === 'card' &&
          candidate.participantId !== frame.controllerId &&
          candidate.zone === 'hand'
      )
    }
    if (selection === 'hero')
      candidates = candidates.filter((candidate) => candidate.kind === 'hero')
    if (selection === 'next') {
      const sourceIndex = candidates.findIndex(
        (candidate) => entityKey(candidate) === entityKey(frame.source)
      )
      candidates =
        sourceIndex >= 0
          ? candidates.slice(sourceIndex + 1, sourceIndex + 2)
          : candidates.slice(0, 1)
    }
    if (selection === 'adjacent') {
      const anchor =
        selector.adjacentTo === 'source'
          ? frame.source
          : selector.adjacentTo === 'event-source'
            ? (frame.event?.source ?? frame.source)
            : (frame.event?.target ?? frame.source)
      candidates = this.adjacentTo(anchor).filter((candidate) =>
        this.selectorMatches(candidate, selector, frame)
      )
    }
    return candidates
  }

  private chosenTarget(
    frame: EffectFrame,
    selector: Record<string, unknown>
  ): EntityRef[] {
    const candidates = frame.chosenTargets.filter((target) =>
      this.selectorMatches(target, selector, frame)
    )
    if (candidates.length === 0) return []
    if (frame.chosenTargets.length === 1) return [candidates[0]!]
    const index = frame.selectedTargetCursor
    frame.selectedTargetCursor += 1
    return candidates[index]
      ? [candidates[index]!]
      : [candidates[candidates.length - 1]!]
  }

  /** Resolves a selector in stable zone/board order before count or random choice. */
  select(selectorValue: unknown, frame: EffectFrame): readonly EntityRef[] {
    this.step(`${frame.actionPath}:select`)
    if (typeof selectorValue === 'string') {
      if (selectorValue === 'source') return [frame.source]
      if (selectorValue === 'event-source' && frame.event?.source)
        return [frame.event.source]
      if (selectorValue === 'event-target')
        return frame.event?.target
          ? [frame.event.target]
          : frame.lastActionTarget
            ? [frame.lastActionTarget]
            : []
      return []
    }
    if (!isRecord(selectorValue)) return []
    const selector = selectorValue
    const selection = selector.selection
    if (selection === 'source')
      return this.selectorMatches(frame.source, selector, frame) ? [frame.source] : []
    if (selection === 'event-source') {
      const eventSource = frame.event?.source
      return eventSource && this.selectorMatches(eventSource, selector, frame)
        ? [eventSource]
        : []
    }
    if (selection === 'event-target') {
      const eventTarget = frame.event?.target ?? frame.lastActionTarget
      return eventTarget && this.selectorMatches(eventTarget, selector, frame)
        ? [eventTarget]
        : []
    }
    if (selection === 'chosen') return this.chosenTarget(frame, selector)

    let candidates: EntityRef[]
    if (selection === 'chosen-and-adjacent') {
      const chosen = this.chosenTarget(frame, {
        ...selector,
        selection: 'chosen'
      })
      if (chosen.length === 0) return []
      const anchor = chosen[0]!
      const adjacent = this.adjacentTo(anchor)
      candidates = [anchor, ...adjacent].filter((candidate) =>
        this.selectorMatches(candidate, selector, frame)
      )
    } else {
      candidates = this.selectorCandidates(selector, frame)
    }

    const count =
      typeof selector.count === 'number'
        ? clamp(selector.count, 0, candidates.length)
        : undefined
    if (selection === 'random') {
      if (frame.randomDamageExcluded.size > 0)
        candidates = candidates.filter((candidate) => {
          const key = entityKey(candidate)
          if (!frame.randomDamageExcluded.has(key)) return true
          const minion =
            candidate.kind === 'minion' ? this.currentMinion(candidate) : null
          if (minion && minion.health > 0) {
            frame.randomDamageExcluded.delete(key)
            return true
          }
          return false
        })
      const chosen: EntityRef[] = []
      const pool = [...candidates]
      const amount = count ?? 1
      for (let index = 0; index < amount && pool.length > 0; index += 1) {
        const selectedIndex = Math.floor(this.rng.next() * pool.length)
        chosen.push(...pool.splice(selectedIndex, 1))
      }
      candidates = chosen
    } else if (count !== undefined) {
      candidates = candidates.slice(0, count)
    }

    if (selector.preserve) {
      const preserveSelector = isRecord(selector.preserve)
        ? {
            controller: selector.controller,
            type: selector.type,
            zone: selector.zone,
            filter: selector.filter,
            exclude: selector.exclude,
            excludeCardId: selector.excludeCardId,
            ...selector.preserve
          }
        : {}
      const preserved = this.select(preserveSelector, frame)
      const preservedKeys = new Set(preserved.map(entityKey))
      frame.preserved.set(
        JSON.stringify(selector.preserve),
        preserved.map((candidate) => ({ ...candidate }))
      )
      candidates = candidates.filter(
        (candidate) => !preservedKeys.has(entityKey(candidate))
      )
    }
    return candidates
  }

  private numericReference(
    reference: string,
    frame: EffectFrame,
    expression?: Record<string, unknown>
  ): number {
    const sourceMinion = this.currentMinion(frame.source)
    const sourceCard = this.currentCard(frame.source)
    const eventTarget = this.eventTargetForFrame(frame)
    const target = this.targetForFrame(frame)
    const targetMinion = target ? this.currentMinion(target) : null
    const targetCard = target ? this.currentCard(target) : null
    const owner = this.sourcePlayer(frame)
    const opponent = this.player(this.otherPlayer(frame.controllerId))
    switch (reference) {
      case 'available-board-slots':
        return Math.max(0, MAX_BOARD_SIZE - owner.board.length)
      case 'beasts-summoned-this-game':
        return this.draft.history?.beastsSummonedByPlayer[frame.controllerId] ?? 0
      case 'cards-played-earlier-this-turn':
        return Math.max(0, (this.draft.history?.cardsPlayedThisTurn.length ?? 0) - 1)
      case 'damage-dealt':
        return frame.damageDealt
      case 'drawn-card.cost':
        return frame.drawnCards[0]
          ? (this.currentCard(frame.drawnCards[0])?.currentCost ??
              this.entityCard(frame.drawnCards[0])?.cost ??
              0)
          : (frame.event?.card?.currentCost ?? frame.event?.card?.baseCost ?? 0)
      case 'event-target.attack':
        return eventTarget ? this.readAttack(eventTarget) : 0
      case 'event-target.durability':
        return eventTarget && eventTarget.kind === 'weapon'
          ? (this.player(eventTarget.participantId).weapon?.durability ?? 0)
          : 0
      case 'event.damage':
        return frame.event?.damage ?? frame.event?.amount ?? 0
      case 'event.amount':
        return frame.event?.amount ?? frame.event?.damage ?? 0
      case 'hand-size-difference':
        if (expression?.opponent === true)
          return Math.max(0, opponent.hand.length - owner.hand.length)
        return Math.abs(owner.hand.length - opponent.hand.length)
      case 'health':
        return sourceMinion?.health ?? owner.hero.health
      case 'hero-damage':
        return Math.max(0, owner.hero.maxHealth - owner.hero.health)
      case 'hero-powers-used-this-game':
        return this.draft.history?.heroPowersUsedByPlayer[frame.controllerId] ?? 0
      case 'minions-died-this-turn':
        return this.draft.history?.minionsDiedThisTurn.length ?? 0
      case 'matching-entity-count':
        return isRecord(expression?.selector)
          ? this.select(expression.selector, frame).length
          : frame.event?.target
            ? 1
            : 0
      case 'other-cards-in-hand':
        return Math.max(0, owner.hand.length - (sourceCard ? 1 : 0))
      case 'other-minions-on-board':
        return Math.max(
          0,
          this.draft.players.flatMap((player) => player.board).length -
            (sourceMinion ? 1 : 0)
        )
      case 'removed-keyword-count':
        return frame.removedKeywordCount
      case 'self.hero.armor':
        return owner.hero.armor
      case 'self.hero.attack':
        return owner.hero.attack + (owner.weapon?.attack ?? 0)
      case 'source.attack':
        return (
          sourceMinion?.attack ??
          (frame.source.kind === 'weapon' ? (owner.weapon?.attack ?? 0) : 0)
        )
      case 'source.health':
        return sourceMinion?.health ?? owner.hero.health
      case 'source.weapon.attack':
        return owner.weapon?.attack ?? 0
      case 'target.attack':
        return target ? this.readAttack(target) : 0
      case 'target.health':
        if (targetMinion) return targetMinion.health
        if (target?.kind === 'hero')
          return this.player(target.participantId).hero.health
        return targetCard?.currentCost ?? 0
      default:
        return 0
    }
  }

  /** Evaluates a closed numeric expression at the action boundary. */
  evaluate(value: unknown, frame: EffectFrame, allowFull = false): number {
    this.step(`${frame.actionPath}:value`)
    if (typeof value === 'number') return value
    if (typeof value === 'string')
      return allowFull && value === 'full' ? Number.POSITIVE_INFINITY : 0
    if (!isRecord(value)) return 0
    if (Array.isArray(value.random)) {
      const randomValues = value.random.filter(
        (entry): entry is number => typeof entry === 'number'
      )
      if (randomValues.length === 0) return 0
      return (
        randomValues[Math.floor(this.rng.next() * randomValues.length)] ??
        randomValues[0]!
      )
    }
    const reference =
      typeof value.reference === 'string'
        ? this.numericReference(value.reference, frame, value)
        : undefined
    const literal = typeof value.value === 'number' ? value.value : undefined
    const base = reference ?? literal ?? 0
    if (value.operation === undefined && typeof value.multiplier === 'number')
      return base * value.multiplier
    switch (value.operation) {
      case 'multiply':
        return (
          base *
          (literal ?? (typeof value.multiplier === 'number' ? value.multiplier : 1))
        )
      case 'set':
        return literal ?? reference ?? 0
      case 'subtract':
        return literal === undefined ? -base : literal - (reference ?? 0)
      default:
        return base
    }
  }

  private valueForStat(value: unknown, current: number, frame: EffectFrame): number {
    if (typeof value === 'number') return current + value
    if (isRecord(value)) {
      if (
        value.operation === undefined &&
        (value.reference === 'source.health' || value.reference === 'target.health')
      )
        return this.evaluate(value, frame)
      if (value.operation === 'multiply') {
        const multiplier =
          typeof value.value === 'number' ? value.value : this.evaluate(value, frame)
        return current * multiplier
      }
      if (value.operation === 'set') return this.evaluate(value, frame)
      if (value.operation === 'subtract') {
        const amount =
          value.value === undefined && typeof value.reference === 'string'
            ? this.numericReference(value.reference, frame)
            : value.value === undefined
              ? Math.abs(this.evaluate(value, frame))
              : this.evaluate(value.value, frame)
        return current - amount
      }
    }
    return current + this.evaluate(value, frame)
  }

  private targetPlayers(
    action: Record<string, unknown>,
    frame: EffectFrame
  ): readonly PlayerId[] {
    const player = action.player
    if (player === 'each')
      return this.draft.players.map((candidate) => candidate.participantId)
    if (player === 'opponent') return [this.otherPlayer(frame.controllerId)]
    if (player === 'turn-player')
      return this.draft.activePlayerId
        ? [this.draft.activePlayerId]
        : [frame.controllerId]
    if (
      typeof player === 'string' &&
      this.draft.players.some((candidate) => candidate.participantId === player)
    )
      return [player as PlayerId]
    return [frame.controllerId]
  }

  private actionTargets(
    action: Record<string, unknown>,
    frame: EffectFrame
  ): readonly EntityRef[] {
    if (action.target !== undefined) return this.select(action.target, frame)
    if (action.player !== undefined) {
      return this.targetPlayers(action, frame).map((participantId) => ({
        instanceId: `${participantId}:hero`,
        kind: 'hero',
        participantId,
        zone: 'hero'
      }))
    }
    return [frame.source]
  }

  private replaceEventReference(
    frame: EffectFrame,
    previous: EntityRef,
    next: EntityRef
  ): void {
    const replace = (event: SemanticEvent | null): void => {
      if (!event) return
      if (event.target && entityKey(event.target) === entityKey(previous)) {
        ;(event as Mutable<SemanticEvent>).target = next
      }
      if (event.source && entityKey(event.source) === entityKey(previous)) {
        ;(event as Mutable<SemanticEvent>).source = next
      }
    }
    replace(frame.event)
    if (frame.lastEvent !== frame.event) replace(frame.lastEvent)
  }

  private applyCardZones(player: DraftPlayer, updated: OpeningPlayerState): void {
    player.deck = updated.deck as DraftPlayer['deck']
    player.hand = updated.hand as DraftPlayer['hand']
    player.revealedCards = updated.revealedCards as DraftPlayer['revealedCards']
    player.discardedCards = updated.discardedCards as DraftPlayer['discardedCards']
  }

  private replaceBoard(player: DraftPlayer, board: readonly BoardMinion[]): void {
    player.board = [...board] as DraftPlayer['board']
  }

  private insertBoardMinion(
    player: DraftPlayer,
    minion: DraftMinion,
    index?: number
  ): number {
    const insertion =
      index === undefined ? player.board.length : clamp(index, 0, player.board.length)
    this.replaceBoard(player, [
      ...player.board.slice(0, insertion),
      minion,
      ...player.board.slice(insertion)
    ])
    return insertion
  }

  /**
   * Resolves Hearthstone-style placement for minions created by summon actions.
   * A minion source can place its own summons beside itself; all other sources
   * use the far-right insertion point unless the action supplies an override.
   * A default Deathrattle summon uses its source's remembered death position.
   */
  private summonPosition(
    frame: EffectFrame,
    participantId: PlayerId,
    placement: CardSummonPlacement | undefined,
    summonIndex: number
  ): number {
    const player = this.player(participantId)
    if (placement === 'far-right') return player.board.length
    const sourceIndex =
      frame.source.kind === 'minion' && frame.source.participantId === participantId
        ? player.board.findIndex(
            (minion) => minion.instanceId === frame.source.instanceId
          )
        : -1
    if (sourceIndex >= 0) {
      if (placement === 'alternating-around-source')
        return summonIndex % 2 === 0 ? sourceIndex + 1 : sourceIndex
      return sourceIndex + 1
    }
    if (placement === undefined && frame.source.kind === 'minion') {
      const deathPosition = this.deadSources.get(frame.source.instanceId)?.position
      if (deathPosition !== undefined)
        return clamp(deathPosition, 0, player.board.length)
    }
    return player.board.length
  }

  private takeBoardMinion(
    player: DraftPlayer,
    instanceId: string
  ): { readonly minion: DraftMinion; readonly index: number } | null {
    const index = player.board.findIndex(
      (candidate) => candidate.instanceId === instanceId
    )
    if (index < 0) return null
    const minion = player.board[index] as DraftMinion | undefined
    if (!minion) return null
    this.replaceBoard(player, [
      ...player.board.slice(0, index),
      ...player.board.slice(index + 1)
    ])
    return { minion, index }
  }

  private replaceSecrets(player: DraftPlayer, secrets: readonly SecretState[]): void {
    player.secrets = [...secrets] as DraftPlayer['secrets']
  }

  private appendSecret(player: DraftPlayer, secret: SecretState): void {
    this.replaceSecrets(player, [...(player.secrets ?? []), secret])
  }

  private appendGraveyard(player: DraftPlayer, entry: GraveyardMinion): void {
    player.graveyard = [...(player.graveyard ?? []), entry] as DraftPlayer['graveyard']
  }

  private removeGraveyardAt(
    player: DraftPlayer,
    index: number
  ): GraveyardMinion | null {
    const graveyard = player.graveyard ?? []
    if (index < 0 || index >= graveyard.length) return null
    const entry = graveyard[index]
    if (!entry) return null
    player.graveyard = [
      ...graveyard.slice(0, index),
      ...graveyard.slice(index + 1)
    ] as DraftPlayer['graveyard']
    return entry
  }

  private addCardToHand(
    participantId: PlayerId,
    cardId: CardId,
    frame: EffectFrame,
    path: string,
    preferredInstanceId?: string,
    emitGeneratedPresentation = true
  ): EntityRef | null {
    const targetPlayer = this.player(participantId)
    const definition = cardDefinition(cardId)
    if (!definition) return null
    const instanceId =
      preferredInstanceId ?? this.allocateId(`${participantId}:generated`)
    const card: DraftCard = {
      instanceId,
      cardId,
      ownerId: participantId,
      controllerId: participantId,
      creationOrdinal: this.nextEntityOrdinal++,
      baseCost: definition.cost,
      currentCost: definition.cost,
      zone: 'hand',
      revealed: true
    }
    if (targetPlayer.hand.length >= MAX_HAND_SIZE) {
      this.applyCardZones(
        targetPlayer,
        insertCardIntoPlayer(
          targetPlayer as unknown as OpeningPlayerState,
          { ...card, zone: 'discarded', revealed: false },
          'discarded'
        )
      )
      this.emit(frame, 'burn', path, { participantId, cardId, instanceId })
      this.events.push({
        type: 'card-burned',
        participantId,
        card: clonePlain({
          ...card,
          zone: 'discarded',
          revealed: false
        }) as OpeningCard
      })
      return null
    }
    const updatedPlayer = insertCardIntoPlayer(
      targetPlayer as unknown as OpeningPlayerState,
      card,
      'hand'
    )
    this.applyCardZones(targetPlayer, updatedPlayer)
    if (emitGeneratedPresentation) {
      this.events.push({
        type: 'card-generated',
        participantId,
        card: clonePlain(card) as OpeningCard,
        origin:
          frame.source.kind === 'minion'
            ? { kind: 'minion', instanceId: frame.source.instanceId }
            : { kind: 'screen-center' }
      })
    }
    const ref: EntityRef = {
      instanceId,
      kind: 'card',
      participantId,
      zone: 'hand',
      cardId
    }
    frame.addedCards.push(ref)
    this.emit(frame, 'add-to-hand', path, {
      participantId,
      cardId,
      instanceId
    })
    return ref
  }

  private removeCard(ref: EntityRef): DraftCard | null {
    if (ref.kind !== 'card') return null
    const player = this.player(ref.participantId)
    const removed = removeCardFromPlayer(
      player as unknown as OpeningPlayerState,
      ref.instanceId
    )
    if (!removed) return null
    this.applyCardZones(player, removed.player)
    return removed.card as DraftCard
  }

  private revealDeckTop(
    participantId: PlayerId,
    count: number,
    frame: EffectFrame,
    path: string
  ): readonly EntityRef[] {
    const revealed: EntityRef[] = []
    for (let index = 0; index < count; index += 1) {
      const player = this.player(participantId)
      const card = player.deck[0]
      if (!card) break
      const deckRef: EntityRef = {
        instanceId: card.instanceId,
        kind: 'card',
        participantId,
        zone: 'deck',
        cardId: card.cardId
      }
      const removed = this.removeCard(deckRef)
      if (!removed) break
      const updated = insertCardIntoPlayer(
        this.player(participantId),
        removed,
        'revealed'
      ) as DraftPlayer
      this.applyCardZones(player, updated)
      const ref: EntityRef = { ...deckRef, zone: 'revealed' }
      revealed.push(ref)
      this.emit(frame, 'reveal', `${path}.${index}`, {
        participantId,
        cardId: removed.cardId,
        instanceId: removed.instanceId
      })
    }
    return revealed
  }

  private cardRefsFromSource(source: unknown, frame: EffectFrame): EntityRef[] {
    if (typeof source === 'string') {
      if (source === 'random-card') {
        const candidates = CARD_CATALOG.all
          .filter((card) => card.collectible)
          .map((card) => ({
            instanceId: `${frame.controllerId}:pool:${card.id}`,
            kind: 'card' as const,
            participantId: frame.controllerId,
            zone: 'revealed' as const,
            cardId: card.id
          }))
        return candidates.length > 0
          ? [candidates[Math.floor(this.rng.next() * candidates.length)]!]
          : []
      }
      if (source === 'deck' || source === 'deck-top') {
        return this.player(frame.controllerId).deck.map((card) => ({
          instanceId: card.instanceId,
          kind: 'card' as const,
          participantId: frame.controllerId,
          zone: 'deck' as const,
          cardId: card.cardId
        }))
      }
      if (source === 'hand') {
        return this.player(frame.controllerId).hand.map((card) => ({
          instanceId: card.instanceId,
          kind: 'card' as const,
          participantId: frame.controllerId,
          zone: 'hand' as const,
          cardId: card.cardId
        }))
      }
      if (source === 'destroyed-minions')
        return frame.destroyedMinions.map((entry) => ({
          ...entry,
          zone: 'graveyard' as const
        }))
      if (source === 'friendly-minions-died-this-turn') {
        return (this.player(frame.controllerId).graveyard ?? [])
          .filter((entry) => entry.diedOnTurn === this.draft.turnNumber)
          .map((entry) => ({
            instanceId: entry.minion.instanceId,
            kind: 'minion' as const,
            participantId: frame.controllerId,
            zone: 'graveyard' as const,
            cardId: entry.minion.cardId
          }))
      }
      if (source === 'minions-died-this-game') {
        return (this.draft.history?.cardsDiedThisGame ?? []).map((cardId, index) => ({
          instanceId: `history:${index}:${cardId}`,
          kind: 'minion' as const,
          participantId: frame.controllerId,
          zone: 'graveyard' as const,
          cardId: cardId as CardId
        }))
      }
      return []
    }
    return [...this.select(source, frame)]
  }

  private updateMinion(
    ref: EntityRef,
    update: (minion: DraftMinion) => void
  ): DraftMinion | null {
    if (ref.kind !== 'minion') return null
    const player = this.player(ref.participantId)
    const minion = player.board.find(
      (candidate) => candidate.instanceId === ref.instanceId
    ) as DraftMinion | undefined
    if (!minion) return null
    update(minion)
    return minion
  }

  private updateCard(
    ref: EntityRef,
    update: (card: DraftCard) => void
  ): DraftCard | null {
    const card = this.currentCard(ref)
    if (!card) return null
    update(card)
    return card
  }

  private emitSemantic(event: Omit<SemanticEvent, 'sequence'>): SemanticEvent {
    const sequence = this.semanticSequence++
    const queueSequence = this.step(`event:${event.type}:${sequence}`, 'trigger')
    const queued: SemanticEvent = {
      ...event,
      sequence,
      correlation: this.correlationFor(queueSequence)
    }
    this.triggerEvents.push({
      type: 'trigger-event',
      sequence,
      eventType: queued.type,
      sourceInstanceId: queued.source?.instanceId ?? null,
      targetInstanceId: queued.target?.instanceId ?? null,
      correlation: queued.correlation!
    })
    if (this.activeFrame) this.activeFrame.lastEvent = queued
    this.resolveEvent(queued)
    if (queued.type === 'spell-cast' && queued.controllerId) {
      const player = this.player(queued.controllerId)
      const count =
        player.lockAndLoadTurn === this.draft.turnNumber
          ? (player.lockAndLoadCount ?? 0)
          : 0
      if (count > 0) {
        const hunterCards = CARD_CATALOG.all.filter(
          (card) => card.collectible && card.cardClass === 'Hunter'
        )
        const frame = this.frameFor(
          queued.source ?? {
            instanceId: `${queued.controllerId}:hero`,
            kind: 'hero',
            participantId: queued.controllerId,
            zone: 'hero'
          },
          queued,
          []
        )
        for (let index = 0; index < count && hunterCards.length > 0; index += 1) {
          const selected = hunterCards[Math.floor(this.rng.next() * hunterCards.length)]
          if (selected)
            this.addCardToHand(
              queued.controllerId,
              selected.id,
              frame,
              'lock-and-load'
            )
        }
      }
    }
    return queued
  }

  private actionBlocksFor(
    ref: EntityRef,
    trigger: CardTrigger
  ): readonly CardEffectBlock[] {
    const definition = ref.cardId ? cardDefinition(ref.cardId) : undefined
    const minion = this.currentMinion(ref)
    const blocks = minion?.silenced
      ? []
      : (definition?.effects.filter((effect) => effect.trigger === trigger) ?? [])
    const granted =
      minion?.grantedTriggers
        ?.filter(() => !minion.silenced)
        ?.filter(
          (entry) =>
            (entry.startsOnTurn === undefined ||
              entry.startsOnTurn <= this.draft.turnNumber) &&
            (entry.expiresOnTurn === undefined ||
              entry.expiresOnTurn >= this.draft.turnNumber)
        )
        ?.filter((entry) => entry.trigger === trigger)
        .map(
          (entry) =>
            ({
              trigger: entry.trigger,
              actions: entry.actions as unknown as readonly CardAction[]
            }) as unknown as CardEffectBlock
        ) ?? []
    const authoredDeathrattleKeys = new Set(
      blocks.map((entry) => JSON.stringify(entry))
    )
    const grantedDeathrattles =
      trigger === 'deathrattle'
        ? (minion?.deathrattles ?? [])
            .filter((entry) => !authoredDeathrattleKeys.has(JSON.stringify(entry)))
            .map(
              (entry) =>
                ({
                  trigger: 'deathrattle',
                  actions: entry.actions
                }) as CardEffectBlock
            )
        : []
    const combined = [...blocks, ...granted, ...grantedDeathrattles]
    if (trigger !== 'deathrattle') return combined
    const multiplier = Math.max(
      1,
      Math.floor(minion?.triggerMultipliers?.deathrattle ?? 1)
    )
    return Array.from({ length: multiplier }, () => combined).flat()
  }

  private controllerMatches(
    event: SemanticEvent,
    source: EntityRef,
    value: unknown
  ): boolean {
    if (value === undefined || value === 'any') return true
    const eventOwner = eventController(event)
    if (!eventOwner) return false
    if (value === 'self') return eventOwner === source.participantId
    if (value === 'opponent') return eventOwner !== source.participantId
    return eventOwner === value
  }

  /** Matches a turn-relative event constraint against the triggering source. */
  private turnPlayerMatches(source: EntityRef, value: unknown): boolean {
    if (value === undefined || value === 'any') return true
    const activePlayerId = this.draft.activePlayerId
    if (!activePlayerId) return false
    if (value === 'self') return activePlayerId === source.participantId
    if (value === 'opponent') return activePlayerId !== source.participantId
    return activePlayerId === value
  }

  private matchesEvent(
    block: CardEffectBlock,
    event: SemanticEvent,
    source: EntityRef
  ): boolean {
    const eventSpec = block.event
    const isOwnEntryEvent =
      source.kind === 'minion' &&
      event.target !== null &&
      entityKey(event.target) === entityKey(source) &&
      (event.type === 'card-played' ||
        event.type === 'minion-played' ||
        event.type === 'first-minion-played-this-turn' ||
        event.type === 'minion-summoned')
    // A minion must already be in play to observe an enter-play event. This
    // prevents summon and card-play listeners from triggering on themselves.
    if (isOwnEntryEvent) return false

    if (
      event.kind === 'play' &&
      event.type !== 'card-played' &&
      block.trigger === 'on-card-played' &&
      eventSpec === undefined
    )
      return false
    if (!eventSpec) return true
    const spec = asRecord(eventSpec)
    // A minion's early card-play event is represented by `card-played` while
    // after-play listeners receive the later `minion-played` fact.  Generic
    // on-card-played blocks only observe the early fact; an explicit event
    // constraint can opt into the later phase.
    if (spec.type === 'hero-damaged' && event.kind === 'armor') return false
    if (spec.type !== undefined && spec.type !== event.type) return false
    const controllerValue = spec.controller
    if (!this.controllerMatches(event, source, controllerValue)) return false
    if (!this.turnPlayerMatches(source, spec.turnPlayer)) return false
    if (
      spec.exclude === 'source' &&
      event.source &&
      entityKey(event.source) === entityKey(source)
    )
      return false
    if (
      spec.exclude === 'event-target' &&
      event.target &&
      entityKey(event.target) === entityKey(source)
    )
      return false
    if (
      spec.filter &&
      event.target &&
      !this.matchesFilter(event.target, spec.filter, this.frameFor(source, event, []))
    )
      return false
    if (
      spec.source &&
      (!event.source ||
        !this.selectorContains(spec.source, event.source, source, event))
    )
      return false
    if (
      spec.target &&
      (!event.target ||
        !this.selectorContains(spec.target, event.target, source, event))
    )
      return false
    return true
  }

  private selectorContains(
    selector: unknown,
    value: EntityRef,
    source: EntityRef,
    event: SemanticEvent
  ): boolean {
    const frame = this.frameFor(source, event, [])
    return this.select(selector, frame).some(
      (candidate) => entityKey(candidate) === entityKey(value)
    )
  }

  private frameFor(
    source: EntityRef,
    event: SemanticEvent | null,
    chosenTargets: readonly EntityRef[]
  ): EffectFrame {
    return {
      source,
      sourceCardId: sourceCardId(source),
      correlation: this.correlationFor(),
      rng: this.rng,
      controllerId: source.participantId,
      event,
      lastEvent: null,
      chosenTargets,
      targetContext: null,
      lastActionTarget: null,
      choiceIndex: undefined,
      preserved: new Map(),
      actionPath: 'event',
      selectedTargetCursor: 0,
      damageDealt: 0,
      removedKeywordCount: 0,
      addedCards: [],
      drawnCards: [],
      destroyedMinions: [],
      randomDamageExcluded: new Set(),
      continuous: undefined
    }
  }

  private triggerMatches(trigger: CardTrigger, event: SemanticEvent): boolean {
    if (trigger === 'secret') return true
    if (trigger === 'while-in-hand') return true
    if (event.kind === 'turn-start' || event.kind === 'turn-end') {
      return trigger === (event.kind === 'turn-start' ? 'start-of-turn' : 'end-of-turn')
    }
    if (event.kind === 'discard') return trigger === 'on-discard'
    if (event.kind === 'draw') return trigger === 'on-draw'
    if (event.kind === 'armor') return trigger === 'on-gain-armor'
    if (event.kind === 'heal')
      return trigger === 'on-heal' || (trigger === 'overheal' && event.overheal === true)
    if (event.kind === 'summon') return trigger === 'on-summon'
    if (event.type === 'spell-targeted-minion') return trigger === 'on-cast'
    if (event.kind === 'damage')
      return trigger === 'on-damage' && event.type === 'damage-dealt'
    if (event.kind === 'cast') return trigger === 'on-cast'
    if (trigger === 'deathrattle' || trigger === 'on-death')
      return event.type === 'minion-died' || event.type === 'weapon-died'
    if (event.kind === 'play') {
      if (event.type === 'secret-played') {
        return trigger === 'on-secret-played'
      }
      if (event.type === 'card-played') {
        return trigger === 'on-card-played'
      }
      if (
        event.type === 'minion-played' ||
        event.type === 'first-minion-played-this-turn'
      ) {
        return trigger === 'on-card-played'
      }
      return false
    }
    return triggerEventType(trigger) === event.type
  }

  private collectTriggerFrames(event: SemanticEvent): {
    readonly source: EntityRef
    readonly block: CardEffectBlock
    readonly order: number
  }[] {
    const active = this.draft.activePlayerId
    const playerOrder = active
      ? [this.playerIndex(active), this.playerIndex(active) === 0 ? 1 : 0]
      : [0, 1]
    const result: {
      source: EntityRef
      block: CardEffectBlock
      order: number
    }[] = []
    let order = 0
    for (const index of playerOrder) {
      const player = this.draft.players[index]
      for (const minion of player.board) {
        const source: EntityRef = {
          instanceId: minion.instanceId,
          kind: 'minion',
          participantId: player.participantId,
          zone: 'board',
          cardId: minion.cardId
        }
        const definitionBlocks = minion.silenced
          ? []
          : (cardDefinition(minion.cardId)?.effects ?? [])
        const granted = (minion.silenced ? [] : (minion.grantedTriggers ?? []))
          .filter(
            (entry) =>
              (entry.startsOnTurn === undefined ||
                entry.startsOnTurn <= this.draft.turnNumber) &&
              (entry.expiresOnTurn === undefined ||
                entry.expiresOnTurn >= this.draft.turnNumber)
          )
          .map(
            (entry) =>
              ({
                trigger: entry.trigger,
                actions: entry.actions as unknown as readonly CardAction[],
                event: undefined
              }) as unknown as CardEffectBlock
          )
        for (const block of [...definitionBlocks, ...granted]) {
          // Deathrattles are emitted only from the captured dead source below.
          // A living minion must not treat another minion's death as its own.
          if (block.trigger === 'deathrattle') continue
          // Hand-only effects are evaluated by recomputeContinuousEffects()
          // (or the hand-specific event path below). Once their source has
          // become a board minion, they cannot listen to semantic events.
          if (block.trigger === 'while-in-hand') continue
          // Turn triggers describe their controller's turn unless their
          // authored event explicitly widens the scope (for example, Gruul's
          // "At the end of each turn").
          if (
            (event.kind === 'turn-start' || event.kind === 'turn-end') &&
            (block.trigger === 'start-of-turn' || block.trigger === 'end-of-turn') &&
            !block.event &&
            !this.turnPlayerMatches(source, 'self')
          )
            continue
          if (
            !this.triggerMatches(block.trigger, event) ||
            !this.matchesEvent(block, event, source)
          )
            continue
          const multiplier = Math.max(
            1,
            Math.floor(minion.triggerMultipliers?.[block.trigger] ?? 1)
          )
          for (let repetition = 0; repetition < multiplier; repetition += 1) {
            result.push({ source, block, order: order++ })
          }
        }
      }
      if (player.weapon) {
        const source: EntityRef = {
          instanceId: player.weapon.instanceId,
          kind: 'weapon',
          participantId: player.participantId,
          zone: 'weapon',
          cardId: player.weapon.cardId
        }
        for (const block of cardDefinition(player.weapon.cardId)?.effects ?? []) {
          // A weapon's Deathrattle belongs only to the captured weapon that
          // entered the death queue. The newly equipped weapon must not replay
          // its own Deathrattle when the replaced weapon dies.
          if (block.trigger === 'deathrattle') continue
          if (
            this.triggerMatches(block.trigger, event) &&
            this.matchesEvent(block, event, source)
          )
            result.push({ source, block, order: order++ })
        }
      }
      for (const card of player.hand) {
        const source: EntityRef = {
          instanceId: card.instanceId,
          kind: 'card',
          participantId: player.participantId,
          zone: 'hand',
          cardId: card.cardId
        }
        for (const block of cardDefinition(card.cardId)?.effects ?? []) {
          const drawnCard =
            block.trigger === 'on-draw' &&
            event.kind === 'draw' &&
            event.target &&
            entityKey(event.target) === entityKey(source)
          const whileInHand = block.trigger === 'while-in-hand' && block.event
          if (
            (drawnCard || whileInHand) &&
            this.triggerMatches(block.trigger, event) &&
            this.matchesEvent(block, event, source)
          ) {
            result.push({ source, block, order: order++ })
          }
        }
      }
      for (const secret of player.secrets ?? []) {
        // Secrets are traps for the opposing turn. The current catalog has no
        // explicit self-turn exception, so enforce the common rule here rather
        // than depending on every authored event matcher to repeat it.
        if (this.draft.activePlayerId === player.participantId) continue
        const source: EntityRef = {
          instanceId: secret.instanceId,
          kind: 'secret',
          participantId: player.participantId,
          zone: 'secret',
          cardId: secret.cardId
        }
        for (const block of cardDefinition(secret.cardId)?.effects ?? []) {
          if (block.trigger === 'secret' && this.matchesEvent(block, event, source))
            result.push({ source, block, order: order++ })
        }
      }
    }
    if (event.kind === 'discard' && event.target?.kind === 'card') {
      const source = event.target
      for (const block of source.cardId
        ? (cardDefinition(source.cardId)?.effects ?? [])
        : []) {
        if (
          block.trigger === 'on-discard' &&
          this.triggerMatches(block.trigger, event) &&
          this.matchesEvent(block, event, source)
        )
          result.push({ source, block, order: order++ })
      }
    }
    for (const entry of this.deadSources.values()) {
      for (const block of entry.blocks) {
        // A death batch keeps all dead sources available while each
        // `minion-died` fact is emitted.  A deathrattle belongs only to the
        // matching dead entity; do not replay every queued source on every
        // death fact in the batch.
        if (
          event.source &&
          entityKey(event.source) === entityKey(entry.source) &&
          this.triggerMatches(block.trigger, event) &&
          this.matchesEvent(block, event, entry.source)
        ) {
          result.push({ source: entry.source, block, order: order++ })
        }
      }
    }
    return result.sort((left, right) => {
      const leftPlayOrder = this.playOrderFor(left.source)
      const rightPlayOrder = this.playOrderFor(right.source)
      if (leftPlayOrder !== null && rightPlayOrder !== null)
        return leftPlayOrder - rightPlayOrder || left.order - right.order
      if (leftPlayOrder !== null) return -1
      if (rightPlayOrder !== null) return 1
      return left.order - right.order
    })
  }

  private resolveEvent(event: SemanticEvent): void {
    this.step(`trigger.dispatch:${event.type}:${event.sequence}`, 'trigger')
    const frames = this.collectTriggerFrames(event)
    const deathEvent = event.type === 'minion-died' || event.type === 'weapon-died'
    if (deathEvent) {
      // Deathrattles, death triggers, and Secrets share one queue. Deathrattle
      // is not a privileged trigger type; the entity play timestamp decides
      // their order. Secret consumption is handled inline so Duplicate can
      // resolve before or after the dead source's own Deathrattle.
      for (const entry of frames) this.runTriggerFrame(event, entry, true)
      return
    }
    // Secret/replacement effects are an interrupt window.  They must inspect
    // the pending fact before ordinary listeners (such as on-cast) observe it.
    // A canceled event does not dispatch its ordinary trigger frames, but the
    // interrupt queue itself remains deterministic and can still chain.
    const interrupts = frames.filter((entry) => entry.block.trigger === 'secret')
    const ordinary = frames.filter((entry) => entry.block.trigger !== 'secret')
    for (const entry of interrupts) {
      this.runTriggerFrame(event, entry, true)
      if (event.cancelled || event.prevented) break
    }
    if (event.cancelled || event.prevented) return
    for (const entry of ordinary) this.runTriggerFrame(event, entry, false)
  }

  private runTriggerFrame(
    event: SemanticEvent,
    entry: {
      readonly source: EntityRef
      readonly block: CardEffectBlock
      readonly order: number
    },
    consumeSecrets: boolean
  ): void {
    const key = `${event.sequence}:${entry.order}:${entry.source.instanceId}:${entry.block.trigger}:${JSON.stringify(entry.block.event ?? null)}`
    if (this.firedTriggers.has(key)) return
    this.firedTriggers.add(key)
    const frame = this.frameFor(entry.source, event, [])
    if (event.kind === 'draw' && event.target?.kind === 'card')
      frame.drawnCards.push(event.target)
    // A matching Secret remains hidden when no action can change the current
    // state (for example, Mirror Entity with a full board). Its target can
    // also disappear after an earlier Secret in this same interrupt window.
    if (entry.source.kind === 'secret' && !this.secretCanTakeEffect(entry.block, frame))
      return
    const consumedSecret =
      consumeSecrets &&
      entry.source.kind === 'secret' &&
      entry.block.trigger === 'secret'
        ? this.takeSecret(entry.source)
        : null
    if (entry.source.kind === 'secret' && !consumedSecret) return
    this.runBlock(entry.block, frame, `trigger.${entry.block.trigger}`, true)
    if (consumedSecret)
      this.revealConsumedSecret(
        entry.source,
        consumedSecret,
        frame,
        `trigger.${entry.block.trigger}`
      )
  }

  /** Whether this Secret has at least one action that can affect the live state. */
  private secretCanTakeEffect(block: CardEffectBlock, frame: EffectFrame): boolean {
    if (block.condition && !this.conditionMatches(block.condition, frame)) return false
    return (block.actions ?? []).some((rawAction) => {
      const action = rawAction as Record<string, unknown>
      const name = stringValue(action.action)
      const targets = this.actionTargets(action, frame)
      switch (name) {
        case 'reveal':
          return false
        case 'summon': {
          const controller =
            action.controller === 'opponent'
              ? this.otherPlayer(frame.controllerId)
              : frame.controllerId
          return (
            this.player(controller).board.length < MAX_BOARD_SIZE &&
            this.actionCardId(action) !== null
          )
        }
        case 'summon-copy': {
          const sources =
            action.source === undefined ? targets : this.sourceEntities(action, frame)
          return (
            this.player(frame.controllerId).board.length < MAX_BOARD_SIZE &&
            sources.some(
              (target) => target.cardId !== undefined && this.isLiveSecretTarget(target)
            )
          )
        }
        case 'resurrect':
          return (
            this.player(frame.controllerId).board.length < MAX_BOARD_SIZE &&
            targets.some(
              (target) =>
                target.kind === 'minion' &&
                (this.player(target.participantId).graveyard ?? []).some(
                  (entry) => entry.minion.instanceId === target.instanceId
                )
            )
          )
        case 'copy':
          return (
            this.player(frame.controllerId).hand.length < MAX_HAND_SIZE &&
            targets.some((target) => target.cardId !== undefined)
          )
        case 'return-to-hand':
        case 'modify':
        case 'destroy':
        case 'damage':
          return targets.some((target) => this.isLiveSecretTarget(target))
        default:
          return true
      }
    })
  }

  private isLiveSecretTarget(ref: EntityRef): boolean {
    if (ref.kind === 'hero' || ref.kind === 'hero-power') return true
    if (ref.kind === 'minion')
      return this.player(ref.participantId).board.some(
        (minion) => minion.instanceId === ref.instanceId
      )
    if (ref.kind === 'card') return this.currentCard(ref) !== null
    if (ref.kind === 'weapon')
      return this.player(ref.participantId).weapon?.instanceId === ref.instanceId
    return (this.player(ref.participantId).secrets ?? []).some(
      (secret) => secret.instanceId === ref.instanceId
    )
  }

  private runBlock(
    block: CardEffectBlock,
    frame: EffectFrame,
    path: string,
    emitTriggerPresentation = false
  ): void {
    const kind: ResolutionQueueKind = path.startsWith('trigger.')
      ? 'trigger'
      : path.includes('.repeat')
        ? 'repeat'
        : 'branch'
    this.executeQueued(
      path,
      () => {
        const prior = this.activeFrame
        this.activeFrame = frame
        try {
          if (block.condition && !this.conditionMatches(block.condition, frame)) return
          const activation = emitTriggerPresentation
            ? this.emitTriggerActivated(frame, block.trigger)
            : null
          if (activation) this.activeTriggerIds.push(activation.activationId)
          try {
            if (block.choice) {
              const options = asArray(asRecord(block.choice).options)
              const choice = frame === this.activeFrame ? this.choiceForFrame(frame) : 0
              const option = options[choice]
              if (isRecord(option))
                this.runActions(
                  asArray(option.actions),
                  frame,
                  `${path}.choice[${choice}]`
                )
            } else if (block.actions) {
              this.runActions(block.actions, frame, `${path}.actions`)
            }
            if (block.then) {
              const branch = asRecord(block.then)
              if (!branch.condition || this.conditionMatches(branch.condition, frame))
                this.runActions(asArray(branch.actions), frame, `${path}.then`)
            }
            if (block.repeat) {
              const repeat = asRecord(block.repeat)
              let count = 0
              while (
                count < MAX_RESOLUTION_STEPS &&
                !this.conditionMatches(repeat.until, frame)
              ) {
                const priorEventSequence = frame.lastEvent?.sequence
                this.runActions(
                  asArray(repeat.actions),
                  frame,
                  `${path}.repeat[${count}]`
                )
                count += 1
                // A repeat whose action has no legal target is a completed empty
                // resolution, not an invitation to spin until the global budget.
                if (frame.lastEvent?.sequence === priorEventSequence) break
              }
              if (count >= MAX_RESOLUTION_STEPS)
                throw new ResolutionBudgetError(
                  'Repeat exceeded the resolution budget.',
                  frame
                )
            }
          } finally {
            if (activation) this.activeTriggerIds.pop()
          }
        } finally {
          this.activeFrame = prior
        }
      },
      kind
    )
  }

  private choiceForFrame(_frame: EffectFrame): number {
    return _frame.choiceIndex ?? 0
  }

  private runActions(
    actions: readonly unknown[],
    frame: EffectFrame,
    path: string
  ): void {
    actions.forEach((action, index) => {
      const actionPath = `${path}[${index}]`
      const kind: ResolutionQueueKind = path.includes('.repeat') ? 'repeat' : 'action'
      this.executeQueued(
        actionPath,
        () => {
          this.runAction(action, frame, actionPath)
          this.processDeaths()
        },
        kind
      )
    })
  }

  private conditionMatches(value: unknown, frame: EffectFrame): boolean {
    if (typeof value === 'string') {
      return this.conditionMatches({ type: value }, frame)
    }
    if (!isRecord(value) || typeof value.type !== 'string') return false
    const condition = value
    const target = this.targetForFrame(frame)
    const relativePlayer = (candidate: unknown): DraftPlayer => {
      if (candidate === 'opponent')
        return this.player(this.otherPlayer(frame.controllerId))
      if (candidate === 'turn-player' && this.draft.activePlayerId)
        return this.player(this.draft.activePlayerId)
      if (
        typeof candidate === 'string' &&
        this.draft.players.some((player) => player.participantId === candidate)
      )
        return this.player(candidate as PlayerId)
      return this.player(frame.controllerId)
    }
    const player = relativePlayer(condition.player)
    const prospectiveDefinition =
      frame.prospectiveCardPlay && frame.sourceCardId
        ? cardDefinition(frame.sourceCardId)
        : undefined
    const isProspectiveController = (targetPlayer: DraftPlayer): boolean =>
      frame.prospectiveCardPlay === true &&
      targetPlayer.participantId === frame.controllerId
    const cardsInConditionHand = (targetPlayer: DraftPlayer): readonly DraftCard[] =>
      isProspectiveController(targetPlayer)
        ? targetPlayer.hand.filter(
            (card) => card.instanceId !== frame.source.instanceId
          )
        : targetPlayer.hand
    const cardsPlayedEarlierThisTurn = Math.max(
      0,
      (this.draft.history?.cardsPlayedThisTurn.length ?? 0) -
        (frame.prospectiveCardPlay ? 0 : 1)
    )
    const matchingMinions = (
      targetPlayer: DraftPlayer,
      filter: unknown
    ): readonly EntityRef[] => {
      const candidates: EntityRef[] = targetPlayer.board.map((minion) => ({
        instanceId: minion.instanceId,
        kind: 'minion',
        participantId: targetPlayer.participantId,
        zone: 'board',
        cardId: minion.cardId
      }))
      if (
        isProspectiveController(targetPlayer) &&
        prospectiveDefinition?.type === 'Minion'
      ) {
        // The source remains a card reference so filters can read its authored
        // stats and keywords before a runtime minion instance exists.
        candidates.push(frame.source)
      }
      return candidates.filter((candidate) =>
        this.matchesFilter(candidate, filter, frame)
      )
    }
    switch (condition.type) {
      case 'board-has-minion-count':
        return this.compare(
          this.draft.players.reduce(
            (count, candidate) =>
              count + matchingMinions(candidate, condition.filter).length,
            0
          ),
          condition.operator,
          Number(condition.value)
        )
      case 'card-died-this-game':
        return condition.cardId === undefined
          ? (this.draft.history?.cardsDiedThisGame.length ?? 0) > 0
          : Boolean(
              this.draft.history?.cardsDiedThisGame.includes(String(condition.cardId))
            )
      case 'combo':
      case 'combo-active':
        return cardsPlayedEarlierThisTurn > 0
      case 'not-combo':
        return cardsPlayedEarlierThisTurn === 0
      case 'drawn-card-matches':
        return (
          frame.drawnCards.length > 0
            ? frame.drawnCards
            : frame.event?.target?.kind === 'card' && frame.event.target
              ? [frame.event.target]
              : []
        ).some((card) => this.matchesFilter(card, condition.filter, frame))
      case 'event-player-had-minion-count':
        return this.compare(
          frame.event?.minionCountBeforePlay ?? 0,
          condition.operator,
          Number(condition.value)
        )
      case 'player-controls-secret':
      case 'player-has-secret':
        return (player.secrets ?? []).length > 0
      case 'player-has-damaged-minion':
        return player.board.some((minion) => minion.health < minion.maxHealth)
      case 'player-has-card-in-hand':
        return cardsInConditionHand(player).some((card) =>
          this.matchesFilter(
            {
              instanceId: card.instanceId,
              kind: 'card',
              participantId: player.participantId,
              zone: 'hand',
              cardId: card.cardId
            },
            condition.filter,
            frame
          )
        )
      case 'player-has-hand-count':
        return this.compare(
          cardsInConditionHand(player).length,
          condition.operator,
          Number(condition.value)
        )
      case 'player-has-minion':
        return matchingMinions(player, condition.filter).length > 0
      case 'player-has-minion-count':
        return this.compare(
          matchingMinions(player, condition.filter).length,
          condition.operator,
          Number(condition.value)
        )
      case 'player-deck-has-no-duplicates': {
        const counts = new Map<string, number>()
        for (const card of player.deck)
          counts.set(card.cardId, (counts.get(card.cardId) ?? 0) + 1)
        return [...counts.values()].every((count) => count === 1)
      }
      case 'player-has-weapon':
        return (
          player.weapon !== null ||
          (isProspectiveController(player) && prospectiveDefinition?.type === 'Weapon')
        )
      case 'player-health-gt':
        return player.hero.health > Number(condition.value)
      case 'player-health-lte':
        return player.hero.health <= Number(condition.value)
      case 'player-lacks-minion':
        return matchingMinions(player, condition.filter).length === 0
      case 'player-lacks-weapon':
        return (
          player.weapon === null &&
          !(isProspectiveController(player) && prospectiveDefinition?.type === 'Weapon')
        )
      case 'source-damaged': {
        const minion = this.currentMinion(frame.source)
        if (minion) return minion.health < minion.maxHealth
        if (frame.source.kind === 'hero') {
          const hero = this.player(frame.source.participantId).hero
          return hero.health < hero.maxHealth
        }
        return false
      }
      case 'target-damaged': {
        if (!target) return false
        const minion = this.currentMinion(target)
        if (minion) return minion.health < minion.maxHealth
        if (target.kind === 'hero') {
          const hero = this.player(target.participantId).hero
          return hero.health < hero.maxHealth
        }
        return false
      }
      case 'target-died':
        if (
          frame.lastEvent?.type === 'minion-died' ||
          frame.event?.type === 'minion-died'
        )
          return true
        return Boolean(target?.kind === 'minion' && this.currentMinion(target) === null)
      case 'target-frozen':
        return Boolean(target && this.isFrozen(target))
      case 'target-is-friendly-demon': {
        return Boolean(
          target &&
          target.participantId === frame.controllerId &&
          this.entityCard(target)?.subtype === 'Demon'
        )
      }
      case 'target-is-not-friendly-demon': {
        return Boolean(
          target &&
          !(
            target.participantId === frame.controllerId &&
            this.entityCard(target)?.subtype === 'Demon'
          )
        )
      }
      case 'target-not-frozen':
        return Boolean(target && !this.isFrozen(target))
      case 'target-survived':
        if (!target) return false
        if (target.kind === 'hero')
          return this.player(target.participantId).hero.health > 0
        if (target.kind !== 'minion') return false
        return (this.currentMinion(target)?.health ?? 0) > 0
      default:
        return false
    }
  }

  private isFrozen(ref: EntityRef): boolean {
    if (ref.kind === 'minion')
      return (this.currentMinion(ref)?.frozenUntilTurn ?? -1) >= this.draft.turnNumber
    if (ref.kind === 'hero')
      return (
        (this.player(ref.participantId).hero.frozenUntilTurn ?? -1) >=
        this.draft.turnNumber
      )
    return false
  }

  private setHealth(ref: EntityRef, health: number): void {
    if (ref.kind === 'minion') {
      this.updateMinion(ref, (minion) => {
        minion.health = clamp(health, 0, minion.maxHealth)
        minion.damageTaken = Math.max(0, minion.maxHealth - minion.health)
      })
      return
    }
    if (ref.kind === 'hero') {
      const player = this.player(ref.participantId)
      player.hero.health = clamp(health, 0, player.hero.maxHealth)
      player.hero.damageTaken = Math.max(0, player.hero.maxHealth - player.hero.health)
    }
  }

  private addEnchantment(ref: EntityRef, enchantment: RuntimeEnchantment): void {
    if (ref.kind === 'minion') {
      this.updateMinion(ref, (minion) => {
        minion.enchantments = [
          ...(minion.enchantments ?? []),
          enchantment
        ] as unknown as DraftMinion['enchantments']
      })
    } else if (ref.kind === 'hero') {
      const player = this.player(ref.participantId)
      player.hero.enchantments = [
        ...(player.hero.enchantments ?? []),
        enchantment
      ] as unknown as Mutable<PlayerHeroState>['enchantments']
    } else if (ref.kind === 'weapon') {
      const player = this.player(ref.participantId)
      if (player.weapon)
        player.weapon.enchantments = [
          ...(player.weapon.enchantments ?? []),
          enchantment
        ] as unknown as Mutable<BoardWeapon>['enchantments']
    } else if (ref.kind === 'card') {
      const card = this.currentCard(ref)
      if (card)
        card.enchantments = [
          ...(card.enchantments ?? []),
          enchantment
        ] as unknown as DraftCard['enchantments']
    } else if (ref.kind === 'hero-power') {
      const power = this.player(ref.participantId).heroPower
      power.enchantments = [
        ...(power.enchantments ?? []),
        enchantment
      ] as unknown as Mutable<typeof power>['enchantments']
    }
  }

  private modifyEntity(
    ref: EntityRef,
    action: Record<string, unknown>,
    frame: EffectFrame,
    path: string
  ): void {
    const attackBefore = this.readAttack(ref)
    const maximumHealthBefore = this.readMaximumHealth(ref)
    const healthBefore =
      ref.kind === 'minion'
        ? (this.currentMinion(ref)?.health ?? maximumHealthBefore)
        : ref.kind === 'hero'
          ? this.player(ref.participantId).hero.health
          : ref.kind === 'card'
            ? (this.currentCard(ref)?.health ?? maximumHealthBefore)
            : maximumHealthBefore
    const durabilityBefore = this.readDurability(ref)
    const duration = stringValue(action.duration) ?? 'permanent'
    const enchantmentId = frame.continuous
      ? `${frame.source.instanceId}:continuous-enchantment:${ref.instanceId}:${path}`
      : this.allocateId(`${frame.source.instanceId}:enchantment`)
    const attackValue =
      action.attack === undefined
        ? undefined
        : this.valueForStat(action.attack, this.readAttack(ref), frame)
    const healthValue =
      action.health === undefined
        ? undefined
        : this.valueForStat(action.health, this.readMaximumHealth(ref), frame)
    const durabilityValue =
      action.durability === undefined
        ? undefined
        : this.valueForStat(action.durability, this.readDurability(ref), frame)
    const attackMultiplier =
      isRecord(action.attack) &&
      action.attack.operation === 'multiply' &&
      typeof action.attack.value === 'number'
        ? action.attack.value
        : undefined
    const healthMultiplier =
      isRecord(action.health) &&
      action.health.operation === 'multiply' &&
      typeof action.health.value === 'number'
        ? action.health.value
        : undefined
    const setsHealth = isRecord(action.health) && action.health.operation === 'set'
    const multiplierValues = {
      ...(typeof action.spellDamageMultiplier === 'number'
        ? { spellDamageMultiplier: action.spellDamageMultiplier }
        : {}),
      ...(typeof action.healingMultiplier === 'number'
        ? { healingMultiplier: action.healingMultiplier }
        : {}),
      ...(typeof action.heroPowerMultiplier === 'number'
        ? { heroPowerMultiplier: action.heroPowerMultiplier }
        : {}),
      ...(typeof action.maximumDamageTaken === 'number'
        ? { maximumDamageTaken: action.maximumDamageTaken }
        : {}),
      ...(typeof action.damageTakenMultiplier === 'number'
        ? { damageTakenMultiplier: action.damageTakenMultiplier }
        : {})
    }
    const enchantment: RuntimeEnchantment = {
      id: enchantmentId,
      sourceInstanceId: frame.source.instanceId,
      sourceCardId: frame.sourceCardId,
      ...(attackValue === undefined || attackMultiplier !== undefined
        ? {}
        : { attackDelta: attackValue - this.readAttack(ref) }),
      ...(attackMultiplier === undefined ? {} : { attackMultiplier }),
      ...(healthValue === undefined || healthMultiplier !== undefined
        ? {}
        : {
            healthDelta: healthValue - this.readMaximumHealth(ref),
            maximumHealthDelta: healthValue - this.readMaximumHealth(ref)
          }),
      ...(healthMultiplier === undefined ? {} : { healthMultiplier }),
      ...(durabilityValue === undefined
        ? {}
        : { durabilityDelta: durabilityValue - this.readDurability(ref) }),
      ...(typeof action.minimumHealth === 'number'
        ? { minimumHealth: action.minimumHealth }
        : {}),
      ...multiplierValues,
      duration,
      ...(duration === 'this-turn' ? { expiresOnTurn: this.draft.turnNumber } : {}),
      ...(duration === 'next-turn'
        ? {
            startsOnTurn: this.draft.turnNumber + 1,
            expiresOnTurn: this.draft.turnNumber + 1
          }
        : {}),
      ...(duration === 'until-next-turn'
        ? { expiresOnTurn: this.draft.turnNumber + 1 }
        : {}),
      ...(duration === 'this-attack' ? { expiresOnAttack: this.draft.turnNumber } : {}),
      ...(frame.continuous ? { continuous: true } : {})
    }
    this.addEnchantment(ref, enchantment)
    if (ref.kind === 'minion') {
      this.updateMinion(ref, (minion) => {
        if (action.attack !== undefined)
          minion.attack = Math.max(0, attackValue ?? minion.attack)
        if (action.health !== undefined) {
          const nextMaximum = Math.max(1, healthValue ?? minion.maxHealth)
          const previousMaximum = minion.maxHealth
          minion.maxHealth = nextMaximum
          minion.health = setsHealth
            ? nextMaximum
            : healthAfterMaximumChange(minion.health, previousMaximum, nextMaximum)
          minion.damageTaken = Math.max(0, minion.maxHealth - minion.health)
        }
        if (action.minimumHealth !== undefined)
          minion.health = Math.max(minion.health, Number(action.minimumHealth))
      })
    } else if (ref.kind === 'hero') {
      const player = this.player(ref.participantId)
      if (action.attack !== undefined)
        player.hero.attack = Math.max(0, attackValue ?? player.hero.attack)
      if (action.health !== undefined) {
        const nextMaximum = Math.max(1, healthValue ?? player.hero.maxHealth)
        const delta = nextMaximum - player.hero.maxHealth
        player.hero.maxHealth = nextMaximum
        player.hero.health = clamp(player.hero.health + delta, 0, nextMaximum)
      }
      if (typeof action.maximumDamageTaken === 'number')
        player.hero.maximumDamageTaken = Math.min(
          player.hero.maximumDamageTaken ?? Number.POSITIVE_INFINITY,
          action.maximumDamageTaken
        )
      if (typeof action.damageTakenMultiplier === 'number')
        player.hero.damageTakenMultiplier =
          (player.hero.damageTakenMultiplier ?? 1) * action.damageTakenMultiplier
    } else if (ref.kind === 'weapon') {
      const weapon = this.player(ref.participantId).weapon
      if (weapon) {
        if (action.attack !== undefined)
          weapon.attack = Math.max(0, attackValue ?? weapon.attack)
      }
    } else if (ref.kind === 'card') {
      const card = this.currentCard(ref)
      const definition = card ? cardDefinition(card.cardId) : undefined
      if (card) {
        const definitionAttack = definition?.type === 'Minion' ? definition.attack : 0
        const definitionHealth = definition?.type === 'Minion' ? definition.health : 1
        if (action.attack !== undefined)
          card.attack = Math.max(0, attackValue ?? card.attack ?? definitionAttack)
        if (action.health !== undefined)
          card.health = Math.max(1, healthValue ?? card.health ?? definitionHealth)
      }
    }
    if (ref.kind === 'weapon' && action.durability !== undefined)
      this.recomputeContinuousEffects()
    const attackAfter = this.readAttack(ref)
    const maximumHealthAfter = this.readMaximumHealth(ref)
    const healthAfter =
      ref.kind === 'minion'
        ? (this.currentMinion(ref)?.health ?? maximumHealthAfter)
        : ref.kind === 'hero'
          ? this.player(ref.participantId).hero.health
          : ref.kind === 'card'
            ? (this.currentCard(ref)?.health ?? maximumHealthAfter)
            : maximumHealthAfter
    const durabilityAfter = this.readDurability(ref)
    this.emit(frame, 'modify', path, {
      target: ref.instanceId,
      duration,
      attackBefore,
      attackAfter,
      healthBefore,
      healthAfter,
      maximumHealthBefore,
      maximumHealthAfter,
      durabilityBefore,
      durabilityAfter
    })
  }

  private readAttack(ref: EntityRef): number {
    if (ref.kind === 'minion') return this.currentMinion(ref)?.attack ?? 0
    if (ref.kind === 'weapon') return this.player(ref.participantId).weapon?.attack ?? 0
    if (ref.kind === 'hero') return this.player(ref.participantId).hero.attack
    if (ref.kind === 'card') {
      const card = this.currentCard(ref)
      const definition = card?.cardId ? cardDefinition(card.cardId) : undefined
      return card?.attack ?? (definition?.type === 'Minion' ? definition.attack : 0)
    }
    return 0
  }

  private readCost(ref: EntityRef): number {
    if (ref.kind === 'card') {
      const card = this.currentCard(ref)
      return (
        card?.currentCost ??
        card?.baseCost ??
        cardDefinition(ref.cardId ?? ('' as CardId))?.cost ??
        0
      )
    }
    if (ref.kind === 'hero-power') return this.player(ref.participantId).heroPower.cost
    return 0
  }

  private costForEntity(ref: EntityRef | undefined): number | undefined {
    if (!ref) return undefined
    if (ref.kind === 'card') return this.readCost(ref)
    return ref.cardId ? cardDefinition(ref.cardId)?.cost : undefined
  }

  private readMaximumHealth(ref: EntityRef): number {
    if (ref.kind === 'minion') return this.currentMinion(ref)?.maxHealth ?? 0
    if (ref.kind === 'hero') return this.player(ref.participantId).hero.maxHealth
    if (ref.kind === 'card') {
      const card = this.currentCard(ref)
      const definition = card?.cardId ? cardDefinition(card.cardId) : undefined
      return card?.health ?? (definition?.type === 'Minion' ? definition.health : 0)
    }
    return 0
  }

  private readDurability(ref: EntityRef): number {
    return ref.kind === 'weapon'
      ? (this.player(ref.participantId).weapon?.durability ?? 0)
      : 0
  }

  private sourceIsSpell(frame: EffectFrame): boolean {
    return Boolean(
      frame.sourceCardId && cardDefinition(frame.sourceCardId)?.type === 'Spell'
    )
  }

  private effectMultiplier(
    participantId: PlayerId,
    field: 'healingMultiplier' | 'heroPowerMultiplier' | 'spellDamageMultiplier'
  ): number {
    const player = this.player(participantId)
    return [
      player.hero[field] ?? 1,
      ...player.board.map((minion) => minion[field] ?? 1)
    ].reduce((value, multiplier) => value * Math.max(0, multiplier), 1)
  }

  private spellDamageBonus(participantId: PlayerId): number {
    const player = this.player(participantId)
    return (
      player.board.reduce((total, minion) => total + (minion.spellDamage ?? 0), 0) +
      (player.hero.spellDamage ?? 0)
    )
  }

  private hasKeyword(ref: EntityRef, keyword: CardKeyword): boolean {
    if (ref.kind === 'minion') {
      const minion = this.currentMinion(ref)
      if (!minion || minion.silenced) return false
      const keywords = effectiveBoardMinionKeywords(minion, this.draft.turnNumber)
      if (!keywords.includes(keyword)) return false
      if (keyword === 'divine-shield') return minion.divineShield === true
      if (keyword === 'stealth') return minion.stealth === true
      if (keyword === 'immune') return minion.immune === true
      if (keyword === 'spell-immune') return minion.spellImmune === true
      return true
    }
    if (ref.kind === 'hero') {
      const hero = this.player(ref.participantId).hero
      const keywords = new Set(hero.keywords ?? [])
      for (const enchantment of hero.enchantments ?? []) {
        if (
          (enchantment.startsOnTurn !== undefined &&
            this.draft.turnNumber < enchantment.startsOnTurn) ||
          (enchantment.duration === 'while-damaged' && hero.health >= hero.maxHealth)
        )
          continue
        for (const granted of enchantment.keywords ?? []) keywords.add(granted)
        for (const removed of enchantment.removedKeywords ?? [])
          keywords.delete(removed)
      }
      if (keyword === 'immune') return keywords.has(keyword) && hero.immune === true
      if (keyword === 'spell-immune')
        return keywords.has(keyword) && hero.spellImmune === true
      return keywords.has(keyword)
    }
    return false
  }

  private setKeyword(
    ref: EntityRef,
    keyword: CardKeyword,
    enabled: boolean,
    frame?: EffectFrame,
    path = 'keyword',
    duration = 'permanent',
    amount = 1
  ): void {
    if (frame) {
      const enchantment: RuntimeEnchantment = {
        id: frame.continuous
          ? `${frame.source.instanceId}:continuous-keyword:${ref.instanceId}:${path}`
          : this.allocateId(`${frame.source.instanceId}:keyword`),
        sourceInstanceId: frame.source.instanceId,
        sourceCardId: frame.sourceCardId,
        ...(enabled ? { keywords: [keyword] } : { removedKeywords: [keyword] }),
        ...(keyword === 'spell-damage' && enabled ? { spellDamageDelta: amount } : {}),
        duration: frame.continuous ? 'while-source-in-play' : duration,
        ...(duration === 'this-turn' ? { expiresOnTurn: this.draft.turnNumber } : {}),
        ...(duration === 'next-turn'
          ? {
              startsOnTurn: this.draft.turnNumber + 1,
              expiresOnTurn: this.draft.turnNumber + 1
            }
          : {}),
        ...(duration === 'until-next-turn'
          ? { expiresOnTurn: this.draft.turnNumber + 1 }
          : {}),
        ...(duration === 'this-attack'
          ? { expiresOnAttack: this.draft.turnNumber }
          : {}),
        ...(frame.continuous ? { continuous: true } : {})
      }
      this.addEnchantment(ref, enchantment)
      if (ref.kind === 'hero' && keyword === 'spell-damage') {
        const hero = this.player(ref.participantId).hero
        hero.spellDamage = enabled ? (hero.spellDamage ?? 0) + amount : 0
      }
      if (ref.kind === 'minion' && enabled) {
        this.updateMinion(ref, (minion) => {
          if (keyword === 'divine-shield') minion.divineShieldConsumed = false
          if (keyword === 'stealth') minion.stealthRevealed = false
        })
      }
      return
    }
    if (ref.kind === 'minion') {
      this.updateMinion(ref, (minion) => {
        const keywords = new Set<CardKeyword>(minion.keywords ?? [])
        if (enabled) keywords.add(keyword)
        else keywords.delete(keyword)
        minion.keywords = [...keywords]
        if (keyword === 'divine-shield') {
          minion.divineShield = enabled
          minion.divineShieldConsumed = !enabled
        }
        if (keyword === 'stealth') {
          minion.stealth = enabled
          minion.stealthRevealed = !enabled
        }
        if (keyword === 'immune') minion.immune = enabled
        if (keyword === 'spell-immune') minion.spellImmune = enabled
      })
      return
    }
    if (ref.kind === 'hero') {
      const hero = this.player(ref.participantId).hero
      const keywords = new Set<CardKeyword>(hero.keywords ?? [])
      if (enabled) keywords.add(keyword)
      else keywords.delete(keyword)
      hero.keywords = [...keywords]
      if (keyword === 'immune') hero.immune = enabled
      if (keyword === 'spell-immune') hero.spellImmune = enabled
    }
  }

  private damageAmounts(
    ref: EntityRef,
    amount: number,
    frame: EffectFrame,
    options: {
      readonly skipSpellScaling?: boolean
      readonly spellDamageBonusMultiplier?: number
    } = {}
  ): {
    readonly requested: number
    readonly scaledDamage: number
    readonly displayAmount: number
  } {
    const spellBonus =
      !options.skipSpellScaling && this.sourceIsSpell(frame)
        ? this.spellDamageBonus(frame.controllerId) *
          Math.max(0, options.spellDamageBonusMultiplier ?? 1)
        : 0
    const requested = Math.max(0, integer(amount) + spellBonus)
    const damageMultiplier = options.skipSpellScaling
      ? 1
      : frame.isHeroPower
        ? this.effectMultiplier(frame.controllerId, 'heroPowerMultiplier')
        : this.sourceIsSpell(frame)
          ? this.effectMultiplier(frame.controllerId, 'spellDamageMultiplier')
          : 1
    const scaledDamage = Math.max(0, integer(requested * damageMultiplier))
    const displayAmount =
      ref.kind === 'hero'
        ? Math.max(
            0,
            integer(
              Math.min(
                scaledDamage,
                this.player(ref.participantId).hero.maximumDamageTaken ??
                  Number.POSITIVE_INFINITY
              ) * (this.player(ref.participantId).hero.damageTakenMultiplier ?? 1)
            )
          )
        : scaledDamage
    return { requested, scaledDamage, displayAmount }
  }

  private applyDamage(
    ref: EntityRef,
    amount: number,
    frame: EffectFrame,
    path: string,
    options: {
      readonly skipSpellScaling?: boolean
      readonly spellDamageBonusMultiplier?: number
    } = {}
  ): number {
    if (ref.kind === 'hero') {
      const redirect = this.heroDamageRedirect(ref.participantId)
      if (redirect)
        return this.applyDamage(redirect, amount, frame, `${path}.redirect`, options)
    }
    const { requested, scaledDamage, displayAmount } = this.damageAmounts(
      ref,
      amount,
      frame,
      options
    )
    if (requested === 0) {
      this.emit(frame, 'damage', path, {
        target: ref.instanceId,
        amount: 0,
        displayAmount: 0,
        actualDamage: 0
      })
      return 0
    }
    if (
      this.hasKeyword(ref, 'immune') ||
      (this.sourceIsSpell(frame) && this.hasKeyword(ref, 'spell-immune'))
    ) {
      this.emit(frame, 'damage', path, {
        target: ref.instanceId,
        amount: requested,
        displayAmount,
        actualDamage: 0,
        prevented: true
      })
      return 0
    }
    if (ref.kind === 'minion' && this.hasKeyword(ref, 'divine-shield')) {
      this.updateMinion(ref, (minion) => {
        minion.divineShield = false
        minion.divineShieldConsumed = true
      })
      this.emit(frame, 'damage', path, {
        target: ref.instanceId,
        amount: requested,
        displayAmount,
        actualDamage: 0,
        shieldConsumed: true
      })
      return 0
    }
    let actualDamage = displayAmount
    let effectiveDamage: number
    if (ref.kind === 'hero') {
      const player = this.player(ref.participantId)
      const armorDamage = Math.min(player.hero.armor, actualDamage)
      const healthBefore = player.hero.health
      const armorBefore = player.hero.armor
      player.hero.armor -= armorDamage
      actualDamage -= armorDamage
      const healthAfter = Math.max(0, player.hero.health - actualDamage)
      player.hero.health = healthAfter
      player.hero.damageTaken = Math.max(0, player.hero.maxHealth - healthAfter)
      let totalDamage = armorDamage + actualDamage
      let effectiveArmorDamage = armorDamage
      this.historyUpdate((history) => {
        history.damageDealtThisTurn += totalDamage
        history.damageTakenThisTurn += totalDamage
      })
      if (healthAfter === 0) {
        const lethal: SemanticEvent = {
          sequence: this.semanticSequence++,
          type: 'hero-would-die',
          source: frame.source,
          target: ref,
          controllerId: frame.controllerId,
          targetControllerId: ref.participantId,
          damage: actualDamage,
          amount: actualDamage
        }
        this.resolveEvent(lethal)
        if (lethal.prevented) {
          const rolledBackDamage = totalDamage
          player.hero.health = healthBefore
          player.hero.armor = armorBefore
          player.hero.damageTaken = Math.max(0, player.hero.maxHealth - healthBefore)
          actualDamage = 0
          totalDamage = 0
          effectiveArmorDamage = 0
          this.historyUpdate((history) => {
            history.damageDealtThisTurn = Math.max(
              0,
              history.damageDealtThisTurn - rolledBackDamage
            )
            history.damageTakenThisTurn = Math.max(
              0,
              history.damageTakenThisTurn - rolledBackDamage
            )
          })
          this.recomputeContinuousEffects()
        }
      }
      this.emit(frame, 'damage', path, {
        target: ref.instanceId,
        amount: scaledDamage,
        displayAmount,
        actualDamage,
        armorDamage: effectiveArmorDamage,
        healthAfter: player.hero.health,
        armorAfter: player.hero.armor
      })
      effectiveDamage = totalDamage
    } else if (ref.kind === 'minion') {
      const minion = this.currentMinion(ref)
      if (!minion) return 0
      const minimumHealth = (minion.enchantments ?? []).reduce(
        (minimum, enchantment) => {
          const active =
            (enchantment.startsOnTurn === undefined ||
              this.draft.turnNumber >= enchantment.startsOnTurn) &&
            (enchantment.expiresOnTurn === undefined ||
              this.draft.turnNumber <= enchantment.expiresOnTurn) &&
            (enchantment.duration !== 'while-damaged' ||
              minion.health < minion.maxHealth) &&
            (enchantment.duration !== 'while-source-in-play' ||
              this.sourceIsInPlay(enchantment.sourceInstanceId))
          return active ? Math.max(minimum, enchantment.minimumHealth ?? 0) : minimum
        },
        0
      )
      actualDamage = Math.min(actualDamage, Math.max(0, minion.health - minimumHealth))
      minion.health = Math.max(minimumHealth, minion.health - actualDamage)
      minion.damageTaken = Math.max(0, minion.maxHealth - minion.health)
      this.historyUpdate((history) => {
        history.damageDealtThisTurn += actualDamage
        history.damageTakenThisTurn += actualDamage
      })
      this.emit(frame, 'damage', path, {
        target: ref.instanceId,
        amount: scaledDamage,
        displayAmount,
        actualDamage,
        healthAfter: minion.health
      })
      effectiveDamage = actualDamage
    } else {
      this.emit(frame, 'damage', path, {
        target: ref.instanceId,
        amount: scaledDamage,
        displayAmount,
        actualDamage: 0
      })
      return 0
    }
    if (effectiveDamage <= 0) return 0
    frame.damageDealt += effectiveDamage
    if (ref.kind === 'hero') {
      this.emitSemantic({
        type: 'hero-damaged',
        source: frame.source,
        target: ref,
        controllerId: frame.controllerId,
        targetControllerId: ref.participantId,
        damage: effectiveDamage,
        amount: effectiveDamage,
        kind: 'damage'
      })
    }
    this.emitSemantic({
      type: 'damage-dealt',
      source: frame.source,
      target: ref,
      controllerId: frame.controllerId,
      targetControllerId: ref.participantId,
      damage: effectiveDamage,
      amount: effectiveDamage,
      kind: 'damage'
    })
    return effectiveDamage
  }

  private hasHealthReplacement(participantId: PlayerId, frame: EffectFrame): boolean {
    if (!this.sourceIsSpell(frame) && !frame.isHeroPower) return false
    return this.player(participantId).board.some(
      (minion) =>
        !minion.silenced &&
        (cardDefinition(minion.cardId)?.effects ?? []).some(
          (effect) =>
            effect.trigger === 'aura' &&
            effect.actions?.some(
              (action) =>
                action.action === 'replace-event' && action.event === 'health-restored'
            )
        )
    )
  }

  private applyRestore(
    ref: EntityRef,
    amount: number,
    frame: EffectFrame,
    path: string
  ): number {
    const target =
      ref.kind === 'hero'
        ? this.player(ref.participantId).hero
        : this.currentMinion(ref)
    if (!target) return 0
    const maximum = ref.kind === 'hero' ? target.maxHealth : target.maxHealth
    const before = target.health
    const fullAmount = Number.isFinite(amount)
      ? Math.max(0, integer(amount))
      : Math.max(0, maximum - before)
    const multiplier = this.sourceIsSpell(frame)
      ? this.effectMultiplier(frame.controllerId, 'healingMultiplier')
      : frame.isHeroPower
        ? this.effectMultiplier(frame.controllerId, 'heroPowerMultiplier')
        : 1
    const displayAmount = Math.max(0, integer(fullAmount * multiplier))
    const healed = Math.max(0, Math.min(maximum, before + displayAmount) - before)
    if (healed === 0) {
      this.emit(frame, 'restore', path, {
        target: ref.instanceId,
        amount: 0,
        displayAmount,
        healthAfter: before
      })
      if (displayAmount > 0)
        this.emitSemantic({
          type: 'health-restored',
          source: frame.source,
          target: ref,
          controllerId: frame.controllerId,
          targetControllerId: ref.participantId,
          amount: 0,
          kind: 'heal',
          overheal: true
        })
      return 0
    }
    if (this.hasHealthReplacement(frame.controllerId, frame) && healed > 0) {
      const replacementFrame = cloneFrame(frame, `${path}.replace-event`)
      this.applyDamage(ref, healed, replacementFrame, `${path}.replacement`)
      this.emit(frame, 'restore', path, {
        target: ref.instanceId,
        amount: healed,
        displayAmount,
        replaced: true
      })
      return healed
    }
    target.health += healed
    if (ref.kind === 'hero')
      target.damageTaken = Math.max(0, target.maxHealth - target.health)
    else target.damageTaken = Math.max(0, target.maxHealth - target.health)
    this.historyUpdate((history) => {
      history.healingThisTurn += healed
    })
    this.emit(frame, 'restore', path, {
      target: ref.instanceId,
      amount: healed,
      displayAmount,
      healthAfter: target.health
    })
    this.emitSemantic({
      type: 'health-restored',
      source: frame.source,
      target: ref,
      controllerId: frame.controllerId,
      targetControllerId: ref.participantId,
      amount: healed,
      damage: healed,
      kind: 'heal',
      overheal: displayAmount > healed
    })
    return healed
  }

  private processDeaths(): void {
    // Death effects can create new lethal minions, but those deaths are not
    // checked until the current death event has finished resolving.
    if (this.deathResolutionDepth > 0) return

    type DeadMinionEntry = {
      readonly player: DraftPlayer
      readonly minion: DraftMinion
      readonly index: number
      readonly playerIndex: number
    }
    type DeathEntry = {
      readonly source: EntityRef
      readonly playOrder?: number
      readonly fallbackOrder: number
    }

    while (true) {
      const dead: DeadMinionEntry[] = []
      for (const [playerIndex, player] of this.draft.players.entries()) {
        player.board.forEach((minion, index) => {
          if (minion.health <= 0)
            dead.push({
              player,
              minion: minion as DraftMinion,
              index,
              playerIndex
            })
        })
      }
      const weapons = [...this.pendingWeaponDeaths.values()]
      if (dead.length === 0 && weapons.length === 0) return
      this.step('checkpoint.death-batch', 'death-batch')

      // A death batch is captured before any Deathrattle runs. The timestamp
      // records the entity's most recent entry into play; older fixtures fall
      // back to their stable creation ordinal and then board order.
      dead.sort((left, right) => {
        const leftOrdinal = left.minion.playOrder ?? left.minion.creationOrdinal
        const rightOrdinal = right.minion.playOrder ?? right.minion.creationOrdinal
        if (
          leftOrdinal !== undefined &&
          rightOrdinal !== undefined &&
          leftOrdinal !== rightOrdinal
        )
          return leftOrdinal - rightOrdinal
        if (leftOrdinal !== undefined && rightOrdinal === undefined) return -1
        if (leftOrdinal === undefined && rightOrdinal !== undefined) return 1
        return left.playerIndex - right.playerIndex || left.index - right.index
      })
      const deadKeys = new Set(dead.map((entry) => entry.minion.instanceId))
      const deathEntries: DeathEntry[] = []

      for (const entry of dead) {
        this.replaceBoard(
          entry.player,
          entry.player.board.filter((minion) => !deadKeys.has(minion.instanceId))
        )
        const snapshot = clonePlain(entry.minion) as DraftMinion
        const graveyardEntry: Mutable<GraveyardMinion> = {
          minion: snapshot,
          ownerId: entry.minion.ownerId ?? entry.player.participantId,
          controllerId: entry.minion.controllerId ?? entry.player.participantId,
          diedOnTurn: this.draft.turnNumber,
          deathOrdinal: this.nextEntityOrdinal
        }
        this.nextEntityOrdinal += 1
        this.appendGraveyard(entry.player, graveyardEntry)
        const source: EntityRef = {
          instanceId: entry.minion.instanceId,
          kind: 'minion',
          participantId: entry.player.participantId,
          zone: 'graveyard',
          cardId: entry.minion.cardId
        }
        const rememberedPosition = Math.max(
          0,
          entry.index -
            dead
              .slice(0, dead.indexOf(entry))
              .filter(
                (previous) =>
                  previous.playerIndex === entry.playerIndex &&
                  previous.index < entry.index
              ).length
        )
        this.deadSources.set(source.instanceId, {
          source,
          blocks: this.actionBlocksFor(source, 'deathrattle'),
          position: rememberedPosition,
          playOrder: entry.minion.playOrder ?? entry.minion.creationOrdinal
        })
        deathEntries.push({
          source,
          playOrder: entry.minion.playOrder ?? entry.minion.creationOrdinal,
          fallbackOrder: entry.playerIndex * 1000 + entry.index
        })
        this.historyUpdate((history) => {
          history.minionsDiedThisTurn = [
            ...history.minionsDiedThisTurn,
            entry.minion.cardId
          ]
          history.cardsDiedThisGame = [
            ...history.cardsDiedThisGame,
            entry.minion.cardId
          ]
        })
      }

      for (const weapon of weapons) {
        this.pendingWeaponDeaths.delete(weapon.source.instanceId)
        this.deadSources.set(weapon.source.instanceId, {
          source: weapon.source,
          blocks: weapon.blocks,
          playOrder: weapon.playOrder ?? undefined
        })
        deathEntries.push({
          source: weapon.source,
          playOrder: weapon.playOrder,
          fallbackOrder: 2000 + deathEntries.length
        })
      }

      deathEntries.sort((left, right) => {
        if (
          left.playOrder !== undefined &&
          right.playOrder !== undefined &&
          left.playOrder !== right.playOrder
        )
          return left.playOrder - right.playOrder
        if (left.playOrder !== undefined && right.playOrder === undefined) return -1
        if (left.playOrder === undefined && right.playOrder !== undefined) return 1
        return left.fallbackOrder - right.fallbackOrder
      })
      const batchId = `${this.resolutionId}:death-batch:${this.deathBatchSequence++}`
      const batchEvent: DeathBatchStartedEvent = {
        type: 'death-batch-started',
        batchId,
        deaths: deathEntries.map((entry) => {
          const dead = this.deadSources.get(entry.source.instanceId)
          return {
            instanceId: entry.source.instanceId,
            participantId: entry.source.participantId,
            kind: entry.source.kind as DeathBatchStartedEvent['deaths'][number]['kind'],
            cardId: entry.source.cardId!,
            ...(dead?.position === undefined ? {} : { position: dead.position }),
            hasDeathrattle: (dead?.blocks.length ?? 0) > 0
          }
        })
      }
      this.events.push(batchEvent)
      for (const entry of deathEntries) {
        this.deathResolutionDepth += 1
        try {
          this.emitSemantic({
            type: entry.source.kind === 'weapon' ? 'weapon-died' : 'minion-died',
            source: entry.source,
            target: entry.source,
            controllerId: entry.source.participantId,
            targetControllerId: entry.source.participantId,
            cardId: entry.source.cardId
          })
        } finally {
          this.deathResolutionDepth -= 1
        }
        this.deadSources.delete(entry.source.instanceId)
      }
      const completed: DeathBatchCompletedEvent = {
        type: 'death-batch-completed',
        batchId
      }
      this.events.push(completed)
    }
  }

  private addToDiscardedCards(player: DraftPlayer, card: DraftCard): void {
    this.applyCardZones(
      player,
      insertCardIntoPlayer(
        player as unknown as OpeningPlayerState,
        { ...card, zone: 'discarded', revealed: false },
        'discarded'
      )
    )
  }

  private moveToHand(ref: EntityRef, frame: EffectFrame, path: string): void {
    if (ref.kind === 'minion') {
      const controller = this.player(ref.participantId)
      const taken = this.takeBoardMinion(controller, ref.instanceId)
      if (!taken) return
      const { minion } = taken
      const definition = cardDefinition(minion.cardId)
      if (!definition) {
        this.insertBoardMinion(controller, minion, taken.index)
        return
      }
      const previous = { ...ref }
      // A bounced minion returns to its owner's hand, even if it was stolen.
      const ownerId = minion.ownerId ?? controller.participantId
      const owner = this.player(ownerId)
      const card: DraftCard = {
        instanceId: minion.instanceId,
        cardId: minion.cardId,
        ownerId,
        controllerId: ownerId,
        creationOrdinal: minion.creationOrdinal,
        baseCost: definition.cost,
        currentCost: definition.cost,
        zone: 'hand',
        revealed: true
      }
      if (owner.hand.length >= MAX_HAND_SIZE) {
        this.addToDiscardedCards(owner, {
          ...card,
          zone: 'discarded',
          revealed: false
        })
        this.emit(frame, 'return-to-hand', path, {
          target: ref.instanceId,
          burned: true
        })
        return
      }
      this.applyCardZones(
        owner,
        insertCardIntoPlayer(owner as unknown as OpeningPlayerState, card, 'hand')
      )
      this.replaceEventReference(frame, previous, {
        ...previous,
        kind: 'card',
        zone: 'hand',
        cardId: card.cardId
      })
      this.emit(frame, 'return-to-hand', path, {
        target: ref.instanceId,
        cardId: card.cardId
      })
      return
    }
    if (ref.kind === 'card') {
      const card = this.removeCard(ref)
      if (card) {
        const returned = this.addCardToHand(
          ref.participantId,
          card.cardId,
          frame,
          path,
          card.instanceId,
          false
        )
        if (returned) this.replaceEventReference(frame, ref, returned)
      }
      return
    }
  }

  private createMinion(
    participantId: PlayerId,
    cardId: CardId,
    frame: EffectFrame,
    path: string,
    sourceInstanceId?: string,
    position?: number,
    copyFrom?: DraftMinion,
    cardState?: DraftCard,
    deferSummonTriggers = false
  ): EntityRef | null {
    const player = this.player(participantId)
    if (player.board.length >= MAX_BOARD_SIZE) return null
    const definition = cardDefinition(cardId)
    if (!definition || definition.type !== 'Minion') return null
    const instanceId = sourceInstanceId ?? this.allocateId(`${participantId}:summoned`)
    const minion: DraftMinion = {
      instanceId,
      cardId,
      attack: copyFrom?.attack ?? cardState?.attack ?? definition.attack,
      health: copyFrom?.health ?? cardState?.health ?? definition.health,
      maxHealth: copyFrom?.maxHealth ?? cardState?.health ?? definition.health,
      summonedOnTurn: this.draft.turnNumber,
      lastAttackedOnTurn: null,
      ownerId: cardState?.ownerId ?? participantId,
      controllerId: participantId,
      creationOrdinal: cardState?.creationOrdinal ?? this.nextEntityOrdinal++,
      playOrder: this.nextEntityOrdinal++,
      baseAttack: copyFrom?.baseAttack ?? definition.attack,
      baseHealth: copyFrom?.baseHealth ?? definition.health,
      keywords: copyFrom?.keywords
        ? copyPlainArray(copyFrom.keywords)
        : [...definition.keywords],
      enchantments: copyFrom?.enchantments
        ? (this.cloneCopiedEnchantments(
            copyFrom.enchantments
          ) as unknown as DraftMinion['enchantments'])
        : cardState?.enchantments
          ? copyPlainArray(
              cardState.enchantments.filter((enchantment) => !enchantment.continuous)
            )
          : [],
      grantedTriggers: copyFrom?.grantedTriggers
        ? (this.cloneCopiedGrantedTriggers(
            copyFrom.grantedTriggers
          ) as unknown as DraftMinion['grantedTriggers'])
        : [],
      attachedEffects: copyFrom?.attachedEffects
        ? (this.cloneCopiedAttachedEffects(
            copyFrom.attachedEffects
          ) as unknown as DraftMinion['attachedEffects'])
        : [],
      deathrattles: copyFrom?.deathrattles ? copyPlainArray(copyFrom.deathrattles) : [],
      silenced: copyFrom?.silenced ?? false,
      frozenUntilTurn: copyFrom?.frozenUntilTurn ?? null,
      divineShield:
        copyFrom?.divineShield ?? definition.keywords.includes('divine-shield'),
      divineShieldConsumed: copyFrom?.divineShieldConsumed ?? false,
      stealth: copyFrom?.stealth ?? definition.keywords.includes('stealth'),
      stealthRevealed: copyFrom?.stealthRevealed ?? false,
      immune: copyFrom?.immune ?? definition.keywords.includes('immune'),
      spellImmune:
        copyFrom?.spellImmune ?? definition.keywords.includes('spell-immune'),
      attacksUsedThisTurn: 0,
      maxAttacksPerTurn: definition.keywords.includes('mega-windfury')
        ? 4
        : definition.keywords.includes('windfury')
          ? 2
          : 1,
      damageTaken: Math.max(
        0,
        (copyFrom?.maxHealth ?? definition.health) -
          (copyFrom?.health ?? definition.health)
      )
    }
    const insertion = this.insertBoardMinion(
      player,
      minion,
      position === undefined ? undefined : position
    )
    const ref: EntityRef = {
      instanceId,
      kind: 'minion',
      participantId,
      zone: 'board',
      cardId
    }
    this.historyUpdate((history) => {
      history.minionsSummonedThisTurn = [...history.minionsSummonedThisTurn, cardId]
      if (cardDefinition(cardId)?.subtype === 'Beast')
        history.beastsSummonedByPlayer = {
          ...history.beastsSummonedByPlayer,
          [participantId]: (history.beastsSummonedByPlayer[participantId] ?? 0) + 1
        }
    })
    this.emit(frame, 'summon', path, {
      participantId,
      cardId,
      instanceId,
      position: insertion
    })
    if (!deferSummonTriggers) {
      this.events.push({
        type: 'minion-summoned',
        participantId,
        minion: clonePlain(minion) as BoardMinion,
        position: insertion
      } satisfies MinionSummonedEvent)
      this.emitMinionSummoned(frame, ref, participantId, cardId, instanceId)
    }
    return ref
  }

  private emitMinionSummoned(
    frame: EffectFrame,
    target: EntityRef,
    participantId: PlayerId,
    cardId: CardId,
    instanceId: string
  ): void {
    this.emitSemantic({
      type: 'minion-summoned',
      source: frame.source,
      target,
      controllerId: participantId,
      targetControllerId: participantId,
      cardId,
      cardInstanceId: instanceId
    })
  }

  private equip(
    participantId: PlayerId,
    cardId: CardId,
    frame: EffectFrame,
    path: string,
    preferredInstanceId?: string,
    preferredCreationOrdinal?: number
  ): void {
    const definition = cardDefinition(cardId)
    if (!definition || definition.type !== 'Weapon') return
    const player = this.player(participantId)
    const replaced = player.weapon
    if (replaced)
      this.queueWeaponDeath({
        instanceId: replaced.instanceId,
        kind: 'weapon',
        participantId,
        zone: 'weapon',
        cardId: replaced.cardId
      })
    player.weapon = {
      instanceId: preferredInstanceId ?? this.allocateId(`${participantId}:weapon`),
      cardId,
      attack: definition.attack,
      durability: definition.durability,
      maxDurability: definition.durability,
      ownerId: participantId,
      controllerId: participantId,
      creationOrdinal: preferredCreationOrdinal ?? this.nextEntityOrdinal++,
      playOrder: this.nextEntityOrdinal++,
      enchantments: []
    }
    this.emitSemantic({
      type: 'weapon-equipped',
      source: frame.source,
      target: {
        instanceId: player.weapon.instanceId,
        kind: 'weapon',
        participantId,
        zone: 'weapon',
        cardId
      },
      controllerId: participantId,
      targetControllerId: participantId,
      cardId,
      cardInstanceId: player.weapon.instanceId,
      kind: 'play'
    })
    this.emit(frame, 'equip', path, {
      participantId,
      cardId,
      replacedWeapon: replaced?.cardId ?? null
    })
  }

  private removeSecret(ref: EntityRef): void {
    if (ref.kind !== 'secret') return
    const player = this.player(ref.participantId)
    this.replaceSecrets(
      player,
      (player.secrets ?? []).filter((secret) => secret.instanceId !== ref.instanceId)
    )
  }

  private takeSecret(ref: EntityRef): SecretState | null {
    const secret = this.player(ref.participantId).secrets?.find(
      (candidate) => candidate.instanceId === ref.instanceId
    )
    if (!secret) return null
    this.removeSecret(ref)
    return secret
  }

  private revealConsumedSecret(
    ref: EntityRef,
    secret: SecretState,
    frame: EffectFrame,
    path: string
  ): void {
    this.emit(frame, 'reveal', path, {
      secretId: ref.instanceId,
      cardId: secret.cardId
    })
    this.emitSemantic({
      type: 'secret-revealed',
      source: ref,
      target: ref,
      controllerId: ref.participantId,
      targetControllerId: ref.participantId,
      cardId: secret.cardId,
      cardInstanceId: ref.instanceId
    })
  }

  private actionCardId(action: Record<string, unknown>): CardId | null {
    if (typeof action.cardId !== 'string') return null
    const cardId = action.cardId as CardId
    return cardDefinition(cardId) ? cardId : null
  }

  private drawOne(
    participantId: PlayerId,
    frame: EffectFrame,
    path: string,
    requested?: EntityRef
  ): EntityRef | null {
    const player = this.player(participantId)
    const top =
      requested ??
      (player.deck[0]
        ? {
            instanceId: player.deck[0].instanceId,
            kind: 'card' as const,
            participantId,
            zone: 'deck' as const,
            cardId: player.deck[0].cardId
          }
        : undefined)
    const card = top ? this.removeCard(top) : null
    if (!card) {
      const heroRef: EntityRef = {
        instanceId: `${participantId}:hero`,
        kind: 'hero',
        participantId,
        zone: 'hero'
      }
      const healthBefore = player.hero.health
      const armorBefore = player.hero.armor
      const attemptedAmount = this.damageAmounts(
        heroRef,
        player.fatigueDamage,
        frame
      ).displayAmount
      this.applyDamage(heroRef, player.fatigueDamage, frame, `${path}.fatigue`)
      player.fatigueDamage += 1
      this.emit(frame, 'draw', path, {
        participantId,
        fatigue: player.fatigueDamage - 1
      })
      this.events.push({
        type: 'fatigue',
        participantId,
        amount: player.fatigueDamage - 1,
        nextDamage: player.fatigueDamage
      })
      this.events.push({
        type: 'character-damaged',
        source: 'fatigue',
        participantId,
        character: { kind: 'hero' },
        amount: player.fatigueDamage - 1,
        attemptedAmount,
        healthBefore,
        healthAfter: player.hero.health,
        armorBefore,
        armorAfter: player.hero.armor,
        destroyed: player.hero.health <= 0
      })
      return null
    }
    if (player.hand.length >= MAX_HAND_SIZE) {
      this.addToDiscardedCards(player, {
        ...card,
        zone: 'discarded',
        revealed: false
      })
      this.emit(frame, 'burn', path, {
        participantId,
        cardId: card.cardId,
        instanceId: card.instanceId
      })
      this.events.push({
        type: 'card-burned',
        participantId,
        card: clonePlain({
          ...card,
          zone: 'discarded',
          revealed: false
        }) as OpeningCard
      })
      return null
    }
    card.ownerId = card.ownerId ?? participantId
    const updatedPlayer = insertCardIntoPlayer(
      player as unknown as OpeningPlayerState,
      card,
      'hand'
    ) as DraftPlayer
    this.applyCardZones(player, updatedPlayer)
    const ref: EntityRef = {
      instanceId: card.instanceId,
      kind: 'card',
      participantId,
      zone: 'hand',
      cardId: card.cardId
    }
    frame.drawnCards.push(ref)
    this.historyUpdate((history) => {
      history.cardsDrawnThisTurn = [...history.cardsDrawnThisTurn, card.cardId]
    })
    this.emit(frame, 'draw', path, {
      participantId,
      cardId: card.cardId,
      instanceId: card.instanceId
    })
    this.events.push({
      type: 'card-drawn',
      participantId,
      card: clonePlain(card) as OpeningCard
    })
    this.emitSemantic({
      type: 'card-played',
      source: ref,
      target: ref,
      controllerId: participantId,
      targetControllerId: participantId,
      cardId: card.cardId,
      cardInstanceId: card.instanceId,
      card,
      kind: 'draw'
    })
    // Burrowing Mine is a generated deck trap rather than a playable hand
    // card.  Its authored on-draw block resolves while the card is in hand;
    // after that event it is consumed and remains only in discarded history.
    if (card.cardId === 'goblins_vs_gnomes_burrowing_mine') {
      const drawnPlayer = this.player(participantId)
      const handIndex = drawnPlayer.hand.findIndex(
        (candidate) => candidate.instanceId === card.instanceId
      )
      if (handIndex >= 0) {
        const mine = this.removeCard({
          instanceId: card.instanceId,
          kind: 'card',
          participantId,
          zone: 'hand',
          cardId: card.cardId
        })
        if (mine)
          this.addToDiscardedCards(drawnPlayer, {
            ...mine,
            zone: 'discarded',
            revealed: false
          })
      }
    }
    return ref
  }

  private sourceEntities(
    action: Record<string, unknown>,
    frame: EffectFrame
  ): EntityRef[] {
    if (action.source === undefined) return []
    const sourceSelector = isRecord(action.source) ? action.source : null
    if (action.source === 'random-card') {
      const randomCardIds = Array.isArray(action.pool)
        ? action.pool.filter((entry): entry is string => typeof entry === 'string')
        : [
            ...CARD_CATALOG.all
              .filter((card) => card.collectible)
              .map((card) => card.id),
            ...GENERATED_CARD_DEFINITIONS.map((card) => card.id)
          ]
      const candidates = randomCardIds
        .map((cardId) => ({
          instanceId: `${frame.controllerId}:pool:${cardId}`,
          kind: 'card' as const,
          participantId: frame.controllerId,
          zone: 'revealed' as const,
          cardId: cardId as CardId
        }))
        .filter((candidate) => this.matchesFilter(candidate, action.filter, frame))
      const count =
        action.count === undefined
          ? 1
          : Math.max(0, Math.floor(this.evaluate(action.count, frame)))
      const pool = [...candidates]
      const selected: EntityRef[] = []
      while (selected.length < count && pool.length > 0) {
        const index = Math.floor(this.rng.next() * pool.length)
        selected.push(...pool.splice(index, 1))
      }
      return selected
    }
    let source =
      sourceSelector?.selection === 'random' && action.count !== undefined
        ? this.selectorCandidates(
            { ...sourceSelector, selection: 'all', count: undefined },
            frame
          )
        : this.cardRefsFromSource(action.source, frame)
    const filter = action.filter
    source = source.filter((candidate) => this.matchesFilter(candidate, filter, frame))
    if (action.source === 'deck-top') {
      const count =
        action.count === undefined
          ? 1
          : Math.max(0, Math.floor(this.evaluate(action.count, frame)))
      return source.slice(0, count)
    }
    if (action.selection === 'random' || sourceSelector?.selection === 'random') {
      const count =
        action.count === undefined
          ? 1
          : Math.max(0, Math.floor(this.evaluate(action.count, frame)))
      const pool = [...source]
      const selected: EntityRef[] = []
      while (selected.length < count && pool.length > 0) {
        const index = Math.floor(this.rng.next() * pool.length)
        selected.push(...pool.splice(index, 1))
      }
      return selected
    }
    if (action.count !== undefined && action.source !== 'random-card') {
      return source.slice(
        0,
        Math.max(0, Math.floor(this.evaluate(action.count, frame)))
      )
    }
    return source
  }

  /** Resolves a zone source relative to the participant receiving the effect. */
  private sourceEntitiesForParticipant(
    action: Record<string, unknown>,
    frame: EffectFrame,
    participantId: PlayerId
  ): EntityRef[] {
    return this.sourceEntities(action, {
      ...frame,
      controllerId: participantId
    })
  }

  private shuffle<T>(items: readonly T[]): T[] {
    const result = [...items]
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(this.rng.next() * (index + 1))
      const current = result[index]
      const replacement = result[swapIndex]
      if (current === undefined || replacement === undefined) continue
      result[index] = replacement
      result[swapIndex] = current
    }
    return result
  }

  private changeCost(
    ref: EntityRef,
    amount: number,
    action: Record<string, unknown>,
    frame: EffectFrame,
    path: string
  ): void {
    if (ref.kind === 'hero-power') {
      const power = this.player(ref.participantId).heroPower
      const adjustment: RuntimeEnchantment = {
        id: frame.continuous
          ? `${frame.source.instanceId}:continuous-power-cost:${ref.instanceId}:${path}`
          : this.allocateId(`${frame.source.instanceId}:power-cost`),
        sourceInstanceId: frame.source.instanceId,
        sourceCardId: frame.sourceCardId,
        costDelta: amount,
        ...(action.deferUntil === 'next-hero-power-used'
          ? { consumeOnHeroPowerUse: true }
          : {}),
        duration: stringValue(action.duration) ?? 'permanent',
        ...(action.duration === 'until-next-turn'
          ? { expiresOnTurn: this.draft.turnNumber + 1 }
          : {}),
        ...(action.duration === 'next-turn'
          ? {
              startsOnTurn: this.draft.turnNumber + 1,
              expiresOnTurn: this.draft.turnNumber + 1
            }
          : {}),
        ...(frame.continuous ? { continuous: true } : {})
      }
      this.addEnchantment(ref, adjustment)
      power.cost = Math.max(0, power.cost + amount)
      this.emit(frame, 'change-cost', path, {
        target: ref.instanceId,
        amount,
        currentCost: power.cost
      })
      return
    }
    const card = this.updateCard(ref, (draftCard) => {
      const definition = cardDefinition(draftCard.cardId)
      const baseCost = draftCard.baseCost ?? definition?.cost ?? 0
      draftCard.baseCost = baseCost
      const duration = stringValue(action.duration) ?? 'permanent'
      const adjustment: RuntimeCostAdjustment = {
        id: frame.continuous
          ? `${frame.source.instanceId}:continuous-cost:${ref.instanceId}:${path}`
          : this.allocateId(`${frame.source.instanceId}:cost`),
        sourceInstanceId: frame.source.instanceId,
        amount,
        duration,
        continuous: frame.continuous,
        ...(duration === 'this-turn' ? { expiresOnTurn: this.draft.turnNumber } : {}),
        ...(duration === 'until-next-turn'
          ? { expiresOnTurn: this.draft.turnNumber + 1 }
          : {}),
        ...(duration === 'next-turn'
          ? {
              startsOnTurn: this.draft.turnNumber + 1,
              expiresOnTurn: this.draft.turnNumber + 1
            }
          : {})
      }
      draftCard.costAdjustments = [...(draftCard.costAdjustments ?? []), adjustment]
      const total = draftCard.costAdjustments.reduce(
        (sum, entry) => sum + entry.amount,
        0
      )
      const minimum = typeof action.minimum === 'number' ? action.minimum : 0
      draftCard.currentCost = Math.max(minimum, baseCost + total)
    })
    if (card)
      this.emit(frame, 'change-cost', path, {
        target: ref.instanceId,
        amount,
        currentCost: card.currentCost ?? 0
      })
  }

  private removeBoardMinion(ref: EntityRef): DraftMinion | null {
    if (ref.kind !== 'minion') return null
    return (
      this.takeBoardMinion(this.player(ref.participantId), ref.instanceId)?.minion ??
      null
    )
  }

  private queueWeaponDeath(ref: EntityRef): boolean {
    if (ref.kind !== 'weapon' || this.pendingWeaponDeaths.has(ref.instanceId))
      return false
    const player = this.player(ref.participantId)
    const weapon = player.weapon
    if (!weapon || weapon.instanceId !== ref.instanceId) return false
    const source: EntityRef = {
      instanceId: weapon.instanceId,
      kind: 'weapon',
      participantId: player.participantId,
      zone: 'graveyard',
      cardId: weapon.cardId
    }
    this.pendingWeaponDeaths.set(source.instanceId, {
      source,
      blocks:
        cardDefinition(weapon.cardId)?.effects.filter(
          (effect) => effect.trigger === 'deathrattle'
        ) ?? [],
      playOrder: weapon.playOrder ?? weapon.creationOrdinal
    })
    player.weapon = null
    return true
  }

  private directDestroy(ref: EntityRef, frame: EffectFrame, path: string): void {
    if (ref.kind === 'minion') {
      const minion = this.currentMinion(ref)
      if (!minion) return
      minion.health = 0
      if (!frame.destroyedMinions.some((entry) => entry.instanceId === ref.instanceId))
        frame.destroyedMinions.push(ref)
      this.emit(frame, 'destroy', path, {
        target: ref.instanceId,
        cardId: minion.cardId
      })
      this.emitSemantic({
        type: 'minion-destroyed',
        source: frame.source,
        target: ref,
        controllerId: frame.controllerId,
        targetControllerId: ref.participantId,
        cardId: minion.cardId,
        cardInstanceId: minion.instanceId
      })
    } else if (ref.kind === 'hero') {
      this.setHealth(ref, 0)
      this.emit(frame, 'destroy', path, { target: ref.instanceId })
    } else if (ref.kind === 'weapon') {
      this.queueWeaponDeath(ref)
      this.emit(frame, 'destroy', path, { target: ref.instanceId })
    } else if (ref.kind === 'secret') {
      this.removeSecret(ref)
      this.emit(frame, 'destroy', path, { target: ref.instanceId })
    }
  }

  private setEntityController(
    ref: EntityRef,
    controllerId: PlayerId,
    frame: EffectFrame,
    path: string
  ): boolean {
    if (ref.kind !== 'minion' && ref.kind !== 'secret') return false
    if (ref.kind === 'secret') {
      const sourcePlayer = this.player(ref.participantId)
      const secret = sourcePlayer.secrets?.find(
        (candidate) => candidate.instanceId === ref.instanceId
      )
      if (!secret) return false
      if (sourcePlayer.participantId === controllerId) return true
      this.removeSecret(ref)
      this.appendSecret(this.player(controllerId), {
        ...secret,
        controllerId
      })
      this.emit(frame, 'take-control', path, {
        target: ref.instanceId,
        controllerId
      })
      return true
    }
    const sourcePlayer = this.player(ref.participantId)
    const minion = sourcePlayer.board.find(
      (candidate) => candidate.instanceId === ref.instanceId
    ) as DraftMinion | undefined
    if (!minion) return false
    const targetPlayer = this.player(controllerId)
    if (sourcePlayer.participantId === controllerId) return true
    if (targetPlayer.board.length >= MAX_BOARD_SIZE) {
      this.directDestroy(ref, frame, `${path}.board-full`)
      return false
    }
    const taken = this.takeBoardMinion(sourcePlayer, ref.instanceId)
    if (!taken) return false
    taken.minion.controllerId = controllerId
    taken.minion.controllerChangedOnTurn = this.draft.turnNumber
    this.insertBoardMinion(targetPlayer, taken.minion)
    this.emit(frame, 'take-control', path, {
      target: ref.instanceId,
      controllerId
    })
    return true
  }

  private transformMinion(
    ref: EntityRef,
    cardId: CardId,
    frame: EffectFrame,
    path: string
  ): void {
    if (ref.kind !== 'minion') return
    const minion = this.currentMinion(ref)
    const definition = cardDefinition(cardId)
    if (!minion || !definition || definition.type !== 'Minion') return
    minion.cardId = cardId
    minion.baseAttack = definition.attack
    minion.baseHealth = definition.health
    minion.attack = definition.attack
    minion.maxHealth = definition.health
    minion.health = definition.health
    minion.keywords = [...definition.keywords]
    minion.enchantments = []
    minion.grantedTriggers = []
    minion.attachedEffects = []
    minion.deathrattles = []
    minion.silenced = false
    minion.divineShield = definition.keywords.includes('divine-shield')
    minion.divineShieldConsumed = false
    minion.stealth = definition.keywords.includes('stealth')
    minion.stealthRevealed = false
    minion.immune = definition.keywords.includes('immune')
    minion.spellImmune = definition.keywords.includes('spell-immune')
    minion.frozenUntilTurn = null
    minion.damageTaken = 0
    this.emit(frame, 'transform', path, { target: ref.instanceId, cardId })
  }

  private cloneCopiedEnchantments(
    enchantments: readonly RuntimeEnchantment[]
  ): RuntimeEnchantment[] {
    return enchantments
      .filter((enchantment) => !enchantment.continuous)
      .map((enchantment) => ({
        ...clonePlain(enchantment),
        id: this.allocateId(`${enchantment.sourceInstanceId}:copied-enchantment`)
      }))
  }

  private cloneCopiedGrantedTriggers(
    triggers: readonly RuntimeGrantedTrigger[]
  ): RuntimeGrantedTrigger[] {
    return triggers.map((trigger) => ({
      ...clonePlain(trigger),
      id: this.allocateId(`${trigger.sourceInstanceId}:copied-trigger`)
    }))
  }

  private cloneCopiedAttachedEffects(
    effects: readonly RuntimeAttachedEffect[]
  ): RuntimeAttachedEffect[] {
    return effects.map((effect) => ({
      ...clonePlain(effect),
      id: this.allocateId(`${effect.sourceInstanceId}:copied-attached-effect`)
    }))
  }

  /**
   * Replaces an existing board minion's visible form and attached state with
   * an exact snapshot of another live minion. Runtime identity and entry/attack
   * history belong to the destination and are deliberately not copied.
   */
  private transformMinionIntoCopy(
    destinationRef: EntityRef,
    sourceRef: EntityRef,
    frame: EffectFrame,
    path: string
  ): void {
    if (destinationRef.kind !== 'minion' || sourceRef.kind !== 'minion') return
    const destination = this.currentMinion(destinationRef)
    const source = this.currentMinion(sourceRef)
    if (!destination || !source) return

    const sourceSnapshot = clonePlain(source) as DraftMinion
    const destinationIdentity = {
      instanceId: destination.instanceId,
      ownerId: destination.ownerId,
      controllerId: destination.controllerId,
      creationOrdinal: destination.creationOrdinal,
      playOrder: destination.playOrder,
      summonedOnTurn: destination.summonedOnTurn,
      controllerChangedOnTurn: destination.controllerChangedOnTurn,
      lastAttackedOnTurn: destination.lastAttackedOnTurn,
      attacksUsedThisTurn: destination.attacksUsedThisTurn
    }

    Object.assign(destination, sourceSnapshot, destinationIdentity, {
      enchantments: this.cloneCopiedEnchantments(sourceSnapshot.enchantments ?? []),
      grantedTriggers: this.cloneCopiedGrantedTriggers(
        sourceSnapshot.grantedTriggers ?? []
      ),
      attachedEffects: this.cloneCopiedAttachedEffects(
        sourceSnapshot.attachedEffects ?? []
      )
    })

    this.recomputeContinuousEffects()
    this.emit(frame, 'transform', path, {
      target: destination.instanceId,
      cardId: destination.cardId,
      copiedFrom: source.instanceId
    })
  }

  /**
   * Exchanges the actual board and hand instances.  This is deliberately not a
   * transform: the bounced minion keeps its identity in hand and the hand card
   * keeps its identity when it enters play.  All capacity checks happen before
   * either zone is changed, so a rejected cross-owner swap cannot half-resolve.
   */
  private swapBoardMinionWithHandCard(
    source: EntityRef,
    target: EntityRef,
    frame: EffectFrame,
    path: string
  ): boolean {
    if (source.kind !== 'minion' || target.kind !== 'card') return false
    const boardPlayer = this.player(source.participantId)
    const handPlayer = this.player(target.participantId)
    const boardIndex = boardPlayer.board.findIndex(
      (minion) => minion.instanceId === source.instanceId
    )
    const handIndex = handPlayer.hand.findIndex(
      (card) => card.instanceId === target.instanceId
    )
    const minion = boardIndex < 0 ? undefined : boardPlayer.board[boardIndex]
    const card = handIndex < 0 ? undefined : handPlayer.hand[handIndex]
    const definition = card ? cardDefinition(card.cardId) : undefined
    if (!minion || !card || !definition || definition.type !== 'Minion') return false

    const ownerId = minion.ownerId ?? boardPlayer.participantId
    const owner = this.player(ownerId)
    if (
      owner.participantId !== handPlayer.participantId &&
      owner.hand.length >= MAX_HAND_SIZE
    )
      return false

    const returned: DraftCard = {
      instanceId: minion.instanceId,
      cardId: minion.cardId,
      ownerId,
      controllerId: ownerId,
      creationOrdinal: minion.creationOrdinal,
      baseCost: cardDefinition(minion.cardId)?.cost ?? 0,
      currentCost: cardDefinition(minion.cardId)?.cost ?? 0,
      zone: 'hand',
      revealed: true
    }
    const incoming: DraftMinion = {
      instanceId: card.instanceId,
      cardId: card.cardId,
      attack: card.attack ?? definition.attack,
      health: card.health ?? definition.health,
      maxHealth: definition.health,
      summonedOnTurn: this.draft.turnNumber,
      lastAttackedOnTurn: null,
      ownerId: card.ownerId ?? handPlayer.participantId,
      controllerId: boardPlayer.participantId,
      creationOrdinal: card.creationOrdinal ?? this.nextEntityOrdinal++,
      baseAttack: definition.attack,
      baseHealth: definition.health,
      keywords: [...definition.keywords],
      enchantments: copyPlainArray(
        (card.enchantments ?? []).filter((enchantment) => !enchantment.continuous)
      ),
      grantedTriggers: [],
      deathrattles: [],
      silenced: false,
      frozenUntilTurn: null,
      divineShield: definition.keywords.includes('divine-shield'),
      divineShieldConsumed: false,
      stealth: definition.keywords.includes('stealth'),
      stealthRevealed: false,
      immune: definition.keywords.includes('immune'),
      spellImmune: definition.keywords.includes('spell-immune'),
      attacksUsedThisTurn: 0,
      maxAttacksPerTurn: definition.keywords.includes('mega-windfury')
        ? 4
        : definition.keywords.includes('windfury')
          ? 2
          : 1,
      damageTaken: Math.max(0, definition.health - (card.health ?? definition.health))
    }

    this.replaceBoard(
      boardPlayer,
      boardPlayer.board.map((entry, index) => (index === boardIndex ? incoming : entry))
    )
    if (owner.participantId === handPlayer.participantId) {
      this.applyCardZones(owner, {
        ...owner,
        hand: owner.hand.map((entry, index) => (index === handIndex ? returned : entry))
      } as DraftPlayer)
    } else {
      this.applyCardZones(handPlayer, {
        ...handPlayer,
        hand: handPlayer.hand.filter((_, index) => index !== handIndex)
      } as DraftPlayer)
      this.applyCardZones(owner, {
        ...owner,
        hand: [...owner.hand, returned]
      } as DraftPlayer)
    }
    this.emit(frame, 'swap', path, {
      source: source.instanceId,
      target: target.instanceId,
      movement: 'board-hand',
      boardParticipantId: boardPlayer.participantId,
      handParticipantId: owner.participantId,
      position: boardIndex
    })
    return true
  }

  private resurrect(
    ref: EntityRef,
    frame: EffectFrame,
    path: string,
    healthValue?: unknown
  ): EntityRef | null {
    const entryPlayer = this.player(ref.participantId)
    let index = (entryPlayer.graveyard ?? []).findIndex(
      (entry) => entry.minion.instanceId === ref.instanceId
    )
    // An action sequence such as Reincarnate destroys and immediately
    // resurrects its target. Commit that death boundary before looking up the
    // snapshot: otherwise the dead minion still consumes a board slot and has
    // not yet entered resurrection history.
    const current = this.currentMinion(ref)
    if (index < 0 && current && current.health <= 0) {
      this.processDeaths()
      index = (entryPlayer.graveyard ?? []).findIndex(
        (entry) => entry.minion.instanceId === ref.instanceId
      )
    }
    const entry = index >= 0 ? entryPlayer.graveyard?.[index] : undefined
    const snapshot = entry?.minion ?? this.currentMinion(ref)
    if (!snapshot) return null
    const definition = cardDefinition(snapshot.cardId)
    if (!definition || definition.type !== 'Minion') return null
    const controllerId =
      entry?.controllerId ?? snapshot.controllerId ?? ref.participantId
    const health =
      healthValue === 'full' || healthValue === undefined
        ? definition.health
        : this.evaluate(healthValue, frame)
    const summoned = this.createMinion(
      controllerId,
      snapshot.cardId,
      frame,
      path,
      undefined,
      undefined,
      {
        ...snapshot,
        health,
        maxHealth: definition.health,
        attack: definition.attack,
        baseAttack: definition.attack,
        baseHealth: definition.health,
        keywords: [...definition.keywords],
        enchantments: [],
        grantedTriggers: [],
        deathrattles: [],
        silenced: false,
        frozenUntilTurn: null,
        divineShield: definition.keywords.includes('divine-shield'),
        divineShieldConsumed: false,
        stealth: definition.keywords.includes('stealth'),
        stealthRevealed: false,
        immune: definition.keywords.includes('immune'),
        spellImmune: definition.keywords.includes('spell-immune')
      } as DraftMinion
    )
    if (summoned && index >= 0) this.removeGraveyardAt(entryPlayer, index)
    return summoned
  }

  private runAction(actionValue: unknown, frame: EffectFrame, path: string): void {
    if (!isRecord(actionValue) || typeof actionValue.action !== 'string') return
    const action = actionValue
    const name = action.action as string
    switch (name) {
      case 'add-to-hand': {
        const players = this.targetPlayers(action, frame)
        const count =
          action.count === undefined
            ? 1
            : Math.max(0, Math.floor(this.evaluate(action.count, frame)))
        for (const participantId of players) {
          const sources =
            action.source === undefined
              ? []
              : this.sourceEntitiesForParticipant(action, frame, participantId)
          for (let index = 0; index < count; index += 1) {
            const selected = sources[index % Math.max(1, sources.length)]
            const cardId = this.actionCardId(action) ?? selected?.cardId
            if (cardId)
              this.addCardToHand(
                participantId,
                cardId,
                frame,
                `${path}.${participantId}`
              )
          }
        }
        return
      }
      case 'joust': {
        const minionInDeck = (participantId: PlayerId): DraftCard | null => {
          const candidates = this.player(participantId).deck.filter((card) =>
            cardDefinition(card.cardId)?.type === 'Minion'
          )
          if (candidates.length === 0) return null
          return candidates[Math.floor(this.rng.next() * candidates.length)] ?? null
        }
        const opponentId = this.otherPlayer(frame.controllerId)
        const own = minionInDeck(frame.controllerId)
        const opponent = minionInDeck(opponentId)
        const ownCost = own ? (cardDefinition(own.cardId)?.cost ?? 0) : null
        const opponentCost = opponent
          ? (cardDefinition(opponent.cardId)?.cost ?? 0)
          : null
        const won = ownCost !== null && opponentCost !== null && ownCost > opponentCost
        this.emit(frame, name, path, {
          ownCardId: own?.cardId ?? null,
          opponentCardId: opponent?.cardId ?? null,
          ownCost,
          opponentCost,
          won
        })
        if (won && action.drawWonCard === true && own)
          this.drawOne(
            frame.controllerId,
            frame,
            `${path}.won-card`,
            {
              instanceId: own.instanceId,
              kind: 'card',
              participantId: frame.controllerId,
              zone: 'deck',
              cardId: own.cardId
            }
          )
        if (won && action.returnSourceFromGraveyard === true && frame.source.cardId) {
          const owner = this.player(frame.controllerId)
          const index = (owner.graveyard ?? []).findIndex(
            (entry) => entry.minion.instanceId === frame.source.instanceId
          )
          if (index >= 0) {
            this.removeGraveyardAt(owner, index)
            this.addCardToHand(
              frame.controllerId,
              frame.source.cardId,
              frame,
              `${path}.return-source`
            )
          }
        }
        if (won && Array.isArray(action.winActions))
          this.runActions(action.winActions, frame, `${path}.winActions`)
        return
      }
      case 'change-cost': {
        if (action.deferUntil === 'next-matching-card-played') {
          const target = isRecord(action.target) ? action.target : null
          const filter = target && isRecord(target.filter) ? target.filter : {}
          const participantId =
            this.relativeController(target?.controller, frame) ?? frame.controllerId
          const amount = this.evaluate(action.amount, frame)
          const player = this.player(participantId)
          player.pendingCostModifiers = [
            ...(player.pendingCostModifiers ?? []),
            {
              id: this.allocateId(`${frame.source.instanceId}:pending-cost`),
              sourceInstanceId: frame.source.instanceId,
              amount,
              filter
            }
          ]
          this.emit(frame, name, path, {
            participantId,
            amount,
            deferUntil: action.deferUntil
          })
          return
        }
        const targets = this.actionTargets(action, frame)
        const minimum = typeof action.minimum === 'number' ? action.minimum : 0
        for (const target of targets) {
          const evaluated = this.withTarget(frame, target, () =>
            this.evaluate(action.amount, frame)
          )
          const amount =
            isRecord(action.amount) && action.amount.operation === 'set'
              ? evaluated - this.readCost(target)
              : Math.max(minimum - this.readCost(target), evaluated)
          this.changeCost(target, amount, action, frame, path)
          frame.lastActionTarget = target
        }
        return
      }
      case 'copy': {
        const targets = this.actionTargets(action, frame)
        const destination = action.destination
        if (destination === 'cast-on-source') {
          for (const target of targets) {
            if (target.kind !== 'card' || !target.cardId) continue
            const definition = cardDefinition(target.cardId)
            if (!definition || definition.type !== 'Spell') continue
            const copiedSource: EntityRef = {
              ...target,
              participantId: frame.controllerId,
              zone: 'revealed'
            }
            const targetEvent = this.emitSemantic({
              type: 'spell-targeted-minion',
              source: copiedSource,
              target: frame.source,
              controllerId: frame.controllerId,
              targetControllerId: frame.source.participantId,
              cardId: target.cardId,
              cardInstanceId: target.instanceId,
              kind: 'play'
            })
            const copiedTarget = targetEvent.redirectTarget ?? frame.source
            const castEvent = this.emitSemantic({
              type: 'spell-cast',
              source: copiedSource,
              target: copiedTarget,
              controllerId: frame.controllerId,
              targetControllerId: copiedTarget.participantId,
              cardId: target.cardId,
              cardInstanceId: target.instanceId,
              card: frame.event?.card,
              kind: 'cast'
            })
            if (!castEvent.cancelled)
              this.runCardBlocks(
                definition,
                'cast',
                this.frameFor(copiedSource, null, [copiedTarget]),
                `${path}.cast-copy`
              )
          }
          return
        }
        const count =
          action.count === undefined
            ? 1
            : Math.max(0, Math.floor(this.evaluate(action.count, frame)))
        for (const target of targets) {
          for (let index = 0; index < count; index += 1) {
            if (target.kind === 'minion' && isRecord(destination)) {
              const destinationTarget = this.select(destination, frame)[0]
              if (destinationTarget?.kind === 'minion')
                this.transformMinionIntoCopy(destinationTarget, target, frame, path)
            } else if (target.cardId) {
              let destinationPlayer = frame.controllerId
              if (isRecord(destination)) {
                const destinationTargets = this.select(destination, frame)
                destinationPlayer =
                  destinationTargets[0]?.participantId ??
                  (destination.selection === 'other-player-hand'
                    ? this.otherPlayer(frame.controllerId)
                    : (this.relativeController(destination.controller, frame) ??
                      frame.controllerId))
              }
              this.addCardToHand(destinationPlayer, target.cardId, frame, path)
            }
          }
        }
        return
      }
      case 'counter-event':
        if (frame.event) frame.event.cancelled = true
        this.emit(frame, name, path, { eventType: frame.event?.type ?? null })
        return
      case 'damage': {
        const baseHits =
          action.hits === undefined
            ? 1
            : Math.max(1, Math.floor(this.evaluate(action.hits, frame)))
        const randomTarget =
          isRecord(action.target) && action.target.selection === 'random'
        const targets = randomTarget ? [] : this.actionTargets(action, frame)
        const randomSplitSpell =
          this.sourceIsSpell(frame) && randomTarget && action.amount === 1
        const hits = randomSplitSpell
          ? Math.max(
              1,
              Math.floor(
                (baseHits + this.spellDamageBonus(frame.controllerId)) *
                  this.effectMultiplier(frame.controllerId, 'spellDamageMultiplier')
              )
            )
          : baseHits
        const tracksMortallyWoundedRandomTargets =
          randomTarget && (action.hits !== undefined || randomSplitSpell)
        const previousRandomDamageExcluded = frame.randomDamageExcluded
        if (tracksMortallyWoundedRandomTargets) frame.randomDamageExcluded = new Set()
        try {
          for (let hit = 0; hit < hits; hit += 1) {
            const selectedTargets = randomTarget
              ? this.actionTargets(action, frame)
              : targets
            for (const target of selectedTargets) {
              this.withTarget(frame, target, () => {
                const minimum =
                  typeof action.minimum === 'number' ? Math.floor(action.minimum) : null
                const maximum =
                  typeof action.maximum === 'number' ? Math.floor(action.maximum) : null
                const amount =
                  minimum !== null && maximum !== null && maximum >= minimum
                    ? minimum + Math.floor(this.rng.next() * (maximum - minimum + 1))
                    : this.evaluate(action.amount, frame)
                this.applyDamage(target, amount, frame, path + '.hit' + hit, {
                  skipSpellScaling: randomSplitSpell,
                  ...(typeof action.spellDamageBonusMultiplier === 'number'
                    ? { spellDamageBonusMultiplier: action.spellDamageBonusMultiplier }
                    : {})
                })
              })
              const minion =
                target.kind === 'minion' ? this.currentMinion(target) : null
              if (tracksMortallyWoundedRandomTargets && minion && minion.health <= 0)
                frame.randomDamageExcluded.add(entityKey(target))
              frame.lastActionTarget = target
            }
          }
        } finally {
          if (tracksMortallyWoundedRandomTargets)
            frame.randomDamageExcluded = previousRandomDamageExcluded
        }
        return
      }
      case 'destroy':
        for (const target of this.actionTargets(action, frame)) {
          this.withTarget(frame, target, () => this.directDestroy(target, frame, path))
          frame.lastActionTarget = target
        }
        return
      case 'destroy-all-but-highest-attack':
        for (const player of this.draft.players) {
          const highest = Math.max(
            ...player.board.map((minion) => minion.attack),
            Number.NEGATIVE_INFINITY
          )
          const contenders = player.board.filter(
            (minion) => minion.attack === highest
          )
          const survivor =
            contenders[Math.floor(this.rng.next() * contenders.length)] ?? null
          for (const minion of [...player.board]) {
            if (minion.instanceId === survivor?.instanceId) continue
            this.directDestroy(
              {
                instanceId: minion.instanceId,
                kind: 'minion',
                participantId: player.participantId,
                zone: 'board',
                cardId: minion.cardId
              },
              frame,
              path
            )
          }
        }
        return
      case 'destroy-and-gain-stats': {
        const targets = this.actionTargets(action, frame)
        const destination = isRecord(action.destination)
          ? this.select(action.destination, frame)
          : [frame.source]
        for (const target of targets) {
          const attack = this.readAttack(target)
          const health = this.readMaximumHealth(target)
          this.directDestroy(target, frame, path)
          for (const targetDestination of destination) {
            this.modifyEntity(
              targetDestination,
              { action: 'modify', attack, health },
              frame,
              path + '.destination'
            )
          }
        }
        return
      }
      case 'destroy-mana-crystal': {
        for (const participantId of this.targetPlayers(action, frame)) {
          const player = this.player(participantId)
          const amount = Math.max(0, Math.floor(this.evaluate(action.amount, frame)))
          player.mana.maximum = Math.max(0, player.mana.maximum - amount)
          player.mana.available = Math.min(player.mana.available, player.mana.maximum)
          this.emit(frame, name, path, { participantId, amount })
        }
        return
      }
      case 'destroy-secrets':
        for (const participantId of this.targetPlayers(action, frame)) {
          const player = this.player(participantId)
          const count = (player.secrets ?? []).length
          this.replaceSecrets(player, [])
          this.emit(frame, name, path, { participantId, count })
        }
        return
      case 'discard': {
        const targets =
          action.target !== undefined
            ? this.actionTargets(action, frame)
            : this.sourceEntities(action, frame)
        for (const target of targets) {
          const card = this.removeCard(target)
          if (card) {
            this.addToDiscardedCards(this.player(target.participantId), card)
            const discarded: EntityRef = {
              instanceId: card.instanceId,
              kind: 'card',
              participantId: target.participantId,
              zone: 'discarded',
              cardId: card.cardId
            }
            this.emit(frame, name, path, {
              target: card.instanceId,
              cardId: card.cardId
            })
            this.emitSemantic({
              type: 'card-discarded',
              source: frame.source,
              target: discarded,
              controllerId: target.participantId,
              targetControllerId: target.participantId,
              cardId: card.cardId,
              cardInstanceId: card.instanceId,
              kind: 'discard'
            })
          }
        }
        return
      }
      case 'discover': {
        const count = Math.max(0, Math.floor(this.evaluate(action.count, frame)))
        for (const participantId of this.targetPlayers(action, frame)) {
          const fromDeck =
            action.source === 'deck' ||
            action.source === 'deck-top' ||
            (isRecord(action.source) && action.source.zone === 'deck')
          let candidates: DraftCard[] = []
          if (fromDeck) {
            candidates = this.revealDeckTop(
              participantId,
              count,
              frame,
              `${path}.reveal`
            )
              .map((ref) => this.currentCard(ref))
              .filter((card): card is DraftCard => card !== null)
              .map((card) => clonePlain(card) as DraftCard)
          } else {
            const player = this.player(participantId)
            const discoverFrame = { ...frame, controllerId: participantId }
            const selfClass = HERO_CATALOG.get(player.heroId)?.classId
            const authoredPool = Array.isArray(action.pool)
              ? action.pool
                  .filter((entry): entry is string => typeof entry === 'string')
                  .map((cardId) => CARD_CATALOG.get(cardId))
                  .filter((definition): definition is CardDefinition =>
                    Boolean(definition)
                  )
              : CARD_CATALOG.all.filter((definition) => definition.collectible)
            const pool = authoredPool.filter((definition) => {
              const candidate: EntityRef = {
                instanceId: `${participantId}:discover-pool:${definition.id}`,
                kind: 'card',
                participantId,
                zone: 'revealed',
                cardId: definition.id
              }
              return this.matchesFilter(candidate, action.filter, discoverFrame)
            })
            const weighted = [...pool]
            const selected: CardDefinition[] = []
            const classBonus = Math.max(
              1,
              Math.floor(typeof action.classBonus === 'number' ? action.classBonus : 1)
            )
            while (selected.length < count && weighted.length > 0) {
              const totalWeight = weighted.reduce(
                (sum, definition) =>
                  sum + (definition.cardClass === selfClass ? classBonus : 1),
                0
              )
              let roll = this.rng.next() * totalWeight
              let selectedIndex = 0
              for (let index = 0; index < weighted.length; index += 1) {
                const definition = weighted[index]!
                roll -= definition.cardClass === selfClass ? classBonus : 1
                if (roll < 0) {
                  selectedIndex = index
                  break
                }
              }
              selected.push(...weighted.splice(selectedIndex, 1))
            }
            for (const definition of selected) {
              const generated: DraftCard = {
                instanceId: this.allocateId(`${participantId}:discover`),
                cardId: definition.id,
                ownerId: participantId,
                controllerId: participantId,
                creationOrdinal: this.nextEntityOrdinal++,
                baseCost: definition.cost,
                currentCost: definition.cost,
                zone: 'revealed',
                revealed: true,
                knownTo: [participantId]
              }
              const updated = insertCardIntoPlayer(
                player as unknown as OpeningPlayerState,
                generated,
                'revealed'
              ) as DraftPlayer
              this.applyCardZones(player, updated)
              candidates.push(clonePlain(generated) as DraftCard)
            }
          }
          if (candidates.length === 0) continue
          const pending = {
            participantId,
            sourceCardInstanceId: frame.source.instanceId,
            candidates,
            origin: fromDeck ? ('deck' as const) : ('generated' as const)
          }
          const queued = Boolean(this.draft.pendingDiscover)
          if (this.draft.pendingDiscover) {
            this.draft.pendingDiscover.queued = [
              ...(this.draft.pendingDiscover.queued ?? []),
              pending
            ]
          } else this.draft.pendingDiscover = pending
          if (!queued)
            this.events.push({
              type: 'discover-started',
              participantId,
              sourceCardInstanceId: frame.source.instanceId,
              candidates: clonePlain(candidates) as unknown as OpeningCard[]
            })
          this.emit(frame, name, path, {
            participantId,
            cardIds: candidates.map((card) => card.cardId),
            instanceIds: candidates.map((card) => card.instanceId)
          })
        }
        return
      }
      case 'draw': {
        if (typeof action.chance === 'number' && this.rng.next() >= action.chance)
          return
        const count =
          action.count === undefined
            ? 1
            : Math.max(0, Math.floor(this.evaluate(action.count, frame)))
        for (const participantId of this.targetPlayers(action, frame)) {
          let selected: EntityRef[] = []
          if (action.source !== undefined) {
            selected = this.sourceEntitiesForParticipant(action, frame, participantId)
            const source = isRecord(action.source) ? action.source : null
            if (source?.position === 'top' && source.zone === 'deck') {
              const revealCount =
                typeof source.count === 'number'
                  ? Math.max(0, Math.floor(source.count))
                  : selected.length
              this.revealDeckTop(participantId, revealCount, frame, path + '.reveal')
              selected = selected
                .map((candidate) =>
                  this.findEntity(candidate.instanceId, participantId)
                )
                .filter((candidate): candidate is EntityRef => candidate !== null)
            }
          }
          const draws =
            action.source === undefined
              ? Array.from({ length: count }, () => undefined)
              : selected.slice(0, count)
          for (let index = 0; index < draws.length; index += 1) {
            const drawn = this.drawOne(
              participantId,
              frame,
              path + '.' + index,
              draws[index]
            )
            if (!drawn) continue
            if (
              isRecord(action.modifyDrawnCard) &&
              typeof action.modifyDrawnCard.cost === 'number'
            )
              this.changeCost(
                drawn,
                action.modifyDrawnCard.cost,
                { duration: 'permanent' },
                frame,
                path + '.' + index + '.modify'
              )
            else if (
              isRecord(action.modifyDrawnCard) &&
              typeof action.modifyDrawnCard.setCost === 'number'
            )
              this.changeCost(
                drawn,
                0,
                {
                  amount: {
                    operation: 'set',
                    value: action.modifyDrawnCard.setCost
                  }
                },
                frame,
                path + '.' + index + '.set-cost'
              )
            if (action.reveal === true) {
              const card = this.currentCard(drawn)
              if (card) card.revealed = true
            }
          }
        }
        return
      }
      case 'draw-until': {
        const handSize = Math.max(0, Math.floor(this.evaluate(action.handSize, frame)))
        for (const participantId of this.targetPlayers(action, frame)) {
          const drawCount = Math.max(
            0,
            handSize - this.player(participantId).hand.length
          )
          for (let index = 0; index < drawCount; index += 1)
            this.drawOne(participantId, frame, path)
        }
        return
      }
      case 'equip': {
        const cardId = this.actionCardId(action)
        if (cardId) this.equip(frame.controllerId, cardId, frame, path)
        return
      }
      case 'equip-random': {
        const pool = CARD_CATALOG.all.filter(
          (card) =>
            card.type === 'Weapon' &&
            this.matchesFilter(
              {
                instanceId: frame.controllerId + ':pool:' + card.id,
                kind: 'card',
                participantId: frame.controllerId,
                zone: 'revealed',
                cardId: card.id
              },
              action.filter,
              frame
            )
        )
        if (pool.length === 0) return
        for (const participantId of this.targetPlayers(action, frame)) {
          const selected = pool[Math.floor(this.rng.next() * pool.length)]
          if (selected) this.equip(participantId, selected.id, frame, path)
        }
        return
      }
      case 'freeze':
        for (const target of this.actionTargets(action, frame)) {
          if (target.kind === 'minion')
            this.updateMinion(target, (minion) => {
              minion.frozenUntilTurn = this.draft.turnNumber + 1
            })
          if (target.kind === 'hero')
            this.player(target.participantId).hero.frozenUntilTurn =
              this.draft.turnNumber + 1
          this.emit(frame, name, path, { target: target.instanceId })
        }
        return
      case 'gain-armor':
        for (const target of this.actionTargets(action, frame)) {
          if (target.kind !== 'hero') continue
          this.withTarget(frame, target, () => {
            const hero = this.player(target.participantId).hero
            const amount = Math.max(0, Math.floor(this.evaluate(action.amount, frame)))
            hero.armor += amount
            this.historyUpdate((history) => {
              history.armorGainedThisTurn += amount
            })
            this.emit(frame, name, path, {
              target: target.instanceId,
              amount,
              armor: hero.armor
            })
            this.emitSemantic({
              type: 'hero-damaged',
              source: frame.source,
              target,
              controllerId: frame.controllerId,
              targetControllerId: target.participantId,
              amount,
              kind: 'armor'
            })
          })
          frame.lastActionTarget = target
        }
        return
      case 'gain-mana':
        for (const participantId of this.targetPlayers(action, frame)) {
          const player = this.player(participantId)
          const amount = Math.max(0, Math.floor(this.evaluate(action.amount, frame)))
          const duration = stringValue(action.duration)
          if (action.crystal === 'empty') {
            player.mana.maximum = Math.min(MAX_MANA, player.mana.maximum + amount)
          } else if (action.crystal === 'full') {
            const gained = Math.min(MAX_MANA - player.mana.maximum, amount)
            player.mana.maximum += gained
            player.mana.available = Math.min(MAX_MANA, player.mana.available + gained)
          } else if (duration === 'this-turn') {
            player.mana.temporary = (player.mana.temporary ?? 0) + amount
            player.mana.available = Math.min(
              MAX_MANA + (player.mana.temporary ?? 0),
              player.mana.available + amount
            )
          } else {
            player.mana.available = Math.min(
              player.mana.maximum,
              player.mana.available + amount
            )
          }
          this.emit(frame, name, path, {
            participantId,
            amount,
            mana: { ...player.mana }
          })
        }
        return
      case 'grant-deathrattle':
        for (const target of this.actionTargets(action, frame)) {
          if (target.kind !== 'minion') continue
          const minion = this.currentMinion(target)
          if (!minion) continue
          const copied =
            action.source === undefined
              ? []
              : this.sourceEntities(action, frame).flatMap((source) => {
                  if (source.kind !== 'minion') return []
                  const sourceMinion = this.currentMinion(source)
                  const authored = (
                    source.cardId ? (cardDefinition(source.cardId)?.effects ?? []) : []
                  ).filter((block) => block.trigger === 'deathrattle')
                  const authoredKeys = new Set(
                    authored.map((block) => JSON.stringify(block))
                  )
                  const runtime = (sourceMinion?.deathrattles ?? []).filter(
                    (block) => !authoredKeys.has(JSON.stringify(block))
                  )
                  return [...authored, ...runtime]
                })
          const grantedBlocks: readonly CardEffectBlock[] =
            copied.length > 0
              ? copied
              : [
                  {
                    trigger: 'deathrattle',
                    actions: asArray(action.actions) as unknown as readonly CardAction[]
                  }
                ]
          minion.deathrattles = [
            ...(minion.deathrattles ?? []),
            ...grantedBlocks
          ] as unknown as DraftMinion['deathrattles']
          this.emit(frame, name, path, {
            target: target.instanceId,
            copiedBlocks: grantedBlocks.length
          })
        }
        return
      case 'trigger-deathrattle': {
        const targets =
          action.target === undefined
            ? [frame.source]
            : this.actionTargets(action, frame)
        for (const target of targets) {
          const blocks = this.actionBlocksFor(target, 'deathrattle')
          const deathEvent: SemanticEvent = {
            sequence: this.semanticSequence++,
            type: target.kind === 'weapon' ? 'weapon-died' : 'minion-died',
            source: target,
            target,
            controllerId: target.participantId,
            targetControllerId: target.participantId
          }
          const triggerFrame = {
            ...this.frameFor(target, deathEvent, frame.chosenTargets),
            choiceIndex: frame.choiceIndex
          }
          for (const block of blocks)
            this.runBlock(block, triggerFrame, path + '.deathrattle', true)
        }
        return
      }
      case 'lock-and-load': {
        const player = this.player(frame.controllerId)
        const existing =
          player.lockAndLoadTurn === this.draft.turnNumber
            ? (player.lockAndLoadCount ?? 0)
            : 0
        player.lockAndLoadTurn = this.draft.turnNumber
        player.lockAndLoadCount = existing + 1
        this.emit(frame, name, path, { count: player.lockAndLoadCount })
        return
      }
      case 'grant-keyword': {
        const keyword = stringValue(action.keyword) as CardKeyword | null
        if (!keyword || !CARD_KEYWORDS.includes(keyword)) return
        const duration = stringValue(action.duration) ?? 'permanent'
        const amount = Math.max(
          1,
          Math.floor(
            typeof action.amount === 'number'
              ? action.amount
              : this.evaluate(action.amount ?? 1, frame)
          )
        )
        for (const target of this.actionTargets(action, frame)) {
          this.setKeyword(target, keyword, true, frame, path, duration, amount)
          this.emit(frame, name, path, {
            target: target.instanceId,
            keyword,
            duration
          })
        }
        return
      }
      case 'grant-keywords': {
        const keywords = asArray(action.keywords).filter(
          (entry): entry is CardKeyword =>
            typeof entry === 'string' && CARD_KEYWORDS.includes(entry as CardKeyword)
        )
        const duration = stringValue(action.duration) ?? 'permanent'
        for (const target of this.actionTargets(action, frame)) {
          for (const keyword of keywords)
            this.setKeyword(target, keyword, true, frame, path, duration)
          this.emit(frame, name, path, {
            target: target.instanceId,
            keywords,
            duration
          })
        }
        return
      }
      case 'grant-random-keyword': {
        const keywords = asArray(action.keywords).filter(
          (entry): entry is CardKeyword =>
            typeof entry === 'string' && CARD_KEYWORDS.includes(entry as CardKeyword)
        )
        if (keywords.length === 0) return
        const duration = stringValue(action.duration) ?? 'permanent'
        for (const target of this.actionTargets(action, frame)) {
          const keyword = keywords[Math.floor(this.rng.next() * keywords.length)]
          if (!keyword) continue
          this.setKeyword(target, keyword, true, frame, path, duration)
          this.emit(frame, name, path, {
            target: target.instanceId,
            keyword,
            duration
          })
        }
        return
      }
      case 'grant-targeting': {
        const targetType = stringValue(action.targetType)
        if (!targetType) return
        for (const target of this.actionTargets(action, frame)) {
          if (target.kind !== 'hero-power') continue
          const duration = stringValue(action.duration) ?? 'permanent'
          const enchantment: RuntimeEnchantment = {
            id: frame.continuous
              ? frame.source.instanceId +
                ':continuous-targeting:' +
                target.instanceId +
                ':' +
                path
              : this.allocateId(frame.source.instanceId + ':targeting'),
            sourceInstanceId: frame.source.instanceId,
            sourceCardId: frame.sourceCardId,
            targetingGranted: targetType,
            duration,
            ...(duration === 'this-turn'
              ? { expiresOnTurn: this.draft.turnNumber }
              : {}),
            ...(duration === 'next-turn'
              ? {
                  startsOnTurn: this.draft.turnNumber + 1,
                  expiresOnTurn: this.draft.turnNumber + 1
                }
              : {}),
            ...(duration === 'until-next-turn'
              ? { expiresOnTurn: this.draft.turnNumber + 1 }
              : {}),
            ...(frame.continuous ? { continuous: true } : {})
          }
          this.addEnchantment(target, enchantment)
          this.player(target.participantId).heroPower.targetingGranted = targetType
          this.emit(frame, name, path, {
            target: target.instanceId,
            targetType
          })
        }
        return
      }
      case 'grant-trigger': {
        const trigger = stringValue(action.trigger) as CardTrigger | null
        if (!trigger || !CARD_TRIGGERS.includes(trigger)) return
        const duration = stringValue(action.duration) ?? 'permanent'
        const actions = asArray(action.actions).filter(isRecord) as Record<
          string,
          unknown
        >[]
        for (const target of this.actionTargets(action, frame)) {
          if (target.kind !== 'minion') continue
          const granted: RuntimeGrantedTrigger = {
            id: this.allocateId(frame.source.instanceId + ':trigger'),
            trigger,
            actions,
            sourceInstanceId: frame.source.instanceId,
            duration,
            ...(duration === 'this-turn'
              ? { expiresOnTurn: this.draft.turnNumber }
              : {}),
            ...(duration === 'next-turn'
              ? {
                  startsOnTurn: this.draft.turnNumber + 1,
                  expiresOnTurn: this.draft.turnNumber + 1
                }
              : {}),
            ...(duration === 'until-next-turn'
              ? { expiresOnTurn: this.draft.turnNumber + 1 }
              : {})
          }
          const minion = this.currentMinion(target)
          if (minion)
            minion.grantedTriggers = [
              ...(minion.grantedTriggers ?? []),
              granted
            ] as unknown as DraftMinion['grantedTriggers']
          this.emit(frame, name, path, { target: target.instanceId, trigger })
        }
        return
      }
      case 'modify':
        for (const target of this.actionTargets(action, frame)) {
          this.withTarget(frame, target, () =>
            this.modifyEntity(target, action, frame, path)
          )
          frame.lastActionTarget = target
        }
        return
      case 'modify-hero-power-uses':
        // This is a declarative aura read by heroPowerUseLimit().
        return
      case 'modify-hero-power-damage':
        // This is a declarative aura read by heroPowerDamageBonus().
        return
      case 'modify-weapon-on-hero-power':
        // This is a declarative aura read by heroPowerEquipAttackBonus().
        return
      case 'redirect-hero-damage':
        // This is a declarative aura read by heroDamageRedirect().
        return
      case 'set-hero-power-drawn-card-cost':
        // This is a declarative aura read by heroPowerDrawCost().
        return
      case 'multiply-trigger': {
        const trigger = stringValue(action.trigger) as CardTrigger | null
        if (!trigger || !CARD_TRIGGERS.includes(trigger)) return
        const multiplier = Math.max(
          1,
          Math.floor(this.evaluate(action.multiplier, frame))
        )
        const duration = stringValue(action.duration) ?? 'permanent'
        for (const target of this.actionTargets(action, frame)) {
          if (target.kind !== 'minion') continue
          const minion = this.currentMinion(target)
          if (!minion) continue
          const enchantment: RuntimeEnchantment = {
            id: frame.continuous
              ? frame.source.instanceId +
                ':continuous-trigger:' +
                target.instanceId +
                ':' +
                path
              : this.allocateId(frame.source.instanceId + ':trigger-multiplier'),
            sourceInstanceId: frame.source.instanceId,
            sourceCardId: frame.sourceCardId,
            triggerMultipliers: { [trigger]: multiplier },
            duration,
            ...(duration === 'this-turn'
              ? { expiresOnTurn: this.draft.turnNumber }
              : {}),
            ...(duration === 'next-turn'
              ? {
                  startsOnTurn: this.draft.turnNumber + 1,
                  expiresOnTurn: this.draft.turnNumber + 1
                }
              : {}),
            ...(duration === 'until-next-turn'
              ? { expiresOnTurn: this.draft.turnNumber + 1 }
              : {}),
            ...(frame.continuous ? { continuous: true } : {})
          }
          this.addEnchantment(target, enchantment)
          minion.triggerMultipliers = {
            ...(minion.triggerMultipliers ?? {}),
            [trigger]: multiplier
          }
          this.emit(frame, name, path, {
            target: target.instanceId,
            trigger,
            multiplier
          })
        }
        return
      }
      case 'overload': {
        const amount = Math.max(0, Math.floor(this.evaluate(action.amount, frame)))
        for (const participantId of this.targetPlayers(action, frame)) {
          const player = this.player(participantId)
          const previous = player.mana.overloadNextTurn ?? 0
          const nextOverload = Math.min(MAX_MANA, previous + amount)
          const appliedAmount = nextOverload - previous
          player.mana.overloadNextTurn = nextOverload
          player.overload = nextOverload
          this.emit(frame, name, path, {
            participantId,
            amount: appliedAmount,
            overloadNextTurn: nextOverload
          })
          this.emitSemantic({
            type: 'overload-applied',
            source: frame.source,
            target: {
              instanceId: `${participantId}:hero`,
              kind: 'hero',
              participantId,
              zone: 'hero'
            },
            controllerId: participantId,
            targetControllerId: participantId,
            amount: appliedAmount
          })
        }
        return
      }
      case 'unlock-overload': {
        for (const participantId of this.targetPlayers(action, frame)) {
          const player = this.player(participantId)
          const locked = player.mana.overloadLocked ?? 0
          player.mana = {
            ...player.mana,
            available: Math.min(player.mana.maximum, player.mana.available + locked),
            overloadLocked: 0
          }
          player.overload = 0
          this.emit(frame, name, path, { participantId, amount: locked })
        }
        return
      }
      case 'prevent-lethal':
        if (frame.event) frame.event.prevented = true
        for (const target of this.actionTargets(action, frame))
          this.emit(frame, name, path, { target: target.instanceId })
        return
      case 'put-into-play': {
        const participants = this.targetPlayers(action, frame)
        for (const participantId of participants) {
          const sources = this.sourceEntitiesForParticipant(
            action,
            frame,
            participantId
          )
          for (const source of sources) {
            const definition = source.cardId ? cardDefinition(source.cardId) : undefined
            if (!definition) continue
            const targetPlayer = this.player(participantId)
            if (
              definition.type === 'Minion' &&
              targetPlayer.board.length >= MAX_BOARD_SIZE
            )
              break
            if (
              definition.type === 'Spell' &&
              definition.keywords.includes('secret') &&
              ((targetPlayer.secrets ?? []).length >= 5 ||
                (targetPlayer.secrets ?? []).some(
                  (secret) => secret.cardId === definition.id
                ))
            )
              continue
            const card = this.removeCard(source)
            if (!card) continue
            if (definition.type === 'Minion') {
              this.createMinion(
                participantId,
                card.cardId,
                frame,
                path,
                card.instanceId,
                undefined,
                undefined,
                card
              )
            } else if (
              definition.type === 'Spell' &&
              definition.keywords.includes('secret')
            ) {
              const secret: SecretState = {
                instanceId: card.instanceId,
                cardId: card.cardId,
                ownerId: card.ownerId ?? participantId,
                controllerId: participantId,
                creationOrdinal: card.creationOrdinal ?? this.nextEntityOrdinal++,
                playOrder: this.nextEntityOrdinal++,
                revealed: false
              }
              this.appendSecret(targetPlayer, secret)
              const secretRef: EntityRef = {
                instanceId: secret.instanceId,
                kind: 'secret',
                participantId,
                zone: 'secret',
                cardId: secret.cardId
              }
              this.emitSemantic({
                type: 'secret-played',
                source: secretRef,
                target: secretRef,
                controllerId: participantId,
                targetControllerId: participantId,
                cardId: card.cardId,
                cardInstanceId: card.instanceId,
                card,
                kind: 'play'
              })
            }
          }
        }
        return
      }
      case 'redirect-damage': {
        const sources =
          action.source === undefined
            ? [frame.source]
            : this.sourceEntities(action, frame)
        for (const source of sources) {
          const sourceFrame = {
            ...this.frameFor(source, frame.event, frame.chosenTargets),
            choiceIndex: frame.choiceIndex
          }
          const targets =
            action.target === undefined ? [] : this.select(action.target, sourceFrame)
          for (const target of targets) {
            this.withTarget(sourceFrame, target, () => {
              const amount = this.evaluate(action.amount, sourceFrame)
              this.applyDamage(target, amount, sourceFrame, path)
            })
            frame.lastActionTarget = target
          }
        }
        return
      }
      case 'replace-hero': {
        const heroIdValue = stringValue(action.heroId)
        if (!heroIdValue) return
        const definition = HERO_CATALOG.get(heroIdValue)
        if (!definition) return
        const player = this.player(frame.controllerId)
        const previousHeroId = player.heroId
        const previousHero = player.hero
        const heroCard = frame.sourceCardId
          ? cardDefinition(frame.sourceCardId)
          : undefined
        const armorGained = heroCard?.type === 'Hero' ? heroCard.armor : 0
        player.heroId = definition.id
        player.hero = {
          ...previousHero,
          instanceId: frame.controllerId + ':hero',
          baseAttack: 0,
          baseMaxHealth:
            definition.id === 'ragnaros'
              ? definition.startingHealth
              : previousHero.maxHealth,
          maxHealth:
            definition.id === 'ragnaros'
              ? definition.startingHealth
              : previousHero.maxHealth,
          health:
            definition.id === 'ragnaros'
              ? definition.startingHealth
              : previousHero.health,
          baseKeywords: previousHero.baseKeywords ?? previousHero.keywords ?? [],
          attack: 0,
          armor: previousHero.armor + armorGained,
          lastAttackedOnTurn: null
        }
        const power = HERO_POWER_CATALOG.require(definition.heroPowerId)
        player.heroPower = {
          ...player.heroPower,
          id: definition.heroPowerId,
          cost: power.cost,
          baseCost: power.cost,
          available: player.heroPower.available,
          targetType: power.targeting,
          targetingGranted: power.targeting,
          effectOverride: undefined,
          enchantments: []
        }
        this.emit(frame, name, path, {
          participantId: frame.controllerId,
          heroId: definition.id
        })
        this.events.push({
          type: 'hero-replaced',
          participantId: frame.controllerId,
          previousHeroId,
          heroId: definition.id,
          armorGained
        })
        return
      }
      case 'remove-keyword': {
        const keyword = stringValue(action.keyword) as CardKeyword | null
        if (!keyword || !CARD_KEYWORDS.includes(keyword)) return
        const duration = stringValue(action.duration) ?? 'permanent'
        for (const target of this.actionTargets(action, frame)) {
          if (this.hasKeyword(target, keyword)) frame.removedKeywordCount += 1
          this.setKeyword(target, keyword, false, frame, path, duration)
          this.emit(frame, name, path, {
            target: target.instanceId,
            keyword,
            duration
          })
        }
        return
      }
      case 'replace-event':
        if (
          frame.event &&
          (action.event === undefined || action.event === frame.event.type)
        ) {
          const replacement = stringValue(action.replacement)
          if (replacement) frame.event.replacement = replacement
          this.emit(frame, name, path, {
            eventType: frame.event.type,
            replacement: replacement ?? null
          })
        }
        return
      case 'restore':
        for (const target of this.actionTargets(action, frame)) {
          this.withTarget(frame, target, () => {
            const amount = this.evaluate(action.amount, frame, true)
            this.applyRestore(target, amount, frame, path)
          })
          frame.lastActionTarget = target
        }
        return
      case 'return-to-play':
        for (const target of this.actionTargets(action, frame)) {
          if (target.kind === 'minion') {
            this.resurrect(target, frame, path)
          } else if (target.kind === 'card') {
            const card = this.removeCard(target)
            const definition = card ? cardDefinition(card.cardId) : undefined
            if (card && definition?.type === 'Minion')
              this.createMinion(
                target.participantId,
                card.cardId,
                frame,
                path,
                card.instanceId,
                undefined,
                undefined,
                card
              )
          }
        }
        return
      case 'resurrect': {
        const participants = this.targetPlayers(action, frame)
        for (const participantId of participants) {
          const sources =
            action.source !== undefined
              ? this.sourceEntitiesForParticipant(action, frame, participantId)
              : action.target !== undefined
                ? this.actionTargets(action, frame)
                : [frame.source]
          const count =
            action.count === undefined
              ? sources.length
              : Math.max(0, Math.floor(this.evaluate(action.count, frame)))
          for (const source of sources.slice(0, count)) {
            if (source.kind === 'minion')
              this.resurrect(source, frame, path, action.health)
          }
        }
        return
      }
      case 'return-to-hand':
        for (const target of this.actionTargets(action, frame))
          this.moveToHand(target, frame, path)
        return
      case 'reveal': {
        const targets =
          action.target === undefined
            ? [frame.source]
            : this.actionTargets(action, frame)
        for (const target of targets) {
          // Secret consumption owns the public reveal event. Authored Secret
          // blocks may retain `reveal` for catalog expressiveness, but must not
          // emit a second reveal after the Secret has already left its zone.
          if (target.kind === 'secret') continue
          if (target.kind === 'card') {
            const card = this.currentCard(target)
            if (card) {
              card.revealed = true
              card.knownTo = this.players().map((player) => player.participantId)
            }
          } else if (target.kind === 'minion') {
            this.updateMinion(target, (minion) => {
              minion.stealthRevealed = true
              minion.stealth = false
            })
          }
          this.emit(frame, name, path, { target: target.instanceId })
        }
        return
      }
      case 'sacrifice-and-damage': {
        const sources =
          action.source === undefined
            ? [frame.source]
            : this.sourceEntities(action, frame)
        for (const source of sources) {
          if (source.kind !== 'minion') continue
          const sourceFrame = {
            ...this.frameFor(source, frame.event, frame.chosenTargets),
            choiceIndex: frame.choiceIndex
          }
          this.directDestroy(source, sourceFrame, path + '.sacrifice')
          const targets =
            action.target === undefined ? [] : this.select(action.target, sourceFrame)
          for (const target of targets) {
            this.withTarget(sourceFrame, target, () => {
              const amount = this.evaluate(action.amount, sourceFrame)
              this.applyDamage(target, amount, sourceFrame, path + '.damage')
            })
            frame.lastActionTarget = target
          }
        }
        return
      }
      case 'schedule': {
        const trigger = stringValue(action.trigger) as CardTrigger | null
        if (!trigger || !CARD_TRIGGERS.includes(trigger)) return
        const selectedTarget =
          action.target === undefined ? undefined : this.select(action.target, frame)[0]
        // A start-of-turn schedule without an explicit turn is authored as
        // the source controller's next turn. If the source is acting now,
        // the opponent's turn is one boundary away and the source's turn is
        // two boundaries away.
        const startOfTurnOffset =
          this.draft.activePlayerId === frame.controllerId ? 2 : 1
        const executeOnTurn =
          typeof action.executeOnTurn === 'number'
            ? Math.max(0, Math.floor(action.executeOnTurn))
            : trigger === 'end-of-turn'
              ? this.draft.turnNumber
              : trigger === 'start-of-turn'
                ? this.draft.turnNumber + startOfTurnOffset
                : this.draft.turnNumber + 1
        if (action.attachedToTarget === true) {
          if (
            selectedTarget?.kind !== 'minion' ||
            (trigger !== 'start-of-turn' && trigger !== 'end-of-turn')
          )
            return
          const minion = this.currentMinion(selectedTarget)
          if (!minion) return
          const attached: RuntimeAttachedEffect = {
            id: this.allocateId(frame.source.instanceId + ':attached-effect'),
            sourceInstanceId: frame.source.instanceId,
            sourceCardId: frame.sourceCardId,
            controllerId: frame.controllerId,
            trigger,
            actions: asArray(action.actions).filter(isRecord),
            executeOnTurn
          }
          minion.attachedEffects = [
            ...(minion.attachedEffects ?? []),
            attached
          ] as unknown as DraftMinion['attachedEffects']
          this.emit(frame, name, path, {
            scheduleId: attached.id,
            target: selectedTarget.instanceId,
            trigger,
            executeOnTurn,
            attached: true
          })
          return
        }
        const scheduled: ScheduledEffect = {
          id: this.allocateId(frame.source.instanceId + ':schedule'),
          sourceInstanceId: frame.source.instanceId,
          sourceCardId: frame.sourceCardId,
          controllerId: frame.controllerId,
          source: this.persistentReference(frame.source),
          ...(selectedTarget
            ? { target: this.persistentReference(selectedTarget) }
            : {}),
          trigger,
          actions: asArray(action.actions).filter(isRecord),
          executeOnTurn,
          ...(stringValue(action.duration)
            ? { duration: stringValue(action.duration)! }
            : {})
        }
        this.draft.scheduledEffects = [
          ...(this.draft.scheduledEffects ?? []),
          scheduled
        ] as unknown as DraftState['scheduledEffects']
        this.emit(frame, name, path, {
          scheduleId: scheduled.id,
          trigger,
          executeOnTurn
        })
        return
      }
      case 'set-health':
        for (const target of this.actionTargets(action, frame)) {
          const amount = this.withTarget(frame, target, () =>
            this.evaluate(action.amount, frame)
          )
          this.setHealth(target, amount)
          this.emit(frame, name, path, {
            target: target.instanceId,
            health: amount
          })
          frame.lastActionTarget = target
        }
        return
      case 'set-hero-power': {
        const playerIds = this.targetPlayers(action, frame)
        if (action.power === 'upgrade-basic') {
          for (const participantId of playerIds) {
            const player = this.player(participantId)
            const upgradedId = BASIC_HERO_POWER_UPGRADES[player.heroPower.id]
            if (!upgradedId) continue
            const upgraded = HERO_POWER_CATALOG.require(upgradedId)
            player.heroPower = {
              ...player.heroPower,
              id: upgraded.id,
              baseCost: upgraded.cost,
              available: true,
              effectOverride: undefined
            }
            this.emit(frame, name, path, {
              participantId,
              heroPowerId: upgraded.id,
              available: true
            })
          }
          return
        }
        if (action.power === 'discover-basic') {
          const basicIds = new Set([
            'druid-shapeshift',
            'hunter-steady-shot',
            'mage-fireblast',
            'paladin-reinforce',
            'priest-lesser-heal',
            'rogue-dagger-mastery',
            'shaman-totemic-call',
            'warlock-life-tap',
            'warrior-armor-up'
          ])
          for (const participantId of playerIds) {
            const player = this.player(participantId)
            const pool = this.shuffle(
              HERO_POWER_CATALOG.all.filter(
                (definition) =>
                  basicIds.has(definition.id) && definition.id !== player.heroPower.id
              )
            ).slice(0, 3)
            const pending = {
              participantId,
              sourceCardInstanceId: frame.source.instanceId,
              sourceCardId: frame.sourceCardId!,
              options: pool.map((definition, choice) => ({
                choice,
                label: definition.displayName,
                presentationHeroPowerId: definition.id
              })),
              resolution: {
                type: 'hero-power' as const,
                heroPowerIds: pool.map((definition) => definition.id)
              }
            }
            if (this.draft.pendingCardChoice) {
              this.draft.pendingCardChoice.queued = [
                ...(this.draft.pendingCardChoice.queued ?? []),
                pending
              ]
            } else this.draft.pendingCardChoice = pending
            this.events.push({
              type: 'card-choice-started',
              participantId,
              sourceCardInstanceId: frame.source.instanceId,
              sourceCardId: frame.sourceCardId!,
              options: pending.options
            })
          }
          return
        }
        if (action.power === 'copy-opponent') {
          for (const participantId of playerIds) {
            const player = this.player(participantId)
            const opponentPower = this.player(this.otherPlayer(participantId)).heroPower
            player.heroPower = {
              ...clonePlain(opponentPower),
              creationOrdinal: player.heroPower.creationOrdinal,
              available: true
            }
            this.emit(frame, name, path, {
              participantId,
              heroPowerId: player.heroPower.id,
              available: true
            })
          }
          return
        }
        const power = isRecord(action.power) ? clonePlain(action.power) : null
        const upgraded = isRecord(action.upgradedPower)
          ? clonePlain(action.upgradedPower)
          : null
        for (const participantId of playerIds) {
          const player = this.player(participantId)
          const current = player.heroPower.effectOverride
          const useUpgraded = Boolean(
            upgraded &&
            power &&
            current &&
            JSON.stringify(current) === JSON.stringify(power)
          )
          player.heroPower.effectOverride = (useUpgraded ? upgraded : power) as
            Mutable<typeof player.heroPower>['effectOverride'] | undefined
          this.emit(frame, name, path, {
            participantId,
            effectOverride: player.heroPower.effectOverride ?? null
          })
        }
        return
      }
      case 'set-turn-limit': {
        const seconds = Math.max(0, Math.floor(this.evaluate(action.seconds, frame)))
        this.draft.turnLimitSeconds = seconds > 0 ? seconds : null
        this.emit(frame, name, path, { seconds: this.draft.turnLimitSeconds })
        return
      }
      case 'shuffle-into-deck': {
        const targets =
          action.target !== undefined
            ? this.actionTargets(action, frame)
            : this.sourceEntities(action, frame)
        const shuffledParticipants = new Set<PlayerId>()
        for (const target of targets) {
          const owner = this.player(target.participantId)
          const destinationParticipant =
            action.player === undefined
              ? owner.participantId
              : (this.targetPlayers(action, frame)[0] ?? owner.participantId)
          const destinationPlayer = this.player(destinationParticipant)
          let card: DraftCard | null = null
          if (target.kind === 'card') {
            card = this.removeCard(target)
          } else if (target.kind === 'minion') {
            const boardMinion = this.removeBoardMinion(target)
            if (boardMinion) {
              const definition = cardDefinition(boardMinion.cardId)
              if (definition) {
                card = {
                  instanceId: boardMinion.instanceId,
                  cardId: boardMinion.cardId,
                  ownerId: boardMinion.ownerId ?? owner.participantId,
                  controllerId: owner.participantId,
                  creationOrdinal: boardMinion.creationOrdinal,
                  baseCost: definition.cost,
                  currentCost: definition.cost,
                  zone: 'deck',
                  revealed: false
                }
              }
            } else {
              const graveyard = owner.graveyard ?? []
              const index = graveyard.findIndex(
                (entry) => entry.minion.instanceId === target.instanceId
              )
              const entry = index >= 0 ? graveyard[index] : undefined
              if (entry) {
                this.removeGraveyardAt(owner, index)
                const definition = cardDefinition(entry.minion.cardId)
                if (definition) {
                  card = {
                    instanceId: entry.minion.instanceId,
                    cardId: entry.minion.cardId,
                    ownerId: entry.ownerId,
                    controllerId: owner.participantId,
                    creationOrdinal: entry.minion.creationOrdinal,
                    baseCost: definition.cost,
                    currentCost: definition.cost,
                    zone: 'deck',
                    revealed: false
                  }
                }
              }
            }
          }
          if (card) {
            const updated = insertCardIntoPlayer(
              destinationPlayer as unknown as OpeningPlayerState,
              card,
              'deck'
            ) as DraftPlayer
            this.applyCardZones(destinationPlayer, updated)
            shuffledParticipants.add(destinationParticipant)
            this.emit(frame, name, path, {
              participantId: destinationParticipant,
              cardId: card.cardId,
              instanceId: card.instanceId
            })
          }
        }
        const generatedCardId = this.actionCardId(action)
        if (generatedCardId && action.target === undefined) {
          const generatedCount = Math.max(
            0,
            Math.floor(this.evaluate(action.count ?? 1, frame))
          )
          for (const participantId of this.targetPlayers(action, frame)) {
            const player = this.player(participantId)
            const definition = cardDefinition(generatedCardId)
            if (!definition) continue
            for (let index = 0; index < generatedCount; index += 1) {
              const generated: DraftCard = {
                instanceId: this.allocateId(participantId + ':generated-deck'),
                cardId: generatedCardId,
                ownerId: participantId,
                controllerId: participantId,
                creationOrdinal: this.nextEntityOrdinal++,
                baseCost: definition.cost,
                currentCost: definition.cost,
                zone: 'deck',
                revealed: false
              }
              const updated = insertCardIntoPlayer(
                player as unknown as OpeningPlayerState,
                generated,
                'deck'
              ) as DraftPlayer
              this.applyCardZones(player, updated)
              this.emit(frame, name, path + '.generated.' + index, {
                participantId,
                cardId: generated.cardId,
                instanceId: generated.instanceId
              })
            }
            shuffledParticipants.add(participantId)
          }
        }
        for (const participantId of shuffledParticipants) {
          const player = this.player(participantId)
          this.applyCardZones(player, {
            ...player,
            deck: this.shuffle(player.deck)
          })
        }
        return
      }
      case 'summon': {
        const cardId = this.actionCardId(action)
        if (!cardId) return
        const count = Math.max(0, this.evaluate(action.count ?? 1, frame))
        const controller =
          typeof action.controller === 'string' && action.controller === 'opponent'
            ? this.otherPlayer(frame.controllerId)
            : frame.controllerId
        const placement =
          typeof action.placement === 'string'
            ? (action.placement as CardSummonPlacement)
            : undefined
        let summonIndex = 0
        for (let index = 0; index < count; index += 1) {
          const summoned = this.createMinion(
            controller,
            cardId,
            frame,
            `${path}.${index}`,
            undefined,
            this.summonPosition(frame, controller, placement, summonIndex)
          )
          if (summoned) summonIndex += 1
          if (
            summoned &&
            frame.event &&
            (action.asNewAttackTarget === true || action.asNewSpellTarget === true)
          ) {
            frame.event.redirectTarget = summoned
          }
        }
        return
      }
      case 'summon-copy': {
        const targets =
          action.target !== undefined
            ? this.actionTargets(action, frame)
            : this.sourceEntities(action, frame)
        const count =
          action.source !== undefined
            ? 1
            : Math.max(1, this.evaluate(action.count ?? 1, frame))
        const placement =
          typeof action.placement === 'string'
            ? (action.placement as CardSummonPlacement)
            : undefined
        let summonIndex = 0
        for (const target of targets)
          for (let index = 0; index < count; index += 1)
            if (target.cardId)
              if (
                this.createMinion(
                  frame.controllerId,
                  target.cardId,
                  frame,
                  path,
                  undefined,
                  this.summonPosition(
                    frame,
                    frame.controllerId,
                    placement,
                    summonIndex
                  ),
                  this.currentMinion(target) ?? undefined
                )
              )
                summonIndex += 1
        return
      }
      case 'summon-for-each': {
        const cardId = this.actionCardId(action)
        if (!cardId) return
        const sources = this.sourceEntities(action, frame)
        const placement =
          typeof action.placement === 'string'
            ? (action.placement as CardSummonPlacement)
            : undefined
        let summonIndex = 0
        for (let index = 0; index < sources.length; index += 1)
          if (
            this.createMinion(
              frame.controllerId,
              cardId,
              frame,
              `${path}.${index}`,
              undefined,
              this.summonPosition(frame, frame.controllerId, placement, summonIndex)
            )
          )
            summonIndex += 1
        return
      }
      case 'summon-random': {
        const count = Math.max(0, this.evaluate(action.count ?? 1, frame))
        const pool = Array.isArray(action.pool)
          ? action.pool.filter((entry): entry is string => typeof entry === 'string')
          : CARD_CATALOG.all
              .filter(
                (card) =>
                  card.collectible &&
                  card.type === 'Minion' &&
                  this.matchesFilter(
                    {
                      instanceId: `${frame.controllerId}:pool:${card.id}`,
                      kind: 'card',
                      participantId: frame.controllerId,
                      zone: 'revealed',
                      cardId: card.id
                    },
                    action.filter,
                    frame
                  )
              )
              .map((card) => card.id)
        const placement =
          typeof action.placement === 'string'
            ? (action.placement as CardSummonPlacement)
            : undefined
        let summonIndex = 0
        for (let index = 0; index < count; index += 1) {
          const cardId = pool[Math.floor(this.rng.next() * pool.length)] as
            CardId | undefined
          if (cardId)
            if (
              this.createMinion(
                frame.controllerId,
                cardId,
                frame,
                `${path}.${index}`,
                undefined,
                this.summonPosition(frame, frame.controllerId, placement, summonIndex)
              )
            )
              summonIndex += 1
        }
        return
      }
      case 'swap': {
        const source =
          action.source !== undefined
            ? this.sourceEntities(action, frame)[0]
            : frame.source
        const target =
          action.target !== undefined ? this.actionTargets(action, frame)[0] : undefined
        if (!source || !target) return
        if (action.field === 'health') {
          const sourceMinion = this.currentMinion(source)
          const targetMinion = this.currentMinion(target)
          if (sourceMinion && targetMinion) {
            const health = sourceMinion.health
            sourceMinion.health = targetMinion.health
            targetMinion.health = health
          }
        } else if (source.kind === 'minion' && target.kind === 'card') {
          this.swapBoardMinionWithHandCard(source, target, frame, path)
          return
        }
        this.emit(frame, name, path, {
          source: source.instanceId,
          target: target.instanceId
        })
        return
      }
      case 'swap-stats': {
        const targets = this.actionTargets(action, frame)
        for (const target of targets) {
          const minion = this.currentMinion(target)
          if (!minion) continue
          const attack = minion.attack
          const health = minion.maxHealth
          const duration = stringValue(action.duration) ?? 'permanent'
          this.addEnchantment(target, {
            id: this.allocateId(`${frame.source.instanceId}:swap-stats`),
            sourceInstanceId: frame.source.instanceId,
            sourceCardId: frame.sourceCardId,
            swapStats: true,
            duration,
            ...(duration === 'this-turn'
              ? { expiresOnTurn: this.draft.turnNumber }
              : {}),
            ...(duration === 'next-turn'
              ? {
                  startsOnTurn: this.draft.turnNumber + 1,
                  expiresOnTurn: this.draft.turnNumber + 1
                }
              : {}),
            ...(duration === 'until-next-turn'
              ? { expiresOnTurn: this.draft.turnNumber + 1 }
              : {})
          })
          minion.attack = health
          minion.maxHealth = Math.max(1, attack)
          minion.health = Math.max(0, Math.min(attack, minion.maxHealth))
          minion.damageTaken = Math.max(0, minion.maxHealth - minion.health)
          this.emit(frame, name, path, { target: target.instanceId })
        }
        this.recomputeContinuousEffects()
        return
      }
      case 'take-control': {
        // The effect source's controller receives the target.  This is not
        // equivalent to selecting the opponent: Mind Control and temporary
        // steals are both authored from the gaining player's frame.
        const destination = frame.controllerId
        for (const target of this.actionTargets(action, frame)) {
          const minion = target.kind === 'minion' ? this.currentMinion(target) : null
          const previousController = minion?.controllerId ?? target.participantId
          const moved = this.setEntityController(target, destination, frame, path)
          if (
            moved &&
            target.kind === 'minion' &&
            action.duration === 'this-turn' &&
            previousController !== destination
          ) {
            const minion = this.player(destination).board.find(
              (candidate) => candidate.instanceId === target.instanceId
            )
            if (minion) {
              this.addEnchantment(
                { ...target, participantId: destination },
                {
                  id: this.allocateId(`${frame.source.instanceId}:temporary-control`),
                  sourceInstanceId: frame.source.instanceId,
                  sourceCardId: frame.sourceCardId,
                  keywords: ['charge'],
                  returnControllerId: previousController,
                  duration: 'this-turn',
                  expiresOnTurn: this.draft.turnNumber
                }
              )
            }
          }
        }
        return
      }
      case 'transform': {
        const cardId = this.actionCardId(action)
        if (cardId)
          for (const target of this.actionTargets(action, frame))
            this.transformMinion(target, cardId, frame, path)
        return
      }
      case 'transform-random': {
        const pool = Array.isArray(action.pool)
          ? action.pool.filter((entry): entry is string => typeof entry === 'string')
          : CARD_CATALOG.all
              .filter(
                (card) =>
                  card.collectible &&
                  card.type === 'Minion' &&
                  this.matchesFilter(
                    {
                      instanceId: `${frame.controllerId}:pool:${card.id}`,
                      kind: 'card',
                      participantId: frame.controllerId,
                      zone: 'revealed',
                      cardId: card.id
                    },
                    action.filter,
                    frame
                  )
              )
              .map((card) => card.id)
        for (const target of this.actionTargets(action, frame)) {
          const cardId = pool[Math.floor(this.rng.next() * pool.length)] as
            CardId | undefined
          if (!cardId) continue
          if (target.kind === 'card') {
            const card = this.currentCard(target)
            const definition = cardDefinition(cardId)
            if (!card || !definition) continue
            const previousCardId = card.cardId
            card.cardId = cardId
            card.baseCost = definition.cost
            card.currentCost = definition.cost
            card.costAdjustments = []
            card.enchantments = []
            card.attack = definition.type === 'Minion' ? definition.attack : undefined
            card.health = definition.type === 'Minion' ? definition.health : undefined
            this.emit(frame, name, path, {
              target: target.instanceId,
              previousCardId,
              cardId
            })
          } else this.transformMinion(target, cardId, frame, path)
        }
        return
      }
      case 'silence':
        for (const target of this.actionTargets(action, frame)) {
          if (target.kind !== 'minion') continue
          const minion = this.currentMinion(target)
          const definition = minion ? cardDefinition(minion.cardId) : undefined
          if (!minion || !definition || definition.type !== 'Minion') continue
          const currentPlayer = this.player(target.participantId)
          const temporaryControl = (minion.enchantments ?? []).find(
            (enchantment) => enchantment.returnControllerId !== undefined
          )
          const previousMaximum = minion.maxHealth
          const previousHealth = minion.health
          minion.baseAttack = definition.attack
          minion.baseHealth = definition.health
          minion.attack = definition.attack
          minion.maxHealth = definition.health
          minion.health = healthAfterMaximumChange(
            previousHealth,
            previousMaximum,
            minion.maxHealth
          )
          minion.damageTaken = Math.max(0, minion.maxHealth - minion.health)
          minion.keywords = []
          minion.enchantments = []
          minion.grantedTriggers = []
          minion.attachedEffects = []
          minion.deathrattles = []
          minion.silenced = true
          minion.divineShield = false
          minion.divineShieldConsumed = true
          minion.stealth = false
          minion.stealthRevealed = true
          minion.immune = false
          minion.spellImmune = false
          minion.frozenUntilTurn = null
          frame.lastActionTarget = temporaryControl
            ? this.returnTemporaryControlledMinion(
                minion,
                currentPlayer,
                temporaryControl,
                `${path}.return-control`
              )
            : target
        }
        return
      default:
        throw new UnsupportedEffectCapabilityError({
          cardId: frame.sourceCardId ?? 'unknown',
          supported: false,
          capabilities: [{ family: 'action', name, phase: 0, path }]
        })
    }
  }

  private recomputeContinuousEffects(): void {
    if (this.deriving) return
    this.deriving = true
    try {
      for (const player of this.draft.players) {
        for (const card of [
          ...player.deck,
          ...player.hand,
          ...(player.revealedCards ?? [])
        ]) {
          const definition = cardDefinition(card.cardId)
          const storedAdjustments = (card.costAdjustments ?? []).filter(
            (adjustment) => {
              if (
                adjustment.expiresOnTurn !== undefined &&
                adjustment.expiresOnTurn < this.draft.turnNumber
              )
                return false
              if (adjustment.continuous) return false
              return true
            }
          )
          const activeAdjustments = storedAdjustments.filter(
            (adjustment) =>
              (adjustment.startsOnTurn === undefined ||
                this.draft.turnNumber >= adjustment.startsOnTurn) &&
              (adjustment.duration !== 'while-in-hand' || card.zone === 'hand')
          )
          card.costAdjustments = storedAdjustments as DraftCard['costAdjustments']
          const baseCost = card.baseCost ?? definition?.cost ?? 0
          card.baseCost = baseCost
          card.currentCost = Math.max(
            0,
            baseCost +
              activeAdjustments.reduce((sum, adjustment) => sum + adjustment.amount, 0)
          )
        }
        const hero = player.hero
        const oldHeroMaximum = hero.maxHealth
        const oldHeroDamage = Math.max(0, oldHeroMaximum - hero.health)
        const heroEnchantments = (hero.enchantments ?? []).filter((enchantment) => {
          if (
            enchantment.expiresOnTurn !== undefined &&
            enchantment.expiresOnTurn < this.draft.turnNumber
          )
            return false
          if (enchantment.continuous) return false
          if (enchantment.duration === 'while-source-in-play')
            return this.sourceIsInPlay(enchantment.sourceInstanceId)
          return true
        })
        const activeHeroEnchantments = heroEnchantments.filter(
          (enchantment) =>
            (enchantment.startsOnTurn === undefined ||
              this.draft.turnNumber >= enchantment.startsOnTurn) &&
            (enchantment.duration !== 'while-damaged' || hero.health < hero.maxHealth)
        )
        const heroBaseAttack = hero.baseAttack ?? 0
        const heroBaseHealth = hero.baseMaxHealth ?? oldHeroMaximum
        const heroBaseKeywords = hero.baseKeywords ?? hero.keywords ?? []
        if (!hero.baseKeywords) hero.baseKeywords = [...heroBaseKeywords]
        const heroAttack = activeHeroEnchantments.reduce(
          (sum, enchantment) =>
            enchantment.attackMultiplier === undefined
              ? sum + (enchantment.attackDelta ?? 0)
              : sum * enchantment.attackMultiplier,
          heroBaseAttack
        )
        const heroMaximumHealth = Math.max(
          1,
          activeHeroEnchantments.reduce(
            (sum, enchantment) =>
              enchantment.healthMultiplier === undefined
                ? sum + (enchantment.maximumHealthDelta ?? enchantment.healthDelta ?? 0)
                : sum * enchantment.healthMultiplier,
            heroBaseHealth
          )
        )
        hero.enchantments = heroEnchantments as Mutable<PlayerHeroState>['enchantments']
        hero.attack = Math.max(0, heroAttack)
        hero.maxHealth = heroMaximumHealth
        hero.health = clamp(heroMaximumHealth - oldHeroDamage, 0, heroMaximumHealth)
        hero.damageTaken = Math.max(0, heroMaximumHealth - hero.health)
        hero.maximumDamageTaken = activeHeroEnchantments.reduce(
          (maximum, enchantment) =>
            Math.min(maximum, enchantment.maximumDamageTaken ?? maximum),
          Number.POSITIVE_INFINITY
        )
        if (!Number.isFinite(hero.maximumDamageTaken))
          hero.maximumDamageTaken = undefined
        hero.damageTakenMultiplier = activeHeroEnchantments.reduce(
          (multiplier, enchantment) =>
            multiplier * (enchantment.damageTakenMultiplier ?? 1),
          1
        )
        const heroKeywords = new Set<CardKeyword>(heroBaseKeywords)
        for (const enchantment of activeHeroEnchantments) {
          for (const keyword of enchantment.keywords ?? []) heroKeywords.add(keyword)
          for (const keyword of enchantment.removedKeywords ?? [])
            heroKeywords.delete(keyword)
        }
        hero.keywords = [...heroKeywords]
        hero.immune = heroKeywords.has('immune')
        hero.spellImmune = heroKeywords.has('spell-immune')
        const heroCombatKeywords = new Set(heroKeywords)
        if (player.weapon) {
          const weaponDefinition = cardDefinition(player.weapon.cardId)
          if (weaponDefinition?.type === 'Weapon') {
            for (const keyword of weaponDefinition.keywords)
              heroCombatKeywords.add(keyword)
          }
          for (const enchantment of player.weapon.enchantments ?? []) {
            if (
              (enchantment.expiresOnTurn !== undefined &&
                enchantment.expiresOnTurn < this.draft.turnNumber) ||
              (enchantment.startsOnTurn !== undefined &&
                enchantment.startsOnTurn > this.draft.turnNumber) ||
              enchantment.continuous ||
              (enchantment.duration === 'while-source-in-play' &&
                !this.sourceIsInPlay(enchantment.sourceInstanceId))
            )
              continue
            for (const keyword of enchantment.keywords ?? [])
              heroCombatKeywords.add(keyword)
            for (const keyword of enchantment.removedKeywords ?? [])
              heroCombatKeywords.delete(keyword)
          }
        }
        hero.maxAttacksPerTurn = attacksPerTurnForKeywords(heroCombatKeywords)
        hero.spellDamage = heroKeywords.has('spell-damage')
          ? Math.max(
              1,
              activeHeroEnchantments.reduce(
                (value, enchantment) =>
                  value +
                  (enchantment.keywords?.includes('spell-damage')
                    ? (enchantment.spellDamageDelta ?? 1)
                    : 0),
                0
              )
            )
          : 0
        hero.spellDamageMultiplier = activeHeroEnchantments.reduce(
          (value, enchantment) => value * (enchantment.spellDamageMultiplier ?? 1),
          1
        )
        hero.healingMultiplier = activeHeroEnchantments.reduce(
          (value, enchantment) => value * (enchantment.healingMultiplier ?? 1),
          1
        )
        hero.heroPowerMultiplier = activeHeroEnchantments.reduce(
          (value, enchantment) => value * (enchantment.heroPowerMultiplier ?? 1),
          1
        )
        if (player.weapon) {
          const weapon = player.weapon
          const definition = cardDefinition(weapon.cardId)
          const oldMaximum = weapon.maxDurability
          const oldLostDurability = Math.max(0, oldMaximum - weapon.durability)
          const enchantments = (weapon.enchantments ?? []).filter((enchantment) => {
            if (
              enchantment.expiresOnTurn !== undefined &&
              enchantment.expiresOnTurn < this.draft.turnNumber
            )
              return false
            if (enchantment.continuous) return false
            if (enchantment.duration === 'while-source-in-play')
              return this.sourceIsInPlay(enchantment.sourceInstanceId)
            return true
          })
          const baseAttack =
            definition?.type === 'Weapon' ? definition.attack : weapon.attack
          const baseDurability =
            definition?.type === 'Weapon' ? definition.durability : oldMaximum
          const activeEnchantments = enchantments.filter(
            (enchantment) =>
              enchantment.startsOnTurn === undefined ||
              this.draft.turnNumber >= enchantment.startsOnTurn
          )
          weapon.enchantments = enchantments as Mutable<BoardWeapon>['enchantments']
          weapon.attack = Math.max(
            0,
            activeEnchantments.reduce(
              (sum, enchantment) => sum + (enchantment.attackDelta ?? 0),
              baseAttack
            )
          )
          weapon.maxDurability = Math.max(
            1,
            activeEnchantments.reduce(
              (sum, enchantment) => sum + (enchantment.durabilityDelta ?? 0),
              baseDurability
            )
          )
          weapon.durability = Math.max(0, weapon.maxDurability - oldLostDurability)
        }
        const power = player.heroPower
        const powerEnchantments = (power.enchantments ?? []).filter((enchantment) => {
          if (
            enchantment.expiresOnTurn !== undefined &&
            enchantment.expiresOnTurn < this.draft.turnNumber
          )
            return false
          return !enchantment.continuous
        })
        const activePowerEnchantments = powerEnchantments.filter(
          (enchantment) =>
            enchantment.startsOnTurn === undefined ||
            this.draft.turnNumber >= enchantment.startsOnTurn
        )
        power.enchantments = powerEnchantments as Mutable<typeof power>['enchantments']
        const basePowerCost = power.baseCost ?? power.cost
        power.baseCost = basePowerCost
        power.cost = Math.max(
          0,
          activePowerEnchantments.reduce(
            (sum, enchantment) => sum + (enchantment.costDelta ?? 0),
            basePowerCost
          )
        )
        const baseTargeting =
          power.targetType ?? HERO_POWER_CATALOG.get(power.id)?.targeting ?? 'none'
        power.targetingGranted = activePowerEnchantments.reduce<string | null>(
          (targeting, enchantment) =>
            enchantment.targetingGranted === undefined
              ? targeting
              : enchantment.targetingGranted,
          baseTargeting
        )
        for (const minion of player.board) {
          const oldMaximum = minion.maxHealth
          const oldHealth = minion.health
          const storedEnchantments = (minion.enchantments ?? []).filter(
            (enchantment) => {
              if (
                enchantment.expiresOnTurn !== undefined &&
                enchantment.expiresOnTurn < this.draft.turnNumber
              )
                return false
              if (
                enchantment.duration === 'while-source-in-play' &&
                !this.sourceIsInPlay(enchantment.sourceInstanceId)
              )
                return false
              return !enchantment.continuous
            }
          )
          const activeEnchantments = storedEnchantments.filter(
            (enchantment) =>
              (enchantment.startsOnTurn === undefined ||
                this.draft.turnNumber >= enchantment.startsOnTurn) &&
              (enchantment.duration !== 'while-damaged' ||
                minion.health < minion.maxHealth)
          )
          const base = cardDefinition(minion.cardId)
          const baseAttack =
            minion.baseAttack ?? (base?.type === 'Minion' ? base.attack : minion.attack)
          const baseHealth =
            minion.baseHealth ??
            (base?.type === 'Minion' ? base.health : minion.maxHealth)
          const attack = activeEnchantments.reduce(
            (sum, enchantment) =>
              enchantment.attackMultiplier === undefined
                ? sum + (enchantment.attackDelta ?? 0)
                : sum * enchantment.attackMultiplier,
            baseAttack
          )
          let maximumHealth = Math.max(
            1,
            activeEnchantments.reduce(
              (sum, enchantment) =>
                enchantment.healthMultiplier === undefined
                  ? sum +
                    (enchantment.maximumHealthDelta ?? enchantment.healthDelta ?? 0)
                  : sum * enchantment.healthMultiplier,
              baseHealth
            )
          )
          const minimumHealth = activeEnchantments.reduce(
            (minimum, enchantment) => Math.max(minimum, enchantment.minimumHealth ?? 0),
            0
          )
          const swapCount = activeEnchantments.filter(
            (enchantment) => enchantment.swapStats
          ).length
          const swappedAttack = swapCount % 2 === 1 ? maximumHealth : attack
          if (swapCount % 2 === 1) maximumHealth = Math.max(1, attack)
          minion.enchantments = storedEnchantments as DraftMinion['enchantments']
          minion.attack = Math.max(0, swappedAttack)
          minion.maxHealth = maximumHealth
          minion.health = Math.max(
            minimumHealth,
            healthAfterMaximumChange(oldHealth, oldMaximum, maximumHealth)
          )
          minion.damageTaken = Math.max(0, maximumHealth - minion.health)
          const keywords = effectiveBoardMinionKeywords({
            ...minion,
            enchantments: activeEnchantments
          })
          minion.divineShield =
            !minion.divineShieldConsumed && keywords.includes('divine-shield')
          minion.stealth = !minion.stealthRevealed && keywords.includes('stealth')
          minion.immune = keywords.includes('immune')
          minion.spellImmune = keywords.includes('spell-immune')
          minion.maxAttacksPerTurn = keywords.includes('mega-windfury')
            ? 4
            : keywords.includes('windfury')
              ? 2
              : 1
          const baseSpellDamage = base?.keywords.includes('spell-damage') ? 1 : 0
          const grantedSpellDamage = activeEnchantments.reduce(
            (value, enchantment) =>
              value +
              (enchantment.keywords?.includes('spell-damage')
                ? (enchantment.spellDamageDelta ?? 1)
                : 0),
            baseSpellDamage
          )
          minion.spellDamage = keywords.includes('spell-damage')
            ? Math.max(1, grantedSpellDamage)
            : 0
          minion.spellDamageMultiplier = activeEnchantments.reduce(
            (value, enchantment) => value * (enchantment.spellDamageMultiplier ?? 1),
            1
          )
          minion.healingMultiplier = activeEnchantments.reduce(
            (value, enchantment) => value * (enchantment.healingMultiplier ?? 1),
            1
          )
          minion.heroPowerMultiplier = activeEnchantments.reduce(
            (value, enchantment) => value * (enchantment.heroPowerMultiplier ?? 1),
            1
          )
          minion.triggerMultipliers = activeEnchantments.reduce<Record<string, number>>(
            (multipliers, enchantment) => {
              for (const [trigger, multiplier] of Object.entries(
                enchantment.triggerMultipliers ?? {}
              )) {
                multipliers[trigger] = Math.max(multipliers[trigger] ?? 1, multiplier)
              }
              return multipliers
            },
            {}
          )
        }
      }

      for (const player of this.draft.players) {
        for (const minion of player.board) {
          if (minion.silenced) continue
          const definition = cardDefinition(minion.cardId)
          if (!definition) continue
          const source: EntityRef = {
            instanceId: minion.instanceId,
            kind: 'minion',
            participantId: player.participantId,
            zone: 'board',
            cardId: minion.cardId
          }
          for (const [index, block] of definition.effects.entries()) {
            if (block.trigger !== 'aura') continue
            this.runBlock(
              block,
              { ...this.frameFor(source, null, []), continuous: true },
              `aura.${source.instanceId}.${index}`
            )
          }
        }
        if (player.weapon) {
          const definition = cardDefinition(player.weapon.cardId)
          const source: EntityRef = {
            instanceId: player.weapon.instanceId,
            kind: 'weapon',
            participantId: player.participantId,
            zone: 'weapon',
            cardId: player.weapon.cardId
          }
          for (const [index, block] of (definition?.effects ?? []).entries()) {
            if (block.trigger !== 'aura') continue
            this.runBlock(
              block,
              { ...this.frameFor(source, null, []), continuous: true },
              `aura.${source.instanceId}.${index}`
            )
          }
        }
        for (const card of player.hand) {
          const definition = cardDefinition(card.cardId)
          if (!definition) continue
          const source: EntityRef = {
            instanceId: card.instanceId,
            kind: 'card',
            participantId: player.participantId,
            zone: 'hand',
            cardId: card.cardId
          }
          for (const [index, block] of definition.effects.entries()) {
            if (block.trigger !== 'while-in-hand' || block.event) continue
            this.runBlock(
              block,
              { ...this.frameFor(source, null, []), continuous: true },
              `while-in-hand.${source.instanceId}.${index}`
            )
          }
        }
      }
    } finally {
      this.deriving = false
    }
  }

  private targetSelectorsFor(
    card: CardDefinition,
    frame: EffectFrame,
    choiceIndex?: number
  ): readonly Readonly<Record<string, unknown>>[] {
    const selectors: {
      selector: Readonly<Record<string, unknown>>
      path: string
    }[] = []
    const activeEffects = card.effects.filter((block) => {
      if (!block.condition) return true
      const type = isRecord(block.condition) ? block.condition.type : undefined
      if (typeof type === 'string' && type.startsWith('target-')) return true
      return this.conditionMatches(block.condition, frame)
    })
    collectTargetSelectors(activeEffects, '.effects', selectors, choiceIndex)
    const seen = new Set<string>()
    return selectors
      .map((entry) => entry.selector)
      .filter((selector) => {
        const key = JSON.stringify(selector)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }
  private choiceCountFor(card: CardDefinition): number {
    const options = collectChoiceOptions(card.effects)
    return options?.length ?? 0
  }

  private choiceLabelsFor(card: CardDefinition): readonly string[] {
    const options = collectChoiceOptions(card.effects) ?? []
    const authoredLabels = card.rulesText
      .replace(/^.*?Choose One\s*-\s*/i, '')
      .split(/\s*;\s*or\s+/i)
      .map((label) => label.replace(/[.;]\s*$/, '').trim())
    return options.map((option, index) => {
      if (isRecord(option)) {
        for (const key of ['label', 'name', 'text']) {
          const value = option[key]
          if (typeof value === 'string' && value.trim().length > 0) return value.trim()
        }
      }
      return authoredLabels.length === options.length && authoredLabels[index]
        ? authoredLabels[index]!
        : `Choice ${index + 1}`
    })
  }

  private choiceOptionsFor(card: CardDefinition): readonly CardChoiceOption[] {
    const options = collectChoiceOptions(card.effects) ?? []
    const labels = this.choiceLabelsFor(card)
    return options.map((option, choice) => {
      const actions = isRecord(option) ? asArray(option.actions) : []
      const transform = actions.find(
        (action) =>
          isRecord(action) &&
          action.action === 'transform' &&
          typeof action.cardId === 'string' &&
          CARD_CATALOG.get(action.cardId as CardId)
      ) as Readonly<Record<string, unknown>> | undefined
      return {
        choice,
        label: labels[choice] ?? `Choice ${choice + 1}`,
        ...(typeof transform?.cardId === 'string'
          ? { presentationCardId: transform.cardId as CardId }
          : {})
      }
    })
  }

  private choiceTimingFor(card: CardDefinition): 'before-play' | 'after-placement' {
    if (card.type !== 'Minion') return 'before-play'
    const options = collectChoiceOptions(card.effects) ?? []
    if (options.length === 0) return 'before-play'
    const selfTransforms = options.every((option) => {
      if (!isRecord(option)) return false
      const actions = asArray(option.actions)
      return actions.some((action) => {
        if (!isRecord(action) || action.action !== 'transform') return false
        const target = isRecord(action.target) ? action.target : null
        return target?.type === 'minion' && target.selection === 'source'
      })
    })
    return selfTransforms ? 'after-placement' : 'before-play'
  }

  /** Determines whether the current effect branch is conditionally enhanced. */
  private playEffectPreview(
    card: CardDefinition,
    frame: EffectFrame
  ): CardPlayEffectPreview | null {
    const activeBlocks = card.effects.filter(
      (block) =>
        (block.trigger === 'cast' || block.trigger === 'battlecry') &&
        (!block.condition || this.conditionMatches(block.condition, frame))
    )
    if (activeBlocks.length === 0) return null
    return {
      conditionallyEnhanced: activeBlocks.some(
        (block) =>
          block.condition !== undefined && this.isPositivePlayCondition(block.condition)
      )
    }
  }

  private hasResolvableSpellCastAction(
    card: CardDefinition,
    frame: EffectFrame,
    choiceIndex?: number
  ): boolean {
    if (card.type !== 'Spell') return true
    const actions: Readonly<Record<string, unknown>>[] = []
    for (const block of card.effects) {
      if (
        block.trigger !== 'cast' ||
        (block.condition && !this.conditionMatches(block.condition, frame))
      )
        continue
      collectSelectedEffectActions(block.actions, choiceIndex, actions)
    }
    if (actions.length === 0) return true
    return actions.some((action) => {
      const target = isRecord(action.target) ? action.target : null
      return (
        target?.selection !== 'random' ||
        this.legalInputCandidates(target, frame).length > 0
      )
    })
  }

  /** Complementary "otherwise" branches do not represent a conditional bonus. */
  private isPositivePlayCondition(condition: unknown): boolean {
    if (!isRecord(condition) || typeof condition.type !== 'string') return false
    return !(
      condition.type.startsWith('player-lacks-') ||
      condition.type === 'not-combo' ||
      condition.type === 'target-is-not-friendly-demon' ||
      condition.type === 'target-not-frozen'
    )
  }

  private pendingCostModifierAmount(
    card: DraftCard,
    participantId: PlayerId,
    frame: EffectFrame
  ): number {
    const player = this.player(participantId)
    const reference: EntityRef = {
      instanceId: card.instanceId,
      kind: 'card',
      participantId,
      zone: 'hand',
      cardId: card.cardId
    }
    return (player.pendingCostModifiers ?? [])
      .filter((modifier) => this.matchesFilter(reference, modifier.filter, frame))
      .reduce((total, modifier) => total + modifier.amount, 0)
  }

  private consumePendingCostModifiers(
    card: DraftCard,
    participantId: PlayerId,
    frame: EffectFrame
  ): void {
    const player = this.player(participantId)
    const reference: EntityRef = {
      instanceId: card.instanceId,
      kind: 'card',
      participantId,
      zone: 'hand',
      cardId: card.cardId
    }
    player.pendingCostModifiers = (player.pendingCostModifiers ?? []).filter(
      (modifier) => !this.matchesFilter(reference, modifier.filter, frame)
    )
  }

  private playInput(
    participantId: PlayerId,
    cardInstanceId: string,
    choiceIndex?: number
  ): PlayCardInput | null {
    if (!this.draft.players.some((player) => player.participantId === participantId))
      return null
    const player = this.player(participantId)
    const card = player.hand.find(
      (candidate) => candidate.instanceId === cardInstanceId
    )
    if (!card) return null
    const definition = cardDefinition(card.cardId)
    if (!definition) return null
    if (isMindControlSpell(definition) && player.board.length >= MAX_BOARD_SIZE)
      return null
    const requiresPosition = definition.type === 'Minion'
    const legalPositions =
      requiresPosition && player.board.length < MAX_BOARD_SIZE
        ? Array.from({ length: player.board.length + 1 }, (_, index) => index)
        : []
    const choiceCount = this.choiceCountFor(definition)
    const choiceOptions = this.choiceOptionsFor(definition)
    const choiceTiming = this.choiceTimingFor(definition)
    if (
      choiceIndex !== undefined &&
      (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= choiceCount)
    )
      return null
    const selectedChoice = choiceCount > 0 ? (choiceIndex ?? 0) : undefined
    const source: EntityRef = {
      instanceId: card.instanceId,
      kind: 'card',
      participantId,
      zone: 'hand',
      cardId: card.cardId
    }
    // Play-time conditions resolve after the source has left the hand. Minions
    // and weapons have also entered their play zones by then, so condition
    // previews and conditional target discovery must evaluate that projected state.
    const targetFrame = {
      ...this.frameFor(source, null, []),
      prospectiveCardPlay: true
    }
    if (!this.hasResolvableSpellCastAction(definition, targetFrame, selectedChoice)) {
      return null
    }
    const targetSelectors = this.targetSelectorsFor(
      definition,
      targetFrame,
      selectedChoice
    )
    const legalTargetOptions = targetSelectors.map((selector) =>
      this.legalInputCandidates(selector, targetFrame)
        .map((candidate) => publicTarget(candidate))
        .filter((candidate): candidate is CardPlayTargetRef => candidate !== null)
    )
    // Hearthstone targeted Battlecries cannot target the minion being played.
    // If any required target has no eligible board entity, the minion still
    // enters play and its target-dependent Battlecry actions resolve as no-ops.
    const skipTargetedBattlecry =
      definition.type === 'Minion' &&
      targetSelectors.length > 0 &&
      legalTargetOptions.some((options) => options.length === 0)
    return {
      participantId,
      cardInstanceId,
      cardId: card.cardId,
      currentCost: Math.max(
        0,
        (card.currentCost ?? card.baseCost ?? definition.cost) +
          this.pendingCostModifierAmount(card, participantId, targetFrame)
      ),
      requiresPosition,
      legalPositions,
      targetSelectors: skipTargetedBattlecry ? [] : targetSelectors,
      legalTargetOptions: skipTargetedBattlecry ? [] : legalTargetOptions,
      skipTargetedBattlecry,
      choiceCount,
      legalChoices: Array.from({ length: choiceCount }, (_, index) => index),
      choiceOptions,
      choiceTiming,
      effectPreview: this.playEffectPreview(definition, targetFrame)
    }
  }

  getPlayInput(
    participantId: PlayerId,
    cardInstanceId: string,
    choice?: number
  ): PlayCardInput | null {
    return this.playInput(participantId, cardInstanceId, choice)
  }

  private legalInputCandidates(
    selectorValue: Readonly<Record<string, unknown>>,
    frame: EffectFrame
  ): readonly EntityRef[] {
    const position = selectorValue.position
    const preservesPositionRange =
      position === 'top' ||
      position === 'bottom' ||
      position === 'first' ||
      position === 'last'
    const selector = {
      ...selectorValue,
      selection: 'all',
      count: preservesPositionRange ? selectorValue.count : undefined,
      preserve: undefined
    }
    const candidates = this.selectorCandidates(selector, frame)
    if (!this.sourceIsSpell(frame)) return candidates
    return candidates.filter(
      (candidate) =>
        !this.hasKeyword(candidate, 'immune') &&
        !this.hasKeyword(candidate, 'spell-immune')
    )
  }

  private hasLegalTargetAssignment(
    selectors: readonly Readonly<Record<string, unknown>>[],
    frame: EffectFrame
  ): boolean {
    const candidates = selectors.map((selector) =>
      this.legalInputCandidates(selector, frame)
    )
    const visit = (index: number, used: ReadonlySet<string>): boolean => {
      if (index >= candidates.length) return true
      for (const candidate of candidates[index] ?? []) {
        const key = entityKey(candidate)
        if (used.has(key)) continue
        const next = new Set(used)
        next.add(key)
        if (visit(index + 1, next)) return true
      }
      return false
    }
    return visit(0, new Set())
  }

  getMatchLegality(participantId: PlayerId): MatchLegality {
    if (!this.draft.players.some((player) => player.participantId === participantId)) {
      return {
        canEndTurn: false,
        playableCardInstanceIds: [],
        legalAttackerInstanceIds: [],
        legalAttackTargets: {},
        legalHeroPower: false,
        legalHeroPowerTargets: [],
        legalTargets: {}
      }
    }
    const player = this.player(participantId)
    const active =
      this.draft.phase === 'turns' && this.draft.activePlayerId === participantId
    const playableCardInstanceIds = active
      ? player.hand
          .filter((card) => {
            const definition = cardDefinition(card.cardId)
            if (!definition) return false
            if (
              (card.currentCost ?? card.baseCost ?? definition.cost) >
              player.mana.available
            )
              return false
            if (definition.type === 'Minion' && player.board.length >= MAX_BOARD_SIZE)
              return false
            if (definition.type === 'Spell' && definition.keywords.includes('secret')) {
              if (
                (player.secrets ?? []).length >= 5 ||
                (player.secrets ?? []).some((secret) => secret.cardId === card.cardId)
              )
                return false
            }
            const input = this.playInput(participantId, card.instanceId)
            if (!input) return false
            const source: EntityRef = {
              instanceId: card.instanceId,
              kind: 'card',
              participantId,
              zone: 'hand',
              cardId: card.cardId
            }
            const inputs =
              input.choiceCount > 0
                ? input.legalChoices
                    .map((choice) =>
                      this.playInput(participantId, card.instanceId, choice)
                    )
                    .filter(
                      (candidate): candidate is PlayCardInput => candidate !== null
                    )
                : [input]
            const frame = this.frameFor(source, null, [])
            return inputs.some((candidate) =>
              this.hasLegalTargetAssignment(candidate.targetSelectors, frame)
            )
          })
          .map((card) => card.instanceId)
      : []
    const legalAttackerInstanceIds = active
      ? player.board
          .filter((minion) => {
            const keywords = effectiveBoardMinionKeywords(minion, this.draft.turnNumber)
            const frozen = (minion.frozenUntilTurn ?? -1) >= this.draft.turnNumber
            const attacks = boardMinionAttacksUsed(minion, this.draft.turnNumber)
            const maximum =
              minion.maxAttacksPerTurn ??
              (keywords.includes('mega-windfury')
                ? 4
                : keywords.includes('windfury')
                  ? 2
                  : 1)
            return (
              minion.health > 0 &&
              minion.attack > 0 &&
              !keywords.includes('cannot-attack') &&
              !frozen &&
              (keywords.includes('charge') ||
                !hasBoardMinionEntryExhaustion(minion, this.draft.turnNumber)) &&
              attacks < maximum
            )
          })
          .map((minion) => minion.instanceId)
      : []
    const legalAttackTargets: Record<string, AttackCharacterRef[]> = {}
    if (active) {
      const opponent = this.otherPlayer(participantId)
      const opponentPlayer = this.player(opponent)
      const taunts = opponentPlayer.board.filter((minion) => {
        const ref: EntityRef = {
          instanceId: minion.instanceId,
          kind: 'minion',
          participantId: opponent,
          zone: 'board',
          cardId: minion.cardId
        }
        return this.hasKeyword(ref, 'taunt') && !this.hasKeyword(ref, 'stealth')
      })
      const defenders =
        taunts.length > 0
          ? taunts.map((minion) => ({
              kind: 'minion' as const,
              instanceId: minion.instanceId
            }))
          : [
              { kind: 'hero' as const },
              ...opponentPlayer.board
                .filter(
                  (minion) =>
                    !this.hasKeyword(
                      {
                        instanceId: minion.instanceId,
                        kind: 'minion',
                        participantId: opponent,
                        zone: 'board',
                        cardId: minion.cardId
                      },
                      'stealth'
                    )
                )
                .map((minion) => ({
                  kind: 'minion' as const,
                  instanceId: minion.instanceId
                }))
            ]
      for (const attacker of legalAttackerInstanceIds)
        legalAttackTargets[attacker] = defenders
      if (
        this.combatCanAttack({
          instanceId: `${participantId}:hero`,
          kind: 'hero',
          participantId,
          zone: 'hero'
        })
      ) {
        legalAttackTargets[`${participantId}:hero`] = defenders
      }
    }
    const legalTargets: Record<string, readonly CardPlayTargetRef[]> = {}
    for (const card of player.hand) {
      const input = this.playInput(participantId, card.instanceId)
      if (!input) continue
      const source: EntityRef = {
        instanceId: card.instanceId,
        kind: 'card',
        participantId,
        zone: 'hand',
        cardId: card.cardId
      }
      const frame = this.frameFor(source, null, [])
      const inputs =
        input.choiceCount > 0
          ? input.legalChoices
              .map((choice) => this.playInput(participantId, card.instanceId, choice))
              .filter((candidate): candidate is PlayCardInput => candidate !== null)
          : [input]
      const seenTargets = new Set<string>()
      legalTargets[card.instanceId] = inputs.flatMap((candidate) =>
        candidate.targetSelectors.flatMap((selector) =>
          this.legalInputCandidates(selector, frame)
            .map((target) => publicTarget(target))
            .filter((target): target is CardPlayTargetRef => target !== null)
            .filter((target) => {
              const key = `${target.kind}:${target.kind === 'hero' ? target.participantId : target.instanceId}`
              if (seenTargets.has(key)) return false
              seenTargets.add(key)
              return true
            })
        )
      )
    }
    const power = HERO_POWER_CATALOG.get(player.heroPower.id)
    const effectiveTargeting =
      player.heroPower.targetingGranted ?? power?.targeting ?? 'none'
    const legalHeroPowerTargets: HeroPowerTargetRef[] = []
    for (const target of this.allEntities()) {
      const matchesTargetType =
        effectiveTargeting === 'any-character'
          ? target.kind === 'hero' || target.kind === 'minion'
          : effectiveTargeting === 'minion'
            ? target.kind === 'minion'
            : false
      if (
        !matchesTargetType ||
        !this.liveCombatTarget(target) ||
        this.hasKeyword(target, 'immune') ||
        this.hasKeyword(target, 'spell-immune')
      )
        continue
      if (target.kind === 'hero') {
        legalHeroPowerTargets.push({
          kind: 'hero',
          participantId: target.participantId
        })
      } else {
        legalHeroPowerTargets.push({
          kind: 'minion',
          participantId: target.participantId,
          instanceId: target.instanceId
        })
      }
    }
    const heroPowerBoardAvailable =
      power?.effect.kind === 'summon' || power?.effect.kind === 'summon-random-totem'
        ? player.board.length < MAX_BOARD_SIZE
        : true
    const heroPowerTotemAvailable =
      power?.effect.kind === 'summon-random-totem'
        ? power.effect.cardIds.some(
            (cardId) => !player.board.some((minion) => minion.cardId === cardId)
          )
        : true
    const legalHeroPower =
      active &&
      player.heroPower.available &&
      player.heroPower.cost <= player.mana.available &&
      heroPowerBoardAvailable &&
      heroPowerTotemAvailable &&
      legalHeroPowerTargets.length >= (effectiveTargeting === 'none' ? 0 : 1)
    return {
      canEndTurn: active,
      playableCardInstanceIds,
      legalAttackerInstanceIds,
      legalAttackTargets,
      legalHeroPower,
      legalHeroPowerTargets,
      legalTargets
    }
  }

  getEffectTrace(): readonly EffectTraceEntry[] {
    return copyPlainArray(this.trace)
  }

  private validatePlayInput(options: EffectRuntimeOptions): {
    readonly card: DraftCard
    readonly definition: CardDefinition
    readonly source: EntityRef
    readonly chosenTargets: readonly EntityRef[]
    readonly input: PlayCardInput
  } {
    if (this.draft.phase !== 'turns')
      throw new ResolutionInputError('resolution-failed', 'Turns have not started yet.')
    if (this.draft.activePlayerId !== options.participantId)
      throw new ResolutionInputError(
        'wrong-controller',
        'Only the active participant can play a card.'
      )
    const player = this.player(options.participantId)
    const card = player.hand.find(
      (candidate) => candidate.instanceId === options.cardInstanceId
    ) as DraftCard | undefined
    if (!card)
      throw new ResolutionInputError(
        'stale-target',
        'The selected card is no longer in the player hand.'
      )
    const definition = cardDefinition(card.cardId)
    if (!definition)
      throw new ResolutionInputError('stale-target', `Unknown card ${card.cardId}.`)
    const report = inspectCardCapabilities(definition, runtimeCapabilityKeys())
    if (!report.supported) throw new UnsupportedEffectCapabilityError(report)
    if (isMindControlSpell(definition) && player.board.length >= MAX_BOARD_SIZE)
      throw new ResolutionInputError('board-full', 'The board is full.')
    const choiceCount = this.choiceCountFor(definition)
    const choiceTiming = this.choiceTimingFor(definition)
    if (choiceCount > 0) {
      if (
        options.choice === undefined &&
        !(options.deferChoice === true && choiceTiming === 'after-placement')
      )
        throw new ResolutionInputError('missing-input', 'The card requires a choice.')
      if (
        options.choice !== undefined &&
        (!Number.isInteger(options.choice) ||
          options.choice < 0 ||
          options.choice >= choiceCount)
      )
        throw new ResolutionInputError('extra-input', 'The selected choice is invalid.')
    } else if (options.choice !== undefined) {
      throw new ResolutionInputError(
        'extra-input',
        'This card does not require a choice.'
      )
    }
    const input = this.playInput(
      options.participantId,
      options.cardInstanceId,
      options.choice
    )
    if (!input)
      throw new ResolutionInputError(
        'stale-target',
        'The selected card is no longer playable.'
      )
    const currentCost = input.currentCost
    if (definition.type === 'Minion' && player.board.length >= MAX_BOARD_SIZE)
      throw new ResolutionInputError('board-full', 'The board is full.')
    if (definition.keywords.includes('secret')) {
      if ((player.secrets ?? []).length >= 5)
        throw new ResolutionInputError('resolution-failed', 'The secret zone is full.')
      if ((player.secrets ?? []).some((secret) => secret.cardId === card.cardId))
        throw new ResolutionInputError(
          'resolution-failed',
          'A copy of that secret is already active.'
        )
    }
    if (currentCost > player.mana.available)
      throw new ResolutionInputError(
        'insufficient-mana',
        'Not enough mana to play that card.'
      )
    if (definition.type === 'Minion') {
      if (options.position === undefined)
        throw new ResolutionInputError(
          'missing-input',
          'A minion play requires a board position.'
        )
      if (!input.legalPositions.includes(options.position))
        throw new ResolutionInputError(
          'invalid-position',
          'The minion position is invalid.'
        )
    } else if (options.position !== undefined) {
      throw new ResolutionInputError(
        'extra-input',
        'Only minion plays accept a board position.'
      )
    }
    const selectors = input.targetSelectors
    const targets = options.targets ?? []
    if (
      new Set(
        targets.map(
          (target) =>
            `${target.kind}:${target.kind === 'hero' ? target.participantId : target.instanceId}`
        )
      ).size !== targets.length
    ) {
      throw new ResolutionInputError(
        'duplicate-target',
        'A target cannot be selected twice.'
      )
    }
    if (targets.length < selectors.length)
      throw new ResolutionInputError(
        'missing-input',
        'The card is missing one or more targets.'
      )
    if (targets.length > selectors.length)
      throw new ResolutionInputError(
        'extra-input',
        'The card received more targets than it requires.'
      )
    const source: EntityRef = {
      instanceId: card.instanceId,
      kind: 'card',
      participantId: options.participantId,
      zone: 'hand',
      cardId: card.cardId
    }
    const chosenTargets: EntityRef[] = []
    for (let index = 0; index < selectors.length; index += 1) {
      const requested = targets[index]
      if (!requested)
        throw new ResolutionInputError('missing-input', 'A target is missing.')
      const current = findRequestedTarget(this, requested)
      if (!current) {
        const requestedId =
          requested.kind === 'hero'
            ? `${requested.participantId}:hero`
            : requested.instanceId
        const located = this.findEntity(requestedId)
        if (located && located.participantId !== requested.participantId)
          throw new ResolutionInputError(
            'wrong-controller',
            'A selected target is controlled by the wrong participant.'
          )
        if (located)
          throw new ResolutionInputError(
            'wrong-zone',
            'A selected target is no longer in the required zone.'
          )
        throw new ResolutionInputError(
          'stale-target',
          'A selected target is no longer present.'
        )
      }
      const targetFrame = {
        ...this.frameFor(source, null, [current]),
        choiceIndex: options.choice
      }
      const expectedController = this.relativeController(
        asRecord(selectors[index]).controller,
        targetFrame
      )
      if (expectedController && expectedController !== current.participantId)
        throw new ResolutionInputError(
          'wrong-controller',
          'A selected target is controlled by the wrong participant.'
        )
      if (
        !this.select(selectors[index], targetFrame).some(
          (candidate) => entityKey(candidate) === entityKey(current)
        )
      ) {
        throw new ResolutionInputError(
          'illegal-target',
          'A selected target does not satisfy the card selector.'
        )
      }
      if (
        this.sourceIsSpell(targetFrame) &&
        (this.hasKeyword(current, 'immune') || this.hasKeyword(current, 'spell-immune'))
      ) {
        throw new ResolutionInputError(
          'immune-target',
          'The selected target is immune to this spell.'
        )
      }
      chosenTargets.push(current)
    }
    return { card, definition, source, chosenTargets, input }
  }

  private runCardBlocks(
    card: CardDefinition,
    trigger: CardTrigger,
    frame: EffectFrame,
    path: string,
    skipChoice = false
  ): void {
    const repetitions =
      trigger === 'battlecry' && frame.source.kind === 'minion'
        ? Math.max(
            1,
            Math.floor(
              this.currentMinion(frame.source)?.triggerMultipliers?.battlecry ?? 1
            )
          )
        : 1
    for (const [index, block] of card.effects.entries()) {
      if (block.trigger !== trigger || (skipChoice && block.choice)) continue
      for (let repetition = 0; repetition < repetitions; repetition += 1)
        this.runBlock(
          block,
          frame,
          `${path}.${trigger}[${index}].repeat[${repetition}]`
        )
    }
  }

  private emitCardPlayedSemantic(
    source: EntityRef,
    target: EntityRef,
    card: DraftCard,
    type: CardEventType,
    kind: SemanticEvent['kind'] = 'play',
    metadata: Pick<SemanticEvent, 'minionCountBeforePlay'> = {}
  ): SemanticEvent {
    return this.emitSemantic({
      type,
      source,
      target,
      controllerId: source.participantId,
      targetControllerId: target.participantId,
      cardId: card.cardId,
      cardInstanceId: card.instanceId,
      card,
      kind,
      ...metadata
    })
  }

  private resolutionFailure(error: unknown): EffectResolutionFailure {
    this.rng.restore(this.rngSnapshot)
    const diagnostic: ResolutionDiagnostic =
      error instanceof UnsupportedEffectCapabilityError
        ? {
            code: 'unsupported-capability',
            message: error.message,
            sourceCardId: error.report.cardId as CardId,
            actionPath: error.report.capabilities[0]?.path ?? 'resolution',
            recentQueue: this.resolutionQueue.recent
          }
        : error instanceof ResolutionBudgetError
          ? {
              code: 'resolution-budget-exhausted',
              message: error.message,
              sourceCardId: error.frame?.sourceCardId ?? null,
              actionPath: error.frame?.actionPath ?? 'resolution',
              recentQueue: this.resolutionQueue.recent
            }
          : {
              code: 'resolution-failed',
              message: error instanceof Error ? error.message : 'Resolution failed.',
              sourceCardId: this.activeFrame?.sourceCardId ?? null,
              actionPath:
                error instanceof ResolutionInputError ? error.actionPath : 'resolution',
              recentQueue: this.resolutionQueue.recent
            }
    const code =
      error instanceof ResolutionInputError
        ? error.code
        : error instanceof UnsupportedEffectCapabilityError
          ? 'unsupported-effect'
          : error instanceof ResolutionBudgetError
            ? 'resolution-budget-exhausted'
            : 'resolution-failed'
    return {
      accepted: false,
      code,
      message: diagnostic.message,
      // The draft is intentionally disposable. Returning a derived view of it
      // here would leak partially resolved state after an unexpected failure.
      // Return the same derived shape exposed by `getState()`, while deriving
      // from a fresh copy of the original state so no failed action can leak
      // draft mutations into the rollback result.
      state: new EffectRuntime(this.initialState).getDerivedState(),
      events: [],
      trace: [],
      nextEntityOrdinal: this.initialState.nextEntityOrdinal ?? this.nextEntityOrdinal,
      triggerEvents: [],
      diagnostic
    }
  }

  private commitResolution(): OpeningMatchState {
    this.step('checkpoint.commit', 'checkpoint')
    this.recomputeContinuousEffects()
    const nextState = clonePlain(this.draft) as unknown as DraftState
    nextState.revision = this.draft.revision + 1
    nextState.pendingResolution = false
    nextState.nextEntityOrdinal = this.nextEntityOrdinal
    if (this.recordTrace)
      nextState.effectTrace = [...(this.initialState.effectTrace ?? []), ...this.trace]
    else delete nextState.effectTrace
    const defeated = nextState.players.filter((player) => player.hero.health <= 0)
    if (defeated.length > 0) {
      if (defeated.length === nextState.players.length) {
        this.step('checkpoint.match-end', 'match-end')
        nextState.phase = 'ended'
        nextState.activePlayerId = null
        nextState.winnerId = null
        nextState.loserId = null
        this.events.push({
          type: 'match-ended',
          winnerId: null,
          loserId: null,
          reason: 'simultaneous-hero-lethal'
        })
      } else {
        const defeatedIds = new Set(defeated.map((player) => player.participantId))
        const winner =
          nextState.players.find((player) => !defeatedIds.has(player.participantId)) ??
          nextState.players.find(
            (player) => player.participantId === this.draft.activePlayerId
          )
        const loser =
          defeated.find((player) => player.participantId !== winner?.participantId) ??
          defeated[0]
        if (winner && loser) {
          this.step('checkpoint.match-end', 'match-end')
          nextState.phase = 'ended'
          nextState.activePlayerId = null
          nextState.winnerId = winner.participantId
          nextState.loserId = loser.participantId
          this.events.push({
            type: 'match-ended',
            winnerId: winner.participantId,
            loserId: loser.participantId,
            reason: 'hero-health-depleted'
          })
        }
      }
    }
    assertOpeningMatchInvariants(nextState as unknown as OpeningMatchState)
    return nextState as unknown as OpeningMatchState
  }

  private attackEntity(
    participantId: PlayerId,
    value: AttackCharacterRef,
    code: 'invalid-attacker' | 'invalid-target'
  ): EntityRef {
    const instanceId =
      value.kind === 'hero' ? `${participantId}:hero` : value.instanceId
    const entity = this.findEntity(instanceId, participantId)
    if (
      !entity ||
      entity.participantId !== participantId ||
      entity.kind !== value.kind ||
      (entity.kind === 'minion' && entity.zone !== 'board')
    ) {
      throw new ResolutionInputError(
        code,
        code === 'invalid-attacker'
          ? 'The selected attacker is not in play.'
          : 'The selected target is not in play.'
      )
    }
    return entity
  }

  private combatAttack(ref: EntityRef): number {
    if (ref.kind === 'hero') {
      const player = this.player(ref.participantId)
      return Math.max(0, player.hero.attack + (player.weapon?.attack ?? 0))
    }
    return Math.max(0, this.readAttack(ref))
  }

  private combatAttackLimit(ref: EntityRef): number {
    if (ref.kind === 'hero') {
      const hero = this.player(ref.participantId).hero
      const keywords = new Set(hero.keywords ?? [])
      return (
        hero.maxAttacksPerTurn ??
        (keywords.has('mega-windfury') ? 4 : keywords.has('windfury') ? 2 : 1)
      )
    }
    if (ref.kind === 'minion') {
      const minion = this.currentMinion(ref)
      if (!minion) return 0
      const keywords = effectiveBoardMinionKeywords(minion, this.draft.turnNumber)
      return (
        minion.maxAttacksPerTurn ??
        (keywords.includes('mega-windfury') ? 4 : keywords.includes('windfury') ? 2 : 1)
      )
    }
    return 0
  }

  private combatAttacksUsed(ref: EntityRef): number {
    if (ref.kind === 'hero') {
      const hero = this.player(ref.participantId).hero
      return (
        hero.attacksUsedThisTurn ??
        (hero.lastAttackedOnTurn === this.draft.turnNumber ? 1 : 0)
      )
    }
    if (ref.kind === 'minion') {
      const minion = this.currentMinion(ref)
      return minion ? boardMinionAttacksUsed(minion, this.draft.turnNumber) : 0
    }
    return 0
  }

  private combatCanAttack(ref: EntityRef): boolean {
    if (ref.kind !== 'hero' && ref.kind !== 'minion') return false
    if (
      this.combatAttack(ref) <= 0 ||
      this.combatAttacksUsed(ref) >= this.combatAttackLimit(ref)
    )
      return false
    if (this.hasKeyword(ref, 'cannot-attack') || this.isFrozen(ref)) return false
    if (ref.kind === 'minion') {
      const minion = this.currentMinion(ref)
      if (!minion || minion.health <= 0) return false
      if (
        !effectiveBoardMinionKeywords(minion, this.draft.turnNumber).includes(
          'charge'
        ) &&
        hasBoardMinionEntryExhaustion(minion, this.draft.turnNumber)
      )
        return false
    } else if (this.player(ref.participantId).hero.health <= 0) {
      return false
    }
    return true
  }

  private heroPowerUseLimit(participantId: PlayerId): number {
    const player = this.player(participantId)
    let limit = 1
    for (const minion of player.board) {
      if (minion.silenced) continue
      const definition = cardDefinition(minion.cardId)
      for (const block of definition?.effects ?? []) {
        if (block.trigger !== 'aura') continue
        for (const action of block.actions ?? []) {
          if (action.action !== 'modify-hero-power-uses') continue
          if (typeof action.heroPowerUsesPerTurn !== 'number') continue
          limit = Math.max(limit, Math.floor(action.heroPowerUsesPerTurn))
        }
      }
    }
    return limit
  }

  private heroPowerDamageBonus(participantId: PlayerId): number {
    return this.player(participantId).board.reduce((total, minion) => {
      if (minion.silenced) return total
      const bonus = (cardDefinition(minion.cardId)?.effects ?? [])
        .filter((block) => block.trigger === 'aura')
        .flatMap((block) => block.actions ?? [])
        .filter((action) => action.action === 'modify-hero-power-damage')
        .reduce(
          (sum, action) =>
            sum +
            (typeof action.heroPowerDamageBonus === 'number'
              ? action.heroPowerDamageBonus
              : 0),
          0
        )
      return total + bonus
    }, 0)
  }

  private heroPowerEquipAttackBonus(participantId: PlayerId): number | null {
    const weapon = this.player(participantId).weapon
    if (!weapon) return null
    const action = (cardDefinition(weapon.cardId)?.effects ?? [])
      .filter((block) => block.trigger === 'aura')
      .flatMap((block) => block.actions ?? [])
      .find((entry) => entry.action === 'modify-weapon-on-hero-power')
    return typeof action?.heroPowerEquipAttackBonus === 'number'
      ? action.heroPowerEquipAttackBonus
      : null
  }

  private heroDamageRedirect(participantId: PlayerId): EntityRef | null {
    const minion = this.player(participantId).board.find(
      (candidate) =>
        !candidate.silenced &&
        (cardDefinition(candidate.cardId)?.effects ?? []).some(
          (block) =>
            block.trigger === 'aura' &&
            (block.actions ?? []).some(
              (action) => action.action === 'redirect-hero-damage'
            )
        )
    )
    return minion
      ? {
          instanceId: minion.instanceId,
          kind: 'minion',
          participantId,
          zone: 'board',
          cardId: minion.cardId
        }
      : null
  }

  private heroPowerDrawCost(participantId: PlayerId): number | null {
    for (const minion of this.player(participantId).board) {
      if (minion.silenced) continue
      const action = (cardDefinition(minion.cardId)?.effects ?? [])
        .filter((block) => block.trigger === 'aura')
        .flatMap((block) => block.actions ?? [])
        .find((entry) => entry.action === 'set-hero-power-drawn-card-cost')
      if (typeof action?.cost === 'number') return action.cost
    }
    return null
  }

  private liveCombatTarget(ref: EntityRef): boolean {
    if (ref.kind === 'hero') return this.player(ref.participantId).hero.health > 0
    if (ref.kind !== 'minion') return false
    const minion = this.currentMinion(ref)
    return Boolean(
      minion &&
      minion.health > 0 &&
      (minion.controllerId ?? ref.participantId) === ref.participantId
    )
  }

  private combatResult(
    ref: EntityRef,
    character: AttackCharacterRef,
    attack: number,
    healthBefore: number,
    armorBefore: number,
    damageDealt: number,
    attemptedDamage: number,
    divineShieldConsumed: boolean
  ): CharacterCombatantResult {
    const player = this.player(ref.participantId)
    const minion = ref.kind === 'minion' ? this.currentMinion(ref) : null
    const healthAfter = ref.kind === 'hero' ? player.hero.health : (minion?.health ?? 0)
    const armorAfter = ref.kind === 'hero' ? player.hero.armor : 0
    return {
      participantId: ref.participantId,
      character,
      attack,
      damageDealt,
      attemptedDamage,
      healthBefore,
      healthAfter,
      armorBefore,
      armorAfter,
      destroyed: healthAfter <= 0,
      ...(divineShieldConsumed ? { divineShieldConsumed: true } : {})
    }
  }

  resolveAttack(options: AttackRuntimeOptions): EffectResolutionResult {
    try {
      if (this.draft.phase !== 'turns')
        throw new ResolutionInputError(
          'resolution-failed',
          'Turns have not started yet.'
        )
      if (this.draft.activePlayerId !== options.participantId)
        throw new ResolutionInputError(
          'wrong-controller',
          'Only the active participant can attack.'
        )
      const attacker = this.attackEntity(
        options.participantId,
        options.attacker,
        'invalid-attacker'
      )
      const defenderOwner = this.otherPlayer(options.participantId)
      const defender = this.attackEntity(
        defenderOwner,
        options.defender,
        'invalid-target'
      )
      if (!this.combatCanAttack(attacker)) {
        throw new ResolutionInputError(
          attacker.kind === 'hero' ? 'hero-cannot-attack' : 'minion-cannot-attack',
          'That character cannot attack right now.'
        )
      }
      if (!this.liveCombatTarget(defender) || this.hasKeyword(defender, 'stealth')) {
        throw new ResolutionInputError(
          'invalid-target',
          'The selected target cannot be attacked.'
        )
      }
      if (
        defender.kind === 'hero' &&
        this.hasKeyword(attacker, 'cannot-attack-heroes')
      )
        throw new ResolutionInputError(
          'invalid-target',
          'That character cannot attack heroes.'
        )
      const opposingMinions = this.player(defenderOwner).board.filter((minion) => {
        const ref: EntityRef = {
          instanceId: minion.instanceId,
          kind: 'minion',
          participantId: defenderOwner,
          zone: 'board',
          cardId: minion.cardId
        }
        return this.hasKeyword(ref, 'taunt') && !this.hasKeyword(ref, 'stealth')
      })
      if (
        opposingMinions.length > 0 &&
        !(
          defender.kind === 'minion' &&
          opposingMinions.some((minion) => minion.instanceId === defender.instanceId)
        )
      ) {
        throw new ResolutionInputError(
          'invalid-target',
          'A Taunt minion must be attacked first.'
        )
      }

      this.step('checkpoint.attack', 'checkpoint')
      const attackFrameSource =
        attacker.kind === 'hero' && this.player(attacker.participantId).weapon
          ? {
              instanceId: this.player(attacker.participantId).weapon!.instanceId,
              kind: 'weapon' as const,
              participantId: attacker.participantId,
              zone: 'weapon' as const,
              cardId: this.player(attacker.participantId).weapon!.cardId
            }
          : attacker
      const weaponBeforeAttack =
        attackFrameSource.kind === 'weapon'
          ? (clonePlain(this.player(attacker.participantId).weapon) as BoardWeapon)
          : null
      const attackEvent: Omit<SemanticEvent, 'sequence'> = {
        type: 'character-attacked',
        source: attacker,
        target: defender,
        controllerId: attacker.participantId,
        targetControllerId: defender.participantId
      }
      const resolvedAttack = this.emitSemantic(attackEvent)
      let actualDefender = resolvedAttack.redirectTarget ?? defender
      if (resolvedAttack.cancelled || !this.liveCombatTarget(attacker)) {
        this.processDeaths()
        const nextState = this.commitResolution()
        return {
          accepted: true,
          state: nextState,
          events: clonePlain(this.events) as OpeningMatchEvent[],
          trace: copyPlainArray(this.trace),
          nextEntityOrdinal: this.nextEntityOrdinal,
          triggerEvents: copyPlainArray(this.triggerEvents)
        }
      }
      if (actualDefender.kind === 'minion' && !this.liveCombatTarget(actualDefender))
        actualDefender = defender
      if (
        !this.liveCombatTarget(actualDefender) ||
        this.hasKeyword(actualDefender, 'stealth')
      ) {
        this.processDeaths()
        const nextState = this.commitResolution()
        return {
          accepted: true,
          state: nextState,
          events: clonePlain(this.events) as OpeningMatchEvent[],
          trace: copyPlainArray(this.trace),
          nextEntityOrdinal: this.nextEntityOrdinal,
          triggerEvents: copyPlainArray(this.triggerEvents)
        }
      }

      if (
        effectiveBoardMinionKeywords(
          attacker.kind === 'minion'
            ? this.currentMinion(attacker)!
            : {
                keywords: this.player(attacker.participantId).hero.keywords,
                enchantments: this.player(attacker.participantId).hero.enchantments
              },
          this.draft.turnNumber
        ).includes('attack-wrong-enemy-chance-50') &&
        this.rng.next() < 0.5
      ) {
        const candidates = [
          {
            instanceId: `${defenderOwner}:hero`,
            kind: 'hero' as const,
            participantId: defenderOwner,
            zone: 'hero' as const
          },
          ...this.player(defenderOwner).board.map((minion) => ({
            instanceId: minion.instanceId,
            kind: 'minion' as const,
            participantId: defenderOwner,
            zone: 'board' as const,
            cardId: minion.cardId
          }))
        ].filter(
          (candidate) =>
            this.liveCombatTarget(candidate) && !this.hasKeyword(candidate, 'stealth')
        )
        const alternatives = candidates.filter(
          (candidate) => entityKey(candidate) !== entityKey(actualDefender)
        )
        if (alternatives.length > 0)
          actualDefender =
            alternatives[Math.floor(this.rng.next() * alternatives.length)]!
      }

      const specificEvent = (
        type: CardEventType,
        target: EntityRef,
        targetControllerId: PlayerId
      ): void => {
        this.emitSemantic({
          type,
          source: attacker,
          target,
          controllerId: attacker.participantId,
          targetControllerId
        })
      }
      if (attacker.kind === 'minion')
        specificEvent('minion-attacked', attacker, attacker.participantId)
      if (actualDefender.kind === 'hero')
        specificEvent('hero-attacked', actualDefender, actualDefender.participantId)
      else
        specificEvent(
          'friendly-minion-attacked',
          actualDefender,
          actualDefender.participantId
        )
      if (attacker.kind === 'minion' && actualDefender.kind === 'hero')
        specificEvent('minion-attacks-hero', attacker, attacker.participantId)
      if (attacker.kind === 'minion' && actualDefender.kind === 'minion')
        specificEvent(
          'friendly-minion-attacked',
          actualDefender,
          actualDefender.participantId
        )
      if (!this.liveCombatTarget(attacker) || !this.liveCombatTarget(actualDefender)) {
        this.processDeaths()
        const nextState = this.commitResolution()
        return {
          accepted: true,
          state: nextState,
          events: clonePlain(this.events) as OpeningMatchEvent[],
          trace: copyPlainArray(this.trace),
          nextEntityOrdinal: this.nextEntityOrdinal,
          triggerEvents: copyPlainArray(this.triggerEvents)
        }
      }

      // A successful attack reveals a stealthed attacker before the combat
      // damage facts are dispatched.  The marker is derived again at commit,
      // so subsequent target legality sees the revealed state immediately.
      if (attacker.kind === 'minion') {
        const attackingMinion = this.currentMinion(attacker)
        if (attackingMinion?.stealth && !attackingMinion.stealthRevealed) {
          attackingMinion.stealthRevealed = true
          this.recomputeContinuousEffects()
        }
      }

      const attackerHealthBefore =
        attacker.kind === 'hero'
          ? this.player(attacker.participantId).hero.health
          : this.currentMinion(attacker)!.health
      const defenderHealthBefore =
        actualDefender.kind === 'hero'
          ? this.player(actualDefender.participantId).hero.health
          : this.currentMinion(actualDefender)!.health
      const attackerArmorBefore =
        attacker.kind === 'hero' ? this.player(attacker.participantId).hero.armor : 0
      const defenderArmorBefore =
        actualDefender.kind === 'hero'
          ? this.player(actualDefender.participantId).hero.armor
          : 0
      const attackerAttack = this.combatAttack(attacker)
      // Defending heroes do not retaliate, even while armed or otherwise having Attack.
      const defenderAttack =
        actualDefender.kind === 'hero' ? 0 : this.combatAttack(actualDefender)
      const attackerFrame = this.frameFor(attackFrameSource, resolvedAttack, [])
      const defenderFrameSource =
        actualDefender.kind === 'hero' &&
        this.player(actualDefender.participantId).weapon
          ? {
              instanceId: this.player(actualDefender.participantId).weapon!.instanceId,
              kind: 'weapon' as const,
              participantId: actualDefender.participantId,
              zone: 'weapon' as const,
              cardId: this.player(actualDefender.participantId).weapon!.cardId
            }
          : actualDefender
      const defenderFrame = this.frameFor(defenderFrameSource, resolvedAttack, [])
      const combatId = `${this.resolutionId}:combat:${this.combatSequence++}`
      const combatStarted: CombatStartedEvent = {
        type: 'combat-started',
        combatId,
        attacker: {
          participantId: attacker.participantId,
          character:
            attacker.kind === 'hero'
              ? { kind: 'hero' }
              : { kind: 'minion', instanceId: attacker.instanceId },
          attack: attackerAttack,
          healthBefore: attackerHealthBefore,
          armorBefore: attackerArmorBefore
        },
        defender: {
          participantId: actualDefender.participantId,
          character:
            actualDefender.kind === 'hero'
              ? { kind: 'hero' }
              : { kind: 'minion', instanceId: actualDefender.instanceId },
          attack: defenderAttack,
          healthBefore: defenderHealthBefore,
          armorBefore: defenderArmorBefore
        }
      }
      this.events.push(combatStarted)
      const defenderHadDivineShield =
        actualDefender.kind === 'minion' &&
        this.hasKeyword(actualDefender, 'divine-shield')
      const attackerHadDivineShield =
        attacker.kind === 'minion' && this.hasKeyword(attacker, 'divine-shield')
      const attackerAttemptedDamage = this.damageAmounts(
        actualDefender,
        attackerAttack,
        attackerFrame
      ).displayAmount
      const defenderAttemptedDamage = this.damageAmounts(
        attacker,
        defenderAttack,
        defenderFrame
      ).displayAmount
      const attackerDamage = this.applyDamage(
        actualDefender,
        attackerAttack,
        attackerFrame,
        'combat.attacker'
      )
      const defenderDivineShieldConsumed =
        defenderHadDivineShield && !this.hasKeyword(actualDefender, 'divine-shield')
      const defenderDamage = this.applyDamage(
        attacker,
        defenderAttack,
        defenderFrame,
        'combat.defender'
      )
      const attackerDivineShieldConsumed =
        attackerHadDivineShield && !this.hasKeyword(attacker, 'divine-shield')

      if (attacker.kind === 'minion') {
        const minion = this.currentMinion(attacker)
        if (minion) {
          minion.lastAttackedOnTurn = this.draft.turnNumber
          minion.attacksUsedThisTurn = this.combatAttacksUsed(attacker) + 1
        }
      } else {
        const hero = this.player(attacker.participantId).hero
        hero.lastAttackedOnTurn = this.draft.turnNumber
        hero.attacksUsedThisTurn = this.combatAttacksUsed(attacker) + 1
        const weapon = this.player(attacker.participantId).weapon
        if (weapon) {
          weapon.durability = Math.max(0, weapon.durability - 1)
          if (weapon.durability === 0)
            this.queueWeaponDeath({
              instanceId: weapon.instanceId,
              kind: 'weapon',
              participantId: attacker.participantId,
              zone: 'weapon',
              cardId: weapon.cardId
            })
        }
      }
      this.expireAttackEnchantments(attacker)
      this.processDeaths()
      const attackerResult = this.combatResult(
        attacker,
        options.attacker,
        attackerAttack,
        attackerHealthBefore,
        attackerArmorBefore,
        defenderDamage,
        defenderAttemptedDamage,
        attackerDivineShieldConsumed
      )
      const defenderResult = this.combatResult(
        actualDefender,
        actualDefender.kind === 'hero'
          ? { kind: 'hero' }
          : { kind: 'minion', instanceId: actualDefender.instanceId },
        defenderAttack,
        defenderHealthBefore,
        defenderArmorBefore,
        attackerDamage,
        attackerAttemptedDamage,
        defenderDivineShieldConsumed
      )
      if (
        options.legacyMinionEvent &&
        attacker.kind === 'minion' &&
        actualDefender.kind === 'minion'
      ) {
        this.events.push({
          type: 'minion-combat-resolved',
          combatId,
          attacker: {
            participantId: attacker.participantId,
            instanceId: attacker.instanceId,
            attack: attackerAttack,
            damageDealt: defenderDamage,
            attemptedDamage: defenderAttemptedDamage,
            healthBefore: attackerHealthBefore,
            healthAfter: attackerResult.healthAfter,
            destroyed: attackerResult.destroyed,
            ...(attackerResult.divineShieldConsumed
              ? { divineShieldConsumed: true }
              : {})
          },
          defender: {
            participantId: actualDefender.participantId,
            instanceId: actualDefender.instanceId,
            attack: defenderAttack,
            damageDealt: attackerDamage,
            attemptedDamage: attackerAttemptedDamage,
            healthBefore: defenderHealthBefore,
            healthAfter: defenderResult.healthAfter,
            destroyed: defenderResult.destroyed,
            ...(defenderResult.divineShieldConsumed
              ? { divineShieldConsumed: true }
              : {})
          }
        })
      } else {
        this.events.push({
          type: 'character-combat-resolved',
          combatId,
          attacker: attackerResult,
          defender: defenderResult,
          weapon: weaponBeforeAttack
            ? {
                participantId: attacker.participantId,
                durabilityBefore: weaponBeforeAttack.durability,
                durabilityAfter:
                  this.player(attacker.participantId).weapon?.durability ?? 0,
                destroyed: this.player(attacker.participantId).weapon === null
              }
            : null
        })
      }
      const nextState = this.commitResolution()
      return {
        accepted: true,
        state: nextState,
        events: clonePlain(this.events) as OpeningMatchEvent[],
        trace: copyPlainArray(this.trace),
        nextEntityOrdinal: this.nextEntityOrdinal,
        triggerEvents: copyPlainArray(this.triggerEvents)
      }
    } catch (error) {
      return this.resolutionFailure(error)
    }
  }

  private expireAttackEnchantments(ref: EntityRef): void {
    const remove = (
      enchantments: readonly RuntimeEnchantment[] | undefined
    ): readonly RuntimeEnchantment[] | undefined => {
      if (!enchantments) return enchantments
      const kept = enchantments.filter(
        (enchantment) => enchantment.duration !== 'this-attack'
      )
      return kept.length === enchantments.length ? enchantments : kept
    }
    if (ref.kind === 'minion') {
      const minion = this.currentMinion(ref)
      if (minion)
        minion.enchantments = remove(minion.enchantments) as DraftMinion['enchantments']
    } else if (ref.kind === 'hero') {
      const hero = this.player(ref.participantId).hero
      hero.enchantments = remove(
        hero.enchantments
      ) as Mutable<PlayerHeroState>['enchantments']
    } else if (ref.kind === 'weapon') {
      const weapon = this.player(ref.participantId).weapon
      if (weapon)
        weapon.enchantments = remove(
          weapon.enchantments
        ) as Mutable<BoardWeapon>['enchantments']
    }
  }

  resolveHeroPower(options: HeroPowerRuntimeOptions): EffectResolutionResult {
    try {
      if (this.draft.phase !== 'turns')
        throw new ResolutionInputError(
          'resolution-failed',
          'Turns have not started yet.'
        )
      if (this.draft.activePlayerId !== options.participantId)
        throw new ResolutionInputError(
          'wrong-controller',
          'Only the active participant can use a hero power.'
        )
      const player = this.player(options.participantId)
      if (
        !player.heroPower.available ||
        (player.heroPower.usesThisTurn ?? 0) >=
          this.heroPowerUseLimit(options.participantId)
      )
        throw new ResolutionInputError(
          'hero-power-unavailable',
          'The hero power is not available.'
        )
      const power = HERO_POWER_CATALOG.require(player.heroPower.id)
      const effectiveTargeting = player.heroPower.targetingGranted ?? power.targeting
      if (effectiveTargeting === 'none' && options.target)
        throw new ResolutionInputError(
          'extra-input',
          'This hero power does not accept a target.'
        )
      if (effectiveTargeting !== 'none' && !options.target)
        throw new ResolutionInputError(
          'invalid-target',
          'This hero power requires a target.'
        )
      let target: EntityRef | null = null
      if (options.target) {
        target = this.findEntity(
          options.target.kind === 'hero'
            ? `${options.target.participantId}:hero`
            : options.target.instanceId,
          options.target.participantId
        )
        if (
          !target ||
          target.kind !== options.target.kind ||
          target.participantId !== options.target.participantId ||
          !this.liveCombatTarget(target)
        ) {
          throw new ResolutionInputError(
            'stale-target',
            'The selected hero power target is no longer in play.'
          )
        }
        if (
          effectiveTargeting === 'any-character' &&
          target.kind !== 'hero' &&
          target.kind !== 'minion'
        )
          throw new ResolutionInputError(
            'invalid-target',
            'The selected target is not a character.'
          )
        if (effectiveTargeting === 'minion' && target.kind !== 'minion')
          throw new ResolutionInputError(
            'invalid-target',
            'The selected target is not a minion.'
          )
        if (
          this.hasKeyword(target, 'immune') ||
          this.hasKeyword(target, 'spell-immune')
        )
          throw new ResolutionInputError(
            'immune-target',
            'The selected target is immune.'
          )
      }
      if (
        (power.effect.kind === 'summon' ||
          power.effect.kind === 'summon-random-totem') &&
        player.board.length >= MAX_BOARD_SIZE
      )
        throw new ResolutionInputError('board-full', 'The board is full.')
      if (power.effect.kind === 'summon-random-totem') {
        const available = power.effect.cardIds.filter(
          (cardId) => !player.board.some((minion) => minion.cardId === cardId)
        )
        if (available.length === 0)
          throw new ResolutionInputError(
            'hero-power-unavailable',
            'All basic Totems are already in play.'
          )
      }
      const cost = player.heroPower.cost
      if (cost > player.mana.available)
        throw new ResolutionInputError(
          'insufficient-mana',
          'Not enough mana to use the hero power.'
        )
      this.step('checkpoint.hero-power', 'checkpoint')
      const source: EntityRef = {
        instanceId: `${options.participantId}:hero`,
        kind: 'hero',
        participantId: options.participantId,
        zone: 'hero'
      }
      const heroBefore = { ...player.hero }
      const weaponBefore = player.weapon
        ? (clonePlain(player.weapon) as BoardWeapon)
        : null
      const boardBefore = new Set(player.board.map((minion) => minion.instanceId))
      player.mana.available -= cost
      const usesThisTurn = (player.heroPower.usesThisTurn ?? 0) + 1
      player.heroPower.usesThisTurn = usesThisTurn
      player.heroPower.available =
        usesThisTurn < this.heroPowerUseLimit(options.participantId)
      this.historyUpdate((history) => {
        history.heroPowersUsedByPlayer = {
          ...history.heroPowersUsedByPlayer,
          [options.participantId]:
            (history.heroPowersUsedByPlayer[options.participantId] ?? 0) + 1
        }
      })
      const remainingPowerEnchantments = (player.heroPower.enchantments ?? []).filter(
        (enchantment) => !enchantment.consumeOnHeroPowerUse
      )
      if (remainingPowerEnchantments.length !== (player.heroPower.enchantments ?? []).length) {
        player.heroPower.enchantments = remainingPowerEnchantments
        player.heroPower.cost = Math.max(
          0,
          (player.heroPower.baseCost ?? power.cost) +
            remainingPowerEnchantments.reduce(
              (total, enchantment) => total + (enchantment.costDelta ?? 0),
              0
            )
        )
      }
      this.events.push({
        type: 'hero-power-used',
        participantId: options.participantId,
        heroPowerId: power.id,
        ...(options.target ? { target: options.target } : {}),
        cost,
        mana: { ...player.mana }
      })
      const frame = {
        ...this.frameFor(source, null, target ? [target] : []),
        isHeroPower: true
      }
      const selected = { type: target?.kind ?? 'hero', selection: 'chosen' }
      const runHeroPowerAction = (action: unknown, path: string): void => {
        this.executeQueued(
          path,
          () => {
            this.runAction(action, frame, path)
            this.processDeaths()
          },
          'action'
        )
      }
      const effect =
        player.heroPower.effectOverride?.damage !== undefined
          ? {
              kind: 'damage-character' as const,
              amount: player.heroPower.effectOverride.damage
            }
          : power.effect
      const heroPowerDamageBonus = this.heroPowerDamageBonus(options.participantId)
      const reportedTarget =
        target ??
        (effect.kind === 'damage-enemy-hero'
          ? {
              instanceId: `${this.otherPlayer(options.participantId)}:hero`,
              kind: 'hero' as const,
              participantId: this.otherPlayer(options.participantId),
              zone: 'hero' as const
            }
          : effect.kind === 'draw-and-self-damage'
            ? {
                instanceId: `${options.participantId}:hero`,
                kind: 'hero' as const,
                participantId: options.participantId,
                zone: 'hero' as const
              }
            : null)
      const reportedBefore = reportedTarget
        ? {
            health:
              reportedTarget.kind === 'hero'
                ? this.player(reportedTarget.participantId).hero.health
                : (this.currentMinion(reportedTarget)?.health ?? 0),
            armor:
              reportedTarget.kind === 'hero'
                ? this.player(reportedTarget.participantId).hero.armor
                : 0
          }
        : null
      switch (effect.kind) {
        case 'gain-attack-and-armor':
          runHeroPowerAction(
            {
              action: 'modify',
              target: { type: 'hero', selection: 'source' },
              attack: effect.attack,
              duration: 'this-turn'
            },
            'hero-power.modify'
          )
          runHeroPowerAction(
            {
              action: 'gain-armor',
              target: { type: 'hero', selection: 'source' },
              amount: effect.armor
            },
            'hero-power.armor'
          )
          break
        case 'gain-armor':
          runHeroPowerAction(
            {
              action: 'gain-armor',
              target: { type: 'hero', selection: 'source' },
              amount: effect.amount + heroPowerDamageBonus
            },
            'hero-power.armor'
          )
          break
        case 'damage-enemy-hero':
          runHeroPowerAction(
            {
              action: 'damage',
              target: target
                ? selected
                : { controller: 'opponent', type: 'hero', selection: 'all' },
              amount: effect.amount
            },
            'hero-power.damage'
          )
          break
        case 'damage-character':
          runHeroPowerAction(
            {
              action: 'damage',
              target: selected,
              amount: effect.amount + heroPowerDamageBonus
            },
            'hero-power.damage'
          )
          break
        case 'damage-random-enemy':
          runHeroPowerAction(
            {
              action: 'damage',
              target: {
                controller: 'opponent',
                type: 'character',
                selection: 'random'
              },
              amount: effect.amount + heroPowerDamageBonus
            },
            'hero-power.random-damage'
          )
          break
        case 'restore-character':
          runHeroPowerAction(
            { action: 'restore', target: selected, amount: effect.amount },
            'hero-power.restore'
          )
          break
        case 'summon':
          runHeroPowerAction(
            { action: 'summon', cardId: effect.cardId, count: effect.count ?? 1 },
            'hero-power.summon'
          )
          break
        case 'summon-random-totem':
          runHeroPowerAction(
            {
              action: 'summon-random',
              pool: effect.cardIds.filter(
                (cardId) => !player.board.some((minion) => minion.cardId === cardId)
              ),
              count: 1
            },
            'hero-power.summon'
          )
          break
        case 'equip-weapon': {
          const bonus = this.heroPowerEquipAttackBonus(options.participantId)
          if (bonus !== null)
            runHeroPowerAction(
              {
                action: 'modify',
                target: { type: 'weapon', controller: 'self', selection: 'all' },
                attack: bonus
              },
              'hero-power.equip-replacement'
            )
          else
            runHeroPowerAction(
              { action: 'equip', cardId: effect.cardId },
              'hero-power.equip'
            )
          break
        }
        case 'draw-and-self-damage': {
          // Life Tap's displayed text starts with drawing, but Hearthstone
          // resolves its self-damage (and any resulting damage triggers)
          // before it performs the draw.
          const healthBefore = player.hero.health
          const armorBefore = player.hero.armor
          const attemptedAmount = this.damageAmounts(
            source,
            effect.amount,
            frame
          ).displayAmount
          runHeroPowerAction(
            {
              action: 'damage',
              target: { type: 'hero', selection: 'source' },
              amount: effect.amount
            },
            'hero-power.damage'
          )
          const healthAfter = player.hero.health
          const armorAfter = player.hero.armor
          this.events.push({
            type: 'character-damaged',
            source: 'hero-power',
            participantId: player.participantId,
            character: { kind: 'hero' },
            amount:
              Math.max(0, healthBefore - healthAfter) +
              Math.max(0, armorBefore - armorAfter),
            attemptedAmount,
            healthBefore,
            healthAfter,
            armorBefore,
            armorAfter,
            destroyed: healthAfter <= 0
          })
          runHeroPowerAction(
            {
              action: 'draw',
              player: 'self',
              count: effect.count,
              ...(this.heroPowerDrawCost(options.participantId) !== null
                ? {
                    modifyDrawnCard: {
                      setCost: this.heroPowerDrawCost(options.participantId)
                    }
                  }
                : {})
            },
            'hero-power.draw'
          )
          break
        }
      }
      this.processDeaths()
      this.emitSemantic({
        type: 'hero-power-used',
        source: {
          instanceId: `${options.participantId}:hero-power`,
          kind: 'hero-power',
          participantId: options.participantId,
          zone: 'hero-power'
        },
        target: {
          instanceId: `${options.participantId}:hero`,
          kind: 'hero',
          participantId: options.participantId,
          zone: 'hero'
        },
        controllerId: options.participantId,
        targetControllerId: options.participantId,
        amount: cost
      })
      this.processDeaths()
      if (player.hero.armor !== heroBefore.armor) {
        this.events.push({
          type: 'armor-gained',
          participantId: player.participantId,
          amount: player.hero.armor - heroBefore.armor,
          armorBefore: heroBefore.armor,
          armorAfter: player.hero.armor
        })
      }
      if (
        reportedTarget &&
        reportedBefore &&
        (effect.kind === 'damage-character' ||
          effect.kind === 'damage-enemy-hero' ||
          effect.kind === 'restore-character')
      ) {
        const currentTarget =
          reportedTarget.kind === 'hero'
            ? this.player(reportedTarget.participantId).hero
            : this.currentMinion(reportedTarget)
        const healthAfter = currentTarget?.health ?? 0
        const armorAfter =
          reportedTarget.kind === 'hero'
            ? this.player(reportedTarget.participantId).hero.armor
            : 0
        const amount =
          effect.kind === 'restore-character'
            ? Math.max(0, healthAfter - reportedBefore.health)
            : Math.max(0, reportedBefore.health - healthAfter) +
              Math.max(0, reportedBefore.armor - armorAfter)
        const attemptedAmount =
          effect.kind === 'restore-character'
            ? Math.max(
                0,
                integer(
                  effect.amount *
                    this.effectMultiplier(frame.controllerId, 'heroPowerMultiplier')
                )
              )
            : this.damageAmounts(reportedTarget, effect.amount, frame).displayAmount
        this.events.push(
          effect.kind === 'restore-character'
            ? {
                type: 'character-healed',
                participantId: reportedTarget.participantId,
                character:
                  reportedTarget.kind === 'hero'
                    ? { kind: 'hero' }
                    : { kind: 'minion', instanceId: reportedTarget.instanceId },
                amount,
                attemptedAmount,
                healthBefore: reportedBefore.health,
                healthAfter
              }
            : {
                type: 'character-damaged',
                source: 'hero-power',
                participantId: reportedTarget.participantId,
                character:
                  reportedTarget.kind === 'hero'
                    ? { kind: 'hero' }
                    : { kind: 'minion', instanceId: reportedTarget.instanceId },
                amount,
                attemptedAmount,
                healthBefore: reportedBefore.health,
                healthAfter,
                armorBefore: reportedBefore.armor,
                armorAfter,
                destroyed: healthAfter <= 0
              }
        )
      }
      const summoned = player.board.filter(
        (minion) => !boardBefore.has(minion.instanceId)
      )
      for (const minion of summoned)
        this.events.push({
          type: 'hero-power-minion-summoned',
          participantId: player.participantId,
          minion: clonePlain(minion) as BoardMinion,
          position: player.board.findIndex(
            (candidate) => candidate.instanceId === minion.instanceId
          )
        })
      if (effect.kind === 'equip-weapon' && player.weapon) {
        this.events.push({
          type: 'weapon-equipped',
          participantId: player.participantId,
          weapon: clonePlain(player.weapon) as BoardWeapon,
          replacedWeapon: weaponBefore
        })
      }
      const nextState = this.commitResolution()
      return {
        accepted: true,
        state: nextState,
        events: clonePlain(this.events).filter(
          (event) => event.type !== 'effect-resolved'
        ) as OpeningMatchEvent[],
        trace: copyPlainArray(this.trace),
        nextEntityOrdinal: this.nextEntityOrdinal,
        triggerEvents: copyPlainArray(this.triggerEvents)
      }
    } catch (error) {
      return this.resolutionFailure(error)
    }
  }

  private scheduledSource(schedule: ScheduledEffect): EntityRef {
    if (schedule.source) {
      return {
        ...this.fromPersistentReference(schedule.source),
        cardId:
          schedule.sourceCardId ?? this.fromPersistentReference(schedule.source).cardId
      }
    }
    const current = this.findEntity(schedule.sourceInstanceId, schedule.controllerId)
    if (current) return current
    const definition = schedule.sourceCardId
      ? cardDefinition(schedule.sourceCardId)
      : undefined
    const kind: RuntimeEntityKind =
      definition?.type === 'Minion'
        ? 'minion'
        : definition?.type === 'Weapon'
          ? 'weapon'
          : 'card'
    const zone: RuntimeZone =
      kind === 'minion' ? 'graveyard' : kind === 'weapon' ? 'weapon' : 'revealed'
    return {
      instanceId: schedule.sourceInstanceId,
      kind,
      participantId: schedule.controllerId,
      zone,
      ...(schedule.sourceCardId ? { cardId: schedule.sourceCardId } : {})
    }
  }

  private scheduledTarget(schedule: ScheduledEffect): EntityRef | null {
    return schedule.target ? this.fromPersistentReference(schedule.target) : null
  }

  private runScheduledEffects(
    trigger: 'start-of-turn' | 'end-of-turn',
    turnNumber: number
  ): void {
    const due = (this.draft.scheduledEffects ?? []).filter(
      (schedule) =>
        schedule.executeOnTurn === turnNumber && schedule.trigger === trigger
    )
    if (due.length === 0) return
    this.step(`checkpoint.expiration:${trigger}:${turnNumber}`, 'expiration')
    const dueIds = new Set(due.map((schedule) => schedule.id))
    this.draft.scheduledEffects = (this.draft.scheduledEffects ?? []).filter(
      (schedule) => !dueIds.has(schedule.id)
    ) as unknown as DraftState['scheduledEffects']
    for (const schedule of due) {
      const queueSequence = this.step('expiration.' + schedule.id, 'expiration')
      const source = this.scheduledSource(schedule)
      const target = this.scheduledTarget(schedule)
      const event: SemanticEvent = {
        sequence: this.semanticSequence++,
        type: 'card-played',
        source,
        target,
        controllerId: schedule.controllerId,
        ...(target ? { targetControllerId: target.participantId } : {}),
        kind: trigger === 'start-of-turn' ? 'turn-start' : 'turn-end',
        correlation: this.correlationFor(queueSequence)
      }
      const frame = this.frameFor(source, event, target ? [target] : [])
      this.runActions(schedule.actions, frame, `scheduled.${schedule.id}`)
    }
  }

  private runAttachedEffects(
    trigger: 'start-of-turn' | 'end-of-turn',
    turnNumber: number
  ): void {
    const active = this.draft.activePlayerId
    const playerOrder = active
      ? [this.playerIndex(active), this.playerIndex(active) === 0 ? 1 : 0]
      : [0, 1]
    const due: { readonly host: EntityRef; readonly effect: RuntimeAttachedEffect }[] =
      []

    for (const playerIndex of playerOrder) {
      const player = this.draft.players[playerIndex]
      for (const minion of player.board) {
        const matching = (minion.attachedEffects ?? []).filter(
          (effect) => effect.trigger === trigger && effect.executeOnTurn === turnNumber
        )
        if (matching.length === 0) continue
        const dueIds = new Set(matching.map((effect) => effect.id))
        minion.attachedEffects = (minion.attachedEffects ?? []).filter(
          (effect) => !dueIds.has(effect.id)
        ) as DraftMinion['attachedEffects']
        const host: EntityRef = {
          instanceId: minion.instanceId,
          kind: 'minion',
          participantId: player.participantId,
          zone: 'board',
          cardId: minion.cardId
        }
        for (const effect of matching) due.push({ host, effect })
      }
    }

    if (due.length === 0) return
    this.step(`checkpoint.attached-effects:${trigger}:${turnNumber}`, 'expiration')
    for (const { host, effect } of due) {
      const queueSequence = this.step('attached-effect.' + effect.id, 'expiration')
      const current = this.findEntity(host.instanceId, host.participantId)
      const source = current?.kind === 'minion' ? current : host
      const event: SemanticEvent = {
        sequence: this.semanticSequence++,
        type: 'card-played',
        source,
        target: source,
        controllerId: effect.controllerId,
        targetControllerId: source.participantId,
        kind: trigger === 'start-of-turn' ? 'turn-start' : 'turn-end',
        correlation: this.correlationFor(queueSequence)
      }
      const frame: EffectFrame = {
        ...this.frameFor(source, event, [source]),
        sourceCardId: effect.sourceCardId,
        controllerId: effect.controllerId
      }
      this.runActions(effect.actions, frame, `attached.${effect.id}`)
    }
  }

  private resetTurnHistory(): void {
    const history = historyOf(this.draft)
    history.cardsPlayedThisTurn = []
    history.cardsCastThisTurn = []
    history.cardsDrawnThisTurn = []
    history.minionsSummonedThisTurn = []
    history.minionsDiedThisTurn = []
    history.damageDealtThisTurn = 0
    history.damageTakenThisTurn = 0
    history.healingThisTurn = 0
    history.armorGainedThisTurn = 0
    this.draft.history = history
  }

  private prepareNextTurn(player: DraftPlayer): void {
    const maximum = Math.min(MAX_MANA, player.mana.maximum + 1)
    const locked = Math.max(0, Math.min(maximum, player.mana.overloadNextTurn ?? 0))
    player.mana = {
      available: Math.max(0, maximum - locked),
      maximum,
      temporary: 0,
      overloadLocked: locked,
      overloadNextTurn: 0
    }
    player.overload = locked
    player.heroPower.usesThisTurn = 0
    player.heroPower.available = true
    player.hero.attacksUsedThisTurn = 0
    for (const minion of player.board) minion.attacksUsedThisTurn = 0
  }

  private returnTemporaryControlledMinion(
    minion: DraftMinion,
    currentPlayer: DraftPlayer,
    controlEnchantment: RuntimeEnchantment,
    path: string
  ): EntityRef {
    minion.enchantments = (minion.enchantments ?? []).filter(
      (enchantment) => enchantment.id !== controlEnchantment.id
    )
    const returningPlayerId = controlEnchantment.returnControllerId
    const currentRef: EntityRef = {
      instanceId: minion.instanceId,
      kind: 'minion',
      participantId: currentPlayer.participantId,
      zone: 'board',
      cardId: minion.cardId
    }
    if (!returningPlayerId || currentPlayer.participantId === returningPlayerId)
      return currentRef

    const returningPlayer = this.player(returningPlayerId)
    if (returningPlayer.board.length >= MAX_BOARD_SIZE) {
      this.directDestroy(
        currentRef,
        this.frameFor(currentRef, null, []),
        `${path}.board-full`
      )
      return currentRef
    }

    const moved = this.takeBoardMinion(currentPlayer, minion.instanceId)
    if (!moved) return currentRef
    moved.minion.controllerId = returningPlayerId
    moved.minion.controllerChangedOnTurn = this.draft.turnNumber
    this.insertBoardMinion(returningPlayer, moved.minion)
    const returnedRef: EntityRef = {
      ...currentRef,
      participantId: returningPlayerId
    }
    this.emit(this.frameFor(returnedRef, null, []), 'return-control', path, {
      target: minion.instanceId,
      controllerId: returningPlayerId
    })
    return returnedRef
  }

  private returnTemporaryControl(path: string): void {
    const candidates = this.draft.players.flatMap((player) =>
      player.board.flatMap((minion) => {
        const controlEnchantment = (minion.enchantments ?? []).find(
          (enchantment) =>
            enchantment.returnControllerId !== undefined &&
            (enchantment.expiresOnTurn ?? this.draft.turnNumber) <=
              this.draft.turnNumber
        )
        return controlEnchantment
          ? [
              {
                minion: minion as DraftMinion,
                currentPlayer: player,
                controlEnchantment
              }
            ]
          : []
      })
    )
    for (const { minion, currentPlayer, controlEnchantment } of candidates) {
      if (minion.health <= 0) continue
      this.returnTemporaryControlledMinion(
        minion,
        currentPlayer,
        controlEnchantment,
        path
      )
    }
    this.recomputeContinuousEffects()
  }

  /** Resolves the complete end/start turn boundary as one atomic command. */
  resolveTurnTransition(options: TurnTransitionRuntimeOptions): EffectResolutionResult {
    try {
      if (this.draft.phase !== 'turns')
        throw new ResolutionInputError(
          'resolution-failed',
          'Turns have not started yet.'
        )
      if (this.draft.activePlayerId !== options.participantId)
        throw new ResolutionInputError(
          'wrong-controller',
          'Only the active participant can end the turn.'
        )
      const endingPlayer = this.player(options.participantId)
      this.step('checkpoint.turn-end', 'checkpoint')
      const endingHero: EntityRef = {
        instanceId: `${options.participantId}:hero`,
        kind: 'hero',
        participantId: options.participantId,
        zone: 'hero'
      }
      this.emitSemantic({
        type: 'turn-ended',
        source: endingHero,
        target: endingHero,
        controllerId: options.participantId,
        targetControllerId: options.participantId,
        kind: 'turn-end'
      })
      this.runScheduledEffects('end-of-turn', this.draft.turnNumber)
      this.runAttachedEffects('end-of-turn', this.draft.turnNumber)
      this.processDeaths()
      this.returnTemporaryControl('turn-end.return-control')
      this.processDeaths()
      if (this.draft.players.some((player) => player.hero.health <= 0)) {
        const nextState = this.commitResolution()
        return {
          accepted: true,
          state: nextState,
          events: clonePlain(this.events) as OpeningMatchEvent[],
          trace: copyPlainArray(this.trace),
          nextEntityOrdinal: this.nextEntityOrdinal,
          triggerEvents: copyPlainArray(this.triggerEvents)
        }
      }

      endingPlayer.hero.attack = 0
      endingPlayer.hero.attacksUsedThisTurn = 0
      const nextPlayer = this.player(this.otherPlayer(options.participantId))
      const nextTurnNumber = this.draft.turnNumber + 1
      this.draft.turnNumber = nextTurnNumber
      this.draft.activePlayerId = nextPlayer.participantId
      this.prepareNextTurn(nextPlayer)
      this.resetTurnHistory()
      this.draft.turnStartedAtRevision = this.draft.revision + 1
      this.events.push({
        type: 'turn-started',
        participantId: nextPlayer.participantId,
        turnNumber: nextTurnNumber,
        mana: { ...nextPlayer.mana }
      })
      this.step('checkpoint.turn-start', 'checkpoint')
      const nextHero: EntityRef = {
        instanceId: `${nextPlayer.participantId}:hero`,
        kind: 'hero',
        participantId: nextPlayer.participantId,
        zone: 'hero'
      }
      this.emitSemantic({
        type: 'turn-started',
        source: nextHero,
        target: nextHero,
        controllerId: nextPlayer.participantId,
        targetControllerId: nextPlayer.participantId,
        kind: 'turn-start'
      })
      this.runScheduledEffects('start-of-turn', nextTurnNumber)
      this.runAttachedEffects('start-of-turn', nextTurnNumber)
      this.processDeaths()
      if (this.draft.players.every((player) => player.hero.health > 0)) {
        const drawFrame = this.frameFor(nextHero, null, [])
        this.drawOne(nextPlayer.participantId, drawFrame, 'turn-start.draw')
        this.processDeaths()
      }
      const nextState = this.commitResolution()
      return {
        accepted: true,
        state: nextState,
        events: clonePlain(this.events) as OpeningMatchEvent[],
        trace: copyPlainArray(this.trace),
        nextEntityOrdinal: this.nextEntityOrdinal,
        triggerEvents: copyPlainArray(this.triggerEvents)
      }
    } catch (error) {
      return this.resolutionFailure(error)
    }
  }

  /** Returns a cloned snapshot with continuous effects derived, without advancing revision or IDs. */
  getDerivedState(): OpeningMatchState {
    const snapshot = clonePlain(this.draft) as DraftState
    snapshot.revision = this.initialState.revision
    snapshot.pendingResolution = this.initialState.pendingResolution ?? false
    snapshot.nextEntityOrdinal = this.initialState.nextEntityOrdinal
    if (this.initialState.effectTrace !== undefined)
      snapshot.effectTrace = clonePlain(
        this.initialState.effectTrace
      ) as unknown as DraftState['effectTrace']
    else delete snapshot.effectTrace
    return snapshot as unknown as OpeningMatchState
  }

  private resolveValidatedPlay(
    options: EffectRuntimeOptions,
    validated: ReturnType<EffectRuntime['validatePlayInput']>
  ): void {
    const player = this.player(options.participantId)
    const handIndex = player.hand.findIndex(
      (card) => card.instanceId === options.cardInstanceId
    )
    if (handIndex < 0)
      throw new ResolutionInputError(
        'stale-target',
        'The selected card is no longer in the player hand.'
      )
    const card = this.removeCard({
      instanceId: options.cardInstanceId,
      kind: 'card',
      participantId: options.participantId,
      zone: 'hand',
      cardId: validated.card.cardId
    })
    if (!card)
      throw new ResolutionInputError(
        'stale-target',
        'The selected card is no longer in the player hand.'
      )
    card.zone = 'discarded'
    if (
      validated.definition.type === 'Spell' &&
      !validated.definition.keywords.includes('secret')
    ) {
      this.addToDiscardedCards(player, card)
    }
    player.mana.available -= validated.input.currentCost
    this.consumePendingCostModifiers(
      validated.card,
      options.participantId,
      this.frameFor(validated.source, null, [])
    )
    this.historyUpdate((history) => {
      history.cardsPlayedThisTurn = [...history.cardsPlayedThisTurn, card.cardId]
      history.cardsPlayedThisGame = [...history.cardsPlayedThisGame, card.cardId]
      if (validated.definition.type === 'Spell')
        history.cardsCastThisTurn = [...history.cardsCastThisTurn, card.cardId]
    })
    let frame = {
      ...this.frameFor(validated.source, null, validated.chosenTargets),
      choiceIndex: options.choice
    }
    if (validated.definition.type === 'Minion') {
      const minionCountBeforePlay = player.board.length
      const summonFrame = frame
      const minion = this.createMinion(
        options.participantId,
        card.cardId,
        frame,
        'play-card.summon',
        card.instanceId,
        options.position,
        undefined,
        card,
        true
      )
      if (!minion) throw new ResolutionInputError('board-full', 'The board is full.')
      // Continuous auras begin applying as soon as the minion enters play,
      // before its Battlecry resolves (for example Brann Bronzebeard).
      this.recomputeContinuousEffects()
      frame = {
        ...this.frameFor(minion, null, validated.chosenTargets),
        choiceIndex: options.choice
      }
      const playedMinionsThisTurn = (this.draft.history?.cardsPlayedThisTurn ?? [])
        .map((cardId) => cardDefinition(cardId as CardId))
        .filter((definition) => definition?.type === 'Minion').length
      if (playedMinionsThisTurn === 1) {
        this.emitCardPlayedSemantic(
          minion,
          minion,
          card,
          'first-minion-played-this-turn'
        )
      }
      this.emitCardPlayedSemantic(minion, minion, card, 'card-played', 'play', {
        minionCountBeforePlay
      })
      this.runCardBlocks(validated.definition, 'on-play', frame, 'play-card')
      if (!validated.input.skipTargetedBattlecry)
        this.runCardBlocks(
          validated.definition,
          'battlecry',
          frame,
          'play-card',
          options.deferChoice === true
        )
      if (this.currentMinion(minion))
        this.emitCardPlayedSemantic(minion, minion, card, 'minion-played', 'play', {
          minionCountBeforePlay
        })
      if (this.currentMinion(minion)) {
        this.events.push({
          type: 'minion-summoned',
          participantId: options.participantId,
          minion: clonePlain(this.currentMinion(minion)!) as BoardMinion,
          position: player.board.findIndex(
            (candidate) => candidate.instanceId === card.instanceId
          )
        } satisfies MinionSummonedEvent)
        this.emitMinionSummoned(
          summonFrame,
          minion,
          options.participantId,
          card.cardId,
          card.instanceId
        )
      }
      const currentMinion = this.currentMinion(minion)
      if (currentMinion) {
        this.events.push({
          type: 'minion-played',
          participantId: options.participantId,
          minion: clonePlain(currentMinion) as BoardMinion,
          position: options.position ?? player.board.length - 1
        })
      }
    } else if (validated.definition.type === 'Weapon') {
      const replacedWeapon = player.weapon
        ? (clonePlain(player.weapon) as BoardWeapon)
        : null
      this.equip(
        options.participantId,
        card.cardId,
        frame,
        'play-card.equip',
        card.instanceId,
        card.creationOrdinal
      )
      const weapon = player.weapon
      if (!weapon)
        throw new ResolutionInputError(
          'resolution-failed',
          'The weapon could not be equipped.'
        )
      const target: EntityRef = {
        instanceId: weapon.instanceId,
        kind: 'weapon',
        participantId: options.participantId,
        zone: 'weapon',
        cardId: weapon.cardId
      }
      frame = {
        ...this.frameFor(target, null, validated.chosenTargets),
        choiceIndex: options.choice
      }
      this.emitCardPlayedSemantic(target, target, card, 'card-played')
      this.runCardBlocks(validated.definition, 'on-play', frame, 'play-card')
      this.events.push({
        type: 'weapon-equipped',
        participantId: options.participantId,
        weapon: clonePlain(weapon) as BoardWeapon,
        replacedWeapon
      })
    } else if (validated.definition.type === 'Hero') {
      const target: EntityRef = {
        instanceId: `${options.participantId}:hero`,
        kind: 'hero',
        participantId: options.participantId,
        zone: 'hero'
      }
      frame = {
        ...this.frameFor(target, null, validated.chosenTargets),
        sourceCardId: card.cardId,
        choiceIndex: options.choice
      }
      this.emitCardPlayedSemantic(validated.source, target, card, 'card-played')
      this.runCardBlocks(validated.definition, 'on-play', frame, 'play-card')
      this.runCardBlocks(validated.definition, 'battlecry', frame, 'play-card')
    } else if (validated.definition.keywords.includes('secret')) {
      if ((player.secrets ?? []).length >= 5)
        throw new ResolutionInputError('resolution-failed', 'The secret zone is full.')
      if ((player.secrets ?? []).some((secret) => secret.cardId === card.cardId))
        throw new ResolutionInputError(
          'resolution-failed',
          'A copy of that secret is already active.'
        )
      const secret: SecretState = {
        instanceId: card.instanceId,
        cardId: card.cardId,
        ownerId: options.participantId,
        controllerId: options.participantId,
        creationOrdinal: card.creationOrdinal ?? this.nextEntityOrdinal++,
        playOrder: this.nextEntityOrdinal++,
        revealed: false
      }
      this.emitCardPlayedSemantic(
        validated.source,
        validated.source,
        card,
        'card-played'
      )
      this.appendSecret(player, secret)
      const target: EntityRef = {
        instanceId: secret.instanceId,
        kind: 'secret',
        participantId: options.participantId,
        zone: 'secret',
        cardId: card.cardId
      }
      this.emitCardPlayedSemantic(target, target, card, 'secret-played')
      this.runCardBlocks(validated.definition, 'on-secret-played', frame, 'play-card')
    } else {
      this.emitCardPlayedSemantic(
        validated.source,
        validated.source,
        card,
        'card-played'
      )
      this.runCardBlocks(validated.definition, 'on-play', frame, 'play-card')
      const resolvedTargets = [...validated.chosenTargets]
      for (let index = 0; index < resolvedTargets.length; index += 1) {
        const chosen = resolvedTargets[index]
        if (chosen?.kind !== 'minion') continue
        const targeted = this.emitCardPlayedSemantic(
          validated.source,
          chosen,
          card,
          'spell-targeted-minion'
        )
        if (targeted.redirectTarget) resolvedTargets[index] = targeted.redirectTarget
      }
      const castFrame = {
        ...this.frameFor(validated.source, null, resolvedTargets),
        choiceIndex: options.choice
      }
      const castEvent = this.emitCardPlayedSemantic(
        validated.source,
        resolvedTargets[0] ?? validated.source,
        card,
        'spell-cast',
        'cast'
      )
      if (!castEvent.cancelled)
        this.runCardBlocks(validated.definition, 'cast', castFrame, 'play-card')
    }
    this.processDeaths()
  }

  resolveCardPlay(options: EffectRuntimeOptions): EffectResolutionResult {
    try {
      const validated = this.validatePlayInput(options)
      this.step('checkpoint.card-play', 'checkpoint')
      this.resolveValidatedPlay(options, validated)
      if (options.deferChoice === true) {
        const pendingOptions = this.choiceOptionsFor(validated.definition)
        this.draft.pendingCardChoice = {
          participantId: options.participantId,
          sourceCardInstanceId: options.cardInstanceId,
          sourceCardId: validated.card.cardId,
          options: [...pendingOptions]
        }
        this.events.push({
          type: 'card-choice-started',
          participantId: options.participantId,
          sourceCardInstanceId: options.cardInstanceId,
          sourceCardId: validated.card.cardId,
          options: pendingOptions
        })
      }
      this.recomputeContinuousEffects()
      const nextState = clonePlain(this.draft) as DraftState
      nextState.revision = this.draft.revision + 1
      nextState.pendingResolution = false
      nextState.nextEntityOrdinal = this.nextEntityOrdinal
      if (this.recordTrace)
        nextState.effectTrace = [
          ...(this.initialState.effectTrace ?? []),
          ...this.trace
        ]
      else delete nextState.effectTrace
      const endedPlayer = nextState.players.find((player) => player.hero.health <= 0)
      if (endedPlayer) {
        if (nextState.players.every((player) => player.hero.health <= 0)) {
          this.step('checkpoint.match-end', 'match-end')
          nextState.phase = 'ended'
          nextState.activePlayerId = null
          nextState.winnerId = null
          nextState.loserId = null
          this.events.push({
            type: 'match-ended',
            winnerId: null,
            loserId: null,
            reason: 'simultaneous-hero-lethal'
          })
        } else {
          const winner = nextState.players.find(
            (player) => player.participantId !== endedPlayer.participantId
          )
          if (winner) {
            this.step('checkpoint.match-end', 'match-end')
            nextState.phase = 'ended'
            nextState.activePlayerId = null
            nextState.winnerId = winner.participantId
            nextState.loserId = endedPlayer.participantId
            this.events.push({
              type: 'match-ended',
              winnerId: winner.participantId,
              loserId: endedPlayer.participantId,
              reason: 'hero-health-depleted'
            })
          }
        }
      }
      assertOpeningMatchInvariants(nextState as unknown as OpeningMatchState)
      return {
        accepted: true,
        state: clonePlain(nextState) as unknown as OpeningMatchState,
        events: clonePlain(this.events) as OpeningMatchEvent[],
        trace: copyPlainArray(this.trace),
        nextEntityOrdinal: this.nextEntityOrdinal,
        triggerEvents: copyPlainArray(this.triggerEvents)
      }
    } catch (error) {
      return this.resolutionFailure(error)
    }
  }

  resolvePendingCardChoice(
    options: PendingCardChoiceRuntimeOptions
  ): EffectResolutionResult {
    try {
      const pending = this.draft.pendingCardChoice
      if (!pending)
        throw new ResolutionInputError('missing-input', 'No card choice is pending.')
      if (
        pending.participantId !== options.participantId ||
        pending.sourceCardInstanceId !== options.sourceCardInstanceId
      )
        throw new ResolutionInputError(
          'wrong-controller',
          'Only the pending Choice owner may select this option.'
        )
      if (!pending.options.some((option) => option.choice === options.choice))
        throw new ResolutionInputError('extra-input', 'The selected choice is invalid.')
      if (pending.resolution?.type === 'hero-power') {
        const powerId = pending.resolution.heroPowerIds[options.choice]
        const definition = powerId ? HERO_POWER_CATALOG.get(powerId) : undefined
        if (!definition)
          throw new ResolutionInputError(
            'stale-target',
            'The selected hero power is unavailable.'
          )
        const player = this.player(options.participantId)
        const previous = player.heroPower
        player.heroPower = {
          id: definition.id,
          creationOrdinal: previous.creationOrdinal,
          cost: definition.cost,
          baseCost: definition.cost,
          available: previous.available,
          targetType: definition.targeting,
          targetingGranted: definition.targeting,
          enchantments: []
        }
        this.draft.pendingCardChoice =
          pending.queued && pending.queued.length > 0
            ? {
                ...pending.queued[0]!,
                ...(pending.queued.length > 1
                  ? { queued: pending.queued.slice(1) }
                  : {})
              }
            : undefined
        const nextState = this.commitResolution()
        return {
          accepted: true,
          state: clonePlain(nextState) as OpeningMatchState,
          events: clonePlain(this.events) as OpeningMatchEvent[],
          trace: copyPlainArray(this.trace),
          nextEntityOrdinal: this.nextEntityOrdinal,
          triggerEvents: copyPlainArray(this.triggerEvents)
        }
      }
      const definition = cardDefinition(pending.sourceCardId)
      if (!definition)
        throw new ResolutionInputError(
          'stale-target',
          'The Choice source is unavailable.'
        )
      const source = this.findEntity(
        options.sourceCardInstanceId,
        options.participantId
      )
      if (!source || source.kind !== 'minion')
        throw new ResolutionInputError(
          'stale-target',
          'The minion awaiting a Choice is no longer in play.'
        )
      this.draft.pendingCardChoice =
        pending.queued && pending.queued.length > 0
          ? {
              ...pending.queued[0]!,
              ...(pending.queued.length > 1 ? { queued: pending.queued.slice(1) } : {})
            }
          : undefined
      const frame = {
        ...this.frameFor(source, null, []),
        choiceIndex: options.choice
      }
      for (const [index, block] of definition.effects.entries()) {
        if (block.trigger === 'battlecry' && block.choice)
          this.runBlock(block, frame, `pending-choice.battlecry[${index}]`)
      }
      this.processDeaths()
      const nextState = this.commitResolution()
      return {
        accepted: true,
        state: clonePlain(nextState) as OpeningMatchState,
        events: clonePlain(this.events) as OpeningMatchEvent[],
        trace: copyPlainArray(this.trace),
        nextEntityOrdinal: this.nextEntityOrdinal,
        triggerEvents: copyPlainArray(this.triggerEvents)
      }
    } catch (error) {
      return this.resolutionFailure(error)
    }
  }
}

function findRequestedTarget(
  runtime: EffectRuntime,
  requested: CardPlayTargetRef
): EntityRef | null {
  const instanceId =
    requested.kind === 'hero' ? `${requested.participantId}:hero` : requested.instanceId
  const current = runtime.findEntity(instanceId, requested.participantId)
  if (
    !current ||
    current.kind !== requested.kind ||
    current.participantId !== requested.participantId
  )
    return null
  return current
}

export function resolveCardPlay(options: EffectRuntimeOptions): EffectResolutionResult {
  return new EffectRuntime(
    options.state,
    options.rng ?? createSeededRng(options.state.revision + 1),
    options.nextEntityOrdinal,
    options.recordTrace
  ).resolveCardPlay(options)
}

export function resolvePendingCardChoice(
  options: PendingCardChoiceRuntimeOptions
): EffectResolutionResult {
  return new EffectRuntime(
    options.state,
    options.rng ?? createSeededRng(options.state.revision + 1),
    options.nextEntityOrdinal,
    options.recordTrace
  ).resolvePendingCardChoice(options)
}

export function resolveAttack(options: AttackRuntimeOptions): EffectResolutionResult {
  return new EffectRuntime(
    options.state,
    options.rng ?? createSeededRng(options.state.revision + 1),
    options.nextEntityOrdinal,
    options.recordTrace
  ).resolveAttack(options)
}

export function resolveHeroPower(
  options: HeroPowerRuntimeOptions
): EffectResolutionResult {
  return new EffectRuntime(
    options.state,
    options.rng ?? createSeededRng(options.state.revision + 1),
    options.nextEntityOrdinal,
    options.recordTrace
  ).resolveHeroPower(options)
}

export function resolveTurnTransition(
  options: TurnTransitionRuntimeOptions
): EffectResolutionResult {
  return new EffectRuntime(
    options.state,
    options.rng ?? createSeededRng(options.state.revision + 1),
    options.nextEntityOrdinal,
    options.recordTrace
  ).resolveTurnTransition(options)
}

export function getPlayInput(
  state: OpeningMatchState,
  participantId: PlayerId,
  cardInstanceId: string,
  choice?: number
): PlayCardInput | null {
  return new EffectRuntime(state).getPlayInput(participantId, cardInstanceId, choice)
}

export function getMatchLegality(
  state: OpeningMatchState,
  participantId: PlayerId
): MatchLegality {
  return new EffectRuntime(state).getMatchLegality(participantId)
}

export function getDerivedState(state: OpeningMatchState): OpeningMatchState {
  return new EffectRuntime(state).getDerivedState()
}
