import { BlurFilter, Sprite } from 'pixi.js'
import {
  ASSET_BUNDLE_IDS,
  type CollectionAssets,
  type DeckPresentationAssets,
  type SharedUIAssets
} from '../ui/asset-registry'
import { Button } from '../ui/components/button'
import { Scene } from './scene'
import { GAME_HEIGHT, GAME_WIDTH } from '../app/config'
import { NewDeckView } from '../features/deck-builder/new-deck-view'
import type { DeckStore } from '../features/deck-builder/deck-store'
import { DeleteDeckView } from '../features/collection/delete-deck-view'
import {
  CollectionView,
  type CollectionCardAddSource
} from '../features/collection/collection-view'
import {
  DeckPanelView,
  type DeckPanelAssets,
  type DeckPanelViewCallbacks
} from '../features/collection/deck-panel-view'
import { CollectionDeckController } from '../features/collection/collection-deck-controller'
import { COLLECTION_PREVIEW_BLUR_STRENGTH } from '../features/collection/collection-layout'
import { DECK_EDITOR_LAYOUT } from '../features/collection/deck-editor-layout'
import type { AppLogger, DialogService } from '../app/services'
import type { CardDefinition, DeckClass } from '../../game/content/cards'
import { MAX_DECKS, type Deck } from '../../game/decks'
import type { CardPreviewRouteBounds, SceneRouter } from '../app/router'

/** Full-viewport collection scene presented through the main menu transition. */
export class CollectionScene extends Scene {
  private readonly deckController: CollectionDeckController
  private background!: Sprite
  private collectionView!: CollectionView
  private deckPanel!: DeckPanelView
  private newDeckScene!: NewDeckView
  private deleteDeckView!: DeleteDeckView
  private collectionBackButton!: Button
  private previousCollectionClassFilter: DeckClass | null = null
  private collectionPreviewBlurFilter: BlurFilter | null = null
  private navigationReady = false
  private unsubscribeDeckStore: (() => void) | null = null
  private disposed = false

  constructor(
    private readonly deckStore: DeckStore,
    private readonly router?: SceneRouter,
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
    this.deckController = new CollectionDeckController(deckStore, () =>
      this.deleteDeckView.confirmDeletion()
    )
  }

  async init(): Promise<void> {
    const assets = await this.assetScope.acquire<CollectionAssets>(
      ASSET_BUNDLE_IDS.collection
    )
    const sharedAssets = await this.assetScope.acquire<SharedUIAssets>(
      ASSET_BUNDLE_IDS.sharedUI
    )
    const deckPresentationAssets =
      await this.assetScope.acquire<DeckPresentationAssets>(
        ASSET_BUNDLE_IDS.deckPresentation
      )

    this.background = new Sprite(assets.background)
    this.background.width = GAME_WIDTH
    this.background.height = GAME_HEIGHT
    this.root.addChild(this.background)

    this.collectionView = new CollectionView({
      assets,
      canvas: this.appInstance.canvas,
      cursor: this.sceneManager.cursor,
      state: {
        isNavigationReady: () => this.navigationReady,
        isNewDeckOpen: () => this.newDeckScene?.isOpen ?? false,
        isEditorTransitioning: () => this.deckPanel?.isTransitioning ?? false,
        isEditorClosing: () => this.deckPanel?.isClosing ?? false,
        isEditorMutating: () => this.deckPanel?.isMutating ?? false,
        getActiveDeck: () => this.deckPanel?.getActiveDeck() ?? null
      },
      callbacks: {
        onCardTap: (card, source) => this.handleCollectionCardTap(card, source),
        onCardPreview: (card, sourceBounds) =>
          this.handleCollectionCardPreview(card, sourceBounds),
        onRevealComplete: () => this.handleRevealComplete(),
        onError: (message, error) => this.reportError(message, error),
        onWarning: (message, error) => this.reportWarning(message, error)
      }
    })
    this.collectionView.init()
    this.root.addChild(this.collectionView)

    await this.deckController.load()
    await this.waitForFonts()

    const deckPanelAssets: DeckPanelAssets = {
      ...assets,
      ...deckPresentationAssets,
      doneButton: sharedAssets.doneButton
    }
    this.deckPanel = new DeckPanelView({
      assets: deckPanelAssets,
      renderer: this.appInstance.renderer,
      deckController: this.deckController,
      state: {
        isNavigationReady: () => this.navigationReady,
        isNewDeckOpen: () => this.newDeckScene?.isOpen ?? false
      },
      callbacks: this.createDeckPanelCallbacks()
    })
    this.deckPanel.init()
    this.root.addChild(this.deckPanel)

    this.createCollectionBackButton(sharedAssets)

    this.newDeckScene = new NewDeckView(
      this.deckStore,
      {
        onClassSelected: (hero) =>
          this.handleNewDeckHeroSelected(hero.classId as DeckClass),
        onCancelled: () => this.handleNewDeckCreationCancelled(),
        onDeckCreated: (deck) => this.handleNewDeckCreated(deck)
      },
      this.logger,
      { newDeckFrames: true }
    )
    await this.newDeckScene.mount()
    this.root.addChild(this.newDeckScene)

    this.deleteDeckView = new DeleteDeckView()
    await this.deleteDeckView.mount()
    this.root.addChild(this.deleteDeckView)

    await this.collectionView.renderPage(0)
    this.unsubscribeDeckStore = this.deckController.subscribe(
      this.handleDeckStoreChanged
    )
  }

