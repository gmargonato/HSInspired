import {
  AlphaFilter,
  Container,
  type FederatedPointerEvent,
  type Renderer,
  Sprite,
  Text
} from 'pixi.js'
import type { CardDefinition } from '../../game-rules/content/cards'
import { getCardCopyLimit, getDeckCardCount, type Deck } from '../../game-rules/decks'
import { CardAssetResolver } from '../../visual-components/assets/card-asset-resolver'
import type { CollectionAssets } from '../../visual-components/assets'
import { CardView } from '../../visual-components/cards/card-view'
import { CARD_BODY_BOUNDS } from '../../visual-components/cards/card-layout'
import {
  acquireCardShadowTexture,
  type CardShadowTextureLease
} from '../../visual-components/effects/card-shadow-texture'
import { applyAnchoredPlacement, placement } from '../../visual-components/layout'
import { getCollectionCardPlacement } from './collection-card-grid'
import {
  CARD_GRID_LAYOUT,
  COLLECTION_CARD_SHADOW,
  COLLECTION_LAYOUT,
  COMPLETED_COLLECTION_CARD_ALPHA
} from './collection-layout'
import type { CollectionPage } from './collection-pages'
import type { CardPreviewRouteBounds } from '../../application/navigation/card-preview-route'

export interface CollectionPageViewState {
  isNavigationReady(): boolean
  getActiveDeck(): Deck | null
  isEditorTransitioning(): boolean
  isEditorMutating(): boolean
}

export interface CollectionPageViewOptions {
  readonly assets: Pick<CollectionAssets, 'searchNoResults'>
  readonly renderer: Renderer
  readonly resolver?: CardAssetResolver
  readonly state: CollectionPageViewState
  readonly getCardBounds: (view: CardView) => CardPreviewRouteBounds
  readonly canInteract: () => boolean
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
  private readonly shadowLayerRoot = new Container()
  private readonly shadowTexture: CardShadowTextureLease
  private readonly completionFilters = new WeakMap<CardView, AlphaFilter>()
  private readonly classLabel: Text
  private readonly pageLabel: Text
  private readonly emptyStateImage: Sprite
  private currentPage: CollectionPage | null = null
  private renderSequence = 0
  private disposed = false
  private loading = false
  private previewOpening = false
  private premiumAppearancePaused = false
  private pageIndex = 0

  constructor(options: CollectionPageViewOptions) {
    super()
    this.options = options
    this.cardResolver = options.resolver ?? new CardAssetResolver()
    this.shadowTexture = acquireCardShadowTexture(options.renderer)
    this.once('destroyed', () => this.shadowTexture.release())
    this.label = 'collection.page-content'
    this.addChild(this.shadowLayerRoot, this.cardLayerRoot)
    this.shadowLayerRoot.label = 'collection.card-shadows'
    this.shadowLayerRoot.eventMode = 'none'
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

  setPremiumAppearancePaused(paused: boolean): void {
    this.premiumAppearancePaused = paused
    for (const child of this.cardLayerRoot.children[0]?.children ?? []) {
      if (child instanceof CardView) child.setPremiumAppearancePaused(paused)
    }
  }

  async renderPage(
    page: CollectionPage,
    index: number,
    onCommit: () => void
  ): Promise<boolean> {
    const sequence = ++this.renderSequence
    this.loading = true
    const nextCardLayer = new Container()
    const nextShadowLayer = new Container()
    nextShadowLayer.label = `collection.card-shadows.page-${page.pageNumber}`
    nextCardLayer.label = `collection.card-layer.page-${page.pageNumber}`
    try {
      const results = await Promise.allSettled(
        page.cards.map(async (card) => {
          const artwork = await this.cardResolver.loadArtwork(card.id)
          return CardView.create(card, this.cardResolver, {
            artwork,
            animatePremiumArtwork: true
          })
        })
      )
      const views = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : []
      )
      const failedResult = results.find((result) => result.status === 'rejected')
      if (this.disposed || sequence !== this.renderSequence) {
        this.destroyCardViews(views)
        return false
      }
      if (failedResult?.status === 'rejected') {
        this.destroyCardViews(views)
        throw failedResult.reason
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
        nextShadowLayer.addChild(this.createCardShadow(view, cardIndex))
        view.setPremiumAppearancePaused(this.premiumAppearancePaused)
        // Keep the full authored card resolution for sharp thumbnails and card-add
        // snapshots, but composite its static masks and blends only once per page.
        view.enableTextureCache()
        nextCardLayer.addChild(view)
      }
      const previousCardLayer = this.cardLayerRoot.removeChildren()[0]
      const previousShadowLayer = this.shadowLayerRoot.removeChildren()[0]
      this.cardLayerRoot.addChild(nextCardLayer)
      this.shadowLayerRoot.addChild(nextShadowLayer)
      previousCardLayer?.destroy({ children: true })
      previousShadowLayer?.destroy({ children: true })
      this.pageIndex = index
      this.currentPage = page
      this.classLabel.text = page.cardClass
      this.pageLabel.text = `Page ${page.pageNumber}`
      this.emptyStateImage.visible = false
      onCommit()
      this.updateCompletionState()
      return true
    } finally {
      if (!nextCardLayer.parent) nextCardLayer.destroy({ children: true })
      if (!nextShadowLayer.parent) nextShadowLayer.destroy({ children: true })
      if (sequence === this.renderSequence) this.loading = false
    }
  }

