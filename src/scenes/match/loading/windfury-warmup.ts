import { Container, RenderTexture, type Renderer } from 'pixi.js'
import { WindfuryEffect } from '../board/windfury-effect'
import { MINION_LAYOUT } from '../board/minion-layout'
import { HERO_LAYOUT } from '../board/hero-layout'

/** Exercise Pixi's wind geometry/shader upload path before the board is shown. */
export function prewarmWindfury(renderer: Renderer): void {
  const root = new Container()
  root.label = 'game.windfury-warmup'
  root.scale.set(0.05)
  const target = RenderTexture.create({ width: 32, height: 32, resolution: 1 })
  const effects = [MINION_LAYOUT.windfury, HERO_LAYOUT.windfury].map(
    (layout) => new WindfuryEffect(layout, 'warmup.windfury')
  )
  try {
    for (const effect of effects) {
      effect.setEnabled(true)
      root.addChild(effect.rear, effect.front)
    }
    renderer.render({ container: root, target, clear: true })
  } finally {
    for (const effect of effects) effect.destroy()
    root.destroy({ children: true })
    target.destroy(true)
  }
}
