import {
  BlurFilter,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture
} from 'pixi.js'
import type { FederatedPointerEvent, FederatedWheelEvent, Renderer } from 'pixi.js'
import type { CardDefinition, DeckClass } from '../../game-rules/content/cards'
import { HERO_CATALOG } from '../../game-rules/content/heroes'
import { CardAssetResolver } from '../../visual-components/assets/card-asset-resolver'
import { CardView } from '../../visual-components/cards/card-view'
import { Actor } from '../../visual-components/lifecycle/actor'
import { Button } from '../../visual-components/controls/button'
import { DeckEntryButton } from '../../visual-components/controls/deck-entry-button'
import { DeckNameInput } from './deck-name-input'
import type {
  CollectionAssets,
  DeckPresentationAssets,
  SharedUIAssets
} from '../../visual-components/assets'
import {
  getDeckPortraitAssetKey,
  getDeckPortraitYOffset
} from '../../visual-components/assets/deck-portraits'
import {
  buildDeckEditorEntries,
  shouldAnimateDeckRowRemoval
} from './deck-editor-model'
import { DeckListView } from './deck-list-view'
import type { DeckStore } from '../../application/contracts/deck-store'
import { COLLECTION_LAYOUT } from './collection-layout'
import {
  DECK_EDITOR_CONTENT_FADE_DURATION,
  DECK_EDITOR_COPIES_WIDTH,
  DECK_EDITOR_COST_WIDTH,
  DECK_EDITOR_COUNT_FILL,
  DECK_EDITOR_ERROR_FILL,
  DECK_EDITOR_FRAME_CARD_LIST_GAP,
  DECK_EDITOR_FRAME_TARGET_WIDTH,
  DECK_EDITOR_FULL_WARNING_DURATION,
  DECK_EDITOR_FULL_WARNING_FONT_SIZE,
  DECK_EDITOR_FULL_WARNING_STROKE_WIDTH,
  DECK_EDITOR_LAYOUT,
  DECK_EDITOR_PREVIEW,
  DECK_EDITOR_ROW_COLLAPSE_DURATION,
  DECK_EDITOR_ROW_REMOVE_DURATION,
  DECK_EDITOR_TRANSITION_DURATION,
  DECK_EDITOR_CARD_ROW_GAP,
  DECK_EDITOR_CARD_ROW_HEIGHT,
  DECK_EDITOR_ROW_INSET,
  CARD_ADD_CHOREOGRAPHY,
  FULL_VIEWPORT
} from './deck-editor-layout'
import {
  addCardToDeck,
  MAX_DECK_CARDS,
  countDeckCards,
  getDeckCardCount,
  type Deck,
  type DeckMutationFailure
} from '../../game-rules/decks'
import { GAME_HEIGHT, GAME_WIDTH } from '../../visual-components/layout'
import type { CollectionCardAddSource } from './collection-view'
import {
  createCardAddFlightPath,
  resolveCardAddFlightPoint,
  resolveCardAddScrollOffset
} from '../../visual-components/animation/card-add-flight'

export interface DeckPanelStateProvider {
  readonly isNavigationReady: () => boolean
  readonly isNewDeckOpen: () => boolean
}

export interface DeckPanelViewCallbacks {
  readonly onDeckTap?: (deckId: string) => void
  readonly onNewDeck?: () => void
  readonly onDeleteDeck?: (deckId: string) => void
  readonly onEditorDone?: () => void | Promise<void>
  readonly onError?: (message: string, error?: unknown) => void
  readonly onWarning?: (message: string, error?: unknown) => void
}

export type DeckPanelAssets = Pick<
  CollectionAssets,
  'newDeckButton' | 'verticalSlider' | 'cardAddAura'
> &
  Pick<SharedUIAssets, 'doneButton'> &
  DeckPresentationAssets

export interface DeckPanelViewOptions {
  readonly assets: DeckPanelAssets
  readonly canvas: HTMLCanvasElement
  readonly inputParent: HTMLElement
  readonly renderer: Renderer
  readonly deckStore: DeckStore
  readonly state: DeckPanelStateProvider
  readonly callbacks?: DeckPanelViewCallbacks
}

interface DeckCardRow {
  readonly row: Container
  readonly artworkLayer: Container
  readonly artworkPlaceholder: Graphics
  readonly artworkWidth: number
  readonly artworkHeight: number
  readonly copies: Text
}

interface PendingCardAddition {
  readonly deckId: string
  readonly card: CardDefinition
  readonly sourceBounds: CollectionCardAddSource['bounds']
  readonly sourceTexture: ReturnType<Renderer['generateTexture']>
  readonly predictedDeck: Deck
  readonly resolve: () => void
}