  renderEmpty(): void {
    this.renderSequence += 1
    this.loading = false
    this.currentPage = null
    this.pageIndex = 0
    const oldLayer = this.cardLayerRoot.removeChildren()
    for (const child of oldLayer) child.destroy({ children: true })
    for (const child of this.shadowLayerRoot.removeChildren()) {
      child.destroy({ children: true })
    }
    this.classLabel.text = ''
    this.pageLabel.text = ''
    this.emptyStateImage.visible = true
  }

  updateCompletionState(): void {
    const page = this.currentPage
    const deck = this.options.state.getActiveDeck()
    const cardLayer = this.cardLayerRoot.children[0]
    if (!(cardLayer instanceof Container) || !page) return
    for (const [cardIndex, child] of cardLayer.children.entries()) {
      if (!(child instanceof CardView)) continue
      const card = page.cards[cardIndex]
      const atLimit = Boolean(
        deck && card && getDeckCardCount(deck, card.id) >= getCardCopyLimit(card)
      )
      const shadow = this.shadowLayerRoot.children[0]?.children[cardIndex]
      if (shadow) {
        shadow.alpha =
          COLLECTION_CARD_SHADOW.opacity *
          (atLimit ? COMPLETED_COLLECTION_CARD_ALPHA : 1)
      }
      // Fade the finished composite so live artwork cannot bleed through the frame.
      let filter = this.completionFilters.get(child)
      if (atLimit && !filter) {
        filter = new AlphaFilter({
          alpha: COMPLETED_COLLECTION_CARD_ALPHA,
          resolution: 'inherit'
        })
        filter.enabled = false
        this.completionFilters.set(child, filter)
        const ownedFilter = filter
        child.once('destroyed', () => ownedFilter.destroy())
      }
      if (filter && filter.enabled !== atLimit) {
        // Cached masks/blends rebuild in local coordinates; the outer fade filter
        // uses screen coordinates. Render live while dimmed to keep them consistent.
        if (atLimit) {
          child.disableTextureCache()
          child.filters = [...(child.filters ?? []), filter]
        } else {
          child.filters = (child.filters ?? []).filter((entry) => entry !== filter)
          child.enableTextureCache()
        }
        filter.enabled = atLimit
      }
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

  private createCardShadow(view: CardView, cardIndex: number): Sprite {
    const { texture, bodySize, padding } = this.shadowTexture
    const body = CARD_BODY_BOUNDS
    const scaleX = (body.width * view.scale.x) / bodySize
    const scaleY = (body.height * view.plan.renderScaleY * view.scale.y) / bodySize
    const shadow = new Sprite(texture)
    shadow.label = `collection.card-shadow.${cardIndex}`
    shadow.eventMode = 'none'
    shadow.alpha = COLLECTION_CARD_SHADOW.opacity
    applyAnchoredPlacement(
      shadow,
      placement(
        {
          x:
            view.x +
            body.x * view.scale.x +
            COLLECTION_CARD_SHADOW.offset.x -
            padding * scaleX,
          y:
            view.y +
            body.y * view.plan.renderScaleY * view.scale.y +
            COLLECTION_CARD_SHADOW.offset.y -
            padding * scaleY
        },
        { width: texture.width, height: texture.height },
        {
          scale: { x: scaleX, y: scaleY },
          note: 'Physical card body with transparent blur padding, offset down and left.'
        }
      )
    )
    return shadow
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
      !this.options.canInteract() ||
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
      !this.options.canInteract() ||
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
