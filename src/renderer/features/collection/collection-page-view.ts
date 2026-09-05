import { Container, type FederatedPointerEvent, Sprite, Text } from 'pixi.js'
import type { CardDefinition } from '../../../game/content/cards'
import { getCardCopyLimit, getDeckCardCount, type Deck } from '../../../game/decks'
import { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'
import type { CollectionAssets } from '../../ui/asset-registry'
import { CardView } from '../../rendering/cards/card-view'
import { getCollectionCardPlacement } from './collection-card-grid'
import {
  CARD_GRID_LAYOUT,
  COLLECTION_LAYOUT,
  COMPLETED_COLLECTION_CARD_ALPHA
} from './collection-layout'
import type { CollectionPage } from './collection-pages'
import type { CardPreviewRouteBounds } from '../card-preview/card-preview-route'

export interface CollectionPageViewState {
  isNavigationReady(): boolean
  getActiveDeck(): Deck | null
  isEditorTransitioning(): boolean
  isEditorMutating(): boolean
}

export interface CollectionPageViewOptions {
  readonly assets: Pick<CollectionAssets, 'searchNoResults'>
  readonly resolver?: CardAssetResolver
  readonly state: CollectionPageViewState
  readonly getCardBounds: (view: CardView) => CardPreviewRouteBounds
  readonly onCardTap?: (
    card: CardDefinition,
    source: { view: CardView; bounds: CardPreviewRouteBounds }
  ) => void
  readonly onCardPreview?: (
    card: CardDefinition,
    bounds: CardPreviewRouteBounds
  ) => void | Promise<void>
}

/** Owns collection-page card creation, labels, completion dimming, and swaps. */
export class CollectionPageView extends Container {
  private readonly cardResolver: CardAssetResolver
  private readonly options: CollectionPageViewOptions
  private readonly cardLayerRoot = new Container()
  private readonly classLabel: Text
  private readonly pageLabel: Text
  private readonly emptyStateImage: Sprite
  private pages: readonly CollectionPage[] = []
  private renderSequence = 0
  private disposed = false
  private loading = false
  private previewOpening = false
  private pageIndex = 0

  constructor(options: CollectionPageViewOptions) {
    super()
    this.options = options
    this.cardResolver = options.resolver ?? new CardAssetResolver()
    this.label = 'collection.page-content'
    this.addChild(this.cardLayerRoot)
    this.cardLayerRoot.label = 'collection.card-layer'

    this.classLabel = new Text({
      text: '',
      style: { fontFamily: 'Belwe', fontSize: 38, fill: 0x19130e, align: 'center' }
    })
    this.classLabel.label = 'collection.class-label'
    this.classLabel.anchor.set(0.5)
    this.classLabel.position.set(
      COLLECTION_LAYOUT.classLabel.position.x,
      COLLECTION_LAYOUT.classLabel.position.y
    )
    this.classLabel.eventMode = 'none'
    this.addChild(this.classLabel)

    this.pageLabel = new Text({
      text: '',
      style: { fontFamily: 'Belwe', fontSize: 28, fill: 0x806d4f, align: 'center' }
    })
    this.pageLabel.label = 'collection.page-label'
    this.pageLabel.anchor.set(0.5)
    this.pageLabel.position.set(
      COLLECTION_LAYOUT.pageLabel.position.x,
      COLLECTION_LAYOUT.pageLabel.position.y
    )
    this.pageLabel.eventMode = 'none'
    this.addChild(this.pageLabel)

    this.emptyStateImage = new Sprite(options.assets.searchNoResults)
    this.emptyStateImage.label = 'collection.empty-state'
    this.emptyStateImage.anchor.set(0.5)
    this.emptyStateImage.position.set(
      COLLECTION_LAYOUT.collectionFilters.noResults.position.x,
      COLLECTION_LAYOUT.collectionFilters.noResults.position.y
    )
    this.emptyStateImage.eventMode = 'none'
    this.emptyStateImage.visible = false
    this.addChild(this.emptyStateImage)
  }

  get currentPageIndex(): number {
    return this.pageIndex
  }

  get isLoading(): boolean {
    return this.loading
  }

  setPages(pages: readonly CollectionPage[]): void {
    this.pages = pages
  }

  async renderPage(page: CollectionPage, index: number): Promise<void> {
    const sequence = ++this.renderSequence
    this.loading = true
    const nextCardLayer = new Container()
    nextCardLayer.label = `collection.card-layer.page-${page.pageNumber}`
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
      if (failedResult?.status === 'rejected') {
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
            this.handleCardTap(event, card, view)
          )
          view.on('rightclick', (event: FederatedPointerEvent) =>
            this.handleCardPreview(event, card, view)
          )
        }
        this.layoutCard(view, cardIndex)
        // Keep the full authored card resolution for sharp thumbnails and card-add
        // snapshots, but composite its static masks and blends only once per page.
        view.cacheAsTexture({ resolution: 1, antialias: true })
        nextCardLayer.addChild(view)
      }
      const previousCardLayer = this.cardLayerRoot.removeChildren()[0]
      this.cardLayerRoot.addChild(nextCardLayer)
      previousCardLayer?.destroy({ children: true })
      this.pageIndex = index
      this.classLabel.text = page.cardClass
      this.pageLabel.text = `Page ${page.pageNumber}`
      this.updateCompletionState()
    } finally {
      if (sequence === this.renderSequence) this.loading = false
    }
  }

  renderEmpty(): void {
    this.renderSequence += 1
    this.loading = false
    const oldLayer = this.cardLayerRoot.removeChildren()
    for (const child of oldLayer) child.destroy({ children: true })
    this.classLabel.text = ''
    this.pageLabel.text = ''
    this.emptyStateImage.visible = true
  }

  showContent(): void {
    this.emptyStateImage.visible = false
  }

  updateCompletionState(): void {
    const page = this.pages[this.pageIndex]
    const deck = this.options.state.getActiveDeck()
    const cardLayer = this.cardLayerRoot.children[0]
    if (!(cardLayer instanceof Container) || !page) return
    for (const [cardIndex, child] of cardLayer.children.entries()) {
      if (!(child instanceof CardView)) continue
      const card = page.cards[cardIndex]
      const atLimit = Boolean(
        deck && card && getDeckCardCount(deck, card.id) >= getCardCopyLimit(card)
      )
      // The cached card is one image, so alpha dims the complete card uniformly
      // without another filter pass or rebuilding its texture.
      child.alpha = atLimit ? COMPLETED_COLLECTION_CARD_ALPHA : 1
    }
  }

  dispose(): void {
    this.disposed = true
    this.renderSequence += 1
    this.destroy({ children: true })
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
    for (const view of views) view.destroy({ children: true })
  }

  private handleCardTap(
    event: FederatedPointerEvent,
    card: CardDefinition,
    view: CardView
  ): void {
    if (
      event.button !== 0 ||
      !this.options.state.getActiveDeck() ||
      this.options.state.isEditorTransitioning()
    )
      return
    event.stopPropagation()
    this.options.onCardTap?.(card, { view, bounds: this.options.getCardBounds(view) })
  }

  private handleCardPreview(
    event: FederatedPointerEvent,
    card: CardDefinition,
    view: CardView
  ): void {
    if (
      event.button !== 2 ||
      this.disposed ||
      !this.options.state.isNavigationReady() ||
      this.options.state.isEditorTransitioning() ||
      this.options.state.isEditorMutating() ||
      this.previewOpening
    )
      return
    event.stopPropagation()
    this.previewOpening = true
    const result = this.options.onCardPreview?.(card, this.options.getCardBounds(view))
    if (result instanceof Promise) {
      void result.finally(() => {
        this.previewOpening = false
      })
    } else {
      this.previewOpening = false
    }
  }
}
