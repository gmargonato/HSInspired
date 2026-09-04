import {
  BlurFilter,
  ColorMatrixFilter,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  type Renderer,
  type FederatedPointerEvent,
  type Texture
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
  type CharacterCombatantResult,
  type CharacterCombatResolvedEvent,
  type ConfirmMulliganCommand,
  type HeroPowerTargetRef,
  type MulliganResolvedEvent,
  type MatchEndedEvent,
  type OpeningCard,
  type PlayCardInput,
  type OpeningMatchEvent,
  type OpeningMatchInstance,
  type OpeningMatchState
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
import { isLegalHeroPowerTarget } from './hero-power-targeting'
import type { RendererLogger } from '../../ui/logger'
import { CardView } from '../../rendering/cards/card-view'
import { CARD_CANVAS, CARD_PROFILES } from '../../rendering/cards/card-layout'
import { cardCostColor } from '../../rendering/cards/card-cost-presentation'
import { gsap } from '../../animation/animations'
import {
  type DeckPresentationAssets,
  type GameAssets,
  type HeroPowerAssetKey
} from '../../ui/asset-registry'
import { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'
import { Actor } from '../../ui/components/actor'
import { Button } from '../../ui/components/button'
import { TARGETING_ARROW_HEAD, type CursorManager } from '../../ui/components/cursor'
import { GAME_HEIGHT, GAME_WIDTH } from '../../rendering/layout'
import {
  DEFAULT_HAND_LAYOUT,
  HandCardTransform,
  HandPointer,
  handHoverHitBounds,
  isPointerOverLiftedCard,
  layoutHand,
  resolveHandHover
} from './hand-layout'
import {
  DEFAULT_HAND_DRAG,
  initialDragState,
  stepDrag,
  type HandDragState
} from './hand-drag'
import {
  OneShotPointerTapGuard,
  PointerReleaseInputGate,
  allowsDragTargetingFromHand,
  isCardTargetSelectionActive,
  isHandOwnedSlot,
  pendingCardInputStage,
  requiresClickConfirmedMinionPlacement,
  resolveHandCardArrowOrigin,
  type HandCardTargetingOrigin
} from './hand-play-gesture'
import { HandCardPerspective } from './hand-card-perspective'
import { HeroPowerView, type HeroPowerLayout } from './hero-power-view'
import {
  MinionView,
  type MinionViewTextures
} from '../../rendering/minions/minion-view'
import { HeroView } from '../../rendering/heroes/hero-view'
import { HeroPowerCardView } from '../../rendering/hero-powers/hero-power-presentation'
import { WeaponView } from '../../rendering/weapons/weapon-view'
import { AddCardPickerView } from './add-card-picker-view'
import { CardSelectionOverlay } from './card-selection-overlay'
import {
  isInDropZone,
  layoutBoardRow,
  resolveBoardInsertionIndex,
  type BoardRowConfig
} from './board-layout'
import { AttackLine } from './attack-line'
import { getCombatImpactProfile } from './combat-impact'
import { canCommitCombatAttack, canSelectCombatAttacker } from './combat-input-window'
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
import { GameCardSlot } from './game-card-slot'
import { MatchResultOverlay, type MatchResult } from './match-result-overlay'
import { FatigueView } from './fatigue-view'
import { boardAbilityMarkers, boardMinionAbilityMarkers } from './board-ability-markers'
import { DamageIndicatorView } from './damage-indicator-view'
import { HealIndicatorView } from './heal-indicator-view'
import {
  effectDamageIndicatorAmount,
  effectHealIndicatorAmount
} from './character-indicator-presentation'
import { SecretRevealView, SecretZoneView } from './secret-view'
import { MatchHistoryView } from './match-history-view'
import { clearMatchResultCombatViews } from './match-result-state'
import { AiTurnController, COMPETITIVE_AI_POLICY } from './ai-turn-controller'
import { TargetGestureController } from './target-gesture'
import {
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
  /** May be created by the scene early so deck planning overlaps asset loading. */
  readonly aiRuntime?: {
    readonly session: GameBoardSession
    readonly controller: AiTurnController
  }
  readonly onMatchEnded?: (event: MatchEndedEvent) => Promise<void> | void
  readonly onMatchComplete?: () => Promise<void> | void
}

/** Feature-local timings make the opening easy to tune without layout edits. */
const OPENING_TIMING = {
  versusHold: 2,
  heroSettle: 0.6,
  boardPause: 0.5,
  mulliganFade: 0.3,
  cardDeal: 0.75,
  cardStagger: 0.18,
  playerTwoAnnouncementHold: 0.9,
  playerTwoAnnouncementFade: 0.25,
  playerTwoFourthCard: 0.65,
  confirmationPause: 0.5,
  replacementPause: 0.25,
  handoffPause: 0.5,
  hover: 0.2
} as const

/** Turn-control timings (end turn button, AI pass, your-turn flag). */
const TURN_TIMING = {
  /** How long the AI "thinks" before passing the turn back. */
  aiTurnDelay: 0.15,
  yourTurnGrow: 0.35,
  yourTurnHold: 1,
  yourTurnFadeOut: 0.15
} as const

/** Board-only timing knobs for row previews and minion entry presentation. */
const BOARD_TIMING = {
  minionSettle: 0.3,
  rowShift: 0.25,
  summonSnap: 0.18,
  summonCharge: 0.27,
  summonCollapse: 0.16,
  summonImpact: 0.32,
  combatWindupPause: 0.08,
  combatLunge: 0.18,
  combatImpact: 0.12,
  combatReturn: 0.2,
  combatDeath: 0.28,
  characterIndicatorGrow: 0.16,
  characterIndicatorHold: 1,
  characterIndicatorFade: 0.2
} as const

/** Resolution pacing shared by every trigger/death/outcome presentation. */
const RESOLUTION_TIMING = {
  /** Full marker pulse for each concrete trigger frame. */
  triggerPulse: 0.6,
  /** Small handoff while a captured death leaves the board. */
  deathCollapse: 0.28,
  /** Deathrattle marker growth/fade before its actions begin. */
  deathrattleGhost: 0.62,
  /** Lets non-combat effect outcomes be read before the next queue item. */
  outcomePause: 0.2,
  /** Impact beat between combat damage and its reactive trigger queue. */
  combatImpactPause: 0.12,
  /** Travel time for a card newly created by an effect. */
  generatedCard: 0.45,
  /** Brief delay before a generated card leaves its source. */
  generatedCardDelay: 0.05,
  /** Downward exit time for each card replaced by Golden Monkey. */
  handReplacementExit: 0.2
} as const

const GOLDEN_MONKEY_CARD_ID = 'league_of_explorers_golden_monkey'

const COMBAT_ATTACKER_Z_INDEX = 100
const COMBAT_DRAG_MOVE_THRESHOLD_PX = 10

interface CombatViewPlacement {
  readonly parent: Container
  readonly index: number
  readonly zIndex: number
}

type CombatView = MinionView | HeroView

type BoardTargetGestureSource =
  | { readonly kind: 'combat'; readonly attacker: CombatView }
  | { readonly kind: 'hero-power' }
  | { readonly kind: 'card'; readonly cardInstanceId: string }

interface ActiveCombatPresentation {
  readonly combatId: string
  readonly attacker: CombatView
  readonly defender: CombatView
  readonly attackerOrigin: { readonly x: number; readonly y: number }
  readonly defenderOrigin: { readonly x: number; readonly y: number }
  readonly attackerPlacement: CombatViewPlacement
  readonly attackerAttack: number
  readonly deferredAttackerDeathInstanceIds: Set<string>
  readonly attackerDamageIndicators: Set<DamageIndicatorView>
  impactStarted: boolean
  attackerReturned: boolean
  screenShake: Promise<void> | null
}

interface DeathGhostTemplate {
  readonly sourceInstanceId: string
  readonly snapshot: {
    readonly texture: Texture
    readonly globalPosition: { readonly x: number; readonly y: number }
    readonly worldScale: number
  }
}

interface MinionPreviewPresentation {
  readonly view: MinionView
  readonly slot: GameCardSlot
  readonly resting: { readonly x: number; readonly y: number; readonly scale: number }
}

interface PendingMinionTargetPreview {
  readonly entry: HandEntry
  readonly position: number
  /** Final summon-layer position used as the targeting arrow's fixed source. */
  readonly targetingOrigin: { readonly x: number; readonly y: number }
  cancelled: boolean
  ready: boolean
  presentation: MinionPreviewPresentation | null
  presentationPromise: Promise<MinionPreviewPresentation | null> | null
  reversePromise: Promise<void> | null
  rays: Sprite | null
  readonly activeTimelines: Set<gsap.core.Timeline>
}

interface CardPlayTargetingState {
  readonly cardInstanceId: string
  readonly input: PlayCardInput
  readonly targets: CardPlayTargetRef[]
  readonly position?: number
  /** Visual arrow source. This is independent from hand-card restoration. */
  readonly arrowOrigin: HandCardTargetingOrigin
  /** Presentation staged while the authoritative card remains pending. */
  readonly presentation:
    | { readonly kind: 'hidden-hand-card' }
    | { readonly kind: 'minion-preview'; readonly preview: PendingMinionTargetPreview }
  choice?: number
}

const SUMMON_GHOST_COLOR = 0x79e9ff
const COMBAT_SHAKE_DIRECTIONS = [
  { x: 1, y: -0.25 },
  { x: -0.75, y: 0.55 },
  { x: 0.55, y: -0.75 },
  { x: -0.35, y: 0.3 },
  { x: 0.2, y: -0.15 }
] as const
const SUMMON_DETAIL_LAYERS = [
  'name',
  'rules',
  'race',
  'race-banner',
  'rarity',
  'mana-shadow'
] as const
const SUMMON_STRUCTURE_LAYERS = [
  'frame',
  'name-banner',
  'legendary-frame',
  'card.stats.mana.icon',
  'card.stats.attack.icon',
  'card.stats.health.icon'
] as const
const SUMMON_LABEL_LAYERS = [
  'card.stats.mana.label',
  'card.stats.attack.label',
  'card.stats.health.label'
] as const

const DRAG_MOVE_THRESHOLD = 10

function cardDefinition(card: OpeningCard): CardDefinition {
  return CARD_CATALOG.require(card.cardId)
}

function cloneCard(card: OpeningCard): OpeningCard {
  return { ...card }
}

/** Ordered pair of a hand card and its interactive slot — single source of truth. */
interface HandEntry {
  card: OpeningCard
  slot: GameCardSlot
  /**
   * Resting transform (no hover applied). Set by `applyHandLayout` after every
   * structural change (deal, mulligan resolve, draw) and read by `applyHoverDelta`
   * to compute hover targets without re-running `layoutHand`.
   */
  restTransform: HandCardTransform | undefined
  /**
   * True while the card is at a non-rest position due to hover. Cleared by
   * `applyHandLayout`. Used by `applyHoverDelta` to skip cards that are at rest
   * and should not be touched (the common case — only one card is hovered).
   */
  displaced: boolean
}

interface GoldenMonkeyHandReplacement {
  readonly sourceInstanceId: string
  readonly targetInstanceIds: ReadonlySet<string>
}

/** Feature-owned board, opening choreography, mulligan, and local hand interaction. */
export class GameBoardView extends Actor {
  private readonly resolver = new CardAssetResolver()
  private readonly handEntries: HandEntry[] = []
  private readonly selectedIds = new Set<string>()
  private readonly initialSlots: GameCardSlot[] = []
  private readonly remoteBacks: Sprite[] = []
  private readonly boardLayer = new Container()
  private readonly matchBackdropLayer = new Container()
  private readonly gameplayLayer = new Container()
  private readonly localMinionLayer = new Container()
  private readonly remoteMinionLayer = new Container()
  private readonly boardMinionCardPreviewLayer = new Container()
  private readonly weaponLayer = new Container()
  private readonly summonLayer = new Container()
  private readonly combatOverlayLayer = new Container()
  private readonly localMinionViews: MinionView[] = []
  private readonly remoteMinionViews: MinionView[] = []
  private boardMinionCardPreview: CardView | null = null
  private hoveredBoardMinionView: MinionView | null = null
  private boardMinionCardPreviewRequest = 0
  private requestedBoardMinionCardPreviewKey: string | null = null
  private readonly weaponViews = new Map<PlayerId, WeaponView>()
  private readonly activeCombatPresentations = new Map<
    string,
    ActiveCombatPresentation
  >()
  private readonly deathGhostTemplates = new Map<string, DeathGhostTemplate>()
  private readonly deathBatchSources = new Map<string, readonly string[]>()
  private readonly activeDeathGhosts = new Set<Sprite>()
  private readonly activeSummonSlots = new Set<GameCardSlot>()
  private readonly hud = new GameHudView(this.resolver)
  private readonly addCardPicker: AddCardPickerView | null
  private pickerTarget: DevMatchTarget = 'local'
  private pickerAction: DevCardPickerAction = 'add-to-hand'
  private readonly attackLineLayer = new Container()
  private readonly attackLine = new AttackLine()
  private readonly cardChoiceLayer = new Container()
  private readonly cardSelectionOverlay: CardSelectionOverlay
  private readonly matchResultOverlay: MatchResultOverlay
  private readonly fatigueView: FatigueView
  private readonly secretZoneView: SecretZoneView
  private readonly secretRevealView: SecretRevealView
  private historyView: MatchHistoryView | null = null
  private historyGrayscaleFilter: ColorMatrixFilter | null = null
  private readonly combatPreviewMarkers = new Map<CombatView, Sprite>()
  private selectedCombatView: CombatView | null = null
  private heroPowerTargeting = false
  private cardTargeting: CardPlayTargetingState | null = null
  private combatInProgress = false
  private combatAttackerSelectionUnlocked = false
  private readonly targetGestures =
    new TargetGestureController<BoardTargetGestureSource>()
  /** Ignores the pointertap synthesized by a click that advances card play. */
  private readonly cardPlacementTapGuard = new OneShotPointerTapGuard()
  private readonly cardChoiceInputGate = new PointerReleaseInputGate()
  private cardPlayInProgress = false
  private resolutionPresentationDepth = 0
  private readonly resolutionIdleWaiters: Array<() => void> = []
  private matchResultShown = false
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
  private readonly deckLayer = new Container()
  private readonly deckViews = new Map<PlayerId, Sprite>()
  private readonly turnLayer = this.hud.turnLayer
  private readonly mulliganLayer = new Container()
  private readonly handLayer = new Container()
  private readonly remoteHandLayer = new Container()
  private readonly heroViews = new Map<PlayerId, HeroView>()
  /** One face-up hero power card per player, right of the hero portraits. */
  private readonly heroPowerViews = new Map<PlayerId, HeroPowerView>()
  private readonly logger: RendererLogger
  private session!: GameBoardSession
  private aiController!: AiTurnController
  private aiMulliganResolution: Promise<boolean> | null = null
  private aiTurnRunning = false
  private get match(): OpeningMatchInstance {
    return this.session.match
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
  private localHoveredSlot: GameCardSlot | null = null
  private confirmButton!: Button
  /**
   * True while a turn is being processed (a local end-turn or the AI's pass).
   * Blocks repeat end-turn commands and the AI from acting out of turn.
   */
  private turnInProgress = false
  private confirmationLocked = false
  /** True only after every opening card has arrived and its mulligan outline is ready. */
  private mulliganInputReady = false
  private remoteBackCount = 0
  private openingRevealStarted = false
  /**
   * True while a structural reflow (deal, mulligan resolve, draw) is animating.
   * Hover is blocked during reflow so the pointermove handler does not fight
   * the structural timeline animating the same slot properties.
   */
  private reflowing = false
  /**
   * True once `activateHandHover` has wired the pointermove/pointerleave
   * listeners on handLayer. Stays true for the lifetime of the hand; the
   * pointermove handler checks this to bail during teardown.
   */
  private handModeActive = false
  /**
   * Index of the hand card currently being dragged, or null when no drag is
   * active. While set, the pointermove handler feeds `dragPointer` and the
   * `gsap.ticker` loop advances the card's position with resistance.
   */
  private draggingIndex: number | null = null
  /** Latest pointer position in handLayer space while dragging. */
  private dragPointer: HandPointer | null = null
  /** Resistance-lerped position/tilt advanced every ticker frame. */
  private dragState: HandDragState | null = null
  /** Registered `gsap.ticker` callback; removed when the drag ends. */
  private dragTick: ((time: number, deltaMS: number) => void) | null = null
  /** Rigid-plane and semantic-layer motion applied only to the held card. */
  private dragPerspective: HandCardPerspective | null = null
  /** Keeps input blocked while the released card is animating back into the fan. */
  private dragReturning = false
  /** Pointer position captured at pickup for click-versus-drag classification. */
  private dragStartPointer: HandPointer | null = null
  /** True once the carried pointer has crossed the movement threshold. */
  private dragMovedBeyondThreshold = false
  /** Last canvas point used for targeted-spell aim and cancel restoration. */
  private lastTargetingPointer: HandPointer | null = null
  /** Current insertion gap preview, or null when no gap is previewed. */
  private localBoardPreviewIndex: number | null = null
  private readonly handleWindowPointerDown = (event: PointerEvent): void => {
    if (event.button === 2) {
      this.endDrag()
      const pointer = this.toRendererPoint(event.clientX, event.clientY)
      if (this.selectedCombatView || this.heroPowerTargeting || this.cardTargeting) {
        event.preventDefault()
        event.stopPropagation()
      }
      this.cancelHeroPowerTargeting()
      this.cancelCardTargeting(pointer)
      this.deselectAttacker()
      this.targetGestures.clear()
      return
    }
    if (event.button === 0 && this.draggingIndex !== null && !this.dragReturning) {
      event.preventDefault()
      event.stopPropagation()
      const index = this.draggingIndex
      const entry = this.handEntries[index]
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
        this.castSelectedTargetlessSpell(index, entry)
        return
      }
      const pointer = this.dragPointer
      const cardInstanceId = entry?.card.instanceId
      if (pointer) this.resolveCardDrop(pointer)
      if (cardInstanceId && this.cardTargeting?.cardInstanceId === cardInstanceId) {
        const targeting = this.cardTargeting
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
    const releasePoint = this.toRendererPoint(event.clientX, event.clientY)
    // Pixi normally releases the gesture first through handleBoardPointerUp.
    // Keep this as a fallback for releases that occur outside the stage.
    if (this.releaseTargetGesture(event.pointerId, releasePoint)) return
    if (
      this.draggingIndex === null ||
      this.dragReturning ||
      !this.dragMovedBeyondThreshold
    ) {
      return
    }
    const carriedEntry = this.handEntries[this.draggingIndex]
    if (carriedEntry && this.requiresSeparatePlacementClick(carriedEntry)) return
    const pointer = this.dragPointer
    const cardInstanceId = carriedEntry?.card.instanceId
    if (pointer) this.resolveCardDrop(pointer)
    if (
      cardInstanceId &&
      this.cardTargeting?.cardInstanceId === cardInstanceId &&
      pendingCardInputStage(
        this.cardTargeting.input,
        this.cardTargeting.choice,
        this.cardTargeting.targets.length
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
    this.releaseTargetGesture(event.pointerId, {
      x: event.globalX,
      y: event.globalY
    })
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
    this.cardPlacementTapGuard.clear()
    this.cardChoiceInputGate.clear()
    this.targetGestures.clear()
    this.endDrag()
    this.cancelCombatDrag()
    this.cancelHeroPowerTargeting()
    this.cancelCardTargeting()
  }
  private readonly handleWindowKeyDown = (event: KeyboardEvent): void => {
    if (this.cardTargeting) {
      if (event.key === 'Escape') {
        event.preventDefault()
        this.cancelCardTargeting()
        return
      }
      const choice = Number(event.key) - 1
      if (Number.isInteger(choice) && choice >= 0) {
        event.preventDefault()
        this.chooseCardPlayOption(choice)
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
    this.logger = options.logger ?? {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    }
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
    this.boardMinionCardPreviewLayer.label = 'game.board-minion-card-preview'
    this.boardMinionCardPreviewLayer.eventMode = 'none'
    this.addChild(this.boardMinionCardPreviewLayer)
    this.gameplayLayer.addChild(this.boardLayer)
    this.localMinionLayer.label = 'game.board-minions-local'
    this.remoteMinionLayer.label = 'game.board-minions-remote'
    this.localMinionLayer.eventMode = 'passive'
    this.remoteMinionLayer.eventMode = 'passive'
    this.localMinionLayer.sortableChildren = true
    this.remoteMinionLayer.sortableChildren = true
    this.gameplayLayer.addChild(this.localMinionLayer)
    this.gameplayLayer.addChild(this.remoteMinionLayer)
    this.weaponLayer.label = 'game.equipped-weapons'
    this.weaponLayer.eventMode = 'none'
    this.weaponLayer.sortableChildren = true
    this.gameplayLayer.addChild(this.heroPowerLayer)
    // Equipped weapons share the hero-power board depth so hand cards and
    // transient presentation layers can render above both.
    this.gameplayLayer.addChild(this.weaponLayer)
    this.heroLayer.label = 'game.heroes'
    this.heroLayer.eventMode = 'passive'
    this.heroLayer.sortableChildren = true
    this.gameplayLayer.addChild(this.openingLayer)
    this.gameplayLayer.addChild(this.heroLayer)
    this.secretZoneView = new SecretZoneView(options.gameAssets.secret)
    this.gameplayLayer.addChild(this.secretZoneView)
    this.gameplayLayer.addChild(this.deckLayer)
    this.gameplayLayer.addChild(this.turnLayer)
    this.gameplayLayer.addChild(this.mulliganLayer)
    // Dealt cards must stay above the mulligan dimmer while they travel from
    // the deck; they are reparented to their final layers after the animation.
    this.gameplayLayer.addChild(this.travelLayer)
    this.gameplayLayer.addChild(this.remoteHandLayer)
    this.gameplayLayer.addChild(this.handLayer)
    this.summonLayer.label = 'game.minion-summons'
    this.summonLayer.eventMode = 'none'
    this.summonLayer.sortableChildren = true
    this.gameplayLayer.addChild(this.summonLayer)
    // Death previews stay above the minions, but below the complete targeting
    // arrow so its body remains connected visually to the DOM cursor head.
    this.combatOverlayLayer.label = 'game.combat-overlays'
    this.combatOverlayLayer.eventMode = 'none'
    this.combatOverlayLayer.sortableChildren = true
    this.gameplayLayer.addChild(this.combatOverlayLayer)
    // Keep the Pixi arrow body above every other board layer. The cursor's
    // arrow head is rendered in the DOM above the canvas.
    this.attackLineLayer.label = 'game.attack-line-layer'
    this.attackLineLayer.eventMode = 'none'
    this.attackLineLayer.addChild(this.attackLine)
    this.gameplayLayer.addChild(this.attackLineLayer)
    this.cardChoiceLayer.label = 'game.card-choice'
    this.cardChoiceLayer.eventMode = 'passive'
    this.cardChoiceLayer.visible = false
    this.gameplayLayer.addChild(this.cardChoiceLayer)
    this.cardSelectionOverlay = new CardSelectionOverlay({
      toggleTexture: options.gameAssets.toggleViewButton,
      createSlot: (card) => this.createSlot(card),
      createHeroPowerChoice: (heroPowerId) => {
        const definition = HERO_POWER_CATALOG.require(heroPowerId)
        return new HeroPowerCardView(
          definition,
          definition.cost,
          options.gameAssets[definition.presentationAssetKey as HeroPowerAssetKey],
          options.gameAssets.discoverHistoryHeroPower
        )
      },
      onSelect: (card) => this.chooseDiscoverCard(card),
      onChooseOption: (choice) => this.chooseVisibleCardOption(choice),
      isInputBlocked: () => this.cardChoiceInputGate.blocked
    })
    this.cardSelectionOverlay.label = 'game.card-selection'
    this.gameplayLayer.addChild(this.cardSelectionOverlay)

    this.fatigueView = new FatigueView(options.gameAssets.fatigue)
    this.addChild(this.fatigueView)
    this.secretRevealView = new SecretRevealView(
      options.gameAssets.secretRevealedScreen
    )
    this.addChild(this.secretRevealView)
    this.matchResultOverlay = new MatchResultOverlay({
      winScreen: options.gameAssets.winScreen,
      defeatScreen: options.gameAssets.defeatScreen,
      onContinue: () => options.onMatchComplete?.()
    })
    this.addChild(this.matchResultOverlay)
    this.deckLayer.visible = false
    this.remoteHandLayer.visible = false
    this.handLayer.eventMode = 'none'
    this.travelLayer.sortableChildren = true
    this.deckLayer.sortableChildren = true
    this.mulliganLayer.sortableChildren = true
    this.handLayer.sortableChildren = true
    this.eventMode = 'static'
    this.hitArea = new Rectangle(0, 0, 1920, 1080)
    this.on('pointermove', (event: FederatedPointerEvent) =>
      this.handleBoardPointerMove(event)
    )
    this.on('globalpointermove', (event: FederatedPointerEvent) =>
      this.handleBoardPointerMove(event)
    )
    this.on('pointerup', this.handleBoardPointerUp)
    this.on('pointerupoutside', this.handleBoardPointerUp)
    this.on('pointerdown', (event: FederatedPointerEvent) => {
      if (event.button === 2) {
        this.cancelHeroPowerTargeting()
        this.cancelCardTargeting()
        this.deselectAttacker()
      }
    })
    this.on('pointertap', (event: FederatedPointerEvent) => {
      if (this.consumeCardPlacementTap(event)) return
      if (this.consumeTargetGestureTap(event)) return
      if (!this.selectedCombatView && !this.heroPowerTargeting && !this.cardTargeting)
        return
      if (event.button !== 0) return
      if (
        this.cardTargeting?.presentation.kind === 'minion-preview' &&
        this.cardTargeting.presentation.preview.cancelled === true
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
        this.cancelCardTargeting()
        this.deselectAttacker()
      }
    })
  }

  async mount(): Promise<void> {
    this.session =
      this.options.aiRuntime?.session ??
      new GameBoardSession({
        setup: this.options.route.setup,
        decks: this.options.decks
      })
    const remoteSetup = this.options.route.setup.participants.find(
      (participant) => participant.participantId === this.remoteParticipantId
    )
    const remoteDeck = this.options.decks.find(
      (deck) => deck.id === remoteSetup?.deckId
    )
    if (!remoteDeck) throw new Error('The AI deck is unavailable.')
    this.aiController =
      this.options.aiRuntime?.controller ??
      new AiTurnController({
        api: this.options.ai,
        session: this.session,
        decks: this.options.decks,
        logger: this.logger,
        policy: COMPETITIVE_AI_POLICY
      })
    const initialState = this.match.getState()
    this.aiMulliganResolution = this.resolveAiMulligan(
      this.aiController.chooseMulligan()
    )

    this.historyView = new MatchHistoryView(
      {
        local: this.options.gameAssets.historyLocal,
        remote: this.options.gameAssets.historyRemote,
        arrow: this.options.gameAssets.historyArrow,
        burnCard: this.options.gameAssets.historyBurnCard,
        burnThumb: this.options.gameAssets.historyBurnThumb,
        damageIndicator: this.options.gameAssets.damageIndicator,
        willDie: this.options.gameAssets.minionWillDie,
        secretCard: this.options.gameAssets.historySecretCard,
        secretThumb: this.options.gameAssets.historySecretThumb,
        fatigueCard: this.options.gameAssets.historyFatigueCard,
        fatigueThumb: this.options.gameAssets.historyFatigueThumb,
        cardBack: this.options.gameAssets.cardBack,
        heroFrames: this.options.heroAssets,
        heroPowers: this.options.gameAssets,
        heroPowerCardFrame: this.options.gameAssets.discoverHistoryHeroPower
      },
      this.localParticipantId,
      (active) => this.setHistoryBoardDesaturated(active)
    )
    this.matchBackdropLayer.addChild(this.historyView)

    this.createBoard()
    this.createHeroes(initialState)
    this.syncSecrets(initialState)
    this.createHeroPowers(initialState)
    this.createDecks()
    this.createOpeningLayer(initialState)
    this.createMulliganLayer()
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

    this.confirmButton = new Button(this.options.gameAssets.confirmMulliganButton, {
      onClick: () => void this.confirmMulligan()
    })
    applyPlacement(this.confirmButton, GAME_BOARD_LAYOUT.mulligan.confirmButton)
    this.confirmButton.setBaseY(GAME_BOARD_LAYOUT.mulligan.confirmButton.position.y)
    this.confirmButton.visible = false
    this.confirmButton.setEnabled(false)
    this.mulliganLayer.addChild(this.confirmButton)
  }

  async playOpeningReveal(): Promise<void> {
    if (this.openingRevealStarted) return
    this.openingRevealStarted = true
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
    this.deckLayer.visible = true
    this.remoteHandLayer.visible = true
    await this.wait(OPENING_TIMING.boardPause)
    await this.presentMulligan()
  }

  private createBoard(): void {
    const table = new Sprite(this.options.gameAssets.table)
    table.eventMode = 'none'
    this.boardLayer.addChild(table)
    const board = new Sprite(this.options.gameAssets.board)
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
        frontFrameTexture: this.options.gameAssets.heroPowerFront,
        artworkTexture,
        manaTexture: this.options.gameAssets.heroPowerMana,
        cost: player.heroPower.cost,
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
      deck.eventMode = 'none'
      this.deckViews.set(participantId, deck)
      this.deckLayer.addChild(deck)
    }
  }

  /** Builds the end turn button and the deck card-count labels (hidden for now). */
  private createTurnControls(state: OpeningMatchState): void {
    this.hud.mount(this.options.gameAssets, () => void this.endTurn())
    this.addChild(this.hud.deckTracker)
    this.syncTurnHud(state)
  }

  /** Refreshes both deck card-count labels from the engine state. */
  private syncDeckCounts(state: OpeningMatchState): void {
    for (const player of state.players) {
      const deck = this.deckViews.get(player.participantId)
      if (deck) deck.visible = player.deck.length > 0
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
      this.draggingIndex === null ? undefined : this.handEntries[this.draggingIndex]
    const hoveredEntry = this.localHoveredSlot
      ? this.handEntries.find((entry) => entry.slot === this.localHoveredSlot)
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
  private syncTurnHud(state: OpeningMatchState): void {
    this.syncMatchCursor(state)
    this.syncDeckCounts(state)
    this.syncMana(state)
    this.syncLocalHandCardCosts(state)
    this.syncPlayableCardOutlines()
    this.syncHeroPowerViews(state)
    this.syncWeaponViews(state)
    this.syncBoardAttackability(state)
    this.updateDeckTracker(state)
  }

  /** Keeps rendered hand costs and tints derived from the authoritative state. */
  private syncLocalHandCardCosts(state: OpeningMatchState): void {
    const player = this.findPlayer(state, this.localParticipantId)
    for (const entry of this.handEntries) {
      const card = player.hand.find(
        (candidate) => candidate.instanceId === entry.card.instanceId
      )
      if (!card) continue
      entry.card = cloneCard(card)
      const definition = cardDefinition(card)
      const baseCost = card.baseCost ?? definition.cost
      const currentCost = card.currentCost ?? baseCost
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
      view.removeFromParent()
      view.destroy({ children: true })
      this.weaponViews.delete(player.participantId)
    }
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
          !this.cardTargeting &&
          legality?.legalHeroPower === true
      )
    }
  }

  private async useHeroPower(): Promise<void> {
    if (
      this.turnInProgress ||
      this.combatInProgress ||
      this.cardPlayInProgress ||
      this.cardTargeting
    )
      return
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
      this.clearHandHover()
      this.heroPowerTargeting = true
      this.hideBoardMinionCardPreview()
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
    if (this.cardPlayInProgress || this.cardTargeting) return
    this.cardPlayInProgress = true
    const result = this.session.dispatch({
      type: 'use-hero-power',
      participantId: this.localParticipantId,
      ...(target ? { target } : {})
    })
    if (!result.accepted) {
      this.logger.error(result.message)
      this.heroPowerViews.get(this.localParticipantId)?.playUnavailable()
      this.cardPlayInProgress = false
      this.cancelHeroPowerTargeting()
      this.syncTurnHud(this.match.getState())
      this.syncTurnControls(this.match.getState())
      return
    }
    this.cancelHeroPowerTargeting()
    this.syncTurnHud(result.state)
    try {
      await this.presentResolutionEvents(result.events)
    } finally {
      this.cardPlayInProgress = false
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

  private cardTargetKey(target: CardPlayTargetRef): string {
    return target.kind === 'hero'
      ? 'hero:' + target.participantId
      : target.kind + ':' + target.instanceId
  }

  private cardTargetRef(view: CombatView): CardPlayTargetRef | null {
    if (!view.ownerId) return null
    if (view instanceof HeroView)
      return { kind: 'hero', participantId: view.ownerId as PlayerId }
    if (!view.instanceId) return null
    return {
      kind: 'minion',
      participantId: view.ownerId as PlayerId,
      instanceId: view.instanceId
    }
  }

  private minionTargetPreview(
    targeting: CardPlayTargetingState | null = this.cardTargeting
  ): PendingMinionTargetPreview | null {
    return targeting?.presentation.kind === 'minion-preview'
      ? targeting.presentation.preview
      : null
  }

  private beginClickedCardTargeting(cardInstanceId: string): void {
    if (this.cardTargeting || this.cardPlayInProgress) return
    const entry = this.handEntries.find(
      (candidate) => candidate.card.instanceId === cardInstanceId
    )
    if (!entry || cardDefinition(entry.card).type === 'Minion') return
    const input = this.match.getPlayInput?.(this.localParticipantId, cardInstanceId)
    if (!input || !allowsDragTargetingFromHand(cardDefinition(entry.card).type, input))
      return
    this.beginCardTargeting(entry, input)
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
      !this.cardTargeting ||
      this.cardTargeting.cardInstanceId !== source.cardInstanceId
    )
      return
    if (this.commitCardTargetAt(pointer)) return
    if (
      pendingCardInputStage(
        this.cardTargeting.input,
        this.cardTargeting.choice,
        this.cardTargeting.targets.length
      ) === 'choice'
    )
      return
    this.cancelCardTargeting(pointer)
  }

  private isValidCardTarget(view: CombatView): boolean {
    const targeting = this.cardTargeting
    if (!targeting) return false
    if (
      targeting.presentation.kind === 'minion-preview' &&
      targeting.presentation.preview.cancelled === true
    )
      return false
    if (
      pendingCardInputStage(
        targeting.input,
        targeting.choice,
        targeting.targets.length
      ) !== 'target'
    )
      return false
    const target = this.cardTargetRef(view)
    if (!target) return false
    const options = targeting.input.legalTargetOptions[targeting.targets.length] ?? []
    const key = this.cardTargetKey(target)
    if (targeting.targets.some((selected) => this.cardTargetKey(selected) === key))
      return false
    return options.some((candidate) => this.cardTargetKey(candidate) === key)
  }

  private clearCardChoiceOverlay(): void {
    const children = this.cardChoiceLayer.removeChildren()
    for (const child of children) child.destroy({ children: true })
    this.cardChoiceLayer.visible = false
    this.cardSelectionOverlay.clear()
  }

  private showCardChoiceOverlay(input: PlayCardInput): void {
    if (input.choiceOptions.length === 0) return
    void this.cardSelectionOverlay
      .showChoices(
        this.localParticipantId,
        input.cardInstanceId,
        input.cardId,
        input.choiceOptions
      )
      .catch((error: unknown) => {
        this.logger.error('[GameBoardView] failed to present card choices', error)
        this.cancelCardTargeting()
      })
  }
  private beginCardTargeting(
    entry: HandEntry,
    input: PlayCardInput,
    position?: number,
    arrowOriginHint: HandCardTargetingOrigin = 'card'
  ): void {
    const hasRenderableTarget =
      input.choiceCount > 0 ||
      input.targetSelectors.length === 0 ||
      input.legalTargetOptions[0]?.some(
        (target) => target.kind === 'hero' || target.kind === 'minion'
      ) === true
    if (!hasRenderableTarget) {
      this.logger.warn(
        '[GameBoardView] no renderer target adapter for ' +
          entry.card.cardId +
          '; returning card'
      )
      this.endDrag()
      return
    }

    const isMinionTargetPreview =
      arrowOriginHint === 'card' &&
      cardDefinition(entry.card).type === 'Minion' &&
      input.targetSelectors.length > 0 &&
      position !== undefined
    const previewResting = isMinionTargetPreview
      ? layoutBoardRow(this.localMinionViews.length + 1, this.localBoardRowConfig())[
          position!
        ]
      : undefined
    const minionPreview: PendingMinionTargetPreview | undefined = isMinionTargetPreview
      ? {
          entry,
          position: position!,
          targetingOrigin: {
            x: previewResting!.x,
            y: previewResting!.y
          },
          cancelled: false,
          ready: false,
          presentation: null,
          presentationPromise: null,
          reversePromise: null,
          rays: null,
          activeTimelines: new Set()
        }
      : undefined
    const targeting: CardPlayTargetingState = {
      cardInstanceId: entry.card.instanceId,
      input,
      targets: [],
      arrowOrigin: minionPreview
        ? 'minion-preview'
        : resolveHandCardArrowOrigin(cardDefinition(entry.card).type, arrowOriginHint),
      presentation: minionPreview
        ? { kind: 'minion-preview', preview: minionPreview }
        : { kind: 'hidden-hand-card' },
      ...(position === undefined ? {} : { position })
    }
    this.cardTargeting = targeting
    this.clearHandHover()
    this.hideBoardMinionCardPreview()
    this.deselectAttacker()
    this.cancelHeroPowerTargeting()
    if (pendingCardInputStage(input, undefined) === 'choice') {
      this.attackLine.clear()
      this.options.cursor?.setTargeting(false)
      this.options.cursor?.setTargetingTarget(null)
      this.showCardChoiceOverlay(input)
      this.hideHandCardForPendingPlay(entry)
      this.syncBoardAttackability(this.match.getState())
      this.syncTurnControls(this.match.getState())
      return
    }

    if (minionPreview) {
      this.beginMinionTargetPreview(targeting)
      return
    }

    this.options.cursor?.setTargeting(true)
    if (this.options.gameAssets.arrowBody) {
      this.attackLine.setBodyTexture(this.options.gameAssets.arrowBody)
    }
    this.syncBoardAttackability(this.match.getState())
    this.syncTurnControls(this.match.getState())
    // The pending presentation is renderer-only; the command is not dispatched
    // until every required target/choice has been collected.
    this.hideHandCardForPendingPlay(entry)
  }

  private beginMinionTargetPreview(targeting: CardPlayTargetingState): void {
    const preview = this.minionTargetPreview(targeting)
    if (!preview) return

    this.cardPlayInProgress = true
    this.releaseDraggedCardForTargeting(preview.entry)
    this.localBoardPreviewIndex = preview.position
    this.applyLocalBoardLayout(preview.position)
    this.options.cursor?.setTargeting(true)
    if (this.options.gameAssets.arrowBody) {
      this.attackLine.setBodyTexture(this.options.gameAssets.arrowBody)
    }
    this.syncBoardAttackability(this.match.getState())
    this.syncTurnControls(this.match.getState())

    const previewEvent = this.createMinionTargetPreviewEvent(
      preview.entry,
      preview.position
    )
    const presentationPromise = this.presentMinionPlayed(
      previewEvent,
      preview.entry.slot,
      false,
      true,
      preview
    ).then((presentation) => {
      preview.presentation = presentation
      return presentation
    })

    preview.presentationPromise = presentationPromise.catch((error: unknown) => {
      this.logger.error('[GameBoardView] minion target preview failed', error)
      return null
    })

    void preview.presentationPromise.then((presentation) => {
      if (this.minionTargetPreview() !== preview || preview.cancelled) {
        void this.reverseMinionTargetPreview(preview)
        return
      }
      if (!presentation) {
        this.cancelCardTargeting()
        return
      }
      preview.ready = true
      this.cardPlayInProgress = false
      this.syncBoardAttackability(this.match.getState())
      this.syncTurnControls(this.match.getState())
      const currentTargeting = this.cardTargeting
      if (
        currentTargeting &&
        pendingCardInputStage(
          currentTargeting.input,
          currentTargeting.choice,
          currentTargeting.targets.length
        ) === 'ready'
      ) {
        this.commitPendingCardPlay()
      }
    })
  }

  private releaseDraggedCardForTargeting(entry: HandEntry): void {
    if (this.dragTick) gsap.ticker.remove(this.dragTick)
    this.dragTick = null
    this.dragPerspective?.destroy()
    this.dragPerspective = null
    this.draggingIndex = null
    this.dragPointer = null
    this.dragStartPointer = null
    this.dragMovedBeyondThreshold = false
    this.dragState = null
    this.localHoveredSlot = null
    entry.displaced = false
    entry.slot.suppressPlayableOutline(true)
    this.options.cursor?.setContextVariant(null)
    this.clearLocalBoardPreview()
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
      attack: definition.attack,
      health: definition.health,
      maxHealth: definition.health,
      summonedOnTurn: this.match.getState().turnNumber,
      lastAttackedOnTurn: null,
      ownerId: this.localParticipantId,
      controllerId: this.localParticipantId,
      creationOrdinal: entry.card.creationOrdinal,
      baseAttack: definition.attack,
      baseHealth: definition.health,
      keywords,
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

  private hideHandCardForPendingPlay(entry: HandEntry): void {
    entry.slot.visible = false
    if (this.dragTick) gsap.ticker.remove(this.dragTick)
    this.dragTick = null
    this.dragPerspective?.destroy()
    this.dragPerspective = null
    this.draggingIndex = null
    this.dragPointer = null
    this.dragStartPointer = null
    this.dragMovedBeyondThreshold = false
    this.dragState = null
    this.localHoveredSlot = null
    this.options.cursor?.setContextVariant(null)
    this.clearLocalBoardPreview()
  }

  private cancelCardTargeting(pointer?: HandPointer): void {
    this.targetGestures.cancel((source) => source.kind === 'card')
    this.clearCardChoiceOverlay()
    const targeting = this.cardTargeting
    if (!targeting) return
    this.attackLine.clear()
    this.options.cursor?.setTargeting(false)
    if (targeting.presentation.kind === 'minion-preview') {
      const preview = targeting.presentation.preview
      preview.cancelled = true
      this.cardTargeting = null
      this.cardPlayInProgress = true
      this.reflowing = true
      this.lastTargetingPointer = null
      if (this.session) {
        this.syncBoardAttackability(this.match.getState())
        this.syncTurnControls(this.match.getState())
      }
      void this.reverseMinionTargetPreview(preview).catch((error: unknown) => {
        this.logger.error(
          '[GameBoardView] minion target preview reversal failed',
          error
        )
      })
      return
    }
    this.cardTargeting = null
    if (targeting.presentation.kind === 'hidden-hand-card') {
      const entry = this.handEntries.find(
        (candidate) => candidate.card.instanceId === targeting.cardInstanceId
      )
      const returnTo = pointer ?? this.lastTargetingPointer
      if (entry?.restTransform) {
        entry.slot.visible = true
        if (returnTo) {
          entry.slot.position.set(returnTo.x, returnTo.y)
          entry.slot.rotation = 0
          entry.slot.scale.set(DEFAULT_HAND_DRAG.dragScale)
        }
        this.dragReturning = true
        void this.animateSlotToHand(
          entry.slot,
          entry.restTransform,
          0,
          OPENING_TIMING.hover,
          OPENING_TIMING.hover
        ).then(() => {
          entry.slot.suppressPlayableOutline(false)
          entry.displaced = false
          this.dragReturning = false
        })
      } else if (entry) {
        entry.slot.visible = true
        entry.slot.suppressPlayableOutline(false)
      }
    }
    this.lastTargetingPointer = null
    if (this.session) {
      this.syncBoardAttackability(this.match.getState())
      this.syncTurnControls(this.match.getState())
    }
  }

  /** Prevents a previously lifted hand card from remaining active during targeting. */
  private clearHandHover(): void {
    if (this.localHoveredSlot === null) return
    this.localHoveredSlot = null
    if (this.draggingIndex === null) this.applyHoverDelta()
  }

  private reverseMinionTargetPreview(
    preview: PendingMinionTargetPreview
  ): Promise<void> {
    if (preview.reversePromise) return preview.reversePromise
    preview.reversePromise = (async () => {
      try {
        this.stopMinionTargetPreviewPresentation(preview)
        await this.returnMinionTargetCardToHand(preview.entry)
      } catch (error) {
        this.logger.error(
          '[GameBoardView] minion target preview reversal failed',
          error
        )
        await this.returnMinionTargetCardToHand(preview.entry)
      } finally {
        this.activeSummonSlots.delete(preview.entry.slot)
        if (this.minionTargetPreview() === preview) this.cardTargeting = null
        if (this.localBoardPreviewIndex === preview.position) {
          this.localBoardPreviewIndex = null
          this.applyLocalBoardLayout()
        }
        this.cardPlayInProgress = false
        this.reflowing = false
        if (!this.destroyed) {
          this.activateHandHover()
          this.syncTurnHud(this.match.getState())
          this.syncTurnControls(this.match.getState())
        }
      }
    })()
    return preview.reversePromise
  }

  private stopMinionTargetPreviewPresentation(
    preview: PendingMinionTargetPreview
  ): void {
    for (const timeline of preview.activeTimelines) timeline.kill()
    preview.activeTimelines.clear()

    if (preview.rays && !preview.rays.destroyed) preview.rays.destroy()
    preview.rays = null

    const presentation = preview.presentation
    preview.presentation = null
    if (presentation && !presentation.view.destroyed) {
      presentation.view.setTargetable(false)
      presentation.view.setTargetingOutline(false)
      presentation.view.removeFromParent()
      presentation.view.destroy({ children: true })
    }
  }

  private returnMinionTargetCardToHand(entry: HandEntry): Promise<void> {
    const slot = entry.slot
    if (slot.destroyed) return Promise.resolve()
    this.resetSummonCardAppearance(slot.card)
    slot.setSummonGlowStrength(1)
    slot.visible = true

    const global = slot.parent ? slot.getGlobalPosition() : null
    if (slot.parent !== this.handLayer) {
      this.handLayer.addChild(slot)
      if (global) {
        const local = this.handLayer.toLocal(global)
        slot.position.set(local.x, local.y)
      }
    }
    this.configureHandSlot(slot)
    slot.suppressPlayableOutline(false)
    entry.displaced = false
    if (entry.restTransform) {
      gsap.killTweensOf(slot)
      gsap.killTweensOf(slot.scale)
      gsap.killTweensOf(slot.skew)
      slot.position.set(entry.restTransform.x, entry.restTransform.y)
      slot.rotation = entry.restTransform.rotation
      slot.scale.set(entry.restTransform.scale)
      slot.skew.set(0)
      slot.alpha = 1
      slot.zIndex = entry.restTransform.zIndex
    } else {
      slot.alpha = 1
    }
    return Promise.resolve()
  }

  private chooseDiscoverCard(card: OpeningCard): void {
    const result = this.session.dispatch({
      type: 'choose-discover-card',
      participantId: this.localParticipantId,
      cardInstanceId: card.instanceId
    })
    if (!result.accepted) {
      this.logger.error(result.message)
      this.cardSelectionOverlay.clear()
      return
    }
    void this.presentResolutionEvents(result.events)
  }

  private chooseVisibleCardOption(choice: number): void {
    if (this.cardTargeting) {
      this.chooseCardPlayOption(choice)
      return
    }
    const pending = this.match.getState().pendingCardChoice
    if (!pending || pending.participantId !== this.localParticipantId) return
    const result = this.session.dispatch({
      type: 'choose-card-option',
      participantId: this.localParticipantId,
      sourceCardInstanceId: pending.sourceCardInstanceId,
      choice
    })
    if (!result.accepted) {
      this.logger.error(result.message)
      this.cardSelectionOverlay.clear()
      return
    }
    this.cardSelectionOverlay.clear()
    void this.presentResolutionEvents(result.events).finally(() => {
      this.syncTurnHud(this.match.getState())
      this.syncTurnControls(this.match.getState())
    })
  }
  private commitCardTarget(view: CombatView): void {
    if (!this.cardTargeting || !this.isValidCardTarget(view)) return
    const target = this.cardTargetRef(view)
    if (!target) return
    this.cardTargeting.targets.push(target)
    const { input, targets, choice } = this.cardTargeting
    if (pendingCardInputStage(input, choice, targets.length) === 'ready') {
      this.commitPendingCardPlay()
      return
    }
    this.syncBoardAttackability(this.match.getState())
  }

  private commitCardTargetAt(pointer: HandPointer): boolean {
    this.lastTargetingPointer = pointer
    const target = this.findTargetableCharacterAt(pointer.x, pointer.y)
    if (!target || !this.isValidCardTarget(target)) return false
    this.commitCardTarget(target)
    return true
  }

  private findTargetableCharacterAt(x: number, y: number): CombatView | null {
    const pendingPreview = this.minionTargetPreview()?.presentation
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

  private chooseCardPlayOption(choice: number): void {
    const targeting = this.cardTargeting
    if (!targeting || !targeting.input.legalChoices.includes(choice)) return
    this.cardSelectionOverlay.clear()
    const input = this.match.getPlayInput?.(
      this.localParticipantId,
      targeting.cardInstanceId,
      choice
    )
    if (!input) {
      this.cancelCardTargeting()
      return
    }
    this.cardTargeting = {
      ...targeting,
      input,
      targets: [],
      choice
    }
    if (input.targetSelectors.length > 0) {
      this.options.cursor?.setTargeting(true)
      if (this.options.gameAssets.arrowBody)
        this.attackLine.setBodyTexture(this.options.gameAssets.arrowBody)
    }
    this.syncBoardAttackability(this.match.getState())
    this.syncTurnControls(this.match.getState())
    if (pendingCardInputStage(input, choice) === 'ready') this.commitPendingCardPlay()
  }

  private commitPendingCardPlay(): void {
    const targeting = this.cardTargeting
    if (!targeting || this.dragReturning || this.cardPlayInProgress) return
    if (
      pendingCardInputStage(
        targeting.input,
        targeting.choice,
        targeting.targets.length
      ) !== 'ready'
    )
      return

    const index = this.handEntries.findIndex(
      (entry) => entry.card.instanceId === targeting.cardInstanceId
    )
    const entry = index >= 0 ? this.handEntries[index] : undefined
    if (!entry) {
      this.cancelCardTargeting()
      return
    }
    const legality = this.match.getLegality?.(this.localParticipantId)
    if (!legality?.playableCardInstanceIds.includes(targeting.cardInstanceId)) {
      this.cancelCardTargeting()
      return
    }

    const minionPreview = this.minionTargetPreview(targeting)?.presentation ?? undefined

    const result = this.session.dispatch({
      type: 'play-card',
      participantId: this.localParticipantId,
      cardInstanceId: targeting.cardInstanceId,
      ...(targeting.position === undefined ? {} : { position: targeting.position }),
      ...(targeting.targets.length === 0 ? {} : { targets: targeting.targets }),
      ...(targeting.choice === undefined ? {} : { choice: targeting.choice })
    })
    if (!result.accepted) {
      this.logger.error(result.message)
      this.cancelCardTargeting()
      this.syncTurnHud(this.match.getState())
      return
    }

    this.cardTargeting = null
    this.attackLine.clear()
    this.lastTargetingPointer = null
    this.options.cursor?.setTargeting(false)
    this.cardPlayInProgress = true
    this.reflowing = true
    this.syncTurnHud(result.state)
    const definition = cardDefinition(entry.card)
    if (definition.type === 'Minion') {
      if (!minionPreview) entry.slot.beginSummonGhost()
      this.localBoardPreviewIndex = targeting.position ?? null
      this.applyLocalBoardLayout(this.localBoardPreviewIndex)
      void this.presentAcceptedMinionPlay(index, entry, result, minionPreview)
    } else if (definition.type === 'Weapon') {
      void this.presentAcceptedWeaponPlay(index, entry, result)
    } else if (definition.type === 'Hero') {
      void this.presentAcceptedHeroPlay(index, entry, result)
    } else {
      void this.presentAcceptedSpellPlay(index, entry, result)
    }
  }

  /** Shows playable cards, with yellow reserved for active conditional bonuses. */
  private syncPlayableCardOutlines(): void {
    const playableCardInstanceIds = new Set(
      this.match.getLegality?.(this.localParticipantId)?.playableCardInstanceIds ?? []
    )
    const draggingEntry =
      this.draggingIndex === null ? undefined : this.handEntries[this.draggingIndex]

    for (const entry of this.handEntries) {
      const canPlay = playableCardInstanceIds.has(entry.card.instanceId)
      const effectPreview = this.match.getPlayInput?.(
        this.localParticipantId,
        entry.card.instanceId
      )?.effectPreview
      entry.slot.setPlayableOutlineEnabled(canPlay)
      entry.slot.setPlayableOutlineEnhanced(
        effectPreview?.conditionallyEnhanced === true
      )
      if (entry === draggingEntry) {
        this.dragPerspective?.setOutlineEnabled(canPlay)
      }
    }
  }

  /** Reflects whose turn it is in the end turn button's texture and enabled state. */
  private syncTurnControls(state: OpeningMatchState): void {
    this.syncMatchCursor(state)
    const endTurnButton = this.hud.endTurnButton
    if (!endTurnButton) return
    const isLocalTurn = state.activePlayerId === this.localParticipantId
    const localTurnTexture = isLocalTurn
      ? this.options.gameAssets.endTurn
      : this.options.gameAssets.enemyTurn
    const inputEnabled =
      isLocalTurn &&
      !this.turnInProgress &&
      !this.combatInProgress &&
      !this.cardPlayInProgress &&
      !this.heroPowerTargeting &&
      !this.cardTargeting
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
    this.turnInProgress = true
    this.cardPlayInProgress = false
    this.endDrag()
    this.cancelHeroPowerTargeting()
    this.cancelCardTargeting()
    this.deselectAttacker()
    clearMatchResultCombatViews([
      ...this.heroViews.values(),
      ...this.localMinionViews,
      ...this.remoteMinionViews
    ])
    this.setMulliganInputEnabled(false)
    this.confirmButton?.setEnabled(false)
    this.handLayer.eventMode = 'none'
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
      .then(() => this.options.onMatchEnded?.(event))
      .catch((error) => {
        this.logger.warn('Failed to handle match completion.', error)
      })
    await this.matchResultPending
    this.showMatchResult(event.winnerId)
  }

  private setHeroHealthVisible(visible: boolean): void {
    for (const hero of this.heroViews.values()) hero.setHealthVisible(visible)
  }

  /** Updates attacker-ready visuals and target input from authoritative state. */
  private syncBoardAttackability(state: OpeningMatchState): void {
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
    this.syncPendingMinionTargetPreview()
  }

  /** Makes the summoned-but-uncommitted minion selectable when it is legal. */
  private syncPendingMinionTargetPreview(): void {
    const preview = this.minionTargetPreview()?.presentation
    if (!preview) return
    const targetable = this.isValidCardTarget(preview.view)
    preview.view.setTargetable(targetable)
    preview.view.setTargetingOutline(targetable)
  }

  private syncHeroAttackability(state: OpeningMatchState, ownerId: PlayerId): void {
    const player = this.findPlayer(state, ownerId)
    const view = this.heroViews.get(ownerId)
    if (!view) return
    const displayedAttack = state.activePlayerId === ownerId ? getHeroAttack(player) : 0
    view.setStats(displayedAttack, player.hero.health, player.hero.armor)
    view.setFrozen(isFrozen(player.hero.frozenUntilTurn, state.turnNumber))
    view.setImmune(player.hero.immune === true)
    const heroAttackerId = `${ownerId}:hero`
    const showCanAttack =
      ownerId === this.localParticipantId &&
      this.match.getLegality?.(this.localParticipantId).legalAttackTargets[
        heroAttackerId
      ] !== undefined
    view.setCanAttack(showCanAttack)
    view.setTargetable(
      this.cardTargeting
        ? this.isValidCardTarget(view)
        : this.heroPowerTargeting
          ? this.isValidHeroPowerTarget(view)
          : showCanAttack || this.isValidCombatTarget(view)
    )
    view.setTargetingOutline(
      this.cardTargeting
        ? this.isValidCardTarget(view)
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
      if (!minion) continue
      const canAttack =
        ownerId === this.localParticipantId &&
        this.match
          .getLegality?.(this.localParticipantId)
          .legalAttackerInstanceIds.includes(instanceId) === true
      const sleeping = isBoardMinionSleeping(minion as BoardMinion, state.turnNumber)
      // Local player never sees the opponent's attack-ready outline.
      const showCanAttack = canAttack && ownerId === this.localParticipantId
      view.setCanAttack(showCanAttack)
      view.setTargetable(
        this.cardTargeting
          ? this.isValidCardTarget(view)
          : this.heroPowerTargeting
            ? this.isValidHeroPowerTarget(view)
            : showCanAttack || this.isValidCombatTarget(view)
      )
      view.setTargetingOutline(
        this.cardTargeting
          ? this.isValidCardTarget(view)
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

  /** Opens only friendly attacker selection once the current attack visibly lands. */
  private unlockCombatAttackerSelection(): void {
    if (!this.combatInProgress) return
    this.combatAttackerSelectionUnlocked = true
    this.syncBoardAttackability(this.match.getState())
  }

  private selectAttacker(view: CombatView, toggleSelected = true): void {
    if (
      !canSelectCombatAttacker(
        this.combatInProgress,
        this.combatAttackerSelectionUnlocked
      )
    )
      return
    if (!view.isCanAttack()) return
    if (this.selectedCombatView === view) {
      if (toggleSelected) this.deselectAttacker()
      return
    }
    this.clearCombatPreview()
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
    this.clearHandHover()
    this.hideBoardMinionCardPreview()
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
    if (clearPreview) this.clearCombatPreview()
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
      } else {
        this.killTweensOf(view)
        view.y += 12
      }
      view.zIndex = 0
    }
    this.selectedCombatView = null
    this.attackLine.clear()
    this.options.cursor?.setTargeting(false)
    if (!this.combatInProgress) this.syncBoardAttackability(this.match.getState())
  }

  private handleBoardPointerMove(event: FederatedPointerEvent): void {
    if (this.matchResultShown) return
    const canvasBounds = this.options.renderer.canvas.getBoundingClientRect()
    this.options.cursor?.setTargetingVisualScale(
      Math.min(canvasBounds.width / GAME_WIDTH, canvasBounds.height / GAME_HEIGHT)
    )
    this.updateTargetGesture(event)
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
    if (this.cardTargeting) {
      const targeting = this.cardTargeting
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
      this.lastTargetingPointer = { x: event.globalX, y: event.globalY }
      const target = this.findTargetCharacter(event)
      const entry = this.handEntries.find(
        (candidate) => candidate.card.instanceId === targeting.cardInstanceId
      )
      const arrowOrigin = targeting.arrowOrigin
      const pendingPreview = this.minionTargetPreview(targeting)
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
      if (!this.combatInProgress) this.clearCombatPreview()
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
  private findTargetCharacter(event: FederatedPointerEvent): CombatView | null {
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
      this.cardTargeting ||
      this.cardPlayInProgress ||
      !canSelectCombatAttacker(
        this.combatInProgress,
        this.combatAttackerSelectionUnlocked
      ) ||
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
  private updateTargetGesture(event: FederatedPointerEvent): void {
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
    const canvas = this.options.renderer.canvas
    const bounds = canvas.getBoundingClientRect()
    return {
      x: bounds.left + (x / this.options.renderer.width) * bounds.width,
      y: bounds.top + (y / this.options.renderer.height) * bounds.height
    }
  }

  /** Converts a fixed-position CSS point back into the renderer coordinate space. */
  private toRendererPoint(x: number, y: number): { x: number; y: number } {
    const canvas = this.options.renderer.canvas
    const bounds = canvas.getBoundingClientRect()
    return {
      x: ((x - bounds.left) / bounds.width) * this.options.renderer.width,
      y: ((y - bounds.top) / bounds.height) * this.options.renderer.height
    }
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
        (effect.kind === 'damage-enemy-hero' && this.heroPowerTargeting)
        ? effect.amount
        : null
    )
  }

  /** Reuses the will-die marker for any direct-damage targeting source. */
  private updateDamagePreview(target: CombatView | null, damage: number | null): void {
    if (!target || damage === null || damage <= 0 || !target.ownerId) {
      this.syncCombatPreviewMarkers([])
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
    this.syncCombatPreviewMarkers(
      health !== undefined && health <= damage ? [target] : []
    )
  }

  /** Shows the lethal marker(s) for the currently hovered combat target. */
  private updateCombatPreview(target: CombatView | null): void {
    const attacker = this.selectedCombatView
    if (!attacker || !target || target.ownerId !== this.remoteParticipantId) {
      this.syncCombatPreviewMarkers([])
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
      this.syncCombatPreviewMarkers([])
      return
    }
    if (target instanceof MinionView && !defenderMinion) {
      this.syncCombatPreviewMarkers([])
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
    this.syncCombatPreviewMarkers(lethalViews)
  }

  private syncCombatPreviewMarkers(lethalViews: readonly CombatView[]): void {
    const desired = new Set(lethalViews)
    for (const [view, marker] of this.combatPreviewMarkers) {
      if (desired.has(view)) continue
      if (!marker.destroyed) {
        marker.removeFromParent()
        marker.destroy()
      }
      this.combatPreviewMarkers.delete(view)
    }
    for (const view of desired) {
      if (!this.combatPreviewMarkers.has(view)) {
        this.combatPreviewMarkers.set(view, this.createDeathMarker(view))
      }
    }
    this.updateCombatMarkerPositions()
  }

  private updateCombatMarkerPositions(): void {
    for (const [view, marker] of this.combatPreviewMarkers) {
      if (view.destroyed || !view.parent || marker.destroyed) {
        if (!marker.destroyed) {
          marker.removeFromParent()
          marker.destroy()
        }
        this.combatPreviewMarkers.delete(view)
        continue
      }
      this.positionDeathMarker(marker, view)
    }
  }

  private clearCombatPreview(): void {
    for (const marker of this.combatPreviewMarkers.values()) {
      if (!marker.destroyed) {
        marker.removeFromParent()
        marker.destroy()
      }
    }
    this.combatPreviewMarkers.clear()
  }

  private characterRef(view: CombatView): AttackCharacterRef | null {
    if (view instanceof HeroView) return { kind: 'hero' }
    return view.instanceId ? { kind: 'minion', instanceId: view.instanceId } : null
  }

  /** Dispatches an attack against the clicked opposing character. */
  private async attackCharacter(target: CombatView): Promise<void> {
    const attacker = this.selectedCombatView
    if (!canCommitCombatAttack(this.combatInProgress) || !attacker) return
    if (target.ownerId !== this.remoteParticipantId) return

    const attackerRef = this.characterRef(attacker)
    const defenderRef = this.characterRef(target)
    if (!attackerRef || !defenderRef) return

    // The target click can arrive before a pointermove in the same frame; make
    // sure the lethal preview exists before committing the command.
    this.updateCombatPreview(target)
    this.combatInProgress = true
    this.combatAttackerSelectionUnlocked = false
    this.deselectAttacker(false, false)
    const result = this.session.dispatch({
      type: 'attack-character',
      participantId: this.localParticipantId,
      attacker: attackerRef,
      defender: defenderRef
    })
    if (!result.accepted) {
      this.logger.error(result.message)
      this.combatInProgress = false
      this.combatAttackerSelectionUnlocked = false
      this.clearCombatPreview()
      this.syncTurnHud(this.match.getState())
      this.syncTurnControls(this.match.getState())
      return
    }

    // The lethal marker is only a targeting preview. Remove it as soon as the
    // attack commits, before the combat wind-up starts.
    this.clearCombatPreview()
    this.syncTurnHud(result.state)
    this.syncTurnControls(result.state)
    try {
      await this.presentResolutionEvents(result.events)
    } finally {
      this.combatInProgress = false
      this.combatAttackerSelectionUnlocked = false
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
      this.combatInProgress ||
      this.cardPlayInProgress ||
      this.heroPowerTargeting ||
      this.cardTargeting
    )
      return
    this.turnInProgress = true
    this.hud.endTurnButton?.setEnabled(false)
    const result = this.session.dispatch({
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
    await this.presentResolutionEvents(result.events)
  }

  /**
   * Runs one model decision after each fully resolved engine command. The next
   * request starts while the previous action is being presented, but its command
   * is never dispatched until presentation is idle and its state revision still
   * matches. This keeps random generation and trigger chains authoritative while
   * hiding most endpoint latency behind animations.
   */
  private async scheduleAiTurn(): Promise<void> {
    if (this.aiTurnRunning) return
    this.aiTurnRunning = true
    try {
      await this.wait(TURN_TIMING.aiTurnDelay)
      if (this.match.getState().activePlayerId !== this.remoteParticipantId) return
      let decisionPromise = this.aiController.chooseTurnAction()
      await this.waitForResolutionIdle()
      if (!this.turnLayer.visible || this.destroyed) return

      let acceptedActions = 0
      let rejectedActions = 0
      while (!this.destroyed) {
        const state = this.match.getState()
        if (
          state.phase !== 'turns' ||
          state.activePlayerId !== this.remoteParticipantId
        )
          return
        if (acceptedActions >= 64) {
          this.logger.warn('[Game AI] action safety limit reached; ending turn')
          const result = this.session.dispatch({
            type: 'end-turn',
            participantId: this.remoteParticipantId
          })
          if (result.accepted) {
            this.syncTurnHud(result.state)
            await this.presentResolutionEvents(result.events)
          }
          return
        }

        const decision = await decisionPromise
        if (this.destroyed) return
        if (decision.expectedRevision !== this.match.getState().revision) {
          this.logger.warn('[Game AI] discarded stale decision', decision)
          decisionPromise = this.aiController.chooseTurnAction()
          continue
        }

        const remoteBackCountBefore = this.remoteBackCount
        const result = this.session.dispatch(decision.command)
        if (!result.accepted) {
          rejectedActions += 1
          this.logger.error('[Game AI] engine rejected selected action', {
            decision,
            code: result.code,
            message: result.message
          })
          if (rejectedActions >= 2) {
            const endResult = this.session.dispatch({
              type: 'end-turn',
              participantId: this.remoteParticipantId
            })
            if (endResult.accepted) {
              this.syncTurnHud(endResult.state)
              await this.presentResolutionEvents(endResult.events)
            }
            return
          }
          decisionPromise = this.aiController.chooseTurnAction()
          continue
        }

        acceptedActions += 1
        rejectedActions = 0
        this.syncTurnHud(result.state)
        this.syncTurnControls(result.state)
        this.syncSecrets(result.state)

        const remainsAiTurn =
          result.state.phase === 'turns' &&
          result.state.activePlayerId === this.remoteParticipantId
        const nextDecisionPromise = remainsAiTurn
          ? this.aiController.chooseTurnAction()
          : null
        await this.presentResolutionEvents(result.events)
        this.syncSecrets(result.state)

        if (
          decision.command.type === 'play-card' &&
          this.remoteBackCount === remoteBackCountBefore
        ) {
          this.remoteBackCount = Math.max(0, this.remoteBackCount - 1)
          this.layoutRemoteHand()
        }
        if (!nextDecisionPromise) return
        await this.wait(0.12)
        decisionPromise = nextDecisionPromise
      }
    } catch (error) {
      this.logger.error('[Game AI] turn loop failed', error)
      if (
        !this.destroyed &&
        this.match.getState().activePlayerId === this.remoteParticipantId
      ) {
        const result = this.session.dispatch({
          type: 'end-turn',
          participantId: this.remoteParticipantId
        })
        if (result.accepted) {
          this.syncTurnHud(result.state)
          await this.presentResolutionEvents(result.events)
        }
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

  private createMulliganLayer(): void {
    const overlay = this.createDarkOverlay()
    overlay.label = 'game.mulligan.dark-overlay'
    overlay.alpha = 0
    this.mulliganLayer.addChild(overlay)

    const announcement = new Sprite(this.options.gameAssets.mulliganAnnouncement)
    applyAnchoredPlacement(announcement, GAME_BOARD_LAYOUT.mulligan.announcement)
    announcement.label = 'game.mulligan.announcement'
    announcement.alpha = 0
    announcement.eventMode = 'none'
    this.mulliganLayer.addChild(announcement)
  }

  private createDarkOverlay(): Graphics {
    const overlay = new Graphics()
    overlay.rect(0, 0, 1920, 1080)
    overlay.fill({ color: 0x000000, alpha: 0.8 })
    overlay.eventMode = 'none'
    return overlay
  }

  private async createInitialLocalCards(cards: readonly OpeningCard[]): Promise<void> {
    const entries = await Promise.all(
      cards.map(async (card) => {
        const slot = await this.createSlot(card)
        slot.alpha = 0
        slot.on('pointertap', (event: FederatedPointerEvent) => {
          if (this.confirmationLocked || !this.mulliganInputReady || event.button !== 0)
            return
          const selected = !this.selectedIds.has(slot.instanceId)
          if (selected) this.selectedIds.add(slot.instanceId)
          else this.selectedIds.delete(slot.instanceId)
          slot.setSelected(selected)
          slot.setPlayableOutlineEnabled(!selected)
        })
        this.mulliganLayer.addChild(slot)
        return {
          card,
          slot,
          restTransform: undefined,
          displaced: false
        } as const
      })
    )
    for (const entry of entries) {
      this.handEntries.push(entry)
      this.initialSlots.push(entry.slot)
    }
  }

  /** Keeps mulligan input locked until the complete opening presentation is ready. */
  private setMulliganInputEnabled(enabled: boolean): void {
    this.mulliganInputReady = enabled
    for (const slot of this.initialSlots) {
      slot.setMulliganInteractionEnabled(enabled)
    }
  }

  /** Keeps the selected overlay and the unselected-card outline mutually exclusive. */
  private syncMulliganSelectionVisuals(): void {
    for (const slot of this.initialSlots) {
      const selected = this.selectedIds.has(slot.instanceId)
      slot.setSelected(selected)
      slot.setPlayableOutlineEnabled(!selected)
    }
  }

  private async createSlot(card: OpeningCard): Promise<GameCardSlot> {
    const definition = cardDefinition(card)
    const artwork = await this.resolver.loadArtwork(card.cardId)
    const view = await CardView.create(definition, this.resolver, { artwork })
    const baseCost = card.baseCost ?? definition.cost
    const currentCost = card.currentCost ?? baseCost
    view.setManaCost(currentCost)
    view.setManaCostColor(cardCostColor(baseCost, currentCost))
    const outlineTexture = await this.resolver.load(
      CARD_PROFILES[view.plan.template].frame
    )
    const slot = new GameCardSlot(
      view,
      card.instanceId,
      this.options.gameAssets.mulliganReplaceCross,
      this.options.gameAssets.mulliganReplacedLabel,
      outlineTexture
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
      back.alpha = 0
      back.eventMode = 'none'
      this.remoteBacks.push(back)
      this.remoteHandLayer.addChild(back)
    }
    this.layoutRemoteHand()
  }

  private layoutRemoteHand(): void {
    const midpoint = (this.remoteBackCount - 1) / 2
    const { gap, scale } = this.remoteHandMetrics(this.remoteBackCount)
    this.remoteBacks.forEach((back, index) => {
      const visible = index < this.remoteBackCount
      back.visible = visible
      if (!visible) return
      const normalized = midpoint === 0 ? 0 : (index - midpoint) / midpoint
      back.position.set(
        GAME_BOARD_LAYOUT.remoteHand.centerX + (index - midpoint) * gap,
        GAME_BOARD_LAYOUT.remoteHand.baselineY -
          Math.abs(normalized) * GAME_BOARD_LAYOUT.remoteHand.edgeTuck
      )
      back.rotation = -(index - midpoint) * GAME_BOARD_LAYOUT.remoteHand.rotationStep
      back.scale.set(scale)
    })
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
    const announcement = this.mulliganLayer.getChildByLabel(
      'game.mulligan.announcement'
    )
    const overlay = this.mulliganLayer.getChildByLabel('game.mulligan.dark-overlay')
    if (!announcement || !overlay)
      throw new Error('Mulligan presentation is unavailable.')
    await Promise.all([
      this.fadeTo(overlay, 1, OPENING_TIMING.mulliganFade),
      this.fadeTo(announcement, 1, OPENING_TIMING.mulliganFade)
    ])
    const localCommonCount = this.localPlayerNumber === 2 ? 3 : this.initialSlots.length
    const remoteCommonCount = this.remotePlayerNumber === 2 ? 3 : this.remoteBackCount
    await Promise.all([
      this.dealLocalCards(0, localCommonCount),
      this.dealRemoteCards(0, remoteCommonCount)
    ])
    if (this.localPlayerNumber === 2) {
      await this.presentPlayerTwoAnnouncement()
      await this.dealLocalCards(3, 4, OPENING_TIMING.playerTwoFourthCard)
    } else {
      await this.dealRemoteCards(3, 4, OPENING_TIMING.playerTwoFourthCard)
    }
    this.syncMulliganSelectionVisuals()
    this.setMulliganInputEnabled(true)
    this.confirmButton.visible = true
    this.confirmButton.setEnabled(true)
  }

  private async presentPlayerTwoAnnouncement(): Promise<void> {
    const announcement = new Sprite(this.options.gameAssets.mulliganCoinAnnouncement)
    applyAnchoredPlacement(announcement, GAME_BOARD_LAYOUT.mulligan.coinAnnouncement)
    announcement.alpha = 0
    announcement.eventMode = 'none'
    this.mulliganLayer.addChild(announcement)
    await this.fadeTo(announcement, 1, OPENING_TIMING.mulliganFade)
    await this.wait(OPENING_TIMING.playerTwoAnnouncementHold)
    await this.fadeTo(announcement, 0, OPENING_TIMING.playerTwoAnnouncementFade)
    announcement.destroy()
  }

  private async dealLocalCards(
    start: number,
    end: number,
    duration: number = OPENING_TIMING.cardDeal
  ): Promise<void> {
    await Promise.all(
      this.initialSlots.slice(start, end).map((slot, offset) => {
        const index = start + offset
        this.prepareSlotAtDeck(slot, GAME_BOARD_LAYOUT.decks.local, index)
        this.travelLayer.addChild(slot)
        return this.animateSlotToMulligan(
          slot,
          index,
          this.initialSlots.length,
          duration,
          offset
        )
      })
    )
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
    if (this.confirmationLocked) return
    this.confirmationLocked = true
    this.setMulliganInputEnabled(false)
    this.confirmButton.setEnabled(false)
    for (const entry of this.handEntries) {
      entry.slot.setMulliganInteractionEnabled(false)
      entry.slot.setPlayableOutlineEnabled(false)
    }
    await this.wait(OPENING_TIMING.confirmationPause)
    const aiMulliganReady = await (this.aiMulliganResolution ?? Promise.resolve(false))
    if (this.destroyed) return
    if (!aiMulliganReady) {
      this.logger.error('[Game AI] could not confirm the remote mulligan.')
      this.confirmationLocked = false
      this.syncMulliganSelectionVisuals()
      this.setMulliganInputEnabled(true)
      this.confirmButton.setEnabled(true)
      return
    }
    const result = this.session.dispatch({
      type: 'confirm-mulligan',
      participantId: this.localParticipantId,
      replaceInstanceIds: [...this.selectedIds]
    })
    if (!result.accepted) {
      this.logger.error(result.message)
      this.confirmationLocked = false
      this.syncMulliganSelectionVisuals()
      this.setMulliganInputEnabled(true)
      this.confirmButton.setEnabled(true)
      return
    }
    this.confirmButton.visible = false
    await this.presentResolutionEvents(result.events)
    await this.wait(OPENING_TIMING.handoffPause)
    await this.fadeTo(this.mulliganLayer, 0, OPENING_TIMING.mulliganFade)
    this.mulliganLayer.visible = false
  }

  private async resolveAiMulligan(
    decisionPromise: ReturnType<AiTurnController['chooseMulligan']>
  ): Promise<boolean> {
    const keepHandCommand: ConfirmMulliganCommand = {
      type: 'confirm-mulligan',
      participantId: this.remoteParticipantId,
      replaceInstanceIds: []
    }
    let command = keepHandCommand

    try {
      const decision = await decisionPromise
      if (this.destroyed) return false

      const state = this.match.getState()
      const remotePlayer = this.findPlayer(state, this.remoteParticipantId)
      if (remotePlayer.mulliganConfirmed) return true

      if (
        decision.expectedRevision === state.revision &&
        decision.command.type === 'confirm-mulligan' &&
        decision.command.participantId === this.remoteParticipantId
      ) {
        command = decision.command
      } else {
        this.logger.warn('[Game AI] mulligan decision became stale; keeping the hand')
      }
    } catch (error) {
      if (this.destroyed) return false
      this.logger.warn('[Game AI] mulligan decision failed; keeping the hand', error)
    }

    if (this.destroyed) return false
    const currentRemotePlayer = this.findPlayer(
      this.match.getState(),
      this.remoteParticipantId
    )
    if (currentRemotePlayer.mulliganConfirmed) return true

    let result = this.session.dispatch(command)
    if (!result.accepted && command.replaceInstanceIds.length > 0) {
      this.logger.warn(
        `[Game AI] mulligan selection was rejected (${result.message}); keeping the hand`
      )
      result = this.session.dispatch(keepHandCommand)
    }
    if (!result.accepted) {
      this.logger.error(`[Game AI] mulligan confirmation failed: ${result.message}`)
      return false
    }
    return true
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
    this.resolutionPresentationDepth += 1
    try {
      let requiresStateReconcile = false
      const goldenMonkeyHandReplacement = this.goldenMonkeyHandReplacementFor(events)
      let goldenMonkeyHandReplacementPresented = false
      for (const event of events) {
        if (event === alreadyPresented) continue
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
        await this.presentEvent(event)
      }
      await this.reconcileWeaponViews(this.match.getState())
      if (!requiresStateReconcile) return
      await this.reconcileEffectMovement()
      this.syncBoardMinionPresentation(this.match.getState())
      this.syncBoardAttackability(this.match.getState())
    } finally {
      this.resolutionPresentationDepth -= 1
      if (this.resolutionPresentationDepth === 0) {
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
    events: readonly OpeningMatchEvent[]
  ): GoldenMonkeyHandReplacement | null {
    const localHandIds = new Set(
      this.findPlayer(this.match.getState(), this.localParticipantId).hand.map(
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
      case 'mulligan-resolved':
        if (event.participantId === this.localParticipantId) {
          await this.presentLocalMulligan(event)
        }
        return
      case 'coin-granted':
      case 'opening-card-drawn':
      case 'card-drawn':
        await this.presentDraw(event.participantId, event.card)
        return
      case 'discover-started':
        if (event.participantId === this.localParticipantId)
          await this.cardSelectionOverlay.show(event.candidates)
        return
      case 'card-choice-started':
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
        this.showDamageIndicatorForCharacter(
          event.participantId,
          event.character,
          event.attemptedAmount ?? event.amount
        )
        this.presentCharacterStateChange(event)
        await this.wait(RESOLUTION_TIMING.outcomePause)
        return
      case 'character-healed':
        this.showHealIndicatorForCharacter(
          event.participantId,
          event.character,
          event.attemptedAmount ?? event.amount
        )
        this.presentCharacterStateChange(event)
        await this.wait(RESOLUTION_TIMING.outcomePause)
        return
      case 'armor-gained': {
        const player = this.findPlayer(this.match.getState(), event.participantId)
        const view = this.heroViews.get(event.participantId)
        view?.setStats(getHeroAttack(player), player.hero.health, event.armorAfter)
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
      case 'weapon-equipped':
        await this.presentWeaponEquipped(event)
        return
      case 'combat-started':
        await this.presentCombatStarted(event)
        return
      case 'minion-combat-resolved':
        await this.presentCombatResolved(event)
        return
      case 'character-combat-resolved':
        await this.presentCombatResolved(event)
        return
      case 'trigger-activated':
        await this.presentTriggerActivated(event)
        return
      case 'death-batch-started':
        await this.presentDeathBatchStarted(event)
        return
      case 'death-batch-completed':
        this.completeDeathBatch(event.batchId)
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
            ?.setStats(getHeroAttack(player), player.hero.health, player.hero.armor)
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
          while (this.handEntries.length > 0) {
            const entry = this.handEntries.pop()
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
        this.historyView?.record(event)
        return
    }
  }

  /** Begins combat motion before the runtime applies any damage. */
  private async presentCombatStarted(
    event: Extract<OpeningMatchEvent, { type: 'combat-started' }>
  ): Promise<void> {
    const attacker = this.findCombatView(
      event.attacker.participantId,
      event.attacker.character
    )
    const defender = this.findCombatView(
      event.defender.participantId,
      event.defender.character
    )
    if (!attacker || !defender || !attacker.parent || !defender.parent) return

    const attackerOrigin = { x: attacker.x, y: attacker.y }
    const defenderOrigin = { x: defender.x, y: defender.y }
    const attackerGlobal = attacker.parent.toGlobal(attacker.position)
    const defenderGlobal = defender.parent.toGlobal(defender.position)
    const attackerPlacement = this.promoteCombatViewForCombat(attacker)
    const active: ActiveCombatPresentation = {
      combatId: event.combatId,
      attacker,
      defender,
      attackerOrigin,
      defenderOrigin,
      attackerPlacement,
      attackerAttack: event.attacker.attack,
      deferredAttackerDeathInstanceIds: new Set(),
      attackerDamageIndicators: new Set(),
      impactStarted: false,
      attackerReturned: false,
      screenShake: null
    }
    this.activeCombatPresentations.set(event.combatId, active)

    const contactGlobal = {
      x: attackerGlobal.x + (defenderGlobal.x - attackerGlobal.x) * 0.62,
      y: attackerGlobal.y + (defenderGlobal.y - attackerGlobal.y) * 0.62
    }
    const contact = attacker.parent.toLocal(contactGlobal)
    const followDeathMarkers = (): void => this.updateCombatMarkerPositions()

    try {
      this.updateCombatMarkerPositions()
      await this.wait(BOARD_TIMING.combatWindupPause)

      const lunge = this.timeline()
      lunge.to(attacker, {
        x: contact.x,
        y: contact.y,
        duration: BOARD_TIMING.combatLunge,
        ease: 'power2.in'
      })
      lunge.eventCallback('onUpdate', followDeathMarkers)
      await this.completeTimeline(lunge)
      this.unlockCombatAttackerSelection()
    } catch (error) {
      this.activeCombatPresentations.delete(event.combatId)
      if (!attacker.destroyed)
        this.restoreCombatViewAfterCombat(attacker, attackerPlacement)
      throw error
    }
  }

  /** Completes an already-started combat after its reactive queue has settled. */
  private async presentCombatResolved(
    event: Extract<
      OpeningMatchEvent,
      { type: 'minion-combat-resolved' | 'character-combat-resolved' }
    >
  ): Promise<void> {
    const combatId = event.combatId
    const active = combatId ? this.activeCombatPresentations.get(combatId) : undefined
    if (!active) {
      if (event.type === 'minion-combat-resolved') await this.presentMinionCombat(event)
      else await this.presentCharacterCombat(event)
      return
    }
    this.activeCombatPresentations.delete(combatId!)
    const attacker = active.attacker
    const defender = active.defender
    try {
      if (!attacker.destroyed) this.setCombatViewFinalStats(attacker, event.attacker)
      if (!defender.destroyed) this.setCombatViewFinalStats(defender, event.defender)

      if (!active.impactStarted) {
        active.impactStarted = true
        active.screenShake = this.runCombatScreenShake(active.attackerAttack)
        await this.wait(RESOLUTION_TIMING.combatImpactPause)
      }
      const screenShake = active.screenShake ?? Promise.resolve()

      const attackerDestroyed = event.attacker.destroyed
      const defenderDestroyed = event.defender.destroyed
      const settle = (
        view: CombatView,
        origin: { readonly x: number; readonly y: number },
        destroyed: boolean
      ): Promise<void> => {
        if (view.destroyed) return Promise.resolve()
        const timeline = this.timeline()
        const attackerAlreadyReturned = view === attacker && active.attackerReturned
        if (view === attacker && !attackerAlreadyReturned) {
          timeline.to(view, {
            x: origin.x,
            y: origin.y,
            duration: BOARD_TIMING.combatReturn,
            ease: 'power2.out'
          })
        } else {
          timeline.to(view, {
            x: origin.x,
            y: origin.y,
            duration: BOARD_TIMING.combatReturn,
            ease: 'power2.out'
          })
        }
        if (destroyed && view instanceof MinionView) {
          timeline
            .to(
              view,
              {
                alpha: 0,
                duration: BOARD_TIMING.combatDeath,
                ease: 'power2.in'
              },
              view === attacker && !attackerAlreadyReturned
                ? BOARD_TIMING.combatReturn
                : 0
            )
            .to(
              view.scale,
              {
                x: view.scale.x * 0.7,
                y: view.scale.y * 0.7,
                duration: BOARD_TIMING.combatDeath,
                ease: 'power2.in'
              },
              view === attacker && !attackerAlreadyReturned
                ? BOARD_TIMING.combatReturn
                : 0
            )
        }
        if (attackerAlreadyReturned && !destroyed) return Promise.resolve()
        timeline.eventCallback('onUpdate', () => {
          this.updateCombatMarkerPositions()
          this.updateCombatDamageIndicators(active)
        })
        return this.completeTimeline(timeline)
      }

      await Promise.all([
        settle(attacker, active.attackerOrigin, attackerDestroyed),
        settle(defender, active.defenderOrigin, defenderDestroyed),
        screenShake
      ])

      if (attackerDestroyed && attacker instanceof MinionView)
        this.removeMinionView(attacker)
      else if (active.attackerPlacement && !attacker.destroyed)
        this.restoreCombatViewAfterCombat(attacker, active.attackerPlacement)
      if (defenderDestroyed && defender instanceof MinionView)
        this.removeMinionView(defender)
      this.applyLocalBoardLayout()
      this.applyRemoteBoardLayout()
    } finally {
      active.attackerDamageIndicators.clear()
      active.deferredAttackerDeathInstanceIds.clear()
      if (!attacker.destroyed)
        this.restoreCombatViewAfterCombat(attacker, active.attackerPlacement)
      this.clearCombatPreview()
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
      await this.presentDeathrattleGhost(
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

  private async presentDeathBatchStarted(
    event: Extract<OpeningMatchEvent, { type: 'death-batch-started' }>
  ): Promise<void> {
    this.deathBatchSources.set(
      event.batchId,
      event.deaths.map((death) => death.instanceId)
    )
    const animations: Promise<void>[] = []
    const views = new Map<string, MinionView | WeaponView>()
    for (const death of event.deaths) {
      const view =
        death.kind === 'minion'
          ? this.findMinionView(death.participantId, death.instanceId)
          : this.weaponViews.get(death.participantId)?.instanceId === death.instanceId
            ? this.weaponViews.get(death.participantId)
            : undefined
      if (!view || view.destroyed) continue
      if (death.hasDeathrattle && !this.deathGhostTemplates.has(death.instanceId)) {
        view.setDeathrattle(true)
        const snapshot = view.getAbilityMarkerSnapshot('deathrattle')
        if (snapshot)
          this.deathGhostTemplates.set(death.instanceId, {
            sourceInstanceId: death.instanceId,
            snapshot
          })
      }
      // Combat damage resolves its death batch before the combat-resolved
      // event. Keep a lethal attacker visible until that event can return it
      // to its board position and play its collapse there.
      const activeCombat =
        view instanceof MinionView ? this.activeCombatForAttacker(view) : undefined
      if (activeCombat) {
        activeCombat.deferredAttackerDeathInstanceIds.add(death.instanceId)
        continue
      }
      views.set(death.instanceId, view)
      const targetScale = view.scale.x * 0.72
      const timeline = this.timeline()
      timeline.to(view, {
        alpha: 0,
        duration: RESOLUTION_TIMING.deathCollapse,
        ease: 'power2.in'
      })
      timeline.to(
        view.scale,
        {
          x: targetScale,
          y: targetScale,
          duration: RESOLUTION_TIMING.deathCollapse,
          ease: 'power2.in'
        },
        0
      )
      animations.push(this.completeTimeline(timeline))
    }
    await Promise.all(animations)
    for (const death of event.deaths) {
      const view = views.get(death.instanceId)
      if (view instanceof MinionView) this.removeMinionView(view)
      else if (view instanceof WeaponView)
        this.removeWeaponView(death.participantId, view)
    }
  }

  private completeDeathBatch(batchId: string): void {
    for (const instanceId of this.deathBatchSources.get(batchId) ?? [])
      this.deathGhostTemplates.delete(instanceId)
    this.deathBatchSources.delete(batchId)
  }

  private async presentDeathrattleGhost(
    instanceId: string,
    fallbackSnapshot?: DeathGhostTemplate['snapshot']
  ): Promise<void> {
    const template =
      this.deathGhostTemplates.get(instanceId) ??
      (fallbackSnapshot
        ? { sourceInstanceId: instanceId, snapshot: fallbackSnapshot }
        : undefined)
    // A synthetic Deathrattle activation (for example Feign Death) does not
    // enter a death batch, so there may be no captured marker. Keep the same
    // pacing even when the source view is unavailable.
    if (!template) {
      await this.wait(RESOLUTION_TIMING.deathrattleGhost)
      return
    }
    const ghost = new Sprite(template.snapshot.texture)
    ghost.anchor.set(0.5)
    const local = this.combatOverlayLayer.toLocal(template.snapshot.globalPosition)
    ghost.position.set(local.x, local.y)
    ghost.scale.set(template.snapshot.worldScale)
    ghost.alpha = 1
    ghost.zIndex = 1250
    ghost.label = `game.deathrattle.${instanceId}`
    ghost.eventMode = 'none'
    this.combatOverlayLayer.addChild(ghost)
    this.activeDeathGhosts.add(ghost)
    const cleanup = (): void => {
      this.activeDeathGhosts.delete(ghost)
      if (!ghost.destroyed) ghost.destroy({ children: true })
    }
    const timeline = this.timeline()
    timeline.to(
      ghost.scale,
      {
        x: template.snapshot.worldScale * 2,
        y: template.snapshot.worldScale * 2,
        duration: RESOLUTION_TIMING.deathrattleGhost,
        ease: 'power2.out'
      },
      0
    )
    timeline.to(
      ghost,
      {
        alpha: 0,
        duration: RESOLUTION_TIMING.deathrattleGhost,
        ease: 'power2.in'
      },
      0
    )
    try {
      await this.completeTimeline(timeline)
    } finally {
      cleanup()
    }
  }

  private async presentMinionSummoned(
    event: Extract<OpeningMatchEvent, { type: 'minion-summoned' }>
  ): Promise<void> {
    await this.presentMinionPlayed(event, undefined, false)
  }

  private async presentEffectResolved(
    event: Extract<OpeningMatchEvent, { type: 'effect-resolved' }>
  ): Promise<void> {
    this.syncSecrets(this.match.getState())
    if (this.isSecretReveal(event)) {
      const cardId = event.data?.cardId
      if (typeof cardId === 'string') await this.secretRevealView.present(cardId)
    }
    const data = event.data
    if (!data) return
    const targetId = typeof data.target === 'string' ? data.target : undefined
    const target = targetId ? this.findEffectTargetView(targetId) : null
    const numberData = (key: string): number | undefined =>
      typeof data[key] === 'number' && Number.isFinite(data[key] as number)
        ? (data[key] as number)
        : undefined

    if (event.action === 'damage') {
      const actualDamage = Math.max(0, numberData('actualDamage') ?? 0)
      const armorDamage = Math.max(0, numberData('armorDamage') ?? 0)
      const totalDamage = actualDamage + armorDamage
      const indicatorAmount = effectDamageIndicatorAmount(data)
      const indicatorDeferredToCharacterEvent =
        event.actionPath.startsWith('hero-power.damage') ||
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
            const player = this.findPlayer(this.match.getState(), target.participantId)
            target.view.setStats(
              getHeroAttack(player),
              healthAfter,
              numberData('armorAfter') ?? player.hero.armor
            )
          }
        }
        if (
          !indicatorDeferredToCharacterEvent &&
          (target.view instanceof MinionView || target.view instanceof HeroView)
        ) {
          const indicator = this.showDamageIndicator(target.view, indicatorAmount)
          if (indicator && event.actionPath.startsWith('combat.')) {
            const activeCombat = this.activeCombatForAttacker(target.view)
            activeCombat?.attackerDamageIndicators.add(indicator)
          }
        }
      }
      if (event.actionPath.startsWith('combat.')) {
        const active = this.latestActiveCombat()
        if (active && !active.impactStarted) {
          active.impactStarted = true
          active.screenShake = this.runCombatScreenShake(active.attackerAttack)
        }
      }
      await this.wait(
        event.actionPath.startsWith('combat.')
          ? RESOLUTION_TIMING.combatImpactPause
          : RESOLUTION_TIMING.outcomePause
      )
      if (event.actionPath.startsWith('combat.')) {
        const active = this.latestActiveCombat()
        if (active) await this.returnActiveCombatAttacker(active)
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
        const player = this.findPlayer(this.match.getState(), target.participantId)
        target.view.setStats(getHeroAttack(player), healthAfter, player.hero.armor)
      }
      if (
        !indicatorDeferredToCharacterEvent &&
        amount > 0 &&
        healthAfter !== undefined &&
        (target?.view instanceof MinionView || target?.view instanceof HeroView)
      ) {
        this.showHealIndicator(target.view, amount)
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
        const player = this.findPlayer(this.match.getState(), target.participantId)
        target.view.setStats(
          attackAfter ?? getHeroAttack(player),
          healthAfter ?? player.hero.health,
          player.hero.armor
        )
      }
      if (target?.view) await this.wait(RESOLUTION_TIMING.outcomePause)
      return
    }

    if (event.action === 'gain-armor' && target?.view instanceof HeroView) {
      const player = this.findPlayer(this.match.getState(), target.participantId)
      target.view.setStats(
        getHeroAttack(player),
        player.hero.health,
        numberData('armor') ?? player.hero.armor
      )
      await this.wait(RESOLUTION_TIMING.outcomePause)
    }
  }

  /** Adds only the hover grayscale filter, preserving result filters when present. */
  private setHistoryBoardDesaturated(active: boolean): void {
    if (active) {
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
        view.setDivineShield(markers.divineShield)
        view.setFrozen(isFrozen(minion.frozenUntilTurn, state.turnNumber))
        view.setStealth(markers.stealth)
        view.setTrigger(markers.trigger)
        view.setInspire(markers.inspire)
        view.setDeathrattle(markers.deathrattle)
      }
    }
    this.refreshHoveredBoardMinionCardPreview()
  }

  /** Keeps the facedown hero-zone markers derived from authoritative secret state. */
  private syncSecrets(state: OpeningMatchState): void {
    for (const player of state.players) {
      this.secretZoneView.sync(
        player.participantId === this.localParticipantId ? 'local' : 'remote',
        player.secrets?.length ?? 0
      )
    }
  }

  private isSecretReveal(
    event: Extract<OpeningMatchEvent, { type: 'effect-resolved' }>
  ): boolean {
    return event.action === 'reveal' && typeof event.data?.secretId === 'string'
  }

  /**
   * Effect actions can move existing instances without a play-card event
   * (bounce, resurrect, transform, steal, or swap). Reconcile by instance ID
   * so those movements remain visible and board reordering follows domain
   * order instead of relying on a stale presentation array.
   */
  private async reconcileEffectMovement(): Promise<void> {
    const state = this.match.getState()
    for (const player of state.players) {
      const views =
        player.participantId === this.localParticipantId
          ? this.localMinionViews
          : this.remoteMinionViews
      const representedInstances = new Set<string>()
      for (const view of [...views]) {
        const instanceId = view.instanceId
        if (
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
      views.sort(
        (left, right) =>
          player.board.findIndex((minion) => minion.instanceId === left.instanceId) -
          player.board.findIndex((minion) => minion.instanceId === right.instanceId)
      )
      if (player.participantId === this.localParticipantId) this.applyLocalBoardLayout()
      else this.applyRemoteBoardLayout()
    }
    const local = this.findPlayer(state, this.localParticipantId)
    let removedLocalCard = false
    for (const entry of [...this.handEntries]) {
      if (local.hand.some((card) => card.instanceId === entry.card.instanceId)) continue
      const index = this.handEntries.indexOf(entry)
      if (index >= 0) {
        this.handEntries.splice(index, 1)
        removedLocalCard = true
      }
      entry.slot.disposePlayableOutline()
      entry.slot.removeFromParent()
      entry.slot.destroy({ children: true })
    }
    if (removedLocalCard) this.localHoveredSlot = null

    const missingLocalCards = local.hand.filter(
      (card) =>
        !this.handEntries.some((entry) => entry.card.instanceId === card.instanceId)
    )
    for (const card of missingLocalCards)
      await this.presentDraw(this.localParticipantId, card)

    if (removedLocalCard && missingLocalCards.length === 0) {
      const wasReflowing = this.reflowing
      this.reflowing = true
      try {
        await this.applyHandLayout({
          positionDuration: OPENING_TIMING.cardDeal,
          scaleDuration: OPENING_TIMING.cardDeal
        })
      } finally {
        this.reflowing = wasReflowing
      }
    }
    this.remoteBackCount = this.findPlayer(state, this.remoteParticipantId).hand.length
    this.layoutRemoteHand()
  }

  /** Flips the portrait and its newly installed Hero Power at the same time. */
  private async presentHeroReplaced(
    event: Extract<OpeningMatchEvent, { type: 'hero-replaced' }>
  ): Promise<void> {
    const player = this.findPlayer(this.match.getState(), event.participantId)
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
        this.options.gameAssets[heroPower.presentationAssetKey as HeroPowerAssetKey]
      ) ?? Promise.resolve()
    ])
    this.syncHeroPowerViews(this.match.getState())
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
      this.options.gameAssets[definition.presentationAssetKey as HeroPowerAssetKey]
    )
    this.syncHeroPowerViews(this.match.getState())
  }

  private presentCharacterStateChange(
    event: Extract<
      OpeningMatchEvent,
      { type: 'character-damaged' | 'character-healed' }
    >
  ): void {
    if (event.character.kind === 'hero') {
      const player = this.findPlayer(this.match.getState(), event.participantId)
      this.heroViews
        .get(event.participantId)
        ?.setStats(
          getHeroAttack(player),
          event.healthAfter,
          event.type === 'character-damaged' ? event.armorAfter : player.hero.armor
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
    const player = this.findPlayer(this.match.getState(), event.participantId)
    const minion = player.board.find(
      (candidate) => candidate.instanceId === character.instanceId
    )
    if (minion) view.setStats(minion.attack, event.healthAfter, minion.maxHealth)
  }

  async devAddCard(cardId: string, target: DevMatchTarget = 'local'): Promise<void> {
    if (!this.handModeActive)
      throw new Error('Dev add-card is only available after the opening sequence.')
    const definition = CARD_CATALOG.get(asCardId(cardId))
    if (!definition) throw new Error(`Unknown card ${cardId}`)
    const result = this.session.dispatch({
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
    if (!this.handModeActive) {
      this.addCardPicker.setStatus(
        'The match must finish its opening sequence before this dev tool can be used.',
        'error'
      )
    }
  }

  async devEndMatch(outcome: 'win' | 'lose'): Promise<void> {
    if (!this.handModeActive)
      throw new Error('Dev end-match is only available after the opening sequence.')
    const winnerId =
      outcome === 'win' ? this.localParticipantId : this.remoteParticipantId
    const result = this.session.dispatch({
      type: 'dev-end-match',
      participantId: this.localParticipantId,
      winnerId
    })
    if (!result.accepted) throw new Error(result.message)
    await this.presentResolutionEvents(result.events)
  }

  /** Immediately presents the local player's defeat result from the match menu. */
  concede(): void {
    this.showMatchResult(this.remoteParticipantId)
  }

  async devSummonMinion(cardId: string, target: DevMatchTarget): Promise<void> {
    if (!this.handModeActive)
      throw new Error('Dev summon is only available after the opening sequence.')
    const definition = CARD_CATALOG.get(asCardId(cardId))
    if (!definition) throw new Error(`Unknown card ${cardId}`)
    const result = this.session.dispatch({
      type: 'dev-summon-minion',
      participantId: this.participantIdForTarget(target),
      cardId: definition.id
    })
    if (!result.accepted) throw new Error(result.message)
    await this.presentResolutionEvents(result.events)
    this.syncTurnHud(result.state)
  }

  async devModifyDeck(target: DevMatchTarget, action: DevDeckAction): Promise<void> {
    const result = this.session.dispatch({
      type: 'dev-modify-deck',
      participantId: this.participantIdForTarget(target),
      action
    })
    if (!result.accepted) throw new Error(result.message)
    await this.presentResolutionEvents(result.events)
    this.syncTurnHud(result.state)
  }

  async runDevCommand(command: DevCommand): Promise<void> {
    if (!this.handModeActive)
      throw new Error('Dev commands are only available after the opening sequence.')
    const result = dispatchDevMatchCommand(
      (matchCommand) => this.session.dispatch(matchCommand),
      command,
      (target) => this.participantIdForTarget(target)
    )
    if (!result) return
    if (!result.accepted) throw new Error(result.message)
    await this.presentResolutionEvents(result.events)
    this.syncTurnHud(result.state)
  }

  private async presentDevCardAdded(
    event: Extract<OpeningMatchEvent, { type: 'dev-card-added' }>
  ): Promise<void> {
    if (event.participantId === this.localParticipantId) {
      await this.addLocalCard(event.card)
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
    const state = this.match.getState()
    this.hud.setDeckTracker(
      visibility,
      sortMode,
      this.findPlayer(state, this.localParticipantId).deck
    )
  }

  private updateDeckTracker(state: OpeningMatchState): void {
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

  /**
   * Replaces the local hand visually without changing domain card identity.
   * Existing cards leave below the viewport from left to right; their already
   * transformed snapshots then travel from Golden Monkey into their final
   * hand positions through the same motion used by generated cards.
   */
  private async presentGoldenMonkeyHandReplacement(
    replacement: GoldenMonkeyHandReplacement
  ): Promise<void> {
    const exitingEntries = this.handEntries.filter((entry) =>
      replacement.targetInstanceIds.has(entry.card.instanceId)
    )
    if (exitingEntries.length === 0) return

    // Golden Monkey targets the complete hand. Avoid partially clearing a
    // presentation if a future rules change leaves an unrelated card behind.
    if (exitingEntries.length !== this.handEntries.length) {
      this.logger.warn(
        '[Game presentation] Golden Monkey did not target every rendered hand card.'
      )
      return
    }

    const exitingIds = new Set(exitingEntries.map((entry) => entry.card.instanceId))
    const transformedCards = this.findPlayer(
      this.match.getState(),
      this.localParticipantId
    ).hand.filter((card) => exitingIds.has(card.instanceId))
    if (transformedCards.length !== exitingEntries.length) {
      this.logger.warn(
        '[Game presentation] Golden Monkey hand snapshots are incomplete.'
      )
      return
    }

    const wasReflowing = this.reflowing
    this.reflowing = true
    this.localHoveredSlot = null
    try {
      // Resolve every transformed face before the old hand starts moving so
      // artwork loading cannot leave a dead pause between exit and refill.
      const slots = await Promise.all(
        transformedCards.map((card) => this.createSlot(card))
      )
      const origin = this.generatedCardOrigin({
        kind: 'minion',
        instanceId: replacement.sourceInstanceId
      })
      const transforms = layoutHand(transformedCards.length, DEFAULT_HAND_LAYOUT, null)

      for (const entry of exitingEntries) {
        entry.slot.disposePlayableOutline()
        await this.animateSlotBelowViewport(entry.slot)
        const index = this.handEntries.indexOf(entry)
        if (index >= 0) this.handEntries.splice(index, 1)
        entry.slot.removeFromParent()
        entry.slot.destroy({ children: true })
      }

      for (const [index, card] of transformedCards.entries()) {
        const slot = slots[index]
        const transform = transforms[index]
        if (!slot || !transform) continue
        this.prepareSlotAtGeneratedOrigin(slot, origin)
        this.travelLayer.addChild(slot)
        this.handEntries.push({
          card: cloneCard(card),
          slot,
          restTransform: transform,
          displaced: false
        })
        await this.animateSlotToHand(
          slot,
          transform,
          RESOLUTION_TIMING.generatedCardDelay,
          RESOLUTION_TIMING.generatedCard,
          RESOLUTION_TIMING.generatedCard
        )
        this.handLayer.addChild(slot)
        this.configureHandSlot(slot)
      }
    } finally {
      this.reflowing = wasReflowing
    }
  }

  private async presentGeneratedCard(
    event: Extract<OpeningMatchEvent, { type: 'card-generated' }>
  ): Promise<void> {
    const origin = this.generatedCardOrigin(event.origin)
    if (event.participantId === this.localParticipantId) {
      if (this.findEntry(event.card.instanceId)) return
      // Effects may modify a generated card later in the same resolution (for
      // example, Unstable Portal reduces its cost). Build the slot from the
      // committed hand card, not the earlier event snapshot.
      const card = this.findPlayer(
        this.match.getState(),
        event.participantId
      ).hand.find((candidate) => candidate.instanceId === event.card.instanceId)
      if (!card) return
      const slot = await this.createSlot(card)
      this.prepareSlotAtGeneratedOrigin(slot, origin)
      this.travelLayer.addChild(slot)
      this.handEntries.push({
        card: cloneCard(card),
        slot,
        restTransform: undefined,
        displaced: false
      })
      this.localHoveredSlot = null
      this.reflowing = true
      await this.applyHandLayout({
        positionDuration: RESOLUTION_TIMING.generatedCard,
        scaleDuration: RESOLUTION_TIMING.generatedCard,
        delayedInstanceId: event.card.instanceId
      })
      this.reflowing = false
      // Travel-layer cards sit behind the live hand. Promote the completed
      // generated card into the hand layer just like a normal deck draw so it
      // remains visible, correctly stacked, and interactive.
      this.handLayer.addChild(slot)
      this.configureHandSlot(slot)
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

  private async presentDraw(participantId: PlayerId, card: OpeningCard): Promise<void> {
    if (participantId === this.localParticipantId) {
      await this.addLocalCard(card)
    } else {
      this.remoteBackCount += 1
      this.ensureRemoteBacks(this.remoteBackCount)
      const back = this.remoteBacks[this.remoteBackCount - 1]
      if (back) {
        this.prepareBackAtDeck(back, this.remoteBackCount - 1)
        await this.animateBackToHand(
          back,
          this.remoteBackCount - 1,
          this.remoteBackCount,
          OPENING_TIMING.cardDeal
        )
      }
    }
    this.syncTurnHud(this.match.getState())
    await this.wait(OPENING_TIMING.replacementPause)
  }

  private async presentWeaponEquipped(
    event: Extract<OpeningMatchEvent, { type: 'weapon-equipped' }>,
    adjustRemoteHand = true
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
        attack: event.weapon.attack,
        durability: event.weapon.durability,
        deathrattle: markers.deathrattle,
        trigger: markers.trigger,
        temporaryAbilityLabels: markers.temporaryAbilityLabels
      },
      {
        frame: this.options.gameAssets.weapon,
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
        this.deathGhostTemplates.set(previous.instanceId, {
          sourceInstanceId: previous.instanceId,
          snapshot: previousMarker
        })
      previous.removeFromParent()
      previous.destroy({ children: true })
    }
    view.instanceId = event.weapon.instanceId
    view.ownerId = event.participantId
    this.weaponViews.set(event.participantId, view)
    applyPlacement(view, layout)
    view.alpha = 0
    const targetScale = layout.scale ?? { x: 1, y: 1 }
    view.scale.set(targetScale.x * 0.72, targetScale.y * 0.72)
    view.eventMode = 'none'
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
    await this.completeTimeline(reveal)
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
        this.match.getState().turnNumber
      )
      existing.setTaunt(existingMarkers.taunt)
      existing.setDivineShield(existingMarkers.divineShield)
      existing.setFrozen(
        isFrozen(event.minion.frozenUntilTurn, this.match.getState().turnNumber)
      )
      existing.setStealth(existingMarkers.stealth)
      existing.setTrigger(existingMarkers.trigger)
      existing.setInspire(existingMarkers.inspire)
      existing.setDeathrattle(existingMarkers.deathrattle)
      return null
    }

    const definition = CARD_CATALOG.require(event.minion.cardId)
    const markers = boardMinionAbilityMarkers(
      event.minion,
      definition,
      this.match.getState().turnNumber
    )
    const textures: MinionViewTextures = {
      frame: this.options.gameAssets.minionFrame,
      legendaryFrame: this.options.gameAssets.minionFrameLegendary,
      taunt: this.options.gameAssets.minionTaunt,
      divineShield: this.options.gameAssets.minionDivineShield,
      frozen: this.options.gameAssets.minionFrozen,
      stealth: this.options.gameAssets.minionStealth,
      trigger: this.options.gameAssets.boardTrigger,
      inspire: this.options.gameAssets.boardInspire,
      deathrattle: this.options.gameAssets.boardDeathrattle,
      poisonous: this.options.gameAssets.boardPoisonous,
      attack: this.options.gameAssets.minionAttack,
      health: this.options.gameAssets.minionHealth
    }
    const viewPromise = this.resolver.loadArtwork(event.minion.cardId).then((artwork) =>
      MinionView.create(
        {
          label: `game.minion.${event.minion.instanceId}`,
          attack: event.minion.attack,
          health: event.minion.health,
          maxHealth: event.minion.maxHealth,
          baseAttack:
            event.minion.baseAttack ??
            (definition.type === 'Minion' ? definition.attack : event.minion.attack),
          baseHealth:
            event.minion.baseHealth ??
            (definition.type === 'Minion' ? definition.health : event.minion.maxHealth),
          legendary: definition.rarity === 'Legendary',
          taunt: markers.taunt,
          divineShield: markers.divineShield,
          frozen: isFrozen(
            event.minion.frozenUntilTurn,
            this.match.getState().turnNumber
          ),
          stealth: markers.stealth,
          deathrattle: markers.deathrattle,
          poisonous: markers.poisonous,
          trigger: markers.trigger,
          inspire: markers.inspire,
          temporaryAbilityLabels: markers.temporaryAbilityLabels
        },
        textures,
        artwork
      )
    )

    if (!summonSlot) {
      const view = await viewPromise
      view.instanceId = event.minion.instanceId
      view.ownerId = event.participantId
      view.cardId = event.minion.cardId
      if (isLocal) {
        this.insertLocalMinionView(event.position, view)
        const resting = layoutBoardRow(
          this.localMinionViews.length,
          this.localBoardRowConfig()
        )[event.position]
        if (resting) {
          view.position.set(resting.x, resting.y)
          view.scale.set(resting.scale * 1.25)
          view.setBaseScale(resting.scale)
        }
        view.alpha = 0
        this.applyLocalBoardLayout()
        this.wireMinionView(view)
        this.syncBoardAttackability(this.match.getState())
        await this.completeTimeline(
          this.timeline().to(view, {
            alpha: 1,
            duration: BOARD_TIMING.minionSettle,
            ease: 'power2.out',
            overwrite: 'auto'
          })
        )
        return null
      }
      // Remote (AI) board: same fade but on the top row.
      this.insertRemoteMinionView(event.position, view)
      const resting = layoutBoardRow(
        this.remoteMinionViews.length,
        this.remoteBoardRowConfig()
      )[event.position]
      if (resting) {
        view.position.set(resting.x, resting.y)
        view.scale.set(resting.scale * 1.25)
        view.setBaseScale(resting.scale)
      }
      view.alpha = 0
      this.applyRemoteBoardLayout()
      if (removedFromHand) {
        // Keep remote backs in sync when a hidden remote hand card was played.
        this.remoteBackCount = Math.max(0, this.remoteBackCount - 1)
        this.layoutRemoteHand()
      }
      this.wireMinionView(view)
      this.syncBoardAttackability(this.match.getState())
      await this.completeTimeline(
        this.timeline().to(view, {
          alpha: 1,
          duration: BOARD_TIMING.minionSettle,
          ease: 'power2.out',
          overwrite: 'auto'
        })
      )
      return null
    }

    const resting = layoutBoardRow(
      this.localMinionViews.length + 1,
      this.localBoardRowConfig()
    )[event.position]
    if (!resting) return null

    const summon = GAME_BOARD_LAYOUT.boardMinions.summon
    const cardBottomY = resting.y + (CARD_CANVAS.height * summon.cardScale) / 2
    summonSlot.removeFromParent()
    summonSlot.zIndex = 2
    this.activeSummonSlots.add(summonSlot)
    this.summonLayer.addChild(summonSlot)

    const chargeState = { glow: 0.24, artwork: 1 }
    const charge = this.timeline()
    targetPreview?.activeTimelines.add(charge)
    charge.to(summonSlot, {
      x: resting.x,
      y: cardBottomY,
      rotation: 0,
      duration: BOARD_TIMING.summonSnap,
      ease: 'power2.out'
    })
    charge.to(
      summonSlot.scale,
      {
        x: summon.cardScale,
        y: summon.cardScale,
        duration: BOARD_TIMING.summonSnap,
        ease: 'power2.out'
      },
      0
    )
    charge.to(summonSlot.scale, {
      x: summon.chargedCardScale,
      y: summon.chargedCardScale,
      duration: BOARD_TIMING.summonCharge,
      ease: 'sine.inOut'
    })
    charge.to(
      chargeState,
      {
        glow: 0.82,
        duration: BOARD_TIMING.summonSnap + BOARD_TIMING.summonCharge,
        ease: 'power2.in',
        onUpdate: () => summonSlot.setSummonGlowStrength(chargeState.glow)
      },
      0
    )
    charge.to(
      chargeState,
      {
        artwork: 0,
        duration: 0.16,
        ease: 'power2.in',
        onUpdate: () =>
          summonSlot.card.setLayerAppearance('artwork', {
            alpha: chargeState.artwork
          })
      },
      BOARD_TIMING.summonSnap + BOARD_TIMING.summonCharge - 0.16
    )

    let view: MinionView | null = null
    let rays: Sprite | null = null
    let retainedPresentation: MinionPreviewPresentation | null = null
    try {
      const [readyView] = await Promise.all([
        viewPromise,
        this.completeTimeline(charge)
      ])
      targetPreview?.activeTimelines.delete(charge)
      if (targetPreview?.cancelled) {
        readyView.destroy({ children: true })
        return null
      }
      view = readyView

      rays = new Sprite(this.options.gameAssets.minionSummonRays)
      rays.anchor.set(0.5)
      rays.position.set(resting.x, resting.y)
      const raysScale = summon.raysSize / Math.max(1, rays.texture.width)
      rays.alpha = 0
      rays.scale.set(raysScale * 0.3)
      rays.tint = SUMMON_GHOST_COLOR
      rays.blendMode = 'add'
      rays.zIndex = 0
      rays.label = 'game.minion-summon-rays'
      rays.eventMode = 'none'
      this.summonLayer.addChild(rays)
      if (targetPreview) targetPreview.rays = rays

      view.position.set(resting.x, resting.y + summon.minionStartYOffset)
      view.scale.set(resting.scale * summon.minionStartScaleMultiplier)
      view.alpha = 0
      view.zIndex = 1
      this.summonLayer.addChild(view)
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
        this.syncPendingMinionTargetPreview()
      }

      const ghostState = { details: 1, structure: 1, labels: 1 }
      this.prepareSummonGhost(summonSlot.card)
      const syncGhost = (): void => this.syncSummonGhost(summonSlot.card, ghostState)
      const impact = this.timeline()
      targetPreview?.activeTimelines.add(impact)
      impact.to(ghostState, {
        details: 0,
        duration: BOARD_TIMING.summonCollapse * 0.7,
        ease: 'power2.in',
        onUpdate: syncGhost
      })
      impact.to(ghostState, {
        structure: 0.48,
        labels: 0.18,
        duration: BOARD_TIMING.summonCollapse * 0.65,
        ease: 'power2.in',
        onUpdate: syncGhost
      })
      impact.to(
        summonSlot.scale,
        {
          x: summon.cardScale * 0.88,
          y: summon.cardScale * 0.88,
          duration: BOARD_TIMING.summonCollapse,
          ease: 'power2.in'
        },
        0
      )
      impact.to(
        rays,
        {
          alpha: 0.9,
          duration: 0.08,
          ease: 'power2.out'
        },
        BOARD_TIMING.summonCollapse * 0.55
      )
      impact.to(
        rays.scale,
        {
          x: raysScale,
          y: raysScale,
          duration: BOARD_TIMING.summonImpact,
          ease: 'power2.out'
        },
        BOARD_TIMING.summonCollapse * 0.55
      )
      impact.to(
        view,
        {
          alpha: 1,
          y: resting.y,
          duration: BOARD_TIMING.summonImpact,
          ease: 'power2.out'
        },
        BOARD_TIMING.summonCollapse * 0.6
      )
      impact.to(
        view.scale,
        {
          x: resting.scale,
          y: resting.scale,
          duration: BOARD_TIMING.summonImpact,
          ease: 'back.out(1.2)'
        },
        BOARD_TIMING.summonCollapse * 0.6
      )
      impact.to(
        summonSlot,
        {
          alpha: 0,
          duration: BOARD_TIMING.summonImpact * 0.55,
          ease: 'power2.out'
        },
        BOARD_TIMING.summonCollapse
      )
      impact.to(
        rays,
        {
          alpha: 0,
          duration: BOARD_TIMING.summonImpact * 0.7,
          ease: 'power2.out'
        },
        BOARD_TIMING.summonCollapse + BOARD_TIMING.summonImpact * 0.3
      )
      await this.completeTimeline(impact)
      targetPreview?.activeTimelines.delete(impact)
      if (targetPreview?.cancelled) return null

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
        return presentation
      }

      view.removeFromParent()
      view.instanceId = event.minion.instanceId
      view.ownerId = event.participantId
      view.cardId = event.minion.cardId
      view.setBaseScale(resting.scale)
      this.insertLocalMinionView(event.position, view)
      view.position.set(resting.x, resting.y)
      view.scale.set(resting.scale)
      view.alpha = 1
      this.wireMinionView(view)
      this.syncBoardAttackability(this.match.getState())
      view = null
      return null
    } finally {
      targetPreview?.activeTimelines.delete(charge)
      if (targetPreview?.rays === rays) targetPreview.rays = null
      if (rays && !rays.destroyed) rays.destroy()
      if (view && !view.destroyed) view.destroy({ children: true })
      if (!summonSlot.destroyed && !retainForTargeting) {
        summonSlot.disposePlayableOutline()
        summonSlot.removeFromParent()
        summonSlot.destroy({ children: true })
      }
      if (!retainForTargeting) this.activeSummonSlots.delete(summonSlot)
    }
  }

  private async presentMinionCombat(
    event: Extract<OpeningMatchEvent, { type: 'minion-combat-resolved' }>
  ): Promise<void> {
    const attacker = this.findMinionView(
      event.attacker.participantId,
      event.attacker.instanceId
    )
    const defender = this.findMinionView(
      event.defender.participantId,
      event.defender.instanceId
    )
    if (!attacker || !defender || !attacker.parent || !defender.parent) {
      this.clearCombatPreview()
      return
    }

    let attackerPlacement: CombatViewPlacement | null = null
    try {
      const attackerOrigin = { x: attacker.x, y: attacker.y }
      const defenderOrigin = { x: defender.x, y: defender.y }
      const attackerGlobal = attacker.parent.toGlobal(attacker.position)
      const defenderGlobal = defender.parent.toGlobal(defender.position)
      attackerPlacement = this.promoteCombatViewForCombat(attacker)
      const contactGlobal = {
        x: attackerGlobal.x + (defenderGlobal.x - attackerGlobal.x) * 0.62,
        y: attackerGlobal.y + (defenderGlobal.y - attackerGlobal.y) * 0.62
      }
      const contact = attacker.parent.toLocal(contactGlobal)
      const followDeathMarkers = (): void => this.updateCombatMarkerPositions()

      this.updateCombatMarkerPositions()
      await this.wait(BOARD_TIMING.combatWindupPause)

      const lunge = this.timeline()
      lunge.to(attacker, {
        x: contact.x,
        y: contact.y,
        duration: BOARD_TIMING.combatLunge,
        ease: 'power2.in'
      })
      lunge.eventCallback('onUpdate', followDeathMarkers)
      // Only the attacker moves during the attack wind-up and lunge. The
      // defender remains planted and is updated at impact instead.
      await this.completeTimeline(lunge)

      this.setCombatViewStats(attacker, event.attacker)
      this.setCombatViewStats(defender, event.defender)
      followDeathMarkers()
      const screenShake = this.runCombatScreenShake(event.attacker.attack)
      this.unlockCombatAttackerSelection()
      await this.wait(BOARD_TIMING.combatImpact)

      const attackerDamageTaken = event.attacker.divineShieldConsumed
        ? 0
        : event.attacker.attemptedDamage
      const defenderDamageTaken = event.defender.divineShieldConsumed
        ? 0
        : event.defender.attemptedDamage
      const attackerDamageIndicator = this.showDamageIndicator(
        attacker,
        attackerDamageTaken
      )
      this.showDamageIndicator(defender, defenderDamageTaken)
      const followSettleOverlays = (): void => {
        followDeathMarkers()
        if (attackerDamageIndicator && !attackerDamageIndicator.destroyed) {
          this.positionCharacterIndicator(attackerDamageIndicator, attacker)
        }
      }

      const settle = (
        view: MinionView,
        origin: { x: number; y: number }
      ): Promise<void> => {
        if (view.destroyed) return Promise.resolve()
        const timeline = this.timeline()
        const destroyed =
          view === attacker ? event.attacker.destroyed : event.defender.destroyed

        if (view === attacker) {
          timeline.to(view, {
            x: origin.x,
            y: origin.y,
            duration: BOARD_TIMING.combatReturn,
            ease: 'power2.out'
          })
        }
        if (destroyed) {
          const deathStart = view === attacker ? BOARD_TIMING.combatReturn : 0
          timeline
            .to(
              view,
              {
                alpha: 0,
                duration: BOARD_TIMING.combatDeath,
                ease: 'power2.in'
              },
              deathStart
            )
            .to(
              view.scale,
              {
                x: view.scale.x * 0.7,
                y: view.scale.y * 0.7,
                duration: BOARD_TIMING.combatDeath,
                ease: 'power2.in'
              },
              deathStart
            )
        } else if (view !== attacker) {
          timeline.to(view, {
            x: origin.x,
            y: origin.y,
            duration: BOARD_TIMING.combatReturn,
            ease: 'power2.out'
          })
        }
        timeline.eventCallback('onUpdate', followSettleOverlays)
        return this.completeTimeline(timeline)
      }

      await Promise.all([
        settle(attacker, attackerOrigin),
        settle(defender, defenderOrigin),
        screenShake
      ])

      if (event.attacker.destroyed) this.removeMinionView(attacker)
      else if (attackerPlacement) {
        this.restoreCombatViewAfterCombat(attacker, attackerPlacement)
      }
      if (event.defender.destroyed) this.removeMinionView(defender)
      this.applyLocalBoardLayout()
      this.applyRemoteBoardLayout()
    } finally {
      if (!attacker.destroyed && attackerPlacement) {
        this.restoreCombatViewAfterCombat(attacker, attackerPlacement)
      }
      this.clearCombatPreview()
    }
  }

  private async presentCharacterCombat(
    event: CharacterCombatResolvedEvent
  ): Promise<void> {
    const attacker = this.findCombatView(
      event.attacker.participantId,
      event.attacker.character
    )
    const defender = this.findCombatView(
      event.defender.participantId,
      event.defender.character
    )
    if (!attacker || !defender || !attacker.parent || !defender.parent) {
      this.clearCombatPreview()
      return
    }

    let attackerPlacement: CombatViewPlacement | null = null
    try {
      const attackerOrigin = { x: attacker.x, y: attacker.y }
      const defenderOrigin = { x: defender.x, y: defender.y }
      const attackerGlobal = attacker.parent.toGlobal(attacker.position)
      const defenderGlobal = defender.parent.toGlobal(defender.position)
      attackerPlacement = this.promoteCombatViewForCombat(attacker)
      const contactGlobal = {
        x: attackerGlobal.x + (defenderGlobal.x - attackerGlobal.x) * 0.62,
        y: attackerGlobal.y + (defenderGlobal.y - attackerGlobal.y) * 0.62
      }
      const contact = attacker.parent.toLocal(contactGlobal)
      const followDeathMarkers = (): void => this.updateCombatMarkerPositions()

      this.updateCombatMarkerPositions()
      await this.wait(BOARD_TIMING.combatWindupPause)

      const lunge = this.timeline()
      lunge.to(attacker, {
        x: contact.x,
        y: contact.y,
        duration: BOARD_TIMING.combatLunge,
        ease: 'power2.in'
      })
      lunge.eventCallback('onUpdate', followDeathMarkers)
      await this.completeTimeline(lunge)

      this.setCombatViewStats(attacker, event.attacker)
      this.setCombatViewStats(defender, event.defender)
      followDeathMarkers()
      const screenShake = this.runCombatScreenShake(event.attacker.attack)
      this.unlockCombatAttackerSelection()
      await this.wait(BOARD_TIMING.combatImpact)

      const damageTaken = (combatant: CharacterCombatantResult): number =>
        combatant.divineShieldConsumed ? 0 : combatant.attemptedDamage
      const attackerDamageIndicator = this.showDamageIndicator(
        attacker,
        damageTaken(event.attacker)
      )
      this.showDamageIndicator(defender, damageTaken(event.defender))
      const followSettleOverlays = (): void => {
        followDeathMarkers()
        if (attackerDamageIndicator && !attackerDamageIndicator.destroyed) {
          this.positionCharacterIndicator(attackerDamageIndicator, attacker)
        }
      }

      const settle = (
        view: CombatView,
        origin: { x: number; y: number },
        destroyed: boolean
      ): Promise<void> => {
        if (view.destroyed) return Promise.resolve()
        const timeline = this.timeline()
        // Heroes remain visible at zero Health so the terminal state is clear;
        // attacking minions return home before their death collapse.
        if (view === attacker) {
          timeline.to(view, {
            x: origin.x,
            y: origin.y,
            duration: BOARD_TIMING.combatReturn,
            ease: 'power2.out'
          })
        }
        if (destroyed && view instanceof MinionView) {
          const deathStart = view === attacker ? BOARD_TIMING.combatReturn : 0
          timeline
            .to(
              view,
              {
                alpha: 0,
                duration: BOARD_TIMING.combatDeath,
                ease: 'power2.in'
              },
              deathStart
            )
            .to(
              view.scale,
              {
                x: view.scale.x * 0.7,
                y: view.scale.y * 0.7,
                duration: BOARD_TIMING.combatDeath,
                ease: 'power2.in'
              },
              deathStart
            )
        } else if (view !== attacker) {
          timeline.to(view, {
            x: origin.x,
            y: origin.y,
            duration: BOARD_TIMING.combatReturn,
            ease: 'power2.out'
          })
        }
        timeline.eventCallback('onUpdate', followSettleOverlays)
        return this.completeTimeline(timeline)
      }

      await Promise.all([
        settle(attacker, attackerOrigin, event.attacker.destroyed),
        settle(defender, defenderOrigin, event.defender.destroyed),
        screenShake
      ])

      if (event.attacker.destroyed && attacker instanceof MinionView) {
        this.removeMinionView(attacker)
      } else if (attackerPlacement) {
        this.restoreCombatViewAfterCombat(attacker, attackerPlacement)
      }
      if (event.defender.destroyed && defender instanceof MinionView) {
        this.removeMinionView(defender)
      }
      this.applyLocalBoardLayout()
      this.applyRemoteBoardLayout()
    } finally {
      if (!attacker.destroyed && attackerPlacement) {
        this.restoreCombatViewAfterCombat(attacker, attackerPlacement)
      }
      this.clearCombatPreview()
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
      await this.completeTimeline(timeline)
    } finally {
      this.position.set(baseX, baseY)
    }
  }

  /** Places the authored 1x marker above a character during lethal preview/combat. */
  private createDeathMarker(view: CombatView): Sprite {
    const marker = new Sprite(this.options.gameAssets.minionWillDie)
    marker.anchor.set(0.5)
    marker.scale.set(0.8)
    this.positionDeathMarker(marker, view)
    marker.zIndex = 1000
    marker.eventMode = 'none'
    const ref = view instanceof HeroView ? 'hero' : (view.instanceId ?? 'unknown')
    marker.label = `game.character.will-die.${ref}`
    this.combatOverlayLayer.addChild(marker)
    return marker
  }

  private positionDeathMarker(marker: Sprite, view: CombatView): void {
    const global = view.parent
      ? view.parent.toGlobal(view.position)
      : view.getGlobalPosition()
    const local = this.combatOverlayLayer.toLocal(global)
    marker.position.set(local.x, local.y - 15)
  }

  private showDamageIndicatorForCharacter(
    ownerId: PlayerId,
    character: AttackCharacterRef,
    amount: number
  ): void {
    const view = this.findCombatView(ownerId, character)
    if (view) this.showDamageIndicator(view, amount)
  }

  private showHealIndicatorForCharacter(
    ownerId: PlayerId,
    character: AttackCharacterRef,
    amount: number
  ): void {
    const view = this.findCombatView(ownerId, character)
    if (view) this.showHealIndicator(view, amount)
  }

  /** Pops a transient damage burst at the character's current board position. */
  private showDamageIndicator(
    view: CombatView,
    amount: number
  ): DamageIndicatorView | null {
    if (amount <= 0) return null

    const indicator = new DamageIndicatorView(
      this.options.gameAssets.damageIndicator,
      amount
    )
    return this.showCharacterIndicator(indicator, view)
  }

  /** Pops a transient healing burst at the character's current board position. */
  private showHealIndicator(
    view: CombatView,
    amount: number
  ): HealIndicatorView | null {
    if (amount <= 0) return null

    const indicator = new HealIndicatorView(
      this.options.gameAssets.healIndicator,
      amount
    )
    return this.showCharacterIndicator(indicator, view)
  }

  private showCharacterIndicator<T extends DamageIndicatorView | HealIndicatorView>(
    indicator: T,
    view: CombatView
  ): T {
    this.positionCharacterIndicator(indicator, view)
    indicator.scale.set(0)
    indicator.zIndex = 1100
    this.combatOverlayLayer.addChild(indicator)

    const timeline = this.timeline()
    timeline.to(indicator.scale, {
      x: 1,
      y: 1,
      duration: BOARD_TIMING.characterIndicatorGrow,
      ease: 'back.out(1.7)'
    })
    timeline.to(indicator, {
      alpha: 1,
      duration: BOARD_TIMING.characterIndicatorHold
    })
    timeline.to(indicator, {
      alpha: 0,
      duration: BOARD_TIMING.characterIndicatorFade,
      ease: 'power2.in'
    })
    timeline.eventCallback('onComplete', () => {
      indicator.removeFromParent()
      indicator.destroy({ children: true })
    })
    return indicator
  }

  private positionCharacterIndicator(
    indicator: DamageIndicatorView | HealIndicatorView,
    view: CombatView
  ): void {
    const global = view.parent
      ? view.parent.toGlobal(view.position)
      : view.getGlobalPosition()
    const local = this.combatOverlayLayer.toLocal(global)
    indicator.position.set(local.x, local.y - 15)
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
    state: OpeningMatchState = this.match.getState()
  ): BoardMinion | null {
    if (!view.ownerId || !view.instanceId) return null
    const player = state.players.find(
      (candidate) => candidate.participantId === view.ownerId
    )
    return player?.board.find((minion) => minion.instanceId === view.instanceId) ?? null
  }

  private destroyBoardMinionCardPreview(): void {
    const preview = this.boardMinionCardPreview
    this.boardMinionCardPreview = null
    if (!preview || preview.destroyed) return
    this.killTweensOf(preview)
    preview.removeFromParent()
    preview.destroy({ children: true })
  }

  private hideBoardMinionCardPreview(view?: MinionView): void {
    if (view && this.hoveredBoardMinionView !== view) return
    this.hoveredBoardMinionView = null
    this.requestedBoardMinionCardPreviewKey = null
    this.boardMinionCardPreviewRequest += 1
    this.destroyBoardMinionCardPreview()
  }

  private isBoardMinionCardPreviewEnabled(): boolean {
    return canShowBoardMinionCardPreview({
      cardTargeting: this.cardTargeting !== null,
      heroPowerTargeting: this.heroPowerTargeting,
      combatTargeting: this.selectedCombatView !== null
    })
  }

  private positionBoardMinionCardPreview(
    preview: CardView,
    sourceView: MinionView
  ): void {
    const globalBounds = sourceView.getBounds()
    const topLeft = this.boardMinionCardPreviewLayer.toLocal({
      x: globalBounds.x,
      y: globalBounds.y
    })
    const bottomRight = this.boardMinionCardPreviewLayer.toLocal({
      x: globalBounds.x + globalBounds.width,
      y: globalBounds.y + globalBounds.height
    })
    const layout = GAME_BOARD_LAYOUT.boardMinions.cardPreview
    const position = positionBoardMinionCardPreview(
      {
        x: Math.min(topLeft.x, bottomRight.x),
        y: Math.min(topLeft.y, bottomRight.y),
        width: Math.abs(bottomRight.x - topLeft.x),
        height: Math.abs(bottomRight.y - topLeft.y)
      },
      { width: preview.plan.width, height: preview.renderedHeight },
      layout
    )
    preview.position.set(position.x, position.y)
  }

  private async showBoardMinionCardPreview(
    view: MinionView,
    keepCurrentUntilReady = false
  ): Promise<void> {
    if (!this.isBoardMinionCardPreviewEnabled()) {
      this.hideBoardMinionCardPreview()
      return
    }

    const initialMinion = this.boardMinionForView(view)
    if (!initialMinion) {
      this.hideBoardMinionCardPreview(view)
      return
    }

    const initialKey = boardMinionCardPreviewKey(initialMinion)
    if (
      this.hoveredBoardMinionView === view &&
      this.requestedBoardMinionCardPreviewKey === initialKey
    ) {
      return
    }

    const changedView = this.hoveredBoardMinionView !== view
    this.hoveredBoardMinionView = view
    this.requestedBoardMinionCardPreviewKey = initialKey
    const request = ++this.boardMinionCardPreviewRequest
    if (changedView || !keepCurrentUntilReady) this.destroyBoardMinionCardPreview()

    try {
      const artwork = await this.resolver.loadArtwork(initialMinion.cardId)
      if (
        request !== this.boardMinionCardPreviewRequest ||
        this.hoveredBoardMinionView !== view ||
        !this.isBoardMinionCardPreviewEnabled() ||
        view.destroyed ||
        !view.parent
      ) {
        return
      }

      const minion = this.boardMinionForView(view)
      if (!minion) {
        this.hideBoardMinionCardPreview(view)
        return
      }
      const renderKey = boardMinionCardPreviewKey(minion)
      if (renderKey !== initialKey) {
        this.requestedBoardMinionCardPreviewKey = null
        void this.showBoardMinionCardPreview(view, true)
        return
      }

      const definition = CARD_CATALOG.require(minion.cardId)
      if (definition.type !== 'Minion') {
        this.hideBoardMinionCardPreview(view)
        return
      }
      const model = boardMinionCardPreviewModel(definition, minion)
      const preview = await CardView.create(model.card, this.resolver, {
        artwork,
        silenced: model.silenced
      })
      const latestMinion = this.boardMinionForView(view)
      if (
        request !== this.boardMinionCardPreviewRequest ||
        this.hoveredBoardMinionView !== view ||
        !this.isBoardMinionCardPreviewEnabled() ||
        view.destroyed ||
        !view.parent ||
        !latestMinion ||
        boardMinionCardPreviewKey(latestMinion) !== renderKey
      ) {
        preview.destroy({ children: true })
        if (
          request === this.boardMinionCardPreviewRequest &&
          this.hoveredBoardMinionView === view &&
          this.isBoardMinionCardPreviewEnabled() &&
          latestMinion
        ) {
          this.requestedBoardMinionCardPreviewKey = null
          void this.showBoardMinionCardPreview(view, true)
        }
        return
      }

      preview.setLayerAppearance('card.stats.attack.label', {
        tint: model.attackColor
      })
      preview.setLayerAppearance('card.stats.health.label', {
        tint: model.healthColor
      })
      preview.scale.set(GAME_BOARD_LAYOUT.boardMinions.cardPreview.scale)
      preview.alpha = 0
      preview.eventMode = 'none'
      preview.label = `game.board-minion-card-preview.${minion.instanceId}`
      this.positionBoardMinionCardPreview(preview, view)

      this.destroyBoardMinionCardPreview()
      this.boardMinionCardPreview = preview
      this.boardMinionCardPreviewLayer.addChild(preview)
      this.tweenTo(preview, {
        alpha: 1,
        duration: GAME_BOARD_LAYOUT.boardMinions.cardPreview.fadeDuration,
        ease: 'power2.out'
      })
    } catch (error) {
      if (request === this.boardMinionCardPreviewRequest) {
        this.requestedBoardMinionCardPreviewKey = null
        this.logger.warn('Failed to render board minion card preview.', error)
      }
    }
  }

  private refreshHoveredBoardMinionCardPreview(): void {
    const view = this.hoveredBoardMinionView
    if (!view) return
    if (!this.boardMinionForView(view)) {
      this.hideBoardMinionCardPreview(view)
      return
    }
    void this.showBoardMinionCardPreview(view, true)
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

  private latestActiveCombat(): ActiveCombatPresentation | undefined {
    let latest: ActiveCombatPresentation | undefined
    for (const presentation of this.activeCombatPresentations.values())
      latest = presentation
    return latest
  }

  private activeCombatForAttacker(
    view: CombatView
  ): ActiveCombatPresentation | undefined {
    for (const presentation of this.activeCombatPresentations.values()) {
      if (presentation.attacker === view) return presentation
    }
    return undefined
  }

  private updateCombatDamageIndicators(active: ActiveCombatPresentation): void {
    for (const indicator of active.attackerDamageIndicators) {
      if (indicator.destroyed) {
        active.attackerDamageIndicators.delete(indicator)
        continue
      }
      this.positionCharacterIndicator(indicator, active.attacker)
    }
  }

  /** Returns the attacker after impact so reactive presentation does not hold it at contact. */
  private async returnActiveCombatAttacker(
    active: ActiveCombatPresentation
  ): Promise<void> {
    const attacker = active.attacker
    if (active.attackerReturned || attacker.destroyed) return

    const timeline = this.timeline()
    timeline.to(attacker, {
      x: active.attackerOrigin.x,
      y: active.attackerOrigin.y,
      duration: BOARD_TIMING.combatReturn,
      ease: 'power2.out'
    })
    timeline.eventCallback('onUpdate', () => {
      this.updateCombatMarkerPositions()
      this.updateCombatDamageIndicators(active)
    })
    await this.completeTimeline(timeline)
    active.attackerReturned = true
  }

  private removeWeaponView(participantId: PlayerId, view?: WeaponView): void {
    const current = this.weaponViews.get(participantId)
    if (!current || (view && current !== view)) return
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

  private setCombatViewStats(
    view: CombatView,
    result: {
      readonly attack: number
      readonly healthAfter: number
      readonly armorAfter?: number
    }
  ): void {
    if (view instanceof HeroView) {
      view.setStats(result.attack, result.healthAfter, result.armorAfter ?? 0)
    } else {
      view.setStats(result.attack, result.healthAfter)
    }
  }

  /**
   * Reactive triggers can change attack while combat damage is resolving. Use
   * the committed snapshot when it is still on the board instead of restoring
   * the pre-impact attack value carried by the combat result event.
   */
  private setCombatViewFinalStats(
    view: CombatView,
    result: {
      readonly attack: number
      readonly healthAfter: number
      readonly armorAfter?: number
    }
  ): void {
    if (view instanceof HeroView) {
      const ownerId = view.ownerId
      if (ownerId) {
        const player = this.findPlayer(this.match.getState(), ownerId)
        view.setStats(getHeroAttack(player), player.hero.health, player.hero.armor)
        return
      }
    } else if (view.ownerId && view.instanceId) {
      const player = this.findPlayer(this.match.getState(), view.ownerId)
      const minion = player.board.find(
        (candidate) => candidate.instanceId === view.instanceId
      )
      if (minion) {
        view.setStats(minion.attack, minion.health, minion.maxHealth)
        return
      }
    }
    this.setCombatViewStats(view, result)
  }

  /** Temporarily lifts the attacker above both board rows without changing its screen position. */
  private promoteCombatViewForCombat(view: CombatView): CombatViewPlacement {
    const parent = view.parent
    if (!parent) {
      throw new Error('Cannot promote a combat character without a board parent.')
    }

    const placement = {
      parent,
      index: parent.getChildIndex(view),
      zIndex: view.zIndex
    }
    const global = view.getGlobalPosition()
    this.combatOverlayLayer.addChild(view)
    const local = this.combatOverlayLayer.toLocal(global)
    view.position.set(local.x, local.y)
    view.zIndex = COMBAT_ATTACKER_Z_INDEX
    return placement
  }

  /** Returns a surviving attacker to its original row and draw order. */
  private restoreCombatViewAfterCombat(
    view: CombatView,
    placement: CombatViewPlacement
  ): void {
    if (view.destroyed || view.parent === placement.parent) {
      if (!view.destroyed) view.zIndex = placement.zIndex
      return
    }

    const global = view.getGlobalPosition()
    placement.parent.addChildAt(
      view,
      Math.min(placement.index, placement.parent.children.length)
    )
    const local = placement.parent.toLocal(global)
    view.position.set(local.x, local.y)
    view.zIndex = placement.zIndex
  }

  private removeMinionView(view: MinionView): void {
    if (this.hoveredBoardMinionView === view) this.hideBoardMinionCardPreview(view)
    const views =
      view.ownerId === this.localParticipantId
        ? this.localMinionViews
        : this.remoteMinionViews
    const index = views.indexOf(view)
    if (index >= 0) views.splice(index, 1)
    if (view.destroyed) return
    view.removeFromParent()
    view.destroy({ children: true })
  }

  private insertLocalMinionView(position: number, view: MinionView): void {
    this.localMinionViews.splice(position, 0, view)
    this.localMinionLayer.addChildAt(
      view,
      Math.min(position, this.localMinionLayer.children.length)
    )
  }

  private insertRemoteMinionView(position: number, view: MinionView): void {
    this.remoteMinionViews.splice(position, 0, view)
    this.remoteMinionLayer.addChildAt(
      view,
      Math.min(position, this.remoteMinionLayer.children.length)
    )
  }

  private wireMinionView(view: MinionView): void {
    view.setHoverable(true)
    view.on('pointerover', () => void this.showBoardMinionCardPreview(view))
    view.on('pointerout', () => this.hideBoardMinionCardPreview(view))
    view.on('pointerdown', (event: FederatedPointerEvent) => {
      if (view.ownerId !== this.localParticipantId) return
      this.beginCombatDrag(view, event)
    })
    view.on('pointertap', (event: FederatedPointerEvent) => {
      if (this.consumeCardPlacementTap(event)) return
      if (this.consumeTargetGestureTap(event)) return
      if (event.button !== 0) return
      if (this.cardTargeting) {
        if (this.isValidCardTarget(view)) {
          this.commitCardTarget(view)
        } else {
          this.cancelCardTargeting({ x: event.globalX, y: event.globalY })
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
        if (
          !canSelectCombatAttacker(
            this.combatInProgress,
            this.combatAttackerSelectionUnlocked
          )
        )
          return
        if (!view.isCanAttack()) return
        this.selectAttacker(view)
        this.handleBoardPointerMove(event)
        return
      }
      if (view.ownerId === this.remoteParticipantId && this.selectedCombatView) {
        if (!canCommitCombatAttack(this.combatInProgress)) return
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
      if (this.cardTargeting) {
        if (this.isValidCardTarget(view)) {
          this.commitCardTarget(view)
        } else {
          this.cancelCardTargeting({ x: event.globalX, y: event.globalY })
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
        if (
          !canSelectCombatAttacker(
            this.combatInProgress,
            this.combatAttackerSelectionUnlocked
          )
        )
          return
        if (!view.isCanAttack()) return
        this.selectAttacker(view)
        this.handleBoardPointerMove(event)
        return
      }
      if (view.ownerId === this.remoteParticipantId && this.selectedCombatView) {
        if (!canCommitCombatAttack(this.combatInProgress)) return
        void this.attackCharacter(view)
      }
    })
  }

  private remoteBoardRowConfig(): BoardRowConfig {
    return GAME_BOARD_LAYOUT.boardMinions.remote
  }

  private applyRemoteBoardLayout(): void {
    const config = this.remoteBoardRowConfig()
    const targets = layoutBoardRow(this.remoteMinionViews.length, config)
    this.remoteMinionViews.forEach((view, index) => {
      const target = targets[index]
      if (!target) return
      view.setBaseScale(target.scale)
      const liftedY = view.isSelected() ? target.y - 12 : target.y
      this.tweenTo(view, {
        x: target.x,
        y: liftedY,
        duration: BOARD_TIMING.rowShift,
        ease: 'power2.out',
        overwrite: 'auto'
      })
    })
  }

  private prepareSummonGhost(card: CardView): void {
    for (const layer of [...SUMMON_STRUCTURE_LAYERS, ...SUMMON_LABEL_LAYERS]) {
      if (!card.hasLayer(layer)) continue
      card.setLayerAppearance(layer, {
        tint: SUMMON_GHOST_COLOR,
        blendMode: 'add'
      })
    }
  }

  private resetSummonCardAppearance(card: CardView): void {
    if (card.hasLayer('artwork')) {
      card.setLayerAppearance('artwork', { alpha: 1 })
    }
    for (const layer of SUMMON_DETAIL_LAYERS) {
      if (card.hasLayer(layer)) card.setLayerAppearance(layer, { alpha: 1 })
    }
    for (const layer of [...SUMMON_STRUCTURE_LAYERS, ...SUMMON_LABEL_LAYERS]) {
      if (!card.hasLayer(layer)) continue
      card.setLayerAppearance(layer, {
        alpha: 1,
        tint: 0xffffff,
        blendMode: 'normal'
      })
    }
  }

  private syncSummonGhost(
    card: CardView,
    state: {
      readonly details: number
      readonly structure: number
      readonly labels: number
    }
  ): void {
    for (const layer of SUMMON_DETAIL_LAYERS) {
      if (card.hasLayer(layer)) card.setLayerAppearance(layer, { alpha: state.details })
    }
    for (const layer of SUMMON_STRUCTURE_LAYERS) {
      if (card.hasLayer(layer))
        card.setLayerAppearance(layer, { alpha: state.structure })
    }
    for (const layer of SUMMON_LABEL_LAYERS) {
      if (card.hasLayer(layer)) card.setLayerAppearance(layer, { alpha: state.labels })
    }
  }

  /** Reveals the turn controls and reflects the new active player's turn. */
  private handleTurnStarted(participantId: PlayerId): void {
    this.cancelHeroPowerTargeting()
    this.cancelCardTargeting()
    if (!this.turnLayer.visible) this.turnLayer.visible = true
    if (participantId === this.localParticipantId) {
      this.turnInProgress = false
      this.presentYourTurnFlag()
    }
    this.syncTurnControls(this.match.getState())
    if (participantId === this.remoteParticipantId) {
      void this.scheduleAiTurn()
    }
  }

  /**
   * Shows the "Your turn" banner, always centred on the board: it fades in
   * while growing from a small scale up to full size, holds briefly, then fades
   * out. Fire-and-forget — turn flow and draw animations continue underneath
   * it. No sound.
   */
  private presentYourTurnFlag(): void {
    if (this.hud.yourTurnFlag) {
      this.killTweensOf(this.hud.yourTurnFlag)
      this.hud.yourTurnFlag.destroy({ children: true })
      this.hud.yourTurnFlag = null
    }
    const layout = GAME_BOARD_LAYOUT.yourTurnFlag
    const flag = new Sprite(this.options.gameAssets.yourTurn)
    applyAnchoredPlacement(flag, layout)
    flag.scale.set(GAME_BOARD_LAYOUT.yourTurnStartScale)
    flag.alpha = 0
    flag.label = 'game.your-turn-flag'
    flag.eventMode = 'none'
    this.turnLayer.addChild(flag)
    this.hud.yourTurnFlag = flag

    const finalScale = layout.scale ?? { x: 1, y: 1 }
    const timeline = this.timeline()
    timeline.to(flag, {
      alpha: 1,
      duration: TURN_TIMING.yourTurnGrow,
      ease: 'power2.out'
    })
    timeline.to(
      flag.scale,
      {
        x: finalScale.x,
        y: finalScale.y,
        duration: TURN_TIMING.yourTurnGrow,
        ease: 'power2.out'
      },
      0
    )
    timeline.to(
      flag,
      {
        alpha: 0,
        duration: TURN_TIMING.yourTurnFadeOut,
        ease: 'power2.in'
      },
      TURN_TIMING.yourTurnGrow + TURN_TIMING.yourTurnHold
    )
    void this.completeTimeline(timeline).then(() => {
      if (this.hud.yourTurnFlag !== flag || flag.destroyed) return
      this.hud.yourTurnFlag = null
      flag.destroy({ children: true })
    })
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
      const entryIndex = this.handEntries.findIndex((entry) => entry.slot === slot)
      const entry = entryIndex >= 0 ? this.handEntries[entryIndex] : undefined
      entry?.slot.disposePlayableOutline()
      if (entryIndex >= 0) this.handEntries.splice(entryIndex, 1)
      slot.destroy({ children: true })
    }
    await this.wait(OPENING_TIMING.replacementPause)

    const replacementSlots: GameCardSlot[] = []
    for (const card of event.replacementCards) {
      const slot = await this.createSlot(card)
      this.handEntries.push({
        card: cloneCard(card),
        slot,
        restTransform: undefined,
        displaced: false
      })
      replacementSlots.push(slot)
    }
    const allSlots = this.handEntries.map((entry) => entry.slot)
    allSlots.forEach((slot, index) => {
      slot.setSelected(false)
      slot.setMulliganInteractionEnabled(false)
      if (!replacementSlots.includes(slot)) return
      this.prepareSlotAtDeck(slot, GAME_BOARD_LAYOUT.decks.local, index)
      this.travelLayer.addChild(slot)
    })
    await Promise.all(
      allSlots.map((slot, index) =>
        this.animateSlotToMulligan(
          slot,
          index,
          allSlots.length,
          OPENING_TIMING.cardDeal
        )
      )
    )
    this.reflowing = true
    for (const slot of allSlots) {
      if (slot.parent !== this.handLayer) this.handLayer.addChild(slot)
      this.configureHandSlot(slot)
    }
    this.localHoveredSlot = null
    await this.applyHandLayout({
      positionDuration: OPENING_TIMING.cardDeal,
      scaleDuration: OPENING_TIMING.cardDeal
    })
    this.reflowing = false
    this.activateHandHover()
    await this.dismissMulliganPresentation()
  }

  private async dismissMulliganPresentation(): Promise<void> {
    const announcement = this.mulliganLayer.getChildByLabel(
      'game.mulligan.announcement'
    )
    const overlay = this.mulliganLayer.getChildByLabel('game.mulligan.dark-overlay')
    if (!announcement || !overlay)
      throw new Error('Mulligan presentation is unavailable.')
    await Promise.all([
      this.fadeTo(announcement, 0, OPENING_TIMING.mulliganFade),
      this.fadeTo(overlay, 0, OPENING_TIMING.mulliganFade)
    ])
  }

  private async addLocalCard(card: OpeningCard): Promise<void> {
    if (this.findEntry(card.instanceId)) return
    const selected = this.cardSelectionOverlay.takeSelected(card.instanceId)
    if (selected) {
      const localPosition = this.travelLayer.toLocal(selected.globalPosition)
      this.travelLayer.addChild(selected.slot)
      selected.slot.position.set(localPosition.x, localPosition.y)
      this.handEntries.push({
        card: cloneCard(card),
        slot: selected.slot,
        restTransform: undefined,
        displaced: false
      })
      this.localHoveredSlot = null
      this.reflowing = true
      this.cardSelectionOverlay.clear()
      await this.applyHandLayout({
        positionDuration: OPENING_TIMING.cardDeal,
        scaleDuration: OPENING_TIMING.cardDeal,
        delayedInstanceId: card.instanceId
      })
      this.reflowing = false
      this.handLayer.addChild(selected.slot)
      this.configureHandSlot(selected.slot)
      return
    }

    const slot = await this.createSlot(card)
    this.prepareSlotAtDeck(slot, GAME_BOARD_LAYOUT.decks.local, this.handEntries.length)
    this.travelLayer.addChild(slot)
    this.handEntries.push({
      card: cloneCard(card),
      slot,
      restTransform: undefined,
      displaced: false
    })
    this.localHoveredSlot = null
    this.reflowing = true
    await this.applyHandLayout({
      positionDuration: OPENING_TIMING.cardDeal,
      scaleDuration: OPENING_TIMING.cardDeal,
      delayedInstanceId: card.instanceId
    })
    this.reflowing = false
    this.handLayer.addChild(slot)
    this.configureHandSlot(slot)
  }

  private prepareSlotAtDeck(
    slot: GameCardSlot,
    deck: LayoutPlacement,
    sequence: number
  ): void {
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

  private animateSlotToMulligan(
    slot: GameCardSlot,
    index: number,
    count: number,
    duration: number,
    staggerIndex = index
  ): Promise<void> {
    const midpoint = (count - 1) / 2
    const x =
      GAME_BOARD_LAYOUT.mulligan.cards.centerX +
      (index - midpoint) * GAME_BOARD_LAYOUT.mulligan.cards.gap
    const timeline = this.timeline()
    timeline.to(slot, {
      x,
      y: GAME_BOARD_LAYOUT.mulligan.cards.baselineY,
      rotation: 0,
      alpha: 1,
      duration,
      delay: staggerIndex * OPENING_TIMING.cardStagger,
      ease: 'power2.out'
    })
    timeline.to(
      slot.scale,
      {
        x: GAME_BOARD_LAYOUT.mulligan.cards.scale,
        y: GAME_BOARD_LAYOUT.mulligan.cards.scale,
        duration,
        delay: staggerIndex * OPENING_TIMING.cardStagger,
        ease: 'power2.out'
      },
      0
    )
    timeline.to(
      slot.skew,
      {
        x: 0,
        y: 0,
        duration,
        delay: staggerIndex * OPENING_TIMING.cardStagger,
        ease: 'power2.out'
      },
      0
    )
    return this.completeTimeline(timeline, () => {
      this.mulliganLayer.addChild(slot)
    })
  }

  private animateBackToHand(
    back: Sprite,
    index: number,
    count: number,
    duration: number,
    staggerIndex = index
  ): Promise<void> {
    const midpoint = (count - 1) / 2
    const { gap, scale } = this.remoteHandMetrics(count)
    const normalized = midpoint === 0 ? 0 : (index - midpoint) / midpoint
    const x = GAME_BOARD_LAYOUT.remoteHand.centerX + (index - midpoint) * gap
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
    return this.completeTimeline(timeline)
  }

  private findEntry(instanceId: string): HandEntry | undefined {
    return this.handEntries.find((entry) => entry.card.instanceId === instanceId)
  }

  private localBoardRowConfig(): BoardRowConfig {
    return GAME_BOARD_LAYOUT.boardMinions.local
  }

  /** Animates the local row, optionally leaving a live ghost gap for a drop. */
  private applyLocalBoardLayout(previewIndex: number | null = null): void {
    const count = this.localMinionViews.length
    const config = this.localBoardRowConfig()
    const targets =
      previewIndex === null
        ? layoutBoardRow(count, config)
        : layoutBoardRow(count + 1, config)

    this.localMinionViews.forEach((view, index) => {
      const targetIndex =
        previewIndex === null || index < previewIndex ? index : index + 1
      const target = targets[targetIndex]
      if (!target) return
      view.setBaseScale(target.scale)
      const liftedY = view.isSelected() ? target.y - 12 : target.y
      this.tweenTo(view, {
        x: target.x,
        y: liftedY,
        duration: BOARD_TIMING.rowShift,
        ease: 'power2.out',
        overwrite: 'auto'
      })
    })
  }

  private resolveLocalBoardPreview(pointer: HandPointer): number | null {
    if (this.draggingIndex === null) return null
    const entry = this.handEntries[this.draggingIndex]
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
    const localPlayer = this.findPlayer(this.match.getState(), this.localParticipantId)
    const position = resolveBoardInsertionIndex(
      pointer.x,
      localPlayer.board.length,
      this.localBoardRowConfig()
    )
    return input.legalPositions.includes(position) ? position : null
  }

  private updateLocalBoardPreview(pointer: HandPointer): void {
    const nextIndex = this.resolveLocalBoardPreview(pointer)
    if (nextIndex === this.localBoardPreviewIndex) return
    this.localBoardPreviewIndex = nextIndex
    this.applyLocalBoardLayout(nextIndex)
  }

  private clearLocalBoardPreview(): void {
    if (this.localBoardPreviewIndex === null) return
    this.localBoardPreviewIndex = null
    this.applyLocalBoardLayout()
  }

  /** Clears the carried-card gesture after the engine accepts a play. */
  private releaseAcceptedHandCard(): void {
    this.dragReturning = true
    this.reflowing = true
    this.dragPointer = null
    this.dragStartPointer = null
    this.dragMovedBeyondThreshold = false
    this.dragState = null
    if (this.dragTick) gsap.ticker.remove(this.dragTick)
    this.dragTick = null
    this.dragPerspective?.destroy()
    this.dragPerspective = null
    this.options.cursor?.setContextVariant(null)
    this.localHoveredSlot = null
    this.draggingIndex = null
  }

  /** Confirms an already-selected targetless spell (for example Coin or Tracking). */
  private castSelectedTargetlessSpell(index: number, entry: HandEntry): void {
    const result = this.session.dispatch({
      type: 'play-card',
      participantId: this.localParticipantId,
      cardInstanceId: entry.card.instanceId
    })
    if (!result.accepted) {
      this.logger.error(result.message)
      this.endDrag()
      return
    }
    this.cardPlayInProgress = true
    this.syncTurnHud(result.state)
    this.releaseAcceptedHandCard()
    void this.presentAcceptedSpellPlay(index, entry, result)
  }
  /** Resolves a carried card through the engine and presents an accepted play. */
  private resolveCardDrop(pointer: HandPointer): void {
    if (this.draggingIndex === null || this.dragReturning || this.cardPlayInProgress)
      return
    const index = this.draggingIndex
    const entry = this.handEntries[index]
    if (!entry) {
      this.endDrag()
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
      this.endDrag()
      return
    }

    const needsCollectedInput = pendingCardInputStage(input, undefined) !== 'ready'
    if (definition.type === 'Spell' || needsCollectedInput) {
      if (!isInDropZone(pointer, GAME_BOARD_LAYOUT.cardPlay.localDropZone)) {
        this.endDrag()
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
          this.endDrag()
          return
        }
        position = candidate
      }

      if (needsCollectedInput) {
        this.beginCardTargeting(entry, input, position)
        return
      }

      const result = this.session.dispatch({
        type: 'play-card',
        participantId: this.localParticipantId,
        cardInstanceId: entry.card.instanceId
      })
      if (!result.accepted) {
        this.logger.error(result.message)
        this.endDrag()
        return
      }

      this.cardPlayInProgress = true
      this.syncTurnHud(result.state)
      this.releaseAcceptedHandCard()

      void this.presentAcceptedSpellPlay(index, entry, result)
      return
    }

    if (definition.type === 'Weapon') {
      if (!isInDropZone(pointer, GAME_BOARD_LAYOUT.cardPlay.localDropZone)) {
        this.endDrag()
        return
      }

      const result = this.session.dispatch({
        type: 'play-card',
        participantId: this.localParticipantId,
        cardInstanceId: entry.card.instanceId
      })
      if (!result.accepted) {
        this.logger.error(result.message)
        this.endDrag()
        return
      }

      this.cardPlayInProgress = true
      this.syncTurnHud(result.state)
      this.releaseAcceptedHandCard()

      void this.presentAcceptedWeaponPlay(index, entry, result)
      return
    }

    if (definition.type === 'Hero') {
      if (!isInDropZone(pointer, GAME_BOARD_LAYOUT.cardPlay.localDropZone)) {
        this.endDrag()
        return
      }

      const result = this.session.dispatch({
        type: 'play-card',
        participantId: this.localParticipantId,
        cardInstanceId: entry.card.instanceId
      })
      if (!result.accepted) {
        this.logger.error(result.message)
        this.endDrag()
        return
      }

      this.cardPlayInProgress = true
      this.syncTurnHud(result.state)
      this.releaseAcceptedHandCard()

      void this.presentAcceptedHeroPlay(index, entry, result)
      return
    }

    if (
      localPlayer.board.length >= MAX_BOARD_SIZE ||
      !isInDropZone(pointer, GAME_BOARD_LAYOUT.cardPlay.localDropZone)
    ) {
      this.endDrag()
      return
    }

    const position = resolveBoardInsertionIndex(
      pointer.x,
      localPlayer.board.length,
      this.localBoardRowConfig()
    )
    const result = this.session.dispatch({
      type: 'play-card',
      participantId: this.localParticipantId,
      cardInstanceId: entry.card.instanceId,
      position
    })
    if (!result.accepted) {
      this.logger.error(result.message)
      this.endDrag()
      return
    }

    // The engine has already committed the spend. Reflect it before any summon
    // animation so the next pointer action cannot use stale mana/UI state.
    this.cardPlayInProgress = true
    this.syncTurnHud(result.state)
    this.localBoardPreviewIndex = position
    this.applyLocalBoardLayout(position)

    // The minion ghost transition intentionally begins between detaching the
    // live drag ticker and destroying its perspective wrapper.
    this.dragReturning = true
    this.reflowing = true
    this.dragPointer = null
    this.dragStartPointer = null
    this.dragMovedBeyondThreshold = false
    this.dragState = null
    if (this.dragTick) gsap.ticker.remove(this.dragTick)
    this.dragTick = null
    entry.slot.beginSummonGhost()
    this.dragPerspective?.destroy()
    this.dragPerspective = null
    this.options.cursor?.setContextVariant(null)
    this.localHoveredSlot = null
    this.draggingIndex = null

    void this.presentAcceptedMinionPlay(index, entry, result)
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

  private async presentAcceptedWeaponPlay(
    index: number,
    entry: HandEntry,
    result: Extract<ReturnType<OpeningMatchInstance['dispatch']>, { accepted: true }>
  ): Promise<void> {
    try {
      this.handEntries.splice(index, 1)
      entry.slot.disposePlayableOutline()
      entry.slot.removeFromParent()
      const handReflow = this.applyHandLayout({
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
      entry.slot.destroy({ children: true })
      await this.presentResolutionEvents(result.events, weaponEquipped)
    } finally {
      this.cardPlayInProgress = false
      this.reflowing = false
      this.dragReturning = false
      this.activateHandHover()
      this.syncTurnHud(this.match.getState())
      this.syncTurnControls(this.match.getState())
    }
  }

  private async presentAcceptedHeroPlay(
    index: number,
    entry: HandEntry,
    result: Extract<ReturnType<OpeningMatchInstance['dispatch']>, { accepted: true }>
  ): Promise<void> {
    try {
      this.handEntries.splice(index, 1)
      entry.slot.disposePlayableOutline()
      entry.slot.removeFromParent()
      await this.applyHandLayout({
        positionDuration: OPENING_TIMING.cardDeal,
        scaleDuration: OPENING_TIMING.cardDeal
      })
      entry.slot.destroy({ children: true })
      await this.presentResolutionEvents(result.events)
    } finally {
      this.cardPlayInProgress = false
      this.reflowing = false
      this.dragReturning = false
      this.activateHandHover()
      this.syncTurnHud(this.match.getState())
      this.syncTurnControls(this.match.getState())
    }
  }

  private async presentAcceptedSpellPlay(
    index: number,
    entry: HandEntry,
    result: Extract<ReturnType<OpeningMatchInstance['dispatch']>, { accepted: true }>
  ): Promise<void> {
    try {
      this.handEntries.splice(index, 1)
      entry.slot.disposePlayableOutline()
      entry.slot.removeFromParent()
      await this.applyHandLayout({
        positionDuration: OPENING_TIMING.cardDeal,
        scaleDuration: OPENING_TIMING.cardDeal
      })
      entry.slot.destroy({ children: true })
      this.syncSecrets(result.state)
      await this.presentResolutionEvents(result.events)
    } finally {
      this.cardPlayInProgress = false
      this.reflowing = false
      this.dragReturning = false
      this.activateHandHover()
      this.syncTurnHud(this.match.getState())
      this.syncTurnControls(this.match.getState())
    }
  }

  private async presentAcceptedMinionPlay(
    index: number,
    entry: HandEntry,
    result: Extract<ReturnType<OpeningMatchInstance['dispatch']>, { accepted: true }>,
    minionPreview?: MinionPreviewPresentation
  ): Promise<void> {
    try {
      this.handEntries.splice(index, 1)
      const minionPlayed = result.events.find(
        (event): event is Extract<OpeningMatchEvent, { type: 'minion-played' }> =>
          event.type === 'minion-played'
      )
      const handReflow = this.applyHandLayout({
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
      this.cardPlayInProgress = false
      this.reflowing = false
      this.dragReturning = false
      this.localBoardPreviewIndex = null
      this.applyLocalBoardLayout()
      this.activateHandHover()
      this.syncTurnHud(this.match.getState())
      this.syncTurnControls(this.match.getState())
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
      view.setDivineShield(markers.divineShield)
      view.setFrozen(
        isFrozen(minionPlayed.minion.frozenUntilTurn, this.match.getState().turnNumber)
      )
      view.setStealth(markers.stealth)
      view.setTrigger(markers.trigger)
      view.setInspire(markers.inspire)
      view.setDeathrattle(markers.deathrattle)
      view.setBaseScale(resting.scale)
      this.insertLocalMinionView(minionPlayed.position, view)
      view.position.set(resting.x, resting.y)
      view.scale.set(resting.scale)
      view.alpha = 1
      this.localBoardPreviewIndex = null
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
  }

  /**
   * Activates a single fixed hit zone on handLayer covering the bottom of the
   * screen (the resting hand strip plus the tallest lifted card). Which card is
   * hovered is resolved by `resolveHandHover` against the cards' *resting*
   * transforms — no per-card hit areas that move with the card, eliminating
   * hover oscillation.
   *
   * Why a single hit zone instead of per-card hit areas: when a card lifts and
   * scales on hover, its hit area moves with it. That causes the pointer to
   * exit the card's hit area, drop the hover, re-enter at the rest position,
   * re-hover — infinite oscillation (the "dancing" bug). A fixed hit zone on
   * the layer decouples "which card is hovered" (pointer vs. rest geometry)
   * from "where the card is drawn" (animated). The card can move freely; the
   * hover target is recomputed from the pointer position alone.
   *
   * Hover only *enters* while the pointer is level with a resting card's
   * visible top edge (plus a small grace margin), so empty space above the
   * hand no longer triggers hover. Within that entry strip the pointer's x
   * maps to a logical fan slot, not to any card sprite, so overlapping art or
   * a lifted card's wide body never steals the selection from a tight fan.
   * Once a card is lifted, the pointer may roam anywhere over the lifted
   * card's bounds and it stays hovered.
   *
   * `pointermove` early-returns when the hovered card hasn't changed, so
   * moving the mouse within a single card's zone does not create redundant
   * tweens. `pointerleave` clears hover when the cursor exits the hit zone
   * (e.g. moves to the board or off-screen).
   */
  private activateHandHover(): void {
    if (this.handModeActive) return
    this.handModeActive = true
    this.handLayer.eventMode = 'static'
    window.addEventListener('pointerdown', this.handleWindowPointerDown, true)
    window.addEventListener('pointerup', this.handleWindowPointerUp, true)
    window.addEventListener('blur', this.handleWindowBlur)
    const bounds = handHoverHitBounds(DEFAULT_HAND_LAYOUT)
    const handRect = new Rectangle(bounds.x, bounds.y, bounds.width, bounds.height)
    // The fixed hand zone sits above board controls in the display tree. A
    // lifted card owns every point inside its visible body; elsewhere, holes
    // expose only board objects that can currently accept pointer input.
    this.handLayer.hitArea = {
      contains: (x: number, y: number): boolean => {
        if (!handRect.contains(x, y)) return false

        const hoveredEntry = this.localHoveredSlot
          ? this.handEntries.find((entry) => entry.slot === this.localHoveredSlot)
          : undefined
        const hoveredRest = hoveredEntry?.restTransform
        if (
          hoveredEntry &&
          hoveredRest &&
          isHandOwnedSlot(hoveredEntry.slot, this.handLayer) &&
          isPointerOverLiftedCard({ x, y }, hoveredRest, DEFAULT_HAND_LAYOUT)
        ) {
          return true
        }

        for (const view of this.localMinionViews) {
          if (!view.isInteractive()) continue
          const halfW = (MINION_CANVAS.width * view.scale.x) / 2
          const halfH = (MINION_CANVAS.height * view.scale.y) / 2
          if (Math.abs(x - view.x) < halfW && Math.abs(y - view.y) < halfH) return false
        }
        for (const view of this.remoteMinionViews) {
          if (!view.isInteractive()) continue
          const halfW = (MINION_CANVAS.width * view.scale.x) / 2
          const halfH = (MINION_CANVAS.height * view.scale.y) / 2
          if (Math.abs(x - view.x) < halfW && Math.abs(y - view.y) < halfH) return false
        }
        for (const view of this.heroViews.values()) {
          if (!view.isInteractive()) continue
          const bounds = view.getBounds()
          const topLeft = this.handLayer.toLocal({ x: bounds.x, y: bounds.y })
          const bottomRight = this.handLayer.toLocal({
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
          const global = this.handLayer.toGlobal({ x, y })
          const local = heroPower.toLocal(global)
          if (heroPower.containsCanvasPoint(local.x, local.y)) return false
        }
        return true
      }
    } as unknown as Rectangle
    this.handLayer.on('pointermove', (event: FederatedPointerEvent) => {
      if (
        !this.handModeActive ||
        this.reflowing ||
        this.cardTargeting !== null ||
        this.heroPowerTargeting ||
        this.selectedCombatView !== null
      )
        return
      const local = event.getLocalPosition(this.handLayer)
      if (this.draggingIndex !== null) return
      const transforms = this.handEntries.map((entry) =>
        isHandOwnedSlot(entry.slot, this.handLayer) ? entry.restTransform : undefined
      )
      const hoveredIndex = this.localHoveredSlot
        ? this.handEntries.findIndex((entry) => entry.slot === this.localHoveredSlot)
        : -1
      const resolved = resolveHandHover(
        local,
        transforms,
        DEFAULT_HAND_LAYOUT,
        hoveredIndex >= 0 ? hoveredIndex : null
      )
      const nearest =
        resolved !== null ? (this.handEntries[resolved]?.slot ?? null) : null
      if (nearest === this.localHoveredSlot) return
      this.localHoveredSlot = nearest
      this.applyHoverDelta()
    })
    this.handLayer.on('pointerleave', () => {
      if (!this.handModeActive || this.draggingIndex !== null) return
      this.localHoveredSlot = null
      this.applyHoverDelta()
    })
    this.handLayer.on('pointerdown', (event: FederatedPointerEvent) => {
      this.onHandPointerDown(event)
    })
    this.handLayer.on('globalpointermove', (event: FederatedPointerEvent) => {
      if (this.draggingIndex === null || this.dragReturning) return
      const local = event.getLocalPosition(this.handLayer)
      this.dragPointer = { x: local.x, y: local.y }
      if (this.dragStartPointer) {
        this.dragMovedBeyondThreshold =
          this.dragMovedBeyondThreshold ||
          Math.hypot(
            this.dragPointer.x - this.dragStartPointer.x,
            this.dragPointer.y - this.dragStartPointer.y
          ) > DRAG_MOVE_THRESHOLD
      }
      const entry = this.handEntries[this.draggingIndex]
      if (
        entry &&
        this.tryActivateDraggedCardTargeting(entry, this.dragPointer, event.pointerId)
      ) {
        return
      }
      this.updateLocalBoardPreview(this.dragPointer)
    })
    this.handLayer.on('rightdown', (event: FederatedPointerEvent) => {
      this.onHandRightDown(event)
    })
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

    this.lastTargetingPointer = { ...pointer }
    this.beginCardTargeting(entry, input, undefined, 'local-hero')
    if (this.cardTargeting?.cardInstanceId !== entry.card.instanceId) {
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
    if (
      this.combatInProgress ||
      this.cardPlayInProgress ||
      this.heroPowerTargeting ||
      this.cardTargeting
    )
      return
    if (this.selectedCombatView) {
      this.deselectAttacker()
      return
    }
    if (this.reflowing || event.button !== 0) return
    if (this.draggingIndex !== null) return
    const local = event.getLocalPosition(this.handLayer)
    const transforms = this.handEntries.map((entry) => entry.restTransform)
    const hoveredIndex = this.localHoveredSlot
      ? this.handEntries.findIndex((entry) => entry.slot === this.localHoveredSlot)
      : -1
    const resolved = resolveHandHover(
      local,
      transforms,
      DEFAULT_HAND_LAYOUT,
      hoveredIndex >= 0 ? hoveredIndex : null
    )
    if (resolved === null) return
    const legality = this.match.getLegality?.(this.localParticipantId)
    const card = this.handEntries[resolved]?.card
    if (!card || !legality?.playableCardInstanceIds.includes(card.instanceId)) {
      this.shakeCard(resolved)
      return
    }
    this.beginDrag(resolved, local, event.pointerId)
  }

  /** Right-click cancels the current drag, mirroring Hearthstone. */
  private onHandRightDown(event: FederatedPointerEvent): void {
    if (this.draggingIndex === null) return
    event.stopPropagation()
    this.endDrag()
  }

  /**
   * Attaches a hand card to the cursor: straightens it, scales it to
   * `dragScale`, and starts a `gsap.ticker` loop that lerps it toward the
   * pointer with resistance. Velocity drives a four-corner perspective mesh,
   * producing the visible trapezoidal warp of a rigid card tilting in 3D.
   */
  private beginDrag(index: number, pointer: HandPointer, pointerId: number): void {
    const entry = this.handEntries[index]
    const rest = entry?.restTransform
    if (!entry || !rest) return
    this.draggingIndex = index
    this.dragPointer = { ...pointer }
    this.dragStartPointer = { ...pointer }
    this.dragMovedBeyondThreshold = false
    this.dragReturning = false
    const input = this.match.getPlayInput?.(
      this.localParticipantId,
      entry.card.instanceId
    )
    if (input && allowsDragTargetingFromHand(cardDefinition(entry.card).type, input)) {
      this.targetGestures.begin(
        { kind: 'card', cardInstanceId: entry.card.instanceId },
        pointerId,
        pointer
      )
    }
    // Start from the card's current (hovered) position so the pickup glides up
    // toward the cursor instead of snapping back to the resting baseline.
    this.dragState = initialDragState(entry.slot.x, entry.slot.y)
    this.dragPerspective?.destroy()
    this.dragPerspective = null
    const outlineEnabled = entry.slot.isPlayableOutlineEnabled()
    entry.slot.suppressPlayableOutline(true)
    try {
      this.dragPerspective = new HandCardPerspective(
        this.options.renderer,
        entry.slot.card,
        {
          outlineTexture: entry.slot.playableOutlineTexture,
          outlineEnabled,
          // Playable cards switch to blue once selected while retaining the
          // normal or conditionally enhanced motion preset from the hand.
          outlinePalette: 'blue',
          outlinePreset: entry.slot.getPlayableOutlinePreset()
        }
      )
    } catch (error) {
      entry.slot.suppressPlayableOutline(false)
      throw error
    }
    this.options.cursor?.setContextVariant('grab')

    this.killTweensOf(entry.slot)
    this.killTweensOf(entry.slot.scale)
    this.tweenTo(entry.slot, {
      rotation: 0,
      duration: OPENING_TIMING.hover,
      ease: 'power2.out',
      overwrite: 'auto'
    })
    this.tweenTo(entry.slot.scale, {
      x: DEFAULT_HAND_DRAG.dragScale,
      y: DEFAULT_HAND_DRAG.dragScale,
      duration: OPENING_TIMING.hover,
      ease: 'power2.out',
      overwrite: 'auto'
    })
    entry.slot.zIndex = 1000

    const tick = (_time: number, deltaMS: number): void => this.stepDragFrame(deltaMS)
    this.dragTick = tick
    gsap.ticker.add(tick)
    this.syncManaTray(this.match.getState())
  }

  /** One ticker frame: advance the resistance lerp and apply it to the slot. */
  private stepDragFrame(deltaMS: number): void {
    if (this.draggingIndex === null) return
    if (this.dragReturning) {
      this.dragPerspective?.update(deltaMS)
      return
    }
    if (!this.dragPointer || !this.dragState) return
    const entry = this.handEntries[this.draggingIndex]
    if (!entry || entry.slot.destroyed) {
      this.endDrag()
      return
    }
    this.dragState = stepDrag(
      this.dragState,
      this.dragPointer.x,
      this.dragPointer.y,
      deltaMS,
      DEFAULT_HAND_DRAG
    )
    entry.slot.position.set(this.dragState.x, this.dragState.y)
    this.dragPerspective?.setTarget({
      x: -this.dragState.tiltX,
      y: -this.dragState.tiltY
    })
    this.dragPerspective?.update(deltaMS)
  }

  /**
   * Detaches the card and animates it back to its resting hand slot (hand
   * size, hand rotation, fan position) — never back to the lifted hover state.
   */
  private endDrag(): void {
    if (this.draggingIndex === null || this.dragReturning) return
    const index = this.draggingIndex
    this.dragPointer = null
    this.dragStartPointer = null
    this.dragMovedBeyondThreshold = false
    this.dragState = null
    this.dragReturning = true
    this.dragPerspective?.release()
    this.options.cursor?.setContextVariant(null)
    this.localHoveredSlot = null
    this.clearLocalBoardPreview()
    const entry = this.handEntries[index]
    if (entry?.restTransform) {
      void this.animateSlotToHand(
        entry.slot,
        entry.restTransform,
        0,
        OPENING_TIMING.hover,
        OPENING_TIMING.hover
      ).then(() => this.finishDrag(index, entry.slot))
      return
    }
    this.finishDrag(index)
  }

  /** Restores all transient drag state after the return animation settles. */
  private finishDrag(index: number, slot?: GameCardSlot): void {
    if (this.draggingIndex !== index) return
    const entry = slot
      ? this.handEntries.find((candidate) => candidate.slot === slot)
      : this.handEntries[index]
    if (this.dragTick) gsap.ticker.remove(this.dragTick)
    this.dragTick = null
    this.dragPerspective?.destroy()
    this.dragPerspective = null
    this.draggingIndex = null
    this.dragStartPointer = null
    this.dragMovedBeyondThreshold = false
    this.dragReturning = false
    if (entry) {
      entry.slot.suppressPlayableOutline(false)
      entry.displaced = false
    }
    this.syncManaTray(this.match.getState())
    const targeting = this.cardTargeting
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
  }

  /** A quick horizontal wobble for an unaffordable card, settling back at rest. */
  private shakeCard(index: number): void {
    const entry = this.handEntries[index]
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

  override dispose(): void {
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
    this.hideBoardMinionCardPreview()
    this.matchResultBlurFilter?.destroy()
    this.matchResultBlurFilter = null
    this.matchResultGrayscaleFilter?.destroy()
    this.matchResultGrayscaleFilter = null
    this.clearCombatPreview()
    this.heroPowerTargeting = false
    this.clearCardChoiceOverlay()
    this.cardTargeting = null
    this.combatInProgress = false
    this.combatAttackerSelectionUnlocked = false
    this.cancelCombatDrag()
    this.cardPlayInProgress = false
    this.activeCombatPresentations.clear()
    this.deathGhostTemplates.clear()
    this.deathBatchSources.clear()
    for (const ghost of this.activeDeathGhosts) {
      if (!ghost.destroyed) {
        ghost.removeFromParent()
        ghost.destroy({ children: true })
      }
    }
    this.activeDeathGhosts.clear()
    this.attackLine.clear()
    if (this.draggingIndex !== null) {
      this.handEntries[this.draggingIndex]?.slot.suppressPlayableOutline(false)
      if (this.dragTick) gsap.ticker.remove(this.dragTick)
      this.dragTick = null
      this.dragPerspective?.destroy()
      this.dragPerspective = null
      this.draggingIndex = null
      this.dragPointer = null
      this.dragStartPointer = null
      this.dragMovedBeyondThreshold = false
      this.dragState = null
      this.dragReturning = false
    }
    for (const entry of this.handEntries) {
      entry.slot.disposePlayableOutline()
    }
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
    this.hud.dispose()
    for (const view of this.localMinionViews) {
      view.removeFromParent()
      view.destroy({ children: true })
    }
    this.localMinionViews.length = 0
    for (const view of this.remoteMinionViews) {
      view.removeFromParent()
      view.destroy({ children: true })
    }
    this.remoteMinionViews.length = 0
    for (const view of this.weaponViews.values()) {
      view.removeFromParent()
      view.destroy({ children: true })
    }
    this.weaponViews.clear()
    super.dispose()
  }

  /**
   * Recomputes the rest layout for every card and animates each slot to its
   * rest transform. Called only for structural changes (deal, mulligan
   * resolve, draw) — never for hover. Stores `restTransform` on each entry so
   * `applyHoverDelta` can compute hover targets without re-running `layoutHand`.
   * Clears `displaced` on every entry since the structural animation overwrites
   * any in-flight hover state. Hover is blocked by the `reflowing` flag during
   * this call.
   */
  private async applyHandLayout(opts: {
    readonly positionDuration: number
    readonly scaleDuration: number
    readonly delayedInstanceId?: string
  }): Promise<void> {
    const transforms = layoutHand(this.handEntries.length, DEFAULT_HAND_LAYOUT, null)
    await Promise.all(
      this.handEntries.map((entry, index) => {
        const transform = transforms[index]
        if (!transform) return Promise.resolve()
        entry.restTransform = transform
        entry.displaced = false
        const delay =
          opts.delayedInstanceId !== undefined &&
          entry.card.instanceId === opts.delayedInstanceId
            ? RESOLUTION_TIMING.generatedCardDelay
            : 0
        return this.animateSlotToHand(
          entry.slot,
          transform,
          delay,
          opts.positionDuration,
          opts.scaleDuration
        )
      })
    )
  }

  /**
   * Animates only the hovered card (lift, scale, straighten, front). All other
   * cards stay frozen at their rest positions. This mirrors Hearthstone: a
   * hover change touches at most 2 cards (old hover returns to rest, new hover
   * lifts), never the full hand.
   */
  private applyHoverDelta(): void {
    const hoveredIndex = this.localHoveredSlot
      ? this.handEntries.findIndex((entry) => entry.slot === this.localHoveredSlot)
      : -1

    this.handEntries.forEach((entry, index) => {
      if (!isHandOwnedSlot(entry.slot, this.handLayer)) {
        entry.displaced = false
        return
      }
      if (!entry.restTransform) return
      const shouldDisplace = hoveredIndex >= 0 && index === hoveredIndex
      if (!shouldDisplace && !entry.displaced) return
      const target = this.computeHoverTarget(entry.restTransform, index, hoveredIndex)
      this.animateHoverTarget(entry.slot, target)
      entry.displaced = shouldDisplace
    })
    this.syncManaTray(this.match.getState())
  }

  /**
   * Pure transform computation for hover. The hovered card lifts by
   * `hoverLift`, scales to `hoverScale`, straightens its rotation, and jumps to
   * the front (zIndex 1000). All other cards return their rest transform
   * unchanged — neighbors do NOT shift, matching Hearthstone where only the
   * hovered card moves and the rest of the hand stays still.
   */
  private computeHoverTarget(
    rest: HandCardTransform,
    index: number,
    hoveredIndex: number
  ): HandCardTransform {
    if (hoveredIndex < 0 || index !== hoveredIndex) return rest
    return {
      x: rest.x,
      y: rest.y - DEFAULT_HAND_LAYOUT.hoverLift,
      rotation: 0,
      scale: DEFAULT_HAND_LAYOUT.hoverScale,
      zIndex: 1000
    }
  }

  /**
   * Fire-and-forget hover tween. Uses `overwrite: 'auto'` so GSAP cleanly hands
   * off the slot's properties from the previous hover tween to the new one
   * without snapping. No `killTweensOf` — the overwrite mode handles it per
   * property. `zIndex` is set immediately (not tweened) so the hovered card
   * jumps to the front instantly.
   */
  private animateHoverTarget(slot: GameCardSlot, target: HandCardTransform): void {
    this.tweenTo(slot, {
      x: target.x,
      y: target.y,
      rotation: target.rotation,
      duration: OPENING_TIMING.hover,
      ease: 'power2.out',
      overwrite: 'auto'
    })
    this.tweenTo(slot.scale, {
      x: target.scale,
      y: target.scale,
      duration: OPENING_TIMING.hover,
      ease: 'power2.out',
      overwrite: 'auto'
    })
    slot.zIndex = target.zIndex
  }

  private animateSlotToDeck(
    slot: GameCardSlot,
    deck: LayoutPlacement,
    sequence: number
  ): Promise<void> {
    this.travelLayer.addChild(slot)
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
    return this.completeTimeline(timeline)
  }

  private animateSlotBelowViewport(slot: GameCardSlot): Promise<void> {
    this.travelLayer.addChild(slot)
    slot.setMulliganInteractionEnabled(false)
    gsap.killTweensOf(slot)
    gsap.killTweensOf(slot.scale)
    gsap.killTweensOf(slot.skew)
    return this.completeTimeline(
      this.timeline().to(slot, {
        y: GAME_BOARD_LAYOUT.cardTravel.handReplacementExitY,
        duration: RESOLUTION_TIMING.handReplacementExit,
        ease: 'power2.in'
      })
    )
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
    await this.completeTimeline(timeline)
    // Keep selection/hover animation targets aligned with the settled board
    // scale rather than the larger versus-intro scale.
    if (!view.destroyed) view.setBaseScale(target.scale?.x ?? 1)
  }

  private animateSlotToHand(
    slot: GameCardSlot,
    transform: HandCardTransform,
    delay: number,
    positionDuration: number,
    scaleDuration: number
  ): Promise<void> {
    gsap.killTweensOf(slot)
    gsap.killTweensOf(slot.scale)
    gsap.killTweensOf(slot.skew)

    const timeline = this.timeline()
    timeline.to(slot, {
      x: transform.x,
      y: transform.y,
      rotation: transform.rotation,
      alpha: 1,
      duration: positionDuration,
      delay,
      ease: 'power2.out'
    })
    timeline.to(
      slot.scale,
      {
        x: transform.scale,
        y: transform.scale,
        duration: scaleDuration,
        delay,
        ease: 'power2.out'
      },
      0
    )
    timeline.to(
      slot.skew,
      {
        x: 0,
        y: 0,
        duration: positionDuration,
        delay,
        ease: 'power2.out'
      },
      0
    )
    slot.zIndex = transform.zIndex
    return this.completeTimeline(timeline)
  }

  /**
   * Strips a slot's mulligan-era interaction and disables its own pointer
   * events. In hand mode, hover is driven by a single pointermove listener on
   * handLayer (see `activateHandHover`), so individual slots must not receive
   * pointer events — a moving hit area on the animated slot causes oscillation.
   */
  private configureHandSlot(slot: GameCardSlot): void {
    slot.setMulliganInteractionEnabled(false)
    slot.removeAllListeners('pointertap')
    slot.removeAllListeners('pointerover')
    slot.removeAllListeners('pointerout')
  }

  private fadeTo(
    target: { alpha: number },
    alpha: number,
    duration: number
  ): Promise<void> {
    return this.completeTimeline(
      this.timeline().to(target, { alpha, duration, ease: 'power2.out' })
    )
  }

  private wait(duration: number): Promise<void> {
    return this.completeTimeline(this.timeline().to({}, { duration }))
  }

  private waitForResolutionIdle(): Promise<void> {
    if (this.resolutionPresentationDepth === 0) return Promise.resolve()
    return new Promise((resolve) => this.resolutionIdleWaiters.push(resolve))
  }

  private completeTimeline(
    timeline: gsap.core.Timeline,
    onComplete?: () => void
  ): Promise<void> {
    return new Promise((resolve) => {
      timeline.eventCallback('onComplete', () => {
        onComplete?.()
        resolve()
      })
      timeline.eventCallback('onInterrupt', resolve)
    })
  }
}
