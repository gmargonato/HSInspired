import { Container, Sprite, Text } from 'pixi.js'
import type { RendererLogger } from '../../application/contracts/logger'
import {
  ASSET_BUNDLE_IDS,
  type DeckPresentationAssets,
  type DeckSelectionAssets,
  type SharedUIAssets
} from '../../visual-components/assets'
import { AssetScope } from '../../visual-components/assets/asset-scope'
import { AnimatedOutline } from '../../visual-components/effects/animated-outline'
import { applyAnchoredPlacement, applyPlacement } from '../../visual-components/layout'
import { Button } from '../../visual-components/controls/button'
import { DeckEntryButton } from '../../visual-components/controls/deck-entry-button'
import { HERO_CATALOG } from '../../game-rules/content/heroes'
import { getDeckHeroTexture } from '../../visual-components/assets/hero-assets'
import type { Deck } from '../../game-rules/decks'
import type { PreferencesApi } from '../../desktop/contracts/ipc/preferences'
import type { DeckStore } from '../../application/contracts/deck-store'
import type { PlayerStatsStore } from '../../application/contracts/player-stats-store'
import {
  getDeckPortraitAssetKey,
  getDeckPortraitYOffset
} from '../../visual-components/assets/deck-portraits'
import {
  buildDeckSelectionEntries,
  formatClassWins,
  formatLegendRank,
  getDeckSelectionPageCount,
  getDeckSelectionPageForDeck
} from './deck-selection-model'
import { DECK_SELECTION_LAYOUT } from './deck-selection-layout'
import {
  getRankMedalTexture,
  LEGEND_MEDAL_Y_OFFSET
} from '../../visual-components/assets/rank-medals'
import type { ConstructedRankSnapshot } from '../../desktop/contracts/ipc/player-stats'

export interface DeckSelectionViewCallbacks {
  readonly onBackPressed?: () => void | Promise<void>
  readonly onPlayPressed?: (deck: Deck) => void | Promise<void>
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
  private selectedDeck: Deck | null = null
  private selectedDeckOutline: AnimatedOutline | null = null
  private navigationStarted = false
  private currentPageIndex = 0
  private rankMedalSprite!: Sprite
  private rankMedalNumber!: Text
  private rankMedalAssets: DeckSelectionAssets | null = null

  constructor(
    private readonly deckStore: DeckStore,
    private readonly playerStatsStore: PlayerStatsStore,
    private readonly callbacks: DeckSelectionViewCallbacks = {},
    private readonly logger: RendererLogger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    },
    private readonly preferencesApi?: PreferencesApi
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
      this.createRankMedal(assets)
      this.createSelectionDetails(assets)
      this.createDeckGrid(deckPresentationAssets)
      this.createNavigation(assets, sharedAssets)
      await this.restoreLastPlayedSelection()
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

  /** Seat the player's constructed rank medal in the top-right socket. */
  private createRankMedal(assets: DeckSelectionAssets): void {
    this.rankMedalAssets = assets
    const rank = this.playerStatsStore.getRank()
    this.rankMedalSprite = new Sprite(getRankMedalTexture(assets, rank))
    applyAnchoredPlacement(this.rankMedalSprite, DECK_SELECTION_LAYOUT.rankMedal)
    this.rankMedalSprite.eventMode = 'none'
    this.rankMedalSprite.label = 'deck-selection.rank-medal'
    this.addChild(this.rankMedalSprite)

    this.rankMedalNumber = new Text({
      text: '',
      style: {
        fontFamily: 'Belwe',
        fontSize: 60,
        fill: 0xf7e08c,
        stroke: { color: 0x000000, width: 5 },
        align: 'center'
      }
    })
    applyAnchoredPlacement(this.rankMedalNumber, DECK_SELECTION_LAYOUT.rankMedal)
    this.rankMedalNumber.eventMode = 'none'
    this.rankMedalNumber.label = 'deck-selection.rank-medal-number'
    this.rankMedalNumber.visible = false
    this.addChild(this.rankMedalNumber)
    this.applyRankMedal(rank)
    this.refreshRankMedalNumber(rank)
  }

  /** Re-seats the medal after a dev-menu rank override. */
  refreshRankMedal(): void {
    const rank = this.playerStatsStore.getRank()
    if (!this.rankMedalAssets) return
    this.rankMedalSprite.texture = getRankMedalTexture(this.rankMedalAssets, rank)
    this.applyRankMedal(rank)
    this.refreshRankMedalNumber(rank)
  }

  private applyRankMedal(rank: ConstructedRankSnapshot): void {
    applyAnchoredPlacement(this.rankMedalSprite, DECK_SELECTION_LAYOUT.rankMedal)
    applyAnchoredPlacement(this.rankMedalNumber, DECK_SELECTION_LAYOUT.rankMedal)
    if (rank.tier === 'legend') {
      this.rankMedalSprite.y += LEGEND_MEDAL_Y_OFFSET
      this.rankMedalNumber.y += LEGEND_MEDAL_Y_OFFSET
    } else {
      this.rankMedalSprite.y += 10
    }
  }

  private refreshRankMedalNumber(rank: ConstructedRankSnapshot): void {
    if (rank.tier !== 'legend') {
      this.rankMedalNumber.visible = false
      this.rankMedalNumber.text = ''
      return
    }
    this.rankMedalNumber.text = formatLegendRank(rank.legendRank)
    this.rankMedalNumber.visible = true
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
      preset: 'play-button'
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
        preset: 'deck-frame'
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
    deck: import('../../game-rules/decks').Deck,
    assets: DeckPresentationAssets,
    outline: AnimatedOutline
  ): void {
    const hero = HERO_CATALOG.require(deck.heroId)
    this.selectedDeckOutline?.setEnabled(false)
    this.selectedDeckOutline = outline
    this.selectedDeck = deck
    this.heroPortrait.texture = getDeckHeroTexture(assets, hero.presentationAssetKey)
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

  private async restoreLastPlayedSelection(): Promise<void> {
    if (!this.preferencesApi) return

    let lastPlayedDeckId: string | null = null
    try {
      lastPlayedDeckId = (await this.preferencesApi.get()).lastPlayedDeckId
    } catch (error) {
      this.logger.warn(
        'Failed to load the last played deck; skipping pre-selection.',
        error
      )
      return
    }
    if (!lastPlayedDeckId) return

    const decks = this.deckStore.getDecks()
    const pageIndex = getDeckSelectionPageForDeck(decks, lastPlayedDeckId)
    if (pageIndex === null) {
      try {
        await this.preferencesApi.set({ lastPlayedDeckId: null })
      } catch (error) {
        this.logger.warn('Failed to clear the stale last played deck.', error)
      }
      return
    }

    if (pageIndex !== this.currentPageIndex) {
      this.currentPageIndex = pageIndex
      this.renderDeckGrid(this.deckPresentationAssets)
      this.updatePaginationControls()
    }

    const entries = buildDeckSelectionEntries(decks, pageIndex)
    const entryIndex = entries.findIndex((entry) => entry.deck.id === lastPlayedDeckId)
    const outline = entryIndex >= 0 ? this.deckOutlines[entryIndex] : undefined
    if (entryIndex === -1 || !outline) return
    this.selectDeck(entries[entryIndex].deck, this.deckPresentationAssets, outline)
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
    await document.fonts.load('700 40px Belwe')
  }

  async dispose(): Promise<void> {
    this.playOutline?.dispose()
    for (const outline of this.deckOutlines) outline.dispose()
    this.selectedDeckOutline = null
    await this.assetScope.releaseAll()
  }
}
