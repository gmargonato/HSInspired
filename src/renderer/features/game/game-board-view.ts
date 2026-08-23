import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
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
  canBoardMinionAttack,
  createOpeningMatch,
  hasSummoningSickness,
  MAX_BOARD_SIZE,
  type BoardMinion,
  type MulliganResolvedEvent,
  type OpeningCard,
  type OpeningMatchEvent,
  type OpeningMatchInstance,
  type OpeningMatchState
} from '../../../game/match'
import type { PlayerId } from '../../../game/match'
import type { GameRoute } from '../../app/router'
import type { AppLogger } from '../../app/services'
import { CardView } from '../../rendering/cards/card-view'
import { CARD_CANVAS, CARD_PROFILES } from '../../rendering/cards/card-layout'
import {
  AnimatedOutline,
  OUTLINE_PROFILES
} from '../../rendering/effects/animated-outline'
import { gsap } from '../../animation/animations'
import {
  type DeckPresentationAssets,
  type GameAssets,
  type HeroPowerAssetKey
} from '../../ui/asset-registry'
import { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'
import { Actor } from '../../ui/components/actor'
import { Button } from '../../ui/components/button'
import type { CursorManager } from '../../ui/components/cursor'
import {
  DEFAULT_HAND_LAYOUT,
  HandCardTransform,
  HandPointer,
  handHoverHitBounds,
  layoutHand,
  resolveHandHover
} from './hand-layout'
import {
  DEFAULT_HAND_DRAG,
  initialDragState,
  stepDrag,
  type HandDragState
} from './hand-drag'
import { HandCardPerspective } from './hand-card-perspective'
import { ManaTray, resolveManaCrystalStates } from './mana-tray'
import { HeroPowerView, type HeroPowerLayout } from './hero-power-view'
import {
  MinionView,
  type MinionViewTextures
} from '../../rendering/minions/minion-view'
import {
  isInDropZone,
  layoutBoardRow,
  resolveBoardInsertionIndex,
  type BoardRowConfig
} from './board-layout'
import { AttackLine } from './attack-line'
import { GAME_BOARD_LAYOUT } from './game-scene-layout'
import { MINION_CANVAS } from '../../rendering/minions/minion-layout'
import {
  applyAnchoredPlacement,
  applyPlacement,
  type LayoutPlacement
} from '../../rendering/layout'
// Deck tracker temporarily disabled to isolate crash - will re-enable after root cause found
// import { DeckTrackerView } from './deck-tracker-view'

export interface GameBoardViewOptions {
  readonly route: GameRoute
  readonly decks: readonly Deck[]
  readonly gameAssets: GameAssets
  readonly heroAssets: DeckPresentationAssets
  readonly renderer: Renderer
  readonly cursor?: CursorManager | null
  readonly logger?: AppLogger
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
  aiTurnDelay: 1.8,
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
  summonImpact: 0.32
} as const

const SUMMON_GHOST_COLOR = 0x79e9ff
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

class GameCardSlot extends Container {
  readonly card: CardView
  readonly instanceId: string
  readonly playableOutlineTexture: Texture
  readonly playableOutline: AnimatedOutline
  private readonly outlineTarget: Sprite
  private playableOutlineDisposed = false
  private readonly replaceCross: Sprite
  private readonly replacedLabel: Sprite
  private playableOutlineRequested = false
  private playableOutlineSuppressed = false

  constructor(
    card: CardView,
    instanceId: string,
    replaceCrossTexture: Texture,
    replacedLabelTexture: Texture,
    outlineTexture: Texture
  ) {
    super()
    this.card = card
    this.instanceId = instanceId
    this.playableOutlineTexture = outlineTexture
    this.eventMode = 'static'
    this.cursor = 'pointer'
    const slotLayout = GAME_BOARD_LAYOUT.mulligan.slot
    this.hitArea = new Rectangle(
      slotLayout.hitArea.x,
      slotLayout.hitArea.y,
      slotLayout.hitArea.width,
      slotLayout.hitArea.height
    )
    this.label = `game-card:${instanceId}`

    card.eventMode = 'none'
    card.position.set(slotLayout.cardOffset.x, slotLayout.cardOffset.y)

    this.outlineTarget = new Sprite(outlineTexture)
    this.outlineTarget.width = card.plan.width
    this.outlineTarget.height = card.renderedHeight
    this.outlineTarget.position.set(slotLayout.cardOffset.x, slotLayout.cardOffset.y)
    this.outlineTarget.zIndex = -1
    this.outlineTarget.eventMode = 'none'
    this.outlineTarget.label = `${card.label}:playable-outline-target`
    this.addChild(this.outlineTarget)
    this.playableOutline = new AnimatedOutline(
      this.outlineTarget,
      'green',
      OUTLINE_PROFILES.card
    )
    this.setPlayableOutlineEnabled(false)

    this.addChild(card)

    this.replaceCross = new Sprite(replaceCrossTexture)
    this.replaceCross.anchor.set(0.5)
    this.replaceCross.position.set(
      slotLayout.replaceCrossOffset.x,
      slotLayout.replaceCrossOffset.y
    )
    this.replaceCross.scale.set(slotLayout.overlayScale)
    this.replaceCross.visible = false
    this.replaceCross.eventMode = 'none'
    this.addChild(this.replaceCross)

    this.replacedLabel = new Sprite(replacedLabelTexture)
    this.replacedLabel.anchor.set(0.5, 0)
    this.replacedLabel.position.set(
      slotLayout.replacedLabelOffset.x,
      slotLayout.replacedLabelOffset.y
    )
    this.replacedLabel.scale.set(slotLayout.overlayScale)
    this.replacedLabel.visible = false
    this.replacedLabel.eventMode = 'none'
    this.addChild(this.replacedLabel)
  }

  setSelected(selected: boolean): void {
    this.replaceCross.visible = selected
    this.replacedLabel.visible = selected
  }

  setPlayableOutlineEnabled(enabled: boolean): void {
    this.playableOutlineRequested = enabled
    this.syncPlayableOutline()
  }

  isPlayableOutlineEnabled(): boolean {
    return this.playableOutlineRequested
  }

  suppressPlayableOutline(suppressed: boolean): void {
    this.playableOutlineSuppressed = suppressed
    this.syncPlayableOutline()
  }

  beginSummonGhost(): void {
    this.eventMode = 'none'
    this.replaceCross.visible = false
    this.replacedLabel.visible = false
    this.disposePlayableOutline()
    this.outlineTarget.visible = true
    this.outlineTarget.tint = SUMMON_GHOST_COLOR
    this.outlineTarget.alpha = 0.24
    this.outlineTarget.blendMode = 'add'
  }

  setSummonGlowStrength(alpha: number): void {
    this.outlineTarget.alpha = alpha
  }

  disposePlayableOutline(): void {
    if (this.playableOutlineDisposed) return
    this.playableOutlineDisposed = true
    this.playableOutline.dispose()
  }

  private syncPlayableOutline(): void {
    this.playableOutline.setEnabled(
      this.playableOutlineRequested && !this.playableOutlineSuppressed
    )
  }
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

/** Feature-owned board, opening choreography, mulligan, and local hand interaction. */
export class GameBoardView extends Actor {
  private readonly resolver = new CardAssetResolver()
  private readonly handEntries: HandEntry[] = []
  private readonly selectedIds = new Set<string>()
  private readonly initialSlots: GameCardSlot[] = []
  private readonly remoteBacks: Sprite[] = []
  private readonly boardLayer = new Container()
  private readonly localMinionLayer = new Container()
  private readonly remoteMinionLayer = new Container()
  private readonly summonLayer = new Container()
  private readonly localMinionViews: MinionView[] = []
  private readonly remoteMinionViews: MinionView[] = []
  private readonly activeSummonSlots = new Set<GameCardSlot>()
  private readonly attackLineLayer = new Container()
  private readonly attackLine = new AttackLine()
  private selectedMinionView: MinionView | null = null
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
  private readonly turnLayer = new Container()
  private readonly mulliganLayer = new Container()
  private readonly handLayer = new Container()
  private readonly remoteHandLayer = new Container()
  private readonly heroSprites = new Map<PlayerId, Sprite>()
  /**
   * One hero power card per player. Both start on the back face, right of the
   * hero portraits, and flip up when the first turn starts.
   */
  private readonly heroPowerViews = new Map<PlayerId, HeroPowerView>()
  private readonly logger: AppLogger
  private match!: OpeningMatchInstance
  private localParticipantId!: PlayerId
  private remoteParticipantId!: PlayerId
  private localPlayerNumber!: 1 | 2
  private remotePlayerNumber!: 1 | 2
  private localHoveredSlot: GameCardSlot | null = null
  private confirmButton!: Button
  private endTurnButton!: Button
  private deckCountLabels: { local: Text; remote: Text } | null = null
  private manaLabels: { local: Text; remote: Text } | null = null
  private manaLocalTray: ManaTray | null = null
  private yourTurnFlag: Sprite | null = null
  /** True once the first turn has flipped both hero powers to their fronts. */
  private heroPowerRevealed = false
  /**
   * True while a turn is being processed (a local end-turn or the AI's pass).
   * Blocks repeat end-turn commands and the AI from acting out of turn.
   */
  private turnInProgress = false
  private confirmationLocked = false
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
  /** Current insertion gap preview, or null when no gap is previewed. */
  private localBoardPreviewIndex: number | null = null
  private readonly handleWindowPointerDown = (event: PointerEvent): void => {
    if (event.button === 2) {
      this.endDrag()
      if (this.selectedMinionView) {
        event.preventDefault()
        event.stopPropagation()
      }
      this.deselectAttacker()
      return
    }
    if (event.button === 0 && this.draggingIndex !== null && !this.dragReturning) {
      event.preventDefault()
      event.stopPropagation()
      const pointer = this.dragPointer
      if (pointer) this.resolveCardDrop(pointer)
    }
  }
  private readonly handleWindowPointerUp = (event: PointerEvent): void => {
    if (
      event.button !== 0 ||
      this.draggingIndex === null ||
      this.dragReturning ||
      !this.dragMovedBeyondThreshold
    ) {
      return
    }
    const pointer = this.dragPointer
    if (pointer) this.resolveCardDrop(pointer)
  }
  private readonly handleWindowBlur = (): void => this.endDrag()
  private readonly handleWindowKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.selectedMinionView) {
      this.deselectAttacker()
    }
  }

  constructor(private readonly options: GameBoardViewOptions) {
    super()
    this.logger = options.logger ?? {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    }
    this.addChild(this.boardLayer)
    this.localMinionLayer.label = 'game.board-minions-local'
    this.remoteMinionLayer.label = 'game.board-minions-remote'
    this.localMinionLayer.eventMode = 'passive'
    this.remoteMinionLayer.eventMode = 'passive'
    this.localMinionLayer.sortableChildren = true
    this.remoteMinionLayer.sortableChildren = true
    this.addChild(this.localMinionLayer)
    this.addChild(this.remoteMinionLayer)
    this.addChild(this.heroPowerLayer)
    this.addChild(this.openingLayer)
    this.addChild(this.heroLayer)
    this.addChild(this.deckLayer)
    this.addChild(this.turnLayer)
    this.addChild(this.mulliganLayer)
    // Dealt cards must stay above the mulligan dimmer while they travel from
    // the deck; they are reparented to their final layers after the animation.
    this.addChild(this.travelLayer)
    this.addChild(this.remoteHandLayer)
    this.addChild(this.handLayer)
    this.summonLayer.label = 'game.minion-summons'
    this.summonLayer.eventMode = 'none'
    this.summonLayer.sortableChildren = true
    this.addChild(this.summonLayer)
    this.attackLineLayer.label = 'game.attack-line-layer'
    this.attackLineLayer.eventMode = 'none'
    this.attackLineLayer.addChild(this.attackLine)
    this.addChild(this.attackLineLayer)
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
    this.on('pointerdown', (event: FederatedPointerEvent) => {
      if (event.button === 2) this.deselectAttacker()
    })
    this.on('pointertap', (event: FederatedPointerEvent) => {
      if (!this.selectedMinionView) return
      if (event.button !== 0) return
      const target = event.target
      if (target instanceof Container && target.label?.startsWith('minion:')) return
      // Click on empty board or hand background while targeting cancels.
      // Minion clicks are handled by wireMinionView already.
      if (
        target === this ||
        target.label === 'game.board-minions-local' ||
        target.label === 'game.board-minions-remote'
      ) {
        this.deselectAttacker()
      }
    })
  }

  async mount(): Promise<void> {
    this.logger.info('[GameBoardView] mount start', this.options.route)
    const human = this.options.route.setup.participants.find(
      (participant) => participant.controllerKind === 'human'
    )
    const remote = this.options.route.setup.participants.find(
      (participant) => participant.controllerKind === 'ai'
    )
    if (!human || !remote)
      throw new Error('GameScene requires one human and one AI participant.')

    this.localParticipantId = human.participantId
    this.remoteParticipantId = remote.participantId
    this.logger.info(
      '[GameBoardView] participants',
      this.localParticipantId,
      this.remoteParticipantId
    )
    this.match = createOpeningMatch(this.options.route.setup, this.options.decks)
    this.logger.info('[GameBoardView] match created', this.match.getState())
    const initialState = this.match.getState()
    this.localPlayerNumber = this.findPlayer(
      initialState,
      this.localParticipantId
    ).playerNumber
    this.remotePlayerNumber = this.findPlayer(
      initialState,
      this.remoteParticipantId
    ).playerNumber

    this.logger.info('[GameBoardView] creating board')
    this.createBoard()
    this.logger.info('[GameBoardView] creating heroes')
    this.createHeroes(initialState)
    this.logger.info('[GameBoardView] creating hero powers')
    this.createHeroPowers(initialState)
    this.logger.info('[GameBoardView] creating decks')
    this.createDecks()
    this.logger.info('[GameBoardView] creating opening layer')
    this.createOpeningLayer(initialState)
    this.logger.info('[GameBoardView] creating mulligan layer')
    this.createMulliganLayer()
    this.logger.info('[GameBoardView] creating turn controls')
    this.createTurnControls(initialState)
    this.logger.info('[GameBoardView] turn controls created')

    if (this.options.gameAssets.arrowBody) {
      this.attackLine.setBodyTexture(this.options.gameAssets.arrowBody)
    }
    window.addEventListener('keydown', this.handleWindowKeyDown)

    const localPlayer = this.findPlayer(initialState, this.localParticipantId)
    this.logger.info(
      '[GameBoardView] creating initial local cards',
      localPlayer.hand.length
    )
    await this.createInitialLocalCards(localPlayer.hand.map(cloneCard))
    this.logger.info('[GameBoardView] initial local cards created')

    const aiResult = this.match.dispatch({
      type: 'confirm-mulligan',
      participantId: this.remoteParticipantId,
      replaceInstanceIds: []
    })
    if (!aiResult.accepted) throw new Error(aiResult.message)
    this.remoteBackCount = this.findPlayer(
      aiResult.state,
      this.remoteParticipantId
    ).hand.length
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
    this.logger.info('[GameBoardView] playOpeningReveal start')
    await this.wait(OPENING_TIMING.versusHold)
    this.logger.info('[GameBoardView] versusHold done')
    await Promise.all([
      ...[...this.heroSprites.entries()].map(([participantId, sprite]) =>
        this.animateHeroToBoard(
          sprite,
          participantId === this.localParticipantId
            ? GAME_BOARD_LAYOUT.heroes.local
            : GAME_BOARD_LAYOUT.heroes.remote
        )
      ),
      this.fadeTo(this.openingLayer, 0, OPENING_TIMING.heroSettle)
    ])
    this.logger.info('[GameBoardView] hero settle done')
    this.openingLayer.visible = false
    this.deckLayer.visible = true
    this.remoteHandLayer.visible = true
    await this.wait(OPENING_TIMING.boardPause)
    this.logger.info('[GameBoardView] boardPause done, presenting mulligan')
    await this.presentMulligan()
    this.logger.info('[GameBoardView] presentMulligan done')
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
      const sprite = new Sprite(texture)
      applyAnchoredPlacement(sprite, intro)
      sprite.eventMode = 'none'
      this.heroSprites.set(player.participantId, sprite)
      this.heroLayer.addChild(sprite)
    }
  }

  /**
   * Builds both hero power cards in their final board positions. They show the
   * back face here and never move during the opening choreography; the first
   * turn's `opening-turn-started` flips them up.
   */
  private createHeroPowers(state: OpeningMatchState): void {
    for (const player of state.players) {
      const hero = HERO_CATALOG.require(player.heroId)
      const heroPower = HERO_POWER_CATALOG.require(hero.heroPowerId)
      const frontTexture =
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
        frontTexture,
        manaTexture: this.options.gameAssets.heroPowerMana,
        cost: player.heroPower.cost,
        onClick: isLocal ? () => void this.useHeroPower() : undefined
      })
      view.label = `hero-power:${player.participantId}`
      this.heroPowerViews.set(player.participantId, view)
      this.heroPowerLayer.addChild(view)
    }
  }

  private createDecks(): void {
    for (const position of [
      GAME_BOARD_LAYOUT.decks.local,
      GAME_BOARD_LAYOUT.decks.remote
    ] as const) {
      const deck = new Sprite(this.options.gameAssets.deck)
      applyAnchoredPlacement(deck, position)
      deck.eventMode = 'none'
      this.deckLayer.addChild(deck)
    }
  }

  /** Builds the end turn button and the deck card-count labels (hidden for now). */
  private createTurnControls(state: OpeningMatchState): void {
    this.endTurnButton = new Button(this.options.gameAssets.endTurn, {
      onClick: () => void this.endTurn()
    })
    applyPlacement(this.endTurnButton, GAME_BOARD_LAYOUT.endTurnButton)
    this.endTurnButton.setBaseY(GAME_BOARD_LAYOUT.endTurnButton.position.y)
    this.endTurnButton.setEnabled(false)
    this.turnLayer.addChild(this.endTurnButton)

    const localCount = this.createHudLabel(GAME_BOARD_LAYOUT.decks.localCount, 34)
    const remoteCount = this.createHudLabel(GAME_BOARD_LAYOUT.decks.remoteCount, 34)
    this.deckCountLabels = { local: localCount, remote: remoteCount }
    this.turnLayer.addChild(localCount, remoteCount)

    const localManaLabel = this.createHudLabel(GAME_BOARD_LAYOUT.mana.localLabel, 34)
    const remoteManaLabel = this.createHudLabel(GAME_BOARD_LAYOUT.mana.remoteLabel, 26)
    this.manaLabels = { local: localManaLabel, remote: remoteManaLabel }
    this.turnLayer.addChild(localManaLabel, remoteManaLabel)

    this.manaLocalTray = new ManaTray(
      this.options.gameAssets.manaCrystal,
      GAME_BOARD_LAYOUT.mana.crystals
    )
    this.turnLayer.addChild(this.manaLocalTray)

    this.syncTurnHud(state)
    this.turnLayer.visible = false
  }

  private createHudLabel(placement: LayoutPlacement, fontSize: number): Text {
    const label = new Text({
      text: '',
      style: {
        fontFamily: 'Belwe',
        fontSize,
        fill: 0xffffff,
        stroke: { color: 0x17120f, width: 6 },
        align: 'center'
      }
    })
    applyAnchoredPlacement(label, placement)
    label.eventMode = 'none'
    return label
  }

  /** Refreshes both deck card-count labels from the engine state. */
  private syncDeckCounts(state: OpeningMatchState): void {
    if (!this.deckCountLabels) return
    this.deckCountLabels.local.text = String(
      this.findPlayer(state, this.localParticipantId).deck.length
    )
    this.deckCountLabels.remote.text = String(
      this.findPlayer(state, this.remoteParticipantId).deck.length
    )
  }

  /** Refreshes both "available/maximum" mana labels from the engine state. */
  private syncMana(state: OpeningMatchState): void {
    if (!this.manaLabels) return
    const local = this.findPlayer(state, this.localParticipantId).mana
    const remote = this.findPlayer(state, this.remoteParticipantId).mana
    this.manaLabels.local.text = `${local.available}/${local.maximum}`
    this.manaLabels.remote.text = `${remote.available}/${remote.maximum}`
    this.syncManaTray(state)
  }

  /**
   * Refreshes the local mana crystal tray: full crystals cover `available`,
   * the tail up to `maximum` is consumed, and the first `localManaHighlightCost`
   * full crystals light up while a playable hand card is hovered or dragged.
   */
  private syncManaTray(state: OpeningMatchState): void {
    if (!this.manaLocalTray) return
    const local = this.findPlayer(state, this.localParticipantId).mana
    this.manaLocalTray.sync(
      resolveManaCrystalStates(local, this.localManaHighlightCost())
    )
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
    const cost = cardDefinition(entry.card).cost
    return cost <= this.localManaAvailable() ? cost : null
  }

  /** Refreshes every turn HUD element (deck counts and mana labels). */
  private syncTurnHud(state: OpeningMatchState): void {
    this.syncDeckCounts(state)
    this.syncMana(state)
    this.syncPlayableCardOutlines(state)
    this.syncHeroPowerViews(state)
    this.syncBoardAttackability(state)
    this.updateDeckTracker()
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
      // The cost label stays white today; future cost-changing effects will
      // tint it reduced (green) or increased (red) through `setCostColor`.
      view.setCostColor('normal')
      view.setEnabled(
        player.participantId === this.localParticipantId &&
          state.activePlayerId === this.localParticipantId &&
          player.heroPower.available &&
          player.mana.available >= player.heroPower.cost
      )
    }
  }

  /**
   * Local player clicked their hero power: the engine spends the mana and
   * exhausts the power (a future card effect will be presented alongside).
   * Rejections (e.g. mana changed under the cursor) only shake the card.
   */
  private async useHeroPower(): Promise<void> {
    if (this.turnInProgress) return
    const result = this.match.dispatch({
      type: 'use-hero-power',
      participantId: this.localParticipantId
    })
    if (!result.accepted) {
      this.logger.error(result.message)
      this.heroPowerViews.get(this.localParticipantId)?.playUnavailable()
      return
    }
    this.syncTurnHud(result.state)
    for (const event of result.events) await this.presentEvent(event)
  }

  /** Shows the green outline only on cards the local player can currently afford. */
  private syncPlayableCardOutlines(state: OpeningMatchState): void {
    const local = this.findPlayer(state, this.localParticipantId)
    const isLocalTurn = state.activePlayerId === this.localParticipantId
    const draggingEntry =
      this.draggingIndex === null ? undefined : this.handEntries[this.draggingIndex]

    for (const entry of this.handEntries) {
      const canPlay =
        isLocalTurn && cardDefinition(entry.card).cost <= local.mana.available
      entry.slot.setPlayableOutlineEnabled(canPlay)
      if (entry === draggingEntry) {
        this.dragPerspective?.setOutlineEnabled(canPlay)
      }
    }
  }

  /** Reflects whose turn it is in the end turn button's texture and enabled state. */
  private syncTurnControls(state: OpeningMatchState): void {
    if (!this.endTurnButton) return
    const isLocalTurn = state.activePlayerId === this.localParticipantId
    const localTurnTexture = isLocalTurn
      ? this.options.gameAssets.endTurn
      : this.options.gameAssets.enemyTurn
    if (this.endTurnButton.sprite.texture !== localTurnTexture) {
      this.endTurnButton.sprite.texture = localTurnTexture
    }
    this.endTurnButton.setEnabled(isLocalTurn && !this.turnInProgress)
  }

  /** Green outline when canAttack, Zzz when summoning sick; also wires board click. */
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
      const canAttack = canBoardMinionAttack(minion as BoardMinion, state, ownerId)
      const sleeping = hasSummoningSickness(minion as BoardMinion, state.turnNumber)
      // Local player never sees the opponent's attack-ready outline.
      const showCanAttack = canAttack && ownerId === this.localParticipantId
      view.setCanAttack(showCanAttack)
      view.setSleeping(sleeping && state.phase === 'turns')
      if (sleeping || !showCanAttack) {
        if (this.selectedMinionView === view) this.deselectAttacker()
      }
    }
  }

  private selectAttacker(view: MinionView): void {
    if (!view.isCanAttack()) return
    if (this.selectedMinionView === view) {
      this.deselectAttacker()
      return
    }
    if (this.selectedMinionView) {
      const previous = this.selectedMinionView
      previous.setSelected(false)
      this.tweenTo(previous, {
        y: previous.y + 12,
        duration: 0.18,
        ease: 'power2.inOut',
        overwrite: 'auto'
      })
      previous.zIndex = 0
    }
    this.selectedMinionView = view
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
  }

  private deselectAttacker(): void {
    if (this.selectedMinionView) {
      const view = this.selectedMinionView
      view.setSelected(false)
      this.tweenTo(view, {
        y: view.y + 12,
        duration: 0.18,
        ease: 'power2.inOut',
        overwrite: 'auto'
      })
      view.zIndex = 0
    }
    this.selectedMinionView = null
    this.attackLine.clear()
    this.options.cursor?.setTargeting(false)
  }

  private handleBoardPointerMove(event: FederatedPointerEvent): void {
    if (!this.selectedMinionView) return
    const parent = this.selectedMinionView.parent
    const from = parent
      ? parent.toGlobal(this.selectedMinionView.position)
      : this.selectedMinionView.getGlobalPosition()
    const to = { x: event.globalX, y: event.globalY }
    const localFrom = this.attackLineLayer.toLocal(from)
    const localTo = this.attackLineLayer.toLocal(to)
    this.attackLine.setEndpoints(localFrom, localTo)
    const angle = Math.atan2(to.y - from.y, to.x - from.x)
    this.options.cursor?.setTargetingAngle(angle)
  }

  /**
   * Local player clicked End Turn: hand the turn to the remote participant and
   * present the remote's draw. The button stays disabled until the AI passes
   * the turn back.
   */
  private async endTurn(): Promise<void> {
    if (this.turnInProgress) return
    this.turnInProgress = true
    this.endTurnButton.setEnabled(false)
    const result = this.match.dispatch({
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
    for (const event of result.events) await this.presentEvent(event)
  }

  /** AI plays random minions (cost ignored) then passes. */
  private async playAiRandomMinions(): Promise<void> {
    const state = this.match.getState()
    if (state.phase !== 'turns') return
    if (state.activePlayerId !== this.remoteParticipantId) return
    const remote = this.findPlayer(state, this.remoteParticipantId)
    if (remote.board.length >= MAX_BOARD_SIZE) return
    // TODO: AI currently ignores mana cost and plays any minion — replace with cost/mana-aware logic later.
    const minionCards = remote.hand.filter((card) => {
      const def = CARD_CATALOG.get(card.cardId)
      return def?.type === 'Minion'
    })
    if (minionCards.length === 0) return
    const pick = minionCards[Math.floor(Math.random() * minionCards.length)]
    if (!pick) return
    const position = Math.floor(Math.random() * (remote.board.length + 1))
    const result = this.match.dispatch({
      type: 'play-minion',
      participantId: this.remoteParticipantId,
      cardInstanceId: pick.instanceId,
      position
    })
    if (!result.accepted) return
    for (const event of result.events) await this.presentEvent(event)
    await this.wait(0.35)
    await this.playAiRandomMinions()
  }

  /** Waits, then the remote (AI) plays random minions and passes the turn back. */
  private async scheduleAiPass(): Promise<void> {
    await this.wait(TURN_TIMING.aiTurnDelay)
    if (!this.turnLayer.visible) return
    if (this.match.getState().activePlayerId !== this.remoteParticipantId) return
    await this.playAiRandomMinions()
    if (this.match.getState().activePlayerId !== this.remoteParticipantId) return
    const result = this.match.dispatch({
      type: 'end-turn',
      participantId: this.remoteParticipantId
    })
    if (!result.accepted) {
      this.logger.error(result.message)
      return
    }
    this.syncTurnHud(result.state)
    for (const event of result.events) await this.presentEvent(event)
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
    overlay.label = 'mulligan-dark-overlay'
    overlay.alpha = 0
    this.mulliganLayer.addChild(overlay)

    const announcement = new Sprite(this.options.gameAssets.mulliganAnnouncement)
    applyAnchoredPlacement(announcement, GAME_BOARD_LAYOUT.mulligan.announcement)
    announcement.label = 'mulligan-announcement'
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
          if (this.confirmationLocked || event.button !== 0) return
          const selected = !this.selectedIds.has(slot.instanceId)
          if (selected) this.selectedIds.add(slot.instanceId)
          else this.selectedIds.delete(slot.instanceId)
          slot.setSelected(selected)
          slot.setPlayableOutlineEnabled(!selected)
        })
        this.mulliganLayer.addChild(slot)
        return { card, slot, restTransform: undefined, displaced: false } as const
      })
    )
    for (const entry of entries) {
      this.handEntries.push(entry)
      this.initialSlots.push(entry.slot)
    }
  }

  private async createSlot(card: OpeningCard): Promise<GameCardSlot> {
    this.logger.info('[GameBoardView] createSlot start', card.cardId, card.instanceId)
    const definition = cardDefinition(card)
    this.logger.info('[GameBoardView] card definition', definition.id, definition.type)
    const artwork = await this.resolver.loadArtwork(card.cardId)
    this.logger.info(
      '[GameBoardView] artwork loaded',
      card.cardId,
      artwork ? 'ok' : 'null'
    )
    const view = await CardView.create(definition, this.resolver, { artwork })
    this.logger.info('[GameBoardView] CardView created', card.cardId, view.label)
    const outlineTexture = await this.resolver.load(
      CARD_PROFILES[view.plan.template].frame
    )
    this.logger.info(
      '[GameBoardView] outline texture loaded',
      CARD_PROFILES[view.plan.template].frame,
      outlineTexture ? `${outlineTexture.width}x${outlineTexture.height}` : 'null'
    )
    const slot = new GameCardSlot(
      view,
      card.instanceId,
      this.options.gameAssets.mulliganReplaceCross,
      this.options.gameAssets.mulliganReplacedLabel,
      outlineTexture
    )
    this.logger.info('[GameBoardView] GameCardSlot created', slot.label)
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
    this.remoteBacks.forEach((back, index) => {
      const visible = index < this.remoteBackCount
      back.visible = visible
      if (!visible) return
      back.position.set(
        GAME_BOARD_LAYOUT.remoteHand.centerX +
          (index - midpoint) * GAME_BOARD_LAYOUT.remoteHand.gap,
        GAME_BOARD_LAYOUT.remoteHand.baselineY
      )
      back.rotation = -(index - midpoint) * GAME_BOARD_LAYOUT.remoteHand.rotationStep
      back.scale.set(GAME_BOARD_LAYOUT.remoteHand.scale)
    })
  }

  private async presentMulligan(): Promise<void> {
    const announcement = this.mulliganLayer.getChildByLabel('mulligan-announcement')
    const overlay = this.mulliganLayer.getChildByLabel('mulligan-dark-overlay')
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
    this.confirmButton.visible = true
    this.confirmButton.setEnabled(true)
    for (const slot of this.initialSlots) slot.setPlayableOutlineEnabled(true)
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
    this.confirmButton.setEnabled(false)
    for (const entry of this.handEntries) {
      entry.slot.eventMode = 'none'
      entry.slot.setPlayableOutlineEnabled(false)
    }
    await this.wait(OPENING_TIMING.confirmationPause)
    const result = this.match.dispatch({
      type: 'confirm-mulligan',
      participantId: this.localParticipantId,
      replaceInstanceIds: [...this.selectedIds]
    })
    if (!result.accepted) {
      this.logger.error(result.message)
      this.confirmationLocked = false
      this.confirmButton.setEnabled(true)
      return
    }
    this.confirmButton.visible = false
    for (const event of result.events) await this.presentEvent(event)
    await this.wait(OPENING_TIMING.handoffPause)
    await this.fadeTo(this.mulliganLayer, 0, OPENING_TIMING.mulliganFade)
    this.mulliganLayer.visible = false
  }

  private async presentEvent(event: OpeningMatchEvent): Promise<void> {
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
      case 'card-burned':
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
      case 'minion-played':
        await this.presentMinionPlayed(event)
        return
      case 'dev-card-added':
        await this.presentDevCardAdded(event)
        return
      case 'dev-mana-set':
        this.syncTurnHud(this.match.getState())
        return
    }
  }

  async devAddCard(cardId: string): Promise<void> {
    if (!this.handModeActive)
      throw new Error('Dev add-card is only available after the opening sequence.')
    const definition = CARD_CATALOG.get(asCardId(cardId))
    if (!definition) throw new Error(`Unknown card ${cardId}`)
    const result = this.match.dispatch({
      type: 'dev-add-card',
      participantId: this.localParticipantId,
      cardId: definition.id
    })
    if (!result.accepted) throw new Error(result.message)
    for (const event of result.events) await this.presentEvent(event)
    this.syncTurnHud(result.state)
  }

  async devSetMana(available: number, maximum: number): Promise<void> {
    const result = this.match.dispatch({
      type: 'dev-set-mana',
      participantId: this.localParticipantId,
      available,
      maximum
    })
    if (!result.accepted) throw new Error(result.message)
    for (const event of result.events) await this.presentEvent(event)
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

  toggleDeckTracker(): void {
    this.logger.info('[GameBoardView] deck tracker toggle (disabled for debugging)')
  }

  private updateDeckTracker(): void {
    // Deck tracker disabled for debugging - see toggleDeckTracker
  }

  /**
   * First turn: both hero power cards flip from their backs to their fronts
   * (the cost gems appear). Runs once, on `opening-turn-started`.
   */
  private async presentHeroPowerReveal(): Promise<void> {
    if (this.heroPowerRevealed) return
    this.heroPowerRevealed = true
    await Promise.all([...this.heroPowerViews.values()].map((view) => view.flipUp()))
  }

  /** Flips one player's hero power up (new turn) or down (used this turn). */
  private async presentHeroPowerFlip(
    participantId: PlayerId,
    up: boolean
  ): Promise<void> {
    const view = this.heroPowerViews.get(participantId)
    if (!view) return
    if (up) await view.flipUp()
    else await view.flipDown()
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

  private async presentMinionPlayed(
    event: Extract<OpeningMatchEvent, { type: 'minion-played' }>,
    summonSlot?: GameCardSlot
  ): Promise<void> {
    const isLocal = event.participantId === this.localParticipantId
    const isRemote = event.participantId === this.remoteParticipantId
    if (!isLocal && !isRemote) return

    const definition = CARD_CATALOG.require(event.minion.cardId)
    const textures: MinionViewTextures = {
      frame: this.options.gameAssets.minionFrame,
      legendaryFrame: this.options.gameAssets.minionFrameLegendary,
      taunt: this.options.gameAssets.minionTaunt,
      divineShield: this.options.gameAssets.minionDivineShield,
      attack: this.options.gameAssets.minionAttack,
      health: this.options.gameAssets.minionHealth
    }
    const viewPromise = this.resolver.loadArtwork(event.minion.cardId).then((artwork) =>
      MinionView.create(
        {
          label: `minion:${event.minion.instanceId}`,
          attack: event.minion.attack,
          health: event.minion.health,
          legendary: definition.rarity === 'Legendary',
          taunt: false,
          divineShield: false
        },
        textures,
        artwork
      )
    )

    if (!summonSlot) {
      const view = await viewPromise
      view.instanceId = event.minion.instanceId
      view.ownerId = event.participantId
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
        return
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
      // Keep remote backs in sync: AI hand shrinks by one.
      this.remoteBackCount = Math.max(0, this.remoteBackCount - 1)
      this.layoutRemoteHand()
      this.syncBoardAttackability(this.match.getState())
      await this.completeTimeline(
        this.timeline().to(view, {
          alpha: 1,
          duration: BOARD_TIMING.minionSettle,
          ease: 'power2.out',
          overwrite: 'auto'
        })
      )
      return
    }

    const resting = layoutBoardRow(
      this.localMinionViews.length + 1,
      this.localBoardRowConfig()
    )[event.position]
    if (!resting) return

    const summon = GAME_BOARD_LAYOUT.boardMinions.summon
    const cardBottomY = resting.y + (CARD_CANVAS.height * summon.cardScale) / 2
    summonSlot.removeFromParent()
    summonSlot.zIndex = 2
    this.activeSummonSlots.add(summonSlot)
    this.summonLayer.addChild(summonSlot)

    const chargeState = { glow: 0.24, artwork: 1 }
    const charge = this.timeline()
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
    try {
      const [readyView] = await Promise.all([
        viewPromise,
        this.completeTimeline(charge)
      ])
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

      view.position.set(resting.x, resting.y + summon.minionStartYOffset)
      view.scale.set(resting.scale * summon.minionStartScaleMultiplier)
      view.alpha = 0
      view.zIndex = 1
      this.summonLayer.addChild(view)

      const ghostState = { details: 1, structure: 1, labels: 1 }
      this.prepareSummonGhost(summonSlot.card)
      const syncGhost = (): void => this.syncSummonGhost(summonSlot.card, ghostState)
      const impact = this.timeline()
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

      view.removeFromParent()
      view.instanceId = event.minion.instanceId
      view.ownerId = event.participantId
      view.setBaseScale(resting.scale)
      this.insertLocalMinionView(event.position, view)
      view.position.set(resting.x, resting.y)
      view.scale.set(resting.scale)
      view.alpha = 1
      this.wireMinionView(view)
      this.syncBoardAttackability(this.match.getState())
      view = null
    } finally {
      if (rays && !rays.destroyed) rays.destroy()
      if (view && !view.destroyed) view.destroy({ children: true })
      if (!summonSlot.destroyed) {
        summonSlot.disposePlayableOutline()
        summonSlot.removeFromParent()
        summonSlot.destroy({ children: true })
      }
      this.activeSummonSlots.delete(summonSlot)
    }
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
    view.on('pointertap', (event: FederatedPointerEvent) => {
      if (event.button !== 0) return
      // Only local attackable minions are selectable for now (no combat vs remote yet).
      if (view.ownerId !== this.localParticipantId) return
      if (!view.isCanAttack()) return
      this.selectAttacker(view)
      const parent = view.parent
      const from = parent ? parent.toGlobal(view.position) : view.getGlobalPosition()
      const localFrom = this.attackLineLayer.toLocal(from)
      const localTo = this.attackLineLayer.toLocal({
        x: event.globalX,
        y: event.globalY
      })
      const angle = Math.atan2(localTo.y - localFrom.y, localTo.x - localFrom.x)
      this.options.cursor?.setTargetingAngle(angle)
      this.attackLine.setEndpoints(localFrom, localTo)
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
    if (!this.turnLayer.visible) this.turnLayer.visible = true
    if (participantId === this.localParticipantId) {
      this.turnInProgress = false
      this.presentYourTurnFlag()
    }
    this.syncTurnControls(this.match.getState())
    if (participantId === this.remoteParticipantId) {
      void this.scheduleAiPass()
    }
  }

  /**
   * Shows the "Your turn" banner, always centred on the board: it fades in
   * while growing from a small scale up to full size, holds briefly, then fades
   * out. Fire-and-forget — turn flow and draw animations continue underneath
   * it. No sound.
   */
  private presentYourTurnFlag(): void {
    if (this.yourTurnFlag) {
      this.killTweensOf(this.yourTurnFlag)
      this.yourTurnFlag.destroy({ children: true })
      this.yourTurnFlag = null
    }
    const layout = GAME_BOARD_LAYOUT.yourTurnFlag
    const flag = new Sprite(this.options.gameAssets.yourTurn)
    applyAnchoredPlacement(flag, layout)
    flag.scale.set(GAME_BOARD_LAYOUT.yourTurnStartScale)
    flag.alpha = 0
    flag.label = 'your-turn-flag'
    flag.eventMode = 'none'
    this.turnLayer.addChild(flag)
    this.yourTurnFlag = flag

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
      if (this.yourTurnFlag !== flag || flag.destroyed) return
      this.yourTurnFlag = null
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
      slot.eventMode = 'none'
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
    const announcement = this.mulliganLayer.getChildByLabel('mulligan-announcement')
    const overlay = this.mulliganLayer.getChildByLabel('mulligan-dark-overlay')
    if (!announcement || !overlay)
      throw new Error('Mulligan presentation is unavailable.')
    await Promise.all([
      this.fadeTo(announcement, 0, OPENING_TIMING.mulliganFade),
      this.fadeTo(overlay, 0, OPENING_TIMING.mulliganFade)
    ])
  }

  private async addLocalCard(card: OpeningCard): Promise<void> {
    if (this.findEntry(card.instanceId)) return
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
    slot.eventMode = 'none'
    slot.position.set(deck.position.x, deck.position.y)
    slot.scale.set(
      GAME_BOARD_LAYOUT.cardTravel.slotScale.x,
      GAME_BOARD_LAYOUT.cardTravel.slotScale.y
    )
    slot.skew.set(sequence % 2 === 0 ? 0.3 : -0.3, -0.06)
    slot.rotation = sequence % 2 === 0 ? -0.08 : 0.08
    slot.alpha = 1
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
      slot.eventMode = 'static'
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
    const x =
      GAME_BOARD_LAYOUT.remoteHand.centerX +
      (index - midpoint) * GAME_BOARD_LAYOUT.remoteHand.gap
    const timeline = this.timeline()
    timeline.to(back, {
      x,
      y: GAME_BOARD_LAYOUT.remoteHand.baselineY,
      rotation: -(index - midpoint) * GAME_BOARD_LAYOUT.remoteHand.rotationStep,
      alpha: 1,
      duration,
      delay: staggerIndex * OPENING_TIMING.cardStagger,
      ease: 'power2.out'
    })
    timeline.to(
      back.scale,
      {
        x: GAME_BOARD_LAYOUT.remoteHand.scale,
        y: GAME_BOARD_LAYOUT.remoteHand.scale,
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
    if (!entry || cardDefinition(entry.card).type !== 'Minion') return null
    const state = this.match.getState()
    const localPlayer = this.findPlayer(state, this.localParticipantId)
    if (
      localPlayer.board.length >= MAX_BOARD_SIZE ||
      !isInDropZone(pointer, GAME_BOARD_LAYOUT.boardMinions.localDropZone)
    ) {
      return null
    }
    return resolveBoardInsertionIndex(
      pointer.x,
      localPlayer.board.length,
      this.localBoardRowConfig()
    )
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

  /** Resolves a carried card through the engine and presents an accepted play. */
  private resolveCardDrop(pointer: HandPointer): void {
    if (this.draggingIndex === null || this.dragReturning) return
    const index = this.draggingIndex
    const entry = this.handEntries[index]
    if (!entry) {
      this.endDrag()
      return
    }

    const definition = cardDefinition(entry.card)
    const state = this.match.getState()
    const localPlayer = this.findPlayer(state, this.localParticipantId)
    if (
      definition.type !== 'Minion' ||
      localPlayer.board.length >= MAX_BOARD_SIZE ||
      !isInDropZone(pointer, GAME_BOARD_LAYOUT.boardMinions.localDropZone)
    ) {
      this.endDrag()
      return
    }

    const position = resolveBoardInsertionIndex(
      pointer.x,
      localPlayer.board.length,
      this.localBoardRowConfig()
    )
    const result = this.match.dispatch({
      type: 'play-minion',
      participantId: this.localParticipantId,
      cardInstanceId: entry.card.instanceId,
      position
    })
    if (!result.accepted) {
      this.logger.error(result.message)
      this.endDrag()
      return
    }

    this.localBoardPreviewIndex = position
    this.applyLocalBoardLayout(position)

    // Set every input/reflow guard before the asynchronous presentation begins.
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

  private async presentAcceptedMinionPlay(
    index: number,
    entry: HandEntry,
    result: Extract<ReturnType<OpeningMatchInstance['dispatch']>, { accepted: true }>
  ): Promise<void> {
    try {
      this.handEntries.splice(index, 1)
      const handReflow = this.applyHandLayout({
        positionDuration: OPENING_TIMING.cardDeal,
        scaleDuration: OPENING_TIMING.cardDeal
      })
      const minionPlayed = result.events.find(
        (event): event is Extract<OpeningMatchEvent, { type: 'minion-played' }> =>
          event.type === 'minion-played'
      )
      const summon = minionPlayed
        ? this.presentMinionPlayed(minionPlayed, entry.slot)
        : Promise.resolve().then(() => {
            entry.slot.disposePlayableOutline()
            entry.slot.removeFromParent()
            entry.slot.destroy({ children: true })
          })
      await Promise.all([handReflow, summon])
      for (const event of result.events) {
        if (event !== minionPlayed) await this.presentEvent(event)
      }
      this.syncTurnHud(result.state)
    } finally {
      this.reflowing = false
      this.dragReturning = false
      this.localBoardPreviewIndex = null
      this.applyLocalBoardLayout()
      this.activateHandHover()
    }
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
    // Custom hitArea that excludes board minions to avoid blocking clicks.
    // Hand lies at the bottom; minions at y~415/610 should receive pointer events first.
    this.handLayer.hitArea = {
      contains: (x: number, y: number): boolean => {
        if (!handRect.contains(x, y)) return false
        // Exclude any point that is inside a local or remote minion bounds.
        for (const view of this.localMinionViews) {
          const halfW = (MINION_CANVAS.width * view.scale.x) / 2
          const halfH = (MINION_CANVAS.height * view.scale.y) / 2
          if (Math.abs(x - view.x) < halfW && Math.abs(y - view.y) < halfH) return false
        }
        for (const view of this.remoteMinionViews) {
          const halfW = (MINION_CANVAS.width * view.scale.x) / 2
          const halfH = (MINION_CANVAS.height * view.scale.y) / 2
          if (Math.abs(x - view.x) < halfW && Math.abs(y - view.y) < halfH) return false
        }
        return true
      }
    } as unknown as Rectangle
    this.handLayer.on('pointermove', (event: FederatedPointerEvent) => {
      if (!this.handModeActive || this.reflowing) return
      const local = event.getLocalPosition(this.handLayer)
      if (this.draggingIndex !== null) return
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
      this.updateLocalBoardPreview(this.dragPointer)
    })
    this.handLayer.on('rightdown', (event: FederatedPointerEvent) => {
      this.onHandRightDown(event)
    })
  }

  private cardCostAt(index: number): number {
    const entry = this.handEntries[index]
    return entry ? cardDefinition(entry.card).cost : Number.POSITIVE_INFINITY
  }

  private isLocalTurn(): boolean {
    return this.match.getState().activePlayerId === this.localParticipantId
  }

  private localManaAvailable(): number {
    return this.findPlayer(this.match.getState(), this.localParticipantId).mana
      .available
  }

  /**
   * Left click on the hand: resolve the card under the pointer and attach it to
   * the cursor if the local player can afford it on their turn, otherwise give
   * it a small "no" shake. Clicks on the opponent's turn are ignored.
   */
  private onHandPointerDown(event: FederatedPointerEvent): void {
    if (this.selectedMinionView) {
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
    if (resolved === null) {
      this.tryHeroPowerClick(local)
      return
    }
    if (!this.isLocalTurn()) return
    if (this.cardCostAt(resolved) > this.localManaAvailable()) {
      this.shakeCard(resolved)
      return
    }
    this.beginDrag(resolved, local)
  }

  /**
   * The hand layer's pointer hit zone spans the whole bottom strip and sits
   * above the hero power layer, so clicks over the local hero power land on
   * handLayer instead of the hero power view. Route them here: when the
   * pointer is over the currently interactive hero power, use it. The view's
   * own pointertap remains as a fallback for layouts that stop covering it.
   */
  private tryHeroPowerClick(local: HandPointer): void {
    const view = this.heroPowerViews.get(this.localParticipantId)
    if (!view?.isClickable()) return
    if (!view.containsCanvasPoint(local.x, local.y)) return
    void this.useHeroPower()
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
  private beginDrag(index: number, pointer: HandPointer): void {
    const entry = this.handEntries[index]
    const rest = entry?.restTransform
    if (!entry || !rest) return
    this.draggingIndex = index
    this.dragPointer = { ...pointer }
    this.dragStartPointer = { ...pointer }
    this.dragMovedBeyondThreshold = false
    this.dragReturning = false
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
          // In-hand playable cards wear the green outline; the card switches
          // to blue once it is selected and warps around under the cursor.
          outlineColor: 'blue',
          outlineProfile: OUTLINE_PROFILES.card
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
    timeline.to(slot, { x: baseX, duration: stepDuration, ease: 'power1.inOut' })
  }

  override dispose(): void {
    window.removeEventListener('pointerdown', this.handleWindowPointerDown, true)
    window.removeEventListener('pointerup', this.handleWindowPointerUp, true)
    window.removeEventListener('blur', this.handleWindowBlur)
    window.removeEventListener('keydown', this.handleWindowKeyDown)
    this.options.cursor?.setContextVariant(null)
    this.options.cursor?.setTargeting(false)
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
    this.manaLocalTray?.dispose()
    this.manaLocalTray = null
    for (const view of this.localMinionViews) {
      view.removeFromParent()
      view.destroy({ children: true })
    }
    this.localMinionViews.length = 0
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
            ? 0.05
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
    slot.eventMode = 'none'
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

  private animateHeroToBoard(sprite: Sprite, target: LayoutPlacement): Promise<void> {
    const timeline = this.timeline()
    timeline.to(sprite, {
      x: target.position.x,
      y: target.position.y,
      duration: OPENING_TIMING.heroSettle,
      ease: 'power2.inOut'
    })
    timeline.to(
      sprite.scale,
      {
        x: target.scale?.x ?? 1,
        y: target.scale?.y ?? 1,
        duration: OPENING_TIMING.heroSettle,
        ease: 'power2.inOut'
      },
      0
    )
    return this.completeTimeline(timeline)
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
    slot.eventMode = 'none'
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
