import { Container, Sprite, Text } from 'pixi.js'
import type { RendererLogger } from '../../ui/logger'
import {
  ASSET_BUNDLE_IDS,
  type DeckPresentationAssets,
  type DeckSelectionAssets,
  type SharedUIAssets
} from '../../ui/asset-registry'
import { AssetScope } from '../../ui/asset-registry/asset-scope'
import { AnimatedOutline } from '../../rendering/effects/animated-outline'
import { applyAnchoredPlacement, applyPlacement } from '../../rendering/layout'
import { Button } from '../../ui/components/button'
import { DeckEntryButton } from '../../ui/components/deck-entry-button'
import { HERO_CATALOG } from '../../../game/content/heroes'
import type { DeckStore } from '../../ui/deck-store'
import type { PlayerStatsStore } from '../../ui/player-stats-store'
import {
  getDeckPortraitAssetKey,
  getDeckPortraitYOffset
} from '../../ui/asset-registry/deck-portraits'
import {
  buildDeckSelectionEntries,
  formatClassWins,
  getDeckSelectionPageCount
} from './deck-selection-model'
import { DECK_SELECTION_LAYOUT } from './deck-selection-layout'

export interface DeckSelectionViewCallbacks {
  readonly onBackPressed?: () => void | Promise<void>
  readonly onPlayPressed?: (
    deck: import('../../../game/decks').Deck
  ) => void | Promise<void>
}

/** Feature-owned presentation and selection state for the player's complete decks. */
export class DeckSelectionView extends Container {
  private readonly assetScope = new AssetScope()
  private readonly deckButtons: Button[] = []
  private readonly deckOutlines: AnimatedOutline[] = []
  private deckGrid!: Container
  private deckPresentationAssets!: DeckPresentationAssets
  private pageLabel!: Text
  private previousPageButton!: Button
  private nextPageButton!: Button
  private backButton!: Button
  private heroPortrait!: Sprite
  private heroName!: Text
  private classWins!: Text
  private playOutlineTarget!: Sprite
  private playButton!: Button
  private playOutline!: AnimatedOutline
  private selectedDeck: import('../../../game/decks').Deck | null = null
  private selectedDeckOutline: AnimatedOutline | null = null
  private navigationStarted = false
  private currentPageIndex = 0

