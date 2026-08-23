import {
  AlphaFilter,
  ColorMatrixFilter,
  Container,
  PerspectiveMesh,
  Rectangle,
  Sprite,
  Text
} from 'pixi.js'
import type { FederatedPointerEvent } from 'pixi.js'
import {
  CARD_CATALOG,
  type CardDefinition,
  type DeckClass,
  type ExpansionId
} from '../../../game/content/cards'
import { EXPANSION_CATALOG } from '../../../game/content/expansions'
import { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'
import { CardView } from '../../rendering/cards/card-view'
import { createManaHighlightFilter } from '../../rendering/filters/highlight'
import { applyAnchoredPlacement } from '../../rendering/layout'
import { Actor } from '../../ui/components/actor'
import type { CollectionAssets } from '../../ui/asset-registry'
import type { CursorContextVariant, CursorManager } from '../../ui/components/cursor'
import {
  animateHingedDoor,
  createHingedDoorMesh,
  updateHingedDoor
} from './choreography/hinged-door'
import {
  CARD_GRID_LAYOUT,
  COLLECTION_LAYOUT,
  COLLECTION_TIMING,
  COMPLETED_COLLECTION_CARD_ALPHA,
  COVER_LOCK_OPEN_DURATION,
  COVER_LOCK_PERSPECTIVE_DEPTH,
  COVER_OPEN_DURATION,
  COVER_PERSPECTIVE_DEPTH,
  DOOR_MIN_WIDTH,
  PAGE_HEIGHT,
  PAGE_LEFT,
  PAGE_NAV_ZONE_WIDTH,
  PAGE_RIGHT,
  PAGE_TOP,
  getExpansionFilterButtonPlacement
} from './collection-layout'
import { buildCollectionPages, type CollectionPage } from './collection-pages'
import {
  formatManaFilterLabel,
  MANA_FILTER_VALUES,
  type ManaFilterValue
} from './collection-filters'
import { queryCollectionCards } from './collection-query'
import { CollectionQueryController } from './collection-query-controller'
import { getCollectionCardPlacement } from './collection-card-grid'
import { CollectionSearchInput } from './search-input'
import { ExpansionTray } from './expansion-tray'
import { getCardCopyLimit, getDeckCardCount, type Deck } from '../../../game/decks'
import type { CardPreviewRouteBounds } from '../../app/router'

export interface CollectionViewStateProvider {
  readonly isNavigationReady: () => boolean
  readonly isNewDeckOpen: () => boolean
  readonly isEditorTransitioning: () => boolean
  readonly isEditorClosing: () => boolean
  readonly isEditorMutating: () => boolean
  readonly getActiveDeck: () => Deck | null
}

export interface CollectionViewCallbacks {
  readonly onCardTap?: (card: CardDefinition, source: CollectionCardAddSource) => void
  readonly onCardPreview?: (
    card: CardDefinition,
    sourceBounds: CardPreviewRouteBounds
  ) => void | Promise<void>
  readonly onRevealComplete?: () => void
  readonly onError?: (message: string, error?: unknown) => void
  readonly onWarning?: (message: string, error?: unknown) => void
}

export interface CollectionCardAddSource {
  readonly view: CardView
  readonly bounds: CardPreviewRouteBounds
}

export interface CollectionViewOptions {
  readonly assets: CollectionAssets
  readonly canvas: HTMLCanvasElement
  readonly cursor: CursorManager | null
  readonly state: CollectionViewStateProvider
  readonly callbacks?: CollectionViewCallbacks
}

/**
 * Feature-owned presentation for the collection page browsing area: the card
 * grid, mana/search/expansion filters, page zones, and the hinged cover reveal.
 */
export class CollectionView extends Actor {
  private pages: readonly CollectionPage[] = buildCollectionPages(CARD_CATALOG.all)
  private readonly collectionQuery = new CollectionQueryController()
  private readonly cardResolver = new CardAssetResolver()
  private completedCollectionCardAlphaFilter: AlphaFilter | null = null

  private pageContent!: Container
  private cardLayer!: Container
  private classLabel!: Text
  private pageLabel!: Text
  private emptyStateImage!: Sprite
  private previousPageZone!: Container
  private nextPageZone!: Container
  private cover!: PerspectiveMesh
  private coverLock!: PerspectiveMesh
  private coverRevealPromise: Promise<void> | null = null
  private manaFilterHighlightFilter: ColorMatrixFilter | null = null
  private readonly manaFilterControls: Container[] = []
  private readonly manaFilterCrystals: Sprite[] = []
  private readonly manaFilterLabels: Text[] = []
  private searchInput: CollectionSearchInput | null = null
  private searchClearButton!: Sprite
  private expansionTray: ExpansionTray | null = null
  private navigationEnabled = false
  private pageIndex = 0
  private renderSequence = 0
  private pageLoading = false
  private hoveredPageZone: CursorContextVariant | null = null
  private pageHoverSequence = 0
  private cardPreviewOpening = false
  private disposed = false

  constructor(private readonly options: CollectionViewOptions) {
    super()
  }

  init(): void {
    this.pageContent = new Container()
    this.addChild(this.pageContent)

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
    this.classLabel.position.set(
      COLLECTION_LAYOUT.classLabel.position.x,
      COLLECTION_LAYOUT.classLabel.position.y
    )
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
    this.pageLabel.position.set(
      COLLECTION_LAYOUT.pageLabel.position.x,
      COLLECTION_LAYOUT.pageLabel.position.y
    )
    this.pageLabel.eventMode = 'none'
    this.pageContent.addChild(this.pageLabel)

    this.emptyStateImage = new Sprite(this.options.assets.searchNoResults)
    this.emptyStateImage.anchor.set(0.5)
    this.emptyStateImage.position.set(
      COLLECTION_LAYOUT.collectionFilters.noResults.position.x,
      COLLECTION_LAYOUT.collectionFilters.noResults.position.y
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
    this.cover = createHingedDoorMesh(
      this.options.assets.cover,
      'left',
      COLLECTION_LAYOUT.cover.position
    )
    this.addChild(this.cover)

    this.coverLock = createHingedDoorMesh(this.options.assets.coverLock, 'right', {
      x: COLLECTION_LAYOUT.cover.position.x + COLLECTION_LAYOUT.coverLock.position.x,
      y: COLLECTION_LAYOUT.cover.position.y + COLLECTION_LAYOUT.coverLock.position.y
    })
    this.addChild(this.coverLock)

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
    this.createCollectionFilters()
    this.createExpansionFilter()
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

  setNavigationEnabled(enabled: boolean): void {
    this.navigationEnabled = enabled
    this.pageHoverSequence += 1
    this.hoveredPageZone = null
    this.options.cursor?.setContextVariant(null)

    this.updatePageZoneModes()
    this.updateCollectionFilterModes()
  }

  setSearchInputVisible(visible: boolean): void {
    this.searchInput?.setVisible(visible)
  }

  get classFilter(): DeckClass | null {
    return this.collectionQuery.classFilter
  }

  get collectibleMode(): string {
    return this.collectionQuery.collectibleMode
  }

  async setCollectibleMode(
    mode: import('./collection-filters').CollectibleMode
  ): Promise<void> {
    if (this.collectionQuery.collectibleMode === mode) return
    this.collectionQuery.setCollectibleMode(mode)
    await this.applyCollectionFilters()
  }

  /** Re-applies deck copy-limit dimming to the current page. */
  refreshCompletionState(): void {
    this.updateCollectionCardCompletionState()
  }

  async applyClassFilter(heroClass: DeckClass | null): Promise<void> {
    if (this.collectionQuery.classFilter === heroClass && this.pages.length > 0) return

    this.collectionQuery.setClassFilter(heroClass)
    await this.applyCollectionFilters()
  }

  onPause(): void {
    this.setSearchInputVisible(false)
    for (const control of this.manaFilterControls) {
      control.eventMode = 'none'
    }
    this.expansionTray?.setEnabled(false)
  }

  onResume(): void {
    this.updateCollectionFilterModes()
  }

  onExit(): void {
    this.disposed = true
    this.renderSequence += 1
    this.pageLoading = false
    this.navigationEnabled = false
    this.hoveredPageZone = null
    this.cardPreviewOpening = false
    this.previousPageZone.eventMode = 'none'
    this.nextPageZone.eventMode = 'none'
    for (const control of this.manaFilterControls) {
      control.eventMode = 'none'
    }
    this.setSearchInputVisible(false)
    this.searchInput?.dispose()
    this.searchInput = null
    this.expansionTray?.dispose()
    this.expansionTray = null
    this.options.cursor?.setContextVariant(null)
  }

  private async revealCover(): Promise<void> {
    this.cover.visible = true
    this.coverLock.visible = true

    await animateHingedDoor(
      (vars) => this.timeline(vars),
      this.coverLock,
      'right',
      COVER_LOCK_OPEN_DURATION,
      COVER_LOCK_PERSPECTIVE_DEPTH
    )
    this.coverLock.visible = false

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
      this.options.callbacks?.onRevealComplete?.()
    }
  }

  private createCollectionFilters(): void {
    const collectionFilterLayer = new Container()
    this.pageContent.addChild(collectionFilterLayer)

    for (const [index, value] of MANA_FILTER_VALUES.entries()) {
      const control = new Container()
      control.position.set(
        COLLECTION_LAYOUT.collectionFilters.mana.firstCrystalCenter.x +
          index * COLLECTION_LAYOUT.collectionFilters.mana.gap,
        COLLECTION_LAYOUT.collectionFilters.mana.firstCrystalCenter.y
      )
      control.hitArea = new Rectangle(-30, -52, 60, 96)
      control.eventMode = 'static'
      control.cursor = 'pointer'
      control.on('pointertap', (event: FederatedPointerEvent) => {
        event.stopPropagation()
        this.handleManaFilterTap(value)
      })

      const crystal = new Sprite(this.options.assets.manaCrystal)
      applyAnchoredPlacement(crystal, COLLECTION_LAYOUT.collectionFilters.mana.crystal)
      crystal.eventMode = 'none'
      control.addChild(crystal)
      control.on('pointerover', () => {
        crystal.filters = [this.getManaFilterHighlightFilter()]
      })
      control.on('pointerout', () => {
        this.updateManaFilterAppearance()
      })

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
        COLLECTION_LAYOUT.collectionFilters.mana.labelOffset.x,
        COLLECTION_LAYOUT.collectionFilters.mana.labelOffset.y
      )
      label.eventMode = 'none'
      control.addChild(label)

      this.manaFilterControls.push(control)
      this.manaFilterCrystals.push(crystal)
      this.manaFilterLabels.push(label)
      collectionFilterLayer.addChild(control)
    }

    this.searchClearButton = new Sprite(this.options.assets.searchClear)
    this.searchClearButton.anchor.set(0.5)
    this.searchClearButton.position.set(
      COLLECTION_LAYOUT.collectionFilters.searchClear.position.x,
      COLLECTION_LAYOUT.collectionFilters.searchClear.position.y
    )
    this.searchClearButton.width =
      COLLECTION_LAYOUT.collectionFilters.searchClear.size.width
    this.searchClearButton.height =
      COLLECTION_LAYOUT.collectionFilters.searchClear.size.height
    this.searchClearButton.hitArea = new Rectangle(-26, -26, 52, 52)
    this.searchClearButton.eventMode = 'static'
    this.searchClearButton.cursor = 'pointer'
    this.searchClearButton.visible = false
    this.searchClearButton.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation()
      this.clearSearch()
    })
    collectionFilterLayer.addChild(this.searchClearButton)

    this.updateManaFilterAppearance()
    this.createSearchInput()
  }

  private createExpansionFilter(): void {
    this.expansionTray = new ExpansionTray({
      assets: {
        toggle: this.options.assets.expansionToggle,
        tray: this.options.assets.expansionTray,
        collectionOn: this.options.assets.expansionCollectionOn,
        collectionOff: this.options.assets.expansionCollectionOff
      },
      layout: {
        toggle: COLLECTION_LAYOUT.expansionFilter.toggle,
        trayOpen: COLLECTION_LAYOUT.expansionFilter.trayOpen,
        trayClosed: COLLECTION_LAYOUT.expansionFilter.trayClosed,
        buttons: EXPANSION_CATALOG.all.map((_, index) =>
          getExpansionFilterButtonPlacement(index)
        )
      },
      slideDuration: COLLECTION_TIMING.expansionTraySlide,
      isHidden: (expansionId) =>
        this.collectionQuery.hiddenExpansionIds.includes(expansionId),
      onToggleExpansion: (expansionId) => this.handleExpansionFilterTap(expansionId),
      onError: (error) =>
        this.options.callbacks?.onError?.('Failed to filter the collection.', error)
    })
    this.pageContent.addChild(this.expansionTray)
  }

  private createSearchInput(): void {
    const parent = this.options.canvas.parentElement
    if (!parent) return

    this.searchInput = new CollectionSearchInput({
      canvas: this.options.canvas,
      parent,
      bounds: {
        x: COLLECTION_LAYOUT.collectionFilters.searchInput.position.x,
        y: COLLECTION_LAYOUT.collectionFilters.searchInput.position.y,
        width: COLLECTION_LAYOUT.collectionFilters.searchInput.size.width,
        height: COLLECTION_LAYOUT.collectionFilters.searchInput.size.height
      },
      onInput: this.handleSearchInput
    })
    this.searchInput.mount(this.collectionQuery.searchQuery)
    this.setSearchInputVisible(false)
  }

  private readonly handleSearchInput = (value: string): void => {
    this.collectionQuery.setSearchQuery(value)
    this.updateSearchClearVisibility()
    void this.applyCollectionFilters().catch((error: unknown) => {
      this.options.callbacks?.onError?.('Failed to filter the collection.', error)
    })
  }

  private clearSearch(): void {
    if (!this.searchInput) return

    this.searchInput.setValue('')
    this.collectionQuery.setSearchQuery('')
    this.updateSearchClearVisibility()
    this.searchInput.focus()
    void this.applyCollectionFilters().catch((error: unknown) => {
      this.options.callbacks?.onError?.('Failed to clear the collection search.', error)
    })
  }

  private updateSearchClearVisibility(): void {
    this.searchClearButton.visible = this.collectionQuery.searchQuery.length > 0
  }

  private setSearchInputEnabled(enabled: boolean): void {
    this.searchInput?.setEnabled(enabled)
  }

  private handleExpansionFilterTap(expansionId: ExpansionId): void {
    if (
      !this.options.state.isNavigationReady() ||
      !this.navigationEnabled ||
      this.options.state.isNewDeckOpen()
    ) {
      return
    }

    this.collectionQuery.toggleExpansionVisibility(expansionId)
    this.expansionTray?.syncHiddenExpansions()
    void this.applyCollectionFilters().catch((error: unknown) => {
      this.options.callbacks?.onError?.('Failed to filter the collection.', error)
    })
  }

  private handleManaFilterTap(value: ManaFilterValue): void {
    if (
      !this.options.state.isNavigationReady() ||
      !this.navigationEnabled ||
      this.options.state.isNewDeckOpen()
    ) {
      return
    }

    this.collectionQuery.toggleManaFilter(value)
    this.updateManaFilterAppearance()
    void this.applyCollectionFilters().catch((error: unknown) => {
      this.options.callbacks?.onError?.('Failed to filter the collection.', error)
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
      this.manaFilterHighlightFilter = createManaHighlightFilter()
    }

    return this.manaFilterHighlightFilter
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

  async renderPage(index: number): Promise<void> {
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
            this.handleCollectionCardTap(event, card, view)
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

  private updateCollectionCardCompletionState(): void {
    const page = this.pages[this.pageIndex]
    const deck = this.options.state.getActiveDeck()
    if (!this.cardLayer || !page) return

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

  private readonly handleCollectionCardTap = (
    event: FederatedPointerEvent,
    card: CardDefinition,
    view: CardView
  ): void => {
    if (
      event.button !== 0 ||
      !this.options.state.getActiveDeck() ||
      this.options.state.isEditorTransitioning()
    ) {
      return
    }

    event.stopPropagation()
    this.options.callbacks?.onCardTap?.(card, {
      view,
      bounds: this.getCardBounds(view)
    })
  }

  private getCardBounds(view: CardView): CardPreviewRouteBounds {
    const bounds = view.getBounds()
    const topLeft = this.toLocal({ x: bounds.x, y: bounds.y })
    const bottomRight = this.toLocal({
      x: bounds.x + bounds.width,
      y: bounds.y + bounds.height
    })
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y
    }
  }

  private readonly handleCollectionCardPreview = (
    event: FederatedPointerEvent,
    card: CardDefinition,
    view: CardView
  ): void => {
    if (
      event.button !== 2 ||
      this.disposed ||
      !this.options.state.isNavigationReady() ||
      this.options.state.isEditorTransitioning() ||
      this.options.state.isEditorMutating()
    ) {
      return
    }

    event.stopPropagation()
    if (this.cardPreviewOpening) return

    this.cardPreviewOpening = true
    const sourceBounds = this.getCardBounds(view)

    const result = this.options.callbacks?.onCardPreview?.(card, sourceBounds)
    if (result instanceof Promise) {
      void result
        .catch(() => undefined)
        .finally(() => {
          this.cardPreviewOpening = false
        })
    } else {
      this.cardPreviewOpening = false
    }
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
      this.options.cursor?.setContextVariant(cursorVariant)
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
        this.options.cursor?.setContextVariant(null)
      })
    })
    zone.on('pointertap', onClick)
    return zone
  }

  private updateCollectionFilterModes(): void {
    const filtersEnabled =
      this.navigationEnabled &&
      this.options.state.isNavigationReady() &&
      !this.options.state.isNewDeckOpen() &&
      !this.options.state.isEditorTransitioning() &&
      !this.options.state.isEditorClosing()

    for (const control of this.manaFilterControls) {
      control.eventMode = filtersEnabled ? 'static' : 'none'
    }
    if (this.searchClearButton) {
      this.searchClearButton.eventMode = filtersEnabled ? 'static' : 'none'
    }
    this.setSearchInputEnabled(filtersEnabled)
    this.expansionTray?.setEnabled(filtersEnabled)
  }

  private updatePageZoneModes(): void {
    const creationOpen = this.options.state.isNewDeckOpen()
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
      this.options.cursor?.setContextVariant(null)
    }
  }

  private changePage(delta: number): void {
    if (this.pageLoading || !this.options.state.isNavigationReady()) return

    const nextIndex = this.pageIndex + delta
    if (nextIndex < 0 || nextIndex >= this.pages.length) return

    void this.renderPage(nextIndex).catch((error: unknown) => {
      this.options.callbacks?.onError?.(
        `Failed to render collection page ${nextIndex}.`,
        error
      )
    })
  }
}
