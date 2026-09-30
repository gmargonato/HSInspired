import { Scene } from '../../visual-components/lifecycle/scene'
import { HeroPowerAnim } from './hero-power-anim'
import { HERO_POWER_ANIM_LAYOUT } from './hero-power-anim-layout'
import {
  ASSET_BUNDLE_IDS,
  CardAssetResolver,
  type GameAssets,
  type DeckPresentationAssets
} from '../../visual-components/assets'

/** Development-only visual practice board, with no match session. */
export class HeroPowerAnimScene extends Scene {
  readonly devSceneId = 'hero-power-anim' as const
  private preview?: HeroPowerAnim

  async init(): Promise<void> {
    const canvas = this.appInstance.canvas
    const parent = canvas.parentElement
    if (!parent) throw new Error('Hero Power Anim requires a canvas parent')
    const [assets, heroes] = await Promise.all([
      this.assetScope.acquire<GameAssets>(ASSET_BUNDLE_IDS.game),
      this.assetScope.acquire<DeckPresentationAssets>(ASSET_BUNDLE_IDS.deckPresentation)
    ])
    this.preview = new HeroPowerAnim({
      canvas,
      parent,
      renderer: this.appInstance.renderer,
      assets,
      heroes
    })
    this.root.addChild(this.preview)
    try {
      const artwork = await new CardAssetResolver().loadArtwork(
        HERO_POWER_ANIM_LAYOUT.minion.cardId
      )
      if (!artwork) throw new Error('Hero Power Anim could not load its minion artwork')
      await this.preview.mount(artwork)
    } catch (error) {
      this.preview.dispose()
      throw error
    }
  }

  update(deltaMS: number): void {
    this.preview?.update(deltaMS)
  }
  protected onPause(): void {
    this.preview?.setControlsVisible(false)
  }
  protected onResume(): void {
    this.preview?.setControlsVisible(true)
  }
  protected onExit(): void {
    this.preview?.dispose()
  }
}