interface CardAddEffect {
  readonly root: Container
  readonly source: Sprite
  readonly bloom: Sprite
  readonly aura: Sprite
  readonly row: DeckCardRow
  readonly sourceTexture: ReturnType<Renderer['generateTexture']>
  readonly blur: BlurFilter
  destroyed: boolean
}

/**
 * Feature-owned presentation for the right-hand deck panel of the Collection
 * scene: the deck list, its shared scrollbar, and the full deck editor overlay.
 */
export class DeckPanelView extends Actor {
  private readonly deckStore: DeckStore
  private readonly cardResolver = new CardAssetResolver()
  private readonly deckEditorRows = new Map<string, DeckCardRow>()
  private readonly cardAddQueue: PendingCardAddition[] = []
  private readonly deckList: DeckListView
  private readonly deckNameInput: DeckNameInput
  private deckEditorLayer!: Container
  private deckEditorCardViewport!: Container
  private deckEditorFrame!: Container
  private deckEditorCount!: Text
  private deckFullWarning!: Text
  private deckEditorDoneButton!: Button
  private deckEditorCardContent!: Container
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
  private cardAddEffectLayer!: Container
  private optimisticDeck: Deck | null = null
  private processingCardAddQueue = false
  private activeCardAddEffect: CardAddEffect | null = null
  private disposed = false

  constructor(private readonly options: DeckPanelViewOptions) {
    super()
    this.deckStore = options.deckStore
    this.deckList = new DeckListView({
      newDeckButton: options.assets.newDeckButton,
      verticalSlider: options.assets.verticalSlider,
      onDeckTap: options.callbacks?.onDeckTap,
      onNewDeck: options.callbacks?.onNewDeck,
      onDeleteDeck: options.callbacks?.onDeleteDeck,
      onWheel: this.handleDeckWheel,
      onSliderDown: this.startDeckSliderDrag,
      onSliderMove: this.handleDeckSliderMove,
      onSliderUp: this.stopDeckSliderDrag,
      createDeckButton: (deck, onClick) => this.createDeckButton(deck, onClick)
    })
    this.deckNameInput = new DeckNameInput({
      canvas: options.canvas,
      renderer: options.renderer,
      parent: options.inputParent,
      bounds: {
        x:
          DECK_EDITOR_LAYOUT.deckNameInput.position.x -
          DECK_EDITOR_LAYOUT.deckNameInput.size.width / 2,
        y:
          DECK_EDITOR_LAYOUT.deckNameInput.position.y -
          DECK_EDITOR_LAYOUT.deckNameInput.size.height / 2,
        width: DECK_EDITOR_LAYOUT.deckNameInput.size.width,
        height: DECK_EDITOR_LAYOUT.deckNameInput.size.height
      }
    })
  }

  init(): void {
    this.createDeckList()
    this.createDeckEditor()
    this.deckNameInput.mount()
    this.cardAddEffectLayer = new Container()
    this.cardAddEffectLayer.label = 'collection.card-add-effects'
    this.cardAddEffectLayer.eventMode = 'none'
    this.addChild(this.cardAddEffectLayer)
    this.renderDeckList()
  }

  getActiveDeckId(): string | null {
    return this.activeDeckId
  }

  getActiveDeck(): Deck | null {
    return this.activeDeckId
      ? (this.deckStore.getDeck(this.activeDeckId) ?? null)
      : null
  }

  getDeckNameDraft(): string {
    return this.deckNameInput.value
  }

  focusDeckName(): void {
    this.deckNameInput.focus()
  }

  get isTransitioning(): boolean {
    return this.deckEditorTransitioning
  }

  get isClosing(): boolean {
    return this.deckEditorClosing
  }

  get isMutating(): boolean {
    return this.deckEditorCardMutationInProgress || this.processingCardAddQueue
  }

  get isAddingCard(): boolean {
    return this.processingCardAddQueue
  }

  /** Briefly flashes the deck-editor count in error color. */
  flashCount(): void {
    this.flashDeckEditorCount()
  }

  getDeckClass(deck: Deck): DeckClass | null {
    return (HERO_CATALOG.get(deck.heroId)?.classId as DeckClass | undefined) ?? null
  }

  getDeckEntryOrigin(deckId: string): { x: number; y: number } | null {
    const deckIndex = this.deckStore.getDecks().findIndex((deck) => deck.id === deckId)
    return deckIndex === -1
      ? null
      : this.deckList.getEntryOrigin(deckIndex, this.deckEditorLayer)
  }

  renderDeckList(): void {
    const decks = this.deckStore.getDecks()
    this.deckMaxScroll = this.deckList.render(decks)
    this.setDeckScroll(this.deckScrollOffset)
    this.setInteractionEnabled(this.options.state.isNavigationReady() && !this.disposed)
  }

