import { Rectangle, Sprite } from 'pixi.js'
import { GAME_HEIGHT, GAME_WIDTH } from '../app/config'
import { ASSET_BUNDLE_IDS, type SettingsBackgroundAssets } from '../ui/asset-registry'
import { Scene } from './Scene'

type SettingsBundleId =
  typeof ASSET_BUNDLE_IDS.menuSettings | typeof ASSET_BUNDLE_IDS.gameSettings

/** Shared presentation for the background-only settings overlays. */
abstract class SettingsScene extends Scene {
  protected constructor(
    private readonly bundleId: SettingsBundleId,
    private readonly label: string
  ) {
    super()
  }

  async init(): Promise<void> {
    const assets = await this.assetScope.acquire<SettingsBackgroundAssets>(
      this.bundleId
    )
    const background = new Sprite(assets.background)
    background.label = this.label
    background.eventMode = 'static'
    background.cursor = 'default'
    background.hitArea = new Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT)
    background.position.set(0, 0)
    background.width = GAME_WIDTH
    background.height = GAME_HEIGHT
    this.root.addChild(background)
  }

  update(_deltaMS: number): void {}
}

/** Settings overlay used throughout the non-match menu flow. */
export class MenuSettingsScene extends SettingsScene {
  constructor() {
    super(ASSET_BUNDLE_IDS.menuSettings, 'menu-settings-background')
  }
}

/** Settings overlay used while a match is active. */
export class GameSettingsScene extends SettingsScene {
  constructor() {
    super(ASSET_BUNDLE_IDS.gameSettings, 'game-settings-background')
  }
}
