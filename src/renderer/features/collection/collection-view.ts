import {
  ColorMatrixFilter,
  Container,
  Graphics,
  PerspectiveMesh,
  Rectangle,
  Sprite,
  Text
} from 'pixi.js'
import type { FederatedPointerEvent, Renderer } from 'pixi.js'
import {
  CARD_CATALOG,
  CARD_CLASSES,
  type CardDefinition,
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
} from '../../rendering/effects/hinged-door'
import {
  COLLECTION_LAYOUT,
  COLLECTION_TIMING,
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
import { queryCollectionCards, type CollectionClassFilter } from './collection-query'
import { CollectionQueryController } from './collection-query-controller'
import { CollectionPageView } from './collection-page-view'
import { CollectionSearchInput } from './search-input'
import { ExpansionTray } from './expansion-tray'
import type { Deck } from '../../../game/decks'
import type { CardPreviewRouteBounds } from '../card-preview/card-preview-route'

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
  readonly renderer: Renderer
  readonly cursor: CursorManager | null
  readonly state: CollectionViewStateProvider
  readonly callbacks?: CollectionViewCallbacks
}

interface ClassFilterControl {
  readonly cardClass: Exclude<CollectionClassFilter, null>
  readonly control: Container
  readonly background: Graphics
  readonly label: Text
  hovered: boolean
}

/**
 * Feature-owned presentation for the collection page browsing area: the card
 * grid, mana/search/expansion filters, page zones, and the hinged cover reveal.
 */
export class CollectionView extends Actor {
  private readonly collectionQuery = new CollectionQueryController()
  private pages: readonly CollectionPage[] = []
  private readonly cardResolver = new CardAssetResolver()

  private readonly pageView: CollectionPageView
  private previousPageZone!: Container
  private nextPageZone!: Container
  private cover!: PerspectiveMesh
  private coverLock!: PerspectiveMesh
  private coverRevealPromise: Promise<void> | null = null
  private manaFilterHighlightFilter: ColorMatrixFilter | null = null
  private readonly manaFilterControls: Container[] = []
  private readonly manaFilterCrystals: Sprite[] = []
  private readonly manaFilterLabels: Text[] = []
  private readonly classFilterControls: ClassFilterControl[] = []
  private searchInput: CollectionSearchInput | null = null
  private searchClearButton!: Sprite
  private expansionTray: ExpansionTray | null = null
  private navigationEnabled = false
  private pageIndex = 0
  private renderSequence = 0
  private pageLoading = false
  private hoveredPageZone: CursorContextVariant | null = null
  private pageHoverSequence = 0
  private disposed = false

  constructor(private readonly options: CollectionViewOptions) {
    super()
    this.pageView = new CollectionPageView({
      assets: options.assets,
      resolver: this.cardResolver,
      state: options.state,
      getCardBounds: (view) => this.getCardBounds(view),
      onCardTap: (card, source) => options.callbacks?.onCardTap?.(card, source),
      onCardPreview: (card, bounds) => options.callbacks?.onCardPreview?.(card, bounds)
    })
  }

