import { Scene } from '../../visual-components/lifecycle/scene'
import { VfxLab } from './'
import { ASSET_BUNDLE_IDS, type GameAssets } from '../../visual-components/assets'
import type { HealingAssets } from '../../visual-components/assets/healing-assets'

/** Development-only standalone preview for reusable match VFX. */
export class VfxLabScene extends Scene {
  readonly devSceneId = 'vfx-lab' as const
  private lab?: VfxLab

  async init(): Promise<void> {
    const canvas = this.appInstance.canvas
    const parent = canvas.parentElement
    if (!parent) throw new Error('VFX Lab requires a canvas parent')
    const assets = await this.assetScope.acquire<GameAssets>(ASSET_BUNDLE_IDS.game)
    const healingAssets = await this.assetScope.acquire<HealingAssets>(
      ASSET_BUNDLE_IDS.healingVfx
    )
    this.lab = new VfxLab({
      canvas,
      parent,
      renderer: this.appInstance.renderer,
      assets,
      healingAssets
    })
    this.root.addChild(this.lab)
  }

  update(deltaMS: number): void {
    this.lab?.update(deltaMS)
  }

  protected onPause(): void {
    this.lab?.setControlsVisible(false)
  }

  protected onResume(): void {
    this.lab?.setControlsVisible(true)
  }

  protected onExit(): void {
    this.lab?.dispose()
  }
}
