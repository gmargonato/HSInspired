import { Container, Sprite, type Texture } from 'pixi.js'
import type { AnimationScope } from '../../../visual-components/animation/animations'
import { applyAnchoredPlacement } from '../../../visual-components/layout'
import { SHAMAN_TOTEM as CONFIG } from './shaman-totem-layout'

/** Shows the totem artwork over the power while the summon resolves. */
export class ShamanTotemEffect extends Container {
  readonly released = Promise.resolve()
  readonly finished: Promise<void>
  private readonly animation: gsap.core.Timeline
  private burstAnimation: gsap.core.Timeline | null = null
  private resolveFinished!: () => void
  private settled = false

  constructor(
    textures: { readonly artwork: Texture; readonly spotlight: Texture },
    private readonly animations: Pick<AnimationScope, 'timeline' | 'cancel'>
  ) {
    super()
    this.label = 'game.shaman-totem'
    this.eventMode = 'none'
    this.interactiveChildren = false
    this.finished = new Promise((resolve) => {
      this.resolveFinished = resolve
    })

    const artwork = new Sprite(textures.artwork)
    artwork.label = 'game.shaman-totem.artwork'
    artwork.eventMode = 'none'
    applyAnchoredPlacement(artwork, CONFIG.artwork)
    this.addChild(artwork)

    this.animation = animations.timeline({
      onComplete: () => this.settle(),
      onInterrupt: () => this.settle()
    })
    this.animation.to(artwork, {
      alpha: 0,
      duration: CONFIG.fadeDuration,
      ease: 'none'
    })
    this.animation.call(
      () => this.emitBurst(textures.spotlight),
      [],
      CONFIG.burst.delay
    )
  }

  dispose(): void {
    if (this.settled) return
    this.animations.cancel(this.animation)
    this.settle()
  }

  private emitBurst(texture: Texture): void {
    if (this.settled) return
    this.burstAnimation = this.animations.timeline()
    for (let index = 0; index < CONFIG.burst.count; index++) {
      const alternatingJitter = index % 2 === 0 ? 1 : -1
      const angle =
        (index / CONFIG.burst.count) * Math.PI * 2 +
        alternatingJitter * CONFIG.burst.angleJitter
      const directionX = Math.cos(angle)
      const directionY = Math.sin(angle)
      const particle = new Sprite(texture)
      particle.label = `game.shaman-totem-particle-${index}`
      particle.eventMode = 'none'
      particle.tint = CONFIG.burst.tint
      particle.blendMode = 'add'
      particle.alpha = CONFIG.burst.opacity
      applyAnchoredPlacement(particle, CONFIG.burst.particle)
      this.addChild(particle)
      this.burstAnimation.to(
        particle,
        {
          x: directionX * CONFIG.burst.travelDistance,
          y: directionY * CONFIG.burst.travelDistance,
          alpha: 0,
          duration: CONFIG.burst.duration,
          ease: 'power1.out'
        },
        0
      )
    }
  }

  private settle(): void {
    if (this.settled) return
    this.settled = true
    if (this.burstAnimation) this.animations.cancel(this.burstAnimation)
    this.removeFromParent()
    this.destroy({ children: true })
    this.resolveFinished()
  }
}
