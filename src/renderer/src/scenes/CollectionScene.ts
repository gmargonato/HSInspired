import {
  AlphaFilter,
  ColorMatrixFilter,
  Container,
  Graphics,
  PerspectiveMesh,
  Rectangle,
  Sprite,
  Text,
  Texture
} from 'pixi.js'
import type { FederatedPointerEvent, FederatedWheelEvent } from 'pixi.js'
import { CARD_CATALOG, type CardDefinition } from '../../../game/content/cards'
import { CardAssetResolver } from '../ui/asset-registry/card-asset-resolver'
import { CardView } from '../rendering/cards/card-view'
import { Scene } from './Scene'
import { GAME_HEIGHT, GAME_WIDTH } from '../app/config'
import {
  ASSET_BUNDLE_IDS,
  CollectionAssets,
  SharedUIAssets
} from '../ui/asset-registry'
import type { CursorContextVariant } from '../ui/components/cursor'
import type { DeckStore } from '../features/deck-builder/deck-store'
import { NewDeckView } from '../features/deck-builder/NewDeckView'
import {
  DECK_FRAME_ASSET_KEYS,
  type DeckFrameAssetKey
} from '../features/deck-builder/deck-frames'
import {
  animateHingedDoor,
  createHingedDoorMesh,
  updateHingedDoor
} from '../features/collection/choreography/hinged-door'
import { HERO_CATALOG } from '../../../game/content/heroes'
import type { AudioService, SoundEffectId } from '../app/audio'
import type { AppLogger, DialogService } from '../app/services'
import { Button } from '../ui/components/Button'
import {
  buildCollectionPages,
  type CollectionPage
} from '../features/collection/collection-pages'
import {
  formatManaFilterLabel,
  MANA_FILTER_VALUES,
  type ManaFilterValue
} from '../features/collection/collection-filters'
import { queryCollectionCards } from '../features/collection/collection-query'
import {
  buildDeckEditorEntries,
  shouldAnimateDeckRowRemoval
} from '../features/collection/deck-editor-model'
import {
  getCollectionCardPlacement,
  type CollectionCardGridLayout
} from '../features/collection/collection-card-grid'
import { CollectionSearchInput } from '../features/collection/search-input'
import { buildCollectionDeckListEntries } from '../features/collection/deck-list-model'
import { CollectionDeckController } from '../features/collection/collection-deck-controller'
import { CollectionQueryController } from '../features/collection/collection-query-controller'
import type { CardPreviewRouteBounds, SceneRouter } from '../app/router'
import {
  MAX_DECK_CARDS,
  MAX_DECKS,
  countDeckCards,
  getCardCopyLimit,
  getDeckCardCount,
  type Deck
} from '../../../game/decks'
import type { DeckClass } from '../../../game/content/cards'

const PAGE_LEFT = 250
const PAGE_TOP = 80
const PAGE_RIGHT = 1380
const PAGE_BOTTOM = GAME_HEIGHT - 80
const PAGE_CENTER_X = (PAGE_LEFT + PAGE_RIGHT) / 2
const PAGE_HEIGHT = PAGE_BOTTOM - PAGE_TOP
const PAGE_NAV_ZONE_WIDTH = 90

const COLLECTION_PAGE_FLIP_FORWARD_SOUNDS = [
  'collection-page-flip-forward',
  'collection-page-flip-forward-3'
] as const
const COLLECTION_PAGE_FLIP_BACK_SOUNDS = [
  'collection-page-flip-back',
  'collection-page-flip-back-3'
] as const

// Manual nudges only. Keep the lock position relative to the cover so the two
// assets stay aligned when the main collection panel is moved during layout.
// These starting values line the 1157x1080 cover up with the center panel of
// the 1920x1080 collection background.
const Layout = {
  page: {
    x: PAGE_LEFT,
    y: PAGE_TOP,
    width: PAGE_RIGHT - PAGE_LEFT,
    height: PAGE_HEIGHT
  },
  classLabel: { x: PAGE_CENTER_X, y: 115 },
  pageLabel: { x: PAGE_CENTER_X, y: 940 },
  cardGrid: { x: 305, y: 145, width: 1000, height: 770 },
  // Collection filter positions are in the 1920x1080 scene coordinate space.
  // Keep these values together so visual alignment can be tuned without
  // changing filter behavior.
  collectionFilters: {
    mana: {
      firstCrystalCenter: { x: 450, y: 1030 },
      gap: 65,
      crystal: { width: 44, height: 52 },
      rotation: Math.PI / 2,
      labelOffset: { x: 0, y: 0 }
    },
    searchInput: { x: 1090, y: 1006, width: 205, height: 43 },
    searchClear: { x: 1323, y: 1026, width: 30, height: 30 },
    noResults: { x: PAGE_CENTER_X, y: 480 }
  },
  cover: { x: 242, y: 0 },
  coverLock: { x: 905, y: 418 },
  deckList: { x: 1404, y: 120, width: 283, height: 870 },
  deckSlider: { x: 1705, minY: 50, maxY: 900 }
}

const DECK_EDITOR_CARD_ROW_HEIGHT = 34
const DECK_EDITOR_CARD_ROW_GAP = 1
const DECK_EDITOR_ROW_INSET = 2
const DECK_EDITOR_CARD_LIST_VISIBLE_ROWS = 25
const DECK_EDITOR_CARD_LIST_HEIGHT =
  DECK_EDITOR_CARD_ROW_HEIGHT * DECK_EDITOR_CARD_LIST_VISIBLE_ROWS +
  DECK_EDITOR_ROW_INSET

const DECK_EDITOR_LAYOUT = {
  header: {
    x: Layout.deckList.x + Layout.deckList.width / 2,
    y: 64
  },
  count: { x: 1495, y: 1038 },
  cardList: {
    x: Layout.deckList.x + 10,
    y: 132,
    width: Layout.deckList.width - 20,
    height: DECK_EDITOR_CARD_LIST_HEIGHT
  },
  footerButton: { x: 1660, y: 1038 }
}

const CARD_GRID_COLUMNS = 4
const CARD_GRID_ROWS = 2
const CARD_SLOT_PADDING_X = 10
const CARD_SLOT_PADDING_Y = 12
const CARD_GRID_LAYOUT: CollectionCardGridLayout = {
  ...Layout.cardGrid,
  columns: CARD_GRID_COLUMNS,
  rows: CARD_GRID_ROWS,
  paddingX: CARD_SLOT_PADDING_X,
  paddingY: CARD_SLOT_PADDING_Y
}
const COVER_LOCK_OPEN_DURATION = 0.45
const COVER_OPEN_DURATION = 0.6
const DOOR_MIN_WIDTH = 1
const COVER_LOCK_PERSPECTIVE_DEPTH = 10
const COVER_PERSPECTIVE_DEPTH = 14
const DECK_BUTTON_HEIGHT = 151
// The button textures include transparent padding around their visible frames.
// A negative layout gap brings the visible frames closer together.
const DECK_BUTTON_GAP = -30
const DECK_EDITOR_COST_WIDTH = 27
const DECK_EDITOR_COPIES_WIDTH = 24
const DECK_EDITOR_TRANSITION_DURATION = 0.45
const DECK_EDITOR_CONTENT_FADE_DURATION = 0.2
const DECK_EDITOR_FRAME_TARGET_WIDTH = Layout.deckList.width
const DECK_EDITOR_FRAME_CARD_LIST_GAP = 4
const DECK_EDITOR_ROW_REMOVE_DURATION = 0.22
const DECK_EDITOR_ROW_COLLAPSE_DURATION = 0.18
const DECK_EDITOR_FULL_WARNING_DURATION = 1800
const DECK_EDITOR_FULL_WARNING_FONT_SIZE = 64
const DECK_EDITOR_FULL_WARNING_STROKE_WIDTH = 6
const DECK_EDITOR_PREVIEW = {
  maxWidth: 190,
  maxHeight: 345,
  gap: 18,
  viewportPadding: 16
}
const COMPLETED_COLLECTION_CARD_ALPHA = 0.25
const DECK_EDITOR_COUNT_FILL = 0xffffff
const DECK_EDITOR_ERROR_FILL = 0xff9a9a
const MANA_FILTER_SELECTED_BRIGHTNESS = 2
const FULL_VIEWPORT = {
  x: 0,
  y: 0,
  width: GAME_WIDTH,
  height: GAME_HEIGHT
}

type CollectionDeckAssetKey =
  'loadDeckButton' | 'newDeckButton' | 'verticalSlider' | DeckFrameAssetKey

/** Full-viewport collection scene presented through the main menu transition. */
export class CollectionScene extends Scene {
  private pages: readonly CollectionPage[] = buildCollectionPages(CARD_CATALOG.all)
  private readonly collectionQuery = new CollectionQueryController()
  private previousCollectionClassFilter: DeckClass | null = null
  private readonly cardResolver = new CardAssetResolver()
  private completedCollectionCardAlphaFilter: AlphaFilter | null = null

