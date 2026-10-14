import { Container, Sprite, type Texture } from 'pixi.js'
import type { AnimationScope } from '../../../visual-components/animation/animations'
import { applyAnchoredPlacement } from '../../../visual-components/layout'
import { WARLOCK_LIFE_TAP as CONFIG } from './warlock-life-tap-layout'

/** Layered swirls rotate through a quick reveal, then shrink while outcomes play. */
export class WarlockLifeTapEffect extends Container {
  readonly released = Promise.resolve()
  readonly finished: Promise<void>
  private readonly animation: gsap.core.Timeline
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

    this.animation = animations.timeline({
      onComplete: () => this.settle(),
      onInterrupt: () => this.settle()
    })
    const duration = CONFIG.revealDuration + CONFIG.shrinkDuration
    for (const [index, layer] of CONFIG.layers.entries()) {
      const swirl = new Sprite(textures.swirl)
      swirl.label = `game.warlock-swirl-${index}`
      swirl.eventMode = 'none'
      swirl.tint = layer.tint
      swirl.alpha = 0
      swirl.blendMode = layer.blendMode
      applyAnchoredPlacement(swirl, CONFIG.sprite)
      swirl.scale.set(swirl.scale.x * layer.scale, swirl.scale.y * layer.scale)
      swirl.rotation = layer.startRotationTurns * Math.PI * 2
      this.addChild(swirl)

      this.animation
        .to(
          swirl,
          { alpha: layer.opacity, duration: CONFIG.revealDuration, ease: 'power2.out' },
          0
        )
        .to(
          swirl.scale,
          { x: 0, y: 0, duration: CONFIG.shrinkDuration, ease: 'none' },
          CONFIG.revealDuration
        )
        .to(
          swirl,
          {
            rotation: swirl.rotation + CONFIG.rotationTurns * Math.PI * 2,
            duration,
            ease: 'none'
          },
          0
        )
    }
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
    this.resolveFinished()
  }
}
