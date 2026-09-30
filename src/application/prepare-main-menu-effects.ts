// Register the optional upload system before application renderer initialization.
import 'pixi.js/prepare'
import { Container, RenderTexture, Sprite, Texture, type Renderer } from 'pixi.js'
import { ASSET_BUNDLE_IDS, type MainMenuAssets } from '../visual-components/assets'
import { AssetScope } from '../visual-components/assets/asset-scope'
import { createGodRaysFilter } from '../visual-components/effects/god-rays-filter'
import { GodRaysDust } from '../visual-components/effects/god-rays-dust'
import {
  GOD_RAYS_CONFIG,
  GOD_RAYS_DUST_CONFIG
} from '../visual-components/effects/outline-tuning'
import { GAME_WIDTH, GAME_HEIGHT } from '../visual-components/layout'

/** Load persistent textures and compile both effect programs before the first scene. */
export async function prepareMainMenuEffects(renderer: Renderer): Promise<void> {
  const scope = new AssetScope()
  try {
    const assets = await scope.acquire<MainMenuAssets>(ASSET_BUNDLE_IDS.mainMenu)
    // Keep the two small effect textures resident between menu visits.
    assets.dustRound.source.autoGarbageCollect = false
    assets.dustTriangle.source.autoGarbageCollect = false
    await renderer.prepare.upload(Object.values(assets))
    const rays = createGodRaysFilter(GOD_RAYS_CONFIG)
    const root = new Container()
    const carrier = new Sprite(Texture.WHITE)
    carrier.width = GAME_WIDTH
    carrier.height = GAME_HEIGHT
    carrier.filters = [rays.filter]
    root.addChild(carrier)
    const dust = new GodRaysDust([assets.dustRound, assets.dustTriangle], rays, {
      ...GOD_RAYS_DUST_CONFIG,
      enabled: true,
      count: 2
    })
    root.addChild(dust)
    const target = RenderTexture.create({ width: GAME_WIDTH, height: GAME_HEIGHT })
    try {
      // Offscreen rendering warms Pixi's cached GL programs without flashing onscreen.
      renderer.render({ container: root, target, clear: true })
    } finally {
      carrier.filters = null
      root.destroy({ children: true })
      rays.destroy()
      target.destroy(true)
    }
  } finally {
    // The persistent bundle stays cached after this startup ownership ends.
    await scope.releaseAll()
  }
}