  private background!: Sprite
  private pageContent!: Container
  private cardLayer!: Container
  private deckViewport!: Container
  private deckContent!: Container
  private deckMask!: Graphics
  private deckSlider!: Sprite
  private deckEditorLayer!: Container
  private deckEditorCardViewport!: Container
  private deckEditorButton!: Button
  private deckEditorCount!: Text
  private deckFullWarning!: Text
  private deckEditorDoneButton!: Button
  private deckEditorCardContent!: Container
  private deckListCount!: Text
  private collectionBackButton!: Button
  private newDeckScene!: NewDeckView
  private readonly deckEntries: Container[] = []
  private readonly deckButtons: Button[] = []
  private newDeckButton: Button | null = null
  private deckScrollOffset = 0
  private deckMaxScroll = 0
  private deckEditorCardScrollOffset = 0
  private deckEditorCardMaxScroll = 0
  private deckSliderDragging = false
  private deckSliderDragOffset = 0
  private activeDeckId: string | null = null
  private deckEditorOrigin: { x: number; y: number } | null = null
  private deckEditorTransitioning = false
  private deckEditorClosing = false
  private deckEditorTransitionSequence = 0
  private deckEditorTransitionTimeline: gsap.core.Timeline | null = null
  private deckEditorTransitionResolve: (() => void) | null = null
  private deckEditorRenderSequence = 0
  private deckEditorCountFeedbackTimer: ReturnType<typeof setTimeout> | null = null
  private deckFullWarningTimer: ReturnType<typeof setTimeout> | null = null
  private deckEditorCardMutationInProgress = false
  private deckEditorCardPreview: CardView | null = null
  private deckEditorCardPreviewRequest = 0
  private unsubscribeDeckStore: (() => void) | null = null
  private deckAssets!: Pick<CollectionAssets, CollectionDeckAssetKey>
  private collectionFilterLayer!: Container
  private emptyStateImage!: Sprite
  private searchInput: CollectionSearchInput | null = null
  private searchClearButton!: Sprite
  private readonly manaFilterControls: Container[] = []
  private readonly manaFilterCrystals: Sprite[] = []
  private readonly manaFilterLabels: Text[] = []
  private manaFilterHighlightFilter: ColorMatrixFilter | null = null
  private classLabel!: Text
  private pageLabel!: Text
  private previousPageZone!: Container
  private nextPageZone!: Container
  private cover!: PerspectiveMesh
  private coverLock!: PerspectiveMesh
  private coverRevealPromise: Promise<void> | null = null
  private pageIndex = 0
  private renderSequence = 0
  private pageLoading = false
  private navigationEnabled = false
  private navigationReady = false
  private hoveredPageZone: CursorContextVariant | null = null
  private pageHoverSequence = 0
  private cardPreviewOpening = false
  private disposed = false
  private readonly deckController: CollectionDeckController