  constructor(
    private readonly deckStore: DeckStore,
    private readonly playerStatsStore: PlayerStatsStore,
    private readonly callbacks: DeckSelectionViewCallbacks = {},
    private readonly logger: RendererLogger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    }
  ) {
    super()
  }

  async mount(): Promise<void> {
    await this.waitForFonts()
    try {
      const assets = await this.assetScope.acquire<DeckSelectionAssets>(
        ASSET_BUNDLE_IDS.deckSelection
      )
      const sharedAssets = await this.assetScope.acquire<SharedUIAssets>(
        ASSET_BUNDLE_IDS.sharedUI
      )
      const deckPresentationAssets =
        await this.assetScope.acquire<DeckPresentationAssets>(
          ASSET_BUNDLE_IDS.deckPresentation
        )
      this.deckPresentationAssets = deckPresentationAssets

      await this.deckStore.load()
      try {
        await this.playerStatsStore.load()
      } catch (error) {
        this.logger.warn('Failed to load player win totals; showing zero.', error)
      }

      this.createBackground(assets)
      this.createSelectionDetails(assets)
      this.createDeckGrid(deckPresentationAssets)
      this.createNavigation(assets, sharedAssets)
    } catch (error) {
      await this.assetScope.releaseAll()
      throw error
    }
  }

  private createBackground(assets: DeckSelectionAssets): void {
    const panel = new Sprite(assets.panel)
    applyAnchoredPlacement(panel, DECK_SELECTION_LAYOUT.panel)
    panel.eventMode = 'none'
    this.addChild(panel)
  }

  private createSelectionDetails(assets: DeckSelectionAssets): void {
    this.heroPortrait = new Sprite()
    applyAnchoredPlacement(this.heroPortrait, DECK_SELECTION_LAYOUT.heroPortrait)
    this.heroPortrait.visible = false
    this.heroPortrait.eventMode = 'none'
    this.addChild(this.heroPortrait)

    this.heroName = new Text({
      text: '',
      style: {
        fontFamily: 'Belwe',
        fontSize: 30,
        fill: 0xffffff,
        align: 'center'
      }
    })
    applyAnchoredPlacement(this.heroName, DECK_SELECTION_LAYOUT.heroName)
    this.heroName.visible = false
    this.heroName.eventMode = 'none'
    this.addChild(this.heroName)

    this.classWins = new Text({
      text: '',
      style: {
        fontFamily: 'Belwe',
        fontSize: 24,
        fill: 0xffffff,
        align: 'center'
      }
    })
    applyAnchoredPlacement(this.classWins, DECK_SELECTION_LAYOUT.classWins)
    this.classWins.label = 'deck-selection.class-wins'
    this.classWins.visible = false
    this.classWins.eventMode = 'none'
    this.addChild(this.classWins)

    this.playOutlineTarget = new Sprite(assets.playButton)
    applyAnchoredPlacement(this.playOutlineTarget, DECK_SELECTION_LAYOUT.playButton)
    this.playOutlineTarget.eventMode = 'none'
    this.addChild(this.playOutlineTarget)

    this.playButton = new Button(assets.playButton, {
      onClick: () => {
        if (!this.selectedDeck) return
        return this.navigate(
          () => this.callbacks.onPlayPressed?.(this.selectedDeck!),
          'game'
        )
      }
    })
    applyPlacement(this.playButton, DECK_SELECTION_LAYOUT.playButton)
    this.playButton.setBaseY(DECK_SELECTION_LAYOUT.playButton.position.y)
    this.playButton.visible = false
    this.playButton.setEnabled(false)
    this.addChild(this.playButton)

    this.playOutline = new AnimatedOutline(this.playOutlineTarget, {
      palette: 'blue',
      preset: 'button'
    })
    this.playOutline.setEnabled(false)
  }

  private createDeckGrid(assets: DeckPresentationAssets): void {
    this.deckGrid = new Container()
    this.deckGrid.label = 'deck-selection.deck-grid'
    this.addChild(this.deckGrid)
    this.renderDeckGrid(assets)
  }

  private renderDeckGrid(assets: DeckPresentationAssets): void {
    for (const outline of this.deckOutlines) outline.dispose()
    this.deckOutlines.length = 0
    this.deckButtons.length = 0
    for (const child of this.deckGrid.removeChildren()) {
      child.destroy({ children: true })
    }

    for (const entry of buildDeckSelectionEntries(
      this.deckStore.getDecks(),
      this.currentPageIndex
    )) {
      const texture = assets.deckButtonFrame
      const portraitAssetKey = getDeckPortraitAssetKey(entry.deck.heroId)
      const framePosition = {
        x:
          DECK_SELECTION_LAYOUT.deckGrid.frameStart.x +
          texture.width / 2 +
          entry.column * (texture.width + DECK_SELECTION_LAYOUT.deckGrid.frameGap.x),
        y:
          DECK_SELECTION_LAYOUT.deckGrid.frameStart.y +
          texture.height / 2 +
          entry.row * (texture.height + DECK_SELECTION_LAYOUT.deckGrid.frameGap.y)
      }

      // The outline is rendered from a duplicate silhouette so disabling the
      // effect never hides the interactive deck button itself.
      const outlineTarget = new Sprite(texture)
      outlineTarget.anchor.set(0.5)
      outlineTarget.position.set(framePosition.x, framePosition.y)
      outlineTarget.eventMode = 'none'
      outlineTarget.label = `deck-selection.deck-outline:${entry.deck.id}`
      this.deckGrid.addChild(outlineTarget)

      const outline = new AnimatedOutline(outlineTarget, {
        palette: 'blue',
        preset: 'button'
      })
      outline.setEnabled(false)
      this.deckOutlines.push(outline)

      const button = new DeckEntryButton(texture, {
        portrait: portraitAssetKey ? assets[portraitAssetKey] : undefined,
        portraitYOffset: getDeckPortraitYOffset(entry.deck.heroId),
        deckName: entry.deck.name,
        onClick: () => this.selectDeck(entry.deck, assets, outline)
      })
      button.label = `deck-selection.deck:${entry.deck.id}`
      button.position.set(framePosition.x, framePosition.y)
      button.setBaseY(framePosition.y)
      this.deckButtons.push(button)
      this.deckGrid.addChild(button)
    }
  }

  private selectDeck(
    deck: import('../../../game/decks').Deck,
    assets: DeckPresentationAssets,
    outline: AnimatedOutline
  ): void {
    const hero = HERO_CATALOG.require(deck.heroId)
    this.selectedDeckOutline?.setEnabled(false)
    this.selectedDeckOutline = outline
    this.selectedDeck = deck
    this.heroPortrait.texture = assets[hero.presentationAssetKey]
    this.heroPortrait.visible = true
    this.heroName.text = hero.displayName
    this.heroName.visible = true
    this.classWins.text = formatClassWins(this.playerStatsStore.getWins(hero.classId))
    this.classWins.visible = true
    this.playButton.visible = true
    this.playButton.setEnabled(!this.navigationStarted)
    this.playOutline.setEnabled(!this.navigationStarted)
    outline.setEnabled(!this.navigationStarted)
  }

  private createNavigation(
    assets: DeckSelectionAssets,
    sharedAssets: SharedUIAssets
  ): void {
    this.pageLabel = new Text({
      text: '',
      style: {
        fontFamily: 'Belwe',
        fontSize: 28,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 4 },
        align: 'center'
      }
    })
    applyAnchoredPlacement(this.pageLabel, DECK_SELECTION_LAYOUT.pageLabel)
    this.pageLabel.label = 'deck-selection.page-label'
    this.pageLabel.eventMode = 'none'
    this.addChild(this.pageLabel)

    this.previousPageButton = new Button(assets.paginationNextButton, {
      onClick: () => this.setPage(this.currentPageIndex - 1)
    })
    applyPlacement(this.previousPageButton, DECK_SELECTION_LAYOUT.previousPageButton)
    this.previousPageButton.scale.x = -1
    this.previousPageButton.setBaseY(
      DECK_SELECTION_LAYOUT.previousPageButton.position.y
    )
    this.previousPageButton.label = 'deck-selection.previous-page'
    this.addChild(this.previousPageButton)

    this.nextPageButton = new Button(assets.paginationNextButton, {
      onClick: () => this.setPage(this.currentPageIndex + 1)
    })
    applyPlacement(this.nextPageButton, DECK_SELECTION_LAYOUT.nextPageButton)
    this.nextPageButton.setBaseY(DECK_SELECTION_LAYOUT.nextPageButton.position.y)
    this.nextPageButton.label = 'deck-selection.next-page'
    this.addChild(this.nextPageButton)

    this.backButton = new Button(sharedAssets.backButton, {
      onClick: () => this.navigate(this.callbacks.onBackPressed, 'main menu')
    })
    applyPlacement(this.backButton, DECK_SELECTION_LAYOUT.backButton)
    this.backButton.setBaseY(DECK_SELECTION_LAYOUT.backButton.position.y)
    this.addChild(this.backButton)

    this.updatePaginationControls()
  }

  private setPage(pageIndex: number): void {
    const pageCount = getDeckSelectionPageCount(this.deckStore.getDecks())
    const nextPageIndex = Math.max(0, Math.min(pageIndex, pageCount - 1))
    if (nextPageIndex === this.currentPageIndex) return

    this.currentPageIndex = nextPageIndex
    this.clearSelection()
    this.renderDeckGrid(this.deckPresentationAssets)
    this.updatePaginationControls()
  }

  private updatePaginationControls(): void {
    const pageCount = getDeckSelectionPageCount(this.deckStore.getDecks())
    this.pageLabel.text = `Page ${this.currentPageIndex + 1}/${pageCount}`
    this.previousPageButton.visible = this.currentPageIndex > 0
    this.previousPageButton.setEnabled(
      !this.navigationStarted && this.currentPageIndex > 0
    )
    this.nextPageButton.visible = this.currentPageIndex < pageCount - 1
    this.nextPageButton.setEnabled(
      !this.navigationStarted && this.currentPageIndex < pageCount - 1
    )
  }

  private clearSelection(): void {
    this.selectedDeckOutline?.setEnabled(false)
    this.selectedDeckOutline = null
    this.selectedDeck = null
    this.heroPortrait.visible = false
    this.heroName.text = ''
    this.heroName.visible = false
    this.classWins.text = ''
    this.classWins.visible = false
    this.playButton.visible = false
    this.playButton.setEnabled(false)
    this.playOutline.setEnabled(false)
  }

  private async navigate(
    callback: (() => void | Promise<void>) | undefined,
    destinationName: string
  ): Promise<void> {
    if (this.navigationStarted) return

    this.navigationStarted = true
    this.setNavigationEnabled(false)

    try {
      if (!callback) throw new Error('Deck selection router is not configured')
      await callback()
    } catch (error) {
      this.logger.error(`Failed to open ${destinationName}.`, error)
      this.navigationStarted = false
      this.setNavigationEnabled(true)
      throw error
    }
  }

  private setNavigationEnabled(enabled: boolean): void {
    this.previousPageButton.setEnabled(enabled && this.currentPageIndex > 0)
    this.nextPageButton.setEnabled(
      enabled &&
        this.currentPageIndex < getDeckSelectionPageCount(this.deckStore.getDecks()) - 1
    )
    this.backButton.setEnabled(enabled)
    this.playButton.setEnabled(enabled && this.selectedDeck !== null)
    this.playOutline.setEnabled(enabled && this.selectedDeck !== null)
    this.selectedDeckOutline?.setEnabled(enabled && this.selectedDeck !== null)
  }

  private async waitForFonts(): Promise<void> {
    if (typeof document === 'undefined' || !document.fonts) return
    await document.fonts.load('700 30px Belwe')
    await document.fonts.load('700 24px Belwe')
  }

  async dispose(): Promise<void> {
    this.playOutline?.dispose()
    for (const outline of this.deckOutlines) outline.dispose()
    this.selectedDeckOutline = null
    await this.assetScope.releaseAll()
  }
}
