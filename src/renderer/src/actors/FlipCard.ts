import { Sprite, Texture } from 'pixi.js'
import { Actor } from './Actor'

export interface FlipCardOptions {
  durationMs?: number
  onClick?: () => void
}

/**
 * A two-sided card actor. On pointer down it performs a scaleX flip:
 * the card narrows edge-on, the faces swap mid-flip, then it widens back.
 * The scale is animated on this container, so the sprite's anchor must be
 * centered for the effect to look like a rotation.
 */
export class FlipCard extends Actor {
  readonly front: Sprite
  readonly back: Sprite
  private readonly durationMs: number
  private flipped = false
  private flipping = false

  constructor(texture: Texture, backTexture: Texture, options: FlipCardOptions = {}) {
    super()
    this.durationMs = options.durationMs ?? 400

    this.front = new Sprite(texture)
    this.front.anchor.set(0.5)
    this.front.position.set(0, 0)
    this.back = new Sprite(backTexture)
    this.back.anchor.set(0.5)
    this.back.position.set(0, 0)
    this.back.visible = false

    this.addChild(this.front)
    this.addChild(this.back)

    this.eventMode = 'static'
    this.cursor = 'pointer'
    this.on('pointertap', () => {
      if (this.flipping) return
      void this.flip().then(() => options.onClick?.())
    })
  }

  get isFlipped(): boolean {
    return this.flipped
  }

  async flip(): Promise<void> {
    if (this.flipping) return
    this.flipping = true

    const halfMs = this.durationMs / 2
    const target = this.flipped ? this.front : this.back

    await new Promise<void>((resolve) => {
      this.tweenTo(this.scale, {
        x: 0,
        duration: halfMs / 1000,
        ease: 'power2.in',
        onComplete: () => {
          this.front.visible = target === this.front
          this.back.visible = target === this.back
          this.flipped = !this.flipped
          this.tweenTo(this.scale, {
            x: 1,
            duration: halfMs / 1000,
            ease: 'power2.out',
            onComplete: () => {
              this.flipping = false
              resolve()
            }
          })
        }
      })
    })
  }
}