  setInteractionEnabled(enabled: boolean): void {
    const newDeckSelectionOpen = this.options.state.isNewDeckOpen()
    const listEnabled = enabled && this.activeDeckId === null && !newDeckSelectionOpen
    const editorContentEnabled =
      enabled &&
      this.activeDeckId !== null &&
      !this.deckEditorTransitioning &&
      !this.deckEditorClosing &&
      !this.deckEditorCardMutationInProgress
    const editorScrollEnabled = editorContentEnabled && this.deckEditorCardMaxScroll > 0
    const sliderEnabled = listEnabled || editorScrollEnabled
    this.deckList.setInteractionEnabled(listEnabled)

    if (this.deckEditorCardViewport) {
      this.deckEditorCardViewport.eventMode = editorContentEnabled ? 'static' : 'none'
    }
    for (const deckCardRow of this.deckEditorRows.values()) {
      deckCardRow.row.eventMode = editorContentEnabled ? 'static' : 'none'
    }

    if (this.deckList.slider.visible) {
      this.deckList.slider.eventMode = sliderEnabled ? 'static' : 'none'
      this.deckList.slider.cursor = sliderEnabled ? 'pointer' : 'default'
    }

    if (this.deckEditorDoneButton) {
      this.deckEditorDoneButton.setEnabled(
        enabled &&
          this.activeDeckId !== null &&
          !this.deckEditorTransitioning &&
          !this.deckEditorCardMutationInProgress
      )
    }
    this.deckNameInput.setEnabled(editorContentEnabled)

    this.deckList.countLabel.visible = this.activeDeckId === null

    if (!sliderEnabled) {
      this.stopDeckSliderDrag()
    }
  }

  async enterEditor(deck: Deck, origin: { x: number; y: number }): Promise<void> {
    this.activeDeckId = deck.id
    this.deckNameInput.setValue(deck.name)
    this.deckEditorOrigin = origin
    this.clearDeckEditorCardPreview()
    this.deckEditorCardScrollOffset = 0
    this.deckEditorCardMaxScroll = 0
    this.deckEditorCardContent.y = 0
    this.deckEditorCardMutationInProgress = false
    this.deckEditorTransitioning = true
    const transitionSequence = ++this.deckEditorTransitionSequence
    this.setInteractionEnabled(false)
    this.deckList.viewport.visible = false
    this.deckList.slider.visible = false
    this.deckEditorLayer.visible = true
    this.deckEditorLayer.alpha = 1
    this.deckEditorFrame.scale.set(1)
    this.deckEditorFrame.position.set(origin.x, origin.y)
    this.deckEditorCardContent.alpha = 0
    this.deckEditorCount.alpha = 0
    this.deckEditorDoneButton.alpha = 0
    this.updateEditor(deck)

    await this.animateDeckEditorTransition(origin, true)
    if (
      this.disposed ||
      this.activeDeckId !== deck.id ||
      this.deckEditorTransitionSequence !== transitionSequence
    ) {
      return
    }

    this.deckEditorTransitioning = false
    this.updateDeckSliderPosition()
  }

  async exitEditor(): Promise<void> {
    if (this.disposed || !this.activeDeckId || this.deckEditorClosing) return

    this.deckEditorClosing = true
    this.deckNameInput.setEnabled(false)
    ++this.deckEditorTransitionSequence
    this.clearDeckEditorCardPreview()
    this.deckEditorCardMutationInProgress = false
    this.killTweensOf(this.deckEditorFrame)
    this.killTweensOf(this.deckEditorCardContent)
    this.killTweensOf(this.deckEditorCount)
    this.killTweensOf(this.deckEditorDoneButton)
    this.deckEditorTransitioning = true
    this.deckList.slider.visible = false

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
    this.deckEditorCardScrollOffset = 0
    this.deckEditorCardMaxScroll = 0
    this.deckEditorCardContent.y = 0
    this.deckEditorFrame.scale.set(1)
    this.deckList.viewport.visible = true
    this.updateDeckSliderPosition()

    this.deckEditorTransitioning = false
    this.deckEditorClosing = false
  }

  updateEditor(deck: Deck): void {
    this.renderDeckEditorFrame(deck)
    this.clearDeckFullWarning()
    this.clearDeckEditorCountFeedback()
    this.deckEditorCount.text = `${countDeckCards(deck)} / ${MAX_DECK_CARDS} Cards`
    this.renderDeckCardRows(deck)
  }

