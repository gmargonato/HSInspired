import { Container, RenderTexture, Sprite, type Renderer, type Texture } from 'pixi.js'
import { AnimatedOutline } from '../../../visual-components/effects/animated-outline'

/** Exercise the hero's white aura shader while scene-owned fields retain its silhouette. */
export function prewarmHeroHover(renderer: Renderer, texture: Texture): void {
  const root = new Container()
  root.label = 'game.hero-hover-warmup'
  const sprite = new Sprite(texture)
  sprite.label = 'game.hero-hover-warmup.portrait'
  sprite.position.set(16, 16)
  sprite.scale.set(32 / Math.max(texture.width, texture.height))
  root.addChild(sprite)
  let outline: AnimatedOutline | undefined
  let target: RenderTexture | undefined
  try {
    outline = new AnimatedOutline(sprite, { palette: 'white', preset: 'hero' })
    target = RenderTexture.create({ width: 64, height: 64, resolution: 1 })
    outline.prebuild(renderer)
    renderer.render({ container: root, target, clear: true })
  } finally {
    outline?.dispose()
    root.destroy({ children: true })
    target?.destroy(true)
  }
}
