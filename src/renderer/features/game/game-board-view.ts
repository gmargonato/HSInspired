import { cthunCardRulesText } from '../../../game/match/cthun'
import { spellDamageRulesText } from '../../../game/match/spell-damage'
import {
  BlurFilter,
  ColorMatrixFilter,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  type Texture,
  type Renderer,
  type FederatedPointerEvent
} from 'pixi.js'
import type { Deck } from '../../../game/decks'
import {
  CARD_CATALOG,
  asCardId,
  type CardDefinition
} from '../../../game/content/cards'
import { HERO_CATALOG } from '../../../game/content/heroes'
import { HERO_POWER_CATALOG } from '../../../game/content/hero-powers'
import {
  getHeroAttack,
  isBoardMinionSleeping,
  MAX_BOARD_SIZE,
  type AttackCharacterRef,
  type BoardMinion,
  type CardPlayTargetRef,
  type HeroPowerTargetRef,
  type HistoryActionResolvedEvent,
  type MulliganResolvedEvent,
  type MatchEndedEvent,
  type MinionCardMovement,
  type OpeningCard,
  type OpeningMatchEvent,
  type OpeningMatchInstance,
  type OpeningMatchState,
  type OpeningPlayerState
} from '../../../game/match'
import type { PlayerId } from '../../../game/match'
import type { AiDecisionApi } from '../../../shared/ipc/ai'
import type {
  DevCommand,
  DevCardPickerAction,
  DevDeckAction,
  DevMatchTarget
} from '../../../shared/dev-menu'
import type { GameRoute } from './game-route'
import { dispatchDevMatchCommand } from './dev-match-command-dispatch'
import { eventPresentationPolicy } from './event-presentation-policy'
import { handDiscardBatch, isHandDiscard } from './hand-discard-presentation'
import { randomSpellPresentationStates } from './random-spell-presentation'
import { selectRandomBoardTexture } from './board-selection'
import { isLegalHeroPowerTarget } from './hero-power-targeting'
import type { RendererLogger } from '../../ui/logger'
import { gsap } from '../../animation/animations'
import { CardView } from '../../rendering/cards/card-view'
import { CARD_CANVAS, CARD_PROFILES } from '../../rendering/cards/card-layout'
import { cardCostColor } from '../../rendering/cards/card-cost-presentation'
import {
  type DeckPresentationAssets,
  type GameAssets,
  type HeroPowerAssetKey
} from '../../ui/asset-registry'
import { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'
import { Actor } from '../../ui/components/actor'
import { PreviewGhostOutline } from '../../rendering/effects/preview-ghost-outline'
import { BoardPositionController, type BoardSide } from './board-position-controller'
import { BoardShadowLayer } from '../../rendering/shadows/board-shadow-layer'
import { attachShadow, getShadowCaster } from '../../rendering/shadows/shadow-caster'
import { TARGETING_ARROW_HEAD, type CursorManager } from '../../ui/components/cursor'
import { GAME_HEIGHT, GAME_WIDTH } from '../../rendering/layout'
import { DEFAULT_HAND_LAYOUT, HandPointer, resolveHandHover } from './hand-layout'
import { DEFAULT_HAND_DRAG } from './hand-drag'
import {
  OneShotPointerTapGuard,
  PointerReleaseInputGate,
  allowsDragTargetingFromHand,
  canCommitPendingCardPlay,
  isCardTargetSelectionActive,
  pendingCardInputStage,
  requiresClickConfirmedMinionPlacement
} from './hand-play-gesture'
import { DRAG_MOVE_THRESHOLD } from './game-hand-drag'
import { GameHandView } from './game-hand-view'
import { GameCardTargeting } from './game-card-targeting'
import type {
  PendingMinionTargetPreview,
  MinionPreviewPresentation
} from './game-card-targeting-types'
import {
  GameCombatPresentation,
  COMBAT_ATTACKER_Z_INDEX,
  type CombatView
} from './game-combat-presentation'
import type { HandEntry } from './game-hand-entry'
import { CardDrawAnimation, type CardDrawProfile } from './card-draw-animation'
import { CARD_DRAW_LAYOUT } from './card-draw-layout'
import { CardPlayAnimation, type CardPlayPose } from './card-play-animation'
import { CARD_PLAY_LAYOUT } from './card-play-layout'
import { CardDepartureAnimation } from './card-departure-animation'
import { CARD_DEPARTURE_LAYOUT } from './card-departure-layout'
import { HeroPowerView, type HeroPowerLayout } from './hero-power-view'
import {
  MinionView,
  type MinionViewTextures
} from '../../rendering/minions/minion-view'
import { HeroView } from '../../rendering/heroes/hero-view'
import {
  HERO_POWER_CARD_CANVAS,
  HeroPowerCardView
} from '../../rendering/hero-powers/hero-power-presentation'
import { WeaponView } from '../../rendering/weapons/weapon-view'
import { AddCardPickerView } from './add-card-picker-view'
import { CardSelectionOverlay } from './card-selection-overlay'
import {
  isInDropZone,
  resolveBoardInsertionIndex,
  type BoardRowConfig
} from './board-layout'
import { AttackLine } from './attack-line'
import { getCombatImpactProfile } from './combat-impact'
import { hasAvailableTurnAction } from './turn-action-availability'
import { GAME_BOARD_LAYOUT } from './game-scene-layout'
import { MINION_CANVAS } from '../../rendering/minions/minion-layout'
import {
  applyAnchoredPlacement,
  applyPlacement,
  type LayoutPlacement
} from '../../rendering/layout'
import { GameBoardSession } from './game-board-session'
import { GameHudView } from './game-hud-view'
import { GameMulliganView } from './game-mulligan-view'
import { HoverPreviewController } from './hover-preview-controller'
import {
  OPENING_TIMING,
  BOARD_TIMING,
  RESOLUTION_TIMING,
  REMOTE_TIMING
} from './game-presentation-timing'
import { completeTimeline } from './game-presentation-animation'
import { GameCardSlot } from './game-card-slot'
import { MatchResultOverlay, type MatchResult } from './match-result-overlay'
import { FatigueView } from './fatigue-view'
import { boardAbilityMarkers, boardMinionAbilityMarkers } from './board-ability-markers'
import {
  effectDamageIndicatorAmount,
  effectHealIndicatorAmount
} from './character-indicator-presentation'
import {
  QuestZoneView,
  SecretRevealView,
  SecretZoneView,
  type SecretPresentationSide
} from './secret-view'
import { SecretPreviewView } from './secret-preview-view'
import { QuestPreviewView } from './quest-preview-view'
import { MatchHistoryView } from './match-history-view'
import { MatchPremiumAppearance } from './match-premium-appearance'
import {
  isPurchasedPremium,
  isPremiumEnabled
} from '../../rendering/premium-appearance'
import { RemoteCardPlayPreview, playedRemoteCard } from './remote-card-play-preview'
import { RemoteTargetPreview } from './remote-target-preview'
import { clearMatchResultCombatViews } from './match-result-state'
import { AiTurnController, type AiActionDecision } from './ai-turn-controller'
import { TargetGestureController } from './target-gesture'
import { PresentationQueue } from './presentation-queue'
import {
  boardWeaponCardPreviewModel,
  boardWeaponCardPreviewKey,
  boardMinionCardPreviewKey,
  boardMinionCardPreviewModel,
  canShowBoardMinionCardPreview,
  positionBoardMinionCardPreview
} from './board-minion-card-preview'

function isFrozen(
  frozenUntilTurn: number | null | undefined,
  turnNumber: number
): boolean {
  return (frozenUntilTurn ?? -1) >= turnNumber
}

export interface GameBoardViewOptions {
  readonly route: GameRoute
  readonly decks: readonly Deck[]
  readonly gameAssets: GameAssets
  readonly heroAssets: DeckPresentationAssets
  readonly renderer: Renderer
  readonly cursor?: CursorManager | null
  readonly logger?: RendererLogger
  readonly ai?: AiDecisionApi
  /** Shares the scene-owned match session and conversational controller. */
  readonly aiRuntime?: {
    readonly session: GameBoardSession
    readonly controller: AiTurnController
  }
  readonly onMatchEnded?: (event: MatchEndedEvent) => Promise<number | void> | void
  readonly onMatchComplete?: () => Promise<void> | void
  readonly onOpponentLeft?: () => void
}

export interface HandInteractionSnapshot {
  readonly ready: boolean
  readonly localTurn: boolean
  readonly hand: readonly {
    readonly instanceId: string
    readonly cardId: string
    readonly x: number
    readonly y: number
  }[]
  readonly dragging: boolean
  readonly targeting: boolean
  readonly boardPoint: HandPointer
  readonly remoteHeroPoint: HandPointer
  readonly dragged?: {
    readonly x: number
    readonly y: number
    readonly targetX: number
    readonly targetY: number
  }
}

interface MulliganResolutionBatch {
  readonly state: OpeningMatchState
  readonly events: readonly OpeningMatchEvent[]
  readonly decision?: AiActionDecision
  readonly completedAt?: number
}

/** Turn-control timing for AI scheduling. */
const TURN_TIMING = {
  /** How long the AI "thinks" before passing the turn back. */
  aiTurnDelay: 0.15
} as const

const GOLDEN_MONKEY_CARD_ID = 'league_of_explorers_golden_monkey'

const COMBAT_DRAG_MOVE_THRESHOLD_PX = 10

type BoardTargetGestureSource =
  | { readonly kind: 'combat'; readonly attacker: CombatView }
  | { readonly kind: 'hero-power' }
  | { readonly kind: 'card'; readonly cardInstanceId: string }

type BoardPointerSample = Pick<FederatedPointerEvent, 'globalX' | 'globalY' | 'target'>

type MatchHoverTarget =
  | {
      readonly kind: 'board-card'
      readonly key: string
      readonly view: MinionView | WeaponView
    }
  | {
      readonly kind: 'hero-power'
      readonly key: string
      readonly participantId: PlayerId
    }
  | {
      readonly kind: 'secret'
      readonly key: string
      readonly side: SecretPresentationSide
    }
  | {
      readonly kind: 'quest'
      readonly key: string
      readonly side: SecretPresentationSide
    }

const COMBAT_SHAKE_DIRECTIONS = [
  { x: 1, y: -0.25 },
  { x: -0.75, y: 0.55 },
  { x: 0.55, y: -0.75 },
  { x: -0.35, y: 0.3 },
  { x: 0.2, y: -0.15 }
] as const

function cardDefinition(card: OpeningCard): CardDefinition {
  return CARD_CATALOG.require(card.cardId)
}

function cloneCard(card: OpeningCard): OpeningCard {
  return { ...card }
}

interface GoldenMonkeyHandReplacement {
  readonly sourceInstanceId: string
  readonly targetInstanceIds: ReadonlySet<string>
}

/** Feature-owned board, opening choreography, mulligan, and local hand interaction. */
export class GameBoardView extends Actor {
  private pendingBoardPointer: BoardPointerSample | null = null
  private canvasBounds: DOMRect | null = null
  private canvasResizeObserver: ResizeObserver | null = null
  private readonly invalidateCanvasBounds = (): void => {
    this.canvasBounds = null
  }
  private readonly resolver = new CardAssetResolver()
  private readonly secretPreviewView: SecretPreviewView
  private readonly questPreviewView: QuestPreviewView
  private readonly hoverPreview: HoverPreviewController<MatchHoverTarget>
  private localSecretHovered = false
  private questHoveredSide: SecretPresentationSide | null = null
  private historyPreviewDesaturated = false
  private badgePreviewDesaturated = false
  private readonly combat: GameCombatPresentation
  private readonly cardPlay: GameCardTargeting
  private readonly hand: GameHandView
  private readonly mulligan: GameMulliganView
  private readonly remoteBacks: Sprite[] = []
  private readonly boardLayer = new Container()
  private readonly matchBackdropLayer = new Container()
  private readonly gameplayLayer = new Container()
  private readonly shadowLayer: BoardShadowLayer
  private readonly localMinionLayer = new Container()
  private readonly remoteMinionLayer = new Container()
  private readonly boardCardPreviewLayer = new Container()
  private readonly weaponLayer = new Container()
  private readonly summonLayer = new Container()
  private readonly cardPlayAnimation: CardPlayAnimation
  private readonly cardDepartureAnimation: CardDepartureAnimation
  private readonly activeDepartureSlots = new Set<GameCardSlot>()
  private readonly boardPositions: BoardPositionController
  private get localMinionViews(): readonly MinionView[] {
    return this.boardPositions.views('local')
  }
  private get remoteMinionViews(): readonly MinionView[] {
    return this.boardPositions.views('remote')
  }
  private boardCardPreview: CardView | null = null
  private boardCardPreviewGhost: PreviewGhostOutline | null = null
  private hoveredBoardCardView: MinionView | WeaponView | null = null
  private boardCardPreviewRequest = 0
  private requestedBoardCardPreviewKey: string | null = null
  private heroPowerPreview: HeroPowerCardView | null = null
  private heroPowerPreviewGhost: PreviewGhostOutline | null = null
  private hoveredHeroPowerParticipantId: PlayerId | null = null
  private requestedHeroPowerPreviewKey: string | null = null
  private readonly weaponViews = new Map<PlayerId, WeaponView>()
  private readonly activeSummonSlots = new Set<GameCardSlot>()
  private readonly hud = new GameHudView(this.resolver, this.animationScope)
  private readonly addCardPicker: AddCardPickerView | null
  private pickerTarget: DevMatchTarget = 'local'
  private pickerAction: DevCardPickerAction = 'add-to-hand'
  private readonly attackLineLayer = new Container()
  private readonly attackLine = new AttackLine()
  private readonly cardSelectionOverlay: CardSelectionOverlay
  private readonly matchResultOverlay: MatchResultOverlay
  private readonly fatigueView: FatigueView
  private readonly secretZoneView: SecretZoneView
  private readonly questZoneView: QuestZoneView
  private readonly revealedOpeningQuestParticipants = new Set<PlayerId>()
  private readonly secretRevealView: SecretRevealView
  private historyView: MatchHistoryView | null = null
  private readonly remoteCardPlayPreview: RemoteCardPlayPreview
  private readonly remoteTargetPreview: RemoteTargetPreview
  private historyGrayscaleFilter: ColorMatrixFilter | null = null
  private selectedCombatView: CombatView | null = null
  private heroPowerTargeting = false
  private combatInProgress = false
  private readonly targetGestures =
    new TargetGestureController<BoardTargetGestureSource>()
  /** Ignores the pointertap synthesized by a click that advances card play. */
  private readonly cardPlacementTapGuard = new OneShotPointerTapGuard()
  private readonly cardChoiceInputGate = new PointerReleaseInputGate()
  private resolutionPresentationDepth = 0
  private readonly resolutionIdleWaiters: Array<() => void> = []
  private matchResultShown = false
  private opponentLeftShown = false
  private readonly premiumAppearance = new MatchPremiumAppearance(
    () => this.localParticipantId,
    isPurchasedPremium
  )
  private matchResultPending: Promise<void> | null = null
  private matchResultBlurFilter: BlurFilter | null = null
  private matchResultGrayscaleFilter: ColorMatrixFilter | null = null
  /**
   * Hero power cards sit in their own layer immediately above the board but
   * BELOW the opening/intro layer, so the pre-match black overlay covers them
   * while the versus sequence plays out; they appear as it fades.
   */
  private readonly heroPowerLayer = new Container()
  private readonly heroLayer = new Container()
  private readonly openingLayer = new Container()
  private readonly travelLayer = new Container()
  /** Hosts discard flights above the hand, HUD, and summons. */
  private readonly discardFlightLayer = new Container()
  private readonly deckLayer = new Container()
  private readonly deckViews = new Map<PlayerId, Sprite>()
  private readonly drawOrigins = new WeakMap<Container, Sprite>()
  private readonly drawAnimations = new Set<CardDrawAnimation>()
  private readonly turnLayer = this.hud.turnLayer
  private readonly remoteHandLayer = new Container()
  private readonly heroViews = new Map<PlayerId, HeroView>()
  /** One face-up hero power card per player, right of the hero portraits. */
  private readonly heroPowerViews = new Map<PlayerId, HeroPowerView>()
  private readonly logger: RendererLogger
  private session!: GameBoardSession
  private aiController!: AiTurnController
  private aiMulliganResolution: Promise<MulliganResolutionBatch | null> | null = null
  private aiMulliganStartedAt = 0
  private aiTurnRunning = false
  /**
   * The domain accepts commands immediately; only their Pixi work is queued.
   * Keeping this separate from input is what lets players act through effects.
   */
  private readonly presentationQueue = new PresentationQueue()
  /** Snapshot consumed by the presentation job currently at the queue head. */
  private activePresentationState: OpeningMatchState | null = null
  /** Shared reveal barrier and intermediate state for random spells and Secrets. */
  private randomSpellRevision: number | null = null
  private randomSpellState: OpeningMatchState | null = null
  private get match(): OpeningMatchInstance {
    return this.session.match
  }

  private presentationState(): OpeningMatchState {
    return (
      this.randomSpellState ?? this.activePresentationState ?? this.match.getState()
    )
  }

  /** Acquire the input barrier synchronously, before queued visual work can start. */
  private dispatchCommand(
    command: unknown
  ): ReturnType<OpeningMatchInstance['dispatch']> {
    if (this.randomSpellRevision !== null)
      return {
        accepted: false,
        code: 'resolution-failed',
        message: 'Wait for the current reveal to finish.',
        state: this.match.getState(),
        events: []
      }
    const before = this.match.getState()
    const result = this.session.dispatch(command)
    if (
      result.accepted &&
      result.events.some(
        (event) =>
          event.type === 'random-spell-started' ||
          event.type === 'secret-resolution-started'
      )
    ) {
      this.randomSpellRevision = result.state.revision
      this.randomSpellState = before
      this.syncTurnControls(before)
    }
    return result
  }

  private releaseRandomSpellPresentation(revision: number): void {
    if (this.randomSpellRevision !== revision) return
    this.randomSpellRevision = null
    this.randomSpellState = null
    if (this.resolutionPresentationDepth === 0) {
      for (const resolve of this.resolutionIdleWaiters.splice(0)) resolve()
    }
    if (this.destroyed) return
    this.syncTurnHud(this.match.getState())
    this.syncTurnControls(this.match.getState())
  }

  private enqueuePresentation<T>(
    state: OpeningMatchState,
    present: () => Promise<T>
  ): Promise<T> {
    return this.presentationQueue.enqueue(async () => {
      this.activePresentationState = state
      try {
        return await present()
      } finally {
        this.activePresentationState = null
        this.releaseRandomSpellPresentation(state.revision)
      }
    })
  }
  private get localParticipantId(): PlayerId {
    return this.session.localParticipantId
  }
  private get remoteParticipantId(): PlayerId {
    return this.session.remoteParticipantId
  }
  private get localPlayerNumber(): 1 | 2 {
    return this.session.localPlayerNumber
  }
  private get remotePlayerNumber(): 1 | 2 {
    return this.session.remotePlayerNumber
  }
  /**
   * True while a turn is being processed (a local end-turn or the AI's pass).
   * Blocks repeat end-turn commands and the AI from acting out of turn.
   */
  private turnInProgress = false
  private remoteBackCount = 0
  private openingRevealStarted = false
  /** Current insertion gap preview, or null when no gap is previewed. */
  private readonly handleWindowPointerDown = (event: PointerEvent): void => {
    if (event.button === 2) {
      this.hand.drag.end()
      const pointer = this.toRendererPoint(event.clientX, event.clientY)
      if (this.selectedCombatView || this.heroPowerTargeting || this.cardPlay.current) {
        event.preventDefault()
        event.stopPropagation()
      }
      this.cancelHeroPowerTargeting()
      this.cardPlay.cancelCardTargeting(pointer)
      this.deselectAttacker()
      this.targetGestures.clear()
      return
    }
    if (
      event.button === 0 &&
      this.hand.drag.index !== null &&
      !this.hand.drag.returning
    ) {
      if (!this.hand.drag.ownsPointer(event.pointerId)) return
      event.preventDefault()
      event.stopPropagation()
      this.flushPointerAt(
        this.toRendererPoint(event.clientX, event.clientY),
        event.pointerId
      )
      if (this.hand.drag.index === null) return
      const index = this.hand.drag.index
      const entry = this.hand.entries[index]
      const input = entry
        ? this.match.getPlayInput?.(this.localParticipantId, entry.card.instanceId)
        : null
      if (
        entry &&
        cardDefinition(entry.card).type === 'Spell' &&
        input &&
        input.targetSelectors.length === 0 &&
        input.choiceCount === 0
      ) {
        this.castSelectedTargetlessSpell(entry)
        return
      }
      const pointer = this.hand.drag.pointer
      const cardInstanceId = entry?.card.instanceId
      if (pointer) this.resolveCardDrop(pointer)
      if (cardInstanceId && this.cardPlay.current?.cardInstanceId === cardInstanceId) {
        const targeting = this.cardPlay.current
        const awaitingChoice =
          pendingCardInputStage(
            targeting.input,
            targeting.choice,
            targeting.targets.length
          ) === 'choice'
        if (targeting.presentation.kind === 'minion-preview' || awaitingChoice) {
          this.cardPlacementTapGuard.arm(event.pointerId)
        }
        if (awaitingChoice) this.cardChoiceInputGate.block(event.pointerId)
      }
    }
  }
  private readonly handleWindowPointerUp = (event: PointerEvent): void => {
    if (this.cardPlacementTapGuard.matches(event.pointerId)) {
      window.setTimeout(() => {
        this.cardPlacementTapGuard.release(event.pointerId)
        this.cardChoiceInputGate.release(event.pointerId)
      }, 0)
    } else {
      this.cardChoiceInputGate.release(event.pointerId)
    }
    if (event.button !== 0) return
    if (
      this.hand.drag.index !== null &&
      !this.hand.drag.returning &&
      !this.hand.drag.ownsPointer(event.pointerId)
    )
      return
    const releasePoint = this.toRendererPoint(event.clientX, event.clientY)
    this.flushPointerAt(releasePoint, event.pointerId)
    // Pixi normally releases the gesture first through handleBoardPointerUp.
    // Keep this as a fallback for releases that occur outside the stage.
    if (this.releaseTargetGesture(event.pointerId, releasePoint)) return
    if (
      this.hand.drag.index === null ||
      this.hand.drag.returning ||
      !this.hand.drag.movedBeyondThreshold
    ) {
      return
    }
    const carriedEntry = this.hand.entries[this.hand.drag.index]
    if (carriedEntry && this.requiresSeparatePlacementClick(carriedEntry)) return
    const pointer = this.hand.drag.pointer
    const cardInstanceId = carriedEntry?.card.instanceId
    if (pointer) this.resolveCardDrop(pointer)
    if (
      cardInstanceId &&
      this.cardPlay.current?.cardInstanceId === cardInstanceId &&
      pendingCardInputStage(
        this.cardPlay.current.input,
        this.cardPlay.current.choice,
        this.cardPlay.current.targets.length
      ) === 'choice'
    ) {
      this.cardPlacementTapGuard.arm(event.pointerId)
      this.cardChoiceInputGate.block(event.pointerId)
      window.setTimeout(() => {
        this.cardPlacementTapGuard.release(event.pointerId)
        this.cardChoiceInputGate.release(event.pointerId)
      }, 0)
    }
  }
  private readonly handleBoardPointerUp = (event: FederatedPointerEvent): void => {
    if (event.button !== 0) return
    if (
      this.hand.drag.index !== null &&
      !this.hand.drag.returning &&
      !this.hand.drag.ownsPointer(event.pointerId)
    )
      return
    const releasePoint = {
      x: event.globalX,
      y: event.globalY
    }
    this.flushPointerAt(releasePoint, event.pointerId)
    this.releaseTargetGesture(event.pointerId, releasePoint)
  }

  private flushPointerAt(point: HandPointer, pointerId: number): void {
    this.hand.drag.flushPointer(this.hand.layer.toLocal(point), pointerId)
    this.updateTargetGesture({ pointerId, globalX: point.x, globalY: point.y })
    this.pendingBoardPointer = { globalX: point.x, globalY: point.y, target: this }
    this.flushBoardPointerVisuals()
  }
  /**
   * Resolves before Pixi synthesizes pointertap. A native window pointerup
   * listener runs too late because Pixi registered its own listener first.
   */
  private releaseTargetGesture(pointerId: number, releasePoint: HandPointer): boolean {
    const gesture = this.targetGestures.release(pointerId)
    if (gesture) {
      if (gesture.phase === 'dragging') {
        window.setTimeout(() => this.targetGestures.releaseTap(pointerId), 0)
        this.commitTargetGestureRelease(gesture.source, releasePoint)
      } else if (gesture.source.kind === 'card') {
        this.targetGestures.suppressTap(pointerId)
        window.setTimeout(() => this.targetGestures.releaseTap(pointerId), 0)
        this.beginClickedCardTargeting(gesture.source.cardInstanceId)
      }
      return true
    }
    return false
  }
  private readonly handleWindowBlur = (): void => {
    this.pendingBoardPointer = null
    this.cardPlacementTapGuard.clear()
    this.cardChoiceInputGate.clear()
    this.targetGestures.clear()
    this.hand.drag.end()
    this.cancelCombatDrag()
    this.cancelHeroPowerTargeting()
    this.cardPlay.cancelCardTargeting()
  }
  private readonly handleWindowKeyDown = (event: KeyboardEvent): void => {
    if (this.cardPlay.current) {
      if (event.key === 'Escape') {
        event.preventDefault()
        this.cardPlay.cancelCardTargeting()
        return
      }
      const choice = Number(event.key) - 1
      if (Number.isInteger(choice) && choice >= 0) {
        event.preventDefault()
        this.cardPlay.chooseCardPlayOption(choice)
        return
      }
    }
    if (
      event.key === 'Escape' &&
      (this.selectedCombatView || this.heroPowerTargeting)
    ) {
      event.preventDefault()
      this.cancelHeroPowerTargeting()
      this.deselectAttacker()
      return
    }
  }
  private readonly handleAddCardPickerSelect = async (
    cardId: string
  ): Promise<void> => {
    try {
      if (this.pickerAction === 'summon') {
        await this.devSummonMinion(cardId, this.pickerTarget)
      } else {
        await this.devAddCard(cardId, this.pickerTarget)
      }
    } catch (error) {
      this.logger.error('[DevMenu] failed to add card from picker', error)
      throw error
    }
  }

  constructor(private readonly options: GameBoardViewOptions) {
    super()
    this.boardPositions = new BoardPositionController(
      { layer: this.localMinionLayer, config: this.localBoardRowConfig() },
      { layer: this.remoteMinionLayer, config: this.remoteBoardRowConfig() },
      this.animationScope
    )
    this.shadowLayer = new BoardShadowLayer(this.gameplayLayer, options.renderer)
    this.combat = new GameCombatPresentation(options.gameAssets, this.animationScope, {
      findCharacter: (ownerId, character) => this.findCombatView(ownerId, character),
      findMinion: (ownerId, instanceId) => this.findMinionView(ownerId, instanceId),
      weaponView: (ownerId) => this.weaponViews.get(ownerId),
      presentedPlayer: (ownerId) => this.findPlayer(this.presentationState(), ownerId),
      removeMinion: (view) => this.removeMinionView(view),
      removeWeapon: (ownerId, view) => this.removeWeaponView(ownerId, view),
      layoutLocalRow: () => this.applyLocalBoardLayout(),
      layoutRemoteRow: () => this.applyRemoteBoardLayout(),
      positions: this.boardPositions,
      screenShake: (attack) => this.runCombatScreenShake(attack),
      onImpact: () => this.refreshCombatAttackabilityAfterImpact(),
      renderer: options.renderer
    })
    this.hand = new GameHandView(
      options.renderer,
      this.animationScope,
      {
        beginTargetGesture: (entry, pointer, pointerId) => {
          const input = this.match.getPlayInput?.(
            this.localParticipantId,
            entry.card.instanceId
          )
          if (
            input &&
            allowsDragTargetingFromHand(cardDefinition(entry.card).type, input)
          ) {
            this.targetGestures.begin(
              { kind: 'card', cardInstanceId: entry.card.instanceId },
              pointerId,
              pointer
            )
          }
        },
        tryTarget: (entry, pointer, pointerId) =>
          this.tryActivateDraggedCardTargeting(entry, pointer, pointerId),
        updateBoardPreview: (pointer) => this.updateLocalBoardPreview(pointer),
        clearBoardPreview: () => this.clearLocalBoardPreview(),
        syncMana: () => this.syncManaTray(this.match.getState()),
        onReturned: () => {
          const targeting = this.cardPlay.current
          if (
            targeting &&
            pendingCardInputStage(
              targeting.input,
              targeting.choice,
              targeting.targets.length
            ) === 'ready'
          ) {
            this.commitPendingCardPlay()
          }
        },
        onPointerDown: (event) => this.onHandPointerDown(event),
        isHoverBlocked: () =>
          this.cardPlay.current !== null ||
          this.heroPowerTargeting ||
          this.selectedCombatView !== null,
        allowsHandHit: (x, y) => {
          for (const view of this.localMinionViews) {
            if (!view.isInteractive()) continue
            const halfW = (MINION_CANVAS.width * view.scale.x) / 2
            const halfH = (MINION_CANVAS.height * view.scale.y) / 2
            if (Math.abs(x - view.x) < halfW && Math.abs(y - view.y) < halfH)
              return false
          }
          for (const view of this.remoteMinionViews) {
            if (!view.isInteractive()) continue
            const halfW = (MINION_CANVAS.width * view.scale.x) / 2
            const halfH = (MINION_CANVAS.height * view.scale.y) / 2
            if (Math.abs(x - view.x) < halfW && Math.abs(y - view.y) < halfH)
              return false
          }
          for (const view of this.heroViews.values()) {
            if (!view.isInteractive()) continue
            const bounds = view.getBounds()
            const topLeft = this.hand.layer.toLocal({ x: bounds.x, y: bounds.y })
            const bottomRight = this.hand.layer.toLocal({
              x: bounds.x + bounds.width,
              y: bounds.y + bounds.height
            })
            if (
              x >= topLeft.x &&
              x <= bottomRight.x &&
              y >= topLeft.y &&
              y <= bottomRight.y
            ) {
              return false
            }
          }
          const heroPower = this.heroPowerViews.get(this.localParticipantId)
          if (heroPower?.isInteractive()) {
            const global = this.hand.layer.toGlobal({ x, y })
            const local = heroPower.toLocal(global)
            if (heroPower.containsCanvasPoint(local.x, local.y)) return false
          }
          return true
        },
        activateWindowInput: () => {
          window.addEventListener('pointerdown', this.handleWindowPointerDown, true)
          window.addEventListener('pointerup', this.handleWindowPointerUp, true)
          window.addEventListener('blur', this.handleWindowBlur)
        }
      },
      {
        hasDrawOrigin: (slot) => this.drawOrigins.has(slot),
        departDeck: (slot, duration, delay) =>
          this.animateDeckDeparture(slot, duration, delay, 'local-reveal')
      },
      options.cursor
    )
    this.mulligan = new GameMulliganView(
      options.gameAssets,
      this.animationScope,
      {
        travelLayer: this.travelLayer,
        prepareAtDeck: (slot, index) =>
          this.prepareSlotAtDeck(slot, GAME_BOARD_LAYOUT.decks.local, index),
        hasDrawOrigin: (slot) => this.drawOrigins.has(slot),
        departDeck: (slot, duration, delay) =>
          this.animateDeckDeparture(slot, duration, delay, 'mulligan-reveal')
      },
      () => void this.confirmMulligan()
    )
    this.remoteCardPlayPreview = new RemoteCardPlayPreview(
      this.resolver,
      options.gameAssets.historySecretCard,
      (card, side) =>
        this.premiumAppearance.resolve(
          card,
          side === 'local' ? this.localParticipantId : this.remoteParticipantId
        ),
      (card, side) =>
        this.premiumAppearance.sideFor(
          card,
          side === 'local' ? this.localParticipantId : this.remoteParticipantId
        )
    )
    this.remoteTargetPreview = new RemoteTargetPreview(
      options.gameAssets.arrowBody,
      options.gameAssets.arrowHead,
      options.gameAssets.arrowCircle
    )
    this.logger = options.logger ?? {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    }
    this.secretPreviewView = new SecretPreviewView(this.resolver, options.renderer)
    const canvas = options.renderer.canvas
    const parent = canvas.parentElement
    this.addCardPicker =
      typeof document !== 'undefined' && parent
        ? new AddCardPickerView({
            canvas,
            parent,
            onSelect: this.handleAddCardPickerSelect
          })
        : null
    this.matchBackdropLayer.label = 'game.match-backdrop'
    this.addChild(this.matchBackdropLayer)
    this.gameplayLayer.label = 'game.gameplay'
    this.matchBackdropLayer.addChild(this.gameplayLayer)
    this.boardCardPreviewLayer.label = 'game.board-card-preview'
    this.boardCardPreviewLayer.eventMode = 'none'
    this.addChild(this.boardCardPreviewLayer)
    this.addChild(this.remoteCardPlayPreview)
    this.gameplayLayer.addChild(this.boardLayer)
    this.gameplayLayer.addChild(this.shadowLayer)
    this.localMinionLayer.label = 'game.board-minions-local'
    this.remoteMinionLayer.label = 'game.board-minions-remote'
    this.localMinionLayer.eventMode = 'passive'
    this.remoteMinionLayer.eventMode = 'passive'
    this.localMinionLayer.sortableChildren = true
    this.remoteMinionLayer.sortableChildren = true
    this.gameplayLayer.addChild(this.localMinionLayer)
    this.gameplayLayer.addChild(this.remoteMinionLayer)
    this.weaponLayer.label = 'game.equipped-weapons'
    this.weaponLayer.eventMode = 'passive'
    this.weaponLayer.sortableChildren = true
    this.gameplayLayer.addChild(this.heroPowerLayer)
    // Equipped weapons share the hero-power board depth so hand cards and
    // transient presentation layers can render above both.
    this.gameplayLayer.addChild(this.weaponLayer)
    this.heroLayer.label = 'game.heroes'
    this.heroLayer.eventMode = 'passive'
    this.heroLayer.sortableChildren = true
    // Deck piles and the turn button dim with the board during the opening and mulligan.
    this.gameplayLayer.addChild(this.deckLayer)
    this.gameplayLayer.addChild(this.hud.turnButtonLayer)
    this.gameplayLayer.addChild(this.openingLayer)
    this.gameplayLayer.addChild(this.heroLayer)
    this.questPreviewView = new QuestPreviewView(
      this.resolver,
      options.gameAssets.questArrow,
      options.renderer
    )
    this.hoverPreview = new HoverPreviewController<MatchHoverTarget>({
      delayMs: BOARD_TIMING.previewHoverDelay * 1000,
      key: (target) => target.key,
      onEnter: (target) => this.setHoverAura(target, true),
      onActivate: (target) => this.activateHoverPreview(target),
      onLeave: (target) => this.clearHoverTarget(target)
    })
    this.boardCardPreviewLayer.addChild(this.secretPreviewView, this.questPreviewView)
    this.secretZoneView = new SecretZoneView(options.gameAssets.secret, (hovered) => {
      const target: MatchHoverTarget = {
        kind: 'secret',
        key: 'secret:local',
        side: 'local'
      }
      if (hovered) this.hoverPreview.enter(target)
      else this.hoverPreview.leave(target)
    })
    this.gameplayLayer.addChild(this.secretZoneView)
    this.questZoneView = new QuestZoneView(
      options.gameAssets.quest,
      (side, hovered) => {
        const target: MatchHoverTarget = {
          kind: 'quest',
          key: `quest:${side}`,
          side
        }
        if (hovered) this.hoverPreview.enter(target)
        else this.hoverPreview.leave(target)
      }
    )
    this.gameplayLayer.addChild(this.questZoneView)
    this.gameplayLayer.addChild(this.turnLayer)
    this.gameplayLayer.addChild(this.mulligan.layer)
    // Dealt cards must stay above the mulligan dimmer while they travel from
    // the deck; they are reparented to their final layers after the animation.
    this.gameplayLayer.addChild(this.travelLayer)
    this.gameplayLayer.addChild(this.remoteHandLayer)
    this.combat.indicatorLayer.label = 'game.character-indicators'
    this.combat.indicatorLayer.eventMode = 'none'
    this.combat.indicatorLayer.sortableChildren = true
    // Hand cards cover damage and healing bursts, including while at rest.
    this.gameplayLayer.addChild(this.combat.indicatorLayer)
    this.gameplayLayer.addChild(this.hand.layer)
    this.gameplayLayer.addChild(this.hud.deckInfoLayer)
    this.summonLayer.label = 'game.minion-summons'
    this.summonLayer.eventMode = 'none'
    this.summonLayer.sortableChildren = true
    this.gameplayLayer.addChild(this.summonLayer)
    this.cardPlayAnimation = new CardPlayAnimation(
      options.gameAssets.spellPlayAura,
      [
        options.gameAssets.playSpotlight1,
        options.gameAssets.playSpotlight2,
        options.gameAssets.playSpotlight3,
        options.gameAssets.playSpotlight4,
        options.gameAssets.playSpotlight5,
        options.gameAssets.playSpotlight6,
        options.gameAssets.playSpotlight7,
        options.gameAssets.playSpotlight8
      ],
      options.gameAssets.minionPlayAura
    )
    this.gameplayLayer.addChild(this.cardPlayAnimation)
    // Discarded cards must read above the remaining hand fan, HUD, and summons.
    this.discardFlightLayer.label = 'game.card-discard-flight'
    this.discardFlightLayer.eventMode = 'none'
    this.gameplayLayer.addChild(this.discardFlightLayer)
    this.cardDepartureAnimation = new CardDepartureAnimation(
      options.renderer,
      this.animationScope,
      this.summonLayer,
      this.cardPlayAnimation
    )
    // Death previews stay above the minions, but below the complete targeting
    // arrow so its body remains connected visually to the DOM cursor head.
    this.combat.layer.label = 'game.combat-overlays'
    this.combat.layer.eventMode = 'none'
    this.combat.layer.sortableChildren = true
    this.gameplayLayer.addChild(this.combat.layer)
    // Keep the Pixi arrow body above every other board layer. The cursor's
    // arrow head is rendered in the DOM above the canvas.
    this.attackLineLayer.label = 'game.attack-line-layer'
    this.attackLineLayer.eventMode = 'none'
    this.attackLineLayer.addChild(this.attackLine)
    this.gameplayLayer.addChild(this.attackLineLayer)
    this.gameplayLayer.addChild(this.remoteTargetPreview)
    this.cardSelectionOverlay = new CardSelectionOverlay({
      renderer: options.renderer,
      toggleTexture: options.gameAssets.toggleViewButton,
      cardBackTexture: options.gameAssets.cardBack,
      createSlot: (card, sourceInstanceId) => this.createSlot(card, sourceInstanceId),
      createHeroPowerChoice: (heroPowerId, premium) => {
        const definition = HERO_POWER_CATALOG.require(heroPowerId)
        return new HeroPowerCardView(
          definition,
          definition.cost,
          options.gameAssets[definition.presentationAssetKey as HeroPowerAssetKey],
          options.gameAssets.discoverHistoryHeroPower,
          { premium }
        )
      },
      heroPowerChoicePremium: (participantId, sourceCardInstanceId) =>
        this.heroPowerChoicePremium(participantId, sourceCardInstanceId),
      onSelect: (card) => this.chooseDiscoverCard(card),
      onChooseOption: (choice) => this.chooseVisibleCardOption(choice),
      isInputBlocked: () => this.cardChoiceInputGate.blocked
    })
    this.cardPlay = new GameCardTargeting(
      options.gameAssets,
      this.hand,
      this.attackLine,
      this.cardSelectionOverlay,
      this.logger,
      {
        localParticipantId: () => this.localParticipantId,
        getPlayInput: (instanceId, choice) =>
          this.match.getPlayInput?.(this.localParticipantId, instanceId, choice),
        previewPosition: (position) =>
          this.boardPositions.insertionPosition('local', position),
        presentMinionPreview: (preview) =>
          this.enqueuePresentation(this.match.getState(), () =>
            preview.cancelled || this.destroyed
              ? Promise.resolve(null)
              : this.presentMinionPlayed(
                  this.createMinionTargetPreviewEvent(preview.entry, preview.position),
                  preview.entry.slot,
                  false,
                  true,
                  preview
                )
          ),
        showBoardPreview: (position, owner) => {
          this.boardPositions.preview('local', owner, position)
        },
        clearBoardPreview: (_position, owner) => {
          this.boardPositions.finishEntrance('local', owner)
          this.boardPositions.preview('local', owner, null)
        },
        releaseSummonSlot: (slot) => {
          this.activeSummonSlots.delete(slot)
        },
        syncAttackability: () => this.syncBoardAttackability(this.match.getState()),
        syncControls: () => this.syncTurnControls(this.match.getState()),
        syncHud: () => this.syncTurnHud(this.match.getState()),
        hideBoardCardPreview: () => this.hideBoardCardPreview(),
        deselectAttacker: () => this.deselectAttacker(),
        cancelHeroPowerTargeting: () => this.cancelHeroPowerTargeting(),
        cancelCardGesture: () => {
          this.targetGestures.cancel((source) => source.kind === 'card')
        },
        submitPendingCard: () => this.commitPendingCardPlay(),
        findTargetAt: (x, y) => this.findTargetableCharacterAt(x, y),
        hasSession: () => Boolean(this.session),
        isDisposed: () => this.destroyed
      },
      options.cursor
    )
    this.gameplayLayer.addChild(this.cardPlay.cardChoiceLayer)
    this.cardSelectionOverlay.label = 'game.card-selection'
    this.gameplayLayer.addChild(this.cardSelectionOverlay)
    // Discover draws its own shadows above the modal dimmer.
    this.shadowLayer.exclude(this.cardSelectionOverlay)

    this.fatigueView = new FatigueView(options.gameAssets.fatigue)
    this.addChild(this.fatigueView)
    this.secretRevealView = new SecretRevealView(
      options.gameAssets.secretRevealedScreen
    )
    this.addChild(this.secretRevealView)
    this.matchResultOverlay = new MatchResultOverlay({
      winScreen: options.gameAssets.winScreen,
      defeatScreen: options.gameAssets.defeatScreen,
      arcaneDust: options.gameAssets.arcaneDust,
      onContinue: () => options.onMatchComplete?.()
    })
    this.addChild(this.matchResultOverlay)
    this.remoteHandLayer.visible = false
    this.travelLayer.sortableChildren = true
    this.deckLayer.sortableChildren = true
    this.eventMode = 'static'
    this.hitArea = new Rectangle(0, 0, 1920, 1080)
    this.on('globalpointermove', (event: FederatedPointerEvent) =>
      this.handleBoardPointerMove(event)
    )
    this.on('pointerleave', () => {
      this.pendingBoardPointer = null
      this.updateHeroPowerHover(null)
      this.hoverPreview.cancel()
    })
    this.on('pointerup', this.handleBoardPointerUp)
    this.on('pointerupoutside', this.handleBoardPointerUp)
    this.on('pointerdown', (event: FederatedPointerEvent) => {
      if (event.button === 2) {
        this.cancelHeroPowerTargeting()
        this.cardPlay.cancelCardTargeting()
        this.deselectAttacker()
      }
    })
    this.on('pointertap', (event: FederatedPointerEvent) => {
      if (this.consumeCardPlacementTap(event)) return
      if (this.consumeTargetGestureTap(event)) return
      if (
        !this.selectedCombatView &&
        !this.heroPowerTargeting &&
        !this.cardPlay.current
      )
        return
      if (event.button !== 0) return
      if (
        this.cardPlay.current?.presentation.kind === 'minion-preview' &&
        this.cardPlay.current.presentation.preview.cancelled === true
      )
        return
      let target = event.target instanceof Container ? event.target : null
      while (
        target &&
        target !== this &&
        !target.label?.startsWith('game.minion.') &&
        !target.label?.startsWith('game.hero.') &&
        !target.label?.startsWith('game.card-choice') &&
        !target.label?.startsWith('game.card-selection') &&
        target.label !== 'game.heroes'
      ) {
        target = target.parent
      }
      const isCharacterTarget =
        target?.label?.startsWith('game.minion.') ||
        target?.label?.startsWith('game.hero.')
      if (isCharacterTarget) return
      const targetLabel = target?.label
      // Click on empty board or hand background while targeting cancels.
      // Minion clicks are handled by wireMinionView already.
      if (
        target === this ||
        targetLabel === 'game.board-minions-local' ||
        targetLabel === 'game.board-minions-remote' ||
        targetLabel === 'game.equipped-weapons' ||
        targetLabel === 'game.heroes'
      ) {
        this.cancelHeroPowerTargeting()
        this.cardPlay.cancelCardTargeting()
        this.deselectAttacker()
      }
    })
  }

  async mount(): Promise<void> {
    window.addEventListener('resize', this.invalidateCanvasBounds)
    window.addEventListener('scroll', this.invalidateCanvasBounds, true)
    this.options.renderer.on('resize', this.invalidateCanvasBounds)
    if (typeof ResizeObserver !== 'undefined') {
      this.canvasResizeObserver = new ResizeObserver(this.invalidateCanvasBounds)
      this.canvasResizeObserver.observe(
        this.options.renderer.canvas as HTMLCanvasElement
      )
    }
    this.session =
      this.options.aiRuntime?.session ??
      new GameBoardSession({
        setup: this.options.route.setup,
        decks: this.options.decks
      })
    this.aiController =
      this.options.aiRuntime?.controller ??
      new AiTurnController({
        api: this.options.ai,
        session: this.session,
        logger: this.logger
      })
    const initialState = this.match.getState()
    for (const participant of this.options.route.setup.participants) {
      const deck = this.options.decks.find(
        (candidate) => candidate.id === participant.deckId
      )
      if (deck)
        this.premiumAppearance.setStartingDeck(participant.participantId, deck.cards)
    }
    this.premiumAppearance.rememberState(initialState)
    if (initialState.phase === 'mulligan') {
      this.aiMulliganStartedAt = performance.now()
      this.aiMulliganResolution = this.resolveAiMulligan(
        this.aiController.chooseMulligan()
      )
    } else {
      this.aiMulliganResolution = null
    }

    this.historyView = new MatchHistoryView(
      {
        local: this.options.gameAssets.historyLocal,
        remote: this.options.gameAssets.historyRemote,
        localAttack: this.options.gameAssets.historyLocalAttack,
        localTrigger: this.options.gameAssets.historyLocalTrigger,
        remoteAttack: this.options.gameAssets.historyRemoteAttack,
        remoteTrigger: this.options.gameAssets.historyRemoteTrigger,
        arrow: this.options.gameAssets.historyArrow,
        burnCard: this.options.gameAssets.historyBurnCard,
        burnThumb: this.options.gameAssets.historyBurnThumb,
        damageIndicator: this.options.gameAssets.damageIndicator,
        healIndicator: this.options.gameAssets.healIndicator,
        willDie: this.options.gameAssets.minionWillDie,
        secretCard: this.options.gameAssets.historySecretCard,
        secretThumb: this.options.gameAssets.historySecretThumb,
        fatigueCard: this.options.gameAssets.historyFatigueCard,
        fatigueThumb: this.options.gameAssets.historyFatigueThumb,
        cardBack: this.options.gameAssets.cardBack,
        heroAttack: this.options.gameAssets.minionAttack,
        heroHealth: this.options.gameAssets.minionHealth,
        heroArmor: this.options.gameAssets.heroArmor,
        heroFrames: this.options.heroAssets,
        heroPowers: this.options.gameAssets,
        heroPowerCardFrame: this.options.gameAssets.discoverHistoryHeroPower
      },
      this.localParticipantId,
      (active) => this.setHistoryBoardDesaturated(active),
      (snapshot) =>
        snapshot.cardId
          ? this.premiumAppearance.resolve(
              {
                instanceId: snapshot.id,
                cardId: snapshot.cardId,
                ownerId: snapshot.ownerId
              },
              snapshot.participantId
            )
          : false,
      (snapshot) =>
        this.premiumAppearance.sideFor(
          { instanceId: snapshot.id, ownerId: snapshot.ownerId },
          snapshot.participantId
        ),
      this.options.renderer
    )
    this.matchBackdropLayer.addChild(this.historyView)
    // Keep expanded history above gameplay, but its rail below hand cards.
    this.gameplayLayer.addChildAt(
      this.historyView.rail,
      this.gameplayLayer.getChildIndex(this.hand.layer)
    )

    this.createBoard()
    this.createHeroes(initialState)
    if (initialState.phase !== 'mulligan')
      for (const player of initialState.players)
        if (player.quest)
          this.revealedOpeningQuestParticipants.add(player.participantId)
    this.syncSecrets(initialState)
    this.createHeroPowers(initialState)
    this.createDecks()
    this.createOpeningLayer(initialState)
    this.mulligan.createLayer()
    this.createTurnControls(initialState)

    if (this.options.gameAssets.arrowBody) {
      this.attackLine.setBodyTexture(this.options.gameAssets.arrowBody)
    }
    // The global settings shortcut is registered before route-created game boards.
    // Capture Escape first so an active targeting interaction can consume it.
    window.addEventListener('keydown', this.handleWindowKeyDown, true)

    const localPlayer = this.findPlayer(initialState, this.localParticipantId)
    const remotePlayer = this.findPlayer(initialState, this.remoteParticipantId)
    await this.createInitialLocalCards(localPlayer.hand.map(cloneCard))
    this.remoteBackCount = remotePlayer.hand.length
    this.ensureRemoteBacks(this.remoteBackCount)

    this.mulligan.createControls()
    if (initialState.phase === 'turns') await this.prepareStartedMatch()
  }

  async playOpeningReveal(): Promise<void> {
    if (this.openingRevealStarted) return
    this.openingRevealStarted = true
    if (this.match.getState().phase === 'turns') {
      this.startInitialTurn()
      return
    }
    await this.wait(OPENING_TIMING.versusHold)
    await Promise.all([
      ...[...this.heroViews.entries()].map(([participantId, view]) =>
        this.animateHeroToBoard(
          view,
          participantId === this.localParticipantId
            ? GAME_BOARD_LAYOUT.heroes.local
            : GAME_BOARD_LAYOUT.heroes.remote
        )
      ),
      this.fadeTo(this.openingLayer, 0, OPENING_TIMING.heroSettle)
    ])
    this.openingLayer.visible = false
    this.setHeroHealthVisible(true)
    this.remoteHandLayer.visible = true
    await this.wait(OPENING_TIMING.boardPause)
    if (this.match.getState().phase === 'mulligan') {
      await this.presentMulligan()
      return
    }

    await this.completeLocalMulliganPresentation()
    this.startInitialTurn()
  }

  private async prepareStartedMatch(): Promise<void> {
    this.openingLayer.visible = false
    for (const [participantId, view] of this.heroViews) {
      const placement =
        participantId === this.localParticipantId
          ? GAME_BOARD_LAYOUT.heroes.local
          : GAME_BOARD_LAYOUT.heroes.remote
      applyPlacement(view, placement)
      view.setBaseScale(placement.scale?.x ?? 1)
    }
    this.setHeroHealthVisible(true)
    this.remoteHandLayer.visible = true
    for (const back of this.remoteBacks) back.alpha = 1

    for (const entry of this.hand.entries) {
      this.hand.layer.addChild(entry.slot)
      this.hand.configureSlot(entry.slot)
    }
    await this.hand.applyLayout({ positionDuration: 0, scaleDuration: 0 })
    this.hand.activate()
  }

  private startInitialTurn(): void {
    const activePlayerId = this.match.getState().activePlayerId
    for (const event of this.match.getState().openingHistory ?? []) {
      this.recordOpeningHistory(event)
    }
    if (activePlayerId) {
      this.syncTurnHud(this.match.getState())
      this.handleTurnStarted(activePlayerId)
    }
  }

  /** Development benchmark hook that follows the normal mulligan command path. */
  async devConfirmMulligan(): Promise<void> {
    await this.confirmMulligan()
  }

  /** Read-only fixture geometry; the benchmark sends actual browser pointer events. */
  devGetHandInteractionSnapshot(): HandInteractionSnapshot {
    if (!import.meta.env.DEV)
      throw new Error('Development interaction inspection is unavailable.')
    const { localTurn } = this.session.getInteractionSnapshot()
    const dragIndex = this.hand.drag.index
    const entry = dragIndex === null ? undefined : this.hand.entries[dragIndex]
    const pointer = this.hand.drag.pointer
    const position = entry ? this.hand.layer.toGlobal(entry.slot.position) : null
    const desired =
      entry && pointer
        ? this.hand.layer.toGlobal({
            x:
              pointer.x -
              (DEFAULT_HAND_DRAG.grabAnchor.x - 0.5) *
                CARD_CANVAS.width *
                entry.slot.scale.x,
            y:
              pointer.y +
              (1 - DEFAULT_HAND_DRAG.grabAnchor.y) *
                CARD_CANVAS.height *
                entry.slot.scale.x
          })
        : null
    const row = GAME_BOARD_LAYOUT.boardMinions.local
    const hero = this.heroViews.get(this.remoteParticipantId)
    return {
      ready:
        this.hand.active &&
        !this.hand.isReflowing &&
        !this.presentationQueue.busy &&
        !this.turnInProgress,
      localTurn,
      hand: this.hand.entries.flatMap((candidate) => {
        const rest = candidate.restTransform
        if (!rest || candidate.slot.parent !== this.hand.layer) return []
        const point = this.hand.layer.toGlobal({
          x: rest.x,
          y: Math.min(rest.y - 40, GAME_HEIGHT - 20)
        })
        return [
          {
            instanceId: candidate.card.instanceId,
            cardId: candidate.card.cardId,
            x: point.x,
            y: point.y
          }
        ]
      }),
      dragging: dragIndex !== null,
      targeting: this.cardPlay.current !== null || this.heroPowerTargeting,
      boardPoint: this.gameplayLayer.toGlobal({ x: row.centerX, y: row.baselineY }),
      remoteHeroPoint:
        hero?.getGlobalPosition() ??
        this.gameplayLayer.toGlobal({ x: GAME_WIDTH / 2, y: 200 }),
      ...(position && desired
        ? {
            dragged: {
              x: position.x,
              y: position.y,
              targetX: desired.x,
              targetY: desired.y
            }
          }
        : {})
    }
  }

  async devWaitForPresentationIdle(): Promise<void> {
    if (!import.meta.env.DEV)
      throw new Error('Development interaction inspection is unavailable.')
    const deadline = performance.now() + 15_000
    while (
      !this.destroyed &&
      (this.presentationQueue.busy ||
        this.turnInProgress ||
        this.hand.isReflowing ||
        this.hand.drag.returning ||
        this.resolutionPresentationDepth > 0)
    ) {
      if (performance.now() >= deadline)
        throw new Error('Timed out waiting for match presentation to settle.')
      await new Promise<void>((resolve) => window.setTimeout(resolve, 16))
    }
  }

  /** Exercises hover, drag snapshotting, and targeted-card presentation. */
  async devExerciseHandInteraction(): Promise<void> {
    if (!this.hand.active)
      throw new Error('Hand interaction requires the completed opening sequence.')
    const playableIds = new Set(
      this.match.getLegality?.(this.localParticipantId).playableCardInstanceIds ?? []
    )
    const index = this.hand.entries.findIndex((entry) =>
      playableIds.has(entry.card.instanceId)
    )
    const entry = this.hand.entries[index]
    if (!entry?.restTransform)
      throw new Error('No playable benchmark card is available.')

    this.hand.hoverForBenchmark(entry.slot)
    this.hand.applyHoverDelta()
    await this.wait(0.25)

    const pointerId = -1
    const start = { x: entry.restTransform.x, y: entry.restTransform.y }
    const moved = { x: start.x + 90, y: start.y - 150 }
    this.hand.drag.begin(index, start, pointerId)
    this.hand.drag.moveForBenchmark(moved)
    await this.wait(0.5)

    if (this.tryActivateDraggedCardTargeting(entry, moved, pointerId)) {
      await this.wait(0.5)
      this.cardPlay.cancelCardTargeting(moved)
    } else {
      this.hand.drag.end()
    }
    await this.wait(OPENING_TIMING.hover + 0.15)
  }

  private createBoard(): void {
    const board = new Sprite(
      selectRandomBoardTexture([
        this.options.gameAssets.board1,
        this.options.gameAssets.board2,
        this.options.gameAssets.board3,
        this.options.gameAssets.board4,
        this.options.gameAssets.board5,
        this.options.gameAssets.board6,
        this.options.gameAssets.board7,
        this.options.gameAssets.board8,
        this.options.gameAssets.board9
      ])
    )
    applyAnchoredPlacement(board, GAME_BOARD_LAYOUT.board)
    board.eventMode = 'none'
    this.boardLayer.addChild(board)
  }

  private createHeroes(state: OpeningMatchState): void {
    for (const player of state.players) {
      const texture =
        this.options.heroAssets[
          HERO_CATALOG.require(player.heroId).presentationAssetKey
        ]
      const intro =
        player.participantId === this.localParticipantId
          ? GAME_BOARD_LAYOUT.heroes.localIntro
          : GAME_BOARD_LAYOUT.heroes.remoteIntro
      const view = HeroView.create(
        {
          label: `game.hero.${player.participantId}`,
          attack: getHeroAttack(player),
          health: player.hero.health,
          maxHealth: player.hero.maxHealth,
          armor: player.hero.armor,
          frozen: isFrozen(player.hero.frozenUntilTurn, state.turnNumber),
          immune: player.hero.immune === true
        },
        {
          frame: texture,
          attack: this.options.gameAssets.minionAttack,
          health: this.options.gameAssets.minionHealth,
          armor: this.options.gameAssets.heroArmor,
          frozen: this.options.gameAssets.heroFrozen,
          immune: this.options.gameAssets.heroImmune
        }
      )
      applyPlacement(view, intro)
      const resting =
        player.participantId === this.localParticipantId
          ? GAME_BOARD_LAYOUT.heroes.local
          : GAME_BOARD_LAYOUT.heroes.remote
      view.shadow.restingScale = resting.scale?.x ?? 1
      view.ownerId = player.participantId
      view.eventMode = 'none'
      this.wireHeroView(view)
      this.heroViews.set(player.participantId, view)
      this.heroLayer.addChild(view)
    }
  }

  /** Builds both face-up hero power cards in their final board positions. */
  private createHeroPowers(state: OpeningMatchState): void {
    for (const player of state.players) {
      const heroPower = HERO_POWER_CATALOG.require(player.heroPower.id)
      const artworkTexture =
        this.options.gameAssets[heroPower.presentationAssetKey as HeroPowerAssetKey]
      const isLocal = player.participantId === this.localParticipantId
      const premium = this.heroPowerPremiumFor(player)
      this.premiumAppearance.setHeroPowerPremium(player.participantId, premium)
      const layout: HeroPowerLayout = {
        card: isLocal
          ? GAME_BOARD_LAYOUT.heroPowers.local
          : GAME_BOARD_LAYOUT.heroPowers.remote,
        crystalOffset: GAME_BOARD_LAYOUT.heroPowers.manaOverlay.crystalOffset,
        costOffset: GAME_BOARD_LAYOUT.heroPowers.manaOverlay.costOffset
      }
      const view = new HeroPowerView({
        layout,
        backTexture: this.options.gameAssets.heroPowerBack,
        premiumBackTexture: this.options.gameAssets.premiumHeroPowerBack,
        frontFrameTexture: this.options.gameAssets.heroPowerFront,
        premiumFrameTexture: this.options.gameAssets.premiumHeroPowerFront,
        artworkTexture,
        manaTexture: this.options.gameAssets.heroPowerMana,
        cost: player.heroPower.cost,
        premium,
        onPointerDown: isLocal ? (event) => this.beginHeroPowerDrag(event) : undefined,
        onClick: isLocal
          ? (event) => {
              if (this.consumeTargetGestureTap(event)) return
              void this.useHeroPower()
            }
          : undefined
      })
      view.label = `game.hero-power.${player.participantId}`
      this.heroPowerViews.set(player.participantId, view)
      this.heroPowerLayer.addChild(view)
    }
  }

  private createDecks(): void {
    for (const [participantId, position] of [
      [this.localParticipantId, GAME_BOARD_LAYOUT.decks.local],
      [this.remoteParticipantId, GAME_BOARD_LAYOUT.decks.remote]
    ] as const) {
      const deck = new Sprite(this.options.gameAssets.deck)
      applyAnchoredPlacement(deck, position)
      deck.label = `game.deck.${participantId}`
      deck.eventMode = 'static'
      const side = participantId === this.localParticipantId ? 'local' : 'remote'
      deck.on('pointerover', () => this.hud.deckInfo?.show(side, deck))
      deck.on('pointerout', () => this.hud.deckInfo?.hide(side))
      this.deckViews.set(participantId, deck)
      this.deckLayer.addChild(deck)
    }
  }

  /** Shows the first player's turn label immediately; resource HUD waits for turn one. */
  private createTurnControls(state: OpeningMatchState): void {
    const initialPlayerId = state.activePlayerId ?? state.playerOneId
    this.hud.mount(
      this.options.gameAssets,
      () => void this.endTurn(),
      initialPlayerId === this.localParticipantId
        ? this.options.gameAssets.endTurn
        : this.options.gameAssets.enemyTurn
    )
    this.addChild(this.hud.deckTracker)
    this.syncTurnHud(state)
    this.syncTurnControls(state)
  }

  /** Refreshes deck textures, positions, and card-count labels from the engine state. */
  private syncDeckCounts(state: OpeningMatchState): void {
    for (const player of state.players) {
      const deck = this.deckViews.get(player.participantId)
      if (deck) {
        const side =
          player.participantId === this.localParticipantId ? 'local' : 'remote'
        const empty = player.deck.length === 0
        deck.texture = empty
          ? this.options.gameAssets.fatigueDeck
          : this.options.gameAssets.deck
        deck.x =
          GAME_BOARD_LAYOUT.decks[side].position.x +
          (empty ? GAME_BOARD_LAYOUT.decks.fatigueOffsetX[side] : 0)
      }
    }
    this.hud.sync(
      state,
      (snapshot, participantId) => this.findPlayer(snapshot, participantId),
      { local: this.localParticipantId, remote: this.remoteParticipantId },
      this.localManaHighlightCost()
    )
  }

  /** Refreshes both "available/maximum" mana labels from the engine state. */
  private syncMana(state: OpeningMatchState): void {
    this.hud.sync(
      state,
      (snapshot, participantId) => this.findPlayer(snapshot, participantId),
      { local: this.localParticipantId, remote: this.remoteParticipantId },
      this.localManaHighlightCost()
    )
  }

  private syncManaTray(state: OpeningMatchState): void {
    this.syncMana(state)
  }

  /**
   * Cost of the hand card currently dragged or hovered, or null when no card
   * is selected — or when it is not the local turn / the card is not
   * affordable (an unaffordable card never lights the tray, like the "no"
   * shake it gets on pickup).
   */
  private localManaHighlightCost(): number | null {
    if (!this.isLocalTurn()) return null
    const draggingEntry =
      this.hand.drag.index === null
        ? undefined
        : this.hand.entries[this.hand.drag.index]
    const hoveredEntry = this.hand.hoveredSlot
      ? this.hand.entries.find((entry) => entry.slot === this.hand.hoveredSlot)
      : undefined
    const entry = draggingEntry ?? hoveredEntry
    if (!entry) return null
    const input = this.match.getPlayInput?.(
      this.localParticipantId,
      entry.card.instanceId
    )
    const legality = this.match.getLegality?.(this.localParticipantId)
    if (!input || !legality?.playableCardInstanceIds.includes(entry.card.instanceId)) {
      return null
    }
    return input.currentCost
  }

  /** Refreshes every turn HUD element (deck counts and mana labels). */
  private syncTurnHud(
    state: OpeningMatchState,
    options: { readonly skipWeaponSync?: boolean } = {}
  ): void {
    state = this.randomSpellState ?? state
    this.syncMatchCursor(state)
    this.syncDeckCounts(state)
    this.syncLocalHandCards(state)
    this.syncPlayableCardOutlines()
    this.syncHeroPowerViews(state)
    if (!options.skipWeaponSync) this.syncWeaponViews(state)
    this.syncBoardAttackability(state)
    this.updateDeckTracker(state)
  }

  /** Keeps hand stats, costs, and rules text derived from authoritative state. */
  private syncLocalHandCards(state: OpeningMatchState): void {
    const player = this.findPlayer(state, this.localParticipantId)
    for (const entry of this.hand.entries) {
      const card = player.hand.find(
        (candidate) => candidate.instanceId === entry.card.instanceId
      )
      if (!card) continue
      entry.card = cloneCard(card)
      const definition = cardDefinition(card)
      const baseCost = card.baseCost ?? definition.cost
      const currentCost = card.currentCost ?? baseCost
      entry.slot.card.applySnapshot(definition, {
        attack:
          card.attack ?? (definition.type === 'Minion' ? definition.attack : undefined),
        health:
          card.health ?? (definition.type === 'Minion' ? definition.health : undefined)
      })
      entry.slot.card.setRulesText(
        cthunCardRulesText(card, spellDamageRulesText(definition, player))
      )
      entry.slot.card.setManaCost(currentCost)
      entry.slot.card.setManaCostColor(cardCostColor(baseCost, currentCost))
    }
  }

  /** Keeps an equipped weapon view synchronized with authoritative match state. */
  private syncWeaponViews(state: OpeningMatchState): void {
    for (const player of state.players) {
      const view = this.weaponViews.get(player.participantId)
      if (player.weapon) {
        view?.setStats(player.weapon.attack, player.weapon.durability)
        continue
      }
      if (!view) continue
      this.removeWeaponView(player.participantId, view)
    }
    this.refreshHoveredBoardCardPreview()
  }

  /**
   * Refreshes each hero power card from engine state: the effective cost and
   * the local card's interactivity. The local card is clickable only while it
   * is the local turn, the power is still available, and the local mana can
   * afford it; the remote card is never clickable.
   */
  private syncHeroPowerViews(state: OpeningMatchState): void {
    for (const player of state.players) {
      const view = this.heroPowerViews.get(player.participantId)
      if (!view) continue
      view.setCost(player.heroPower.cost)
      view.setCostColor(
        cardCostColor(
          player.heroPower.baseCost ?? player.heroPower.cost,
          player.heroPower.cost
        )
      )
      const legality = this.match.getLegality?.(player.participantId)
      view.setEnabled(
        player.participantId === this.localParticipantId &&
          !this.cardPlay.current &&
          !this.isGameplayBlocked(state) &&
          legality?.legalHeroPower === true
      )
    }
    this.refreshHoveredHeroPowerPreview()
  }

  /** Choices and automatic spell sequences block gameplay, while inspection remains available. */
  private isGameplayBlocked(state: OpeningMatchState = this.match.getState()): boolean {
    return (
      this.randomSpellRevision !== null ||
      state.pendingDiscover?.participantId === this.localParticipantId ||
      state.pendingCardChoice?.participantId === this.localParticipantId
    )
  }

  private async useHeroPower(): Promise<void> {
    if (this.turnInProgress || this.cardPlay.current || this.isGameplayBlocked()) return
    const local = this.findPlayer(this.match.getState(), this.localParticipantId)
    const targeting =
      local.heroPower.targetingGranted ??
      local.heroPower.targetType ??
      HERO_POWER_CATALOG.require(local.heroPower.id).targeting
    if (targeting !== 'none') {
      if (this.heroPowerTargeting) {
        this.cancelHeroPowerTargeting()
        return
      }
      this.deselectAttacker()
      this.hand.clearHover()
      this.heroPowerTargeting = true
      this.hideBoardCardPreview()
      this.options.cursor?.setTargeting(true)
      if (this.options.gameAssets.arrowBody) {
        this.attackLine.setBodyTexture(this.options.gameAssets.arrowBody)
      }
      this.syncTurnControls(this.match.getState())
      this.syncBoardAttackability(this.match.getState())
      return
    }
    await this.commitHeroPower()
  }

  private async commitHeroPower(target?: HeroPowerTargetRef): Promise<void> {
    if (this.cardPlay.current) return
    const result = this.dispatchCommand({
      type: 'use-hero-power',
      participantId: this.localParticipantId,
      ...(target ? { target } : {})
    })
    if (!result.accepted) {
      this.logger.error(result.message)
      this.heroPowerViews.get(this.localParticipantId)?.playUnavailable()
      this.cancelHeroPowerTargeting()
      this.syncTurnHud(this.match.getState())
      this.syncTurnControls(this.match.getState())
      return
    }
    this.cancelHeroPowerTargeting()
    this.syncTurnHud(result.state)
    try {
      await this.enqueuePresentation(result.state, () =>
        this.presentResolutionEvents(result.events)
      )
    } finally {
      this.syncTurnHud(this.match.getState())
      this.syncTurnControls(this.match.getState())
    }
  }

  private cancelHeroPowerTargeting(): void {
    this.targetGestures.cancel((source) => source.kind === 'hero-power')
    if (!this.heroPowerTargeting) return
    this.heroPowerTargeting = false
    this.attackLine.clear()
    this.options.cursor?.setTargeting(false)
    if (this.session) {
      this.syncBoardAttackability(this.match.getState())
      this.syncTurnControls(this.match.getState())
    }
  }

  private beginClickedCardTargeting(cardInstanceId: string): void {
    if (this.cardPlay.current) return
    const entry = this.hand.entries.find(
      (candidate) => candidate.card.instanceId === cardInstanceId
    )
    if (!entry || cardDefinition(entry.card).type === 'Minion') return
    const input = this.match.getPlayInput?.(this.localParticipantId, cardInstanceId)
    if (!input || !allowsDragTargetingFromHand(cardDefinition(entry.card).type, input))
      return
    this.cardPlay.beginCardTargeting(entry, input)
  }

  private commitTargetGestureRelease(
    source: BoardTargetGestureSource,
    pointer: HandPointer
  ): void {
    if (source.kind === 'combat') {
      if (this.selectedCombatView !== source.attacker) return
      const target = this.findRemoteCombatTargetAt(pointer.x, pointer.y)
      if (target) void this.attackCharacter(target)
      else this.deselectAttacker()
      return
    }
    if (source.kind === 'hero-power') {
      if (!this.heroPowerTargeting) return
      const target = this.findTargetableCharacterAt(pointer.x, pointer.y)
      if (target && this.isValidHeroPowerTarget(target)) {
        if (target instanceof HeroView && target.ownerId) {
          void this.commitHeroPower({
            kind: 'hero',
            participantId: target.ownerId as PlayerId
          })
          return
        }
        if (target instanceof MinionView && target.ownerId && target.instanceId) {
          void this.commitHeroPower({
            kind: 'minion',
            participantId: target.ownerId as PlayerId,
            instanceId: target.instanceId
          })
          return
        }
      }
      this.cancelHeroPowerTargeting()
      return
    }
    if (
      !this.cardPlay.current ||
      this.cardPlay.current.cardInstanceId !== source.cardInstanceId
    )
      return
    if (this.cardPlay.commitCardTargetAt(pointer)) return
    if (
      pendingCardInputStage(
        this.cardPlay.current.input,
        this.cardPlay.current.choice,
        this.cardPlay.current.targets.length
      ) === 'choice'
    )
      return
    this.cardPlay.cancelCardTargeting(pointer)
  }

  private createMinionTargetPreviewEvent(
    entry: HandEntry,
    position: number
  ): Extract<OpeningMatchEvent, { type: 'minion-played' }> {
    const definition = cardDefinition(entry.card)
    if (definition.type !== 'Minion') {
      throw new Error('A minion target preview requires a minion card.')
    }
    const keywords = [...definition.keywords]
    const minion: BoardMinion = {
      instanceId: entry.card.instanceId,
      cardId: definition.id,
      attack: entry.card.attack ?? definition.attack,
      health: entry.card.health ?? definition.health,
      maxHealth: entry.card.health ?? definition.health,
      summonedOnTurn: this.match.getState().turnNumber,
      lastAttackedOnTurn: null,
      ownerId: this.localParticipantId,
      controllerId: this.localParticipantId,
      creationOrdinal: entry.card.creationOrdinal,
      baseAttack: definition.attack,
      baseHealth: definition.health,
      keywords,
      enchantments: entry.card.enchantments,
      silenced: false,
      frozenUntilTurn: null,
      divineShield: keywords.includes('divine-shield'),
      stealth: keywords.includes('stealth'),
      immune: keywords.includes('immune'),
      spellImmune: keywords.includes('spell-immune'),
      attacksUsedThisTurn: 0,
      maxAttacksPerTurn: keywords.includes('mega-windfury')
        ? 4
        : keywords.includes('windfury')
          ? 2
          : 1
    }
    return {
      type: 'minion-played',
      participantId: this.localParticipantId,
      minion,
      position
    }
  }

  private chooseDiscoverCard(card: OpeningCard): void {
    const result = this.dispatchCommand({
      type: 'choose-discover-card',
      participantId: this.localParticipantId,
      cardInstanceId: card.instanceId
    })
    if (!result.accepted) {
      this.logger.error(result.message)
      void this.restorePendingChoice()
      return
    }
    void this.enqueuePresentation(result.state, () =>
      this.presentResolutionEvents(result.events)
    ).finally(() => {
      this.syncTurnHud(this.match.getState())
      this.syncTurnControls(this.match.getState())
    })
  }

  private chooseVisibleCardOption(choice: number): void {
    if (this.cardPlay.current) {
      this.cardPlay.chooseCardPlayOption(choice)
      return
    }
    const pending = this.match.getState().pendingCardChoice
    if (!pending || pending.participantId !== this.localParticipantId) return
    const result = this.dispatchCommand({
      type: 'choose-card-option',
      participantId: this.localParticipantId,
      sourceCardInstanceId: pending.sourceCardInstanceId,
      choice
    })
    if (!result.accepted) {
      this.logger.error(result.message)
      void this.restorePendingChoice()
      return
    }
    this.cardSelectionOverlay.clear()
    void this.enqueuePresentation(result.state, () =>
      this.presentResolutionEvents(result.events)
    ).finally(() => {
      this.syncTurnHud(this.match.getState())
      this.syncTurnControls(this.match.getState())
    })
  }

  private async restorePendingChoice(): Promise<void> {
    if (this.destroyed || this.matchResultShown) return
    const state = this.match.getState()
    try {
      if (state.pendingDiscover?.participantId === this.localParticipantId) {
        await this.cardSelectionOverlay.show(state.pendingDiscover.candidates)
      } else if (state.pendingCardChoice?.participantId === this.localParticipantId) {
        const pending = state.pendingCardChoice
        await this.cardSelectionOverlay.showChoices(
          pending.participantId,
          pending.sourceCardInstanceId,
          pending.sourceCardId,
          pending.options
        )
      } else {
        this.cardSelectionOverlay.clear()
      }
    } catch (error) {
      this.logger.error('[GameBoardView] failed to restore pending choices', error)
    }
  }

  private findTargetableCharacterAt(x: number, y: number): CombatView | null {
    const pendingPreview = this.cardPlay.minionTargetPreview()?.presentation
    const candidates: readonly CombatView[] = [
      ...this.localMinionViews,
      ...this.remoteMinionViews,
      ...(pendingPreview ? [pendingPreview.view] : []),
      ...this.heroViews.values()
    ]
    return (
      candidates.find((view) => {
        if (!view.isTargetable()) return false
        const bounds = view.getBounds()
        return (
          x >= bounds.x &&
          x <= bounds.x + bounds.width &&
          y >= bounds.y &&
          y <= bounds.y + bounds.height
        )
      }) ?? null
    )
  }

  private commitPendingCardPlay(): void {
    const targeting = this.cardPlay.current
    if (!targeting || this.hand.drag.returning) return
    const pendingPreview = this.cardPlay.minionTargetPreview(targeting)
    if (
      !canCommitPendingCardPlay(
        targeting.input,
        targeting.choice,
        targeting.targets.length,
        pendingPreview?.ready ?? true
      )
    )
      return

    const index = this.hand.entries.findIndex(
      (entry) => entry.card.instanceId === targeting.cardInstanceId
    )
    const entry = index >= 0 ? this.hand.entries[index] : undefined
    if (!entry) {
      this.cardPlay.cancelCardTargeting()
      return
    }
    const legality = this.match.getLegality?.(this.localParticipantId)
    if (!legality?.playableCardInstanceIds.includes(targeting.cardInstanceId)) {
      this.cardPlay.cancelCardTargeting()
      return
    }

    const minionPreview = pendingPreview?.presentation ?? undefined

    const result = this.dispatchCommand({
      type: 'play-card',
      participantId: this.localParticipantId,
      cardInstanceId: targeting.cardInstanceId,
      ...(targeting.position === undefined ? {} : { position: targeting.position }),
      ...(targeting.targets.length === 0 ? {} : { targets: targeting.targets }),
      ...(targeting.choice === undefined ? {} : { choice: targeting.choice })
    })
    if (!result.accepted) {
      this.logger.error(result.message)
      this.cardPlay.cancelCardTargeting()
      this.syncTurnHud(this.match.getState())
      return
    }

    this.cardPlay.accept()
    this.hand.setReflowing(true)
    this.syncTurnHud(result.state)
    const definition = cardDefinition(entry.card)
    if (definition.type === 'Minion') {
      if (!minionPreview) entry.slot.beginMinionPlayTransition()
      this.boardPositions.preview(
        'local',
        entry.card.instanceId,
        targeting.position ?? null
      )
      void this.enqueuePresentation(result.state, () =>
        this.presentAcceptedMinionPlay(entry, result, minionPreview)
      )
    } else if (definition.type === 'Weapon') {
      void this.enqueuePresentation(result.state, () =>
        this.presentAcceptedWeaponPlay(entry, result)
      )
    } else if (definition.type === 'Hero') {
      void this.enqueuePresentation(result.state, () =>
        this.presentAcceptedHeroPlay(entry, result)
      )
    } else {
      void this.enqueueAcceptedSpellPlay(entry, result)
    }
  }

  /** Shows playable cards, with yellow reserved for active conditional bonuses. */
  private syncPlayableCardOutlines(): void {
    const playableCardInstanceIds = new Set(
      this.match.getLegality?.(this.localParticipantId)?.playableCardInstanceIds ?? []
    )
    const draggingEntry =
      this.hand.drag.index === null
        ? undefined
        : this.hand.entries[this.hand.drag.index]

    for (const entry of this.hand.entries) {
      const canPlay =
        this.randomSpellRevision === null &&
        playableCardInstanceIds.has(entry.card.instanceId)
      const effectPreview = this.match.getPlayInput?.(
        this.localParticipantId,
        entry.card.instanceId
      )?.effectPreview
      entry.slot.setPlayableOutlineEnabled(canPlay)
      entry.slot.setPlayableOutlineEnhanced(
        effectPreview?.conditionallyEnhanced === true
      )
      if (entry === draggingEntry) {
        this.hand.drag.setOutlineEnabled(canPlay)
      }
    }
    if (this.hand.drag.pointer) {
      this.updateDraggedCardDropOutline(this.hand.drag.pointer)
    }
  }

  /** Reflects whose turn it is in the end turn button's texture and enabled state. */
  private syncTurnControls(state: OpeningMatchState): void {
    this.syncMatchCursor(state)
    const endTurnButton = this.hud.endTurnButton
    if (!endTurnButton) return
    const displayedPlayerId =
      state.phase === 'mulligan' ? state.playerOneId : state.activePlayerId
    const isLocalTurn = displayedPlayerId === this.localParticipantId
    const localTurnTexture = isLocalTurn
      ? this.options.gameAssets.endTurn
      : this.options.gameAssets.enemyTurn
    const inputEnabled =
      state.phase === 'turns' &&
      this.turnLayer.visible &&
      isLocalTurn &&
      !this.turnInProgress &&
      !this.heroPowerTargeting &&
      !this.cardPlay.current &&
      !this.isGameplayBlocked(state)
    this.hud.syncEndTurnButton(
      localTurnTexture,
      inputEnabled,
      inputEnabled && !this.localPlayerHasAvailableAction()
    )
  }

  /** Keeps the opponent-turn cursor above all transient match interactions. */
  private syncMatchCursor(state: OpeningMatchState): void {
    const observingOpponentTurn =
      state.phase === 'turns' && state.activePlayerId === this.remoteParticipantId
    this.options.cursor?.setOverrideVariant(observingOpponentTurn ? 'observer' : null)
  }

  /** Whether the local player has a legal card, hero-power, or attack action. */
  private localPlayerHasAvailableAction(): boolean {
    return hasAvailableTurnAction(this.match.getLegality?.(this.localParticipantId))
  }

  /** Freezes the concluded board and presents the local player's match result. */
  private showMatchResult(winnerId: PlayerId | null): void {
    if (this.matchResultShown) return
    this.matchResultShown = true
    this.cardSelectionOverlay.clear()
    this.turnInProgress = true
    this.hand.drag.end()
    this.cancelHeroPowerTargeting()
    this.cardPlay.cancelCardTargeting()
    this.deselectAttacker()
    clearMatchResultCombatViews([
      ...this.heroViews.values(),
      ...this.localMinionViews,
      ...this.remoteMinionViews
    ])
    this.mulligan.setInputEnabled(false)
    this.mulligan.disableConfirmation()
    this.hand.layer.eventMode = 'none'
    this.setHeroHealthVisible(false)

    const blur = new BlurFilter({
      strength: GAME_BOARD_LAYOUT.matchResult.blurStrength,
      quality: 2,
      resolution: 'inherit',
      antialias: 'inherit'
    })
    this.matchResultBlurFilter = blur
    const filters: (BlurFilter | ColorMatrixFilter)[] = [blur]
    const result: MatchResult =
      winnerId === null
        ? 'draw'
        : winnerId === this.localParticipantId
          ? 'win'
          : 'defeat'
    if (result === 'defeat') {
      const grayscale = new ColorMatrixFilter()
      grayscale.desaturate()
      this.matchResultGrayscaleFilter = grayscale
      filters.push(grayscale)
    }
    this.matchBackdropLayer.filters = filters

    const localHero = this.heroViews.get(this.localParticipantId)
    if (!localHero) {
      throw new Error('Cannot show a match result without the local hero view.')
    }
    this.matchResultOverlay.show(result, localHero)
  }

  private async presentMatchResult(event: MatchEndedEvent): Promise<void> {
    if (this.matchResultShown) return
    this.matchResultPending ??= Promise.resolve()
      .then(() => this.saveMatchReward(event))
      .catch((error) => {
        this.logger.warn('Failed to handle match completion.', error)
      })
    await this.matchResultPending
    this.showMatchResult(event.winnerId)
  }

  private async saveMatchReward(event: MatchEndedEvent): Promise<void> {
    try {
      const earned = await this.options.onMatchEnded?.(event)
      if (!this.destroyed) this.matchResultOverlay.setReward(earned ?? 0)
    } catch (error) {
      this.logger.warn('Failed to save match reward.', error)
      if (!this.destroyed)
        this.matchResultOverlay.setRewardFailure(() => this.saveMatchReward(event))
    }
  }

  private setHeroHealthVisible(visible: boolean): void {
    for (const hero of this.heroViews.values()) hero.setHealthVisible(visible)
  }

  /** Updates attacker-ready visuals and target input from authoritative state. */
  private syncBoardAttackability(state: OpeningMatchState): void {
    state = this.randomSpellState ?? state
    this.syncMinionRowAttackability(
      this.localMinionViews,
      state,
      this.localParticipantId
    )
    this.syncMinionRowAttackability(
      this.remoteMinionViews,
      state,
      this.remoteParticipantId
    )
    this.syncHeroAttackability(state, this.localParticipantId)
    this.syncHeroAttackability(state, this.remoteParticipantId)
    this.cardPlay.syncPendingMinionTargetPreview()
  }

  private syncHeroAttackability(state: OpeningMatchState, ownerId: PlayerId): void {
    const player = this.findPlayer(state, ownerId)
    const view = this.heroViews.get(ownerId)
    if (!view) return
    const displayedAttack = state.activePlayerId === ownerId ? getHeroAttack(player) : 0
    // Health and armor advance with presentation events, not input/HUD refreshes.
    view.setAttack(displayedAttack)
    view.setFrozen(isFrozen(player.hero.frozenUntilTurn, state.turnNumber))
    view.setImmune(player.hero.immune === true)
    const heroAttackerId = `${ownerId}:hero`
    const showCanAttack =
      this.randomSpellRevision === null &&
      ownerId === this.localParticipantId &&
      this.match.getLegality?.(this.localParticipantId).legalAttackTargets[
        heroAttackerId
      ] !== undefined
    view.setCanAttack(showCanAttack)
    view.setTargetable(
      this.cardPlay.current
        ? this.cardPlay.isValidCardTarget(view)
        : this.heroPowerTargeting
          ? this.isValidHeroPowerTarget(view)
          : showCanAttack || this.isValidCombatTarget(view)
    )
    view.setTargetingOutline(
      this.cardPlay.current
        ? this.cardPlay.isValidCardTarget(view)
        : this.heroPowerTargeting
          ? this.isValidHeroPowerTarget(view)
          : this.isValidCombatTarget(view)
    )
    if (!showCanAttack && this.selectedCombatView === view) {
      this.deselectAttacker()
    }
  }

  private syncMinionRowAttackability(
    views: readonly MinionView[],
    state: OpeningMatchState,
    ownerId: PlayerId
  ): void {
    for (const view of views) {
      const instanceId = view.instanceId
      if (!instanceId) continue
      const player = this.findPlayer(state, ownerId)
      const minion = player.board.find(
        (candidate) => candidate.instanceId === instanceId
      )
      if (!minion) {
        // A removed minion can remain visible until its death animation finishes.
        view.setCanAttack(false)
        view.setTargetable(false)
        view.setTargetingOutline(false)
        if (this.selectedCombatView === view) this.deselectAttacker(false)
        continue
      }
      const canAttack =
        this.randomSpellRevision === null &&
        ownerId === this.localParticipantId &&
        this.match
          .getLegality?.(this.localParticipantId)
          .legalAttackerInstanceIds.includes(instanceId) === true
      const sleeping = isBoardMinionSleeping(minion as BoardMinion, state.turnNumber)
      // Local player never sees the opponent's attack-ready outline.
      const showCanAttack = canAttack && ownerId === this.localParticipantId
      view.setCanAttack(showCanAttack)
      view.setTargetable(
        this.cardPlay.current
          ? this.cardPlay.isValidCardTarget(view)
          : this.heroPowerTargeting
            ? this.isValidHeroPowerTarget(view)
            : showCanAttack || this.isValidCombatTarget(view)
      )
      view.setTargetingOutline(
        this.cardPlay.current
          ? this.cardPlay.isValidCardTarget(view)
          : this.heroPowerTargeting
            ? this.isValidHeroPowerTarget(view)
            : this.isValidCombatTarget(view)
      )
      view.setSleeping(sleeping && state.phase === 'turns')
      if (sleeping || !showCanAttack) {
        if (this.selectedCombatView === view) this.deselectAttacker()
      }
    }
  }

  /**
   * Projects the domain's exact attack legality into the renderer.  In
   * particular, this keeps heroes and non-Taunt minions out of the red
   * targeting outline (and cursor circle) while any enemy Taunt remains.
   */
  private isValidCombatTarget(view: CombatView): boolean {
    if (this.heroPowerTargeting) return this.isValidHeroPowerTarget(view)
    const attacker = this.selectedCombatView
    if (!attacker || !view.ownerId) return false
    const attackerId =
      attacker instanceof HeroView
        ? `${this.localParticipantId}:hero`
        : attacker.instanceId
    if (!attackerId) return false
    const legalTargets =
      this.match.getLegality?.(this.localParticipantId).legalAttackTargets[
        attackerId
      ] ?? []
    return legalTargets.some((target) =>
      target.kind === 'hero'
        ? view instanceof HeroView && view.ownerId === this.remoteParticipantId
        : view instanceof MinionView && target.instanceId === view.instanceId
    )
  }

  /** Uses domain-derived hero-power targets, including temporary aura changes. */
  private isValidHeroPowerTarget(view: CombatView): boolean {
    if (!view.ownerId) return false
    const candidate =
      view instanceof HeroView
        ? { kind: 'hero' as const, participantId: view.ownerId as PlayerId }
        : view.instanceId
          ? {
              kind: 'minion' as const,
              participantId: view.ownerId as PlayerId,
              instanceId: view.instanceId
            }
          : null
    if (!candidate) return false
    return isLegalHeroPowerTarget(
      this.match.getLegality?.(this.localParticipantId).legalHeroPowerTargets ?? [],
      candidate
    )
  }

  /** Refreshes friendly attackability once the current attack visibly lands. */
  private refreshCombatAttackabilityAfterImpact(): void {
    if (!this.combatInProgress) return
    this.syncBoardAttackability(this.match.getState())
  }

  private selectAttacker(view: CombatView, toggleSelected = true): void {
    if (this.randomSpellRevision !== null) return
    if (!view.isCanAttack()) return
    if (this.selectedCombatView === view) {
      if (toggleSelected) this.deselectAttacker()
      return
    }
    this.combat.clearCombatPreview()
    if (this.selectedCombatView) {
      const previous = this.selectedCombatView
      previous.setSelected(false)
      this.tweenTo(previous, {
        y: previous.y + 12,
        duration: 0.18,
        ease: 'power2.inOut',
        overwrite: 'auto'
      })
      previous.zIndex = 0
    }
    this.selectedCombatView = view
    this.hand.clearHover()
    this.hideBoardCardPreview()
    view.setSelected(true)
    this.tweenTo(view, {
      y: view.y - 12,
      duration: 0.22,
      ease: 'back.out(1.4)',
      overwrite: 'auto'
    })
    this.options.cursor?.setTargeting(true)
    // Ensure body texture is bound before the first pointermove.
    if (this.options.gameAssets.arrowBody) {
      this.attackLine.setBodyTexture(this.options.gameAssets.arrowBody)
    }
    view.zIndex = 100
    this.syncBoardAttackability(this.match.getState())
  }

  private deselectAttacker(animate = true, clearPreview = true): void {
    this.cancelCombatDrag()
    if (clearPreview) this.combat.clearCombatPreview()
    if (this.selectedCombatView) {
      const view = this.selectedCombatView
      view.setSelected(false)
      if (animate) {
        this.tweenTo(view, {
          y: view.y + 12,
          duration: 0.18,
          ease: 'power2.inOut',
          overwrite: 'auto'
        })
      } else if (!(view instanceof MinionView)) {
        this.killTweensOf(view)
        view.y += 12
      }
      // Minion row movement belongs to boardPositions. A queued attack borrows
      // it when combat starts, not while an earlier entrance is still landing.
      view.zIndex = 0
    }
    this.selectedCombatView = null
    this.attackLine.clear()
    this.options.cursor?.setTargeting(false)
    if (!this.combatInProgress) this.syncBoardAttackability(this.match.getState())
  }

  private handleBoardPointerMove(event: FederatedPointerEvent): void {
    if (this.matchResultShown) return
    // Pixi reuses event objects: retain only the sample, never the event itself.
    this.pendingBoardPointer = {
      globalX: event.globalX,
      globalY: event.globalY,
      target: event.target
    }
    // Threshold crossings must survive multiple pointer samples between frames.
    this.updateTargetGesture(event)
  }

  private flushBoardPointerVisuals(): void {
    const event = this.pendingBoardPointer
    this.pendingBoardPointer = null
    if (!event || this.matchResultShown) return
    const canvasBounds = this.getCanvasBounds()
    this.options.cursor?.setTargetingVisualScale(
      Math.min(canvasBounds.width / GAME_WIDTH, canvasBounds.height / GAME_HEIGHT)
    )
    this.updateHeroPowerHover({ x: event.globalX, y: event.globalY })
    if (this.heroPowerTargeting) {
      const power = this.heroPowerViews.get(this.localParticipantId)
      if (!power) return
      // HeroPowerView itself is positioned at the canvas origin; its card is
      // positioned within that view. Use the card's center, not the view root.
      const from = power.card.getGlobalPosition()
      const localFrom = this.attackLineLayer.toLocal(from)
      this.attackLine.setEndpoints(
        localFrom,
        this.resolveAttackLineEnd(from, { x: event.globalX, y: event.globalY })
      )
      const angle = Math.atan2(event.globalY - from.y, event.globalX - from.x)
      this.options.cursor?.setTargetingAngle(angle)
      const target = this.findTargetCharacter(event)
      this.options.cursor?.setTargetingTarget(
        target ? this.toCursorTargetPoint(event.globalX, event.globalY) : null
      )
      this.updateHeroPowerPreview(target)
      return
    }
    if (this.cardPlay.current) {
      const targeting = this.cardPlay.current
      if (
        targeting.presentation.kind === 'minion-preview' &&
        targeting.presentation.preview.cancelled === true
      ) {
        this.attackLine.clear()
        this.options.cursor?.setTargetingTarget(null)
        return
      }
      if (!isCardTargetSelectionActive(targeting.input, targeting.choice)) {
        this.attackLine.clear()
        this.options.cursor?.setTargeting(false)
        this.options.cursor?.setTargetingTarget(null)
        return
      }
      this.cardPlay.updatePointer({ x: event.globalX, y: event.globalY })
      const target = this.findTargetCharacter(event)
      const entry = this.hand.entries.find(
        (candidate) => candidate.card.instanceId === targeting.cardInstanceId
      )
      const arrowOrigin = targeting.arrowOrigin
      const pendingPreview = this.cardPlay.minionTargetPreview(targeting)
      const from =
        arrowOrigin === 'local-hero'
          ? this.heroViews.get(this.localParticipantId)?.getGlobalPosition()
          : arrowOrigin === 'minion-preview' && pendingPreview
            ? this.summonLayer.toGlobal(pendingPreview.targetingOrigin)
            : entry?.slot.getGlobalPosition()
      if (from) {
        const localFrom = this.attackLineLayer.toLocal(from)
        this.attackLine.setEndpoints(
          localFrom,
          this.resolveAttackLineEnd(from, {
            x: event.globalX,
            y: event.globalY
          })
        )
        this.options.cursor?.setTargetingAngle(
          Math.atan2(event.globalY - from.y, event.globalX - from.x)
        )
      }
      this.options.cursor?.setTargetingTarget(
        target ? this.toCursorTargetPoint(event.globalX, event.globalY) : null
      )
      return
    }
    if (!this.selectedCombatView) {
      if (!this.combatInProgress) this.combat.clearCombatPreview()
      return
    }
    const parent = this.selectedCombatView.parent
    const from = parent
      ? parent.toGlobal(this.selectedCombatView.position)
      : this.selectedCombatView.getGlobalPosition()
    const to = { x: event.globalX, y: event.globalY }
    const localFrom = this.attackLineLayer.toLocal(from)
    this.attackLine.setEndpoints(localFrom, this.resolveAttackLineEnd(from, to))
    const angle = Math.atan2(to.y - from.y, to.x - from.x)
    this.options.cursor?.setTargetingAngle(angle)
    const target = this.findTargetCharacter(event)
    const combatTarget = target?.ownerId === this.remoteParticipantId ? target : null
    this.options.cursor?.setTargetingTarget(
      combatTarget ? this.toCursorTargetPoint(event.globalX, event.globalY) : null
    )
    this.updateCombatPreview(combatTarget)
  }

  /** Resolves the interactive character currently beneath a targeting pointer. */
  private findTargetCharacter(event: BoardPointerSample): CombatView | null {
    let target = event.target instanceof Container ? event.target : null
    while (target) {
      if (target instanceof MinionView || target instanceof HeroView) {
        return target.isTargetable() ? target : null
      }
      target = target.parent
    }

    return this.findTargetableCharacterAt(event.globalX, event.globalY)
  }

  /** Finds a valid remote character at a renderer-space point. */
  private findRemoteCombatTargetAt(x: number, y: number): CombatView | null {
    const remoteViews: readonly CombatView[] = [
      ...this.remoteMinionViews,
      ...(this.heroViews.get(this.remoteParticipantId)
        ? [this.heroViews.get(this.remoteParticipantId)!]
        : [])
    ]
    return (
      remoteViews.find((view) => {
        if (!view.isTargetable()) return false
        const bounds = view.getBounds()
        return (
          x >= bounds.x &&
          x <= bounds.x + bounds.width &&
          y >= bounds.y &&
          y <= bounds.y + bounds.height
        )
      }) ?? null
    )
  }

  /** Records a possible drag without changing ordinary click selection. */
  private beginCombatDrag(view: CombatView, event: FederatedPointerEvent): void {
    if (event.button !== 0) return
    if (
      this.heroPowerTargeting ||
      this.cardPlay.current ||
      this.isGameplayBlocked() ||
      !view.isCanAttack()
    ) {
      return
    }
    this.targetGestures.begin({ kind: 'combat', attacker: view }, event.pointerId, {
      x: event.globalX,
      y: event.globalY
    })
  }

  private beginHeroPowerDrag(event: FederatedPointerEvent): void {
    const local = this.findPlayer(this.match.getState(), this.localParticipantId)
    const targeting =
      local.heroPower.targetingGranted ??
      local.heroPower.targetType ??
      HERO_POWER_CATALOG.require(local.heroPower.id).targeting
    if (targeting === 'none') return
    this.targetGestures.begin({ kind: 'hero-power' }, event.pointerId, {
      x: event.globalX,
      y: event.globalY
    })
  }

  /** Activates a combat or hero-power drag after one shared movement threshold. */
  private updateTargetGesture(
    event: Pick<FederatedPointerEvent, 'pointerId' | 'globalX' | 'globalY'>
  ): void {
    const source = this.targetGestures.current?.source
    if (!source || source.kind === 'card') return
    if (
      !this.targetGestures.move(
        event.pointerId,
        { x: event.globalX, y: event.globalY },
        COMBAT_DRAG_MOVE_THRESHOLD_PX
      )
    )
      return
    if (source.kind === 'combat') {
      if (!source.attacker.isCanAttack()) {
        this.cancelCombatDrag()
        return
      }
      this.selectAttacker(source.attacker, false)
      return
    }
    void this.useHeroPower()
    if (!this.heroPowerTargeting) {
      this.targetGestures.cancel((candidate) => candidate.kind === 'hero-power')
    }
  }

  private cancelCombatDrag(): void {
    this.targetGestures.cancel((source) => source.kind === 'combat')
  }

  private consumeTargetGestureTap(event: FederatedPointerEvent): boolean {
    if (!this.targetGestures.consumeTap(event.pointerId)) return false
    event.stopPropagation()
    return true
  }

  private consumeCardPlacementTap(event: FederatedPointerEvent): boolean {
    if (!this.cardPlacementTapGuard.consume(event.pointerId)) return false
    event.stopPropagation()
    return true
  }

  /** Converts a Pixi canvas point into the fixed-position cursor layer's coordinates. */
  private toCursorTargetPoint(x: number, y: number): { x: number; y: number } {
    const bounds = this.getCanvasBounds()
    return {
      x: bounds.left + (x / this.options.renderer.screen.width) * bounds.width,
      y: bounds.top + (y / this.options.renderer.screen.height) * bounds.height
    }
  }

  /** Converts a fixed-position CSS point back into the renderer coordinate space. */
  private toRendererPoint(x: number, y: number): { x: number; y: number } {
    const bounds = this.getCanvasBounds()
    return {
      x: ((x - bounds.left) / bounds.width) * this.options.renderer.screen.width,
      y: ((y - bounds.top) / bounds.height) * this.options.renderer.screen.height
    }
  }

  private getCanvasBounds(): DOMRect {
    return (this.canvasBounds ??= this.options.renderer.canvas.getBoundingClientRect())
  }

  /**
   * Stops the Pixi body beneath the DOM arrow head. The inset is measured in
   * CSS pixels because the head is a fixed-size DOM image while the board
   * itself can scale with the viewport.
   */
  private resolveAttackLineEnd(
    from: { x: number; y: number },
    cursor: { x: number; y: number }
  ): { x: number; y: number } {
    const source = this.toCursorTargetPoint(from.x, from.y)
    const pointer = this.toCursorTargetPoint(cursor.x, cursor.y)
    const dx = pointer.x - source.x
    const dy = pointer.y - source.y
    const length = Math.hypot(dx, dy)
    if (length < 1) return this.attackLineLayer.toLocal(cursor)

    const inset = TARGETING_ARROW_HEAD.bodyEndInset
    const bodyEnd = this.toRendererPoint(
      pointer.x - (dx / length) * inset,
      pointer.y - (dy / length) * inset
    )
    return this.attackLineLayer.toLocal(bodyEnd)
  }

  /** Predicts whether the local hero power will lethally damage a hovered target. */
  private updateHeroPowerPreview(target: CombatView | null): void {
    const localPlayer = this.findPlayer(this.match.getState(), this.localParticipantId)
    const effect = HERO_POWER_CATALOG.require(localPlayer.heroPower.id).effect
    this.updateDamagePreview(
      target,
      effect.kind === 'damage-character' ||
        effect.kind === 'damage-and-summon-on-kill' ||
        effect.kind === 'damage-and-refresh-after-card' ||
        effect.kind === 'lifesteal-damage' ||
        (effect.kind === 'damage-enemy-hero' && this.heroPowerTargeting)
        ? effect.amount
        : null
    )
  }

  /** Reuses the will-die marker for any direct-damage targeting source. */
  private updateDamagePreview(target: CombatView | null, damage: number | null): void {
    if (!target || damage === null || damage <= 0 || !target.ownerId) {
      this.combat.syncCombatPreviewMarkers([])
      return
    }

    const player = this.findPlayer(this.match.getState(), target.ownerId as PlayerId)
    const health =
      target instanceof HeroView
        ? player.hero.health + player.hero.armor
        : target.instanceId
          ? player.board.find((minion) => minion.instanceId === target.instanceId)
              ?.health
          : undefined
    this.combat.syncCombatPreviewMarkers(
      health !== undefined && health <= damage ? [target] : []
    )
  }

  /** Shows the lethal marker(s) for the currently hovered combat target. */
  private updateCombatPreview(target: CombatView | null): void {
    const attacker = this.selectedCombatView
    if (!attacker || !target || target.ownerId !== this.remoteParticipantId) {
      this.combat.syncCombatPreviewMarkers([])
      return
    }

    const state = this.match.getState()
    const attackerPlayer = this.findPlayer(state, this.localParticipantId)
    const defenderPlayer = this.findPlayer(state, this.remoteParticipantId)
    const attackerMinion =
      attacker instanceof MinionView && attacker.instanceId
        ? attackerPlayer.board.find(
            (minion) => minion.instanceId === attacker.instanceId
          )
        : undefined
    const defenderMinion =
      target instanceof MinionView && target.instanceId
        ? defenderPlayer.board.find((minion) => minion.instanceId === target.instanceId)
        : undefined
    if (attacker instanceof MinionView && !attackerMinion) {
      this.combat.syncCombatPreviewMarkers([])
      return
    }
    if (target instanceof MinionView && !defenderMinion) {
      this.combat.syncCombatPreviewMarkers([])
      return
    }

    const attackerAttack =
      attacker instanceof HeroView
        ? getHeroAttack(attackerPlayer)
        : (attackerMinion?.attack ?? 0)
    const defenderAttack =
      target instanceof MinionView ? (defenderMinion?.attack ?? 0) : 0
    const attackerHealth =
      attacker instanceof HeroView
        ? attackerPlayer.hero.health + attackerPlayer.hero.armor
        : (attackerMinion?.health ?? 0)
    const defenderHealth =
      target instanceof HeroView
        ? defenderPlayer.hero.health + defenderPlayer.hero.armor
        : (defenderMinion?.health ?? 0)
    const attackerHealthAfter = Math.max(0, attackerHealth - defenderAttack)
    const defenderHealthAfter = Math.max(0, defenderHealth - attackerAttack)
    const lethalViews: CombatView[] = []
    if (attackerHealthAfter === 0) lethalViews.push(attacker)
    if (defenderHealthAfter === 0) lethalViews.push(target)
    this.combat.syncCombatPreviewMarkers(lethalViews)
  }

  private characterRef(view: CombatView): AttackCharacterRef | null {
    if (view instanceof HeroView) return { kind: 'hero' }
    return view.instanceId ? { kind: 'minion', instanceId: view.instanceId } : null
  }

  /** Dispatches an attack against the clicked opposing character. */
  private async attackCharacter(target: CombatView): Promise<void> {
    const attacker = this.selectedCombatView
    if (!attacker) return
    if (target.ownerId !== this.remoteParticipantId) return

    const attackerRef = this.characterRef(attacker)
    const defenderRef = this.characterRef(target)
    if (!attackerRef || !defenderRef) return

    // The target click can arrive before a pointermove in the same frame; make
    // sure the lethal preview exists before committing the command.
    this.updateCombatPreview(target)
    this.combatInProgress = true
    this.deselectAttacker(false, false)
    const result = this.dispatchCommand({
      type: 'attack-character',
      participantId: this.localParticipantId,
      attacker: attackerRef,
      defender: defenderRef
    })
    if (!result.accepted) {
      this.logger.error(result.message)
      this.combatInProgress = false
      this.combat.clearCombatPreview()
      this.syncTurnHud(this.match.getState())
      this.syncTurnControls(this.match.getState())
      return
    }

    // The lethal marker is only a targeting preview. Remove it as soon as the
    // attack commits, before the combat wind-up starts.
    this.combat.clearCombatPreview()
    // The final presentation reconciliation applies the weapon durability after
    // the queued hero attack has returned to its board position.
    this.syncTurnHud(result.state, {
      skipWeaponSync: attacker instanceof HeroView
    })
    this.syncTurnControls(result.state)
    try {
      await this.enqueuePresentation(result.state, () =>
        this.presentResolutionEvents(result.events)
      )
    } finally {
      this.combatInProgress = false
      const state = this.match.getState()
      this.syncTurnHud(state)
      this.syncTurnControls(state)
    }
  }

  /**
   * Local player clicked End Turn: hand the turn to the remote participant and
   * present the remote's draw. The button stays disabled until the AI passes
   * the turn back.
   */
  private async endTurn(): Promise<void> {
    if (
      this.turnInProgress ||
      this.heroPowerTargeting ||
      this.cardPlay.current ||
      this.isGameplayBlocked()
    )
      return
    this.turnInProgress = true
    this.hud.endTurnButton?.setEnabled(false)
    const result = this.dispatchCommand({
      type: 'end-turn',
      participantId: this.localParticipantId
    })
    if (!result.accepted) {
      this.logger.error(result.message)
      this.turnInProgress = false
      this.syncTurnControls(this.match.getState())
      return
    }
    this.syncTurnHud(result.state)
    this.syncTurnControls(result.state)
    void this.scheduleAiTurn()
    await this.enqueuePresentation(result.state, () =>
      this.presentResolutionEvents(result.events)
    )
  }

  private showOpponentLeft(): void {
    if (this.opponentLeftShown || this.destroyed) return
    this.opponentLeftShown = true
    this.options.onOpponentLeft?.()
  }

  /** Think from resolved engine state while visuals finish; dispatch remains serialized. */
  private async scheduleAiTurn(): Promise<void> {
    if (this.aiTurnRunning) return
    this.aiTurnRunning = true
    const startDecision = () => {
      const startedAt = performance.now()
      let completedAt = startedAt
      const promise = this.aiController.chooseTurnAction().finally(() => {
        completedAt = performance.now()
      })
      return { promise, startedAt, completedAt: () => completedAt }
    }
    let nextDecision: ReturnType<typeof startDecision> | undefined
    let presentationMs = 0
    const overlapEnabled = import.meta.env.VITE_AI_OVERLAP !== '0'
    try {
      if (overlapEnabled) nextDecision = startDecision()
      await this.wait(TURN_TIMING.aiTurnDelay)
      while (!this.destroyed) {
        await this.waitForResolutionIdle()
        if (!this.turnLayer.visible || this.destroyed) return
        const state = this.match.getState()
        if (
          state.phase !== 'turns' ||
          (state.pendingDiscover?.participantId ??
            state.pendingCardChoice?.participantId ??
            state.activePlayerId) !== this.remoteParticipantId
        )
          return
        const presentationReadyAt = performance.now()
        const pending = nextDecision ?? startDecision()
        nextDecision = undefined
        const decision = await pending.promise
        if (this.destroyed) return
        if (!decision) {
          if (this.aiController.isAbandoned) {
            this.showOpponentLeft()
            return
          }
          continue
        }
        if (!this.aiController.isCurrent(decision)) continue
        this.aiController.recordTiming(decision, {
          decisionMs: pending.completedAt() - pending.startedAt,
          presentationOverlapMs: Math.max(
            0,
            Math.min(presentationReadyAt, pending.completedAt()) - pending.startedAt
          ),
          visibleWaitMs: Math.max(0, pending.completedAt() - presentationReadyAt),
          presentationMs
        })
        const remoteBackCountBefore = this.remoteBackCount
        const remotePlayedCard = playedRemoteCard(
          decision.command,
          this.findPlayer(this.match.getState(), this.remoteParticipantId).hand
        )
        const remoteDiscoverSelectedInstanceId =
          decision.command.type === 'choose-discover-card' &&
          decision.command.participantId === this.remoteParticipantId
            ? decision.command.cardInstanceId
            : null
        const remoteMinionPlay =
          decision.command.type === 'play-card' &&
          remotePlayedCard !== null &&
          cardDefinition(remotePlayedCard).type === 'Minion'
        const remoteMinionCommandInstanceId =
          decision.command.type === 'play-card' ? decision.command.cardInstanceId : null
        const remoteTargetedSpellTargets =
          decision.command.type === 'play-card' &&
          remotePlayedCard !== null &&
          cardDefinition(remotePlayedCard).type === 'Spell' &&
          decision.command.targets &&
          decision.command.targets.length > 0
            ? decision.command.targets
            : null
        const remoteHeroPowerCommandTarget =
          decision.command.type === 'use-hero-power' &&
          decision.command.participantId === this.remoteParticipantId
            ? decision.command.target
            : undefined
        const result = this.dispatchCommand(decision.command)
        this.aiController.recordExecution(decision, result)
        if (!result.accepted) {
          this.logger.warn(
            '[Game AI] move rejected by engine',
            result.message,
            decision
          )
          continue
        }
        // Results and public events are recorded before the next request snapshots them.
        // A pending choice remains on the existing post-presentation decision path.
        if (
          import.meta.env.VITE_AI_OVERLAP !== '0' &&
          result.state.phase === 'turns' &&
          result.state.activePlayerId === this.remoteParticipantId &&
          !result.state.pendingResolution &&
          !result.state.pendingDiscover &&
          !result.state.pendingCardChoice &&
          !this.aiController.isAbandoned
        )
          nextDecision = startDecision()
        const remoteMinionPlayed = remoteMinionPlay
          ? (result.events.find(
              (event): event is Extract<OpeningMatchEvent, { type: 'minion-played' }> =>
                event.type === 'minion-played' &&
                event.participantId === this.remoteParticipantId &&
                event.minion.instanceId === remoteMinionCommandInstanceId
            ) ??
            result.events.find(
              (event): event is Extract<OpeningMatchEvent, { type: 'minion-played' }> =>
                event.type === 'minion-played' &&
                event.participantId === this.remoteParticipantId
            ))
          : undefined
        const remoteDiscoverDrawn = remoteDiscoverSelectedInstanceId
          ? result.events.find(
              (event): event is Extract<OpeningMatchEvent, { type: 'card-drawn' }> =>
                event.type === 'card-drawn' &&
                event.participantId === this.remoteParticipantId &&
                event.card.instanceId === remoteDiscoverSelectedInstanceId
            )
          : undefined
        const remoteHeroPowerUsed = result.events.find(
          (event): event is Extract<OpeningMatchEvent, { type: 'hero-power-used' }> =>
            event.type === 'hero-power-used' &&
            event.participantId === this.remoteParticipantId
        )
        const remoteHeroPowerTarget =
          remoteHeroPowerUsed?.target ?? remoteHeroPowerCommandTarget
        const presentationStartedAt = performance.now()
        const preview =
          remotePlayedCard && !remoteMinionPlay
            ? this.remoteCardPlayPreview
                .present(
                  CARD_CATALOG.require(remotePlayedCard.cardId),
                  remotePlayedCard
                )
                .catch((error: unknown) =>
                  this.logger.warn('[Game AI] remote card preview failed', error)
                )
            : Promise.resolve()
        const presentAiResult = async (): Promise<void> => {
          await preview
          if (this.destroyed) return
          let remoteDiscoverWasPresented = false
          if (remoteDiscoverSelectedInstanceId) {
            remoteDiscoverWasPresented = await this.presentRemoteDiscoverSelection(
              remoteDiscoverSelectedInstanceId,
              remoteDiscoverDrawn !== undefined
            )
          }
          if (remoteTargetedSpellTargets) {
            await this.presentRemoteTargetedSpell(remoteTargetedSpellTargets)
          }
          if (remoteHeroPowerTarget) {
            await this.presentRemoteHeroPowerTarget(remoteHeroPowerTarget)
          }
          if (remoteMinionPlayed)
            await this.presentRemoteMinionPlayed(remoteMinionPlayed, remotePlayedCard)
          if (!this.destroyed)
            await this.presentResolutionEvents(
              result.events,
              remoteMinionPlayed ??
                (remoteDiscoverWasPresented ? remoteDiscoverDrawn : undefined)
            )
        }
        // Keep a remote hero's weapon at its pre-attack value until combat
        // presentation returns the hero and reconciles the resolved state.
        this.syncTurnHud(result.state, {
          skipWeaponSync:
            decision.command.type === 'attack-character' &&
            decision.command.attacker.kind === 'hero'
        })
        this.syncTurnControls(result.state)
        this.syncSecrets(result.state)
        if (this.randomSpellRevision === result.state.revision) {
          await this.enqueuePresentation(result.state, presentAiResult)
        } else {
          // The turn handoff can accept a local play before its visuals finish.
          // Keep this older snapshot ahead of that play's hand removal/reconcile.
          await this.enqueuePresentation(result.state, presentAiResult)
        }
        if (this.destroyed) return
        this.syncSecrets(result.state)
        if (
          decision.command.type === 'play-card' &&
          this.remoteBackCount === remoteBackCountBefore
        ) {
          this.remoteBackCount = Math.max(0, this.remoteBackCount - 1)
          this.layoutRemoteHand()
        }
        await this.wait(0.12)
        presentationMs = performance.now() - presentationStartedAt
      }
    } catch (error) {
      if (!this.destroyed) {
        this.logger.warn('[Game AI] turn loop error', error)
        if (this.aiController.isAbandoned) {
          this.showOpponentLeft()
          return
        }
        if (this.aiController.hasLegalActions()) await this.scheduleAiTurn()
      }
    } finally {
      this.aiTurnRunning = false
    }
  }

  private createOpeningLayer(state: OpeningMatchState): void {
    this.openingLayer.addChild(this.createDarkOverlay())

    const versus = new Sprite(this.options.gameAssets.startOfGameVs)
    applyAnchoredPlacement(versus, GAME_BOARD_LAYOUT.versus)
    versus.eventMode = 'none'
    this.openingLayer.addChild(versus)
    for (const player of state.players) {
      const hero = HERO_CATALOG.require(player.heroId)
      const intro =
        player.participantId === this.localParticipantId
          ? GAME_BOARD_LAYOUT.heroes.localIntro
          : GAME_BOARD_LAYOUT.heroes.remoteIntro
      const label = new Text({
        text: `${hero.displayName}\n${hero.classId.toUpperCase()}`,
        style: {
          fontFamily: 'Belwe',
          fontSize: 34,
          fill: 0xffffff,
          stroke: { color: 0x17120f, width: 6 },
          align: 'center',
          lineHeight: 42
        }
      })
      label.anchor.set(0.5, 0)
      label.position.set(
        intro.position.x,
        intro.position.y +
          GAME_BOARD_LAYOUT.heroes.introLabelOffset * (intro.scale?.y ?? 1)
      )
      label.eventMode = 'none'
      this.openingLayer.addChild(label)
    }
  }

  private createDarkOverlay(): Graphics {
    const overlay = new Graphics()
    overlay.rect(0, 0, 1920, 1080)
    overlay.fill({ color: 0x000000, alpha: 0.8 })
    overlay.eventMode = 'none'
    return overlay
  }

  private async createInitialLocalCards(cards: readonly OpeningCard[]): Promise<void> {
    const entries = await this.mulligan.createInitialCards(cards, (card) =>
      this.createSlot(card)
    )
    for (const { card, slot } of entries) {
      this.hand.append({ card, slot, restTransform: undefined, displaced: false })
    }
  }

  private async createCardPresentation(
    card: OpeningCard,
    sourceInstanceId?: string
  ): Promise<{ readonly card: CardView; readonly outlineTexture: Texture }> {
    if (sourceInstanceId) this.premiumAppearance.inherit(card, sourceInstanceId)
    const definition = cardDefinition(card)
    const artwork = await this.resolver.loadArtwork(card.cardId)
    const view = await CardView.create(definition, this.resolver, {
      premium: this.premiumAppearance.resolve(card),
      premiumSide: this.premiumAppearance.sideFor(card),
      animatePremiumArtwork: true,
      artwork,
      snapshot: card
    })
    const baseCost = card.baseCost ?? definition.cost
    const currentCost = card.currentCost ?? baseCost
    view.setRulesText(
      cthunCardRulesText(
        card,
        spellDamageRulesText(
          definition,
          this.findPlayer(this.presentationState(), this.localParticipantId)
        )
      )
    )
    view.setManaCost(currentCost)
    view.setManaCostColor(cardCostColor(baseCost, currentCost))
    const outlineTexture = await this.resolver.load(
      CARD_PROFILES[view.plan.template].frame
    )
    return { card: view, outlineTexture }
  }

  private async createSlot(
    card: OpeningCard,
    sourceInstanceId?: string
  ): Promise<GameCardSlot> {
    const presentation = await this.createCardPresentation(card, sourceInstanceId)
    const slot = new GameCardSlot(
      presentation.card,
      card.instanceId,
      this.options.gameAssets.mulliganReplaceCross,
      this.options.gameAssets.mulliganReplacedLabel,
      presentation.outlineTexture,
      this.options.renderer
    )
    return slot
  }

  private findPlayer(state: OpeningMatchState, participantId: string) {
    const player = state.players.find(
      (candidate) => candidate.participantId === participantId
    )
    if (!player) throw new Error(`Unknown participant ${participantId}`)
    return player
  }

  private ensureRemoteBacks(count: number): void {
    while (this.remoteBacks.length < count) {
      const back = new Sprite(this.options.gameAssets.cardBack)
      back.anchor.set(0.5, 1)
      attachShadow(back, {
        x: -back.texture.width / 2,
        y: -back.texture.height,
        width: back.texture.width,
        height: back.texture.height
      })
      back.alpha = 0
      back.eventMode = 'none'
      this.remoteBacks.push(back)
      this.remoteHandLayer.addChild(back)
    }
    this.layoutRemoteHand()
  }

  private layoutRemoteHand(): void {
    this.remoteBacks.forEach((back, index) => {
      const visible = index < this.remoteBackCount
      back.visible = visible
      if (!visible) return
      const transform = this.remoteHandTransform(index, this.remoteBackCount)
      back.position.set(transform.x, transform.y)
      back.rotation = transform.rotation
      back.scale.set(transform.scale)
      const shadow = getShadowCaster(back)
      if (shadow) shadow.restingScale = transform.scale
    })
  }

  private remoteHandTransform(
    index: number,
    count: number
  ): { x: number; y: number; rotation: number; scale: number } {
    const midpoint = (count - 1) / 2
    const { gap, scale } = this.remoteHandMetrics(count)
    const normalized = midpoint === 0 ? 0 : (index - midpoint) / midpoint
    return {
      x: GAME_BOARD_LAYOUT.remoteHand.centerX + (index - midpoint) * gap,
      y:
        GAME_BOARD_LAYOUT.remoteHand.baselineY -
        Math.abs(normalized) * GAME_BOARD_LAYOUT.remoteHand.edgeTuck,
      rotation: -(index - midpoint) * GAME_BOARD_LAYOUT.remoteHand.rotationStep,
      scale
    }
  }

  private remoteHandMetrics(count: number): { gap: number; scale: number } {
    const layout = GAME_BOARD_LAYOUT.remoteHand
    const start = Math.max(1, layout.compactStartCount)
    const full = Math.max(start, layout.compactFullCount)
    const progress =
      count <= start ? 0 : Math.min(1, (count - start) / Math.max(1, full - start))
    return {
      gap: layout.gap + (layout.compactGap - layout.gap) * progress,
      scale: layout.scale + (layout.compactScale - layout.scale) * progress
    }
  }

  private async presentMulligan(): Promise<void> {
    await this.mulligan.present()
    const localCommonCount =
      this.localPlayerNumber === 2 ? 3 : this.mulligan.initialCardCount
    const remoteCommonCount = this.remotePlayerNumber === 2 ? 3 : this.remoteBackCount
    await Promise.all([
      this.mulligan.dealInitialCards(0, localCommonCount),
      this.dealRemoteCards(0, remoteCommonCount)
    ])
    if (this.localPlayerNumber === 2) {
      await this.mulligan.presentPlayerTwoAnnouncement()
      await this.mulligan.dealInitialCards(3, 4, OPENING_TIMING.playerTwoFourthCard)
    } else {
      await this.dealRemoteCards(3, 4, OPENING_TIMING.playerTwoFourthCard)
    }
    this.mulligan.enableSelection()
  }

  private async dealRemoteCards(
    start: number,
    end: number,
    duration: number = OPENING_TIMING.cardDeal
  ): Promise<void> {
    await Promise.all(
      this.remoteBacks
        .slice(start, Math.min(end, this.remoteBackCount))
        .map((back, offset) => {
          const index = start + offset
          this.prepareBackAtDeck(back, index)
          return this.animateBackToHand(
            back,
            index,
            this.remoteBackCount,
            duration,
            offset
          )
        })
    )
  }

  private async confirmMulligan(): Promise<void> {
    const selectedIds = this.mulligan.beginConfirmation(
      this.hand.entries.map((entry) => entry.slot)
    )
    if (selectedIds === null) return
    const result = this.dispatchCommand({
      type: 'confirm-mulligan',
      participantId: this.localParticipantId,
      replaceInstanceIds: selectedIds
    })
    if (!result.accepted) {
      this.logger.error(result.message)
      this.mulligan.rejectConfirmation()
      return
    }

    this.mulligan.showConfirmed(result.state.phase === 'mulligan')

    const localMulliganEvent = result.events.find(
      (event): event is MulliganResolvedEvent =>
        event.type === 'mulligan-resolved' &&
        event.participantId === this.localParticipantId
    )
    if (!localMulliganEvent) {
      this.logger.error('The local mulligan confirmation did not resolve a hand.')
      return
    }
    await this.enqueuePresentation(result.state, () =>
      this.presentResolutionEvents([localMulliganEvent])
    )

    const presentationReadyAt = performance.now()
    const aiMulligan = await (this.aiMulliganResolution ?? Promise.resolve(null))
    if (this.destroyed) return
    if (aiMulligan?.decision && aiMulligan.completedAt !== undefined) {
      this.aiController.recordTiming(aiMulligan.decision, {
        decisionMs: aiMulligan.completedAt - this.aiMulliganStartedAt,
        presentationOverlapMs: Math.max(
          0,
          Math.min(presentationReadyAt, aiMulligan.completedAt) -
            this.aiMulliganStartedAt
        ),
        visibleWaitMs: Math.max(0, aiMulligan.completedAt - presentationReadyAt),
        presentationMs: 0
      })
    }
    if (!aiMulligan) {
      this.logger.error('[Game AI] could not confirm the remote mulligan.')
      return
    }

    await this.wait(OPENING_TIMING.handoffPause)
    if (this.destroyed) return
    await this.completeLocalMulliganPresentation()

    const localTransitionEvents = result.events.filter(
      (event) => event.type !== 'mulligan-resolved'
    )
    if (localTransitionEvents.length > 0) {
      await this.enqueuePresentation(result.state, () =>
        this.presentResolutionEvents(localTransitionEvents)
      )
    }
    const remoteTransitionEvents = aiMulligan.events.filter(
      (event) => event.type !== 'mulligan-resolved'
    )
    if (remoteTransitionEvents.length > 0) {
      await this.enqueuePresentation(aiMulligan.state, () =>
        this.presentResolutionEvents(remoteTransitionEvents)
      )
    }

    await this.mulligan.hide()
  }

  private async resolveAiMulligan(
    decisionPromise: ReturnType<AiTurnController['chooseMulligan']>
  ): Promise<MulliganResolutionBatch | null> {
    try {
      while (!this.destroyed) {
        const decision = await decisionPromise
        if (this.destroyed) return null
        const state = this.match.getState()
        if (this.findPlayer(state, this.remoteParticipantId).mulliganConfirmed)
          return { state, events: [] }
        if (!decision || !this.aiController.isCurrent(decision)) {
          if (this.aiController.isAbandoned) {
            this.showOpponentLeft()
            return null
          }
          if (state.phase !== 'mulligan') return null
          await this.waitForResolutionIdle()
          if (this.destroyed) return null
          decisionPromise = this.aiController.chooseMulligan()
          continue
        }
        const result = this.dispatchCommand(decision.command)
        this.aiController.recordExecution(decision, result)
        if (!result.accepted) {
          this.logger.warn(
            '[Game AI] mulligan rejected by engine',
            result.message,
            decision
          )
          decisionPromise = this.aiController.chooseMulligan()
          continue
        }
        return {
          state: result.state,
          events: result.events,
          decision,
          completedAt: performance.now()
        }
      }
    } catch (error) {
      if (!this.destroyed) {
        this.logger.warn('[Game AI] mulligan loop error', error)
        if (this.aiController.isAbandoned) {
          this.showOpponentLeft()
          return null
        }
        return this.resolveAiMulligan(this.aiController.chooseMulligan())
      }
    }
    return null
  }

  /**
   * The match state is already final by the time its events reach the renderer.
   * Delay snapshot reconciliation until explicit combat/play events have shown
   * their intermediate visuals, otherwise a deathrattle can remove combatants
   * before their attack animation gets a chance to run.
   */
  private async presentResolutionEvents(
    events: readonly OpeningMatchEvent[],
    alreadyPresented?: OpeningMatchEvent
  ): Promise<void> {
    this.premiumAppearance.observe(events)
    this.resolutionPresentationDepth += 1
    try {
      const state = this.activePresentationState ?? this.match.getState()
      const spellStates = randomSpellPresentationStates(events, state)
      let requiresStateReconcile = false
      const goldenMonkeyHandReplacement = this.goldenMonkeyHandReplacementFor(
        events,
        state
      )
      let goldenMonkeyHandReplacementPresented = false
      const presentedDiscards = new Set<OpeningMatchEvent>()
      for (const [index, event] of events.entries()) {
        if (this.destroyed) return
        if (event === alreadyPresented) continue
        if (presentedDiscards.has(event)) continue
        if (spellStates) this.randomSpellState = spellStates[index]
        if (
          event.type === 'effect-resolved' ||
          event.type === 'minion-summoned' ||
          event.type === 'death-batch-started' ||
          event.type === 'combat-started' ||
          event.type === 'minion-combat-resolved' ||
          event.type === 'character-combat-resolved'
        )
          requiresStateReconcile = true
        if (
          goldenMonkeyHandReplacement &&
          !goldenMonkeyHandReplacementPresented &&
          this.startsGoldenMonkeyHandReplacement(event, goldenMonkeyHandReplacement)
        ) {
          goldenMonkeyHandReplacementPresented = true
          await this.presentGoldenMonkeyHandReplacement(goldenMonkeyHandReplacement)
        }
        if (isHandDiscard(event)) {
          const batch = handDiscardBatch(events, index)
          batch.forEach((discard) => presentedDiscards.add(discard))
          await this.presentHandDiscards(batch)
        } else {
          await this.presentEvent(event)
        }
      }
      if (this.destroyed) return
      if (spellStates) this.randomSpellState = state
      await this.reconcileWeaponViews(state)
      if (!requiresStateReconcile) return
      await this.reconcileEffectMovement(state)
      this.syncLocalHandCards(state)
      this.syncBoardMinionPresentation(state)
      this.syncBoardHeroPresentation(state)
      this.syncBoardAttackability(state)
    } finally {
      this.resolutionPresentationDepth -= 1
      if (this.resolutionPresentationDepth === 0 && this.randomSpellRevision === null) {
        const waiters = this.resolutionIdleWaiters.splice(0)
        for (const resolve of waiters) resolve()
      }
    }
  }

  /**
   * Collects the local hand targets from one Golden Monkey resolution. The
   * runtime transforms hand and deck cards through the same action, so only
   * targets still present in the local public hand belong in this sequence.
   */
  private goldenMonkeyHandReplacementFor(
    events: readonly OpeningMatchEvent[],
    state: OpeningMatchState
  ): GoldenMonkeyHandReplacement | null {
    const localHandIds = new Set(
      this.findPlayer(state, this.localParticipantId).hand.map(
        (card) => card.instanceId
      )
    )
    let sourceInstanceId: string | undefined
    const targetInstanceIds = new Set<string>()
    for (const event of events) {
      if (
        event.type !== 'effect-resolved' ||
        event.action !== 'transform-random' ||
        event.sourceCardId !== GOLDEN_MONKEY_CARD_ID ||
        event.controllerId !== this.localParticipantId
      ) {
        continue
      }
      const target = event.data?.target
      if (typeof target !== 'string' || !localHandIds.has(target)) continue
      sourceInstanceId ??= event.sourceInstanceId
      if (event.sourceInstanceId === sourceInstanceId) targetInstanceIds.add(target)
    }
    return sourceInstanceId && targetInstanceIds.size > 0
      ? { sourceInstanceId, targetInstanceIds }
      : null
  }

  private startsGoldenMonkeyHandReplacement(
    event: OpeningMatchEvent,
    replacement: GoldenMonkeyHandReplacement
  ): boolean {
    if (
      event.type !== 'effect-resolved' ||
      event.action !== 'transform-random' ||
      event.sourceInstanceId !== replacement.sourceInstanceId
    ) {
      return false
    }
    const target = event.data?.target
    return typeof target === 'string' && replacement.targetInstanceIds.has(target)
  }

  private async presentEvent(event: OpeningMatchEvent): Promise<void> {
    // The typed registry makes this rendering decision exhaustive when the domain adds an event.
    void eventPresentationPolicy(event.type)
    switch (event.type) {
      case 'secret-resolution-started':
        await this.presentSecretResolution(event)
        return
      case 'secret-resolution-completed':
        await this.reconcileRandomSpellState(event.state)
        return
      case 'random-spell-started':
        await this.reconcileRandomSpellState(event.state)
        if (this.destroyed) return
        try {
          await this.remoteCardPlayPreview.present(
            CARD_CATALOG.require(event.cardId),
            {
              instanceId: event.castId,
              cardId: event.cardId,
              ownerId: event.participantId
            },
            {
              side:
                event.participantId === this.localParticipantId ? 'local' : 'remote',
              concealSecret: event.participantId !== this.localParticipantId
            }
          )
        } catch (error) {
          this.logger.warn('[Game] random spell preview failed', error)
        }
        return
      case 'random-spell-completed':
        await this.reconcileRandomSpellState(event.state)
        return
      case 'mulligan-resolved':
        if (event.participantId === this.localParticipantId) {
          await this.presentLocalMulligan(event)
        }
        return
      case 'coin-granted':
        if (event.participantId === this.localParticipantId) {
          await this.spawnLocalCard(event.card, GAME_BOARD_LAYOUT.frame.center)
          this.syncTurnHud(this.match.getState())
        } else {
          await this.presentDraw(event.participantId, event.card)
        }
        return
      case 'opening-card-drawn':
      case 'card-drawn':
        await this.presentDraw(
          event.participantId,
          event.card,
          event.type === 'opening-card-drawn' || event.origin === 'deck'
            ? event.participantId
            : undefined
        )
        return
      case 'discover-started':
        if (event.participantId === this.remoteParticipantId) void this.scheduleAiTurn()
        if (event.participantId === this.localParticipantId)
          await this.cardSelectionOverlay.show(event.candidates)
        else if (event.participantId === this.remoteParticipantId)
          await this.cardSelectionOverlay.showRemoteDiscover(event.candidates)
        return
      case 'card-choice-started':
        if (event.participantId === this.remoteParticipantId) void this.scheduleAiTurn()
        if (event.participantId === this.localParticipantId) {
          await this.cardSelectionOverlay.showChoices(
            event.participantId,
            event.sourceCardInstanceId,
            event.sourceCardId,
            event.options
          )
        }
        return
      case 'card-generated':
        await this.presentGeneratedCard(event)
        return
      case 'card-burned':
        if (event.origin === 'deck' || event.origin === 'deck-destruction') {
          await this.presentDeckBurn(event)
          return
        }
        this.historyView?.recordBurn(event)
        this.syncTurnHud(this.match.getState())
        return
      case 'opening-turn-started':
        this.syncTurnHud(this.match.getState())
        this.handleTurnStarted(event.participantId)
        await this.presentHeroPowerReveal()
        return
      case 'turn-started':
        this.syncTurnHud(this.match.getState())
        this.handleTurnStarted(event.participantId)
        await this.presentHeroPowerFlip(event.participantId, true)
        return
      case 'hero-power-used':
        this.syncTurnHud(this.match.getState())
        await this.presentHeroPowerFlip(event.participantId, false)
        return
      case 'hero-power-replaced':
        await this.presentHeroPowerReplaced(event)
        return
      case 'character-damaged':
        this.combat.showDamageIndicatorForCharacter(
          event.participantId,
          event.character,
          event.attemptedAmount ?? event.amount
        )
        this.presentCharacterStateChange(event)
        await this.wait(RESOLUTION_TIMING.outcomePause)
        return
      case 'character-healed':
        this.combat.showHealIndicatorForCharacter(
          event.participantId,
          event.character,
          event.attemptedAmount ?? event.amount
        )
        this.presentCharacterStateChange(event)
        await this.wait(RESOLUTION_TIMING.outcomePause)
        return
      case 'armor-gained': {
        const player = this.findPlayer(this.presentationState(), event.participantId)
        const view = this.heroViews.get(event.participantId)
        view?.setStats(
          getHeroAttack(player),
          player.hero.health,
          event.armorAfter,
          player.hero.maxHealth
        )
        await this.wait(RESOLUTION_TIMING.outcomePause)
        return
      }
      case 'hero-replaced':
        await this.presentHeroReplaced(event)
        return
      case 'fatigue':
        await this.fatigueView.present(
          event.amount,
          event.participantId === this.localParticipantId ? 'local' : 'remote'
        )
        return
      case 'hero-power-minion-summoned':
        await this.presentMinionPlayed(event, undefined, false)
        return
      case 'minion-played':
        await this.presentMinionPlayed(event)
        return
      case 'battlecry-repetition-started':
        await this.presentBattlecryRepetitionStarted(event)
        return
      case 'weapon-equipped':
        await this.presentWeaponEquipped(event)
        return
      case 'combat-started':
        await this.combat.presentCombatStarted(event)
        return
      case 'minion-combat-resolved':
        await this.combat.presentCombatResolved(event)
        return
      case 'character-combat-resolved':
        await this.combat.presentCombatResolved(event)
        return
      case 'trigger-activated':
        await this.presentTriggerActivated(event)
        return
      case 'death-batch-started':
        await this.combat.presentDeathBatchStarted(event)
        return
      case 'death-batch-completed':
        this.combat.completeDeathBatch(event.batchId)
        return
      case 'minion-summoned':
        await this.presentMinionSummoned(event)
        return
      case 'effect-resolved':
        await this.presentEffectResolved(event)
        return
      case 'match-ended':
        this.syncTurnControls(this.match.getState())
        await this.presentMatchResult(event)
        return
      case 'dev-card-added':
        await this.presentDevCardAdded(event)
        return
      case 'dev-mana-set':
        this.syncTurnHud(this.match.getState())
        return
      case 'dev-deck-modified':
        this.syncTurnHud(this.match.getState())
        return
      case 'dev-minion-summoned':
        await this.presentDevMinionSummoned(event)
        return
      case 'dev-state-changed':
        this.syncTurnHud(this.match.getState())
        for (const player of this.match.getState().players) {
          this.heroViews
            .get(player.participantId)
            ?.setStats(
              getHeroAttack(player),
              player.hero.health,
              player.hero.armor,
              player.hero.maxHealth
            )
          if (player.board.length === 0) {
            const views =
              player.participantId === this.localParticipantId
                ? [...this.localMinionViews]
                : [...this.remoteMinionViews]
            for (const minion of views) this.removeMinionView(minion)
          }
        }
        if (
          this.findPlayer(this.match.getState(), this.localParticipantId).hand
            .length === 0
        ) {
          while (this.hand.entries.length > 0) {
            const entry = this.hand.takeLast()
            entry?.slot.removeFromParent()
            entry?.slot.destroy({ children: true })
          }
        }
        if (
          this.findPlayer(this.match.getState(), this.remoteParticipantId).hand
            .length === 0
        ) {
          this.remoteBackCount = 0
          this.layoutRemoteHand()
        }
        return
      case 'history-action-resolved':
        this.recordOpeningHistory(event)
        return
    }
  }

  private async presentTriggerActivated(
    event: Extract<OpeningMatchEvent, { type: 'trigger-activated' }>
  ): Promise<void> {
    if (event.trigger === 'deathrattle') {
      const sourceView =
        event.source.kind === 'minion'
          ? this.findMinionView(event.participantId, event.source.instanceId)
          : event.source.kind === 'weapon'
            ? this.weaponViews.get(event.participantId)?.instanceId ===
              event.source.instanceId
              ? this.weaponViews.get(event.participantId)
              : undefined
            : undefined
      if (sourceView) sourceView.setDeathrattle(true)
      await this.combat.presentDeathrattleGhost(
        event.source.instanceId,
        sourceView?.getAbilityMarkerSnapshot('deathrattle') ?? undefined
      )
      return
    }
    if (event.source.kind === 'minion') {
      const view = this.findMinionView(event.participantId, event.source.instanceId)
      if (view) {
        // Runtime-granted triggers may not have reached the end-of-resolution
        // reconciliation yet; the concrete activation itself is authoritative.
        const marker = event.trigger === 'inspire' ? 'inspire' : 'trigger'
        if (marker === 'inspire') view.setInspire(true)
        else view.setTrigger(true)
        await view.presentAbilityPulse(marker, RESOLUTION_TIMING.triggerPulse)
      }
      return
    }
    if (event.source.kind === 'weapon') {
      const view = this.weaponViews.get(event.participantId)
      if (view?.instanceId === event.source.instanceId) {
        view.setTrigger(true)
        await view.presentAbilityPulse('trigger', RESOLUTION_TIMING.triggerPulse)
      }
    }
  }

  private async presentBattlecryRepetitionStarted(
    event: Extract<OpeningMatchEvent, { type: 'battlecry-repetition-started' }>
  ): Promise<void> {
    const view = this.findMinionView(event.participantId, event.minion.instanceId)
    if (!view) return
    await view.presentBattlecryBanner()
  }

  private async presentMinionSummoned(
    event: Extract<OpeningMatchEvent, { type: 'minion-summoned' }>
  ): Promise<void> {
    await this.presentMinionPlayed(event, undefined, false)
  }

  private async presentEffectResolved(
    event: Extract<OpeningMatchEvent, { type: 'effect-resolved' }>
  ): Promise<void> {
    if (event.cardMovement) {
      await this.presentMinionCardMovement(event.cardMovement)
      return
    }
    if (event.action === 'discard') {
      if (event.data?.fromZone === 'hand') await this.presentHandDiscard(event)
      return
    }
    this.syncSecrets(this.presentationState())
    const data = event.data
    if (!data) return
    const targetId = typeof data.target === 'string' ? data.target : undefined
    const target = targetId ? this.findEffectTargetView(targetId) : null
    const numberData = (key: string): number | undefined =>
      typeof data[key] === 'number' && Number.isFinite(data[key] as number)
        ? (data[key] as number)
        : undefined

    if (event.action === 'take-control' || event.action === 'return-control') {
      const destinationId =
        data.controllerId === this.localParticipantId
          ? this.localParticipantId
          : data.controllerId === this.remoteParticipantId
            ? this.remoteParticipantId
            : null
      if (target?.view instanceof MinionView && destinationId)
        await this.presentMinionControlTransfer(target.view, destinationId)
      return
    }

    if (event.action === 'set-health') {
      const healthAfter = numberData('healthAfter')
      const maximumHealthAfter = numberData('maximumHealthAfter')
      if (target?.view instanceof MinionView && healthAfter !== undefined)
        target.view.setHealth(healthAfter, maximumHealthAfter)
      if (target?.view instanceof HeroView) {
        const state = this.presentationState()
        const player = this.findPlayer(state, target.participantId)
        this.syncHeroPresentation(state, target.participantId, {
          health: healthAfter ?? player.hero.health,
          maxHealth: maximumHealthAfter ?? player.hero.maxHealth
        })
      }
      if (target?.view) await this.wait(RESOLUTION_TIMING.outcomePause)
      return
    }

    if (event.action === 'damage') {
      const actualDamage = Math.max(0, numberData('actualDamage') ?? 0)
      const armorDamage = Math.max(0, numberData('armorDamage') ?? 0)
      const totalDamage = actualDamage + armorDamage
      const indicatorAmount = effectDamageIndicatorAmount(data)
      const indicatorDeferredToCharacterEvent =
        event.actionPath.startsWith('hero-power.damage.') ||
        event.actionPath.endsWith('.fatigue')
      if (target?.view instanceof MinionView && data.shieldConsumed === true)
        target.view.setDivineShield(false)
      if (target?.view && (totalDamage > 0 || indicatorAmount > 0)) {
        if (target.view instanceof MinionView) {
          const healthAfter = numberData('healthAfter')
          if (healthAfter !== undefined) target.view.setHealth(healthAfter)
        } else if (target.view instanceof HeroView) {
          const healthAfter = numberData('healthAfter')
          if (healthAfter !== undefined) {
            const player = this.findPlayer(
              this.presentationState(),
              target.participantId
            )
            this.syncHeroPresentation(this.presentationState(), target.participantId, {
              health: healthAfter,
              armor: numberData('armorAfter') ?? player.hero.armor
            })
          }
        }
        if (
          !indicatorDeferredToCharacterEvent &&
          (target.view instanceof MinionView || target.view instanceof HeroView)
        ) {
          this.combat.showDamageIndicator(target.view, indicatorAmount)
        }
      }
      if (event.actionPath.startsWith('combat.')) {
        this.combat.beginLatestImpact()
      }
      await this.wait(
        event.actionPath.startsWith('combat.')
          ? RESOLUTION_TIMING.combatImpactPause
          : RESOLUTION_TIMING.outcomePause
      )
      if (event.actionPath.startsWith('combat.')) {
        const returning = this.combat.returnLatestAttacker()
        if (returning) await returning
      }
      return
    }

    if (event.action === 'restore') {
      const amount = effectHealIndicatorAmount(data)
      const indicatorDeferredToCharacterEvent =
        event.actionPath.startsWith('hero-power.restore')
      const healthAfter = numberData('healthAfter')
      if (target?.view instanceof MinionView && healthAfter !== undefined)
        target.view.setHealth(healthAfter)
      if (target?.view instanceof HeroView && healthAfter !== undefined) {
        this.syncHeroPresentation(this.presentationState(), target.participantId, {
          health: healthAfter
        })
      }
      if (
        !indicatorDeferredToCharacterEvent &&
        amount > 0 &&
        healthAfter !== undefined &&
        (target?.view instanceof MinionView || target?.view instanceof HeroView)
      ) {
        this.combat.showHealIndicator(target.view, amount)
      }
      if (target?.view) await this.wait(RESOLUTION_TIMING.outcomePause)
      return
    }

    if (event.action === 'modify') {
      const attackAfter = numberData('attackAfter')
      const healthAfter = numberData('healthAfter')
      const maximumHealthAfter = numberData('maximumHealthAfter')
      const durabilityAfter = numberData('durabilityAfter')
      if (target?.view instanceof MinionView) {
        if (attackAfter !== undefined) target.view.setAttack(attackAfter)
        if (healthAfter !== undefined)
          target.view.setHealth(healthAfter, maximumHealthAfter)
      } else if (target?.view instanceof WeaponView) {
        if (attackAfter !== undefined) target.view.setAttack(attackAfter)
        if (durabilityAfter !== undefined) target.view.setDurability(durabilityAfter)
      } else if (target?.view instanceof HeroView) {
        this.syncHeroPresentation(this.presentationState(), target.participantId, {
          attack: attackAfter,
          health: healthAfter,
          maxHealth: maximumHealthAfter
        })
      }
      if (target?.view) await this.wait(RESOLUTION_TIMING.outcomePause)
      return
    }

    if (event.action === 'gain-armor' && target?.view instanceof HeroView) {
      this.syncHeroPresentation(this.presentationState(), target.participantId, {
        armor: numberData('armor')
      })
      await this.wait(RESOLUTION_TIMING.outcomePause)
    }
  }

  /** Adds only the hover grayscale filter, preserving result filters when present. */
  private setHistoryBoardDesaturated(active: boolean): void {
    this.historyPreviewDesaturated = active
    this.updateBoardDesaturation()
  }

  private updateBadgeBoardDesaturation(): void {
    this.badgePreviewDesaturated =
      this.localSecretHovered || this.questHoveredSide !== null
    this.updateBoardDesaturation()
  }

  private updateBoardDesaturation(): void {
    if (this.historyPreviewDesaturated || this.badgePreviewDesaturated) {
      if (this.historyGrayscaleFilter) return
      const grayscale = new ColorMatrixFilter()
      grayscale.desaturate()
      this.historyGrayscaleFilter = grayscale
      this.gameplayLayer.filters = [...(this.gameplayLayer.filters ?? []), grayscale]
      return
    }
    if (!this.historyGrayscaleFilter) return
    this.gameplayLayer.filters = (this.gameplayLayer.filters ?? []).filter(
      (filter) => filter !== this.historyGrayscaleFilter
    )
    this.historyGrayscaleFilter = null
  }

  /** Refreshes existing board stats and runtime keyword artwork from the match snapshot. */
  private syncBoardMinionPresentation(state: OpeningMatchState): void {
    for (const player of state.players) {
      const views =
        player.participantId === this.localParticipantId
          ? this.localMinionViews
          : this.remoteMinionViews
      for (const view of views) {
        if (!view.instanceId) continue
        const minion = player.board.find(
          (candidate) => candidate.instanceId === view.instanceId
        )
        if (!minion) continue
        const definition = CARD_CATALOG.require(minion.cardId)
        const markers = boardMinionAbilityMarkers(minion, definition, state.turnNumber)
        view.setPremium(this.premiumAppearance.resolve(minion, player.participantId))
        if (view.cardId !== minion.cardId) {
          view.cardId = minion.cardId
          if (definition.type === 'Minion')
            view.setBaseStats(definition.attack, definition.health)
          void this.resolver.loadArtwork(minion.cardId).then((artwork) => {
            if (artwork && !view.destroyed && view.cardId === minion.cardId)
              view.setArtwork(artwork)
          })
        }
        view.setStats(minion.attack, minion.health, minion.maxHealth)
        view.setTaunt(markers.taunt)
        view.setEnraged(markers.enraged)
        view.setDivineShield(markers.divineShield)
        view.setFrozen(isFrozen(minion.frozenUntilTurn, state.turnNumber))
        view.setAbilityEffects(markers)
        view.setStealth(markers.stealth)
        view.setTrigger(markers.trigger)
        view.setInspire(markers.inspire)
        view.setDeathrattle(markers.deathrattle)
      }
    }
    this.refreshHoveredBoardCardPreview()
  }

  private syncHeroPresentation(
    state: OpeningMatchState,
    ownerId: PlayerId,
    overrides: {
      readonly attack?: number
      readonly health?: number
      readonly armor?: number
      readonly maxHealth?: number
    } = {}
  ): void {
    const player = this.findPlayer(state, ownerId)
    this.heroViews
      .get(ownerId)
      ?.setStats(
        overrides.attack ?? getHeroAttack(player),
        overrides.health ?? player.hero.health,
        overrides.armor ?? player.hero.armor,
        overrides.maxHealth ?? player.hero.maxHealth
      )
  }

  /** Reconciles hero stats after queued resolution visuals have completed. */
  private syncBoardHeroPresentation(state: OpeningMatchState): void {
    for (const player of state.players)
      this.syncHeroPresentation(state, player.participantId)
  }

  /** Keeps the facedown hero-zone markers derived from authoritative secret state. */
  private syncSecrets(state: OpeningMatchState): void {
    state = this.randomSpellState ?? state
    for (const player of state.players) {
      const side = player.participantId === this.localParticipantId ? 'local' : 'remote'
      const visibleQuest = this.revealedOpeningQuestParticipants.has(
        player.participantId
      )
        ? player.quest
        : null
      this.secretZoneView.sync(side, player.secrets?.length ?? 0)
      this.secretZoneView.setPaired(side, !!visibleQuest && !!player.secrets?.length)
      this.questZoneView.sync(side, visibleQuest, !!player.secrets?.length)
    }
    this.refreshSecretPreview(state)
    this.refreshQuestPreview(state)
  }

  private recordOpeningHistory(event: HistoryActionResolvedEvent): void {
    this.historyView?.record(event)
    if (event.entryId !== `${event.participantId}:quest-opening`) return
    this.revealedOpeningQuestParticipants.add(event.participantId)
    this.syncSecrets(this.presentationState())
  }

  private refreshSecretPreview(state = this.presentationState()): void {
    if (!this.localSecretHovered || !this.isBoardCardPreviewEnabled()) {
      if (!this.isBoardCardPreviewEnabled()) this.localSecretHovered = false
      this.secretPreviewView.hide()
      this.updateBadgeBoardDesaturation()
      return
    }
    const secrets =
      state.players.find((player) => player.participantId === this.localParticipantId)
        ?.secrets ?? []
    if (!secrets.length) {
      this.hoverPreview.leave({
        kind: 'secret',
        key: 'secret:local',
        side: 'local'
      })
      this.localSecretHovered = false
      this.secretPreviewView.hide()
      this.updateBadgeBoardDesaturation()
      return
    }
    this.updateBadgeBoardDesaturation()
    void this.secretPreviewView
      .show(
        secrets.map((secret) => ({
          instanceId: secret.instanceId,
          cardId: secret.cardId,
          premium: this.premiumAppearance.resolve(secret, this.localParticipantId),
          premiumSide: this.premiumAppearance.sideFor(secret, this.localParticipantId)
        }))
      )
      .catch((error) => this.logger.warn('Failed to render secret preview.', error))
  }

  private refreshQuestPreview(state = this.presentationState()): void {
    if (!this.questHoveredSide || !this.isBoardCardPreviewEnabled()) {
      if (!this.isBoardCardPreviewEnabled()) this.questHoveredSide = null
      this.questPreviewView.hide()
      this.updateBadgeBoardDesaturation()
      return
    }
    const participantId =
      this.questHoveredSide === 'local'
        ? this.localParticipantId
        : state.players.find(
            (player) => player.participantId !== this.localParticipantId
          )?.participantId
    const quest = state.players.find(
      (player) => player.participantId === participantId
    )?.quest
    if (!quest) {
      this.hoverPreview.leave({
        kind: 'quest',
        key: `quest:${this.questHoveredSide}`,
        side: this.questHoveredSide
      })
      this.questHoveredSide = null
      this.questPreviewView.hide()
      this.updateBadgeBoardDesaturation()
      return
    }
    void this.questPreviewView
      .show(quest.cardId, quest.rewardCardId, quest.progress, quest.target)
      .catch((error) => this.logger.warn('Failed to render Quest preview.', error))
    this.updateBadgeBoardDesaturation()
  }

  private async presentSecretResolution(
    event: Extract<OpeningMatchEvent, { type: 'secret-resolution-started' }>
  ): Promise<void> {
    await this.reconcileRandomSpellState(event.state)
    if (this.destroyed) return
    const side = event.participantId === this.localParticipantId ? 'local' : 'remote'
    const origin = this.secretZoneView.revealOrigin(side, this.secretRevealView)
    const removeSecret = (player: OpeningMatchState['players'][number]) =>
      player.participantId === event.participantId
        ? {
            ...player,
            secrets: (player.secrets ?? []).filter(
              (secret) => secret.instanceId !== event.secretId
            )
          }
        : player
    const consumedState: OpeningMatchState = {
      ...event.state,
      players: [
        removeSecret(event.state.players[0]),
        removeSecret(event.state.players[1])
      ]
    }
    const consumeBadge = (): void => {
      if (this.destroyed) return
      this.randomSpellState = consumedState
      this.syncSecrets(consumedState)
    }
    const identity = { instanceId: event.secretId, cardId: event.cardId }
    try {
      await this.secretRevealView.present(
        event.cardId,
        origin,
        consumeBadge,
        this.premiumAppearance.resolve(identity, event.participantId),
        this.premiumAppearance.sideFor(identity, event.participantId)
      )
    } catch (error) {
      this.logger.warn('Failed to render Secret reveal.', error)
      consumeBadge()
    }
  }

  private async presentMinionCardMovement(movement: MinionCardMovement): Promise<void> {
    const source = [...this.localMinionViews, ...this.remoteMinionViews].find(
      (view) => view.instanceId === movement.sourceInstanceId && !view.destroyed
    )
    if (!source || this.destroyed) return
    if (this.hoveredBoardCardView === source) this.hideBoardCardPreview(source)
    if (!movement.copy && this.selectedCombatView === source)
      this.deselectAttacker(false)
    const slots: GameCardSlot[] = []
    const adopted = new Set<GameCardSlot>()
    try {
      // Finish loading before replacing the live board body. Keep each completed
      // slot owned even if a later load fails or the scene leaves during loading.
      for (const card of movement.cards) {
        const slot = await this.createSlot(card)
        slots.push(slot)
        this.activeDepartureSlots.add(slot)
        if (this.destroyed) return
      }
      const replaced = movement.replacedHandCard
      if (replaced?.participantId === this.localParticipantId) {
        const index = this.hand.entries.findIndex(
          (entry) => entry.card.instanceId === replaced.instanceId
        )
        if (index >= 0) this.hand.removeAt(index)?.slot.destroy({ children: true })
      } else if (replaced?.participantId === this.remoteParticipantId) {
        this.remoteBackCount = Math.max(0, this.remoteBackCount - 1)
        this.layoutRemoteHand()
      }
      const results = await Promise.allSettled(
        slots.map(async (slot, index) => {
          const ready = await this.cardDepartureAnimation.materialize(
            source,
            slot,
            () => {
              if (movement.copy) return
              this.removeMinionView(source)
              this.applyLocalBoardLayout()
              this.applyRemoteBoardLayout()
            },
            movement.copy ? index * CARD_DEPARTURE_LAYOUT.copyStagger : 0
          )
          if (!ready || this.destroyed) return
          if (movement.destination === 'discarded') {
            await this.cardDepartureAnimation.destroyCard(slot)
            return
          }
          if (movement.destination === 'deck') {
            await this.animateSlotToDeck(
              slot,
              movement.participantId === this.localParticipantId
                ? GAME_BOARD_LAYOUT.decks.local
                : GAME_BOARD_LAYOUT.decks.remote,
              index
            )
            return
          }
          if (movement.participantId === this.localParticipantId) {
            if (this.findEntry(slot.instanceId)) return
            this.travelLayer.reparentChild(slot)
            this.hand.insert(movement.handIndex ?? this.hand.entries.length, {
              card: cloneCard(movement.cards[index]),
              slot,
              restTransform: undefined,
              displaced: false
            })
            const wasReflowing = this.hand.isReflowing
            this.hand.setReflowing(true)
            this.hand.resetHover()
            try {
              await this.hand.applyLayout({
                positionDuration: RESOLUTION_TIMING.generatedCard,
                scaleDuration: RESOLUTION_TIMING.generatedCard
              })
              if (this.destroyed || slot.destroyed) return
              this.hand.layer.reparentChild(slot)
              slot.suppressPlayableOutline(false)
              this.hand.configureSlot(slot)
              adopted.add(slot)
            } finally {
              this.hand.setReflowing(wasReflowing)
            }
          } else {
            await this.presentReturnedRemoteCard(slot)
          }
        })
      )
      const failure = results.find((result) => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
    } finally {
      for (const slot of slots) {
        this.activeDepartureSlots.delete(slot)
        if (adopted.has(slot)) continue
        const index = this.hand.entries.findIndex((entry) => entry.slot === slot)
        if (index >= 0) this.hand.removeAt(index)
        if (!slot.destroyed) slot.destroy({ children: true })
      }
    }
  }

  private async presentReturnedRemoteCard(slot: GameCardSlot): Promise<void> {
    const scale = slot.scale.x
    await completeTimeline(
      this.timeline().to(slot.scale, {
        x: 0,
        duration: CARD_PLAY_LAYOUT.minion.snapDuration / 2,
        ease: 'sine.in'
      })
    )
    if (this.destroyed || slot.destroyed) return
    this.remoteBackCount += 1
    this.ensureRemoteBacks(this.remoteBackCount)
    const back = this.remoteBacks[this.remoteBackCount - 1]
    slot.alpha = 0
    back.position.copyFrom(this.remoteHandLayer.toLocal(slot.toGlobal({ x: 0, y: 0 })))
    back.rotation = 0
    back.alpha = 1
    back.scale.set(0, (slot.card.renderedHeight * scale) / back.texture.height)
    await completeTimeline(
      this.timeline().to(back.scale, {
        x: (slot.card.plan.width * scale) / back.texture.width,
        duration: CARD_PLAY_LAYOUT.minion.snapDuration / 2,
        ease: 'sine.out'
      })
    )
    if (this.destroyed || back.destroyed) return
    await this.animateBackToHand(
      back,
      this.remoteBackCount - 1,
      this.remoteBackCount,
      RESOLUTION_TIMING.generatedCard,
      0
    )
  }

  private async reconcileRandomSpellState(state: OpeningMatchState): Promise<void> {
    await this.reconcileWeaponViews(state)
    if (this.destroyed) return
    await this.reconcileEffectMovement(state)
    if (this.destroyed) return
    this.syncBoardMinionPresentation(state)
    this.syncBoardHeroPresentation(state)
    this.syncTurnHud(state)
    this.syncSecrets(state)
  }

  /**
   * Effect actions can move existing instances without a play-card event
   * (bounce, resurrect, transform, steal, or swap). Reconcile by instance ID
   * so those movements remain visible and board reordering follows domain
   * order instead of relying on a stale presentation array.
   */
  private async reconcileEffectMovement(state: OpeningMatchState): Promise<void> {
    // Control-change events normally move the live view during presentation.
    // If presentation was interrupted or an event was unavailable, adopt that
    // same instance into its authoritative row before pruning either board.
    for (const player of state.players) {
      const destinationViews = this.minionViewsFor(player.participantId)
      for (const [position, minion] of player.board.entries()) {
        if (destinationViews.some((view) => view.instanceId === minion.instanceId))
          continue
        const existing = [...this.localMinionViews, ...this.remoteMinionViews].find(
          (view) => !view.destroyed && view.instanceId === minion.instanceId
        )
        if (existing)
          this.moveMinionViewToBoard(existing, player.participantId, position)
      }
    }

    for (const player of state.players) {
      const views =
        player.participantId === this.localParticipantId
          ? this.localMinionViews
          : this.remoteMinionViews
      const representedInstances = new Set<string>()
      for (const view of [...views]) {
        const instanceId = view.instanceId
        if (
          view.destroyed ||
          !instanceId ||
          representedInstances.has(instanceId) ||
          !player.board.some((minion) => minion.instanceId === instanceId)
        ) {
          this.removeMinionView(view)
          continue
        }
        representedInstances.add(instanceId)
      }
      for (const [position, minion] of player.board.entries()) {
        if (views.some((view) => view.instanceId === minion.instanceId)) continue
        await this.presentMinionPlayed(
          {
            type: 'dev-minion-summoned',
            participantId: player.participantId,
            minion,
            position
          },
          undefined,
          false
        )
      }
      this.boardPositions.reorder(
        this.boardSide(player.participantId),
        player.board.map((minion) => minion.instanceId)
      )
      if (player.participantId === this.localParticipantId) this.applyLocalBoardLayout()
      else this.applyRemoteBoardLayout()
    }
    const local = this.findPlayer(state, this.localParticipantId)
    let removedLocalCard = false
    for (const entry of [...this.hand.entries]) {
      if (local.hand.some((card) => card.instanceId === entry.card.instanceId)) continue
      const index = this.hand.entries.indexOf(entry)
      if (index >= 0) {
        this.hand.removeAt(index)
        removedLocalCard = true
      }
      entry.slot.disposePlayableOutline()
      entry.slot.removeFromParent()
      entry.slot.destroy({ children: true })
    }
    if (removedLocalCard) this.hand.resetHover()

    const missingLocalCards = local.hand.filter(
      (card) =>
        !this.hand.entries.some((entry) => entry.card.instanceId === card.instanceId)
    )
    for (const card of missingLocalCards)
      await this.presentDraw(this.localParticipantId, card)

    if (removedLocalCard && missingLocalCards.length === 0) {
      const wasReflowing = this.hand.isReflowing
      this.hand.setReflowing(true)
      try {
        await this.hand.applyLayout({
          positionDuration: OPENING_TIMING.cardDeal,
          scaleDuration: OPENING_TIMING.cardDeal
        })
      } finally {
        this.hand.setReflowing(wasReflowing)
      }
    }
    const remoteHand = this.findPlayer(state, this.remoteParticipantId).hand
    while (this.remoteBackCount < remoteHand.length) {
      if (this.destroyed) return
      await this.presentDraw(this.remoteParticipantId, remoteHand[this.remoteBackCount])
    }
    this.remoteBackCount = remoteHand.length
    this.layoutRemoteHand()
  }

  /** Flips the portrait and its newly installed Hero Power at the same time. */
  private async presentHeroReplaced(
    event: Extract<OpeningMatchEvent, { type: 'hero-replaced' }>
  ): Promise<void> {
    const player = this.findPlayer(this.presentationState(), event.participantId)
    const hero = HERO_CATALOG.require(event.heroId)
    const heroPower = HERO_POWER_CATALOG.require(hero.heroPowerId)
    const view = this.heroViews.get(event.participantId)
    const heroPowerView = this.heroPowerViews.get(event.participantId)
    view?.setStats(
      getHeroAttack(player),
      player.hero.health,
      player.hero.armor,
      player.hero.maxHealth
    )
    view?.setImmune(player.hero.immune === true)
    heroPowerView?.setCost(heroPower.cost)
    await Promise.all([
      view?.replaceFrame(this.options.heroAssets[hero.presentationAssetKey]) ??
        Promise.resolve(),
      heroPowerView?.replaceArtwork(
        this.options.gameAssets[heroPower.presentationAssetKey as HeroPowerAssetKey],
        this.heroPowerPremiumForParticipant(event.participantId)
      ) ?? Promise.resolve()
    ])
    this.syncHeroPowerViews(this.presentationState())
  }

  /** Flips an upgraded or otherwise replaced Hero Power to its new face. */
  private async presentHeroPowerReplaced(
    event: Extract<OpeningMatchEvent, { type: 'hero-power-replaced' }>
  ): Promise<void> {
    const view = this.heroPowerViews.get(event.participantId)
    if (!view) return
    const definition = HERO_POWER_CATALOG.require(event.heroPowerId)
    view.setCost(definition.cost)
    await view.replaceArtwork(
      this.options.gameAssets[definition.presentationAssetKey as HeroPowerAssetKey],
      this.heroPowerPremiumForParticipant(event.participantId)
    )
    this.syncHeroPowerViews(this.presentationState())
  }

  /**
   * Whether a participant's hero power should render premium: the dev
   * override, the starting hero's own premium, or a premium minion that
   * replaced the power (premium Justicar, Finley, or hero card).
   */
  private heroPowerPremiumForParticipant(participantId: PlayerId): boolean {
    const side = participantId === this.localParticipantId ? 'local' : 'remote'
    return (
      isPremiumEnabled(side) || this.premiumAppearance.heroPowerPremium(participantId)
    )
  }

  private heroPowerPremiumFor(player: OpeningPlayerState): boolean {
    return (
      this.heroPowerPremiumForParticipant(player.participantId) ||
      isPurchasedPremium(player.heroId)
    )
  }

  /** Premium discovery options when the choice source is premium (Sir Finley). */
  private heroPowerChoicePremium(
    participantId: PlayerId,
    sourceCardInstanceId: string
  ): boolean {
    return (
      this.heroPowerPremiumForParticipant(participantId) ||
      this.premiumAppearance.instancePremium(sourceCardInstanceId)
    )
  }

  private presentCharacterStateChange(
    event: Extract<
      OpeningMatchEvent,
      { type: 'character-damaged' | 'character-healed' }
    >
  ): void {
    if (event.character.kind === 'hero') {
      const player = this.findPlayer(this.presentationState(), event.participantId)
      this.heroViews
        .get(event.participantId)
        ?.setStats(
          getHeroAttack(player),
          event.healthAfter,
          event.type === 'character-damaged' ? event.armorAfter : player.hero.armor,
          player.hero.maxHealth
        )
      return
    }
    const character = event.character
    if (character.kind !== 'minion') return
    const view = this.findMinionView(event.participantId, character.instanceId)
    if (!view) return
    if (event.type === 'character-damaged' && event.destroyed) {
      this.removeMinionView(view)
      if (event.participantId === this.localParticipantId) this.applyLocalBoardLayout()
      else this.applyRemoteBoardLayout()
      return
    }
    const state = this.presentationState()
    const player = this.findPlayer(state, event.participantId)
    const minion = player.board.find(
      (candidate) => candidate.instanceId === character.instanceId
    )
    if (!minion) return
    view.setStats(minion.attack, event.healthAfter, minion.maxHealth)
    view.setDivineShield(
      boardMinionAbilityMarkers(
        minion,
        CARD_CATALOG.require(minion.cardId),
        state.turnNumber
      ).divineShield
    )
  }

  async devAddCard(cardId: string, target: DevMatchTarget = 'local'): Promise<void> {
    if (!this.hand.active)
      throw new Error('Dev add-card is only available after the opening sequence.')
    const definition = CARD_CATALOG.get(asCardId(cardId))
    if (!definition) throw new Error(`Unknown card ${cardId}`)
    const result = this.dispatchCommand({
      type: 'dev-add-card',
      participantId: this.participantIdForTarget(target),
      cardId: definition.id
    })
    if (!result.accepted) throw new Error(result.message)
    await this.presentResolutionEvents(result.events)
    this.syncTurnHud(result.state)
  }

  openCardPicker(target: DevMatchTarget, action: DevCardPickerAction): void {
    if (!this.addCardPicker) {
      throw new Error('The add-card picker is unavailable in this environment.')
    }

    this.pickerTarget = target
    this.pickerAction = action
    const playerName = target === 'local' ? 'Local Player' : 'Remote Player'
    const isSummon = action === 'summon'
    this.addCardPicker.open({
      title: `${isSummon ? 'Summon Minion' : 'Add Card to Hand'} — ${playerName}`,
      successMessage: isSummon ? 'Minion summoned.' : 'Card added to hand.',
      cards: isSummon
        ? CARD_CATALOG.all.filter((card) => card.type === 'Minion')
        : undefined
    })
    if (!this.hand.active) {
      this.addCardPicker.setStatus(
        'The match must finish its opening sequence before this dev tool can be used.',
        'error'
      )
    }
  }

  async devEndMatch(outcome: 'win' | 'lose'): Promise<void> {
    if (!this.hand.active)
      throw new Error('Dev end-match is only available after the opening sequence.')
    const winnerId =
      outcome === 'win' ? this.localParticipantId : this.remoteParticipantId
    const result = this.dispatchCommand({
      type: 'dev-end-match',
      participantId: this.localParticipantId,
      winnerId
    })
    if (!result.accepted) throw new Error(result.message)
    await this.presentResolutionEvents(result.events)
  }

  /** Completes the match so conceding uses the normal persisted result flow. */
  concede(): void {
    if (this.matchResultShown || this.matchResultPending) return
    const result = this.session.dispatch({
      type: 'concede',
      participantId: this.localParticipantId
    })
    if (!result.accepted) return
    void this.presentResolutionEvents(result.events).catch((error) => {
      this.logger.warn('Failed to present concession.', error)
    })
  }

  async devSummonMinion(cardId: string, target: DevMatchTarget): Promise<void> {
    if (!this.hand.active)
      throw new Error('Dev summon is only available after the opening sequence.')
    const definition = CARD_CATALOG.get(asCardId(cardId))
    if (!definition) throw new Error(`Unknown card ${cardId}`)
    const result = this.dispatchCommand({
      type: 'dev-summon-minion',
      participantId: this.participantIdForTarget(target),
      cardId: definition.id
    })
    if (!result.accepted) throw new Error(result.message)
    await this.enqueuePresentation(result.state, () =>
      this.presentResolutionEvents(result.events)
    )
    this.syncTurnHud(result.state)
  }

  async devModifyDeck(target: DevMatchTarget, action: DevDeckAction): Promise<void> {
    const result = this.dispatchCommand({
      type: 'dev-modify-deck',
      participantId: this.participantIdForTarget(target),
      action
    })
    if (!result.accepted) throw new Error(result.message)
    await this.presentResolutionEvents(result.events)
    this.syncTurnHud(result.state)
  }

  async runDevCommand(command: DevCommand): Promise<void> {
    if (!this.hand.active)
      throw new Error('Dev commands are only available after the opening sequence.')
    const result = dispatchDevMatchCommand(
      (matchCommand) => this.dispatchCommand(matchCommand),
      command,
      (target) => this.participantIdForTarget(target)
    )
    if (!result) return
    if (!result.accepted) throw new Error(result.message)
    await this.enqueuePresentation(result.state, () =>
      this.presentResolutionEvents(result.events)
    )
    this.syncTurnHud(result.state)
  }

  private async presentDevCardAdded(
    event: Extract<OpeningMatchEvent, { type: 'dev-card-added' }>
  ): Promise<void> {
    if (event.participantId === this.localParticipantId) {
      await this.spawnLocalCard(event.card, GAME_BOARD_LAYOUT.frame.center)
      this.syncTurnHud(this.match.getState())
    } else {
      // Remote dev add (not used via menu) - treat like draw
      await this.presentDraw(event.participantId, event.card)
    }
  }

  private async presentDevMinionSummoned(
    event: Extract<OpeningMatchEvent, { type: 'dev-minion-summoned' }>
  ): Promise<void> {
    await this.presentMinionPlayed(event, undefined, false)
  }

  private participantIdForTarget(target: DevMatchTarget): PlayerId {
    return target === 'local' ? this.localParticipantId : this.remoteParticipantId
  }

  toggleDeckTracker(): void {
    const visible = !this.hud.deckTracker.visible
    this.hud.deckTracker.setVisible(visible)
    if (visible && this.match) this.updateDeckTracker(this.match.getState())
  }

  setDeckTracker(
    visibility: 'hidden' | 'local',
    sortMode: 'cost' | 'alphabetical' | 'draw-order'
  ): void {
    const state = this.presentationState()
    this.hud.setDeckTracker(
      visibility,
      sortMode,
      this.findPlayer(state, this.localParticipantId).deck
    )
  }

  private updateDeckTracker(state: OpeningMatchState): void {
    state = this.randomSpellState ?? state
    const localPlayer = this.findPlayer(state, this.localParticipantId)
    if (this.hud.deckTracker.visible) this.hud.deckTracker.update(localPlayer.deck)
  }

  /** Keeps the opening event compatible with the normal turn presentation. */
  private async presentHeroPowerReveal(): Promise<void> {
    await Promise.all([...this.heroPowerViews.values()].map((view) => view.flipUp()))
  }

  /**
   * Flips one player's hero power up after use on a previous turn, or down
   * after use this turn. The view ignores a request for its current face.
   */
  private async presentHeroPowerFlip(
    participantId: PlayerId,
    up: boolean
  ): Promise<void> {
    const view = this.heroPowerViews.get(participantId)
    if (!view) return
    if (up) await view.flipUp()
    else await view.flipDown()
  }

  /** Replaces the local hand through one parallel in-place horizontal flip. */
  private async presentGoldenMonkeyHandReplacement(
    replacement: GoldenMonkeyHandReplacement
  ): Promise<void> {
    const exitingEntries = this.hand.entries.filter((entry) =>
      replacement.targetInstanceIds.has(entry.card.instanceId)
    )
    if (exitingEntries.length === 0) return

    // Golden Monkey targets the complete hand. Avoid partially clearing a
    // presentation if a future rules change leaves an unrelated card behind.
    if (exitingEntries.length !== this.hand.entries.length) {
      this.logger.warn(
        '[Game presentation] Golden Monkey did not target every rendered hand card.'
      )
      return
    }

    const exitingIds = new Set(exitingEntries.map((entry) => entry.card.instanceId))
    const transformedCards = this.findPlayer(
      this.presentationState(),
      this.localParticipantId
    ).hand.filter((card) => exitingIds.has(card.instanceId))
    if (transformedCards.length !== exitingEntries.length) {
      this.logger.warn(
        '[Game presentation] Golden Monkey hand snapshots are incomplete.'
      )
      return
    }

    const wasReflowing = this.hand.isReflowing
    this.hand.setReflowing(true)
    this.hand.resetHover()
    try {
      // Resolve every transformed face before any flip starts so artwork
      // loading cannot leave half the hand on the old face.
      const presentations = await Promise.all(
        transformedCards.map(async (card) => ({
          card,
          presentation: await this.createCardPresentation(card)
        }))
      )
      const presentationById = new Map(
        presentations.map(({ card, presentation }) => [card.instanceId, presentation])
      )

      for (const entry of exitingEntries) {
        const presentation = presentationById.get(entry.card.instanceId)
        if (!presentation) {
          this.logger.warn(
            '[Game presentation] Golden Monkey replacement face is missing.',
            entry.card.instanceId
          )
          return
        }
        entry.slot.prepareCardReplacement(
          presentation.card,
          presentation.outlineTexture
        )
      }

      await Promise.all(
        exitingEntries.map((entry) =>
          entry.slot.flipToCardReplacement(RESOLUTION_TIMING.handReplacementFlip)
        )
      )

      for (const entry of exitingEntries) {
        const card = transformedCards.find(
          (candidate) => candidate.instanceId === entry.card.instanceId
        )
        if (!card) continue
        entry.card = cloneCard(card)
        entry.slot.refreshPlayableOutline()
        this.hand.configureSlot(entry.slot)
      }
    } finally {
      this.hand.setReflowing(wasReflowing)
    }
  }

  private async presentGeneratedCard(
    event: Extract<OpeningMatchEvent, { type: 'card-generated' }>
  ): Promise<void> {
    if (event.origin.kind === 'deck') {
      await this.presentDraw(
        event.participantId,
        event.card,
        event.origin.participantId
      )
      return
    }
    const origin = this.generatedCardOrigin(event.origin)
    if (event.participantId === this.localParticipantId) {
      if (this.findEntry(event.card.instanceId)) return
      // Effects may modify a generated card later in the same resolution (for
      // example, Unstable Portal reduces its cost). Build the slot from the
      // committed hand card, not the earlier event snapshot.
      const card = this.findPlayer(
        this.presentationState(),
        event.participantId
      ).hand.find((candidate) => candidate.instanceId === event.card.instanceId)
      if (!card) return
      await this.spawnLocalCard(card, origin)
    } else if (event.participantId === this.remoteParticipantId) {
      this.remoteBackCount += 1
      this.ensureRemoteBacks(this.remoteBackCount)
      const back = this.remoteBacks[this.remoteBackCount - 1]
      if (back) {
        this.prepareBackAtGeneratedOrigin(back, origin)
        await this.animateBackToHand(
          back,
          this.remoteBackCount - 1,
          this.remoteBackCount,
          RESOLUTION_TIMING.generatedCard,
          0
        )
      }
    }
    this.syncTurnHud(this.match.getState())
  }

  private async spawnLocalCard(
    card: OpeningCard,
    origin: { x: number; y: number }
  ): Promise<void> {
    if (this.findEntry(card.instanceId)) return
    const slot = await this.createSlot(card)
    this.prepareSlotAtGeneratedOrigin(slot, origin)
    this.travelLayer.addChild(slot)
    this.hand.append({
      card: cloneCard(card),
      slot,
      restTransform: undefined,
      displaced: false
    })
    await this.hand.applyLayout({
      positionDuration: RESOLUTION_TIMING.generatedCard,
      scaleDuration: RESOLUTION_TIMING.generatedCard,
      delayedInstanceId: card.instanceId,
      preserveHover: true
    })
    // Promote the completed card above the travel layer and enable hand interaction.
    this.hand.layer.addChild(slot)
    this.hand.configureSlot(slot)
  }

  private generatedCardOrigin(
    origin: Extract<OpeningMatchEvent, { type: 'card-generated' }>['origin']
  ): { x: number; y: number } {
    if (origin.kind === 'minion') {
      const view = [...this.localMinionViews, ...this.remoteMinionViews].find(
        (candidate) => candidate.instanceId === origin.instanceId
      )
      if (view && !view.destroyed)
        return this.travelLayer.toLocal(view.getGlobalPosition())
    }
    return GAME_BOARD_LAYOUT.frame.center
  }

  private async presentDeckBurn(
    event: Extract<OpeningMatchEvent, { type: 'card-burned' }>
  ): Promise<void> {
    const slot = await this.createSlot(event.card)
    if (this.destroyed) {
      slot.destroy({ children: true })
      return
    }
    this.activeDepartureSlots.add(slot)
    this.travelLayer.addChild(slot)
    this.prepareSlotAtDeck(
      slot,
      event.participantId === this.localParticipantId
        ? GAME_BOARD_LAYOUT.decks.local
        : GAME_BOARD_LAYOUT.decks.remote,
      0
    )
    // This temporary card never belongs to the hand. Its destination transform
    // only supplies snapshot dimensions; the flight stops at the authored peak.
    slot.skew.set(0, 0)
    slot.rotation = 0
    slot.eventMode = 'none'
    try {
      await this.animateDeckDeparture(slot, 0, 0, 'local-reveal', () => {
        // Deck destruction already belongs to its triggering action's history.
        if (event.origin !== 'deck-destruction') this.historyView?.recordBurn(event)
        this.syncTurnHud(this.match.getState())
      })
    } finally {
      this.activeDepartureSlots.delete(slot)
      if (!slot.destroyed) slot.destroy({ children: true })
    }
  }

  private async presentDraw(
    participantId: PlayerId,
    card: OpeningCard,
    sourceDeck?: PlayerId
  ): Promise<void> {
    if (participantId === this.localParticipantId) {
      await this.addLocalCard(card, sourceDeck)
    } else {
      this.remoteBackCount += 1
      this.ensureRemoteBacks(this.remoteBackCount)
      const back = this.remoteBacks[this.remoteBackCount - 1]
      if (back) {
        if (sourceDeck) {
          this.prepareBackAtDeck(back, this.remoteBackCount - 1)
          const deck = this.deckViews.get(sourceDeck)
          if (deck) this.drawOrigins.set(back, deck)
        } else this.prepareBackAtGeneratedOrigin(back, GAME_BOARD_LAYOUT.frame.center)
        await this.animateBackToHand(
          back,
          this.remoteBackCount - 1,
          this.remoteBackCount,
          sourceDeck ? OPENING_TIMING.cardDeal : RESOLUTION_TIMING.generatedCard,
          0
        )
      }
    }
    this.syncTurnHud(this.match.getState())
    await this.wait(OPENING_TIMING.replacementPause)
  }

  private async presentWeaponEquipped(
    event: Extract<OpeningMatchEvent, { type: 'weapon-equipped' }>,
    adjustRemoteHand = false
  ): Promise<void> {
    const isLocal = event.participantId === this.localParticipantId
    const isRemote = event.participantId === this.remoteParticipantId
    if (!isLocal && !isRemote) return
    const current = this.weaponViews.get(event.participantId)
    if (current?.instanceId === event.weapon.instanceId) {
      current.setStats(event.weapon.attack, event.weapon.durability)
      return
    }

    const definition = CARD_CATALOG.require(event.weapon.cardId)
    const markers = boardAbilityMarkers(definition)
    const layout = isLocal
      ? GAME_BOARD_LAYOUT.weapons.local
      : GAME_BOARD_LAYOUT.weapons.remote
    const [artwork, attackTexture, durabilityTexture] = await Promise.all([
      this.resolver.loadArtwork(event.weapon.cardId),
      this.resolver.load('card.stat.weapon-attack'),
      this.resolver.load('card.stat.weapon-durability')
    ])
    const view = await WeaponView.create(
      {
        label: `game.weapon.${event.weapon.instanceId}`,
        premium: this.premiumAppearance.resolve(event.weapon, event.participantId),
        premiumSide: this.premiumAppearance.sideFor(event.weapon, event.participantId),
        attack: event.weapon.attack,
        durability: event.weapon.durability,
        printedDurability:
          definition.type === 'Weapon'
            ? definition.durability
            : event.weapon.maxDurability,
        deathrattle: markers.deathrattle,
        trigger: markers.trigger,
        temporaryAbilityLabels: [
          ...(definition.keywords.includes('mega-windfury')
            ? ['Mega Windfury']
            : markers.windfury
              ? ['Windfury']
              : []),
          ...(markers.spellDamage ? ['Spell Damage'] : []),
          ...(markers.elusive ? ['Elusive'] : []),
          ...(markers.immune ? ['Immune'] : [])
        ]
      },
      {
        frame: this.options.gameAssets.weapon,
        premiumFrame: this.options.gameAssets.premiumWeapon,
        trigger: this.options.gameAssets.boardTrigger,
        deathrattle: this.options.gameAssets.boardDeathrattle,
        attack: attackTexture,
        durability: durabilityTexture
      },
      artwork
    )

    const previous = this.weaponViews.get(event.participantId)
    if (previous) {
      const previousMarker = previous.getAbilityMarkerSnapshot('deathrattle')
      if (previousMarker && previous.instanceId)
        this.combat.captureDeathMarker(previous.instanceId, previousMarker)
      this.removeWeaponView(event.participantId, previous)
    }
    view.instanceId = event.weapon.instanceId
    view.ownerId = event.participantId
    this.weaponViews.set(event.participantId, view)
    applyPlacement(view, layout)
    view.alpha = 0
    const targetScale = layout.scale ?? { x: 1, y: 1 }
    view.shadow.restingScale = targetScale.x
    view.scale.set(targetScale.x * 0.72, targetScale.y * 0.72)
    view.eventMode = 'static'
    const hoverTarget = this.boardCardHoverTarget(view)
    view.on('pointerover', () => this.hoverPreview.enter(hoverTarget))
    view.on('pointerout', () => this.hoverPreview.leave(hoverTarget))
    this.weaponLayer.addChild(view)

    if (isRemote && adjustRemoteHand) {
      // The remote weapon card came from the hidden AI hand.
      this.remoteBackCount = Math.max(0, this.remoteBackCount - 1)
      this.layoutRemoteHand()
    }

    const reveal = this.timeline()
    reveal.to(view, {
      alpha: 1,
      duration: BOARD_TIMING.minionSettle,
      ease: 'power2.out',
      overwrite: 'auto'
    })
    reveal.to(
      view.scale,
      {
        x: targetScale.x,
        y: targetScale.y,
        duration: BOARD_TIMING.minionSettle,
        ease: 'back.out(1.2)',
        overwrite: 'auto'
      },
      0
    )
    await completeTimeline(reveal)
    this.syncTurnHud(this.match.getState())
  }

  /** Creates missing equipped-weapon presentation from authoritative state. */
  private async reconcileWeaponViews(state: OpeningMatchState): Promise<void> {
    for (const player of state.players) {
      const current = this.weaponViews.get(player.participantId)
      if (!player.weapon) {
        if (current) this.removeWeaponView(player.participantId, current)
        continue
      }
      if (current?.instanceId === player.weapon.instanceId) {
        current.setStats(player.weapon.attack, player.weapon.durability)
        continue
      }
      await this.presentWeaponEquipped(
        {
          type: 'weapon-equipped',
          participantId: player.participantId,
          weapon: player.weapon,
          replacedWeapon: null
        },
        false
      )
    }
  }

  private async presentRemoteDiscoverSelection(
    selectedInstanceId: string,
    keepSelected: boolean
  ): Promise<boolean> {
    const handCount = this.remoteBackCount + (keepSelected ? 1 : 0)
    const destinationCount = Math.max(1, handCount)
    const transform = this.remoteHandTransform(destinationCount - 1, destinationCount)
    const globalDestination = this.remoteHandLayer.toGlobal({
      x: transform.x,
      y: transform.y
    })
    const destination = this.cardSelectionOverlay.toLocal(globalDestination)
    const selected = await this.cardSelectionOverlay.resolveRemoteDiscover(
      selectedInstanceId,
      {
        x: destination.x,
        y: destination.y,
        scale: transform.scale,
        rotation: transform.rotation
      },
      keepSelected
    )
    if (!selected || this.destroyed) return false

    const globalPosition = this.cardSelectionOverlay.toGlobal({
      x: selected.x,
      y: selected.y
    })
    this.remoteHandLayer.addChild(selected)
    const localPosition = this.remoteHandLayer.toLocal(globalPosition)
    selected.position.set(localPosition.x, localPosition.y)
    selected.eventMode = 'none'
    this.remoteBacks.splice(this.remoteBackCount, 0, selected)
    this.remoteBackCount = handCount
    this.layoutRemoteHand()
    return true
  }

  private async presentRemoteTargetedSpell(
    targets: readonly CardPlayTargetRef[]
  ): Promise<void> {
    const sourceView = this.heroViews.get(this.remoteParticipantId)
    if (!sourceView || targets.length === 0) return
    const targetViews = targets
      .map((target) => this.findCardPlayTargetView(target))
      .filter((view): view is CombatView | WeaponView => view !== undefined)
    if (targetViews.length === 0) return

    await this.presentRemoteTargetPreview(sourceView, targetViews)
  }

  private async presentRemoteHeroPowerTarget(
    target: HeroPowerTargetRef
  ): Promise<void> {
    const sourceView = this.heroPowerViews.get(this.remoteParticipantId)
    const targetView = this.findHeroPowerTargetView(target)
    if (!sourceView || !targetView) return

    await this.presentRemoteTargetPreview(sourceView.card, [targetView])
  }

  private async presentRemoteTargetPreview(
    sourceView: Container,
    targetViews: readonly (CombatView | WeaponView)[]
  ): Promise<void> {
    if (targetViews.length === 0) return
    const source = this.remoteTargetPreview.toLocal(sourceView.getGlobalPosition())
    const points = targetViews.map((view) =>
      this.remoteTargetPreview.toLocal(view.getGlobalPosition())
    )
    const outlined = targetViews.filter(
      (view): view is CombatView =>
        view instanceof HeroView || view instanceof MinionView
    )
    for (const view of outlined) view.setTargetingOutline(true)
    try {
      await this.remoteTargetPreview.present(source, points)
    } finally {
      for (const view of outlined) view.setTargetingOutline(false)
      if (!this.destroyed) this.syncBoardAttackability(this.presentationState())
    }
  }

  private findCardPlayTargetView(
    target: CardPlayTargetRef
  ): CombatView | WeaponView | undefined {
    switch (target.kind) {
      case 'hero':
        return this.heroViews.get(target.participantId)
      case 'minion':
        return this.findMinionView(target.participantId, target.instanceId)
      case 'weapon': {
        const view = this.weaponViews.get(target.participantId)
        return view?.instanceId === target.instanceId ? view : undefined
      }
      default:
        return undefined
    }
  }

  private findHeroPowerTargetView(target: HeroPowerTargetRef): CombatView | undefined {
    if (target.kind === 'hero') return this.heroViews.get(target.participantId)
    return this.findMinionView(target.participantId, target.instanceId)
  }

  private remoteMinionCard(
    event: Extract<OpeningMatchEvent, { type: 'minion-played' }>,
    sourceCard?: OpeningCard
  ): OpeningCard {
    const definition = CARD_CATALOG.require(event.minion.cardId)
    return {
      ...sourceCard,
      instanceId: event.minion.instanceId,
      cardId: event.minion.cardId,
      ownerId: event.minion.ownerId ?? event.participantId,
      controllerId: event.minion.controllerId ?? event.participantId,
      baseCost: sourceCard?.baseCost ?? definition.cost,
      currentCost: sourceCard?.currentCost ?? definition.cost,
      zone: 'revealed',
      revealed: true,
      attack: event.minion.attack,
      health: event.minion.health
    }
  }

  private async presentRemoteMinionPlayed(
    event: Extract<OpeningMatchEvent, { type: 'minion-played' }>,
    sourceCard?: OpeningCard | null
  ): Promise<void> {
    if (this.findMinionView(event.participantId, event.minion.instanceId)) {
      await this.presentMinionPlayed(event)
      return
    }

    const handCountBefore = this.remoteBackCount
    const sourceIndex = handCountBefore > 0 ? Math.floor((handCountBefore - 1) / 2) : -1
    const sourceBack = sourceIndex >= 0 ? this.remoteBacks[sourceIndex] : undefined
    const fallbackPosition = this.remoteHandLayer.toGlobal({
      x: GAME_BOARD_LAYOUT.remoteHand.centerX,
      y: GAME_BOARD_LAYOUT.remoteHand.baselineY
    })
    const sourcePosition = sourceBack?.getGlobalPosition() ?? fallbackPosition
    const sourceRotation = sourceBack?.rotation ?? 0
    const sourceScale =
      sourceBack?.scale.x ?? this.remoteHandMetrics(Math.max(1, handCountBefore)).scale
    let slot: GameCardSlot | null = null
    let handedOff = false
    let entranceReserved = false
    const entranceSide = this.boardSide(event.participantId)
    const entranceOwner = event.minion.instanceId

    try {
      slot = await this.createSlot(
        this.remoteMinionCard(event, sourceCard ?? undefined)
      )
      if (this.destroyed) return

      if (sourceBack) {
        sourceBack.removeFromParent()
        const sourceBackIndex = this.remoteBacks.indexOf(sourceBack)
        if (sourceBackIndex >= 0) this.remoteBacks.splice(sourceBackIndex, 1)
        sourceBack.destroy()
      }
      this.remoteBackCount = Math.max(0, handCountBefore - 1)
      this.layoutRemoteHand()

      this.boardPositions.reserve(entranceSide, entranceOwner, event.position)
      entranceReserved = true
      const spaceReady = this.boardPositions.layout(entranceSide)
      const resting = this.boardPositions.entrancePosition(entranceSide, entranceOwner)
      const summon = CARD_PLAY_LAYOUT.minion
      const cardBottomY = resting.y + (CARD_CANVAS.height * summon.cardScale) / 2

      this.summonLayer.addChild(slot)
      const localStart = this.summonLayer.toLocal(sourcePosition)
      slot.position.set(localStart.x, localStart.y)
      slot.rotation = sourceRotation
      slot.scale.set(sourceScale)
      slot.shadow.restingScale = sourceScale
      slot.alpha = 1
      slot.beginMinionPlayTransition()
      slot.card.visible = false

      const back = new Sprite(this.options.gameAssets.cardBack)
      back.anchor.set(0.5, 1)
      back.position.set(0, 0)
      back.eventMode = 'none'
      back.label = `game.remote-minion-play.back:${event.minion.instanceId}`
      slot.addChild(back)

      const flight = this.timeline()
      flight.to(slot, {
        x: resting.x,
        y: cardBottomY,
        rotation: 0,
        duration: REMOTE_TIMING.minionFlight,
        ease: 'power2.inOut'
      })
      flight.to(
        slot.scale,
        {
          x: summon.cardScale,
          y: summon.cardScale,
          duration: REMOTE_TIMING.minionFlight,
          ease: 'power2.inOut'
        },
        0
      )
      await Promise.all([completeTimeline(flight), spaceReady])
      if (this.destroyed) return

      const flip = this.timeline()
      flip.to(slot.scale, {
        x: 0,
        duration: REMOTE_TIMING.minionFlipClose,
        ease: 'power2.in'
      })
      flip.call(() => {
        back.visible = false
        slot!.card.visible = true
      })
      flip.to(slot.scale, {
        x: summon.cardScale,
        duration: REMOTE_TIMING.minionFlipOpen,
        ease: 'power2.out'
      })
      await completeTimeline(flip)
      back.removeFromParent()
      back.destroy()

      entranceReserved = false
      await this.presentMinionPlayed(event, slot, false)
      handedOff = true
    } finally {
      if (entranceReserved)
        this.boardPositions.finishEntrance(entranceSide, entranceOwner)
      if (!handedOff && slot && !slot.destroyed) {
        slot.removeFromParent()
        slot.destroy({ children: true })
      }
    }
  }

  private async presentMinionPlayed(
    event: Extract<
      OpeningMatchEvent,
      {
        type:
          | 'minion-played'
          | 'dev-minion-summoned'
          | 'hero-power-minion-summoned'
          | 'minion-summoned'
      }
    >,
    summonSlot?: GameCardSlot,
    removedFromHand = true,
    retainForTargeting = false,
    targetPreview?: PendingMinionTargetPreview
  ): Promise<MinionPreviewPresentation | null> {
    const isLocal = event.participantId === this.localParticipantId
    const isRemote = event.participantId === this.remoteParticipantId
    if (!isLocal && !isRemote) return null

    // State reconciliation can have already materialized this instance before
    // its corresponding presentation event arrives. A minion identity gets one
    // view only, even when both routes report it in the same resolution.
    const existing = this.findMinionView(event.participantId, event.minion.instanceId)
    if (existing) {
      existing.setStats(
        event.minion.attack,
        event.minion.health,
        event.minion.maxHealth
      )
      const existingMarkers = boardMinionAbilityMarkers(
        event.minion,
        CARD_CATALOG.require(event.minion.cardId),
        this.presentationState().turnNumber
      )
      existing.setTaunt(existingMarkers.taunt)
      existing.setEnraged(existingMarkers.enraged)
      existing.setDivineShield(existingMarkers.divineShield)
      existing.setFrozen(
        isFrozen(event.minion.frozenUntilTurn, this.presentationState().turnNumber)
      )
      existing.setAbilityEffects(existingMarkers)
      existing.setStealth(existingMarkers.stealth)
      existing.setTrigger(existingMarkers.trigger)
      existing.setInspire(existingMarkers.inspire)
      existing.setDeathrattle(existingMarkers.deathrattle)
      return null
    }

    const entranceSide = this.boardSide(event.participantId)
    const entranceOwner = event.minion.instanceId
    this.boardPositions.reserve(entranceSide, entranceOwner, event.position)
    const spaceReady = this.boardPositions.layout(entranceSide)
    let preserveEntrance = false
    try {
      const definition = CARD_CATALOG.require(event.minion.cardId)
      const markers = boardMinionAbilityMarkers(
        event.minion,
        definition,
        this.presentationState().turnNumber
      )
      const textures: MinionViewTextures = {
        premiumFrame: this.options.gameAssets.premiumMinionFrame,
        frame: this.options.gameAssets.minionFrame,
        legendaryFrame: this.options.gameAssets.minionFrameLegendary,
        premiumLegendaryFrame: this.options.gameAssets.premiumMinionFrameLegendary,
        taunt: this.options.gameAssets.minionTaunt,
        premiumTaunt: this.options.gameAssets.premiumMinionTaunt,
        battlecry: this.options.gameAssets.minionBattlecry,
        enrage: this.options.gameAssets.minionEnrage,
        divineShield: this.options.gameAssets.minionDivineShield,
        frozen: this.options.gameAssets.minionFrozen,
        stealth: this.options.gameAssets.minionStealth,
        windfury: this.options.gameAssets.minionWindfury,
        spellDamage: this.options.gameAssets.minionSpellDamage,
        lifesteal: this.options.gameAssets.minionLifesteal,
        aura: this.options.gameAssets.minionAura,
        elusive: this.options.gameAssets.minionElusive,
        immune: this.options.gameAssets.minionImmune,
        trigger: this.options.gameAssets.boardTrigger,
        inspire: this.options.gameAssets.boardInspire,
        deathrattle: this.options.gameAssets.boardDeathrattle,
        poisonous: this.options.gameAssets.boardPoisonous,
        attack: this.options.gameAssets.minionAttack,
        health: this.options.gameAssets.minionHealth
      }
      const viewPromise = this.resolver
        .loadArtwork(event.minion.cardId)
        .then((artwork) =>
          MinionView.create(
            {
              label: `game.minion.${event.minion.instanceId}`,
              premiumSide: this.premiumAppearance.sideFor(
                event.minion,
                event.participantId
              ),
              premium: this.premiumAppearance.resolve(
                event.minion,
                event.participantId
              ),
              attack: event.minion.attack,
              health: event.minion.health,
              maxHealth: event.minion.maxHealth,
              baseAttack:
                event.minion.baseAttack ??
                (definition.type === 'Minion'
                  ? definition.attack
                  : event.minion.attack),
              baseHealth:
                event.minion.baseHealth ??
                (definition.type === 'Minion'
                  ? definition.health
                  : event.minion.maxHealth),
              legendary: definition.rarity === 'Legendary',
              taunt: markers.taunt,
              enraged: markers.enraged,
              divineShield: markers.divineShield,
              frozen: isFrozen(
                event.minion.frozenUntilTurn,
                this.presentationState().turnNumber
              ),
              stealth: markers.stealth,
              deathrattle: markers.deathrattle,
              poisonous: markers.poisonous,
              trigger: markers.trigger,
              inspire: markers.inspire,
              windfury: markers.windfury,
              spellDamage: markers.spellDamage,
              lifesteal: markers.lifesteal,
              aura: markers.aura,
              elusive: markers.elusive,
              immune: markers.immune
            },
            textures,
            artwork
          )
        )

      if (!summonSlot) {
        const [view] = await Promise.all([viewPromise, spaceReady])
        if (this.destroyed) {
          view.destroy({ children: true })
          return null
        }
        const resting = this.boardPositions.entrancePosition(
          entranceSide,
          entranceOwner
        )
        view.instanceId = event.minion.instanceId
        view.ownerId = event.participantId
        view.cardId = event.minion.cardId
        if (isLocal) {
          this.insertLocalMinionView(event.position, view)
          if (resting) {
            view.position.set(resting.x, resting.y)
            view.scale.set(resting.scale * 1.25)
            view.setBaseScale(resting.scale)
          }
          view.alpha = 0
          this.wireMinionView(view)
          this.syncBoardAttackability(this.presentationState())
          await completeTimeline(
            this.timeline().to(view, {
              alpha: 1,
              duration: BOARD_TIMING.minionSettle,
              ease: 'power2.out',
              overwrite: 'auto'
            })
          )
          view.presentTauntPop()
          return null
        }
        // Remote (AI) board: same fade but on the top row.
        this.insertRemoteMinionView(event.position, view)
        if (resting) {
          view.position.set(resting.x, resting.y)
          view.scale.set(resting.scale * 1.25)
          view.setBaseScale(resting.scale)
        }
        view.alpha = 0
        if (removedFromHand) {
          // Keep remote backs in sync when a hidden remote hand card was played.
          this.remoteBackCount = Math.max(0, this.remoteBackCount - 1)
          this.layoutRemoteHand()
        }
        this.wireMinionView(view)
        this.syncBoardAttackability(this.presentationState())
        await completeTimeline(
          this.timeline().to(view, {
            alpha: 1,
            duration: BOARD_TIMING.minionSettle,
            ease: 'power2.out',
            overwrite: 'auto'
          })
        )
        view.presentTauntPop()
        return null
      }

      const resting = this.boardPositions.entrancePosition(entranceSide, entranceOwner)

      const summon = CARD_PLAY_LAYOUT.minion
      const cardBottomY = resting.y + (CARD_CANVAS.height * summon.cardScale) / 2
      summonSlot.removeFromParent()
      summonSlot.zIndex = 2
      this.activeSummonSlots.add(summonSlot)
      this.summonLayer.addChild(summonSlot)
      summonSlot.alpha = 1
      summonSlot.beginMinionPlayTransition()
      const aura = this.cardPlayAnimation.createMinionAura(summonSlot.card, summonSlot)
      targetPreview?.playEffects.add(aura)

      const charge = this.timeline()
      targetPreview?.activeTimelines.add(charge)
      charge.to(summonSlot, {
        x: resting.x,
        y: cardBottomY,
        rotation: 0,
        duration: summon.snapDuration,
        ease: 'power2.out'
      })
      charge.to(
        summonSlot.scale,
        {
          x: summon.cardScale,
          y: summon.cardScale,
          duration: summon.snapDuration,
          ease: 'power2.out'
        },
        0
      )
      charge.to(summonSlot.scale, {
        x: summon.chargedCardScale,
        y: summon.chargedCardScale,
        duration: summon.chargeDuration,
        ease: 'sine.inOut'
      })
      charge.to(
        aura,
        {
          alpha: summon.aura.peakAlpha,
          duration: summon.snapDuration + summon.chargeDuration,
          ease: 'power2.in'
        },
        0
      )
      const chargeParticles = this.cardPlayAnimation.emitMinionParticles(
        charge,
        this.summonLayer,
        summonSlot.card,
        'charge'
      )
      targetPreview?.playEffects.add(chargeParticles)
      let settleParticles: Container | null = null
      let impact: ReturnType<GameBoardView['timeline']> | null = null
      let view: MinionView | null = null
      let retainedPresentation: MinionPreviewPresentation | null = null
      try {
        const [readyView] = await Promise.all([
          viewPromise,
          completeTimeline(charge),
          spaceReady
        ])
        targetPreview?.activeTimelines.delete(charge)
        if (targetPreview?.cancelled || this.destroyed) {
          readyView.destroy({ children: true })
          return null
        }
        view = readyView
        view.shadow.restingScale = resting.scale
        view.shadow.height = summonSlot.shadow.height

        // Reparent the aura before hiding the hand card, preserving its world pose.
        this.cardPlayAnimation.detachMinionAura(aura, this.summonLayer)
        aura.zIndex = 1
        view.position.set(resting.x, resting.y + summon.fallbackStartYOffset)
        view.scale.set(resting.scale * summon.fallbackStartScaleMultiplier)
        view.alpha = 1
        view.zIndex = 3
        this.summonLayer.addChild(view)
        this.cardPlayAnimation.alignMinionArtwork(
          summonSlot.card,
          view,
          this.summonLayer
        )
        // Atomic visual swap: no hand-card / board-frame crossfade.
        summonSlot.alpha = 0
        if (retainForTargeting) {
          view.instanceId = event.minion.instanceId
          view.ownerId = event.participantId
          view.cardId = event.minion.cardId
          this.wireMinionView(view)
          retainedPresentation = {
            view,
            slot: summonSlot,
            resting: { x: resting.x, y: resting.y, scale: resting.scale }
          }
          if (targetPreview) targetPreview.presentation = retainedPresentation
          this.cardPlay.syncPendingMinionTargetPreview()
        }

        // Hold the shield collapsed during the fall, then pop once the
        // minion lands on the board slot.
        view.presentTauntPop(summon.settleDuration)

        impact = this.timeline()
        targetPreview?.activeTimelines.add(impact)
        impact.to(
          aura,
          {
            alpha: 0,
            duration: summon.aura.fadeDuration,
            ease: 'power2.out'
          },
          0
        )
        impact.to(
          view,
          {
            x: resting.x,
            y: resting.y,
            duration: summon.settleDuration,
            ease: 'power2.in'
          },
          0
        )
        impact.to(
          view.scale,
          {
            x: resting.scale,
            y: resting.scale,
            duration: summon.settleDuration,
            ease: 'power2.in'
          },
          0
        )
        settleParticles = this.cardPlayAnimation.emitMinionParticles(
          impact,
          this.summonLayer,
          view,
          'settle'
        )
        targetPreview?.playEffects.add(settleParticles)
        await completeTimeline(impact)
        targetPreview?.activeTimelines.delete(impact)
        if (targetPreview?.cancelled || this.destroyed) return null

        if (retainForTargeting) {
          view.setBaseScale(resting.scale)
          view.position.set(resting.x, resting.y)
          view.scale.set(resting.scale)
          view.alpha = 1
          const presentation = retainedPresentation ?? {
            view,
            slot: summonSlot,
            resting: { x: resting.x, y: resting.y, scale: resting.scale }
          }
          view = null
          preserveEntrance = true
          return presentation
        }

        view.removeFromParent()
        view.instanceId = event.minion.instanceId
        view.ownerId = event.participantId
        view.cardId = event.minion.cardId
        view.setBaseScale(resting.scale)
        if (isLocal) this.insertLocalMinionView(event.position, view)
        else this.insertRemoteMinionView(event.position, view)
        view.position.set(resting.x, resting.y)
        view.scale.set(resting.scale)
        view.alpha = 1
        this.wireMinionView(view)
        this.syncBoardAttackability(this.presentationState())
        view = null
        return null
      } finally {
        targetPreview?.activeTimelines.delete(charge)
        charge.kill()
        impact?.kill()
        if (impact) targetPreview?.activeTimelines.delete(impact)
        targetPreview?.playEffects.delete(aura)
        targetPreview?.playEffects.delete(chargeParticles)
        if (settleParticles) targetPreview?.playEffects.delete(settleParticles)
        if (!aura.destroyed) aura.destroy()
        if (!chargeParticles.destroyed) chargeParticles.destroy({ children: true })
        if (settleParticles && !settleParticles.destroyed)
          settleParticles.destroy({ children: true })
        if (view && !view.destroyed) view.destroy({ children: true })
        if (!summonSlot.destroyed && !retainForTargeting) {
          summonSlot.disposePlayableOutline()
          summonSlot.removeFromParent()
          summonSlot.destroy({ children: true })
        }
        if (!retainForTargeting) this.activeSummonSlots.delete(summonSlot)
      }
    } finally {
      if (!preserveEntrance)
        this.boardPositions.finishEntrance(entranceSide, entranceOwner)
    }
  }

  /** Applies a short, attack-scaled board shake and always restores its origin. */
  private async runCombatScreenShake(attack: number): Promise<void> {
    const profile = getCombatImpactProfile(attack)
    const baseX = this.x
    const baseY = this.y
    const stepDuration = profile.duration / (profile.pulses * 2)
    const timeline = this.timeline()

    for (let index = 0; index < profile.pulses; index += 1) {
      const direction = COMBAT_SHAKE_DIRECTIONS[index % COMBAT_SHAKE_DIRECTIONS.length]
      timeline.to(this, {
        x: baseX + direction.x * profile.amplitude,
        y: baseY + direction.y * profile.amplitude,
        duration: stepDuration,
        ease: 'power1.out'
      })
      timeline.to(this, {
        x: baseX,
        y: baseY,
        duration: stepDuration,
        ease: 'power1.in'
      })
    }

    try {
      await completeTimeline(timeline)
    } finally {
      this.position.set(baseX, baseY)
    }
  }

  private findMinionView(
    ownerId: PlayerId,
    instanceId: string
  ): MinionView | undefined {
    const views =
      ownerId === this.localParticipantId
        ? this.localMinionViews
        : this.remoteMinionViews
    return views.find((view) => view.instanceId === instanceId)
  }

  private boardMinionForView(
    view: MinionView,
    state: OpeningMatchState = this.presentationState()
  ): BoardMinion | null {
    if (!view.ownerId || !view.instanceId) return null
    const player = state.players.find(
      (candidate) => candidate.participantId === view.ownerId
    )
    return player?.board.find((minion) => minion.instanceId === view.instanceId) ?? null
  }

  private boardCardPreviewForView(view: MinionView | WeaponView) {
    if (view instanceof WeaponView) {
      const weapon = this.presentationState().players.find(
        (player) => player.participantId === view.ownerId
      )?.weapon
      if (!weapon || weapon.instanceId !== view.instanceId) return null
      const definition = CARD_CATALOG.require(weapon.cardId)
      if (definition.type !== 'Weapon') return null
      return {
        key: boardWeaponCardPreviewKey(weapon),
        model: boardWeaponCardPreviewModel(definition, weapon)
      }
    }
    const minion = this.boardMinionForView(view)
    if (!minion) return null
    const definition = CARD_CATALOG.require(minion.cardId)
    if (definition.type !== 'Minion') return null
    return {
      key: boardMinionCardPreviewKey(minion),
      model: boardMinionCardPreviewModel(definition, minion)
    }
  }

  private boardCardHoverTarget(view: MinionView | WeaponView): MatchHoverTarget {
    return {
      kind: 'board-card',
      key: `board-card:${view.instanceId ?? String(view.label)}`,
      view
    }
  }

  private heroPowerHoverTarget(participantId: PlayerId): MatchHoverTarget {
    return {
      kind: 'hero-power',
      key: `hero-power:${participantId}`,
      participantId
    }
  }

  private setHoverAura(target: MatchHoverTarget, enabled: boolean): void {
    switch (target.kind) {
      case 'board-card':
        target.view.setHoverAura(enabled)
        return
      case 'hero-power':
        this.heroPowerViews.get(target.participantId)?.setHoverAura(enabled)
        return
      case 'secret':
        this.secretZoneView.setHoverAura(target.side, enabled)
        return
      case 'quest':
        this.questZoneView.setHoverAura(target.side, enabled)
        return
    }
  }

  private activateHoverPreview(target: MatchHoverTarget): void {
    switch (target.kind) {
      case 'board-card':
        void this.showBoardCardPreview(target.view)
        return
      case 'hero-power':
        this.showHeroPowerPreview(target.participantId)
        return
      case 'secret':
        this.hideBoardCardPreview(undefined, true)
        this.localSecretHovered = true
        this.questHoveredSide = null
        this.questPreviewView.hide()
        this.refreshSecretPreview()
        this.updateBadgeBoardDesaturation()
        return
      case 'quest':
        this.hideBoardCardPreview(undefined, true)
        this.questHoveredSide = target.side
        this.localSecretHovered = false
        this.secretPreviewView.hide()
        this.refreshQuestPreview()
        this.updateBadgeBoardDesaturation()
        return
    }
  }

  private clearHoverTarget(target: MatchHoverTarget): void {
    this.setHoverAura(target, false)
    switch (target.kind) {
      case 'board-card':
        this.hideBoardCardPreview(target.view, true)
        return
      case 'hero-power':
        this.hideHeroPowerPreview(target.participantId)
        return
      case 'secret':
        this.localSecretHovered = false
        this.secretPreviewView.hide()
        this.updateBadgeBoardDesaturation()
        return
      case 'quest':
        if (this.questHoveredSide !== target.side) return
        this.questHoveredSide = null
        this.questPreviewView.hide()
        this.updateBadgeBoardDesaturation()
        return
    }
  }

  private destroyBoardCardPreview(): void {
    const preview = this.boardCardPreview
    const ghost = this.boardCardPreviewGhost
    this.boardCardPreview = null
    this.boardCardPreviewGhost = null
    ghost?.dispose()
    if (!preview || preview.destroyed) return
    this.killTweensOf(preview)
    preview.removeFromParent()
    preview.destroy({ children: true })
  }

  private hideBoardCardPreview(
    view?: MinionView | WeaponView,
    keepHoverIntent = false
  ): void {
    if (!keepHoverIntent) {
      if (view) this.hoverPreview.leave(this.boardCardHoverTarget(view))
      else this.hoverPreview.cancel()
    }
    if (!view) {
      this.localSecretHovered = false
      this.secretPreviewView.hide()
      this.questHoveredSide = null
      this.questPreviewView.hide()
      this.updateBadgeBoardDesaturation()
      this.hideHeroPowerPreview()
    }
    if (view && this.hoveredBoardCardView !== view) return
    this.hoveredBoardCardView = null
    this.requestedBoardCardPreviewKey = null
    this.boardCardPreviewRequest += 1
    this.destroyBoardCardPreview()
  }

  private isBoardCardPreviewEnabled(): boolean {
    if (this.hand.drag.index !== null) return false

    return canShowBoardMinionCardPreview({
      cardTargeting: this.cardPlay.current !== null,
      heroPowerTargeting: this.heroPowerTargeting,
      combatTargeting: this.selectedCombatView !== null
    })
  }

  private positionBoardCardPreview(
    preview: CardView,
    sourceView: MinionView | WeaponView
  ): void {
    const layout = GAME_BOARD_LAYOUT.boardMinions.cardPreview
    const position = positionBoardMinionCardPreview(
      this.boardPreviewSourceBounds(sourceView),
      { width: preview.plan.width, height: preview.renderedHeight },
      layout,
      sourceView instanceof WeaponView ? 'left' : 'right'
    )
    preview.position.set(position.x, position.y)
  }

  private boardPreviewSourceBounds(sourceView: Container) {
    const globalBounds = sourceView.getBounds()
    const topLeft = this.boardCardPreviewLayer.toLocal({
      x: globalBounds.x,
      y: globalBounds.y
    })
    const bottomRight = this.boardCardPreviewLayer.toLocal({
      x: globalBounds.x + globalBounds.width,
      y: globalBounds.y + globalBounds.height
    })
    return {
      x: Math.min(topLeft.x, bottomRight.x),
      y: Math.min(topLeft.y, bottomRight.y),
      width: Math.abs(bottomRight.x - topLeft.x),
      height: Math.abs(bottomRight.y - topLeft.y)
    }
  }

  private async showBoardCardPreview(
    view: MinionView | WeaponView,
    keepCurrentUntilReady = false
  ): Promise<void> {
    this.localSecretHovered = false
    this.secretPreviewView.hide()
    this.questHoveredSide = null
    this.questPreviewView.hide()
    this.updateBadgeBoardDesaturation()
    this.hideHeroPowerPreview()
    if (!this.isBoardCardPreviewEnabled()) {
      this.hideBoardCardPreview()
      return
    }

    const initialSource = this.boardCardPreviewForView(view)
    if (!initialSource) {
      this.hideBoardCardPreview(view)
      return
    }

    const initialKey = initialSource.key
    if (
      this.hoveredBoardCardView === view &&
      this.requestedBoardCardPreviewKey === initialKey
    ) {
      return
    }

    const changedView = this.hoveredBoardCardView !== view
    this.hoveredBoardCardView = view
    this.requestedBoardCardPreviewKey = initialKey
    const request = ++this.boardCardPreviewRequest
    if (changedView || !keepCurrentUntilReady) this.destroyBoardCardPreview()

    try {
      const artwork = await this.resolver.loadArtwork(initialSource.model.card.id)
      if (
        request !== this.boardCardPreviewRequest ||
        this.hoveredBoardCardView !== view ||
        !this.isBoardCardPreviewEnabled() ||
        view.destroyed ||
        !view.parent
      ) {
        return
      }

      const source = this.boardCardPreviewForView(view)
      if (!source) {
        this.hideBoardCardPreview(view)
        return
      }
      const renderKey = source.key
      if (renderKey !== initialKey) {
        this.requestedBoardCardPreviewKey = null
        void this.showBoardCardPreview(view, true)
        return
      }

      const model = source.model
      const preview = await CardView.create(model.card, this.resolver, {
        premiumSide: this.premiumAppearance.sideFor(
          { instanceId: view.instanceId! },
          view.ownerId ?? this.localParticipantId
        ),
        premium: this.premiumAppearance.resolve(
          { instanceId: view.instanceId!, cardId: model.card.id },
          view.ownerId ?? this.localParticipantId
        ),
        animatePremiumArtwork: true,
        artwork,
        silenced: model.silenced
      })
      const latestSource = this.boardCardPreviewForView(view)
      if (
        request !== this.boardCardPreviewRequest ||
        this.hoveredBoardCardView !== view ||
        !this.isBoardCardPreviewEnabled() ||
        view.destroyed ||
        !view.parent ||
        !latestSource ||
        latestSource.key !== renderKey
      ) {
        preview.destroy({ children: true })
        if (
          request === this.boardCardPreviewRequest &&
          this.hoveredBoardCardView === view &&
          this.isBoardCardPreviewEnabled() &&
          latestSource
        ) {
          this.requestedBoardCardPreviewKey = null
          void this.showBoardCardPreview(view, true)
        }
        return
      }

      preview.setLayerAppearance('card.stats.attack.label', {
        tint: model.attackColor
      })
      preview.setLayerAppearance(
        model.card.type === 'Weapon'
          ? 'card.stats.durability.label'
          : 'card.stats.health.label',
        {
          tint: model.healthColor
        }
      )
      preview.scale.set(GAME_BOARD_LAYOUT.boardMinions.cardPreview.scale)
      preview.alpha = 0
      preview.eventMode = 'none'
      preview.label = `game.board-card-preview.${view.instanceId}`
      this.positionBoardCardPreview(preview, view)
      const ghost = new PreviewGhostOutline(this.options.renderer, preview)

      this.destroyBoardCardPreview()
      this.boardCardPreview = preview
      this.boardCardPreviewGhost = ghost
      this.boardCardPreviewLayer.addChild(preview)
      this.tweenTo(preview, {
        alpha: 1,
        duration: GAME_BOARD_LAYOUT.boardMinions.cardPreview.fadeDuration,
        ease: 'power2.out'
      })
    } catch (error) {
      if (request === this.boardCardPreviewRequest) {
        this.requestedBoardCardPreviewKey = null
        this.logger.warn('Failed to render board card preview.', error)
      }
    }
  }

  private heroPowerPreviewForParticipant(participantId: PlayerId) {
    const player = this.presentationState().players.find(
      (candidate) => candidate.participantId === participantId
    )
    if (!player) return null
    const definition = HERO_POWER_CATALOG.require(player.heroPower.id)
    return {
      key: [
        'hero-power',
        participantId,
        player.heroPower.id,
        player.heroPower.cost
      ].join(':'),
      definition,
      cost: player.heroPower.cost,
      artwork:
        this.options.gameAssets[definition.presentationAssetKey as HeroPowerAssetKey]
    }
  }

  private destroyHeroPowerPreview(): void {
    const preview = this.heroPowerPreview
    const ghost = this.heroPowerPreviewGhost
    this.heroPowerPreview = null
    this.heroPowerPreviewGhost = null
    ghost?.dispose()
    if (!preview || preview.destroyed) return
    this.killTweensOf(preview)
    preview.removeFromParent()
    preview.destroy({ children: true })
  }

  private hideHeroPowerPreview(participantId?: PlayerId): void {
    if (participantId && this.hoveredHeroPowerParticipantId !== participantId) return
    this.hoveredHeroPowerParticipantId = null
    this.requestedHeroPowerPreviewKey = null
    this.destroyHeroPowerPreview()
  }

  private updateHeroPowerHover(
    globalPoint: { readonly x: number; readonly y: number } | null
  ): void {
    if (
      !globalPoint ||
      this.session?.getState().phase === 'mulligan' ||
      !this.isBoardCardPreviewEnabled()
    ) {
      const participantId = this.hoveredHeroPowerParticipantId
      if (participantId)
        this.hoverPreview.leave(this.heroPowerHoverTarget(participantId))
      else this.hideHeroPowerPreview()
      return
    }

    const participantId =
      [...this.heroPowerViews.entries()].find(([, view]) => {
        const localPoint = view.toLocal(globalPoint)
        return view.containsCanvasPoint(localPoint.x, localPoint.y)
      })?.[0] ?? null

    if (this.hoveredHeroPowerParticipantId !== participantId) {
      const previousParticipantId = this.hoveredHeroPowerParticipantId
      if (previousParticipantId)
        this.hoverPreview.leave(this.heroPowerHoverTarget(previousParticipantId))
      this.hoveredHeroPowerParticipantId = participantId
    }
    if (participantId) this.hoverPreview.enter(this.heroPowerHoverTarget(participantId))
  }

  private positionHeroPowerPreview(
    preview: HeroPowerCardView,
    sourceView: HeroPowerView
  ): void {
    const layout = GAME_BOARD_LAYOUT.boardMinions.cardPreview
    const position = positionBoardMinionCardPreview(
      this.boardPreviewSourceBounds(sourceView),
      HERO_POWER_CARD_CANVAS,
      layout,
      'right'
    )
    preview.position.set(position.x, position.y)
  }

  private showHeroPowerPreview(participantId: PlayerId): void {
    if (!this.isBoardCardPreviewEnabled()) {
      this.hideBoardCardPreview()
      return
    }

    const view = this.heroPowerViews.get(participantId)
    const initialSource = this.heroPowerPreviewForParticipant(participantId)
    if (!view || !initialSource) {
      this.hoverPreview.leave(this.heroPowerHoverTarget(participantId))
      this.hideHeroPowerPreview(participantId)
      return
    }

    if (
      this.hoveredBoardCardView ||
      this.boardCardPreview ||
      this.localSecretHovered ||
      this.questHoveredSide
    ) {
      this.hideBoardCardPreview(undefined, true)
    }

    if (
      this.hoveredHeroPowerParticipantId === participantId &&
      this.requestedHeroPowerPreviewKey === initialSource.key &&
      this.heroPowerPreview
    ) {
      return
    }

    this.hoveredHeroPowerParticipantId = participantId
    this.requestedHeroPowerPreviewKey = initialSource.key
    this.destroyHeroPowerPreview()

    if (view.destroyed || !view.parent) {
      this.hoverPreview.leave(this.heroPowerHoverTarget(participantId))
      this.hideHeroPowerPreview(participantId)
      return
    }

    const preview = new HeroPowerCardView(
      initialSource.definition,
      initialSource.cost,
      initialSource.artwork,
      this.options.gameAssets.discoverHistoryHeroPower,
      { premium: this.heroPowerPremiumForParticipant(participantId) }
    )
    preview.scale.set(GAME_BOARD_LAYOUT.boardMinions.cardPreview.scale)
    preview.alpha = 0
    preview.eventMode = 'none'
    preview.label = `game.hero-power-preview.${participantId}`
    this.positionHeroPowerPreview(preview, view)
    this.heroPowerPreviewGhost = new PreviewGhostOutline(this.options.renderer, preview)

    this.heroPowerPreview = preview
    this.boardCardPreviewLayer.addChild(preview)
    this.tweenTo(preview, {
      alpha: 1,
      duration: GAME_BOARD_LAYOUT.boardMinions.cardPreview.fadeDuration,
      ease: 'power2.out'
    })
  }

  private refreshHoveredHeroPowerPreview(): void {
    const participantId = this.hoveredHeroPowerParticipantId
    if (!participantId || !this.heroPowerPreview) return
    this.showHeroPowerPreview(participantId)
  }

  private refreshHoveredBoardCardPreview(): void {
    this.refreshSecretPreview()
    const view = this.hoveredBoardCardView
    if (!view || (!this.boardCardPreview && !this.requestedBoardCardPreviewKey)) return
    if (!this.boardCardPreviewForView(view)) {
      this.hideBoardCardPreview(view)
      return
    }
    void this.showBoardCardPreview(view, true)
  }

  private findEffectTargetView(instanceId: string): {
    readonly view: CombatView | WeaponView
    readonly participantId: PlayerId
  } | null {
    for (const [participantId, view] of this.heroViews) {
      if (instanceId === `${participantId}:hero`) return { view, participantId }
    }
    for (const view of [...this.localMinionViews, ...this.remoteMinionViews]) {
      if (view.instanceId && view.instanceId === instanceId)
        return { view, participantId: view.ownerId as PlayerId }
    }
    for (const [participantId, view] of this.weaponViews) {
      if (view.instanceId === instanceId) return { view, participantId }
    }
    return null
  }

  private removeWeaponView(participantId: PlayerId, view?: WeaponView): void {
    const current = this.weaponViews.get(participantId)
    if (!current || (view && current !== view)) return
    this.hideBoardCardPreview(current)
    this.weaponViews.delete(participantId)
    current.removeFromParent()
    if (!current.destroyed) current.destroy({ children: true })
  }

  private findCombatView(
    ownerId: PlayerId,
    character: AttackCharacterRef
  ): CombatView | undefined {
    if (character.kind === 'hero') return this.heroViews.get(ownerId)
    return this.findMinionView(ownerId, character.instanceId)
  }

  private minionViewsFor(participantId: PlayerId): readonly MinionView[] {
    return participantId === this.localParticipantId
      ? this.localMinionViews
      : this.remoteMinionViews
  }

  private minionLayerFor(participantId: PlayerId): Container {
    return participantId === this.localParticipantId
      ? this.localMinionLayer
      : this.remoteMinionLayer
  }

  private detachMinionView(view: MinionView): void {
    this.boardPositions.detach(view)
  }

  /** Moves a live view between board layers while preserving its screen position. */
  private moveMinionViewToBoard(
    view: MinionView,
    participantId: PlayerId,
    position: number
  ): void {
    const global = view.parent ? view.getGlobalPosition() : null
    this.boardPositions.insert(this.boardSide(participantId), position, view)
    const layer = this.minionLayerFor(participantId)
    if (global) {
      const local = layer.toLocal(global)
      view.position.set(local.x, local.y)
    }
    view.ownerId = participantId
  }

  private async presentMinionControlTransfer(
    view: MinionView,
    destinationId: PlayerId
  ): Promise<void> {
    const sourceId = this.localMinionViews.includes(view)
      ? this.localParticipantId
      : this.remoteMinionViews.includes(view)
        ? this.remoteParticipantId
        : null
    if (!sourceId || sourceId === destinationId || !view.parent) return

    if (this.hoveredBoardCardView === view) this.hideBoardCardPreview(view)
    if (this.selectedCombatView === view) this.deselectAttacker(false)

    const startGlobal = view.getGlobalPosition()
    this.boardPositions.insert(
      this.boardSide(destinationId),
      this.minionViewsFor(destinationId).length,
      view
    )
    this.boardPositions.beginMotion(view)
    const destinationViews = this.minionViewsFor(destinationId)
    const destinationLayer = this.minionLayerFor(destinationId)
    const destinationIndex = destinationViews.length - 1
    const destination = this.boardPositions.slotPosition(view)
    if (!destination) {
      this.moveMinionViewToBoard(view, destinationId, destinationIndex)
      this.boardPositions.endMotion(view)
      return
    }

    this.travelLayer.addChild(view)
    const start = this.travelLayer.toLocal(startGlobal)
    view.position.set(start.x, start.y)
    view.ownerId = destinationId
    view.zIndex = COMBAT_ATTACKER_Z_INDEX
    view.setBaseScale(destination.scale)

    this.applyLocalBoardLayout()
    this.applyRemoteBoardLayout()

    const destinationGlobal = destinationLayer.toGlobal({
      x: destination.x,
      y: destination.y
    })
    const end = this.travelLayer.toLocal(destinationGlobal)
    const midpoint = {
      x: start.x + (end.x - start.x) / 2,
      y:
        start.y +
        (end.y - start.y) / 2 -
        GAME_BOARD_LAYOUT.boardMinions.controlTransfer.arcHeight
    }
    const halfDuration = BOARD_TIMING.controlTransfer / 2
    const timeline = this.timeline()
      .to(view, {
        x: midpoint.x,
        y: midpoint.y,
        duration: halfDuration,
        ease: 'power2.out',
        overwrite: 'auto'
      })
      .to(view, {
        x: end.x,
        y: end.y,
        duration: halfDuration,
        ease: 'power2.in',
        overwrite: 'auto'
      })

    try {
      await completeTimeline(timeline)
    } finally {
      this.boardPositions.endMotion(view)
      if (!view.destroyed) {
        this.moveMinionViewToBoard(view, destinationId, destinationIndex)
        view.zIndex = 0
        this.applyLocalBoardLayout()
        this.applyRemoteBoardLayout()
      }
    }
  }

  private removeMinionView(view: MinionView): void {
    // Pointer frames must never retain a selected view after it is destroyed.
    if (this.selectedCombatView === view) this.deselectAttacker(false)
    if (this.hoveredBoardCardView === view) this.hideBoardCardPreview(view)
    this.detachMinionView(view)
    if (view.destroyed) return
    view.removeFromParent()
    view.destroy({ children: true })
  }

  private insertLocalMinionView(position: number, view: MinionView): void {
    this.boardPositions.insert('local', position, view)
  }

  private insertRemoteMinionView(position: number, view: MinionView): void {
    this.boardPositions.insert('remote', position, view)
  }

  private wireMinionView(view: MinionView): void {
    view.setHoverable(true)
    const hoverTarget = this.boardCardHoverTarget(view)
    view.on('pointerover', () => this.hoverPreview.enter(hoverTarget))
    view.on('pointerout', () => this.hoverPreview.leave(hoverTarget))
    view.on('pointerdown', (event: FederatedPointerEvent) => {
      if (view.ownerId !== this.localParticipantId) return
      this.beginCombatDrag(view, event)
    })
    view.on('pointertap', (event: FederatedPointerEvent) => {
      if (this.consumeCardPlacementTap(event)) return
      if (this.consumeTargetGestureTap(event)) return
      if (event.button !== 0) return
      if (this.cardPlay.current) {
        if (this.cardPlay.isValidCardTarget(view)) {
          this.cardPlay.commitCardTarget(view)
        } else {
          this.cardPlay.cancelCardTargeting({ x: event.globalX, y: event.globalY })
        }
        return
      }
      if (!view.isTargetable()) return
      if (this.heroPowerTargeting && view.ownerId && view.instanceId) {
        void this.commitHeroPower({
          kind: 'minion',
          participantId: view.ownerId as PlayerId,
          instanceId: view.instanceId
        })
        return
      }
      if (view.ownerId === this.localParticipantId) {
        if (!view.isCanAttack()) return
        this.selectAttacker(view)
        this.handleBoardPointerMove(event)
        return
      }
      if (view.ownerId === this.remoteParticipantId && this.selectedCombatView) {
        void this.attackCharacter(view)
      }
    })
  }

  private wireHeroView(view: HeroView): void {
    view.on('pointerdown', (event: FederatedPointerEvent) => {
      if (view.ownerId !== this.localParticipantId) return
      this.beginCombatDrag(view, event)
    })
    view.on('pointertap', (event: FederatedPointerEvent) => {
      if (this.consumeCardPlacementTap(event)) return
      if (this.consumeTargetGestureTap(event)) return
      if (event.button !== 0) return
      if (this.cardPlay.current) {
        if (this.cardPlay.isValidCardTarget(view)) {
          this.cardPlay.commitCardTarget(view)
        } else {
          this.cardPlay.cancelCardTargeting({ x: event.globalX, y: event.globalY })
        }
        return
      }
      if (!view.isTargetable()) return
      if (this.heroPowerTargeting && view.ownerId) {
        void this.commitHeroPower({
          kind: 'hero',
          participantId: view.ownerId as PlayerId
        })
        return
      }
      if (view.ownerId === this.localParticipantId) {
        if (!view.isCanAttack()) return
        this.selectAttacker(view)
        this.handleBoardPointerMove(event)
        return
      }
      if (view.ownerId === this.remoteParticipantId && this.selectedCombatView) {
        void this.attackCharacter(view)
      }
    })
  }

  private remoteBoardRowConfig(): BoardRowConfig {
    return GAME_BOARD_LAYOUT.boardMinions.remote
  }

  private applyRemoteBoardLayout(): void {
    void this.boardPositions.layout('remote')
  }

  /** Reveals the turn controls and reflects the new active player's turn. */
  private handleTurnStarted(participantId: PlayerId): void {
    this.cancelHeroPowerTargeting()
    this.cardPlay.cancelCardTargeting()
    if (!this.turnLayer.visible) this.turnLayer.visible = true
    if (participantId === this.localParticipantId) {
      this.turnInProgress = false
      this.hud.presentYourTurnFlag(this.options.gameAssets.yourTurn)
    }
    this.syncTurnControls(this.match.getState())
    if (participantId === this.remoteParticipantId) {
      void this.scheduleAiTurn()
    }
  }

  private async presentLocalMulligan(event: MulliganResolvedEvent): Promise<void> {
    const returnedSlots = event.returnedCards
      .map((card) => this.findEntry(card.instanceId)?.slot)
      .filter((slot): slot is GameCardSlot => slot !== undefined)
    await Promise.all(
      returnedSlots.map((slot, index) =>
        this.animateSlotToDeck(slot, GAME_BOARD_LAYOUT.decks.local, index)
      )
    )
    for (const slot of returnedSlots) {
      const entryIndex = this.hand.entries.findIndex((entry) => entry.slot === slot)
      const entry = entryIndex >= 0 ? this.hand.entries[entryIndex] : undefined
      entry?.slot.disposePlayableOutline()
      if (entryIndex >= 0) this.hand.removeAt(entryIndex)
      slot.destroy({ children: true })
    }
    await this.wait(OPENING_TIMING.replacementPause)

    const replacementSlots: GameCardSlot[] = []
    for (const card of event.replacementCards) {
      const slot = await this.createSlot(card)
      this.hand.append({
        card: cloneCard(card),
        slot,
        restTransform: undefined,
        displaced: false
      })
      replacementSlots.push(slot)
    }
    const allSlots = this.hand.entries.map((entry) => entry.slot)
    allSlots.forEach((slot, index) => {
      slot.setSelected(false)
      slot.setMulliganInteractionEnabled(false)
      if (!replacementSlots.includes(slot)) return
      this.prepareSlotAtDeck(slot, GAME_BOARD_LAYOUT.decks.local, index)
      this.travelLayer.addChild(slot)
    })
    await Promise.all(
      allSlots.map((slot, index) =>
        this.mulligan.animateSlot(slot, index, allSlots.length, OPENING_TIMING.cardDeal)
      )
    )
  }

  private async completeLocalMulliganPresentation(): Promise<void> {
    const allSlots = this.hand.entries.map((entry) => entry.slot)
    this.hand.setReflowing(true)
    for (const slot of allSlots) {
      if (slot.parent !== this.hand.layer) this.hand.layer.addChild(slot)
      this.hand.configureSlot(slot)
    }
    this.hand.resetHover()
    await this.hand.applyLayout({
      positionDuration: OPENING_TIMING.cardDeal,
      scaleDuration: OPENING_TIMING.cardDeal
    })
    this.hand.setReflowing(false)
    this.hand.activate()
    await this.mulligan.dismiss()
  }

  private async addLocalCard(card: OpeningCard, sourceDeck?: PlayerId): Promise<void> {
    if (this.findEntry(card.instanceId)) return
    const selected = this.cardSelectionOverlay.takeSelected(card.instanceId)
    if (selected) {
      const localPosition = this.travelLayer.toLocal(selected.globalPosition)
      this.travelLayer.addChild(selected.slot)
      selected.slot.position.set(localPosition.x, localPosition.y)
      this.hand.append({
        card: cloneCard(card),
        slot: selected.slot,
        restTransform: undefined,
        displaced: false
      })
      this.cardSelectionOverlay.clear()
      await this.hand.applyLayout({
        positionDuration: OPENING_TIMING.cardDeal,
        scaleDuration: OPENING_TIMING.cardDeal,
        delayedInstanceId: card.instanceId,
        preserveHover: true
      })
      this.hand.layer.addChild(selected.slot)
      this.hand.configureSlot(selected.slot)
      return
    }

    if (!sourceDeck) {
      await this.spawnLocalCard(card, GAME_BOARD_LAYOUT.frame.center)
      return
    }
    const slot = await this.createSlot(card)
    this.prepareSlotAtDeck(
      slot,
      sourceDeck === this.localParticipantId
        ? GAME_BOARD_LAYOUT.decks.local
        : GAME_BOARD_LAYOUT.decks.remote,
      this.hand.entries.length
    )
    this.travelLayer.addChild(slot)
    this.hand.append({
      card: cloneCard(card),
      slot,
      restTransform: undefined,
      displaced: false
    })
    await this.hand.applyLayout({
      positionDuration: OPENING_TIMING.cardDeal,
      scaleDuration: OPENING_TIMING.cardDeal,
      delayedInstanceId: card.instanceId,
      preserveHover: true
    })
    this.hand.layer.addChild(slot)
    this.hand.configureSlot(slot)
  }

  private prepareSlotAtDeck(
    slot: GameCardSlot,
    deck: LayoutPlacement,
    sequence: number
  ): void {
    const deckView = this.deckViews.get(
      deck === GAME_BOARD_LAYOUT.decks.local
        ? this.localParticipantId
        : this.remoteParticipantId
    )
    if (deckView) this.drawOrigins.set(slot, deckView)
    slot.setMulliganInteractionEnabled(false)
    slot.position.set(deck.position.x, deck.position.y)
    slot.scale.set(
      GAME_BOARD_LAYOUT.cardTravel.slotScale.x,
      GAME_BOARD_LAYOUT.cardTravel.slotScale.y
    )
    slot.skew.set(sequence % 2 === 0 ? 0.3 : -0.3, -0.06)
    slot.rotation = sequence % 2 === 0 ? -0.08 : 0.08
    slot.alpha = 1
  }

  private prepareSlotAtGeneratedOrigin(
    slot: GameCardSlot,
    origin: { x: number; y: number }
  ): void {
    slot.setMulliganInteractionEnabled(false)
    slot.position.set(origin.x, origin.y)
    slot.scale.set(GAME_BOARD_LAYOUT.cardTravel.generatedSlotScale)
    slot.skew.set(0, 0)
    slot.rotation = 0
    slot.alpha = 1
  }

  private prepareBackAtGeneratedOrigin(
    back: Sprite,
    origin: { x: number; y: number }
  ): void {
    const local = this.remoteHandLayer.toLocal(this.travelLayer.toGlobal(origin))
    back.position.set(local.x, local.y)
    back.scale.set(GAME_BOARD_LAYOUT.cardTravel.generatedBackScale)
    back.rotation = 0
    back.alpha = 1
    back.visible = true
  }

  private prepareBackAtDeck(back: Sprite, sequence: number): void {
    const deckView = this.deckViews.get(this.remoteParticipantId)
    if (deckView) this.drawOrigins.set(back, deckView)
    back.position.set(
      GAME_BOARD_LAYOUT.decks.remote.position.x,
      GAME_BOARD_LAYOUT.decks.remote.position.y
    )
    back.scale.set(
      GAME_BOARD_LAYOUT.cardTravel.backScale.x,
      GAME_BOARD_LAYOUT.cardTravel.backScale.y
    )
    back.rotation = sequence % 2 === 0 ? -0.08 : 0.08
    back.alpha = 1
    back.visible = true
  }

  private animateBackToHand(
    back: Sprite,
    index: number,
    count: number,
    duration: number,
    staggerIndex = index
  ): Promise<void> {
    if (back.destroyed) return Promise.resolve()
    const midpoint = (count - 1) / 2
    const { gap, scale } = this.remoteHandMetrics(count)
    const normalized = midpoint === 0 ? 0 : (index - midpoint) / midpoint
    const x = GAME_BOARD_LAYOUT.remoteHand.centerX + (index - midpoint) * gap
    if (this.drawOrigins.has(back)) {
      back.position.set(
        x,
        GAME_BOARD_LAYOUT.remoteHand.baselineY -
          Math.abs(normalized) * GAME_BOARD_LAYOUT.remoteHand.edgeTuck
      )
      back.rotation = -(index - midpoint) * GAME_BOARD_LAYOUT.remoteHand.rotationStep
      back.scale.set(scale)
      return this.animateDeckDeparture(
        back,
        duration,
        staggerIndex * OPENING_TIMING.cardStagger
      )
    }
    const timeline = this.timeline()
    timeline.to(back, {
      x,
      y:
        GAME_BOARD_LAYOUT.remoteHand.baselineY -
        Math.abs(normalized) * GAME_BOARD_LAYOUT.remoteHand.edgeTuck,
      rotation: -(index - midpoint) * GAME_BOARD_LAYOUT.remoteHand.rotationStep,
      alpha: 1,
      duration,
      delay: staggerIndex * OPENING_TIMING.cardStagger,
      ease: 'power2.out'
    })
    timeline.to(
      back.scale,
      {
        x: scale,
        y: scale,
        duration,
        delay: staggerIndex * OPENING_TIMING.cardStagger,
        ease: 'power2.out'
      },
      0
    )
    return completeTimeline(timeline)
  }

  private findEntry(instanceId: string): HandEntry | undefined {
    return this.hand.entries.find((entry) => entry.card.instanceId === instanceId)
  }

  private localBoardRowConfig(): BoardRowConfig {
    return GAME_BOARD_LAYOUT.boardMinions.local
  }

  private boardSide(participantId: PlayerId): BoardSide {
    return participantId === this.localParticipantId ? 'local' : 'remote'
  }

  private applyLocalBoardLayout(): void {
    void this.boardPositions.layout('local')
  }

  private resolveLocalBoardPreview(pointer: HandPointer): number | null {
    if (this.hand.drag.index === null) return null
    const entry = this.hand.entries[this.hand.drag.index]
    if (!entry) return null
    const input = this.match.getPlayInput?.(
      this.localParticipantId,
      entry.card.instanceId
    )
    const legality = this.match.getLegality?.(this.localParticipantId)
    if (
      !input?.requiresPosition ||
      input.legalPositions.length === 0 ||
      !legality?.playableCardInstanceIds.includes(entry.card.instanceId) ||
      !isInDropZone(pointer, GAME_BOARD_LAYOUT.cardPlay.localDropZone)
    ) {
      return null
    }
    const position = resolveBoardInsertionIndex(
      pointer.x,
      this.session.getInteractionSnapshot().localBoardCount,
      this.localBoardRowConfig()
    )
    return input.legalPositions.includes(position) ? position : null
  }

  private updateLocalBoardPreview(pointer: HandPointer): void {
    const nextIndex = this.resolveLocalBoardPreview(pointer)
    this.updateDraggedCardDropOutline(pointer, nextIndex)
    this.boardPositions.preview('local', 'drag', nextIndex)
  }

  /** Blue means releasing here can play the card or advance its input selection. */
  private updateDraggedCardDropOutline(
    pointer: HandPointer,
    insertionIndex: number | null = this.resolveLocalBoardPreview(pointer)
  ): void {
    const index = this.hand.drag.index
    const entry = index === null ? undefined : this.hand.entries[index]
    if (!entry) return
    const input = this.match.getPlayInput?.(
      this.localParticipantId,
      entry.card.instanceId
    )
    this.hand.drag.setDropAllowed(
      !!input &&
        isInDropZone(pointer, GAME_BOARD_LAYOUT.cardPlay.localDropZone) &&
        (!input.requiresPosition || insertionIndex !== null)
    )
  }

  private clearLocalBoardPreview(): void {
    this.boardPositions.preview('local', 'drag', null)
  }

  /** Confirms an already-selected targetless spell (for example Coin or Tracking). */
  private castSelectedTargetlessSpell(entry: HandEntry): void {
    const result = this.dispatchCommand({
      type: 'play-card',
      participantId: this.localParticipantId,
      cardInstanceId: entry.card.instanceId
    })
    if (!result.accepted) {
      this.logger.error(result.message)
      this.hand.drag.end()
      return
    }
    this.syncTurnHud(result.state)
    const perspective = this.hand.drag.capturePerspective()
    this.hand.drag.acceptCard()
    void this.enqueueAcceptedSpellPlay(entry, result, perspective)
  }
  /** Resolves a carried card through the engine and presents an accepted play. */
  private resolveCardDrop(pointer: HandPointer): void {
    if (this.hand.drag.index === null || this.hand.drag.returning) return
    const index = this.hand.drag.index
    const entry = this.hand.entries[index]
    if (!entry) {
      this.hand.drag.end()
      return
    }

    const definition = cardDefinition(entry.card)
    const state = this.match.getState()
    const localPlayer = this.findPlayer(state, this.localParticipantId)
    const legality = this.match.getLegality?.(this.localParticipantId)
    const input = this.match.getPlayInput?.(
      this.localParticipantId,
      entry.card.instanceId
    )
    if (!input || !legality?.playableCardInstanceIds.includes(entry.card.instanceId)) {
      this.hand.drag.end()
      return
    }

    const needsCollectedInput = pendingCardInputStage(input, undefined) !== 'ready'
    if (definition.type === 'Spell' || needsCollectedInput) {
      if (!isInDropZone(pointer, GAME_BOARD_LAYOUT.cardPlay.localDropZone)) {
        this.hand.drag.end()
        return
      }

      let position: number | undefined
      if (input.requiresPosition) {
        const candidate = resolveBoardInsertionIndex(
          pointer.x,
          localPlayer.board.length,
          this.localBoardRowConfig()
        )
        if (!input.legalPositions.includes(candidate)) {
          this.hand.drag.end()
          return
        }
        position = candidate
      }

      if (needsCollectedInput) {
        this.cardPlay.beginCardTargeting(entry, input, position)
        return
      }

      const result = this.dispatchCommand({
        type: 'play-card',
        participantId: this.localParticipantId,
        cardInstanceId: entry.card.instanceId
      })
      if (!result.accepted) {
        this.logger.error(result.message)
        this.hand.drag.end()
        return
      }

      this.syncTurnHud(result.state)
      const perspective = this.hand.drag.capturePerspective()
      this.hand.drag.acceptCard()

      void this.enqueueAcceptedSpellPlay(entry, result, perspective)
      return
    }

    if (definition.type === 'Weapon') {
      if (!isInDropZone(pointer, GAME_BOARD_LAYOUT.cardPlay.localDropZone)) {
        this.hand.drag.end()
        return
      }

      const result = this.dispatchCommand({
        type: 'play-card',
        participantId: this.localParticipantId,
        cardInstanceId: entry.card.instanceId
      })
      if (!result.accepted) {
        this.logger.error(result.message)
        this.hand.drag.end()
        return
      }

      this.syncTurnHud(result.state)
      this.hand.drag.acceptCard()

      void this.enqueuePresentation(result.state, () =>
        this.presentAcceptedWeaponPlay(entry, result)
      )
      return
    }

    if (definition.type === 'Hero') {
      if (!isInDropZone(pointer, GAME_BOARD_LAYOUT.cardPlay.localDropZone)) {
        this.hand.drag.end()
        return
      }

      const result = this.dispatchCommand({
        type: 'play-card',
        participantId: this.localParticipantId,
        cardInstanceId: entry.card.instanceId
      })
      if (!result.accepted) {
        this.logger.error(result.message)
        this.hand.drag.end()
        return
      }

      this.syncTurnHud(result.state)
      this.hand.drag.acceptCard()

      void this.enqueuePresentation(result.state, () =>
        this.presentAcceptedHeroPlay(entry, result)
      )
      return
    }

    if (
      localPlayer.board.length >= MAX_BOARD_SIZE ||
      !isInDropZone(pointer, GAME_BOARD_LAYOUT.cardPlay.localDropZone)
    ) {
      this.hand.drag.end()
      return
    }

    const position = resolveBoardInsertionIndex(
      pointer.x,
      localPlayer.board.length,
      this.localBoardRowConfig()
    )
    const result = this.dispatchCommand({
      type: 'play-card',
      participantId: this.localParticipantId,
      cardInstanceId: entry.card.instanceId,
      position
    })
    if (!result.accepted) {
      this.logger.error(result.message)
      this.hand.drag.end()
      return
    }

    // The engine has already committed the spend. Reflect it before any summon
    // animation so the next pointer action cannot use stale mana/UI state.
    this.syncTurnHud(result.state)
    this.boardPositions.preview('local', entry.card.instanceId, position)

    // The minion ghost transition intentionally begins between detaching the
    // live drag ticker and destroying its perspective wrapper.
    this.hand.drag.acceptCard(() => entry.slot.beginMinionPlayTransition())

    void this.enqueuePresentation(result.state, () =>
      this.presentAcceptedMinionPlay(entry, result)
    )
  }

  private requiresSeparatePlacementClick(entry: HandEntry): boolean {
    const input = this.match.getPlayInput?.(
      this.localParticipantId,
      entry.card.instanceId
    )
    return (
      input !== null &&
      input !== undefined &&
      requiresClickConfirmedMinionPlacement(cardDefinition(entry.card).type, input)
    )
  }

  /** Removes by instance identity because later queued plays shift hand indexes. */
  private removePresentedHandEntry(entry: HandEntry): void {
    const index = this.hand.entries.indexOf(entry)
    if (index >= 0) this.hand.removeAt(index)
  }

  private async presentAcceptedWeaponPlay(
    entry: HandEntry,
    result: Extract<ReturnType<OpeningMatchInstance['dispatch']>, { accepted: true }>
  ): Promise<void> {
    if (this.destroyed) return
    try {
      this.removePresentedHandEntry(entry)
      entry.slot.disposePlayableOutline()
      entry.slot.removeFromParent()
      const handReflow = this.hand.applyLayout({
        positionDuration: OPENING_TIMING.cardDeal,
        scaleDuration: OPENING_TIMING.cardDeal
      })
      const weaponEquipped = result.events.find(
        (event): event is Extract<OpeningMatchEvent, { type: 'weapon-equipped' }> =>
          event.type === 'weapon-equipped'
      )
      const equip = weaponEquipped
        ? this.presentWeaponEquipped(weaponEquipped)
        : Promise.resolve()
      await Promise.all([handReflow, equip])
      if (this.destroyed) return
      entry.slot.destroy({ children: true })
      await this.presentResolutionEvents(result.events, weaponEquipped)
    } finally {
      if (!this.destroyed) {
        this.hand.setReflowing(false)
        this.hand.drag.presentationSettled()
        this.hand.activate()
        this.syncTurnHud(this.match.getState())
        this.syncTurnControls(this.match.getState())
      }
    }
  }

  private async presentAcceptedHeroPlay(
    entry: HandEntry,
    result: Extract<ReturnType<OpeningMatchInstance['dispatch']>, { accepted: true }>
  ): Promise<void> {
    if (this.destroyed) return
    try {
      this.removePresentedHandEntry(entry)
      entry.slot.disposePlayableOutline()
      entry.slot.removeFromParent()
      await this.hand.applyLayout({
        positionDuration: OPENING_TIMING.cardDeal,
        scaleDuration: OPENING_TIMING.cardDeal
      })
      if (this.destroyed) return
      entry.slot.destroy({ children: true })
      await this.presentResolutionEvents(result.events)
    } finally {
      if (!this.destroyed) {
        this.hand.setReflowing(false)
        this.hand.drag.presentationSettled()
        this.hand.activate()
        this.syncTurnHud(this.match.getState())
        this.syncTurnControls(this.match.getState())
      }
    }
  }

  private enqueueAcceptedSpellPlay(
    entry: HandEntry,
    result: Extract<ReturnType<OpeningMatchInstance['dispatch']>, { accepted: true }>,
    perspective?: CardPlayPose['perspective']
  ): Promise<void> {
    const pose: CardPlayPose = {
      ...this.cardPlayAnimation.capture(entry.slot.card),
      perspective
    }
    return this.enqueuePresentation(result.state, () =>
      this.presentAcceptedSpellPlay(entry, result, pose)
    )
  }

  private async presentAcceptedSpellPlay(
    entry: HandEntry,
    result: Extract<ReturnType<OpeningMatchInstance['dispatch']>, { accepted: true }>,
    pose: CardPlayPose
  ): Promise<void> {
    if (this.destroyed) return
    try {
      this.removePresentedHandEntry(entry)
      entry.slot.disposePlayableOutline()
      entry.slot.removeFromParent()
      entry.slot.destroy({ children: true })
      if (result.events.some(isHandDiscard)) {
        // Discard effects need not wait for the cast's decorative particles.
        // Settle the remaining cards first so their discard origins are stable.
        await Promise.all([
          this.cardPlayAnimation.present('Spell', pose),
          (async () => {
            await this.hand.applyLayout({
              positionDuration: RESOLUTION_TIMING.discardHandSettle,
              scaleDuration: RESOLUTION_TIMING.discardHandSettle
            })
            if (this.destroyed) return
            this.syncSecrets(result.state)
            await this.presentResolutionEvents(result.events)
          })()
        ])
        return
      }
      await Promise.all([
        this.cardPlayAnimation.present('Spell', pose),
        this.hand.applyLayout({
          positionDuration: OPENING_TIMING.cardDeal,
          scaleDuration: OPENING_TIMING.cardDeal
        })
      ])
      if (this.destroyed) return
      this.syncSecrets(result.state)
      await this.presentResolutionEvents(result.events)
    } finally {
      if (!this.destroyed) {
        this.hand.setReflowing(false)
        this.hand.drag.presentationSettled()
        this.hand.activate()
        this.syncTurnHud(this.match.getState())
        this.syncTurnControls(this.match.getState())
      }
    }
  }

  private async presentAcceptedMinionPlay(
    entry: HandEntry,
    result: Extract<ReturnType<OpeningMatchInstance['dispatch']>, { accepted: true }>,
    minionPreview?: MinionPreviewPresentation
  ): Promise<void> {
    if (this.destroyed) return
    try {
      this.removePresentedHandEntry(entry)
      const minionPlayed = result.events.find(
        (event): event is Extract<OpeningMatchEvent, { type: 'minion-played' }> =>
          event.type === 'minion-played'
      )
      const handReflow = this.hand.applyLayout({
        positionDuration: OPENING_TIMING.cardDeal,
        scaleDuration: OPENING_TIMING.cardDeal
      })
      const summon = minionPreview
        ? this.finalizeMinionTargetPreview(minionPreview, minionPlayed)
        : minionPlayed
          ? this.presentMinionPlayed(minionPlayed, entry.slot)
          : Promise.resolve().then(() => {
              entry.slot.disposePlayableOutline()
              entry.slot.removeFromParent()
              entry.slot.destroy({ children: true })
            })
      await Promise.all([handReflow, summon])
      await this.presentResolutionEvents(result.events, minionPlayed)
    } finally {
      if (!this.destroyed) {
        this.hand.setReflowing(false)
        this.hand.drag.presentationSettled()
        this.boardPositions.preview('local', entry.card.instanceId, null)
        this.applyLocalBoardLayout()
        this.hand.activate()
        this.syncTurnHud(this.match.getState())
        this.syncTurnControls(this.match.getState())
      }
    }
  }

  private async finalizeMinionTargetPreview(
    presentation: MinionPreviewPresentation,
    minionPlayed: Extract<OpeningMatchEvent, { type: 'minion-played' }> | undefined
  ): Promise<void> {
    const { view, slot, resting } = presentation
    if (minionPlayed && !view.destroyed) {
      const markers = boardMinionAbilityMarkers(
        minionPlayed.minion,
        CARD_CATALOG.require(minionPlayed.minion.cardId),
        this.match.getState().turnNumber
      )
      view.removeFromParent()
      view.instanceId = minionPlayed.minion.instanceId
      view.ownerId = minionPlayed.participantId
      view.setStats(
        minionPlayed.minion.attack,
        minionPlayed.minion.health,
        minionPlayed.minion.maxHealth
      )
      view.setTaunt(markers.taunt)
      view.setEnraged(markers.enraged)
      view.setDivineShield(markers.divineShield)
      view.setFrozen(
        isFrozen(minionPlayed.minion.frozenUntilTurn, this.match.getState().turnNumber)
      )
      view.setAbilityEffects(markers)
      view.setStealth(markers.stealth)
      view.setTrigger(markers.trigger)
      view.setInspire(markers.inspire)
      view.setDeathrattle(markers.deathrattle)
      view.setBaseScale(resting.scale)
      this.insertLocalMinionView(minionPlayed.position, view)
      view.position.set(resting.x, resting.y)
      view.scale.set(resting.scale)
      view.alpha = 1
      this.applyLocalBoardLayout()
      this.syncBoardAttackability(this.match.getState())
    } else if (!view.destroyed) {
      view.removeFromParent()
      view.destroy({ children: true })
    }

    slot.disposePlayableOutline()
    slot.removeFromParent()
    slot.destroy({ children: true })
    this.activeSummonSlots.delete(slot)
    this.boardPositions.finishEntrance('local', view.instanceId ?? '')
  }

  private tryActivateDraggedCardTargeting(
    entry: HandEntry,
    pointer: HandPointer,
    pointerId: number
  ): boolean {
    const input = this.match.getPlayInput?.(
      this.localParticipantId,
      entry.card.instanceId
    )
    if (!input || !allowsDragTargetingFromHand(cardDefinition(entry.card).type, input))
      return false
    if (!this.targetGestures.move(pointerId, pointer, DRAG_MOVE_THRESHOLD)) return false

    this.cardPlay.updatePointer({ ...pointer })
    this.cardPlay.beginCardTargeting(entry, input, undefined, 'local-hero')
    if (this.cardPlay.current?.cardInstanceId !== entry.card.instanceId) {
      this.targetGestures.cancel(
        (source) =>
          source.kind === 'card' && source.cardInstanceId === entry.card.instanceId
      )
    }
    return true
  }

  private isLocalTurn(): boolean {
    return this.match.getState().activePlayerId === this.localParticipantId
  }

  /**
   * Left click on the hand: resolve the card under the pointer and attach it to
   * the cursor if the local player can afford it on their turn, otherwise give
   * it a small "no" shake. Clicks on the opponent's turn are ignored.
   */
  private onHandPointerDown(event: FederatedPointerEvent): void {
    if (this.heroPowerTargeting || this.cardPlay.current || this.isGameplayBlocked())
      return
    if (this.selectedCombatView) {
      this.deselectAttacker()
      return
    }
    if (event.button !== 0) return
    if (this.hand.drag.index !== null) return
    const local = event.getLocalPosition(this.hand.layer)
    const transforms = this.hand.restTransforms
    const resolved = resolveHandHover(local, transforms, DEFAULT_HAND_LAYOUT)
    if (resolved === null) return
    const legality = this.match.getLegality?.(this.localParticipantId)
    const card = this.hand.entries[resolved]?.card
    if (!card || !legality?.playableCardInstanceIds.includes(card.instanceId)) {
      this.shakeCard(resolved)
      return
    }
    this.hand.drag.begin(resolved, local, event.pointerId)
  }

  /** A quick horizontal wobble for an unaffordable card, settling back at rest. */
  private shakeCard(index: number): void {
    const entry = this.hand.entries[index]
    if (!entry) return
    const slot = entry.slot
    const { shakeDistance, shakeDuration } = DEFAULT_HAND_DRAG
    const baseX = slot.x
    const steps = 2
    const stepDuration = shakeDuration / (steps * 2)
    const timeline = this.timeline()
    for (let i = 0; i < steps; i += 1) {
      const direction = i % 2 === 0 ? 1 : -1
      timeline.to(slot, {
        x: baseX + direction * shakeDistance,
        duration: stepDuration,
        ease: 'power1.inOut'
      })
      timeline.to(slot, {
        x: baseX - direction * shakeDistance,
        duration: stepDuration,
        ease: 'power1.inOut'
      })
    }
    timeline.to(slot, {
      x: baseX,
      duration: stepDuration,
      ease: 'power1.inOut'
    })
  }

  override pauseAnimations(): void {
    super.pauseAnimations()
    this.cardPlayAnimation.pauseAnimations()
    this.remoteCardPlayPreview.pauseAnimations()
    this.remoteTargetPreview.pauseAnimations()
  }

  updateShadows(deltaMS: number): void {
    if (!this.isBoardCardPreviewEnabled()) this.hoverPreview.cancel()
    if (this.localSecretHovered && !this.isBoardCardPreviewEnabled()) {
      this.localSecretHovered = false
      this.secretPreviewView.hide()
    }
    if (this.questHoveredSide && !this.isBoardCardPreviewEnabled()) {
      this.questHoveredSide = null
      this.questPreviewView.hide()
    }
    this.updateBadgeBoardDesaturation()
    this.shadowLayer.update(deltaMS)
    this.cardSelectionOverlay.updateShadows(deltaMS)
  }

  /** Input pose, dependent presentation, and shadows belong to the same render. */
  updateFrame(deltaMS: number): void {
    this.hand.drag.update(deltaMS)
    this.flushBoardPointerVisuals()
    this.updateShadows(deltaMS)
  }

  override resumeAnimations(): void {
    super.resumeAnimations()
    this.cardPlayAnimation.resumeAnimations()
    this.remoteCardPlayPreview.resumeAnimations()
    this.remoteTargetPreview.resumeAnimations()
  }

  override dispose(): void {
    window.removeEventListener('resize', this.invalidateCanvasBounds)
    window.removeEventListener('scroll', this.invalidateCanvasBounds, true)
    this.options.renderer.off?.('resize', this.invalidateCanvasBounds)
    this.canvasResizeObserver?.disconnect()
    this.canvasResizeObserver = null
    this.pendingBoardPointer = null
    this.cardDepartureAnimation.dispose()
    for (const slot of this.activeDepartureSlots)
      if (!slot.destroyed) slot.destroy({ children: true })
    this.activeDepartureSlots.clear()
    this.randomSpellRevision = null
    this.randomSpellState = null
    for (const resolve of this.resolutionIdleWaiters.splice(0)) resolve()
    for (const animation of this.drawAnimations) animation.dispose()
    this.drawAnimations.clear()
    this.aiController?.dispose()
    window.removeEventListener('pointerdown', this.handleWindowPointerDown, true)
    window.removeEventListener('pointerup', this.handleWindowPointerUp, true)
    window.removeEventListener('blur', this.handleWindowBlur)
    window.removeEventListener('keydown', this.handleWindowKeyDown, true)
    this.cardPlacementTapGuard.clear()
    this.cardChoiceInputGate.clear()
    this.targetGestures.clear()
    this.options.cursor?.setOverrideVariant(null)
    this.options.cursor?.setContextVariant(null)
    this.options.cursor?.setTargeting(false)
    this.hideBoardCardPreview()
    this.hoverPreview.dispose()
    this.matchResultBlurFilter?.destroy()
    this.matchResultBlurFilter = null
    this.matchResultGrayscaleFilter?.destroy()
    this.matchResultGrayscaleFilter = null
    this.combat.clearCombatPreview()
    this.heroPowerTargeting = false
    this.cardPlay.clearCardChoiceOverlay()
    this.cardPlay.dispose()
    this.cardSelectionOverlay.dispose()
    this.combatInProgress = false
    this.cancelCombatDrag()
    this.combat.dispose()
    this.attackLine.clear()
    this.hand.dispose()
    this.mulligan.dispose()
    for (const slot of this.activeSummonSlots) {
      slot.disposePlayableOutline()
    }
    this.activeSummonSlots.clear()
    for (const view of this.heroPowerViews.values()) {
      view.dispose()
    }
    this.heroPowerViews.clear()
    for (const view of this.heroViews.values()) {
      view.removeFromParent()
      view.destroy({ children: true })
    }
    this.heroViews.clear()
    this.addCardPicker?.dispose()
    this.fatigueView.destroy({ children: true })
    this.secretRevealView.destroy({ children: true })
    this.secretZoneView.destroy({ children: true })
    this.questZoneView.destroy({ children: true })
    this.secretPreviewView.destroy({ children: true })
    this.questPreviewView.destroy({ children: true })
    this.remoteCardPlayPreview.dispose()
    this.remoteTargetPreview.dispose()
    this.cardPlayAnimation.dispose()
    this.hud.dispose()
    for (const view of this.localMinionViews) {
      view.removeFromParent()
      view.destroy({ children: true })
    }
    for (const view of this.remoteMinionViews) {
      view.removeFromParent()
      view.destroy({ children: true })
    }
    this.boardPositions.dispose()
    for (const view of this.weaponViews.values()) {
      view.removeFromParent()
      view.destroy({ children: true })
    }
    this.weaponViews.clear()
    super.dispose()
  }

  private animateSlotToDeck(
    slot: GameCardSlot,
    deck: LayoutPlacement,
    sequence: number
  ): Promise<void> {
    this.travelLayer.reparentChild(slot)
    slot.setMulliganInteractionEnabled(false)
    const direction = slot.x < deck.position.x ? -1 : 1
    const timeline = this.timeline()
    timeline.to(slot, {
      x: deck.position.x,
      y: deck.position.y,
      alpha: 0,
      rotation: direction * (0.16 + sequence * 0.015),
      duration: OPENING_TIMING.cardDeal,
      ease: 'power2.in'
    })
    timeline.to(
      slot.scale,
      {
        x: GAME_BOARD_LAYOUT.cardTravel.slotScale.x,
        y: GAME_BOARD_LAYOUT.cardTravel.slotScale.y,
        duration: OPENING_TIMING.cardDeal,
        ease: 'power2.in'
      },
      0
    )
    return completeTimeline(timeline)
  }

  /**
   * Presents a discard effect: the local hand card or one remote card back
   * flies to the board center while fading to zero and is then destroyed.
   * Removing the entry/back here transfers ownership out of the hand so the
   * effect reconcile finds nothing left to prune.
   */
  private async presentHandDiscard(
    event: Extract<OpeningMatchEvent, { type: 'effect-resolved' }>
  ): Promise<void> {
    await this.presentHandDiscards([event])
  }

  private async presentHandDiscards(
    events: readonly Extract<OpeningMatchEvent, { type: 'effect-resolved' }>[]
  ): Promise<void> {
    const discards = events.filter(isHandDiscard)
    if (discards.length === 0 || this.destroyed) return
    this.syncSecrets(this.presentationState())
    const bodies: { body: Container; direction: number }[] = []
    const seen = new Set<string>()
    const wasReflowing = this.hand.isReflowing
    const previousEventMode = this.hand.layer.eventMode
    this.hand.setReflowing(true)
    this.hand.layer.eventMode = 'none'
    this.hand.resetHover()
    let localChanged = false
    let remoteChanged = false
    try {
      for (const event of discards) {
        const targetId = event.data?.target
        const participantId = event.data?.participantId
        if (typeof targetId !== 'string' || seen.has(targetId)) continue
        seen.add(targetId)
        if (participantId === this.localParticipantId) {
          const entry = this.findEntry(targetId)
          if (!entry) continue
          bodies.push({ body: this.createLocalDiscardGhost(entry), direction: -1 })
          localChanged = true
        } else if (participantId === this.remoteParticipantId) {
          // Hidden remote hand entries have no public instance mapping.
          const index = Math.floor((this.remoteBackCount - 1) / 2)
          const back = index >= 0 ? this.remoteBacks[index] : undefined
          if (!back) continue
          gsap.killTweensOf(back)
          gsap.killTweensOf(back.scale)
          this.discardFlightLayer.reparentChild(back)
          back.label = 'game.card-discard.remote-back'
          this.remoteBacks.splice(index, 1)
          this.remoteBackCount -= 1
          bodies.push({ body: back, direction: 1 })
          remoteChanged = true
        }
      }
      if (bodies.length === 0) return
      const timeline = this.timeline()
      for (const { body, direction } of bodies) {
        timeline.to(
          body,
          {
            y: body.y + direction * GAME_BOARD_LAYOUT.discard.travelDistance,
            duration: RESOLUTION_TIMING.discardFlight,
            ease: 'none'
          },
          0
        )
      }
      timeline.to(
        bodies.map(({ body }) => body),
        {
          alpha: 0,
          duration: RESOLUTION_TIMING.discardFade,
          ease: 'none'
        }
      )
      await completeTimeline(timeline)
      if (this.destroyed) return
      if (remoteChanged) this.layoutRemoteHand()
      if (localChanged)
        await this.hand.applyLayout({
          positionDuration: RESOLUTION_TIMING.discardHandSettle,
          scaleDuration: RESOLUTION_TIMING.discardHandSettle
        })
    } finally {
      for (const { body } of bodies)
        if (!body.destroyed) body.destroy({ children: true })
      if (!this.destroyed) {
        this.hand.setReflowing(wasReflowing)
        this.hand.layer.eventMode = previousEventMode
      }
    }
  }

  /** Capture the resting pose so hover and drag cannot bend the discard flight. */
  private createLocalDiscardGhost(entry: HandEntry): Container {
    this.removePresentedHandEntry(entry)
    const slot = entry.slot
    const rest = entry.restTransform ?? {
      x: GAME_BOARD_LAYOUT.frame.center.x,
      y: DEFAULT_HAND_LAYOUT.baselineY,
      rotation: 0,
      scale: DEFAULT_HAND_LAYOUT.cardScale,
      zIndex: 0
    }
    // resetHover never restores the enlarged hover pose, so normalize the
    // live card to its rest pose before capturing the snapshot.
    gsap.killTweensOf(slot)
    gsap.killTweensOf(slot.scale)
    gsap.killTweensOf(slot.skew)
    slot.position.set(rest.x, rest.y)
    slot.rotation = rest.rotation
    slot.scale.set(rest.scale)
    slot.skew.set(0, 0)
    const bounds = slot.getLocalBounds()
    const texture = this.options.renderer.generateTexture({
      target: slot,
      frame: new Rectangle(bounds.x, bounds.y, bounds.width, bounds.height)
    })
    slot.removeFromParent()
    slot.destroy({ children: true })

    const ghost = new Container()
    ghost.label = 'game.card-discard.ghost'
    ghost.eventMode = 'none'
    const image = new Sprite(texture)
    image.position.set(bounds.x, bounds.y)
    image.eventMode = 'none'
    ghost.addChild(image)
    ghost.once('destroyed', () => texture.destroy(true))
    ghost.position.set(rest.x, rest.y)
    ghost.rotation = rest.rotation
    ghost.scale.set(rest.scale)
    this.discardFlightLayer.addChild(ghost)

    return ghost
  }

  private async animateHeroToBoard(
    view: HeroView,
    target: LayoutPlacement
  ): Promise<void> {
    const timeline = this.timeline()
    timeline.to(view, {
      x: target.position.x,
      y: target.position.y,
      duration: OPENING_TIMING.heroSettle,
      ease: 'power2.inOut'
    })
    timeline.to(
      view.scale,
      {
        x: target.scale?.x ?? 1,
        y: target.scale?.y ?? 1,
        duration: OPENING_TIMING.heroSettle,
        ease: 'power2.inOut'
      },
      0
    )
    await completeTimeline(timeline)
    // Keep selection/hover animation targets aligned with the settled board
    // scale rather than the larger versus-intro scale.
    if (!view.destroyed) view.setBaseScale(target.scale?.x ?? 1)
  }

  private async animateDeckDeparture(
    target: GameCardSlot | Sprite,
    duration: number,
    delay: number,
    profile: CardDrawProfile = 'direct',
    onBurnStart?: () => void
  ): Promise<void> {
    const deck = this.drawOrigins.get(target)
    this.drawOrigins.delete(target)
    if (!deck || this.destroyed) return
    if (
      profile === 'local-reveal' &&
      deck === this.deckViews.get(this.remoteParticipantId)
    )
      profile = 'remote-reveal'
    const animation = new CardDrawAnimation(
      this.options.renderer,
      this.travelLayer,
      deck,
      target,
      this.options.gameAssets.cardBack,
      target instanceof GameCardSlot ? target : undefined,
      profile
    )
    this.drawAnimations.add(animation)
    const progress = { value: 0 }
    try {
      const timeline = this.timeline()
      const reveal = CARD_DRAW_LAYOUT.localReveal
      const onUpdate = (): void => animation.update(progress.value)
      if (profile !== 'direct') {
        const mulligan = profile === 'mulligan-reveal'
        const peakAt = reveal.reveal[reveal.reveal.length - 1].at
        const peakProgress = peakAt / reveal.duration
        // Normal draws start immediately; mulligan keeps its staggered departures.
        timeline.to(progress, {
          value: peakProgress,
          duration: mulligan ? peakAt : reveal.normalAscentDuration,
          delay: mulligan ? delay : 0,
          ease: 'none',
          onUpdate
        })
        if (onBurnStart) {
          const burn = { progress: 0 }
          timeline.call(onBurnStart)
          timeline.to(burn, {
            progress: 1,
            duration: reveal.burnDuration,
            ease: 'none',
            onUpdate: () =>
              animation.updateBurn(burn.progress, this.options.gameAssets.burnNoise)
          })
        } else {
          if (!mulligan) timeline.to({}, { duration: reveal.peakHold })
          timeline.to(progress, {
            value: 1,
            duration: mulligan
              ? reveal.mulliganDescentDuration
              : reveal.normalDescentDuration,
            ease: 'none',
            onUpdate
          })
        }
      } else {
        timeline.to(progress, {
          value: 1,
          duration,
          delay,
          ease: 'none',
          onUpdate
        })
      }
      await completeTimeline(timeline)
    } finally {
      animation.dispose()
      this.drawAnimations.delete(animation)
    }
  }

  private fadeTo(
    target: { alpha: number },
    alpha: number,
    duration: number
  ): Promise<void> {
    return completeTimeline(
      this.timeline().to(target, { alpha, duration, ease: 'power2.out' })
    )
  }

  private wait(duration: number): Promise<void> {
    return completeTimeline(this.timeline().to({}, { duration }))
  }

  private waitForResolutionIdle(): Promise<void> {
    if (this.resolutionPresentationDepth === 0 && this.randomSpellRevision === null)
      return Promise.resolve()
    return new Promise((resolve) => this.resolutionIdleWaiters.push(resolve))
  }
}