  init(): void {
    this.addChild(this.pageView)

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
    this.pageView.addChild(this.previousPageZone, this.nextPageZone)

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

    this.pages = this.buildFilteredPages()
    if (this.pages.length === 0) {
      throw new Error('Collection has no cards to display')
    }
    this.pageView.setPages(this.pages)

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

  get classFilter(): CollectionClassFilter {
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

  async applyClassFilter(classFilter: CollectionClassFilter): Promise<void> {
    if (this.collectionQuery.classFilter === classFilter && this.pages.length > 0)
      return

    this.collectionQuery.setClassFilter(classFilter)
    this.updateClassFilterAppearance()
    await this.applyCollectionFilters()
  }

  /** Re-evaluates controls after the deck editor changes open/closed state. */
  refreshFilterInteractionState(): void {
    this.updateCollectionFilterModes()
  }

  onPause(): void {
    this.setSearchInputVisible(false)
    for (const control of this.manaFilterControls) {
      control.eventMode = 'none'
    }
    for (const { control } of this.classFilterControls) {
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
    this.previousPageZone.eventMode = 'none'
    this.nextPageZone.eventMode = 'none'
    for (const control of this.manaFilterControls) {
      control.eventMode = 'none'
    }
    for (const { control } of this.classFilterControls) {
      control.eventMode = 'none'
    }
    this.setSearchInputVisible(false)
    this.searchInput?.dispose()
    this.searchInput = null
    this.expansionTray?.dispose()
    this.expansionTray = null
    this.pageView.dispose()
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
    this.pageView.addChild(collectionFilterLayer)

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
    const searchClearHitWidth = 52
    const searchClearHitHeight = 52
    const localHitWidth = searchClearHitWidth / this.searchClearButton.scale.x
    const localHitHeight = searchClearHitHeight / this.searchClearButton.scale.y
    this.searchClearButton.hitArea = new Rectangle(
      -localHitWidth / 2,
      -localHitHeight / 2,
      localHitWidth,
      localHitHeight
    )
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
    this.createClassFilters()
  }

  private createClassFilters(): void {
    const markerLayout = COLLECTION_LAYOUT.classFilters
    const { width, height } = markerLayout.first.size
    const markerClasses = [
      ...CARD_CLASSES.filter((cardClass) => cardClass !== 'Neutral'),
      'Neutral'
    ] as const
    const markerLayer = new Container()
    markerLayer.label = 'collection.class-filters'
    this.pageView.addChild(markerLayer)

    for (const [index, cardClass] of markerClasses.entries()) {
      const control = new Container()
      control.label = `collection.class-filter.${cardClass.toLowerCase()}`
      control.position.set(
        markerLayout.first.position.x + index * (width + markerLayout.gap),
        markerLayout.first.position.y
      )
      control.hitArea = new Rectangle(0, 0, width, height)
      control.cursor = 'pointer'
      control.on('pointertap', (event: FederatedPointerEvent) => {
        event.stopPropagation()
        this.handleClassFilterTap(cardClass)
      })

      const background = new Graphics()
      background.eventMode = 'none'
      control.addChild(background)

      const label = new Text({
        text: cardClass,
        style: {
          fontFamily: 'Belwe',
          fontSize: 13,
          fill: 0xf5e6bc,
          align: 'center'
        }
      })
      label.anchor.set(0.5)
      label.position.set(width / 2, height / 2)
      label.eventMode = 'none'
      control.addChild(label)

      const classControl: ClassFilterControl = {
        cardClass,
        control,
        background,
        label,
        hovered: false
      }
      control.on('pointerover', () => {
        classControl.hovered = true
        this.drawClassFilterControl(classControl)
      })
      control.on('pointerout', () => {
        classControl.hovered = false
        this.drawClassFilterControl(classControl)
      })
      this.classFilterControls.push(classControl)
      markerLayer.addChild(control)
    }

    this.updateClassFilterAppearance()
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
    this.pageView.addChild(this.expansionTray)
  }

  private createSearchInput(): void {
    const parent = this.options.canvas.parentElement
    if (!parent) return

    this.searchInput = new CollectionSearchInput({
      canvas: this.options.canvas,
      renderer: this.options.renderer,
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

  private handleClassFilterTap(cardClass: Exclude<CollectionClassFilter, null>): void {
    if (
      !this.options.state.isNavigationReady() ||
      !this.navigationEnabled ||
      this.options.state.isNewDeckOpen() ||
      this.options.state.getActiveDeck() !== null
    ) {
      return
    }

    const nextFilter = this.collectionQuery.classFilter === cardClass ? null : cardClass
    void this.applyClassFilter(nextFilter).catch((error: unknown) => {
      this.options.callbacks?.onError?.('Failed to filter the collection.', error)
    })
  }

  private updateClassFilterAppearance(): void {
    const isDeckEditing = this.options.state.getActiveDeck() !== null
    const selectedClass = this.collectionQuery.classFilter
    const visibleControls =
      isDeckEditing && selectedClass !== null
        ? this.classFilterControls.filter(
            ({ cardClass }) => cardClass === selectedClass || cardClass === 'Neutral'
          )
        : this.classFilterControls
    const { width } = COLLECTION_LAYOUT.classFilters.first.size
    const { first, gap } = COLLECTION_LAYOUT.classFilters

    for (const [index, classControl] of visibleControls.entries()) {
      classControl.control.visible = true
      classControl.control.position.set(
        first.position.x + index * (width + gap),
        first.position.y
      )
      this.drawClassFilterControl(classControl)
    }
    for (const classControl of this.classFilterControls) {
      if (!visibleControls.includes(classControl)) classControl.control.visible = false
    }
  }

  private drawClassFilterControl(classControl: ClassFilterControl): void {
    const { background, cardClass, control, label } = classControl
    const { width, height } = COLLECTION_LAYOUT.classFilters.first.size
    const isSelected = this.collectionQuery.classFilter === cardClass
    const isLocked = this.options.state.getActiveDeck() !== null
    const isInteractive =
      this.navigationEnabled &&
      this.options.state.isNavigationReady() &&
      !this.options.state.isNewDeckOpen() &&
      !this.options.state.isEditorTransitioning() &&
      !this.options.state.isEditorClosing() &&
      !isLocked

    background.clear()
    background.roundRect(0, 0, width, height, 6)
    background.fill({
      color: isSelected
        ? 0x7a5923
        : classControl.hovered && isInteractive
          ? 0x41392d
          : 0x211d1a,
      alpha: 0.92
    })
    background.stroke({
      color: isSelected ? 0xf2cd65 : 0x987c4b,
      width: isSelected ? 3 : 1,
      alpha: 0.9
    })
    label.alpha = 1
    control.cursor = isInteractive ? 'pointer' : 'default'
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
    const pages = this.buildFilteredPages()

    this.pages = pages
    this.pageView.setPages(pages)
    this.pageIndex = 0
    if (pages.length === 0) {
      this.renderEmptyCollectionState()
      return
    }

    this.pageView.showContent()
    await this.renderPage(0)
  }

  private renderEmptyCollectionState(): void {
    this.pageView.renderEmpty()
    this.updatePageZoneModes()
  }

  private buildFilteredPages(): readonly CollectionPage[] {
    const filteredCards = queryCollectionCards(
      CARD_CATALOG.all,
      this.collectionQuery.snapshot()
    )
    return buildCollectionPages(filteredCards)
  }

  async renderPage(index: number): Promise<void> {
    const page = this.pages[index]
    if (!page) throw new Error('Collection page does not exist: ' + index)
    await this.pageView.renderPage(page, index)
    this.pageIndex = index
    if (!this.disposed) this.updatePageZoneModes()
  }

  private updateCollectionCardCompletionState(): void {
    this.pageView.updateCompletionState()
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
    const classFiltersEnabled =
      filtersEnabled && this.options.state.getActiveDeck() === null
    for (const { control } of this.classFilterControls) {
      control.eventMode = classFiltersEnabled ? 'static' : 'none'
    }
    this.updateClassFilterAppearance()
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
