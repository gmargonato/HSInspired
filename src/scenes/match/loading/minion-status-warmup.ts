import { Container, RenderTexture, type Renderer } from 'pixi.js'
import type { GameAssets } from '../../../visual-components/assets'
import { MinionStatusCurtainEffect } from '../board/minion-status-curtain-effect'

/** Upload both textures and exercise the tinted additive sprites and oval mask. */
export function prewarmMinionStatus(renderer: Renderer, assets: GameAssets): void {
  const root = new Container()
  root.label = 'game.minion-status-warmup'
  root.scale.set(0.1)
  let target: RenderTexture | undefined
  let effect: MinionStatusCurtainEffect | undefined
  try {
    target = RenderTexture.create({ width: 32, height: 32, resolution: 1 })
    effect = new MinionStatusCurtainEffect(assets.playSpotlight4, assets.playSpotlight1)
    root.addChild(effect.layer)
    effect.setState({ spellDamage: true, buffed: true, debuffed: true })
    renderer.render({ container: root, target, clear: true })
  } finally {
    effect?.destroy()
    root.destroy({ children: true })
    target?.destroy(true)
  }
}
