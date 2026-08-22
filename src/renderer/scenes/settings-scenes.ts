import { Rectangle, Sprite } from 'pixi.js'
import { SETTINGS_LAYOUT } from '../features/settings/settings-layout'
import { applyAnchoredPlacement } from '../rendering/layout'
import { ASSET_BUNDLE_IDS, type SettingsBackgroundAssets } from '../ui/asset-registry'
import { Scene } from './scene'

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
