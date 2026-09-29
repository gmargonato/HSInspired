import { Rectangle, Sprite, type Texture } from 'pixi.js'
import { SETTINGS_LAYOUT } from '../features/settings/settings-layout'
import { AiModeSelector } from '../features/settings/ai-mode-selector'
import { ExpertDeckStrategyToggle } from '../features/settings/expert-deck-strategy-toggle'
import { ResolutionSelector } from '../features/settings/resolution-selector'
import { applyAnchoredPlacement, applyPlacement } from '../rendering/layout'
import {
  ASSET_BUNDLE_IDS,
  type GameSettingsAssets,
  type MenuSettingsAssets
} from '../ui/asset-registry'
import { Button } from '../ui/components/button'
import { Scene } from './scene'

export interface GameSettingsCallbacks {
  readonly onConcede: () => void | Promise<void>
  readonly onRestart: () => void | Promise<void>
  readonly onQuit: () => void | Promise<void>
}

/** Shared presentation plumbing for the menu and match settings overlays. */
abstract class SettingsScene extends Scene {
  protected resolutionSelector: ResolutionSelector | null = null

  protected createBackground(texture: Texture, label: string): void {
    const background = new Sprite(texture)
    background.label = label
    background.eventMode = 'static'
    background.cursor = 'default'
    background.hitArea = new Rectangle(
      0,
      0,
      SETTINGS_LAYOUT.background.size.width,
      SETTINGS_LAYOUT.background.size.height
    )
    applyAnchoredPlacement(background, SETTINGS_LAYOUT.background)
    background.width = SETTINGS_LAYOUT.background.size.width
    background.height = SETTINGS_LAYOUT.background.size.height
    this.root.addChild(background)
  }

  protected async createResolutionSelector(
    assets: Pick<MenuSettingsAssets, 'resolutionField' | 'resolutionButton'>,
    onOpen: () => void = () => undefined
  ): Promise<void> {
    await this.waitForFonts()
    const selector = new ResolutionSelector(
      assets,
      window.api.windowSettings,
      console.error,
      onOpen
    )
    await selector.init()
    this.resolutionSelector = selector
    this.root.addChild(selector)
  }

  update(_deltaMS: number): void {}

  protected async waitForFonts(): Promise<void> {
    if (typeof document === 'undefined' || !document.fonts) return
    await document.fonts.load('700 42px Belwe')
  }

  protected override onExit(): void {
    this.resolutionSelector?.dispose()
    this.resolutionSelector = null
  }
}

/** Settings overlay used throughout the non-match menu flow. */
export class MenuSettingsScene extends SettingsScene {
  private aiModeSelector: AiModeSelector | null = null
  private expertDeckStrategyToggle: ExpertDeckStrategyToggle | null = null

  async init(): Promise<void> {
    const assets = await this.assetScope.acquire<MenuSettingsAssets>(
      ASSET_BUNDLE_IDS.menuSettings
    )
    this.createBackground(assets.background, 'menu-settings-background')
    await this.waitForFonts()
    const strategyToggle = new ExpertDeckStrategyToggle(
      assets,
      window.api.preferences,
      console.error,
      () => {
        this.aiModeSelector?.closeOptions()
        this.resolutionSelector?.closeOptions()
      }
    )
    await strategyToggle.init()
    this.expertDeckStrategyToggle = strategyToggle
    this.root.addChild(strategyToggle)
    const aiModeSelector = new AiModeSelector(
      assets,
      window.api.preferences,
      console.error,
      () => this.resolutionSelector?.closeOptions()
    )
    await aiModeSelector.init()
    this.aiModeSelector = aiModeSelector
    this.root.addChild(aiModeSelector)
    await this.createResolutionSelector(assets, () =>
      this.aiModeSelector?.closeOptions()
    )
  }

  update(_deltaMS: number): void {}

  protected override onExit(): void {
    super.onExit()
    this.aiModeSelector?.dispose()
    this.aiModeSelector = null
    this.expertDeckStrategyToggle?.dispose()
    this.expertDeckStrategyToggle = null
  }
}

/** Settings overlay used while a match is active. */
export class GameSettingsScene extends SettingsScene {
  private readonly actionButtons: Button[] = []
  private actionPending = false

  constructor(private readonly callbacks: GameSettingsCallbacks) {
    super()
  }

  async init(): Promise<void> {
    const assets = await this.assetScope.acquire<GameSettingsAssets>(
      ASSET_BUNDLE_IDS.gameSettings
    )
    this.createBackground(assets.background, 'game-settings-background')

    this.addAction(
      assets.baseFrameLarge,
      assets.concedeButton,
      SETTINGS_LAYOUT.gameActions.concedeFrame,
      SETTINGS_LAYOUT.gameActions.concedeButton,
      'game-settings.concede',
      this.callbacks.onConcede
    )
    this.addAction(
      assets.baseFrameLarge,
      assets.restartButton,
      SETTINGS_LAYOUT.gameActions.restartFrame,
      SETTINGS_LAYOUT.gameActions.restartButton,
      'game-settings.restart',
      this.callbacks.onRestart
    )
    this.addAction(
      assets.baseFrameLarge,
      assets.quitButton,
      SETTINGS_LAYOUT.gameActions.quitFrame,
      SETTINGS_LAYOUT.gameActions.quitButton,
      'game-settings.quit',
      this.callbacks.onQuit
    )
  }

  update(_deltaMS: number): void {}

  protected override onExit(): void {
    super.onExit()
    for (const button of this.actionButtons) button.setEnabled(false)
    this.actionButtons.length = 0
  }

  private addAction(
    frameTexture: Texture,
    buttonTexture: Texture,
    framePlacement: Parameters<typeof applyAnchoredPlacement>[1],
    buttonPlacement: Parameters<typeof applyPlacement>[1],
    label: string,
    callback: () => void | Promise<void>
  ): void {
    const frame = new Sprite(frameTexture)
    frame.label = `${label}.frame`
    frame.eventMode = 'none'
    applyAnchoredPlacement(frame, framePlacement)
    this.root.addChild(frame)

    const button = new Button(buttonTexture, {
      sinkPx: 3,
      onClick: () => this.runAction(callback)
    })
    button.label = `${label}.button`
    applyPlacement(button, buttonPlacement)
    button.setBaseY(buttonPlacement.position.y)
    this.actionButtons.push(button)
    this.root.addChild(button)
  }

  private runAction(callback: () => void | Promise<void>): void {
    if (this.actionPending) return
    this.actionPending = true
    for (const button of this.actionButtons) button.setEnabled(false)

    void Promise.resolve()
      .then(callback)
      .catch((error: unknown) => {
        console.error('Failed to execute a game settings action.', error)
        this.actionPending = false
        for (const button of this.actionButtons) button.setEnabled(true)
      })
  }
}
