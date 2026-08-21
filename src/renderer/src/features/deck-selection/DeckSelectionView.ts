import { Container, Sprite, Text } from 'pixi.js'
import type { AudioService } from '../../app/audio'
import type { AppLogger } from '../../app/services'
import {
  ASSET_BUNDLE_IDS,
  type DeckPresentationAssets,
  type DeckSelectionAssets,
  type SharedUIAssets
} from '../../ui/asset-registry'
import { AssetScope } from '../../ui/asset-registry/asset-scope'
import {
  AnimatedOutline,
  OUTLINE_PROFILES
} from '../../rendering/effects/animated-outline'
import { applyAnchoredPlacement, applyPlacement } from '../../rendering/layout'
import { Button } from '../../ui/components/Button'
import { HERO_CATALOG } from '../../../../game/content/heroes'
import type { DeckStore } from '../deck-builder/deck-store'
import { DECK_FRAME_ASSET_KEYS } from '../deck-builder/deck-frames'
import { buildDeckSelectionEntries } from './deck-selection-model'
import { DECK_SELECTION_LAYOUT } from './deck-selection-layout'

export interface DeckSelectionViewCallbacks {
  readonly onCollectionPressed?: () => void | Promise<void>
  readonly onBackPressed?: () => void | Promise<void>
  readonly onPlayPressed?: (
    deck: import('../../../../game/decks').Deck
  ) => void | Promise<void>
}

/** Feature-owned presentation and selection state for the player's complete decks. */
export class DeckSelectionView extends Container {
  private readonly assetScope = new AssetScope()
  private readonly deckButtons: Button[] = []
  private toCollectionButton!: Button
  private backButton!: Button
  private heroPortrait!: Sprite
  private heroName!: Text
  private playOutlineTarget!: Sprite
  private playButton!: Button
  private playOutline!: AnimatedOutline
  private selectedDeck: import('../../../../game/decks').Deck | null = null
  private navigationStarted = false

  constructor(
    private readonly deckStore: DeckStore,
    private readonly callbacks: DeckSelectionViewCallbacks = {},
    private readonly audio?: AudioService,
    private readonly logger: AppLogger = {
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

      await this.deckStore.load()

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

    this.playOutlineTarget = new Sprite(assets.playButton)
    applyAnchoredPlacement(this.playOutlineTarget, DECK_SELECTION_LAYOUT.playButton)
    this.playOutlineTarget.eventMode = 'none'
    this.addChild(this.playOutlineTarget)

    this.playButton = new Button(assets.playButton, {
      audio: this.audio,
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

    this.playOutline = new AnimatedOutline(
      this.playOutlineTarget,
      'blue',
      OUTLINE_PROFILES.button
    )
    this.playOutline.setEnabled(false)
  }

  private createDeckGrid(assets: DeckPresentationAssets): void {
    for (const entry of buildDeckSelectionEntries(this.deckStore.getDecks())) {
      const hero = HERO_CATALOG.require(entry.deck.heroId)
      const texture = assets[DECK_FRAME_ASSET_KEYS[hero.classId]]
      const button = new Button(texture, {
        pressSound: 'collection-deck-select',
        audio: this.audio,
        onClick: () => this.selectDeck(entry.deck, assets)
      })
      button.position.set(
        DECK_SELECTION_LAYOUT.deckGrid.frameStart.x +
          texture.width / 2 +
          entry.column * (texture.width + DECK_SELECTION_LAYOUT.deckGrid.frameGap.x),
        DECK_SELECTION_LAYOUT.deckGrid.frameStart.y +
          texture.height / 2 +
          entry.row * (texture.height + DECK_SELECTION_LAYOUT.deckGrid.frameGap.y)
      )
      button.setBaseY(button.position.y)
      this.deckButtons.push(button)
      this.addChild(button)
    }
  }

  private selectDeck(
    deck: import('../../../../game/decks').Deck,
    assets: DeckPresentationAssets
  ): void {
    const hero = HERO_CATALOG.require(deck.heroId)
    this.selectedDeck = deck
    this.heroPortrait.texture = assets[hero.presentationAssetKey]
    this.heroPortrait.visible = true
    this.heroName.text = hero.displayName
    this.heroName.visible = true
    this.playButton.visible = true
    this.playButton.setEnabled(!this.navigationStarted)
    this.playOutline.setEnabled(!this.navigationStarted)
  }

  private createNavigation(
    assets: DeckSelectionAssets,
    sharedAssets: SharedUIAssets
  ): void {
    this.toCollectionButton = new Button(assets.toCollectionButton, {
      audio: this.audio,
      onClick: () => this.navigate(this.callbacks.onCollectionPressed, 'collection')
    })
    applyPlacement(this.toCollectionButton, DECK_SELECTION_LAYOUT.toCollectionButton)
    this.toCollectionButton.setBaseY(
      DECK_SELECTION_LAYOUT.toCollectionButton.position.y
    )
    this.addChild(this.toCollectionButton)

    this.backButton = new Button(sharedAssets.backButton, {
      clickSound: 'back-click',
      audio: this.audio,
      onClick: () => this.navigate(this.callbacks.onBackPressed, 'main menu')
    })
    applyPlacement(this.backButton, DECK_SELECTION_LAYOUT.backButton)
    this.backButton.setBaseY(DECK_SELECTION_LAYOUT.backButton.position.y)
    this.addChild(this.backButton)
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
    this.toCollectionButton.setEnabled(enabled)
    this.backButton.setEnabled(enabled)
    this.playButton.setEnabled(enabled && this.selectedDeck !== null)
    this.playOutline.setEnabled(enabled && this.selectedDeck !== null)
  }

  private async waitForFonts(): Promise<void> {
    if (typeof document === 'undefined' || !document.fonts) return
    await document.fonts.load('30px Belwe')
  }

  async dispose(): Promise<void> {
    this.playOutline?.dispose()
    await this.assetScope.releaseAll()
  }
}