  constructor(
    deckStore: DeckStore,
    private readonly router?: SceneRouter,
    private readonly audio?: AudioService,
    private readonly dialogs: DialogService = {
      confirm: () => true,
      error: () => undefined
    },
    private readonly logger: AppLogger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    }
  ) {
    super()
    this.deckController = new CollectionDeckController(deckStore, (message) =>
      this.dialogs.confirm(message)
    )
  }

  private reportError(message: string, error?: unknown): void {
    this.logger.error(message, error)
    this.dialogs.error(message)
  }

  private reportWarning(message: string, error?: unknown): void {
    this.logger.warn(message, error)
  }

  async init(): Promise<void> {
    const assets = await this.assetScope.acquire<CollectionAssets>(
      ASSET_BUNDLE_IDS.collection
    )
    const sharedAssets = await this.assetScope.acquire<SharedUIAssets>(
      ASSET_BUNDLE_IDS.sharedUI
    )

    this.background = new Sprite(assets.background)
    this.background.width = GAME_WIDTH
    this.background.height = GAME_HEIGHT
    this.root.addChild(this.background)

    this.pageContent = new Container()
    this.root.addChild(this.pageContent)

    this.cardLayer = new Container()
    this.pageContent.addChild(this.cardLayer)

    this.classLabel = new Text({
      text: '',
      style: {
        fontFamily: 'Belwe',
        fontSize: 38,
        fill: 0x19130e,
        align: 'center'
      }
    })
    this.classLabel.anchor.set(0.5)
    this.classLabel.position.set(Layout.classLabel.x, Layout.classLabel.y)
    this.classLabel.eventMode = 'none'
    this.pageContent.addChild(this.classLabel)

    this.pageLabel = new Text({
      text: '',
      style: {
        fontFamily: 'Belwe',
        fontSize: 28,
        fill: 0x806d4f,
        align: 'center'
      }
    })
    this.pageLabel.anchor.set(0.5)
    this.pageLabel.position.set(Layout.pageLabel.x, Layout.pageLabel.y)
    this.pageLabel.eventMode = 'none'
    this.pageContent.addChild(this.pageLabel)

    this.emptyStateImage = new Sprite(assets.searchNoResults)
    this.emptyStateImage.anchor.set(0.5)
    this.emptyStateImage.position.set(
      Layout.collectionFilters.noResults.x,
      Layout.collectionFilters.noResults.y
    )
    this.emptyStateImage.eventMode = 'none'
    this.emptyStateImage.visible = false
    this.pageContent.addChild(this.emptyStateImage)

    this.previousPageZone = this.createPageZone(
      PAGE_LEFT,
      PAGE_NAV_ZONE_WIDTH,
      'collection-previous-page',
      () => this.changePage(-1)
    )
    this.nextPageZone = this.createPageZone(
      PAGE_RIGHT - PAGE_NAV_ZONE_WIDTH,
      PAGE_NAV_ZONE_WIDTH,
      'collection-next-page',
      () => this.changePage(1)
    )
    this.pageContent.addChild(this.previousPageZone)
    this.pageContent.addChild(this.nextPageZone)

    // The cover is hinged on its left edge. The separate lock is hinged on
    // its right edge, matching the direction shown in the reference images.
    this.cover = createHingedDoorMesh(assets.cover, 'left', Layout.cover)
    this.root.addChild(this.cover)

    this.coverLock = createHingedDoorMesh(assets.coverLock, 'right', {
      x: Layout.cover.x + Layout.coverLock.x,
      y: Layout.cover.y + Layout.coverLock.y
    })
    this.root.addChild(this.coverLock)

    // Keep the closed doors visible while SceneTransitionHost presents this
    // scene in the inset. The afterTransition callback only starts their
    // opening animation after the destination reaches the full viewport.
    this.cover.visible = true
    this.coverLock.visible = true
    updateHingedDoor(this.cover, 'left', 0, COVER_PERSPECTIVE_DEPTH, DOOR_MIN_WIDTH)
    updateHingedDoor(
      this.coverLock,
      'right',
      0,
      COVER_LOCK_PERSPECTIVE_DEPTH,
      DOOR_MIN_WIDTH
    )

    if (this.pages.length === 0) {
      throw new Error('Collection has no cards to display')
    }

    this.setNavigationEnabled(false)
    await this.deckController.load()
    await this.waitForFonts()
    this.createCollectionFilters(assets)
    this.createDeckList(assets)
    this.createDeckEditor(assets, sharedAssets)
    this.createCollectionBackButton(sharedAssets)
    this.newDeckScene = new NewDeckView(
      this.deckController,
      {
        onClassSelected: (hero) =>
          this.handleNewDeckHeroSelected(hero.classId as DeckClass),
        onCancelled: () => this.handleNewDeckCreationCancelled(),
        onDeckCreated: (deck) => this.handleNewDeckCreated(deck)
      },
      this.audio,
      this.logger
    )
    await this.newDeckScene.mount()
    this.root.addChild(this.newDeckScene)
    await this.renderPage(0)
    this.unsubscribeDeckStore = this.deckController.subscribe(
      this.handleDeckStoreChanged
    )
  }

  /**
   * Runs the collection reveal exactly once for this scene instance.
   *
   * The transition manager awaits this promise, which guarantees that the
   * lock finishes opening before the larger cover starts moving.
   */
  playCoverReveal(): Promise<void> {
    if (this.coverRevealPromise) return this.coverRevealPromise

    this.coverRevealPromise = this.revealCover()
    return this.coverRevealPromise
  }

  private async revealCover(): Promise<void> {
    this.cover.visible = true
    this.coverLock.visible = true

    this.audio?.play('collection-latch')
    await animateHingedDoor(
      (vars) => this.timeline(vars),
      this.coverLock,
      'right',
      COVER_LOCK_OPEN_DURATION,
      COVER_LOCK_PERSPECTIVE_DEPTH
    )
    this.coverLock.visible = false

    this.audio?.play('collection-cover-open')
    await animateHingedDoor(
      (vars) => this.timeline(vars),
      this.cover,
      'left',
      COVER_OPEN_DURATION,
      COVER_PERSPECTIVE_DEPTH
    )
    this.cover.visible = false
    this.setSearchInputVisible(true)

    if (!this.disposed) {
      this.navigationReady = true
      this.setNavigationEnabled(true)
      this.setDeckInteractionEnabled(true)
    }
  }

  private async waitForFonts(): Promise<void> {
    if (!document.fonts) return

    await Promise.all([
      document.fonts.load('38px Belwe'),
      document.fonts.load('38px "Arial Narrow"'),
      document.fonts.load('400 27px "Franklin Gothic Condensed"'),
      document.fonts.load('700 27px "Franklin Gothic Condensed"')
    ])
  }

  private createCollectionFilters(assets: CollectionAssets): void {
    this.collectionFilterLayer = new Container()
    this.pageContent.addChild(this.collectionFilterLayer)

    for (const [index, value] of MANA_FILTER_VALUES.entries()) {
      const control = new Container()
      control.position.set(
        Layout.collectionFilters.mana.firstCrystalCenter.x +
          index * Layout.collectionFilters.mana.gap,
        Layout.collectionFilters.mana.firstCrystalCenter.y
      )
      control.hitArea = new Rectangle(-30, -52, 60, 96)
      control.eventMode = 'static'
      control.cursor = 'pointer'
      control.on('pointertap', (event: FederatedPointerEvent) => {
        event.stopPropagation()
        this.handleManaFilterTap(value)
      })

      const crystal = new Sprite(assets.manaCrystal)
      crystal.anchor.set(0.5)
      crystal.width = Layout.collectionFilters.mana.crystal.width
      crystal.height = Layout.collectionFilters.mana.crystal.height
      crystal.rotation = Layout.collectionFilters.mana.rotation
      crystal.eventMode = 'none'
      control.addChild(crystal)

      const label = new Text({
        text: formatManaFilterLabel(value),
        style: {
          fontFamily: 'Belwe',
          fontSize: 24,
          fill: 0xffffff,
          stroke: { color: 0x000000, width: 4 },
          align: 'center'
        }
      })
      label.anchor.set(0.5)
      label.position.set(
        Layout.collectionFilters.mana.labelOffset.x,
        Layout.collectionFilters.mana.labelOffset.y
      )
      label.eventMode = 'none'
      control.addChild(label)

      this.manaFilterControls.push(control)
      this.manaFilterCrystals.push(crystal)
      this.manaFilterLabels.push(label)
      this.collectionFilterLayer.addChild(control)
    }

    this.searchClearButton = new Sprite(assets.searchClear)
    this.searchClearButton.anchor.set(0.5)
    this.searchClearButton.position.set(
      Layout.collectionFilters.searchClear.x,
      Layout.collectionFilters.searchClear.y
    )
    this.searchClearButton.width = Layout.collectionFilters.searchClear.width
    this.searchClearButton.height = Layout.collectionFilters.searchClear.height
    this.searchClearButton.hitArea = new Rectangle(-26, -26, 52, 52)
    this.searchClearButton.eventMode = 'static'
    this.searchClearButton.cursor = 'pointer'
    this.searchClearButton.visible = false
    this.searchClearButton.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation()
      this.clearSearch()
    })
    this.collectionFilterLayer.addChild(this.searchClearButton)

    this.updateManaFilterAppearance()
    this.createSearchInput()
  }

  private createSearchInput(): void {
    const parent = this.appInstance.canvas.parentElement
    if (!parent) return

    this.searchInput = new CollectionSearchInput({
      canvas: this.appInstance.canvas,
      parent,
      bounds: Layout.collectionFilters.searchInput,
      onInput: this.handleSearchInput
    })
    this.searchInput.mount(this.collectionQuery.searchQuery)
    this.setSearchInputVisible(false)
  }

  private readonly handleSearchInput = (value: string): void => {
    this.collectionQuery.setSearchQuery(value)
    this.updateSearchClearVisibility()
    void this.applyCollectionFilters().catch((error: unknown) => {
      this.reportError('Failed to filter the collection.', error)
    })
  }

  private clearSearch(): void {
    if (!this.searchInput) return

    this.searchInput.setValue('')
    this.collectionQuery.setSearchQuery('')
    this.updateSearchClearVisibility()
    this.searchInput.focus()
    void this.applyCollectionFilters().catch((error: unknown) => {
      this.reportError('Failed to clear the collection search.', error)
    })
  }

  private updateSearchClearVisibility(): void {
    this.searchClearButton.visible = this.collectionQuery.searchQuery.length > 0
  }

  private setSearchInputVisible(visible: boolean): void {
    this.searchInput?.setVisible(visible)
  }

  private setSearchInputEnabled(enabled: boolean): void {
    this.searchInput?.setEnabled(enabled)
  }

  private handleManaFilterTap(value: ManaFilterValue): void {
    if (
      !this.navigationReady ||
      !this.navigationEnabled ||
      this.activeDeckId !== null ||
      this.newDeckScene?.isOpen
    ) {
      return
    }

    this.collectionQuery.toggleManaFilter(value)
    this.updateManaFilterAppearance()
    void this.applyCollectionFilters().catch((error: unknown) => {
      this.reportError('Failed to filter the collection.', error)
    })
  }

  private updateManaFilterAppearance(): void {
    for (const [index, control] of this.manaFilterControls.entries()) {
      const value = MANA_FILTER_VALUES[index]
      const isActive = value === this.collectionQuery.manaFilter
      const crystal = this.manaFilterCrystals[index]
      const label = this.manaFilterLabels[index]
      if (!crystal || !label) continue

      crystal.alpha = 1
      crystal.filters = isActive ? [this.getManaFilterHighlightFilter()] : null
      label.alpha = 1
      control.cursor = 'pointer'
    }
  }

  private getManaFilterHighlightFilter(): ColorMatrixFilter {
    if (!this.manaFilterHighlightFilter) {
      const filter = new ColorMatrixFilter()
      filter.brightness(MANA_FILTER_SELECTED_BRIGHTNESS, false)
      this.manaFilterHighlightFilter = filter
    }

    return this.manaFilterHighlightFilter
  }

  private async applyCollectionClassFilter(heroClass: DeckClass | null): Promise<void> {
    if (this.collectionQuery.classFilter === heroClass && this.pages.length > 0) return

    this.collectionQuery.setClassFilter(heroClass)
    await this.applyCollectionFilters()
  }

  private async applyCollectionFilters(): Promise<void> {
    const filteredCards = queryCollectionCards(
      CARD_CATALOG.all,
      this.collectionQuery.snapshot()
    )
    const pages = buildCollectionPages(filteredCards)

    this.pages = pages
    this.pageIndex = 0
    if (pages.length === 0) {
      this.renderEmptyCollectionState()
      return
    }

    this.emptyStateImage.visible = false
    await this.renderPage(0)
  }

  private renderEmptyCollectionState(): void {
    this.renderSequence += 1
    this.pageLoading = false

    const previousCardLayer = this.cardLayer
    this.cardLayer = new Container()
    this.pageContent.removeChild(previousCardLayer)
    this.pageContent.addChildAt(this.cardLayer, 0)
    previousCardLayer.destroy({ children: true })

    this.classLabel.text = ''
    this.pageLabel.text = ''
    this.emptyStateImage.visible = true
    this.updatePageZoneModes()
  }

  private async renderPage(index: number): Promise<void> {
    const page = this.pages[index]
    if (!page) throw new Error(`Collection page does not exist: ${index}`)

    const sequence = ++this.renderSequence
    this.pageLoading = true
    // Keep the page zones interactive while the card artwork is loading. The
    // page-loading guard still rejects duplicate taps, while leaving the
    // zones mounted preserves their hover state when the pointer is stationary.

    const nextCardLayer = new Container()
    try {
      const results = await Promise.allSettled(
        page.cards.map(async (card) => {
          const artwork = await this.cardResolver.loadArtwork(card.id)
          return CardView.create(card, this.cardResolver, { artwork })
        })
      )
      const views = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : []
      )
      const failedResult = results.find((result) => result.status === 'rejected')

      if (failedResult && failedResult.status === 'rejected') {
        this.destroyCardViews(views)
        throw failedResult.reason
      }

      if (this.disposed || sequence !== this.renderSequence) {
        this.destroyCardViews(views)
        return
      }

      for (const [cardIndex, view] of views.entries()) {
        const card = page.cards[cardIndex]
        if (card) {
          view.on('pointertapcapture', (event: FederatedPointerEvent) =>
            this.handleCollectionCardTap(event, card)
          )
          view.on('rightclick', (event: FederatedPointerEvent) =>
            this.handleCollectionCardPreview(event, card, view)
          )
        }
        this.layoutCard(view, cardIndex)
        nextCardLayer.addChild(view)
      }

      const previousCardLayer = this.cardLayer
      this.pageContent.removeChild(previousCardLayer)
      this.cardLayer = nextCardLayer
      this.pageContent.addChildAt(nextCardLayer, 0)
      previousCardLayer.destroy({ children: true })

      this.pageIndex = index
      this.updatePageLabels(page)
      this.updateCollectionCardCompletionState()
    } finally {
      if (sequence === this.renderSequence) {
        this.pageLoading = false
        if (!this.disposed) this.updatePageZoneModes()
      }
    }
  }

  private layoutCard(view: CardView, cardIndex: number): void {
    const placement = getCollectionCardPlacement(
      cardIndex,
      view.plan.width,
      view.renderedHeight,
      CARD_GRID_LAYOUT
    )
    view.scale.set(placement.scale)
    view.position.set(placement.x, placement.y)
  }

  private destroyCardViews(views: readonly CardView[]): void {
    for (const view of views) {
      view.destroy({ children: true })
    }
  }

  private updatePageLabels(page: CollectionPage): void {
    this.classLabel.text = page.cardClass
    this.pageLabel.text = `Page ${page.pageNumber}`
  }

  private createDeckList(assets: CollectionAssets): void {
    this.deckAssets = assets

    this.deckMask = new Graphics()
      .rect(0, 0, Layout.deckList.width, Layout.deckList.height)
      .fill({ color: 0xffffff })
    this.deckMask.position.set(Layout.deckList.x, Layout.deckList.y)
    this.deckMask.eventMode = 'none'
    this.root.addChild(this.deckMask)

    this.deckViewport = new Container()
    this.deckViewport.position.set(Layout.deckList.x, Layout.deckList.y)
    this.deckViewport.hitArea = new Rectangle(
      0,
      0,
      Layout.deckList.width,
      Layout.deckList.height
    )
    this.deckViewport.eventMode = 'none'
    this.deckViewport.on('wheel', this.handleDeckWheel)

    this.deckContent = new Container()
    this.deckViewport.addChild(this.deckContent)
    this.deckViewport.mask = this.deckMask
    this.root.addChild(this.deckViewport)

    this.deckSlider = new Sprite(this.deckAssets.verticalSlider)
    this.deckSlider.position.set(Layout.deckSlider.x, Layout.deckSlider.minY)
    this.deckSlider.eventMode = 'none'
    this.deckSlider.cursor = 'pointer'
    this.deckSlider.on('pointerdown', this.startDeckSliderDrag)
    this.deckSlider.on('globalpointermove', this.handleDeckSliderMove)
    this.deckSlider.on('pointerup', this.stopDeckSliderDrag)
    this.deckSlider.on('pointerupoutside', this.stopDeckSliderDrag)
    this.deckSlider.on('pointercancel', this.stopDeckSliderDrag)
    this.root.addChild(this.deckSlider)

    this.deckListCount = new Text({
      text: '',
      style: {
        fontFamily: 'Belwe',
        fontSize: 24,
        fill: DECK_EDITOR_COUNT_FILL,
        stroke: { color: 0x000000, width: 4 },
        letterSpacing: -1,
        align: 'center'
      }
    })
    this.deckListCount.anchor.set(0.5)
    this.deckListCount.eventMode = 'none'
    this.deckListCount.position.set(
      DECK_EDITOR_LAYOUT.count.x,
      DECK_EDITOR_LAYOUT.count.y
    )
    this.root.addChild(this.deckListCount)

    this.renderDeckList()
  }

  private createDeckEditor(
    assets: CollectionAssets,
    sharedAssets: SharedUIAssets
  ): void {
    this.deckEditorLayer = new Container()

    this.deckEditorButton = new Button(assets.loadDeckButton, {
      audio: this.audio,
      onClick: () => undefined
    })
    this.deckEditorButton.position.set(
      DECK_EDITOR_LAYOUT.header.x,
      DECK_EDITOR_LAYOUT.header.y
    )
    this.deckEditorButton.setBaseY(DECK_EDITOR_LAYOUT.header.y)
    this.deckEditorButton.on('rightclick', (event: FederatedPointerEvent) => {
      event.stopPropagation()
      void this.deleteActiveDeck()
    })
    this.deckEditorLayer.addChild(this.deckEditorButton)

    this.deckEditorCount = new Text({
      text: '',
      style: {
        fontFamily: 'Belwe',
        fontSize: 24,
        fill: DECK_EDITOR_COUNT_FILL,
        stroke: { color: 0x000000, width: 4 },
        letterSpacing: -1,
        align: 'center'
      }
    })
    this.deckEditorCount.anchor.set(0.5)
    this.deckEditorCount.eventMode = 'none'
    this.deckEditorCount.position.set(
      DECK_EDITOR_LAYOUT.count.x,
      DECK_EDITOR_LAYOUT.count.y
    )
    this.deckEditorLayer.addChild(this.deckEditorCount)

    this.deckFullWarning = new Text({
      text: '',
      style: {
        fontFamily: 'Belwe',
        fontSize: DECK_EDITOR_FULL_WARNING_FONT_SIZE,
        fill: 0xffffff,
        stroke: {
          color: 0x000000,
          width: DECK_EDITOR_FULL_WARNING_STROKE_WIDTH
        },
        align: 'center',
        wordWrap: true,
        wordWrapWidth: GAME_WIDTH - 160,
        lineHeight: DECK_EDITOR_FULL_WARNING_FONT_SIZE * 1.1
      }
    })
    this.deckFullWarning.anchor.set(0.5)
    this.deckFullWarning.position.set(GAME_WIDTH / 2, GAME_HEIGHT / 2)
    this.deckFullWarning.eventMode = 'none'
    this.deckFullWarning.visible = false
    this.deckFullWarning.alpha = 0

    const deckEditorCardMask = new Graphics()
      .rect(
        DECK_EDITOR_LAYOUT.cardList.x,
        DECK_EDITOR_LAYOUT.cardList.y,
        DECK_EDITOR_LAYOUT.cardList.width,
        DECK_EDITOR_LAYOUT.cardList.height
      )
      .fill(0xffffff)
    deckEditorCardMask.eventMode = 'none'

    this.deckEditorCardViewport = new Container()
    this.deckEditorCardViewport.hitArea = new Rectangle(
      DECK_EDITOR_LAYOUT.cardList.x,
      DECK_EDITOR_LAYOUT.cardList.y,
      DECK_EDITOR_LAYOUT.cardList.width,
      DECK_EDITOR_LAYOUT.cardList.height
    )
    this.deckEditorCardViewport.eventMode = 'none'
    this.deckEditorCardViewport.on('wheel', this.handleDeckEditorCardWheel)
    this.deckEditorCardViewport.mask = deckEditorCardMask

    this.deckEditorCardContent = new Container()
    this.deckEditorCardViewport.addChild(this.deckEditorCardContent)
    this.deckEditorLayer.addChild(deckEditorCardMask)
    this.deckEditorLayer.addChild(this.deckEditorCardViewport)

    this.deckEditorDoneButton = new Button(sharedAssets.doneButton, {
      audio: this.audio,
      onClick: () => this.exitDeckEditor()
    })
    this.deckEditorDoneButton.position.set(
      DECK_EDITOR_LAYOUT.footerButton.x,
      DECK_EDITOR_LAYOUT.footerButton.y
    )
    this.deckEditorDoneButton.setBaseY(DECK_EDITOR_LAYOUT.footerButton.y)
    this.deckEditorLayer.addChild(this.deckEditorDoneButton)

    this.deckEditorLayer.visible = false
    this.deckEditorLayer.alpha = 0
    this.root.addChild(this.deckEditorLayer)
    this.root.addChild(this.deckFullWarning)
  }

  private createCollectionBackButton(sharedAssets: SharedUIAssets): void {
    this.collectionBackButton = new Button(sharedAssets.backButton, {
      clickSound: 'back-click',
      audio: this.audio,
      onClick: () => this.leaveCollection()
    })
    this.collectionBackButton.position.set(
      DECK_EDITOR_LAYOUT.footerButton.x,
      DECK_EDITOR_LAYOUT.footerButton.y
    )
    this.collectionBackButton.setBaseY(DECK_EDITOR_LAYOUT.footerButton.y)
    this.collectionBackButton.visible = true
    this.root.addChild(this.collectionBackButton)
  }

  private renderDeckList(): void {
    const oldEntries = this.deckContent.removeChildren()
    for (const entry of oldEntries) {
      entry.destroy({ children: true })
    }

    this.deckEntries.length = 0
    this.deckButtons.length = 0
    this.newDeckButton = null

    const decks = this.deckController.getDecks()
    this.deckListCount.text = `${decks.length} / ${MAX_DECKS} Decks`
    for (const { deck, index } of buildCollectionDeckListEntries(decks)) {
      this.addDeckEntry(
        this.getDeckFrameTexture(deck),
        () => this.enterDeck(deck.id),
        index,
        () => this.deleteDeck(deck.id),
        'collection-new-deck-edge-flips'
      )
    }

    this.newDeckButton = this.addDeckEntry(
      this.deckAssets.newDeckButton,
      () => this.beginNewDeckCreation(),
      decks.length,
      undefined,
      'collection-new-deck-edge-flips'
    )

    const itemCount = decks.length + 1
    const contentHeight =
      itemCount * DECK_BUTTON_HEIGHT + Math.max(0, itemCount - 1) * DECK_BUTTON_GAP
    this.deckMaxScroll = Math.max(0, contentHeight - Layout.deckList.height)
    this.setDeckScroll(this.deckScrollOffset)
    this.setDeckInteractionEnabled(this.navigationReady && !this.disposed)
  }

  private addDeckEntry(
    texture: Texture,
    onClick: () => void | Promise<void>,
    index: number,
    onDelete?: () => void | Promise<void>,
    pressSound?: SoundEffectId
  ): Button {
    const entry = new Container()
    entry.position.set(
      Layout.deckList.width / 2,
      index * (DECK_BUTTON_HEIGHT + DECK_BUTTON_GAP) + DECK_BUTTON_HEIGHT / 2
    )

    const button = new Button(texture, { pressSound, audio: this.audio, onClick })
    button.setBaseY(0)
    if (onDelete) {
      button.on('rightclick', (event: FederatedPointerEvent) => {
        event.stopPropagation()
        const result = onDelete()
        if (result) {
          void Promise.resolve(result).catch((error: unknown) => {
            this.reportError('Failed to delete deck.', error)
          })
        }
      })
    }
    entry.addChild(button)
    this.deckButtons.push(button)

    this.deckEntries.push(entry)
    this.deckContent.addChild(entry)
    return button
  }

  private getDeckFrameTexture(deck: Deck): Texture {
    const deckClass = this.getDeckClass(deck)
    const assetKey = deckClass ? DECK_FRAME_ASSET_KEYS[deckClass] : undefined

    // Legacy decks may not have class metadata. Keep those decks usable while
    // ensuring all class-aware decks use their baked-in portrait frame.
    return assetKey ? this.deckAssets[assetKey] : this.deckAssets.loadDeckButton
  }

  private setDeckScroll(offset: number): void {
    this.deckScrollOffset = Math.max(-this.deckMaxScroll, Math.min(0, offset))
    this.deckContent.y = this.deckScrollOffset
    this.updateDeckEntryVisibility()
    this.updateDeckSliderPosition()
  }

  private setDeckEditorCardScroll(offset: number): void {
    this.deckEditorCardScrollOffset = Math.max(
      -this.deckEditorCardMaxScroll,
      Math.min(0, offset)
    )
    this.deckEditorCardContent.y = this.deckEditorCardScrollOffset
    this.updateDeckSliderPosition()
  }

  private getActiveScrollMax(): number {
    return this.activeDeckId !== null
      ? this.deckEditorCardMaxScroll
      : this.deckMaxScroll
  }

  private updateDeckEntryVisibility(): void {
    for (const entry of this.deckEntries) {
      const entryTop = entry.y - DECK_BUTTON_HEIGHT / 2 + this.deckScrollOffset
      const entryBottom = entryTop + DECK_BUTTON_HEIGHT
      entry.visible = entryBottom > 0 && entryTop < Layout.deckList.height
    }
  }

  private updateDeckSliderPosition(): void {
    const editorContext = this.activeDeckId !== null
    const maxScroll = editorContext ? this.deckEditorCardMaxScroll : this.deckMaxScroll
    const scrollOffset = editorContext
      ? this.deckEditorCardScrollOffset
      : this.deckScrollOffset

    if (
      maxScroll === 0 ||
      (editorContext && (this.deckEditorTransitioning || this.deckEditorClosing))
    ) {
      this.deckSlider.visible = false
      this.deckSlider.eventMode = 'none'
      this.deckSliderDragging = false
      return
    }

    const scrollRatio = -scrollOffset / maxScroll
    const sliderY =
      Layout.deckSlider.minY +
      scrollRatio * (Layout.deckSlider.maxY - Layout.deckSlider.minY)

    this.deckSlider.visible = true
    this.deckSlider.position.set(Layout.deckSlider.x, sliderY)
  }

  private setDeckInteractionEnabled(enabled: boolean): void {
    const newDeckSelectionOpen = this.newDeckScene?.isOpen ?? false
    const listEnabled = enabled && this.activeDeckId === null && !newDeckSelectionOpen
    const editorContentEnabled =
      enabled &&
      this.activeDeckId !== null &&
      !this.deckEditorTransitioning &&
      !this.deckEditorClosing &&
      !this.deckEditorCardMutationInProgress
    const editorScrollEnabled = editorContentEnabled && this.deckEditorCardMaxScroll > 0
    const sliderEnabled = listEnabled || editorScrollEnabled
    this.deckViewport.eventMode = listEnabled ? 'static' : 'none'
    const canCreateDeck = this.deckController.getDecks().length < MAX_DECKS
    for (const button of this.deckButtons) {
      button.setEnabled(listEnabled && (button !== this.newDeckButton || canCreateDeck))
    }

    if (this.deckEditorCardViewport) {
      this.deckEditorCardViewport.eventMode = editorContentEnabled ? 'static' : 'none'
    }

    if (this.deckSlider.visible) {
      this.deckSlider.eventMode = sliderEnabled ? 'static' : 'none'
      this.deckSlider.cursor = sliderEnabled ? 'pointer' : 'default'
    }

    if (this.deckEditorButton) {
      this.deckEditorButton.setEnabled(
        enabled &&
          this.activeDeckId !== null &&
          !this.deckEditorTransitioning &&
          !this.deckEditorCardMutationInProgress
      )
    }
    if (this.deckEditorDoneButton) {
      this.deckEditorDoneButton.setEnabled(
        enabled &&
          this.activeDeckId !== null &&
          !this.deckEditorTransitioning &&
          !this.deckEditorCardMutationInProgress
      )
    }

    if (this.collectionBackButton) {
      const backEnabled = enabled && this.activeDeckId === null && !newDeckSelectionOpen
      this.collectionBackButton.visible = this.activeDeckId === null
      this.collectionBackButton.setEnabled(backEnabled)
    }
    if (this.deckListCount) {
      this.deckListCount.visible = this.activeDeckId === null
    }

    if (!sliderEnabled) {
      this.stopDeckSliderDrag()
    }

    this.updateCollectionFilterModes()
  }

  private readonly handleDeckWheel = (event: FederatedWheelEvent): void => {
    if (!this.navigationReady || this.deckMaxScroll === 0) return

    this.setDeckScroll(this.deckScrollOffset - event.deltaY)
    event.stopPropagation()
  }

  private readonly handleDeckEditorCardWheel = (event: FederatedWheelEvent): void => {
    if (
      !this.navigationReady ||
      !this.activeDeckId ||
      this.deckEditorTransitioning ||
      this.deckEditorClosing ||
      this.deckEditorCardMutationInProgress ||
      this.deckEditorCardMaxScroll === 0
    ) {
      return
    }

    this.setDeckEditorCardScroll(this.deckEditorCardScrollOffset - event.deltaY)
    event.stopPropagation()
  }

  private readonly startDeckSliderDrag = (event: FederatedPointerEvent): void => {
    const maxScroll = this.getActiveScrollMax()
    if (
      !this.navigationReady ||
      maxScroll === 0 ||
      (this.activeDeckId !== null &&
        (this.deckEditorTransitioning ||
          this.deckEditorClosing ||
          this.deckEditorCardMutationInProgress))
    ) {
      return
    }

    this.deckSliderDragging = true
    this.deckSliderDragOffset = event.global.y - this.deckSlider.y
    event.stopPropagation()
  }

  private readonly handleDeckSliderMove = (event: FederatedPointerEvent): void => {
    const maxScroll = this.getActiveScrollMax()
    if (!this.deckSliderDragging || maxScroll === 0) return

    const trackRange = Layout.deckSlider.maxY - Layout.deckSlider.minY
    const sliderY = Math.max(
      Layout.deckSlider.minY,
      Math.min(Layout.deckSlider.maxY, event.global.y - this.deckSliderDragOffset)
    )
    const scrollRatio = (sliderY - Layout.deckSlider.minY) / trackRange

    if (this.activeDeckId !== null) {
      this.setDeckEditorCardScroll(-scrollRatio * maxScroll)
    } else {
      this.setDeckScroll(-scrollRatio * maxScroll)
    }
    event.stopPropagation()
  }

  private readonly stopDeckSliderDrag = (): void => {
    this.deckSliderDragging = false
    this.deckSliderDragOffset = 0
  }

  private async leaveCollection(): Promise<void> {
    if (
      !this.navigationReady ||
      this.disposed ||
      this.activeDeckId !== null ||
      this.newDeckScene?.isOpen
    ) {
      return
    }

    this.setNavigationEnabled(false)
    this.setDeckInteractionEnabled(false)

    try {
      if (!this.router) throw new Error('Collection router is not configured')
      await this.router.navigate({ id: 'main-menu', entryMode: 'returning' })
    } catch (error) {
      this.reportError('Failed to return to the main menu.', error)
      if (!this.disposed) {
        this.setNavigationEnabled(true)
        this.setDeckInteractionEnabled(true)
      }
    }
  }

  private readonly handleDeckStoreChanged = (): void => {
    if (this.activeDeckId) {
      if (!this.deckController.getDeck(this.activeDeckId)) {
        void this.exitDeckEditor().then(() => {
          if (!this.disposed) this.renderDeckList()
        })
      } else {
        this.updateDeckEditor()
      }
      return
    }

    this.renderDeckList()
  }

  private async enterDeck(deckId: string): Promise<void> {
    if (
      !this.navigationReady ||
      this.disposed ||
      this.activeDeckId !== null ||
      this.deckEditorTransitioning
    ) {
      return
    }
    const deck = this.deckController.getDeck(deckId)
    if (!deck) return

    const origin = this.getDeckEntryOrigin(deckId) ?? {
      x: DECK_EDITOR_LAYOUT.header.x,
      y: DECK_EDITOR_LAYOUT.header.y
    }

    this.setDeckInteractionEnabled(false)

    try {
      await this.applyCollectionClassFilter(this.getDeckClass(deck))
    } catch (error) {
      this.reportError(`Failed to filter the collection for ${deck.name}.`, error)
      if (!this.disposed) this.setDeckInteractionEnabled(true)
      return
    }
    if (this.disposed) return

    this.activeDeckId = deckId
    this.deckEditorOrigin = origin
    this.clearDeckEditorCardPreview()
    this.deckEditorCardScrollOffset = 0
    this.deckEditorCardMaxScroll = 0
    this.deckEditorCardContent.y = 0
    this.deckEditorCardMutationInProgress = false
    this.deckEditorTransitioning = true
    const transitionSequence = ++this.deckEditorTransitionSequence
    this.setDeckInteractionEnabled(false)
    this.deckViewport.visible = false
    this.deckSlider.visible = false
    this.deckEditorLayer.visible = true
    this.deckEditorLayer.alpha = 1
    this.deckEditorButton.scale.set(1)
    this.deckEditorButton.position.set(origin.x, origin.y)
    this.deckEditorButton.setBaseY(origin.y)
    this.deckEditorButton.setEnabled(false)
    this.deckEditorCardContent.alpha = 0
    this.deckEditorCount.alpha = 0
    this.deckEditorDoneButton.alpha = 0
    this.updateDeckEditor()

    await this.animateDeckEditorTransition(origin, true)
    if (
      this.disposed ||
      this.activeDeckId !== deckId ||
      this.deckEditorTransitionSequence !== transitionSequence
    ) {
      return
    }

    this.deckEditorButton.setBaseY(DECK_EDITOR_LAYOUT.header.y)
    this.deckEditorTransitioning = false
    this.updateDeckSliderPosition()
    this.setDeckInteractionEnabled(true)
  }

  private getDeckClass(deck: Deck): DeckClass | null {
    return (HERO_CATALOG.get(deck.heroId)?.classId as DeckClass | undefined) ?? null
  }

  private async exitDeckEditor(): Promise<void> {
    if (
      !this.deckEditorLayer ||
      this.disposed ||
      !this.activeDeckId ||
      this.deckEditorClosing
    ) {
      return
    }

    this.deckEditorClosing = true
    ++this.deckEditorTransitionSequence
    this.clearDeckEditorCardPreview()
    this.deckEditorCardMutationInProgress = false
    this.killTweensOf(this.deckEditorButton)
    this.killTweensOf(this.deckEditorCardContent)
    this.killTweensOf(this.deckEditorCount)
    this.killTweensOf(this.deckEditorDoneButton)
    this.deckEditorTransitioning = true
    this.setNavigationEnabled(false)
    this.setDeckInteractionEnabled(false)
    this.deckSlider.visible = false

    const origin = this.deckEditorOrigin
    if (origin && this.deckEditorLayer.visible) {
      await this.animateDeckEditorTransition(origin, false)
    }
    if (this.disposed) return

    this.activeDeckId = null
    this.updateCollectionCardCompletionState()
    this.deckEditorOrigin = null
    this.deckEditorRenderSequence += 1
    this.deckEditorLayer.visible = false
    this.deckEditorLayer.alpha = 0
    this.deckEditorCardContent.alpha = 1
    this.deckEditorCount.alpha = 1
    this.deckEditorDoneButton.alpha = 1
    this.deckEditorCardScrollOffset = 0
    this.deckEditorCardMaxScroll = 0
    this.deckEditorCardContent.y = 0
    this.deckEditorButton.scale.set(1)
    this.deckEditorButton.setBaseY(DECK_EDITOR_LAYOUT.header.y)
    this.deckViewport.visible = true
    this.updateDeckSliderPosition()

    try {
      await this.applyCollectionClassFilter(null)
    } catch (error) {
      this.reportError('Failed to restore the full collection.', error)
    } finally {
      if (!this.disposed) {
        this.deckEditorTransitioning = false
        this.deckEditorClosing = false
        this.setNavigationEnabled(true)
        this.setDeckInteractionEnabled(true)
      }
    }
  }

  private getDeckEntryOrigin(deckId: string): { x: number; y: number } | null {
    const deckIndex = this.deckController
      .getDecks()
      .findIndex((deck) => deck.id === deckId)
    const entry = deckIndex === -1 ? undefined : this.deckEntries[deckIndex]
    if (!entry) return null

    const bounds = entry.getBounds()
    const center = this.deckEditorLayer.toLocal({
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2
    })
    return { x: center.x, y: center.y }
  }

  private getDeckEditorFrameTargetScale(): number {
    const texture = this.deckEditorButton.sprite.texture
    if (texture === Texture.EMPTY || texture.width <= 0 || texture.height <= 0) {
      return 1
    }

    const widthScale = DECK_EDITOR_FRAME_TARGET_WIDTH / texture.width
    const maxHeightScale =
      (2 *
        (DECK_EDITOR_LAYOUT.cardList.y -
          DECK_EDITOR_LAYOUT.header.y -
          DECK_EDITOR_FRAME_CARD_LIST_GAP)) /
      texture.height

    return Math.max(1, Math.min(widthScale, maxHeightScale))
  }

  private animateDeckEditorTransition(
    origin: { x: number; y: number },
    opening: boolean
  ): Promise<void> {
    this.cancelDeckEditorTransition()

    return new Promise<void>((resolve) => {
      const targetY = opening ? DECK_EDITOR_LAYOUT.header.y : origin.y
      const targetScale = opening ? this.getDeckEditorFrameTargetScale() : 1
      const targetAlpha = opening ? 1 : 0
      const finish = (): void => {
        if (this.deckEditorTransitionTimeline === timeline) {
          this.deckEditorTransitionTimeline = null
          this.deckEditorTransitionResolve = null
        }
        resolve()
      }
      const timeline = this.timeline({
        onComplete: finish,
        onInterrupt: finish
      })
      this.deckEditorTransitionTimeline = timeline
      this.deckEditorTransitionResolve = finish

      timeline.to(
        this.deckEditorButton,
        {
          x: origin.x,
          y: targetY,
          duration: DECK_EDITOR_TRANSITION_DURATION,
          ease: 'power2.inOut'
        },
        0
      )
      timeline.to(
        this.deckEditorButton.scale,
        {
          x: targetScale,
          y: targetScale,
          duration: DECK_EDITOR_TRANSITION_DURATION,
          ease: 'power2.inOut'
        },
        0
      )
      timeline.to(
        [this.deckEditorCardContent, this.deckEditorCount, this.deckEditorDoneButton],
        {
          alpha: targetAlpha,
          duration: DECK_EDITOR_CONTENT_FADE_DURATION,
          ease: 'power2.out'
        },
        opening ? DECK_EDITOR_TRANSITION_DURATION * 0.55 : 0
      )
    })
  }

  private cancelDeckEditorTransition(): void {
    const timeline = this.deckEditorTransitionTimeline
    const finish = this.deckEditorTransitionResolve
    this.deckEditorTransitionTimeline = null
    this.deckEditorTransitionResolve = null
    timeline?.kill()
    finish?.()
  }

  private updateDeckEditor(): void {
    if (!this.activeDeckId) return

    const deck = this.deckController.getDeck(this.activeDeckId)
    if (!deck) {
      this.clearDeckFullWarning()
      void this.exitDeckEditor().then(() => {
        if (!this.disposed) this.renderDeckList()
      })
      return
    }

    this.deckEditorButton.sprite.texture = this.getDeckFrameTexture(deck)
    this.clearDeckFullWarning()
    this.clearDeckEditorCountFeedback()
    this.deckEditorCount.text = `${countDeckCards(deck)} / ${MAX_DECK_CARDS} Cards`
    this.renderDeckCardRows(deck)
    this.updateCollectionCardCompletionState()
  }

  private getCompletedCollectionCardAlphaFilter(): AlphaFilter {
    if (!this.completedCollectionCardAlphaFilter) {
      this.completedCollectionCardAlphaFilter = new AlphaFilter({
        alpha: COMPLETED_COLLECTION_CARD_ALPHA,
        resolution: 'inherit',
        antialias: 'inherit'
      })
    }
    return this.completedCollectionCardAlphaFilter
  }

  private updateCollectionCardCompletionState(): void {
    const page = this.pages[this.pageIndex]
    if (!this.cardLayer || !page) return

    const deck = this.activeDeckId
      ? this.deckController.getDeck(this.activeDeckId)
      : undefined
    for (const [cardIndex, child] of this.cardLayer.children.entries()) {
      if (!(child instanceof CardView)) continue

      const card = page.cards[cardIndex]
      const isAtCopyLimit = Boolean(
        deck && card && getDeckCardCount(deck, card.id) >= getCardCopyLimit(card)
      )
      child.filters = isAtCopyLimit
        ? [this.getCompletedCollectionCardAlphaFilter()]
        : null
      child.alpha = 1
    }
  }

  private flashDeckEditorCount(): void {
    if (!this.deckEditorCount) return

    if (this.deckEditorCountFeedbackTimer !== null) {
      clearTimeout(this.deckEditorCountFeedbackTimer)
    }
    this.deckEditorCount.style.fill = DECK_EDITOR_ERROR_FILL
    this.deckEditorCountFeedbackTimer = setTimeout(() => {
      this.deckEditorCountFeedbackTimer = null
      if (!this.disposed && this.deckEditorCount) {
        this.deckEditorCount.style.fill = DECK_EDITOR_COUNT_FILL
      }
    }, 650)
  }

  private clearDeckEditorCountFeedback(): void {
    if (this.deckEditorCountFeedbackTimer !== null) {
      clearTimeout(this.deckEditorCountFeedbackTimer)
      this.deckEditorCountFeedbackTimer = null
    }
    if (this.deckEditorCount) {
      this.deckEditorCount.style.fill = DECK_EDITOR_COUNT_FILL
    }
  }

  private showDeckFullWarning(message: string): void {
    if (!this.deckFullWarning) return

    this.clearDeckFullWarning()
    this.deckFullWarning.text = message
    this.deckFullWarning.visible = true
    this.tweenTo(this.deckFullWarning, {
      alpha: 1,
      duration: 0.12,
      ease: 'power2.out'
    })
    this.deckFullWarningTimer = setTimeout(() => {
      this.deckFullWarningTimer = null
      if (this.disposed || !this.deckFullWarning) return

      this.tweenTo(this.deckFullWarning, {
        alpha: 0,
        duration: 0.25,
        ease: 'power2.in',
        onComplete: () => {
          if (!this.disposed && this.deckFullWarning) {
            this.deckFullWarning.visible = false
          }
        },
        onInterrupt: () => {
          if (!this.disposed && this.deckFullWarning) {
            this.deckFullWarning.visible = false
          }
        }
      })
    }, DECK_EDITOR_FULL_WARNING_DURATION)
  }

  private clearDeckFullWarning(): void {
    if (this.deckFullWarningTimer !== null) {
      clearTimeout(this.deckFullWarningTimer)
      this.deckFullWarningTimer = null
    }
    if (!this.deckFullWarning) return

    this.killTweensOf(this.deckFullWarning)
    this.deckFullWarning.alpha = 0
    this.deckFullWarning.visible = false
  }

  private getDeckEditorCardContentHeight(rowCount: number): number {
    if (rowCount === 0) return 0

    return (
      DECK_EDITOR_ROW_INSET +
      rowCount * DECK_EDITOR_CARD_ROW_HEIGHT -
      DECK_EDITOR_CARD_ROW_GAP
    )
  }

  private renderDeckCardRows(deck: Deck): void {
    this.clearDeckEditorCardPreview()
    const sequence = ++this.deckEditorRenderSequence
    const oldRows = this.deckEditorCardContent.removeChildren()
    for (const row of oldRows) {
      row.destroy({ children: true })
    }

    const entries = buildDeckEditorEntries(deck)

    this.deckEditorCardMaxScroll = Math.max(
      0,
      this.getDeckEditorCardContentHeight(entries.length) -
        DECK_EDITOR_LAYOUT.cardList.height
    )
    this.setDeckEditorCardScroll(this.deckEditorCardScrollOffset)

    for (const [index, entry] of entries.entries()) {
      const row = this.createDeckCardRow(entry.cardId, entry.card, entry.count, index)
      this.deckEditorCardContent.addChild(row.row)

      if (!entry.card) continue

      void this.cardResolver
        .loadArtwork(entry.card.id)
        .then((artwork) => {
          if (
            !artwork ||
            sequence !== this.deckEditorRenderSequence ||
            row.row.parent !== this.deckEditorCardContent
          ) {
            return
          }
          this.applyDeckRowArtwork(row, artwork)
        })
        .catch((error: unknown) => {
          this.reportWarning(
            `Failed to load deck artwork for ${entry.card?.name}.`,
            error
          )
        })
    }
  }

  private createDeckCardRow(
    cardId: string,
    card: CardDefinition | undefined,
    count: number,
    index: number
  ): {
    row: Container
    artworkLayer: Container
    artworkPlaceholder: Graphics
    artworkWidth: number
    artworkHeight: number
  } {
    const rowWidth = DECK_EDITOR_LAYOUT.cardList.width - DECK_EDITOR_ROW_INSET * 2
    const rowHeight = DECK_EDITOR_CARD_ROW_HEIGHT - DECK_EDITOR_CARD_ROW_GAP
    const row = new Container()
    row.position.set(
      DECK_EDITOR_LAYOUT.cardList.x + DECK_EDITOR_ROW_INSET,
      DECK_EDITOR_LAYOUT.cardList.y +
        index * DECK_EDITOR_CARD_ROW_HEIGHT +
        DECK_EDITOR_ROW_INSET
    )
    row.hitArea = new Rectangle(0, 0, rowWidth, rowHeight)
    row.eventMode = 'static'
    row.cursor = 'pointer'
    row.on('pointertap', (event: FederatedPointerEvent) => {
      if (event.button !== 0) return
      event.stopPropagation()
      void this.removeCardFromActiveDeck(cardId, row)
    })
    row.on('pointerover', () => {
      if (card) void this.showDeckCardPreview(card, row)
    })
    row.on('pointerout', () => {
      this.hideDeckCardPreview()
    })

    const background = new Graphics()
      .rect(0, 0, rowWidth, rowHeight)
      .fill({ color: 0x241c32, alpha: 0.92 })
      .stroke({ color: 0x6d4a38, width: 1, alpha: 0.95 })
    background.eventMode = 'none'
    row.addChild(background)

    const costBackground = new Graphics()
      .rect(1, 1, DECK_EDITOR_COST_WIDTH - 2, rowHeight - 2)
      .fill(0x355376)
    costBackground.eventMode = 'none'
    row.addChild(costBackground)

    const cost = new Text({
      text: String(card?.cost ?? 0),
      style: {
        fontFamily: 'Belwe',
        fontSize: 17,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 2 },
        letterSpacing: -1,
        align: 'center'
      }
    })
    cost.anchor.set(0.5)
    cost.position.set(DECK_EDITOR_COST_WIDTH / 2, rowHeight / 2)
    cost.eventMode = 'none'
    row.addChild(cost)

    const artworkX = DECK_EDITOR_COST_WIDTH
    const artworkWidth =
      rowWidth - DECK_EDITOR_COST_WIDTH - DECK_EDITOR_COPIES_WIDTH - 4
    const artworkHeight = rowHeight - 2
    const name = new Text({
      text: card?.name ?? cardId,
      style: {
        fontFamily: 'Belwe',
        fontSize: 18,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 3 },
        letterSpacing: -1,
        align: 'left'
      }
    })
    name.anchor.set(0, 0.5)
    name.position.set(DECK_EDITOR_COST_WIDTH + 7, rowHeight / 2)
    name.eventMode = 'none'
    const copiesX = rowWidth - DECK_EDITOR_COPIES_WIDTH - 2
    const maxNameWidth = copiesX - name.x - 4
    if (name.width > maxNameWidth) name.scale.x = maxNameWidth / name.width

    const artworkLayer = new Container()
    artworkLayer.position.set(artworkX, 1)
    const artworkPlaceholder = new Graphics()
      .rect(0, 0, artworkWidth, artworkHeight)
      .fill(0x3d3150)
    artworkPlaceholder.eventMode = 'none'
    artworkLayer.addChild(artworkPlaceholder)
    const artworkMask = new Graphics()
      .rect(0, 0, artworkWidth, artworkHeight)
      .fill(0xffffff)
    artworkLayer.mask = artworkMask
    artworkLayer.addChild(artworkMask)
    artworkLayer.eventMode = 'none'
    row.addChild(artworkLayer)
    row.addChild(name)

    const copiesBackground = new Graphics()
      .rect(copiesX, 1, DECK_EDITOR_COPIES_WIDTH - 2, rowHeight - 2)
      .fill(0x312f31)
    copiesBackground.eventMode = 'none'
    row.addChild(copiesBackground)

    const copies = new Text({
      text: String(count),
      style: {
        fontFamily: 'Belwe',
        fontSize: 18,
        fill: 0xf4d44d,
        stroke: { color: 0x000000, width: 2 },
        letterSpacing: -1,
        align: 'center'
      }
    })
    copies.anchor.set(0.5)
    copies.position.set(rowWidth - DECK_EDITOR_COPIES_WIDTH / 2 - 1, rowHeight / 2)
    copies.eventMode = 'none'
    row.addChild(copies)

    return { row, artworkLayer, artworkPlaceholder, artworkWidth, artworkHeight }
  }

  private applyDeckRowArtwork(
    row: {
      artworkLayer: Container
      artworkPlaceholder: Graphics
      artworkWidth: number
      artworkHeight: number
    },
    artwork: Texture
  ): void {
    if (row.artworkPlaceholder.parent === row.artworkLayer) {
      row.artworkLayer.removeChild(row.artworkPlaceholder)
      row.artworkPlaceholder.destroy()
    }

    const sprite = new Sprite(artwork)
    sprite.anchor.set(0.5)
    const scale = Math.max(
      row.artworkWidth / artwork.width,
      row.artworkHeight / artwork.height
    )
    sprite.scale.set(scale)
    sprite.position.set(row.artworkWidth / 2, row.artworkHeight / 2)
    sprite.eventMode = 'none'
    row.artworkLayer.addChildAt(sprite, 0)
  }

  private animateDeckRowRemoval(row: Container): Promise<void> {
    if (!row.parent) return Promise.resolve()

    return new Promise<void>((resolve) => {
      this.tweenTo(row, {
        x: row.x - 96,
        alpha: 0,
        duration: DECK_EDITOR_ROW_REMOVE_DURATION,
        ease: 'power2.in',
        onComplete: resolve,
        onInterrupt: resolve
      })
    })
  }

  private collapseDeckRows(rows: readonly Container[]): Promise<void> {
    if (rows.length === 0) return Promise.resolve()

    return Promise.all(
      rows.map(
        (row) =>
          new Promise<void>((resolve) => {
            this.tweenTo(row, {
              y: row.y - DECK_EDITOR_CARD_ROW_HEIGHT,
              duration: DECK_EDITOR_ROW_COLLAPSE_DURATION,
              ease: 'power2.out',
              onComplete: resolve,
              onInterrupt: resolve
            })
          })
      )
    ).then(() => undefined)
  }

  private positionDeckCardPreview(
    preview: CardView,
    row: Container,
    scale: number
  ): void {
    const rowBounds = row.getBounds()
    const rowTopLeft = this.root.toLocal({ x: rowBounds.x, y: rowBounds.y })
    const rowBottomRight = this.root.toLocal({
      x: rowBounds.x + rowBounds.width,
      y: rowBounds.y + rowBounds.height
    })
    const rowLeft = Math.min(rowTopLeft.x, rowBottomRight.x)
    const rowRight = Math.max(rowTopLeft.x, rowBottomRight.x)
    const rowCenterY = (rowTopLeft.y + rowBottomRight.y) / 2
    const previewWidth = preview.plan.width * scale
    const previewHeight = preview.renderedHeight * scale
    const viewportLeft = FULL_VIEWPORT.x + DECK_EDITOR_PREVIEW.viewportPadding
    const viewportRight =
      FULL_VIEWPORT.x + FULL_VIEWPORT.width - DECK_EDITOR_PREVIEW.viewportPadding
    const viewportTop = FULL_VIEWPORT.y + DECK_EDITOR_PREVIEW.viewportPadding
    const viewportBottom =
      FULL_VIEWPORT.y + FULL_VIEWPORT.height - DECK_EDITOR_PREVIEW.viewportPadding
    const minLeft = viewportLeft
    const maxLeft = viewportRight - previewWidth
    const minTop = viewportTop
    const maxTop = viewportBottom - previewHeight
    const preferredLeft = rowRight + DECK_EDITOR_PREVIEW.gap
    const leftOfRow = rowLeft - DECK_EDITOR_PREVIEW.gap - previewWidth
    const left = Math.max(
      minLeft,
      Math.min(
        maxLeft,
        preferredLeft > maxLeft && leftOfRow >= minLeft ? leftOfRow : preferredLeft
      )
    )
    const top = Math.max(minTop, Math.min(maxTop, rowCenterY - previewHeight / 2))

    preview.position.set(left, top)
  }

  private async showDeckCardPreview(
    card: CardDefinition,
    row: Container
  ): Promise<void> {
    if (
      this.disposed ||
      !this.activeDeckId ||
      this.deckEditorTransitioning ||
      this.deckEditorCardMutationInProgress
    ) {
      return
    }

    this.hideDeckCardPreview()
    const request = this.deckEditorCardPreviewRequest

    try {
      const artwork = await this.cardResolver.loadArtwork(card.id)
      const preview = await CardView.create(card, this.cardResolver, { artwork })
      if (
        this.disposed ||
        !this.activeDeckId ||
        this.deckEditorTransitioning ||
        this.deckEditorCardMutationInProgress ||
        row.parent !== this.deckEditorCardContent ||
        request !== this.deckEditorCardPreviewRequest
      ) {
        preview.destroy({ children: true })
        return
      }

      const scale = Math.min(
        DECK_EDITOR_PREVIEW.maxWidth / preview.plan.width,
        DECK_EDITOR_PREVIEW.maxHeight / preview.renderedHeight
      )
      preview.scale.set(scale)
      this.positionDeckCardPreview(preview, row, scale)
      preview.alpha = 0
      preview.eventMode = 'none'
      this.root.addChild(preview)
      this.deckEditorCardPreview = preview
      this.tweenTo(preview, {
        alpha: 1,
        duration: 0.12,
        ease: 'power2.out'
      })
    } catch (error) {
      if (!this.disposed && request === this.deckEditorCardPreviewRequest) {
        this.reportError(`Failed to render deck preview for ${card.name}.`, error)
      }
    }
  }

  private hideDeckCardPreview(): void {
    ++this.deckEditorCardPreviewRequest
    const preview = this.deckEditorCardPreview
    this.deckEditorCardPreview = null
    if (!preview) return

    this.killTweensOf(preview)
    let destroyed = false
    const destroy = (): void => {
      if (destroyed) return
      destroyed = true
      preview.destroy({ children: true })
    }
    this.tweenTo(preview, {
      alpha: 0,
      duration: 0.1,
      ease: 'power2.in',
      onComplete: destroy,
      onInterrupt: destroy
    })
  }

  private clearDeckEditorCardPreview(): void {
    ++this.deckEditorCardPreviewRequest
    const preview = this.deckEditorCardPreview
    this.deckEditorCardPreview = null
    if (!preview) return

    this.killTweensOf(preview)
    preview.destroy({ children: true })
  }

  private async addCardToActiveDeck(card: CardDefinition): Promise<void> {
    const deckId = this.activeDeckId
    if (
      !deckId ||
      this.deckEditorTransitioning ||
      this.deckEditorCardMutationInProgress
    ) {
      return
    }

    const result = await this.deckController.addCard(deckId, card)
    if (!result.ok) {
      if (result.code === 'deck-full') {
        this.reportWarning(result.message)
        this.showDeckFullWarning(result.message)
      } else {
        this.reportError(result.message)
      }
      this.flashDeckEditorCount()
      return
    }

    this.audio?.play('collection-card-add')
    if (getDeckCardCount(result.deck, card.id) === getCardCopyLimit(card)) {
      this.audio?.play('card-limit-lock')
    }
    this.updateDeckEditor()
  }

  private async removeCardFromActiveDeck(
    cardId: string,
    row?: Container
  ): Promise<void> {
    const deckId = this.activeDeckId
    if (
      !deckId ||
      this.deckEditorTransitioning ||
      this.deckEditorCardMutationInProgress
    ) {
      return
    }

    const transitionSequence = this.deckEditorTransitionSequence
    const deck = this.deckController.getDeck(deckId)
    const shouldAnimateRowRemoval = shouldAnimateDeckRowRemoval(
      deck ? getDeckCardCount(deck, cardId) : 0
    )
    this.deckEditorCardMutationInProgress = true
    this.setDeckInteractionEnabled(false)
    try {
      if (row?.parent === this.deckEditorCardContent) {
        row.eventMode = 'none'
        this.hideDeckCardPreview()
        if (shouldAnimateRowRemoval) {
          const rowIndex = this.deckEditorCardContent.getChildIndex(row)
          const rowsToCollapse = this.deckEditorCardContent.children
            .slice(rowIndex + 1)
            .filter((child): child is Container => child instanceof Container)

          await this.animateDeckRowRemoval(row)
          if (row.parent === this.deckEditorCardContent) {
            this.deckEditorCardContent.removeChild(row)
            row.destroy({ children: true })
            await this.collapseDeckRows(rowsToCollapse)
          }
        }
      }

      if (
        this.disposed ||
        this.activeDeckId !== deckId ||
        this.deckEditorTransitionSequence !== transitionSequence
      ) {
        return
      }

      const result = await this.deckController.removeCard(deckId, cardId)
      if (!result.ok) {
        this.reportError(result.message)
        this.updateDeckEditor()
        this.flashDeckEditorCount()
        return
      }

      this.updateDeckEditor()
    } catch (error) {
      this.reportError(`Failed to remove ${cardId} from the deck.`, error)
      if (!this.disposed && this.activeDeckId === deckId) {
        this.updateDeckEditor()
        this.flashDeckEditorCount()
      }
    } finally {
      this.deckEditorCardMutationInProgress = false
      if (
        !this.disposed &&
        this.activeDeckId === deckId &&
        !this.deckEditorTransitioning &&
        !this.deckEditorClosing
      ) {
        this.setDeckInteractionEnabled(true)
      }
    }
  }

  private readonly handleCollectionCardTap = (
    event: FederatedPointerEvent,
    card: CardDefinition
  ): void => {
    if (
      event.button !== 0 ||
      !this.activeDeckId ||
      this.deckEditorTransitioning ||
      this.deckEditorCardMutationInProgress
    ) {
      return
    }

    event.stopPropagation()
    void this.addCardToActiveDeck(card).catch((error: unknown) => {
      this.reportError(`Failed to add ${card.name} to the deck.`, error)
      this.flashDeckEditorCount()
    })
  }

  private readonly handleCollectionCardPreview = (
    event: FederatedPointerEvent,
    card: CardDefinition,
    view: CardView
  ): void => {
    if (
      event.button !== 2 ||
      this.disposed ||
      !this.navigationReady ||
      this.deckEditorTransitioning ||
      this.deckEditorCardMutationInProgress
    ) {
      return
    }

    event.stopPropagation()
    if (this.cardPreviewOpening) return

    this.cardPreviewOpening = true
    this.audio?.play('collection-card-preview')
    const bounds = view.getBounds()
    const topLeft = this.root.toLocal({ x: bounds.x, y: bounds.y })
    const bottomRight = this.root.toLocal({
      x: bounds.x + bounds.width,
      y: bounds.y + bounds.height
    })
    const sourceBounds: CardPreviewRouteBounds = {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y
    }

    void (
      this.router
        ? this.router.navigate({ id: 'card-preview', cardId: card.id, sourceBounds })
        : Promise.reject(new Error('Collection router is not configured'))
    )
      .catch((error: unknown) => {
        this.reportError(`Failed to open card preview for ${card.name}.`, error)
      })
      .finally(() => {
        this.cardPreviewOpening = false
      })
  }

  private async beginNewDeckCreation(): Promise<void> {
    if (
      !this.navigationReady ||
      this.disposed ||
      this.newDeckScene.isOpen ||
      this.deckController.getDecks().length >= MAX_DECKS
    ) {
      return
    }

    this.previousCollectionClassFilter = this.collectionQuery.classFilter
    this.setNavigationEnabled(false)
    this.setDeckInteractionEnabled(false)
    try {
      await this.newDeckScene.open()
    } catch (error) {
      this.reportError('Failed to open the new deck selector.', error)
      this.previousCollectionClassFilter = null
      if (!this.disposed) {
        this.setNavigationEnabled(true)
        this.setDeckInteractionEnabled(true)
      }
    }
  }

  private async handleNewDeckHeroSelected(heroClass: DeckClass): Promise<void> {
    try {
      await this.applyCollectionClassFilter(heroClass)
    } catch (error) {
      this.reportError(`Failed to filter the collection for ${heroClass}.`, error)
    }
  }

  private async handleNewDeckCreationCancelled(): Promise<void> {
    const previousFilter = this.previousCollectionClassFilter

    try {
      await this.applyCollectionClassFilter(previousFilter)
    } catch (error) {
      this.reportError('Failed to restore the collection after cancelling.', error)
    } finally {
      this.previousCollectionClassFilter = null
      if (!this.disposed) {
        this.setNavigationEnabled(true)
        this.setDeckInteractionEnabled(true)
      }
    }
  }

  private async handleNewDeckCreated(deck: Deck): Promise<void> {
    this.previousCollectionClassFilter = null
    if (this.disposed) return

    this.setNavigationEnabled(true)
    await this.enterDeck(deck.id)
  }

  private async deleteDeck(deckId: string): Promise<void> {
    const deck = this.deckController.getDeck(deckId)
    if (!deck) return
    if (!this.deckController.confirmDeckDeletion(deck)) return

    try {
      await this.deckController.deleteDeck(deckId)
    } catch (error) {
      this.reportError(`Failed to delete ${deck.name}.`, error)
    }
  }

  private async deleteActiveDeck(): Promise<void> {
    if (!this.activeDeckId) return
    await this.deleteDeck(this.activeDeckId)
  }

  private createPageZone(
    x: number,
    width: number,
    cursorVariant: CursorContextVariant,
    onClick: () => void
  ): Container {
    const zone = new Container()
    zone.position.set(x, PAGE_TOP)
    zone.hitArea = new Rectangle(0, 0, width, PAGE_HEIGHT)
    zone.eventMode = 'none'
    zone.on('pointerover', () => {
      this.pageHoverSequence += 1
      this.hoveredPageZone = cursorVariant
      this.sceneManager.cursor?.setContextVariant(cursorVariant)
    })
    zone.on('pointerout', () => {
      const hoverSequence = this.pageHoverSequence
      // Replacing the card layer can briefly make Pixi emit pointerout and
      // pointerover for a stationary pointer. Wait one microtask so a matching
      // pointerover keeps the page-pass cursor instead of flashing default.
      queueMicrotask(() => {
        if (
          this.pageHoverSequence !== hoverSequence ||
          this.hoveredPageZone !== cursorVariant
        ) {
          return
        }

        this.hoveredPageZone = null
        this.sceneManager.cursor?.setContextVariant(null)
      })
    })
    zone.on('pointertap', onClick)
    return zone
  }

  private setNavigationEnabled(enabled: boolean): void {
    this.navigationEnabled = enabled
    this.pageHoverSequence += 1
    this.hoveredPageZone = null
    this.sceneManager.cursor?.setContextVariant(null)

    this.updatePageZoneModes()
    this.updateCollectionFilterModes()
  }

  private updateCollectionFilterModes(): void {
    const filtersEnabled =
      this.navigationEnabled &&
      this.navigationReady &&
      !(this.newDeckScene?.isOpen ?? false) &&
      !this.deckEditorTransitioning &&
      !this.deckEditorClosing

    for (const control of this.manaFilterControls) {
      control.eventMode = filtersEnabled ? 'static' : 'none'
    }
    if (this.searchClearButton) {
      this.searchClearButton.eventMode = filtersEnabled ? 'static' : 'none'
    }
    this.setSearchInputEnabled(filtersEnabled)
  }

  private updatePageZoneModes(): void {
    const creationOpen = this.newDeckScene?.isOpen ?? false
    const navigationEnabled = this.navigationEnabled && !creationOpen

    const previousPageEnabled = navigationEnabled && this.pageIndex > 0
    const nextPageEnabled = navigationEnabled && this.pageIndex < this.pages.length - 1

    this.previousPageZone.eventMode = previousPageEnabled ? 'static' : 'none'
    this.nextPageZone.eventMode = nextPageEnabled ? 'static' : 'none'

    const hoveredZoneIsStillEnabled =
      this.hoveredPageZone === null ||
      (this.hoveredPageZone === 'collection-previous-page'
        ? previousPageEnabled
        : nextPageEnabled)
    if (!hoveredZoneIsStillEnabled) {
      this.hoveredPageZone = null
      this.sceneManager.cursor?.setContextVariant(null)
    }
  }

  private changePage(delta: number): void {
    if (this.pageLoading || !this.navigationReady) return

    const nextIndex = this.pageIndex + delta
    if (nextIndex < 0 || nextIndex >= this.pages.length) return

    const pageFlipSounds =
      delta > 0 ? COLLECTION_PAGE_FLIP_FORWARD_SOUNDS : COLLECTION_PAGE_FLIP_BACK_SOUNDS
    void pageFlipSounds
    this.audio?.playRandom(pageFlipSounds)
    void this.renderPage(nextIndex).catch((error: unknown) => {
      this.reportError(`Failed to render collection page ${nextIndex}.`, error)
    })
  }

  protected onExit(): void {
    this.disposed = true
    this.cancelDeckEditorTransition()
    this.renderSequence += 1
    this.pageLoading = false
    this.navigationEnabled = false
    this.navigationReady = false
    this.hoveredPageZone = null
    this.cardPreviewOpening = false
    this.clearDeckEditorCardPreview()
    this.unsubscribeDeckStore?.()
    this.unsubscribeDeckStore = null
    this.activeDeckId = null
    this.deckEditorTransitionSequence += 1
    this.deckEditorRenderSequence += 1
    this.deckEditorTransitioning = false
    this.deckEditorClosing = false
    this.deckEditorCardMutationInProgress = false
    this.clearDeckEditorCountFeedback()
    this.clearDeckFullWarning()
    this.previousPageZone.eventMode = 'none'
    this.nextPageZone.eventMode = 'none'
    this.setDeckInteractionEnabled(false)
    for (const control of this.manaFilterControls) {
      control.eventMode = 'none'
    }
    this.setSearchInputVisible(false)
    this.searchInput?.dispose()
    this.searchInput = null
    this.sceneManager.cursor?.setContextVariant(null)
    void this.newDeckScene?.dispose()
  }

  protected onPause(): void {
    this.setSearchInputVisible(false)
    for (const control of this.manaFilterControls) {
      control.eventMode = 'none'
    }
  }

  protected onResume(): void {
    this.updateCollectionFilterModes()
  }

  update(_deltaMS: number): void {}
}
