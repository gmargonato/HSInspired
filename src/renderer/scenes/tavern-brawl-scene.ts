import { Sprite, Text } from 'pixi.js'
import type { SceneRouter } from '../app/router'
import type { AppLogger } from '../app/services'
import { createMatchSeed } from '../features/deck-selection/deck-selection-model'
import { TAVERN_BRAWL_LAYOUT } from '../features/tavern-brawl/tavern-brawl-layout'
import { createTavernBrawlGameRoute } from '../features/tavern-brawl/tavern-brawl-model'
import { applyAnchoredPlacement, applyPlacement } from '../rendering/layout'
import {
  ASSET_BUNDLE_IDS,
  type SharedUIAssets,
  type TavernBrawlAssets
} from '../ui/asset-registry'
import { Button } from '../ui/components/button'
import type { PlayerStatsStore } from '../ui/player-stats-store'
import { Scene } from './scene'

export class TavernBrawlScene extends Scene {
  private playButton!: Button
  private backButton!: Button
  private navigationStarted = false

  constructor(
    private readonly playerStatsStore: PlayerStatsStore,
    private readonly router?: SceneRouter,
    private readonly logger: AppLogger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    }
  ) {
    super()
  }

  async init(): Promise<void> {
    const [assets, sharedAssets] = await Promise.all([
      this.assetScope.acquire<TavernBrawlAssets>(ASSET_BUNDLE_IDS.tavernBrawl),
      this.assetScope.acquire<SharedUIAssets>(ASSET_BUNDLE_IDS.sharedUI)
    ])

    const background = new Sprite(assets.background)
    background.label = 'tavern-brawl.background'
    applyAnchoredPlacement(background, TAVERN_BRAWL_LAYOUT.background)
    background.eventMode = 'none'
    this.root.addChild(background)

    let wins = 0
    try {
      await this.playerStatsStore.load()
      wins = this.playerStatsStore.getTavernBrawlWins()
    } catch (error) {
      this.logger.warn('Failed to load Tavern Brawl wins; showing zero.', error)
    }

    await this.waitForFont()
    const winsText = new Text({
      text: String(wins),
      style: {
        fontFamily: 'Belwe',
        fontSize: 48,
        fontWeight: '700',
        fill: 0x241b16,
        align: 'center'
      }
    })
    winsText.label = 'tavern-brawl.wins'
    applyAnchoredPlacement(winsText, TAVERN_BRAWL_LAYOUT.wins)
    winsText.eventMode = 'none'
    this.root.addChild(winsText)

    this.playButton = new Button(assets.playButton, {
      onClick: () =>
        this.navigate(
          () => this.router?.navigate(createTavernBrawlGameRoute(createMatchSeed())),
          'match'
        )
    })
    this.playButton.label = 'tavern-brawl.play-button'
    applyPlacement(this.playButton, TAVERN_BRAWL_LAYOUT.playButton)
    this.playButton.setBaseY(TAVERN_BRAWL_LAYOUT.playButton.position.y)
    this.root.addChild(this.playButton)

    this.backButton = new Button(sharedAssets.backButton, {
      onClick: () =>
        this.navigate(
          () => this.router?.navigate({ id: 'main-menu', entryMode: 'returning' }),
          'main menu'
        )
    })
    this.backButton.label = 'tavern-brawl.back-button'
    applyPlacement(this.backButton, TAVERN_BRAWL_LAYOUT.backButton)
    this.backButton.setBaseY(TAVERN_BRAWL_LAYOUT.backButton.position.y)
    this.root.addChild(this.backButton)
  }

  update(_deltaMS: number): void {}

  private async navigate(
    operation: () => Promise<void> | undefined,
    destinationName: string
  ): Promise<void> {
    if (this.navigationStarted) return
    this.navigationStarted = true
    this.playButton.setEnabled(false)
    this.backButton.setEnabled(false)

    try {
      const result = operation()
      if (!result) throw new Error('Tavern Brawl router is not configured')
      await result
    } catch (error) {
      this.logger.error(`Failed to open ${destinationName}.`, error)
      this.navigationStarted = false
      this.playButton.setEnabled(true)
      this.backButton.setEnabled(true)
      throw error
    }
  }

  private async waitForFont(): Promise<void> {
    if (typeof document === 'undefined' || !document.fonts) return
    await document.fonts.load('700 48px Belwe')
  }
}
