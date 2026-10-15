import { Container, RenderTexture, Sprite, type Renderer } from 'pixi.js'
import type { GameAssets } from '../../../visual-components/assets'
import { combatHitSparkFrames } from '../combat/combat-impact-effect'

/** Draw every hit texture with its gameplay blend mode before the board is shown. */
export function prewarmCombatImpact(renderer: Renderer, assets: GameAssets): void {
  const root = new Container()
  root.label = 'game.combat-impact-warmup'
  let target: RenderTexture | undefined
  try {
    target = RenderTexture.create({ width: 32, height: 32, resolution: 1 })
    const textures = [
      assets.combatHitSpark,
      assets.heroPowerAura2,
      assets.ghostSpotlight,
      ...combatHitSparkFrames(assets),
      assets.damageIndicator
    ]
    for (const [index, texture] of textures.entries()) {
      const sample = new Sprite(texture)
      sample.label = `game.combat-impact-warmup.frame-${index}`
      sample.width = sample.height = 24
      sample.blendMode = index < 3 ? 'add' : 'normal'
      root.addChild(sample)
    }
    renderer.render({ container: root, target, clear: true })
  } finally {
    root.destroy({ children: true, texture: false, textureSource: false })
    target?.destroy(true)
  }
}