  enqueueCardAddition(
    card: CardDefinition,
    source: CollectionCardAddSource
  ): Promise<void> {
    const deckId = this.activeDeckId
    if (!deckId || this.deckEditorTransitioning || this.deckEditorClosing) {
      return Promise.resolve()
    }

    const baseDeck =
      this.optimisticDeck?.id === deckId
        ? this.optimisticDeck
        : this.deckStore.getDeck(deckId)
    if (!baseDeck) return Promise.resolve()

    const prediction = addCardToDeck(baseDeck, card)
    if (!prediction.ok) {
      this.reportCardAddFailure(prediction)
      return Promise.resolve()
    }

    this.optimisticDeck = prediction.deck
    const sourceTexture = source.view.createAppearanceSnapshot(this.options.renderer)

    return new Promise<void>((resolve) => {
      this.cardAddQueue.push({
        deckId,
        card,
        sourceBounds: source.bounds,
        sourceTexture,
        predictedDeck: prediction.deck,
        resolve
      })
      void this.processCardAddQueue()
    })
  }

  /** Compatibility entry point for callers without a visual source. */
  async addCard(card: CardDefinition): Promise<void> {
    const deckId = this.activeDeckId
    if (!deckId || this.deckEditorTransitioning || this.isMutating) return

    const result = await this.deckStore.addCard(deckId, card)
    if (!result.ok) {
      this.reportCardAddFailure(result)
      return
    }
    const deck = this.deckStore.getDeck(deckId)
    if (deck) this.updateEditor(deck)
  }

  private async processCardAddQueue(): Promise<void> {
    if (this.processingCardAddQueue) return
    this.processingCardAddQueue = true
    this.setInteractionEnabled(false)

    try {
      while (!this.disposed && this.cardAddQueue.length > 0) {
        const request = this.cardAddQueue.shift()
        if (!request) break

        if (request.deckId !== this.activeDeckId) {
          request.sourceTexture.destroy(true)
          request.resolve()
          continue
        }

        const previousDeck = this.deckStore.getDeck(request.deckId)
        const previousRows = new Map(
          [...this.deckEditorRows].map(([cardId, row]) => [cardId, row.row.y])
        )
        const effect = this.createCardAddEffect(request)
        this.activeCardAddEffect = effect

        try {
          this.updateEditor(request.predictedDeck)
          const target = this.prepareAddedDeckRow(
            request.card.id,
            previousDeck,
            previousRows
          )
          if (target) this.scrollAddedDeckRowIntoView(target.row)

          const [result] = await Promise.all([
            this.deckStore.addCard(request.deckId, request.card),
            target ? this.animateCardAddFlight(effect, target) : Promise.resolve()
          ])

          if (!result.ok) {
            this.reportCardAddFailure(result)
            const authoritativeDeck = this.deckStore.getDeck(request.deckId)
            if (authoritativeDeck) this.updateEditor(authoritativeDeck)
            await this.animateRejectedCardAdd(effect)
            this.clearPendingCardAdditions()
            this.optimisticDeck = null
            continue
          }

          if (this.disposed || this.activeDeckId !== request.deckId) continue

          if (target) {
            await this.animateCardAddLanding(
              effect,
              target,
              request.card.id,
              result.deck
            )
          }
        } catch (error) {
          this.options.callbacks?.onError?.(
            `Failed to add ${request.card.name} to the deck.`,
            error
          )
          await this.animateRejectedCardAdd(effect)
          this.clearPendingCardAdditions()
          this.optimisticDeck = null
        } finally {
          this.destroyCardAddEffect(effect)
          if (this.activeCardAddEffect === effect) this.activeCardAddEffect = null
          request.resolve()
        }
      }
    } finally {
      this.processingCardAddQueue = false
      this.optimisticDeck = null
      if (
        !this.disposed &&
        this.activeDeckId &&
        !this.deckEditorTransitioning &&
        !this.deckEditorClosing
      ) {
        this.setInteractionEnabled(true)
      }
    }
  }

