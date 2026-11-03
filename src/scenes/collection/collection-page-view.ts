import {
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
  DECK_LIMIT_CARD_OFFSET_Y,
  DECK_LIMIT_CARD_SCALE,
  getCollectionDeckLimitFramePlacement,
  getCollectionDeckLimitLabelPlacement
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
  readonly assets: Pick<
    CollectionAssets,
    'searchNoResults' | 'cardDeckLimitFrame' | 'cardDeckLabel'
  >
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

/** Owns collection-page cards, labels, deck-limit indicators, and swaps. */
export class CollectionPageView extends Container {
  private readonly cardResolver: CardAssetResolver
  private readonly options: CollectionPageViewOptions
  private readonly cardLayerRoot = new Container()
  private readonly shadowLayerRoot = new Container()
  private readonly deckLimitLayerRoot = new Container()
  private readonly deckLimitLabelLayerRoot = new Container()
  private readonly shadowTexture: CardShadowTextureLease
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
    this.addChild(
      this.shadowLayerRoot,
      this.deckLimitLayerRoot,
      this.cardLayerRoot,
      this.deckLimitLabelLayerRoot
    )
    this.deckLimitLabelLayerRoot.label = 'collection.deck-limit-labels'
    this.deckLimitLabelLayerRoot.eventMode = 'none'
    this.deckLimitLayerRoot.label = 'collection.deck-limit-indicators'
    this.deckLimitLayerRoot.eventMode = 'none'
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
    const nextDeckLimitLayer = new Container()
    const nextDeckLimitLabelLayer = new Container()
    nextDeckLimitLabelLayer.label = `collection.deck-limit-labels.page-${page.pageNumber}`
    nextDeckLimitLayer.label = `collection.deck-limit-indicators.page-${page.pageNumber}`
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
        nextDeckLimitLayer.addChild(this.createDeckLimitIndicator(view, cardIndex))
        nextDeckLimitLabelLayer.addChild(this.createDeckLimitLabel(view, cardIndex))
        view.setPremiumAppearancePaused(this.premiumAppearancePaused)
        // Keep the full authored card resolution for sharp thumbnails and card-add
        // snapshots, but composite its static masks and blends only once per page.
        view.enableTextureCache()
        nextCardLayer.addChild(view)
      }
      const previousCardLayer = this.cardLayerRoot.removeChildren()[0]
      const previousShadowLayer = this.shadowLayerRoot.removeChildren()[0]
      const previousDeckLimitLayer = this.deckLimitLayerRoot.removeChildren()[0]
      const previousDeckLimitLabelLayer =
        this.deckLimitLabelLayerRoot.removeChildren()[0]
      this.cardLayerRoot.addChild(nextCardLayer)
      this.shadowLayerRoot.addChild(nextShadowLayer)
      this.deckLimitLayerRoot.addChild(nextDeckLimitLayer)
      this.deckLimitLabelLayerRoot.addChild(nextDeckLimitLabelLayer)
      previousCardLayer?.destroy({ children: true })
      previousShadowLayer?.destroy({ children: true })
      previousDeckLimitLayer?.destroy({ children: true })
      previousDeckLimitLabelLayer?.destroy({ children: true })
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
      if (!nextDeckLimitLayer.parent) nextDeckLimitLayer.destroy({ children: true })
      if (!nextDeckLimitLabelLayer.parent)
        nextDeckLimitLabelLayer.destroy({ children: true })
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
    for (const child of this.deckLimitLayerRoot.removeChildren()) {
      child.destroy({ children: true })
    }
    for (const child of this.deckLimitLabelLayerRoot.removeChildren()) {
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
      this.layoutCard(child, cardIndex, atLimit)
      const shadow = this.shadowLayerRoot.children[0]?.children[cardIndex]
      if (shadow) shadow.visible = !atLimit
      const indicator = this.deckLimitLayerRoot.children[0]?.children[cardIndex]
      if (indicator) indicator.visible = atLimit
      const label = this.deckLimitLabelLayerRoot.children[0]?.children[cardIndex]
      if (label) label.visible = atLimit
    }
  }

  dispose(): void {
    this.disposed = true
    this.renderSequence += 1
    this.destroy({ children: true })
  }

  private layoutCard(view: CardView, cardIndex: number, atLimit = false): void {
    const placement = getCollectionCardPlacement(
      cardIndex,
      view.plan.width,
      view.renderedHeight,
      CARD_GRID_LAYOUT
    )
    const scale = atLimit ? DECK_LIMIT_CARD_SCALE : placement.scale
    view.scale.set(scale)
    view.position.set(
      placement.x + (view.plan.width * (placement.scale - scale)) / 2,
      placement.y +
        (view.renderedHeight * (placement.scale - scale)) / 2 +
        (atLimit ? DECK_LIMIT_CARD_OFFSET_Y : 0)
    )
  }

  private createDeckLimitIndicator(view: CardView, cardIndex: number): Sprite {
    const indicator = new Sprite(this.options.assets.cardDeckLimitFrame)
    indicator.label = `collection.deck-limit-indicator.${cardIndex}`
    indicator.eventMode = 'none'
    indicator.visible = false
    const body = CARD_BODY_BOUNDS
    applyAnchoredPlacement(
      indicator,
      getCollectionDeckLimitFramePlacement({
        x: view.x + (body.x + body.width / 2) * view.scale.x,
        y: view.y + body.y * view.plan.renderScaleY * view.scale.y
      })
    )
    return indicator
  }

  private createDeckLimitLabel(view: CardView, cardIndex: number): Sprite {
    const label = new Sprite(this.options.assets.cardDeckLabel)
    label.label = `collection.deck-limit-label.${cardIndex}`
    label.eventMode = 'none'
    label.visible = false
    const body = CARD_BODY_BOUNDS
    applyAnchoredPlacement(
      label,
      getCollectionDeckLimitLabelPlacement({
        x: view.x + (body.x + body.width / 2) * view.scale.x,
        y: view.y + (body.y + body.height) * view.plan.renderScaleY * view.scale.y
      })
    )
    return label
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