  playCoverReveal(): Promise<void> {
    return this.collectionView.playCoverReveal()
  }

  update(_deltaMS: number): void {}

  protected onExit(): void {
    this.disposed = true
    this.setCollectionPreviewBlurred(false)
    this.navigationReady = false
    this.unsubscribeDeckStore?.()
    this.unsubscribeDeckStore = null
    this.collectionView.onExit()
    this.deckPanel.onExit()
    this.sceneManager.cursor?.setContextVariant(null)
    void this.newDeckScene?.dispose()
    void this.deleteDeckView?.dispose()
  }

  protected onPause(): void {
    this.setCollectionPreviewBlurred(true)
    this.collectionView.onPause()
  }

  protected onResume(): void {
    this.setCollectionPreviewBlurred(false)
    this.collectionView.onResume()
  }

  private createDeckPanelCallbacks(): DeckPanelViewCallbacks {
    return {
      onDeckTap: (deckId) => void this.enterDeck(deckId),
      onNewDeck: () => void this.beginNewDeckCreation(),
      onDeleteDeck: (deckId) => void this.deleteDeck(deckId),
      onEditorDone: () => void this.exitDeckEditor(),
      onError: (message, error) => this.reportError(message, error),
      onWarning: (message, error) => this.reportWarning(message, error)
    }
  }

  private createCollectionBackButton(sharedAssets: SharedUIAssets): void {
    this.collectionBackButton = new Button(sharedAssets.backButton, {
      onClick: () => void this.leaveCollection()
    })
    this.collectionBackButton.position.set(
      DECK_EDITOR_LAYOUT.footerButton.x,
      DECK_EDITOR_LAYOUT.footerButton.y
    )
    this.collectionBackButton.setBaseY(DECK_EDITOR_LAYOUT.footerButton.y)
    this.collectionBackButton.visible = true
    this.root.addChild(this.collectionBackButton)
  }

  private handleRevealComplete(): void {
    this.navigationReady = true
    this.setNavigationEnabled(true)
    this.setDeckInteractionEnabled(true)
  }

  private setNavigationEnabled(enabled: boolean): void {
    this.collectionView.setNavigationEnabled(enabled)
  }

  private setDeckInteractionEnabled(enabled: boolean): void {
    this.deckPanel.setInteractionEnabled(enabled)
    const activeDeckOpen = this.deckPanel.getActiveDeckId() !== null
    const newDeckOpen = this.newDeckScene?.isOpen ?? false
    const backEnabled = enabled && !activeDeckOpen && !newDeckOpen
    this.collectionBackButton.visible = !activeDeckOpen
    this.collectionBackButton.setEnabled(backEnabled)
  }

  private reportError(message: string, error?: unknown): void {
    this.logger.error(message, error)
    this.dialogs.error(message)
  }

  private reportWarning(message: string, error?: unknown): void {
    this.logger.warn(message, error)
  }

  private readonly handleDeckStoreChanged = (): void => {
    if (this.disposed) return

    const activeDeckId = this.deckPanel.getActiveDeckId()
    if (activeDeckId) {
      if (!this.deckController.getDeck(activeDeckId)) {
        void this.exitDeckEditor().then(() => {
          if (!this.disposed) this.deckPanel.renderDeckList()
        })
      } else {
        const deck = this.deckController.getDeck(activeDeckId)
        if (deck && !this.deckPanel.isAddingCard) this.deckPanel.updateEditor(deck)
        this.collectionView.refreshCompletionState()
      }
      return
    }

    this.deckPanel.renderDeckList()
  }

