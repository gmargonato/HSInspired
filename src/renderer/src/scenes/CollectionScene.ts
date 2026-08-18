import {
  Container,
  Graphics,
  PerspectiveMesh,
  Rectangle,
  Sprite,
  Text,
  Texture
} from 'pixi.js'
import type { FederatedPointerEvent, FederatedWheelEvent } from 'pixi.js'
import {
  CARD_CATALOG,
  type CardClass,
  type CardDefinition
} from '../../../../card-lab/card-catalog'
import { CardAssetResolver } from '../../../../card-lab/card-asset-manifest'
import { CardView } from '../../../../card-lab/card-view'
import { Scene } from './Scene'
import { GAME_HEIGHT, GAME_WIDTH } from '../core/config'
import { ASSET_BUNDLE_IDS, CollectionAssets, SharedUIAssets } from '../core/assets'
import type { CursorContextVariant } from '../core/cursor'
import { playerDeckStore, type DeckStore } from '../core/decks'
import { DECK_FRAME_ASSET_KEYS, type DeckFrameAssetKey } from '../core/deckFrames'
import {
  createHingedDoorMesh,
  updateHingedDoor,
  type HingeSide
} from '../core/hingedDoor'
import { HERO_DEFINITIONS } from '../core/heroes'
import { Button } from '../actors/Button'
import { buildCollectionPages, type CollectionPage } from './collectionPages'
import { CardViewScene, type CardPreviewSourceBounds } from './CardViewScene'
import { NewDeckScene } from './NewDeckScene'
import { MainMenuScene } from './MainMenuScene'
import {
  MAX_DECK_CARDS,
  countDeckCards,
  type Deck,
  type DeckClass
} from '../../../shared/decks'

const PAGE_LEFT = 250
const PAGE_TOP = 80
const PAGE_RIGHT = 1380
const PAGE_BOTTOM = GAME_HEIGHT - 80
const PAGE_CENTER_X = (PAGE_LEFT + PAGE_RIGHT) / 2
const PAGE_HEIGHT = PAGE_BOTTOM - PAGE_TOP
const PAGE_NAV_ZONE_WIDTH = 90

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
  pageLabel: { x: PAGE_CENTER_X, y: 960 },
  cardGrid: { x: 305, y: 145, width: 1000, height: 770 },
  cover: { x: 242, y: 0 },
  coverLock: { x: 905, y: 418 },
  deckList: { x: 1404, y: 120, width: 283, height: 870 },
  deckSlider: { x: 1705, minY: 50, maxY: 900 }
}

const DECK_EDITOR_LAYOUT = {
  header: {
    x: Layout.deckList.x + Layout.deckList.width / 2,
    y: 50
  },
  count: { x: 1495, y: 1038 },
  cardList: {
    x: Layout.deckList.x + 10,
    y: 118,
    width: Layout.deckList.width - 20,
    height: 872
  },
  footerButton: { x: 1660, y: 1038 }
}

const CARD_GRID_COLUMNS = 4
const CARD_GRID_ROWS = 2
const CARD_SLOT_PADDING_X = 10
const CARD_SLOT_PADDING_Y = 12
const COVER_LOCK_OPEN_DURATION = 0.45
const COVER_OPEN_DURATION = 0.6
const DOOR_MIN_WIDTH = 1
const COVER_LOCK_PERSPECTIVE_DEPTH = 10
const COVER_PERSPECTIVE_DEPTH = 14
const DECK_BUTTON_HEIGHT = 151
// The button textures include transparent padding around their visible frames.
// A negative layout gap brings the visible frames closer together.
const DECK_BUTTON_GAP = -30
const DECK_EDITOR_CARD_ROW_HEIGHT = 28
const DECK_EDITOR_CARD_ROW_GAP = 1
const DECK_EDITOR_COST_WIDTH = 27
const DECK_EDITOR_COPIES_WIDTH = 24
const DECK_EDITOR_ROW_INSET = 2
const DECK_EDITOR_TRANSITION_DURATION = 0.45
const DECK_EDITOR_CONTENT_FADE_DURATION = 0.2
const DECK_EDITOR_ROW_REMOVE_DURATION = 0.22
const DECK_EDITOR_ROW_COLLAPSE_DURATION = 0.18
const DECK_EDITOR_PREVIEW = {
  maxWidth: 190,
  maxHeight: 345,
  gap: 18,
  viewportPadding: 16
}
const DECK_EDITOR_COUNT_FILL = 0xffffff
const DECK_EDITOR_ERROR_FILL = 0xff9a9a
const COLLECTION_BACK_TRANSITION_DURATION = 0.6
const FULL_VIEWPORT = {
  x: 0,
  y: 0,
  width: GAME_WIDTH,
  height: GAME_HEIGHT
}

