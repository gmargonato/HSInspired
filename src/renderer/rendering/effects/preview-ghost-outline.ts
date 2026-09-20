import { Container, Sprite, type Renderer, type Texture } from 'pixi.js'
import { AnimatedOutline } from './animated-outline'

/**
 * Keeps a preview's original artwork intact while rendering the ghost shader
 * from a snapshot behind it.
 */
export class PreviewGhostOutline {
  private readonly proxy: Sprite | null
  private readonly outline: AnimatedOutline | null
  private readonly texture: Texture | null
  private disposed = false

  constructor(renderer: Renderer, target: Container) {
    const frame = target.getLocalBounds().rectangle.clone()
    if (frame.width <= 0 || frame.height <= 0) {
      this.proxy = null
      this.outline = null
      this.texture = null
      return
    }

    const alpha = target.alpha
    const visible = target.visible
    target.alpha = 1
    target.visible = true
    let texture: Texture
    try {
      texture = renderer.generateTexture({
        target,
        frame,
        antialias: true
      })
    } finally {
      target.alpha = alpha
      target.visible = visible
    }

    this.texture = texture
    this.proxy = new Sprite(texture)
    this.proxy.position.set(frame.x, frame.y)
    this.proxy.width = frame.width
    this.proxy.height = frame.height
    this.proxy.eventMode = 'none'
    this.proxy.label = `${target.label ?? 'preview'}.ghost-outline-target`
    target.addChildAt(this.proxy, 0)
    this.outline = new AnimatedOutline(this.proxy, {
      preset: 'card',
      palette: 'white',
      cacheDistance: true
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.outline?.dispose()
    this.proxy?.removeFromParent()
    this.proxy?.destroy({ texture: false })
    this.texture?.destroy(true)
  }
}