  private async enterDeck(deckId: string): Promise<void> {
    if (
      !this.navigationReady ||
      this.disposed ||
      this.deckPanel.getActiveDeckId() !== null ||
      this.deckPanel.isTransitioning
    ) {
      return
    }
    const deck = this.deckController.getDeck(deckId)
    if (!deck) return

    const origin = this.deckPanel.getDeckEntryOrigin(deckId) ?? {
      x: DECK_EDITOR_LAYOUT.header.x,
      y: DECK_EDITOR_LAYOUT.header.y
    }

    this.setDeckInteractionEnabled(false)

    try {
      await this.collectionView.applyClassFilter(this.deckPanel.getDeckClass(deck))
    } catch (error) {
      this.reportError(`Failed to filter the collection for ${deck.name}.`, error)
      if (!this.disposed) this.setDeckInteractionEnabled(true)
      return
    }
    if (this.disposed) return

    await this.deckPanel.enterEditor(deck, origin)
    if (this.disposed) return

    this.collectionView.refreshCompletionState()
    this.setDeckInteractionEnabled(true)
  }

  private async exitDeckEditor(): Promise<void> {
    if (
      this.disposed ||
      !this.deckPanel.getActiveDeckId() ||
      this.deckPanel.isClosing
    ) {
      return
    }

    this.setNavigationEnabled(false)
    this.setDeckInteractionEnabled(false)

    await this.deckPanel.exitEditor()
    if (this.disposed) return

    try {
      await this.collectionView.applyClassFilter(null)
    } catch (error) {
      this.reportError('Failed to restore the full collection.', error)
    } finally {
      if (!this.disposed) {
        this.setNavigationEnabled(true)
        this.setDeckInteractionEnabled(true)
      }
    }
  }

  private handleCollectionCardTap(
    card: CardDefinition,
    source: CollectionCardAddSource
  ): void {
    if (this.deckPanel.getActiveDeckId() === null || this.deckPanel.isTransitioning) {
      return
    }

    void this.deckPanel.enqueueCardAddition(card, source).catch((error: unknown) => {
      this.reportError(`Failed to add ${card.name} to the deck.`, error)
      this.deckPanel.flashCount()
    })
  }

  private handleCollectionCardPreview(
    card: CardDefinition,
    sourceBounds: CardPreviewRouteBounds
  ): Promise<void> {
    return (
      this.router
        ? this.router.navigate({ id: 'card-preview', cardId: card.id, sourceBounds })
        : Promise.reject(new Error('Collection router is not configured'))
    ).catch((error: unknown) => {
      this.reportError(`Failed to open card preview for ${card.name}.`, error)
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

    this.previousCollectionClassFilter = this.collectionView.classFilter
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
      await this.collectionView.applyClassFilter(heroClass)
    } catch (error) {
      this.reportError(`Failed to filter the collection for ${heroClass}.`, error)
    }
  }

  private async handleNewDeckCreationCancelled(): Promise<void> {
    const previousFilter = this.previousCollectionClassFilter

    try {
      await this.collectionView.applyClassFilter(previousFilter)
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
    if (!(await this.deckController.confirmDeckDeletion(deck))) return

    try {
      await this.deckController.deleteDeck(deckId)
    } catch (error) {
      this.reportError(`Failed to delete ${deck.name}.`, error)
    }
  }

  private async leaveCollection(): Promise<void> {
    if (
      !this.navigationReady ||
      this.disposed ||
      this.deckPanel.getActiveDeckId() !== null ||
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

  private async waitForFonts(): Promise<void> {
    if (typeof document === 'undefined' || !document.fonts) return

    await Promise.all([
      document.fonts.load('38px Belwe'),
      document.fonts.load('38px "Arial Narrow"'),
      document.fonts.load('400 27px "Franklin Gothic Condensed"'),
      document.fonts.load('700 27px "Franklin Gothic Condensed"')
    ])
  }

  private setCollectionPreviewBlurred(blurred: boolean): void {
    if (blurred) {
      if (this.collectionPreviewBlurFilter) return

      const filter = new BlurFilter({
        strength: COLLECTION_PREVIEW_BLUR_STRENGTH,
        quality: 2,
        resolution: 'inherit',
        antialias: 'inherit'
      })
      this.collectionPreviewBlurFilter = filter
      this.root.filters = [...(this.root.filters ?? []), filter]
      return
    }

    const filter = this.collectionPreviewBlurFilter
    if (!filter) return

    this.root.filters = (this.root.filters ?? []).filter(
      (candidate) => candidate !== filter
    )
    this.collectionPreviewBlurFilter = null
    filter.destroy()
  }
}
