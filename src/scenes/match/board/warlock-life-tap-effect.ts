import { ColorMatrixFilter, Container, Sprite, type Texture } from 'pixi.js'
import type { AnimationScope } from '../../../visual-components/animation/animations'
import { applyAnchoredPlacement } from '../../../visual-components/layout'
import { WARLOCK_LIFE_TAP as CONFIG } from './warlock-life-tap-layout'

/** A slow inward spiral; outcomes can play alongside it. */
export class WarlockLifeTapEffect extends Container {
  readonly released = Promise.resolve()
  readonly finished: Promise<void>
  private readonly animation: gsap.core.Timeline
  private readonly swirls: readonly {
    sprite: Sprite
    color: ColorMatrixFilter
    red: number
    green: number
    blue: number
  }[]
  private resolveFinished!: () => void
  private settled = false

  constructor(
    textures: { swirl: Texture },
    private readonly animations: Pick<AnimationScope, 'timeline' | 'cancel'>
  ) {
    super()
    this.label = 'game.warlock-life-tap'
    this.eventMode = 'none'
    this.interactiveChildren = false
    this.finished = new Promise((resolve) => {
      this.resolveFinished = resolve
    })

    const vortex = new Container()
    vortex.label = 'game.warlock-vortex'
    vortex.eventMode = 'none'
    this.addChild(vortex)
    this.swirls = Array.from({ length: CONFIG.swirl.count }, (_, index) => {
      const sprite = this.sprite(textures.swirl, `game.warlock-swirl-${index}`)
      // One color pass per swirl converts grayscale brightness to coverage.
      // This removes the opaque black background while allowing genuinely black wisps.
      const tint = CONFIG.swirl.tints[index % CONFIG.swirl.tints.length]
      const color = new ColorMatrixFilter()
      color.resolution = 1
      // Alpha must come from brightness only; the default identity matrix
      // would pass the texture's opaque background straight through.
      color.matrix.fill(0)
      sprite.filters = [color]
      vortex.addChild(sprite)
      return {
        sprite,
        color,
        red: ((tint >> 16) & 255) / 255,
        green: ((tint >> 8) & 255) / 255,
        blue: (tint & 255) / 255
      }
    })
    const clock = { elapsed: 0 }
    const update = (): void => {
      const progress = Math.min(1, clock.elapsed / CONFIG.duration)
      const remaining = 1 - progress
      const diameter =
        CONFIG.swirl.endDiameter +
        (CONFIG.swirl.startDiameter - CONFIG.swirl.endDiameter) * remaining
      const shade = 1 - Math.min(1, progress / CONFIG.swirl.blackAt)
      const opacity =
        1 - Math.max(0, (progress - CONFIG.swirl.fadeAt) / (1 - CONFIG.swirl.fadeAt))
      for (const [index, swirl] of this.swirls.entries()) {
        const matrix = swirl.color.matrix
        matrix[4] = swirl.red * shade
        matrix[9] = swirl.green * shade
        matrix[14] = swirl.blue * shade
        matrix[15] = matrix[16] = matrix[17] = opacity / 3
        swirl.color.matrix = matrix
        swirl.sprite.scale.set(
          (diameter / CONFIG.sprite.size.width) *
            (1 - index * CONFIG.swirl.sizeVariation)
        )
        swirl.sprite.rotation =
          (index * Math.PI) / 2 + clock.elapsed * CONFIG.swirl.rotationSpeed
      }
    }
    update()
    this.animation = animations.timeline({
      onUpdate: update,
      onComplete: () => this.settle(),
      onInterrupt: () => this.settle()
    })
    this.animation.to(clock, {
      elapsed: CONFIG.duration,
      duration: CONFIG.duration,
      ease: 'none'
    })
  }

  dispose(): void {
    if (this.settled) return
    this.animations.cancel(this.animation)
    this.settle()
  }

  private settle(): void {
    if (this.settled) return
    this.settled = true
    this.removeFromParent()
    this.destroy({ children: true })
    for (const swirl of this.swirls) swirl.color.destroy()
    this.resolveFinished()
  }

  private sprite(texture: Texture, label: string): Sprite {
    const sprite = new Sprite(texture)
    sprite.label = label
    sprite.eventMode = 'none'
    sprite.blendMode = 'add'
    applyAnchoredPlacement(sprite, CONFIG.sprite)
    return sprite
  }
}
