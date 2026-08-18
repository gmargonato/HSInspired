import { Sprite, Texture } from 'pixi.js'
import { Actor } from './Actor'

export interface FlipCardOptions {
  durationMs?: number
  initialFace?: 'front' | 'back'
  onClick?: () => void | Promise<void>
  oneShot?: boolean
}

/**
 * A two-sided card actor. On pointer down it performs a scaleX flip:
 * the card narrows edge-on, the faces swap mid-flip, then it widens back.
 * The scale is animated on this container, so the sprite's anchor must be
 * centered for the effect to look like a rotation.
 *
 * With `oneShot: true` the card flips from front to back exactly once and
 * can never flip back again.
 */
export class FlipCard extends Actor {
  readonly front: Sprite
  readonly back: Sprite
  private readonly durationMs: number
  private readonly oneShot: boolean
  private flipped = false
  private flipping = false
  private flipPromise: Promise<void> | null = null

  constructor(texture: Texture, backTexture: Texture, options: FlipCardOptions = {}) {
    super()
    this.durationMs = options.durationMs ?? 400
    this.oneShot = options.oneShot ?? false

    this.front = new Sprite(texture)
    this.front.anchor.set(0.5)
    this.front.position.set(0, 0)
    this.back = new Sprite(backTexture)
    this.back.anchor.set(0.5)
    this.back.position.set(0, 0)
    this.flipped = options.initialFace === 'back'
    this.front.visible = !this.flipped
    this.back.visible = this.flipped

    this.addChild(this.front)
    this.addChild(this.back)

    this.eventMode = this.oneShot && this.flipped ? 'none' : 'static'
    this.cursor = this.oneShot && this.flipped ? 'default' : 'pointer'
    this.on('pointertap', () => {
      if (this.flipping) return
      if (this.oneShot && this.flipped) return
      void this.flip()
        .then(() => options.onClick?.())
        .catch((error: unknown) => {
          console.error('Card action failed:', error)
        })
    })
  }

  get isFlipped(): boolean {
    return this.flipped
  }

  /**
   * Flips a full 180° from whatever face is shown (front/back toggling).
   * Disallowed while a one-shot card is already showing its back.
   */
  async flip(): Promise<void> {
    if (this.flipPromise) return this.flipPromise
    if (this.flipping) return
    if (this.oneShot && this.flipped) return

    const target = this.flipped ? this.front : this.back
    await this.startFlip(target)
  }

  /**
   * Flips back to the front face. Also allowed for one-shot cards when
   * explicitly requested by code (e.g. closing the menu back to a chest).
   */
  async flipToFront(): Promise<void> {
    if (this.flipPromise) return this.flipPromise
    if (this.flipping) return
    if (!this.flipped) return

    await this.startFlip(this.front)
  }

  private async startFlip(target: Sprite): Promise<void> {
    if (this.flipPromise) return this.flipPromise

    this.flipPromise = this.runFlip(target).finally(() => {
      this.flipPromise = null
    })
    await this.flipPromise
  }

  private async runFlip(target: Sprite): Promise<void> {
    this.flipping = true

    const halfMs = this.durationMs / 2

    await new Promise<void>((resolve) => {
      let completed = false
      const finish = (): void => {
        if (completed) return
        completed = true
        this.flipping = false
        resolve()
      }

      this.tweenTo(this.scale, {
        x: 0,
        duration: halfMs / 1000,
        ease: 'power2.in',
        onComplete: () => {
          this.front.visible = target === this.front
          this.back.visible = target === this.back
          this.flipped = target === this.back
          this.eventMode = this.oneShot && this.flipped ? 'none' : 'static'
          this.cursor = this.oneShot && this.flipped ? 'default' : 'pointer'
          this.tweenTo(this.scale, {
            x: 1,
            duration: halfMs / 1000,
            ease: 'power2.out',
            onComplete: finish,
            onInterrupt: finish
          })
        },
        onInterrupt: finish
      })
    })
  }
}
