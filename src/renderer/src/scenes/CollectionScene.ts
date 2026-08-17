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
import { ASSET_BUNDLE_IDS, CollectionAssets } from '../core/assets'
import type { CursorContextVariant } from '../core/cursor'
import { playerDeckStore, type DeckStore } from '../core/decks'
import { Button } from '../actors/Button'
import { buildCollectionPages, type CollectionPage } from './collectionPages'
import { NewDeckScene } from './NewDeckScene'
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
  panel: { x: 1385, y: 0, width: 390, height: GAME_HEIGHT },
  header: { x: 1575, y: 50 },
  name: { x: 1575, y: 185 },
  count: { x: 1575, y: 225 },
  status: { x: 1575, y: 265 },
  cardList: { x: 1415, y: 310, width: 330, height: 650 },
  backButton: { x: 1705, y: 1038 }
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
const DECK_NUMBER_FONT_SIZE = 64
const DECK_EDITOR_CARD_ROW_HEIGHT = 20

type DoorSide = 'left' | 'right'

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
  private deckEditorNumber!: Text
  private deckEditorName!: Text
  private deckEditorCount!: Text
  private deckEditorStatus!: Text
  private deckEditorCardContent!: Container
  private deckEditorBackButton!: Button
  private newDeckScene!: NewDeckScene
  private readonly deckEntries: Container[] = []
  private readonly deckButtons: Button[] = []
  private deckScrollOffset = 0
  private deckMaxScroll = 0
  private deckSliderDragging = false
  private deckSliderDragOffset = 0
  private activeDeckId: string | null = null
  private unsubscribeDeckStore: (() => void) | null = null
  private deckAssets!: Pick<
    CollectionAssets,
    'loadDeckButton' | 'newDeckButton' | 'verticalSlider' | 'backButton'
  >
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
  private navigationReady = false
  private disposed = false

  constructor(deckStore: DeckStore = playerDeckStore) {
    super()
    this.deckStore = deckStore
  }

  async init(): Promise<void> {
    const assets = await this.assetScope.acquire<CollectionAssets>(
      ASSET_BUNDLE_IDS.collection
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
      50,
      'collection-previous-page',
      () => this.changePage(-1)
    )
    this.nextPageZone = this.createPageZone(
      1310,
      PAGE_RIGHT - 1310,
      'collection-next-page',
      () => this.changePage(1)
    )
    this.pageContent.addChild(this.previousPageZone)
    this.pageContent.addChild(this.nextPageZone)

    // The cover is hinged on its left edge. The separate lock is hinged on
    // its right edge, matching the direction shown in the reference images.
    this.cover = this.createDoorMesh(assets.cover, 'left', Layout.cover)
    this.root.addChild(this.cover)

    this.coverLock = this.createDoorMesh(assets.coverLock, 'right', {
      x: Layout.cover.x + Layout.coverLock.x,
      y: Layout.cover.y + Layout.coverLock.y
    })
    this.root.addChild(this.coverLock)

    // Keep the closed doors visible while SceneTransitionHost presents this
    // scene in the inset. The afterTransition callback only starts their
    // opening animation after the destination reaches the full viewport.
    this.cover.visible = true
    this.coverLock.visible = true
    this.updateDoor(this.cover, 'left', 0, COVER_PERSPECTIVE_DEPTH)
    this.updateDoor(this.coverLock, 'right', 0, COVER_LOCK_PERSPECTIVE_DEPTH)

    if (this.pages.length === 0) {
      throw new Error('Collection has no cards to display')
    }

    this.setNavigationEnabled(false)
    await this.deckStore.load()
    await this.waitForFonts()
    this.createDeckList(assets)
    this.createDeckEditor(assets)
    this.newDeckScene = new NewDeckScene(this.deckStore, {
      onClassSelected: (hero) => this.handleNewDeckHeroSelected(hero.heroClass),
      onCancelled: () => this.handleNewDeckCreationCancelled(),
      onDeckCreated: (deck) => this.handleNewDeckCreated(deck)
    })
    await this.addSubScene(this.newDeckScene)
    this.unsubscribeDeckStore = this.deckStore.subscribe(this.handleDeckStoreChanged)
    await this.renderPage(0)
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
      document.fonts.load(`${DECK_NUMBER_FONT_SIZE}px Belwe`),
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
    this.setNavigationEnabled(false)

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
        if (!this.disposed && this.navigationReady) {
          this.setNavigationEnabled(true)
        }
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
    this.deckAssets = {
      loadDeckButton: assets.loadDeckButton,
      newDeckButton: assets.newDeckButton,
      verticalSlider: assets.verticalSlider,
      backButton: assets.backButton
    }

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

  private createDeckEditor(assets: CollectionAssets): void {
    this.deckEditorLayer = new Container()

    const panel = new Graphics()
      .rect(
        DECK_EDITOR_LAYOUT.panel.x,
        DECK_EDITOR_LAYOUT.panel.y,
        DECK_EDITOR_LAYOUT.panel.width,
        DECK_EDITOR_LAYOUT.panel.height
      )
      .fill({ color: 0x251a35, alpha: 0.97 })
    panel
      .rect(
        DECK_EDITOR_LAYOUT.panel.x + 4,
        4,
        DECK_EDITOR_LAYOUT.panel.width - 8,
        DECK_EDITOR_LAYOUT.panel.height - 8
      )
      .stroke({ color: 0xc49a4b, width: 4, alpha: 0.9 })
    panel.eventMode = 'none'
    this.deckEditorLayer.addChild(panel)

    const cardListPanel = new Graphics()
      .rect(
        DECK_EDITOR_LAYOUT.cardList.x,
        DECK_EDITOR_LAYOUT.cardList.y,
        DECK_EDITOR_LAYOUT.cardList.width,
        DECK_EDITOR_LAYOUT.cardList.height
      )
      .fill({ color: 0x130e1c, alpha: 0.72 })
      .stroke({ color: 0x705338, width: 2, alpha: 0.9 })
    cardListPanel.eventMode = 'none'
    this.deckEditorLayer.addChild(cardListPanel)

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

    this.deckEditorNumber = this.createEditorText(DECK_NUMBER_FONT_SIZE, 0xf4e6c8)
    this.deckEditorNumber.position.set(
      DECK_EDITOR_LAYOUT.header.x,
      DECK_EDITOR_LAYOUT.header.y
    )
    this.deckEditorLayer.addChild(this.deckEditorNumber)

    this.deckEditorName = this.createEditorText(28, 0xf1e4c8)
    this.deckEditorName.position.set(
      DECK_EDITOR_LAYOUT.name.x,
      DECK_EDITOR_LAYOUT.name.y
    )
    this.deckEditorLayer.addChild(this.deckEditorName)

    this.deckEditorCount = this.createEditorText(24, 0xc9b384)
    this.deckEditorCount.position.set(
      DECK_EDITOR_LAYOUT.count.x,
      DECK_EDITOR_LAYOUT.count.y
    )
    this.deckEditorLayer.addChild(this.deckEditorCount)

    this.deckEditorStatus = this.createEditorText(18, 0x9d8aaa)
    this.deckEditorStatus.position.set(
      DECK_EDITOR_LAYOUT.status.x,
      DECK_EDITOR_LAYOUT.status.y
    )
    this.deckEditorLayer.addChild(this.deckEditorStatus)

    this.deckEditorCardContent = new Container()
    this.deckEditorLayer.addChild(this.deckEditorCardContent)

    this.deckEditorBackButton = new Button(assets.backButton, {
      onClick: () => this.exitDeckEditor()
    })
    this.deckEditorBackButton.position.set(
      DECK_EDITOR_LAYOUT.backButton.x,
      DECK_EDITOR_LAYOUT.backButton.y
    )
    this.deckEditorBackButton.setBaseY(DECK_EDITOR_LAYOUT.backButton.y)
    this.deckEditorLayer.addChild(this.deckEditorBackButton)

    this.deckEditorLayer.visible = false
    this.deckEditorLayer.alpha = 0
    this.root.addChild(this.deckEditorLayer)
  }

  private createEditorText(fontSize: number, fill: number): Text {
    const text = new Text({
      text: '',
      style: {
        fontFamily: 'Belwe',
        fontSize,
        fill,
        align: 'center'
      }
    })
    text.anchor.set(0.5)
    text.eventMode = 'none'
    return text
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
        this.deckAssets.loadDeckButton,
        String(index + 1),
        () => this.enterDeck(deck.id),
        index,
        () => this.deleteDeck(deck.id)
      )
    }

    this.addDeckEntry(
      this.deckAssets.newDeckButton,
      null,
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
    label: string | null,
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

    if (label !== null) {
      const number = new Text({
        text: label,
        style: {
          fontFamily: 'Belwe',
          fontSize: DECK_NUMBER_FONT_SIZE,
          fill: 0xf4e6c8,
          align: 'center'
        }
      })
      number.anchor.set(0.5)
      number.position.set(0, 0)
      number.eventMode = 'none'
      entry.addChild(number)
    }

    this.deckEntries.push(entry)
    this.deckContent.addChild(entry)
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

    if (this.deckEditorBackButton) {
      this.deckEditorBackButton.setEnabled(enabled && this.activeDeckId !== null)
    }
    if (this.deckEditorButton) {
      this.deckEditorButton.setEnabled(enabled && this.activeDeckId !== null)
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

  private readonly handleDeckStoreChanged = (): void => {
    if (this.activeDeckId) {
      if (!this.deckStore.getDeck(this.activeDeckId)) {
        this.exitDeckEditor()
        this.renderDeckList()
      } else {
        this.updateDeckEditor()
      }
      return
    }

    this.renderDeckList()
  }

  private enterDeck(deckId: string): void {
    if (!this.navigationReady || this.disposed) return
    if (!this.deckStore.getDeck(deckId)) return

    this.activeDeckId = deckId
    this.deckViewport.visible = false
    this.deckSlider.visible = false
    this.deckEditorLayer.visible = true
    this.deckEditorLayer.alpha = 0
    this.updateDeckEditor()
    this.setDeckInteractionEnabled(true)
    this.tweenTo(this.deckEditorLayer, {
      alpha: 1,
      duration: 0.2,
      ease: 'power2.out'
    })
  }

  private exitDeckEditor(): void {
    if (!this.deckEditorLayer) return

    this.killTweensOf(this.deckEditorLayer)
    this.activeDeckId = null
    this.deckEditorLayer.visible = false
    this.deckEditorLayer.alpha = 0
    this.deckViewport.visible = true
    this.updateDeckSliderPosition()
    this.setDeckInteractionEnabled(this.navigationReady && !this.disposed)
  }

  private updateDeckEditor(): void {
    if (!this.activeDeckId) return

    const deck = this.deckStore.getDeck(this.activeDeckId)
    if (!deck) {
      this.exitDeckEditor()
      return
    }

    const deckNumber = this.deckStore
      .getDecks()
      .findIndex((candidate) => candidate.id === deck.id)
    this.deckEditorNumber.text = String(deckNumber + 1)
    this.deckEditorName.text = deck.name
    this.deckEditorCount.text = `${countDeckCards(deck)} / ${MAX_DECK_CARDS} cards`
    this.renderDeckStatus('Click a collection card to add it')

    const oldRows = this.deckEditorCardContent.removeChildren()
    for (const row of oldRows) {
      row.destroy({ children: true })
    }

    const entries = Object.entries(deck.cards).sort(([left], [right]) =>
      left.localeCompare(right)
    )
    for (const [index, [cardId, count]] of entries.entries()) {
      const card = CARD_CATALOG.get(cardId)
      const row = new Text({
        text: `${count}× ${card?.name ?? cardId}`,
        style: {
          fontFamily: 'Franklin Gothic Condensed',
          fontSize: 20,
          fill: 0xe6d9bd
        }
      })
      row.position.set(
        DECK_EDITOR_LAYOUT.cardList.x + 18,
        DECK_EDITOR_LAYOUT.cardList.y + 16 + index * DECK_EDITOR_CARD_ROW_HEIGHT
      )
      row.eventMode = 'static'
      row.cursor = 'pointer'
      row.on('rightclick', (event: FederatedPointerEvent) => {
        event.stopPropagation()
        void this.removeCardFromActiveDeck(cardId).catch((error: unknown) => {
          console.error(
            `Failed to remove ${card?.name ?? cardId} from the deck:`,
            error
          )
          this.renderDeckStatus('Could not update the deck.', true)
        })
      })
      this.deckEditorCardContent.addChild(row)
    }
  }

  private renderDeckStatus(message: string, error = false): void {
    this.deckEditorStatus.text = message
    this.deckEditorStatus.style.fill = error ? 0xff9b86 : 0x9d8aaa
  }

  private async addCardToActiveDeck(card: CardDefinition): Promise<void> {
    const deckId = this.activeDeckId
    if (!deckId) return

    const result = await this.deckStore.addCard(deckId, card)
    if (!result.ok) {
      this.renderDeckStatus(result.message, true)
      return
    }

    this.updateDeckEditor()
    this.renderDeckStatus(`Added ${card.name}`)
  }

  private async removeCardFromActiveDeck(cardId: string): Promise<void> {
    const deckId = this.activeDeckId
    if (!deckId) return

    const result = await this.deckStore.removeCard(deckId, cardId)
    if (!result.ok) {
      this.renderDeckStatus(result.message, true)
      return
    }

    this.updateDeckEditor()
    const card = CARD_CATALOG.get(cardId)
    this.renderDeckStatus(`Removed ${card?.name ?? cardId}`)
  }

  private readonly handleCollectionCardTap = (
    event: FederatedPointerEvent,
    card: CardDefinition
  ): void => {
    if (!this.activeDeckId) return

    event.stopPropagation()
    void this.addCardToActiveDeck(card).catch((error: unknown) => {
      console.error(`Failed to add ${card.name} to the deck:`, error)
      this.renderDeckStatus('Could not update the deck.', true)
    })
  }

  private async beginNewDeckCreation(): Promise<void> {
    if (!this.navigationReady || this.disposed || this.newDeckScene.isOpen) {
      return
    }

    this.previousCollectionClassFilter = this.collectionClassFilter
    this.setNavigationEnabled(false)
    this.setDeckInteractionEnabled(false)
    await this.newDeckScene.open()
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

  private handleNewDeckCreated(deck: Deck): void {
    this.previousCollectionClassFilter = null
    if (this.disposed) return

    this.setNavigationEnabled(true)
    this.enterDeck(deck.id)
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
    zone.on('pointerover', () =>
      this.sceneManager.cursor?.setContextVariant(cursorVariant)
    )
    zone.on('pointerout', () => this.sceneManager.cursor?.setContextVariant(null))
    zone.on('pointertap', onClick)
    return zone
  }

  private setNavigationEnabled(enabled: boolean): void {
    this.sceneManager.cursor?.setContextVariant(null)

    const creationOpen = this.newDeckScene?.isOpen ?? false
    const navigationEnabled = enabled && !creationOpen

    this.previousPageZone.eventMode =
      navigationEnabled && this.pageIndex > 0 ? 'static' : 'none'
    this.nextPageZone.eventMode =
      navigationEnabled && this.pageIndex < this.pages.length - 1 ? 'static' : 'none'
  }

  private changePage(delta: number): void {
    if (this.pageLoading || !this.navigationReady) return

    const nextIndex = this.pageIndex + delta
    if (nextIndex < 0 || nextIndex >= this.pages.length) return

    void this.renderPage(nextIndex).catch((error: unknown) => {
      console.error(`Failed to render collection page ${nextIndex}:`, error)
    })
  }

  /** Creates a mesh whose local origin is the selected door hinge. */
  private createDoorMesh(
    texture: Texture,
    side: DoorSide,
    topLeft: { x: number; y: number }
  ): PerspectiveMesh {
    const width = texture.width
    const height = texture.height
    const hingeOnLeft = side === 'left'

    const mesh = new PerspectiveMesh({
      texture,
      verticesX: 10,
      verticesY: 10,
      x0: hingeOnLeft ? 0 : -width,
      y0: 0,
      x1: hingeOnLeft ? width : 0,
      y1: 0,
      x2: hingeOnLeft ? width : 0,
      y2: height,
      x3: hingeOnLeft ? 0 : -width,
      y3: height
    })

    mesh.position.set(topLeft.x + (hingeOnLeft ? 0 : width), topLeft.y)

    return mesh
  }

  /**
   * Animates the same top-view door geometry used by the main-menu lids:
   * cosine compresses the visible width while sine adds a small perspective
   * bend at the free edge.
   */
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
          onUpdate: () => this.updateDoor(mesh, side, state.progress, perspectiveDepth)
        },
        0
      )
    })
  }

  private updateDoor(
    mesh: PerspectiveMesh,
    side: DoorSide,
    progress: number,
    perspectiveDepth: number
  ): void {
    const clampedProgress = Math.max(0, Math.min(1, progress))
    const angle = clampedProgress * (Math.PI / 2)
    const widthScale = Math.cos(angle)
    const depth = Math.sin(angle) * perspectiveDepth
    const visibleWidth = Math.max(DOOR_MIN_WIDTH, mesh.texture.width * widthScale)

    this.setDoorCorners(mesh, side, visibleWidth, depth)
  }

  private setDoorCorners(
    mesh: PerspectiveMesh,
    side: DoorSide,
    visibleWidth: number,
    depth: number
  ): void {
    const height = mesh.texture.height
    const hingeOnLeft = side === 'left'
    const freeEdgeX = hingeOnLeft ? visibleWidth : -visibleWidth

    if (hingeOnLeft) {
      mesh.setCorners(0, 0, freeEdgeX, -depth, freeEdgeX, height + depth, 0, height)
      return
    }

    mesh.setCorners(freeEdgeX, -depth, 0, 0, 0, height, freeEdgeX, height + depth)
  }

  protected onExit(): void {
    this.disposed = true
    this.renderSequence += 1
    this.pageLoading = false
    this.navigationReady = false
    this.unsubscribeDeckStore?.()
    this.unsubscribeDeckStore = null
    this.activeDeckId = null
    this.previousPageZone.eventMode = 'none'
    this.nextPageZone.eventMode = 'none'
    this.setDeckInteractionEnabled(false)
    this.sceneManager.cursor?.setContextVariant(null)
  }

  update(_deltaMS: number): void {}
}