type DoorSide = HingeSide

type CollectionDeckAssetKey =
  'loadDeckButton' | 'newDeckButton' | 'verticalSlider' | DeckFrameAssetKey

/** Full-viewport collection scene presented through the main menu transition. */
export class CollectionScene extends Scene {
  private pages: readonly CollectionPage[] = buildCollectionPages(CARD_CATALOG.all)
  private collectionClassFilter: DeckClass | null = null
  private previousCollectionClassFilter: DeckClass | null = null
  private readonly cardResolver = new CardAssetResolver()
  private readonly deckStore: DeckStore

  private background!: Sprite
  private pageContent!: Container
  private cardLayer!: Container
  private deckViewport!: Container
  private deckContent!: Container
  private deckMask!: Graphics
  private deckSlider!: Sprite
  private deckEditorLayer!: Container
  private deckEditorButton!: Button
  private deckEditorCount!: Text
  private deckEditorDoneButton!: Button
  private deckEditorCardContent!: Container
  private collectionBackButton!: Button
  private newDeckScene!: NewDeckScene
  private readonly deckEntries: Container[] = []
  private readonly deckButtons: Button[] = []
  private deckScrollOffset = 0
  private deckMaxScroll = 0
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
  private deckEditorCardMutationInProgress = false
  private deckEditorCardPreview: CardView | null = null
  private deckEditorCardPreviewRequest = 0
  private unsubscribeDeckStore: (() => void) | null = null
  private deckAssets!: Pick<CollectionAssets, CollectionDeckAssetKey>
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
  private cardPreviewOpening = false
  private disposed = false

