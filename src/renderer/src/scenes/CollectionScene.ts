import { Sprite } from 'pixi.js'
import { Scene } from './Scene'
import { GAME_HEIGHT, GAME_WIDTH } from '../core/config'
import { ASSET_BUNDLE_IDS, CollectionAssets } from '../core/assets'

/** Full-viewport collection scene presented through the main menu transition. */
export class CollectionScene extends Scene {
  private background!: Sprite

  async init(): Promise<void> {
    const assets = await this.assetScope.acquire<CollectionAssets>(
      ASSET_BUNDLE_IDS.collection
    )

    this.background = new Sprite(assets.background)
    this.background.width = GAME_WIDTH
    this.background.height = GAME_HEIGHT
    this.root.addChild(this.background)
  }

  update(_deltaMS: number): void {}
}