  private createCardAddEffect(request: PendingCardAddition): CardAddEffect {
    const root = new Container()
    root.label = 'collection.card-add-effect'
    root.eventMode = 'none'
    this.cardAddEffectLayer.addChild(root)

    const centerX = request.sourceBounds.x + request.sourceBounds.width / 2
    const centerY = request.sourceBounds.y + request.sourceBounds.height / 2
    const aura = new Sprite(this.options.assets.cardAddAura)
    aura.label = 'collection.card-add-aura'
    aura.anchor.set(0.5)
    aura.position.set(centerX, centerY)
    aura.width = request.sourceBounds.width * 1.55
    aura.height = request.sourceBounds.height * 1.25
    aura.blendMode = 'add'
    aura.alpha = 0.72
    root.addChild(aura)

    const bloom = new Sprite(request.sourceTexture)
    const blur = new BlurFilter({ strength: 10, quality: 3 })
    bloom.label = 'collection.card-add-bloom'
    bloom.anchor.set(0.5)
    bloom.position.set(centerX, centerY)
    bloom.width = request.sourceBounds.width
    bloom.height = request.sourceBounds.height
    bloom.blendMode = 'add'
    bloom.filters = [blur]
    bloom.alpha = 0.92
    root.addChild(bloom)

    const source = new Sprite(request.sourceTexture)
    source.label = 'collection.card-add-whiteout'
    source.anchor.set(0.5)
    source.position.set(centerX, centerY)
    source.width = request.sourceBounds.width
    source.height = request.sourceBounds.height
    source.blendMode = 'add'
    source.alpha = 0.92
    root.addChild(source)

    const count = request.predictedDeck.cards[request.card.id] ?? 1
    const row = this.createDeckCardRow(request.card.id, request.card, count, 0)
    const rowWidth = DECK_EDITOR_LAYOUT.cardList.size.width - DECK_EDITOR_ROW_INSET * 2
    const rowHeight = DECK_EDITOR_CARD_ROW_HEIGHT - DECK_EDITOR_CARD_ROW_GAP
    row.row.label = 'collection.card-add-row'
    row.row.eventMode = 'none'
    row.row.pivot.set(rowWidth / 2, rowHeight / 2)
    row.row.position.set(centerX, centerY)
    row.row.scale.set(CARD_ADD_CHOREOGRAPHY.rowStartScale)
    row.row.alpha = 0
    root.addChild(row.row)

    void this.cardResolver
      .loadArtwork(request.card.id)
      .then((artwork) => {
        if (artwork && row.row.parent === root) this.applyDeckRowArtwork(row, artwork)
      })
      .catch(() => undefined)

    return {
      root,
      source,
      bloom,
      aura,
      row,
      sourceTexture: request.sourceTexture,
      blur,
      destroyed: false
    }
  }

  private prepareAddedDeckRow(
    cardId: string,
    previousDeck: Deck | undefined,
    previousRows: ReadonlyMap<string, number>
  ): DeckCardRow | null {
    const target = this.deckEditorRows.get(cardId)
    if (!target) return null

    for (const [existingCardId, previousY] of previousRows) {
      const row = this.deckEditorRows.get(existingCardId)
      if (!row || row.row.y === previousY) continue
      const targetY = row.row.y
      row.row.y = previousY
      this.tweenTo(row.row, {
        y: targetY,
        duration: 0.24,
        ease: 'power2.out'
      })
    }

    const previousCount = previousDeck ? getDeckCardCount(previousDeck, cardId) : 0
    if (previousCount === 0) {
      target.row.alpha = 0
    } else {
      target.copies.text = String(previousCount)
    }
    target.row.eventMode = 'none'
    target.copies.alpha = 1
    return target
  }

  private scrollAddedDeckRowIntoView(row: Container): void {
    const targetOffset = resolveCardAddScrollOffset({
      viewportTop: DECK_EDITOR_LAYOUT.cardList.position.y,
      viewportHeight: DECK_EDITOR_LAYOUT.cardList.size.height,
      contentOffset: this.deckEditorCardScrollOffset,
      maxScroll: this.deckEditorCardMaxScroll,
      rowTop: row.y,
      rowHeight: DECK_EDITOR_CARD_ROW_HEIGHT - DECK_EDITOR_CARD_ROW_GAP
    })
    this.setDeckEditorCardScroll(targetOffset)
  }

  private animateCardAddFlight(
    effect: CardAddEffect,
    target: DeckCardRow
  ): Promise<void> {
    const targetBounds = target.row.getBounds()
    const end = this.toLocal({
      x: targetBounds.x + targetBounds.width / 2,
      y: targetBounds.y + targetBounds.height / 2
    })
    const start = { x: effect.row.row.x, y: effect.row.row.y }
    const path = createCardAddFlightPath(start, end)
    const progress = { value: 0 }
    const updateFlight = (): void => {
      const point = resolveCardAddFlightPoint(path, progress.value)
      effect.row.row.position.set(point.x, point.y)
    }

    return new Promise((resolve) => {
      const timeline = this.timeline({ onComplete: resolve, onInterrupt: resolve })
      timeline.to(
        [effect.source, effect.bloom, effect.aura],
        { alpha: 0, duration: 0.16, ease: 'power2.out' },
        0
      )
      timeline.to(
        effect.aura.scale,
        {
          x: CARD_ADD_CHOREOGRAPHY.sourceGlowScale,
          y: CARD_ADD_CHOREOGRAPHY.sourceGlowScale,
          duration: 0.16,
          ease: 'power2.out'
        },
        0
      )
      timeline.to(effect.row.row, { alpha: 1, duration: 0.04 }, 0)
      timeline.to(effect.row.row.scale, { x: 1, y: 1, duration: 0.08 }, 0)
      timeline.to(
        progress,
        {
          value: 1,
          duration: CARD_ADD_CHOREOGRAPHY.flightDuration,
          ease: 'power2.inOut',
          onUpdate: updateFlight
        },
        0
      )
    })
  }