  constructor(deckStore: DeckStore = playerDeckStore) {
    super()
    this.deckStore = deckStore
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
    await this.deckStore.load()
    await this.waitForFonts()
    this.createDeckList(assets)
    this.createDeckEditor(assets, sharedAssets)
    this.createCollectionBackButton(sharedAssets)
    this.newDeckScene = new NewDeckScene(this.deckStore, {
      onClassSelected: (hero) => this.handleNewDeckHeroSelected(hero.heroClass),
      onCancelled: () => this.handleNewDeckCreationCancelled(),
      onDeckCreated: (deck) => this.handleNewDeckCreated(deck)
    })
    await this.addSubScene(this.newDeckScene)
    await this.renderPage(0)
    this.unsubscribeDeckStore = this.deckStore.subscribe(this.handleDeckStoreChanged)
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

    await this.animateDoor(
      this.coverLock,
      'right',
      COVER_LOCK_OPEN_DURATION,
      COVER_LOCK_PERSPECTIVE_DEPTH
    )
    this.coverLock.visible = false

    await this.animateDoor(
      this.cover,
      'left',
      COVER_OPEN_DURATION,
      COVER_PERSPECTIVE_DEPTH
    )
    this.cover.visible = false

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
      document.fonts.load('27px "Franklin Gothic Condensed"')
    ])
  }

  private async applyCollectionClassFilter(heroClass: DeckClass | null): Promise<void> {
    if (this.collectionClassFilter === heroClass && this.pages.length > 0) return

    const allowedClasses: readonly CardClass[] | undefined = heroClass
      ? ['Neutral', heroClass]
      : undefined
    const pages = buildCollectionPages(CARD_CATALOG.all, allowedClasses)
    if (pages.length === 0) {
      throw new Error(
        `No collection cards are available for ${heroClass ?? 'all classes'}`
      )
    }

    this.collectionClassFilter = heroClass
    this.pages = pages
    this.pageIndex = 0
    await this.renderPage(0)
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
    } finally {
      if (sequence === this.renderSequence) {
        this.pageLoading = false
        if (!this.disposed) this.updatePageZoneModes()
      }
    }
  }

  private layoutCard(view: CardView, cardIndex: number): void {
    const slotWidth = Layout.cardGrid.width / CARD_GRID_COLUMNS
    const slotHeight = Layout.cardGrid.height / CARD_GRID_ROWS
    const column = cardIndex % CARD_GRID_COLUMNS
    const row = Math.floor(cardIndex / CARD_GRID_COLUMNS)
    const maxWidth = slotWidth - CARD_SLOT_PADDING_X * 2
    const maxHeight = slotHeight - CARD_SLOT_PADDING_Y * 2
    const scale = Math.min(maxWidth / view.plan.width, maxHeight / view.renderedHeight)

    view.scale.set(scale)
    view.position.set(
      Layout.cardGrid.x +
        column * slotWidth +
        (slotWidth - view.plan.width * scale) / 2,
      Layout.cardGrid.y +
        row * slotHeight +
        (slotHeight - view.renderedHeight * scale) / 2
    )
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

    this.renderDeckList()
  }

  private createDeckEditor(
    assets: CollectionAssets,
    sharedAssets: SharedUIAssets
  ): void {
    this.deckEditorLayer = new Container()

    this.deckEditorButton = new Button(assets.loadDeckButton, {
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

    this.deckEditorCardContent = new Container()
    this.deckEditorCardContent.mask = new Graphics()
      .rect(
        DECK_EDITOR_LAYOUT.cardList.x,
        DECK_EDITOR_LAYOUT.cardList.y,
        DECK_EDITOR_LAYOUT.cardList.width,
        DECK_EDITOR_LAYOUT.cardList.height
      )
      .fill(0xffffff)
    this.deckEditorLayer.addChild(this.deckEditorCardContent.mask as Graphics)
    this.deckEditorLayer.addChild(this.deckEditorCardContent)

    this.deckEditorDoneButton = new Button(sharedAssets.doneButton, {
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
  }

  private createCollectionBackButton(sharedAssets: SharedUIAssets): void {
    this.collectionBackButton = new Button(sharedAssets.backButton, {
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

    const decks = this.deckStore.getDecks()
    for (const [index, deck] of decks.entries()) {
      this.addDeckEntry(
        this.getDeckFrameTexture(deck),
        () => this.enterDeck(deck.id),
        index,
        () => this.deleteDeck(deck.id)
      )
    }

    this.addDeckEntry(
      this.deckAssets.newDeckButton,
      () => this.beginNewDeckCreation(),
      decks.length
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
    onDelete?: () => void | Promise<void>
  ): void {
    const entry = new Container()
    entry.position.set(
      Layout.deckList.width / 2,
      index * (DECK_BUTTON_HEIGHT + DECK_BUTTON_GAP) + DECK_BUTTON_HEIGHT / 2
    )

    const button = new Button(texture, { onClick })
    button.setBaseY(0)
    if (onDelete) {
      button.on('rightclick', (event: FederatedPointerEvent) => {
        event.stopPropagation()
        const result = onDelete()
        if (result) {
          void Promise.resolve(result).catch((error: unknown) => {
            console.error('Failed to delete deck:', error)
          })
        }
      })
    }
    entry.addChild(button)
    this.deckButtons.push(button)

    this.deckEntries.push(entry)
    this.deckContent.addChild(entry)
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

  private updateDeckEntryVisibility(): void {
    for (const entry of this.deckEntries) {
      const entryTop = entry.y - DECK_BUTTON_HEIGHT / 2 + this.deckScrollOffset
      const entryBottom = entryTop + DECK_BUTTON_HEIGHT
      entry.visible = entryBottom > 0 && entryTop < Layout.deckList.height
    }
  }

  private updateDeckSliderPosition(): void {
    if (this.deckMaxScroll === 0) {
      this.deckSlider.visible = false
      this.deckSlider.eventMode = 'none'
      this.deckSliderDragging = false
      return
    }

    const scrollRatio = -this.deckScrollOffset / this.deckMaxScroll
    const sliderY =
      Layout.deckSlider.minY +
      scrollRatio * (Layout.deckSlider.maxY - Layout.deckSlider.minY)

    this.deckSlider.visible = true
    this.deckSlider.position.set(Layout.deckSlider.x, sliderY)
    this.deckSlider.eventMode = this.navigationReady ? 'static' : 'none'
  }

  private setDeckInteractionEnabled(enabled: boolean): void {
    const newDeckSelectionOpen = this.newDeckScene?.isOpen ?? false
    const listEnabled = enabled && this.activeDeckId === null && !newDeckSelectionOpen
    this.deckViewport.eventMode = listEnabled ? 'static' : 'none'
    for (const button of this.deckButtons) {
      button.setEnabled(listEnabled)
    }

    if (this.deckSlider.visible) {
      this.deckSlider.eventMode = listEnabled ? 'static' : 'none'
      this.deckSlider.cursor = listEnabled ? 'pointer' : 'default'
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

    if (!listEnabled) {
      this.stopDeckSliderDrag()
    }
  }

  private readonly handleDeckWheel = (event: FederatedWheelEvent): void => {
    if (!this.navigationReady || this.deckMaxScroll === 0) return

    this.setDeckScroll(this.deckScrollOffset - event.deltaY)
    event.stopPropagation()
  }

  private readonly startDeckSliderDrag = (event: FederatedPointerEvent): void => {
    if (!this.navigationReady || this.deckMaxScroll === 0) return

    this.deckSliderDragging = true
    this.deckSliderDragOffset = event.global.y - this.deckSlider.y
    event.stopPropagation()
  }

  private readonly handleDeckSliderMove = (event: FederatedPointerEvent): void => {
    if (!this.deckSliderDragging || this.deckMaxScroll === 0) return

    const trackRange = Layout.deckSlider.maxY - Layout.deckSlider.minY
    const sliderY = Math.max(
      Layout.deckSlider.minY,
      Math.min(Layout.deckSlider.maxY, event.global.y - this.deckSliderDragOffset)
    )
    const scrollRatio = (sliderY - Layout.deckSlider.minY) / trackRange

    this.setDeckScroll(-scrollRatio * this.deckMaxScroll)
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
      await this.sceneManager.transitionTo(new MainMenuScene(), {
        inset: FULL_VIEWPORT,
        mode: 'fade',
        duration: COLLECTION_BACK_TRANSITION_DURATION
      })
    } catch (error) {
      console.error('Failed to return to the main menu:', error)
      if (!this.disposed) {
        this.setNavigationEnabled(true)
        this.setDeckInteractionEnabled(true)
      }
    }
  }

  private readonly handleDeckStoreChanged = (): void => {
    if (this.activeDeckId) {
      if (!this.deckStore.getDeck(this.activeDeckId)) {
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
    const deck = this.deckStore.getDeck(deckId)
    if (!deck) return

    const origin = this.getDeckEntryOrigin(deckId) ?? {
      x: DECK_EDITOR_LAYOUT.header.x,
      y: DECK_EDITOR_LAYOUT.header.y
    }

    this.setDeckInteractionEnabled(false)

    try {
      await this.applyCollectionClassFilter(this.getDeckClass(deck))
    } catch (error) {
      console.error(`Failed to filter the collection for ${deck.name}:`, error)
      if (!this.disposed) this.setDeckInteractionEnabled(true)
      return
    }
    if (this.disposed) return

    this.activeDeckId = deckId
    this.deckEditorOrigin = origin
    this.clearDeckEditorCardPreview()
    this.deckEditorCardMutationInProgress = false
    this.deckEditorTransitioning = true
    const transitionSequence = ++this.deckEditorTransitionSequence
    this.setDeckInteractionEnabled(false)
    this.deckViewport.visible = false
    this.deckSlider.visible = false
    this.deckEditorLayer.visible = true
    this.deckEditorLayer.alpha = 1
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
    this.setDeckInteractionEnabled(true)
  }

  private getDeckClass(deck: Deck): DeckClass | null {
    return (
      deck.heroClass ??
      HERO_DEFINITIONS.find((hero) => hero.id === deck.heroId)?.heroClass ??
      null
    )
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

    const origin = this.deckEditorOrigin
    if (origin && this.deckEditorLayer.visible) {
      await this.animateDeckEditorTransition(origin, false)
    }
    if (this.disposed) return

    this.activeDeckId = null
    this.deckEditorOrigin = null
    this.deckEditorRenderSequence += 1
    this.deckEditorLayer.visible = false
    this.deckEditorLayer.alpha = 0
    this.deckEditorCardContent.alpha = 1
    this.deckEditorCount.alpha = 1
    this.deckEditorDoneButton.alpha = 1
    this.deckEditorButton.setBaseY(DECK_EDITOR_LAYOUT.header.y)
    this.deckViewport.visible = true
    this.updateDeckSliderPosition()

    try {
      await this.applyCollectionClassFilter(null)
    } catch (error) {
      console.error('Failed to restore the full collection:', error)
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
    const deckIndex = this.deckStore.getDecks().findIndex((deck) => deck.id === deckId)
    const entry = deckIndex === -1 ? undefined : this.deckEntries[deckIndex]
    if (!entry) return null

    const bounds = entry.getBounds()
    const center = this.deckEditorLayer.toLocal({
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2
    })
    return { x: center.x, y: center.y }
  }

  private animateDeckEditorTransition(
    origin: { x: number; y: number },
    opening: boolean
  ): Promise<void> {
    this.cancelDeckEditorTransition()

    return new Promise<void>((resolve) => {
      const targetY = opening ? DECK_EDITOR_LAYOUT.header.y : origin.y
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

    const deck = this.deckStore.getDeck(this.activeDeckId)
    if (!deck) {
      void this.exitDeckEditor().then(() => {
        if (!this.disposed) this.renderDeckList()
      })
      return
    }

    this.deckEditorButton.sprite.texture = this.getDeckFrameTexture(deck)
    this.clearDeckEditorCountFeedback()
    this.deckEditorCount.text = `${countDeckCards(deck)} / ${MAX_DECK_CARDS} Cards`
    this.renderDeckCardRows(deck)
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

  private renderDeckCardRows(deck: Deck): void {
    this.clearDeckEditorCardPreview()
    const sequence = ++this.deckEditorRenderSequence
    const oldRows = this.deckEditorCardContent.removeChildren()
    for (const row of oldRows) {
      row.destroy({ children: true })
    }

    const entries = Object.entries(deck.cards)
      .map(([cardId, count]) => {
        const card = CARD_CATALOG.get(cardId)
        return { cardId, count, card }
      })
      .sort((left, right) => {
        const costDifference = (left.card?.cost ?? 0) - (right.card?.cost ?? 0)
        if (costDifference !== 0) return costDifference

        const nameDifference = (left.card?.name ?? left.cardId).localeCompare(
          right.card?.name ?? right.cardId
        )
        return nameDifference !== 0
          ? nameDifference
          : left.cardId.localeCompare(right.cardId)
      })

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
          console.warn(`Failed to load deck artwork for ${entry.card?.name}:`, error)
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

    const costBox = new Graphics()
      .rect(2, 2, DECK_EDITOR_COST_WIDTH - 4, rowHeight - 4)
      .fill(0x326dcc)
      .stroke({ color: 0x8eb8ff, width: 1, alpha: 0.9 })
    costBox.eventMode = 'none'
    row.addChild(costBox)

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
        console.warn(`Failed to render deck preview for ${card.name}:`, error)
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

    const result = await this.deckStore.addCard(deckId, card)
    if (!result.ok) {
      console.warn(result.message)
      this.flashDeckEditorCount()
      return
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
    this.deckEditorCardMutationInProgress = true
    this.setDeckInteractionEnabled(false)
    try {
      if (row?.parent === this.deckEditorCardContent) {
        row.eventMode = 'none'
        this.hideDeckCardPreview()
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

      if (
        this.disposed ||
        this.activeDeckId !== deckId ||
        this.deckEditorTransitionSequence !== transitionSequence
      ) {
        return
      }

      const result = await this.deckStore.removeCard(deckId, cardId)
      if (!result.ok) {
        console.warn(result.message)
        this.updateDeckEditor()
        this.flashDeckEditorCount()
        return
      }

      this.updateDeckEditor()
    } catch (error) {
      console.error(`Failed to remove ${cardId} from the deck:`, error)
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
      console.error(`Failed to add ${card.name} to the deck:`, error)
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
    const bounds = view.getBounds()
    const topLeft = this.root.toLocal({ x: bounds.x, y: bounds.y })
    const bottomRight = this.root.toLocal({
      x: bounds.x + bounds.width,
      y: bounds.y + bounds.height
    })
    const sourceBounds: CardPreviewSourceBounds = {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y
    }

    void this.sceneManager
      .push(
        new CardViewScene({
          card,
          sourceBounds,
          resolver: this.cardResolver
        })
      )
      .catch((error: unknown) => {
        console.error(`Failed to open card preview for ${card.name}:`, error)
      })
      .finally(() => {
        this.cardPreviewOpening = false
      })
  }

  private async beginNewDeckCreation(): Promise<void> {
    if (!this.navigationReady || this.disposed || this.newDeckScene.isOpen) {
      return
    }

    this.previousCollectionClassFilter = this.collectionClassFilter
    this.setNavigationEnabled(false)
    this.setDeckInteractionEnabled(false)
    try {
      await this.newDeckScene.open()
    } catch (error) {
      console.error('Failed to open the new deck selector:', error)
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
      console.error(`Failed to filter the collection for ${heroClass}:`, error)
    }
  }

  private async handleNewDeckCreationCancelled(): Promise<void> {
    const previousFilter = this.previousCollectionClassFilter

    try {
      await this.applyCollectionClassFilter(previousFilter)
    } catch (error) {
      console.error('Failed to restore the collection after cancelling:', error)
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
    const deck = this.deckStore.getDeck(deckId)
    if (!deck) return
    if (!this.confirmDeckDeletion(deck)) return

    try {
      await this.deckStore.deleteDeck(deckId)
    } catch (error) {
      console.error(`Failed to delete ${deck.name}:`, error)
    }
  }

  private async deleteActiveDeck(): Promise<void> {
    if (!this.activeDeckId) return
    await this.deleteDeck(this.activeDeckId)
  }

  private confirmDeckDeletion(deck: Deck): boolean {
    if (typeof window.confirm !== 'function') return true
    return window.confirm(`Delete ${deck.name}? This cannot be undone.`)
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
      this.hoveredPageZone = cursorVariant
      this.sceneManager.cursor?.setContextVariant(cursorVariant)
    })
    zone.on('pointerout', () => {
      if (this.hoveredPageZone !== cursorVariant) return

      this.hoveredPageZone = null
      this.sceneManager.cursor?.setContextVariant(null)
    })
    zone.on('pointertap', onClick)
    return zone
  }

  private setNavigationEnabled(enabled: boolean): void {
    this.navigationEnabled = enabled
    this.hoveredPageZone = null
    this.sceneManager.cursor?.setContextVariant(null)

    this.updatePageZoneModes()
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

    void this.renderPage(nextIndex).catch((error: unknown) => {
      console.error(`Failed to render collection page ${nextIndex}:`, error)
    })
  }

  /** Animates the shared top-view door geometry used by the main menu. */
  private animateDoor(
    mesh: PerspectiveMesh,
    side: DoorSide,
    duration: number,
    perspectiveDepth: number
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const state = { progress: 0 }
      const timeline = this.timeline({
        onComplete: resolve,
        onInterrupt: resolve
      })

      timeline.to(
        state,
        {
          progress: 1,
          duration,
          ease: 'power2.in',
          onUpdate: () =>
            updateHingedDoor(
              mesh,
              side,
              state.progress,
              perspectiveDepth,
              DOOR_MIN_WIDTH
            )
        },
        0
      )
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
    this.previousPageZone.eventMode = 'none'
    this.nextPageZone.eventMode = 'none'
    this.setDeckInteractionEnabled(false)
    this.sceneManager.cursor?.setContextVariant(null)
  }

  update(_deltaMS: number): void {}
}
