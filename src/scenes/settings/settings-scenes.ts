import { Rectangle, Sprite, Text, type Texture } from 'pixi.js'
import type { Preferences } from '../../desktop/contracts/ipc/preferences'
import { SETTINGS_LAYOUT } from './settings-layout'
import { GraphicsToggle } from './graphics-toggle'
import { AiCheatsToggle } from './ai-cheats-toggle'
import { CursorSizeSlider } from './cursor-size-slider'
import { AiDifficultySelector } from './ai-difficulty-selector'
import { ResolutionSelector } from './resolution-selector'
import { BoardCornerSelector, type BoardCornerSelection } from './board-corner-selector'
import { applyAnchoredPlacement, applyPlacement } from '../../visual-components/layout'
import {
  ASSET_BUNDLE_IDS,
  type GameSettingsAssets,
  type SharedUIAssets,
  type MenuSettingsAssets
} from '../../visual-components/assets'
import { Button } from '../../visual-components/controls/button'
import { Scene } from '../../visual-components/lifecycle/scene'

export interface GameSettingsCallbacks {
  readonly onConcede: () => void | Promise<void>
  readonly onOptions: () => void | Promise<void>
  readonly onRestart: () => void | Promise<void>
  readonly onQuit: () => void | Promise<void>
}

export interface MatchSettingsContext {
  readonly ai: Pick<Preferences, 'aiDifficulty' | 'aiCheatsEnabled'>
  readonly enable3dElements: boolean
  readonly boardCorners: BoardCornerSelection
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
    await document.fonts.load('400 36px "Franklin Gothic Condensed"')
  }

  protected override onExit(): void {
    this.resolutionSelector?.dispose()
    this.resolutionSelector = null
  }
}

/** Shared menu settings, with locked AI settings when opened during a match. */
export class MenuSettingsScene extends SettingsScene {
  private readonly graphicsToggles: GraphicsToggle[] = []
  private aiCheatsToggle: AiCheatsToggle | null = null
  private cursorSizeSlider: CursorSizeSlider | null = null
  private aiDifficultySelector: AiDifficultySelector | null = null
  private boardCornerSelector: BoardCornerSelector | null = null

  constructor(private readonly match?: MatchSettingsContext) {
    super()
  }

  private closeOptions(): void {
    this.aiDifficultySelector?.closeOptions()
    this.resolutionSelector?.closeOptions()
    this.boardCornerSelector?.closeOptions()
  }

  private addReadOnlyLabel(
    text: string,
    label: string,
    layout: Parameters<typeof applyAnchoredPlacement>[1]
  ): void {
    const value = new Text({
      text,
      style: { fontFamily: 'Franklin Gothic Condensed', fontSize: 36, fill: 0xf5e3b6 }
    })
    value.label = label
    value.eventMode = 'none'
    applyAnchoredPlacement(value, layout)
    this.root.addChild(value)
  }

  async init(): Promise<void> {
    const assets = await this.assetScope.acquire<MenuSettingsAssets>(
      ASSET_BUNDLE_IDS.menuSettings
    )
    this.root.sortableChildren = true
    this.createBackground(assets.background, 'menu-settings-background')
    await this.waitForFonts()
    if (this.match) {
      this.addReadOnlyLabel(
        `Difficulty: ${this.match.ai.aiDifficulty === 'easy' ? 'Easy' : 'Expert'}`,
        'settings.ai-difficulty-value',
        SETTINGS_LAYOUT.matchAiDifficulty
      )
      this.addReadOnlyLabel(
        `AI Cheats: ${this.match.ai.aiCheatsEnabled ? 'On' : 'Off'}`,
        'settings.ai-cheats-value',
        SETTINGS_LAYOUT.matchAiCheats
      )
    } else {
      const cheats = new AiCheatsToggle(assets, window.api.preferences, () =>
        this.closeOptions()
      )
      await cheats.init()
      this.aiCheatsToggle = cheats
      this.root.addChild(cheats)
    }
    for (const setting of ['enable3dElements', 'enableShadows'] as const) {
      if (setting === 'enable3dElements' && this.match) {
        this.addReadOnlyLabel(
          `3D elements are ${this.match.enable3dElements ? 'enabled' : 'disabled'}`,
          'settings.3d-elements-value',
          SETTINGS_LAYOUT.match3dElements
        )
        continue
      }
      const toggle = new GraphicsToggle(assets, window.api.preferences, setting, () => {
        this.closeOptions()
      })
      await toggle.init()
      this.graphicsToggles.push(toggle)
      this.root.addChild(toggle)
    }
    const cursor = this.sceneManager.cursor
    if (cursor) {
      const shared = await this.assetScope.acquire<SharedUIAssets>(
        ASSET_BUNDLE_IDS.sharedUI
      )
      this.cursorSizeSlider = new CursorSizeSlider(
        {
          cursorSlider: assets.cursorSlider,
          horizontalSlider: shared.horizontalSlider
        },
        cursor,
        window.api.preferences,
        () => {
          this.closeOptions()
        },
        (error) => console.error('Could not save cursor size.', error),
        this.match ? SETTINGS_LAYOUT.matchCursor : SETTINGS_LAYOUT
      )
      this.root.addChild(this.cursorSizeSlider)
    }
    if (!this.match) {
      const aiDifficultySelector = new AiDifficultySelector(
        assets,
        window.api.preferences,
        console.error,
        () => this.closeOptions()
      )
      await aiDifficultySelector.init()
      this.aiDifficultySelector = aiDifficultySelector
      this.root.addChild(aiDifficultySelector)
    }
    if (this.match?.boardCorners.options.length) {
      this.boardCornerSelector = new BoardCornerSelector(
        assets,
        this.match.boardCorners,
        () => this.closeOptions()
      )
      this.root.addChild(this.boardCornerSelector)
    }
    await this.createResolutionSelector(assets, () => this.closeOptions())
  }

  update(_deltaMS: number): void {}

  protected override onExit(): void {
    super.onExit()
    for (const toggle of this.graphicsToggles) toggle.removeAllListeners()
    this.graphicsToggles.length = 0
    this.aiCheatsToggle?.removeAllListeners()
    this.aiCheatsToggle = null
    this.cursorSizeSlider?.dispose()
    this.cursorSizeSlider = null
    this.aiDifficultySelector?.dispose()
    this.aiDifficultySelector = null
    this.boardCornerSelector?.dispose()
    this.boardCornerSelector = null
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
      assets.optionsButton,
      SETTINGS_LAYOUT.gameActions.optionsFrame,
      SETTINGS_LAYOUT.gameActions.optionsButton,
      'game-settings.options',
      this.callbacks.onOptions
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
      })
      .finally(() => {
        this.actionPending = false
        if (this.isLoaded) {
          for (const button of this.actionButtons) button.setEnabled(true)
        }
      })
  }
}