  private animateCardAddLanding(
    effect: CardAddEffect,
    target: DeckCardRow,
    cardId: string,
    updatedDeck: Deck
  ): Promise<void> {
    target.row.alpha = 1
    target.copies.text = String(getDeckCardCount(updatedDeck, cardId))
    effect.row.row.alpha = 0

    return new Promise((resolve) => {
      const timeline = this.timeline({ onComplete: resolve, onInterrupt: resolve })
      timeline.fromTo(
        target.row.scale,
        {
          x: CARD_ADD_CHOREOGRAPHY.rowLandingScale,
          y: CARD_ADD_CHOREOGRAPHY.rowLandingScale
        },
        {
          x: 1,
          y: 1,
          duration: CARD_ADD_CHOREOGRAPHY.landingDuration,
          ease: 'back.out(2)'
        }
      )
    })
  }

  private animateRejectedCardAdd(effect: CardAddEffect): Promise<void> {
    return new Promise((resolve) => {
      this.tweenTo(effect.root, {
        alpha: 0,
        duration: 0.14,
        ease: 'power2.in',
        onComplete: resolve,
        onInterrupt: resolve
      })
    })
  }

  private destroyCardAddEffect(effect: CardAddEffect): void {
    if (effect.destroyed) return
    effect.destroyed = true
    effect.root.removeFromParent()
    effect.blur.destroy()
    effect.root.destroy({ children: true, texture: false })
    effect.sourceTexture.destroy(true)
  }

  private clearPendingCardAdditions(): void {
    for (const request of this.cardAddQueue.splice(0)) {
      request.sourceTexture.destroy(true)
      request.resolve()
    }
  }

  private reportCardAddFailure(result: DeckMutationFailure): void {
    if (result.code === 'deck-full') {
      this.options.callbacks?.onWarning?.(result.message)
      this.showDeckFullWarning(result.message)
    } else if (result.code !== 'copy-limit') {
      this.options.callbacks?.onError?.(result.message)
    }
    this.flashDeckEditorCount()
  }

  async removeCard(cardId: string, row?: Container): Promise<void> {
    const deckId = this.activeDeckId
    if (
      !deckId ||
      this.deckEditorTransitioning ||
      this.deckEditorCardMutationInProgress
    ) {
      return
    }

    const transitionSequence = this.deckEditorTransitionSequence
    const deck = this.deckStore.getDeck(deckId)
    const shouldAnimateRowRemoval = shouldAnimateDeckRowRemoval(
      deck ? getDeckCardCount(deck, cardId) : 0
    )
    this.deckEditorCardMutationInProgress = true
    this.setInteractionEnabled(false)
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

      const result = await this.deckStore.removeCard(deckId, cardId)
      if (!result.ok) {
        this.options.callbacks?.onError?.(result.message)
        const updatedDeck = this.deckStore.getDeck(deckId)
        if (updatedDeck) this.updateEditor(updatedDeck)
        this.flashDeckEditorCount()
        return
      }

      const updatedDeck = this.deckStore.getDeck(deckId)
      if (updatedDeck) this.updateEditor(updatedDeck)
    } catch (error) {
      this.options.callbacks?.onError?.(
        `Failed to remove ${cardId} from the deck.`,
        error
      )
      if (!this.disposed && this.activeDeckId === deckId) {
        const updatedDeck = this.deckStore.getDeck(deckId)
        if (updatedDeck) this.updateEditor(updatedDeck)
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
        this.setInteractionEnabled(true)
      }
    }
  }

  onExit(): void {
    this.disposed = true
    this.clearPendingCardAdditions()
    if (this.activeCardAddEffect) {
      this.destroyCardAddEffect(this.activeCardAddEffect)
      this.activeCardAddEffect = null
    }
    this.optimisticDeck = null
    this.cancelDeckEditorTransition()
    this.clearDeckEditorCardPreview()
    this.activeDeckId = null
    this.deckEditorTransitionSequence += 1
    this.deckEditorRenderSequence += 1
    this.deckEditorTransitioning = false
    this.deckEditorClosing = false
    this.deckEditorCardMutationInProgress = false
    this.clearDeckEditorCountFeedback()
    this.clearDeckFullWarning()
    this.deckNameInput.dispose()
    this.setInteractionEnabled(false)
  }

  private createDeckList(): void {
    this.deckList.mount(this)
  }

  private createDeckEditor(): void {
    this.deckEditorLayer = new Container()

    this.deckEditorFrame = new Container()
    this.deckEditorFrame.eventMode = 'none'
    this.deckEditorFrame.position.set(
      DECK_EDITOR_LAYOUT.header.position.x,
      DECK_EDITOR_LAYOUT.header.position.y
    )
    this.deckEditorLayer.addChild(this.deckEditorFrame)

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
      DECK_EDITOR_LAYOUT.count.position.x,
      DECK_EDITOR_LAYOUT.count.position.y
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
        DECK_EDITOR_LAYOUT.cardList.position.x,
        DECK_EDITOR_LAYOUT.cardList.position.y,
        DECK_EDITOR_LAYOUT.cardList.size.width,
        DECK_EDITOR_LAYOUT.cardList.size.height
      )
      .fill(0xffffff)
    deckEditorCardMask.eventMode = 'none'

    this.deckEditorCardViewport = new Container()
    this.deckEditorCardViewport.hitArea = new Rectangle(
      DECK_EDITOR_LAYOUT.cardList.position.x,
      DECK_EDITOR_LAYOUT.cardList.position.y,
      DECK_EDITOR_LAYOUT.cardList.size.width,
      DECK_EDITOR_LAYOUT.cardList.size.height
    )
    this.deckEditorCardViewport.eventMode = 'none'
    this.deckEditorCardViewport.on('wheel', this.handleDeckEditorCardWheel)
    this.deckEditorCardViewport.mask = deckEditorCardMask

    this.deckEditorCardContent = new Container()
    this.deckEditorCardViewport.addChild(this.deckEditorCardContent)
    this.deckEditorLayer.addChild(deckEditorCardMask)
    this.deckEditorLayer.addChild(this.deckEditorCardViewport)

    this.deckEditorDoneButton = new Button(this.options.assets.doneButton, {
      onClick: () => this.options.callbacks?.onEditorDone?.()
    })
    this.deckEditorDoneButton.position.set(
      DECK_EDITOR_LAYOUT.footerButton.position.x,
      DECK_EDITOR_LAYOUT.footerButton.position.y
    )
    this.deckEditorDoneButton.setBaseY(DECK_EDITOR_LAYOUT.footerButton.position.y)
    this.deckEditorLayer.addChild(this.deckEditorDoneButton)

    this.deckEditorLayer.visible = false
    this.deckEditorLayer.alpha = 0
    this.addChild(this.deckEditorLayer)
    this.addChild(this.deckFullWarning)
  }

  private createDeckButton(
    deck: Deck,
    onClick: () => void,
    showDeckName: boolean = true
  ): DeckEntryButton {
    const portraitAssetKey = getDeckPortraitAssetKey(deck.heroId)
    return new DeckEntryButton(this.options.assets.deckButtonFrame, {
      portrait: portraitAssetKey ? this.options.assets[portraitAssetKey] : undefined,
      portraitYOffset: getDeckPortraitYOffset(deck.heroId),
      deckName: deck.name,
      showDeckName,
      onClick
    })
  }

  private renderDeckEditorFrame(deck: Deck): void {
    for (const child of this.deckEditorFrame.removeChildren()) {
      child.destroy({ children: true })
    }
    const frame = this.createDeckButton(deck, () => undefined, false)
    frame.eventMode = 'none'
    frame.label = 'collection.deck-editor-frame'
    this.deckEditorFrame.addChild(frame)
  }

  private setDeckScroll(offset: number): void {
    this.deckScrollOffset = Math.max(-this.deckMaxScroll, Math.min(0, offset))
    this.deckScrollOffset = this.deckList.setScroll(
      this.deckScrollOffset,
      this.deckMaxScroll
    )
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
      this.deckList.slider.visible = false
      this.deckList.slider.eventMode = 'none'
      this.deckSliderDragging = false
      return
    }

    const scrollRatio = -scrollOffset / maxScroll
    const sliderY =
      COLLECTION_LAYOUT.deckSlider.minY +
      scrollRatio *
        (COLLECTION_LAYOUT.deckSlider.maxY - COLLECTION_LAYOUT.deckSlider.minY)

    this.deckList.slider.visible = true
    this.deckList.slider.position.set(COLLECTION_LAYOUT.deckSlider.x, sliderY)
  }

  private readonly handleDeckWheel = (event: FederatedWheelEvent): void => {
    if (!this.options.state.isNavigationReady() || this.deckMaxScroll === 0) return

    this.setDeckScroll(this.deckScrollOffset - event.deltaY)
    event.stopPropagation()
  }

  private readonly handleDeckEditorCardWheel = (event: FederatedWheelEvent): void => {
    if (
      !this.options.state.isNavigationReady() ||
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
      !this.options.state.isNavigationReady() ||
      maxScroll === 0 ||
      (this.activeDeckId !== null &&
        (this.deckEditorTransitioning ||
          this.deckEditorClosing ||
          this.deckEditorCardMutationInProgress))
    ) {
      return
    }

    this.deckSliderDragging = true
    this.deckSliderDragOffset = event.global.y - this.deckList.slider.y
    event.stopPropagation()
  }

  private readonly handleDeckSliderMove = (event: FederatedPointerEvent): void => {
    const maxScroll = this.getActiveScrollMax()
    if (!this.deckSliderDragging || maxScroll === 0) return

    const trackRange =
      COLLECTION_LAYOUT.deckSlider.maxY - COLLECTION_LAYOUT.deckSlider.minY
    const sliderY = Math.max(
      COLLECTION_LAYOUT.deckSlider.minY,
      Math.min(
        COLLECTION_LAYOUT.deckSlider.maxY,
        event.global.y - this.deckSliderDragOffset
      )
    )
    const scrollRatio = (sliderY - COLLECTION_LAYOUT.deckSlider.minY) / trackRange

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

  private getDeckEditorFrameTargetScale(): number {
    const bounds = this.deckEditorFrame.getLocalBounds()
    if (bounds.width <= 0 || bounds.height <= 0) {
      return 1
    }

    const widthScale = DECK_EDITOR_FRAME_TARGET_WIDTH / bounds.width
    const maxHeightScale =
      (2 *
        (DECK_EDITOR_LAYOUT.cardList.position.y -
          DECK_EDITOR_LAYOUT.header.position.y -
          DECK_EDITOR_FRAME_CARD_LIST_GAP)) /
      bounds.height

    return Math.max(1, Math.min(widthScale, maxHeightScale))
  }

  private animateDeckEditorTransition(
    origin: { x: number; y: number },
    opening: boolean
  ): Promise<void> {
    this.cancelDeckEditorTransition()

    return new Promise<void>((resolve) => {
      const targetY = opening ? DECK_EDITOR_LAYOUT.header.position.y : origin.y
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
        this.deckEditorFrame,
        {
          x: origin.x,
          y: targetY,
          duration: DECK_EDITOR_TRANSITION_DURATION,
          ease: 'power2.inOut'
        },
        0
      )
      timeline.to(
        this.deckEditorFrame.scale,
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
    this.deckEditorRows.clear()
    const sequence = ++this.deckEditorRenderSequence
    const oldRows = this.deckEditorCardContent.removeChildren()
    for (const row of oldRows) {
      row.destroy({ children: true })
    }

    const entries = buildDeckEditorEntries(deck)

    this.deckEditorCardMaxScroll = Math.max(
      0,
      this.getDeckEditorCardContentHeight(entries.length) -
        DECK_EDITOR_LAYOUT.cardList.size.height
    )
    this.setDeckEditorCardScroll(this.deckEditorCardScrollOffset)

    for (const [index, entry] of entries.entries()) {
      const row = this.createDeckCardRow(entry.cardId, entry.card, entry.count, index)
      this.deckEditorCardContent.addChild(row.row)
      this.deckEditorRows.set(entry.cardId, row)

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
          this.options.callbacks?.onWarning?.(
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
  ): DeckCardRow {
    const rowWidth = DECK_EDITOR_LAYOUT.cardList.size.width - DECK_EDITOR_ROW_INSET * 2
    const rowHeight = DECK_EDITOR_CARD_ROW_HEIGHT - DECK_EDITOR_CARD_ROW_GAP
    const row = new Container()
    row.label = `collection.deck-card.${cardId}`
    row.position.set(
      DECK_EDITOR_LAYOUT.cardList.position.x + DECK_EDITOR_ROW_INSET,
      DECK_EDITOR_LAYOUT.cardList.position.y +
        index * DECK_EDITOR_CARD_ROW_HEIGHT +
        DECK_EDITOR_ROW_INSET
    )
    row.hitArea = new Rectangle(0, 0, rowWidth, rowHeight)
    row.eventMode = 'static'
    row.cursor = 'pointer'
    row.on('pointertap', (event: FederatedPointerEvent) => {
      if (event.button !== 0) return
      event.stopPropagation()
      void this.removeCard(cardId, row)
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

    return {
      row,
      artworkLayer,
      artworkPlaceholder,
      artworkWidth,
      artworkHeight,
      copies
    }
  }

  private applyDeckRowArtwork(row: DeckCardRow, artwork: Texture): void {
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
    const rowTopLeft = this.toLocal({ x: rowBounds.x, y: rowBounds.y })
    const rowBottomRight = this.toLocal({
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
      this.addChild(preview)
      this.deckEditorCardPreview = preview
      this.tweenTo(preview, {
        alpha: 1,
        duration: 0.12,
        ease: 'power2.out'
      })
    } catch (error) {
      if (!this.disposed && request === this.deckEditorCardPreviewRequest) {
        this.options.callbacks?.onError?.(
          `Failed to render deck preview for ${card.name}.`,
          error
        )
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
}
