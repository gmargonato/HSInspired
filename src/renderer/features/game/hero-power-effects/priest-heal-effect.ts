import { Container, Sprite, type Texture } from 'pixi.js'
import type { AnimationScope } from '../../../animation/animations'
import { applyAnchoredPlacement } from '../../../rendering/layout'
import { PRIEST_HEAL as CONFIG } from './priest-heal-layout'

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

function lcm(a: number, b: number): number {
  return (a * b) / gcd(a, b)
}

/** Sunlight builds once, then keeps moving until the targeting interaction ends. */
export class PriestHealEffect extends Container {
  readonly released: Promise<void>
  readonly finished: Promise<void>
  private readonly motion: gsap.core.Timeline
  private resolveRelease!: () => void
  private resolveFinished!: () => void
  private settled = false
  private releaseAt: number | null = null

  constructor(
    textures: { spotlight: Texture; aura: Texture },
    private readonly animations: Pick<AnimationScope, 'timeline' | 'cancel'>
  ) {
    super()
    this.label = 'game.priest-heal'
    this.eventMode = 'none'
    this.interactiveChildren = false
    this.released = new Promise((resolve) => {
      this.resolveRelease = resolve
    })
    this.finished = new Promise((resolve) => {
      this.resolveFinished = resolve
    })
    const spotlights = Array.from({ length: CONFIG.spotlight.stack }, (_, index) =>
      this.sprite(textures.spotlight, `game.priest-sunlight-${index}`)
    )
    const auras = Array.from({ length: CONFIG.aura.count }, (_, index) =>
      this.sprite(textures.aura, `game.priest-aura-${index}`)
    )
    const clock = { elapsed: 0 }
    const update = (): void => {
      const elapsed = this.motion?.totalTime() ?? 0
      const build = Math.min(1, elapsed / CONFIG.timing.brighten)
      const releaseAge = this.releaseAt === null ? 0 : elapsed - this.releaseAt
      const growth = 1 - (1 - Math.min(1, releaseAge / CONFIG.timing.grow)) ** 2
      const reveal = Math.min(1, releaseAge / CONFIG.timing.grow)
      const size = 1 + growth * (CONFIG.confirmation.scale - 1)
      const fade = Math.max(
        0,
        Math.min(1, (releaseAge - CONFIG.timing.grow) / CONFIG.timing.fade)
      )
      this.alpha =
        ((CONFIG.startOpacity +
          (1 - CONFIG.startOpacity) * Math.sin((build * Math.PI) / 2)) *
          (1 + Math.cos(fade * Math.PI))) /
        2
      if (fade >= 1) {
        this.settle()
        return
      }
      const phase = (clock.elapsed / CONFIG.aura.period) * Math.PI * 2
      const rotation = (clock.elapsed / CONFIG.timing.cycle) * Math.PI * 2
      const spotlightRotation =
        (clock.elapsed / CONFIG.timing.spotlightRotation) * Math.PI * 2
      const spotlightScale =
        (CONFIG.spotlight.diameter / CONFIG.sprite.size.width) *
        size *
        (1 + Math.sin(phase) * CONFIG.spotlight.pulse)
      for (const spotlight of spotlights) {
        spotlight.rotation = spotlightRotation
        spotlight.scale.set(spotlightScale)
        spotlight.alpha = CONFIG.spotlight.opacity
      }
      for (const [index, aura] of auras.entries()) {
        const offset = (index / auras.length) * Math.PI * 2
        aura.rotation = offset + rotation * (index % 2 ? -1 : 1)
        aura.scale.set(
          (CONFIG.aura.diameter / CONFIG.sprite.size.width) *
            size *
            reveal *
            (1 + Math.sin(phase + offset) * CONFIG.aura.pulse)
        )
        aura.alpha = CONFIG.confirmation.auraOpacity * reveal
      }
    }
    this.alpha = CONFIG.startOpacity
    update()
    this.motion = animations.timeline({
      repeat: -1,
      onUpdate: update,
      onInterrupt: () => this.settle()
    })
    const loop = lcm(CONFIG.timing.cycle, CONFIG.timing.spotlightRotation)
    this.motion.to(clock, {
      elapsed: loop,
      duration: loop,
      ease: 'none'
    })
  }

  /** After the flip, grow and intensify the sunlight before fading it completely. */
  release(): void {
    if (this.settled || this.releaseAt !== null) return
    this.releaseAt = this.motion.totalTime()
    this.resolveRelease()
  }

  dispose(): void {
    this.settle()
  }

  private settle(): void {
    if (this.settled) return
    this.settled = true
    this.animations.cancel(this.motion)
    this.resolveRelease()
    this.removeFromParent()
    this.destroy({ children: true })
    this.resolveFinished()
  }

  private sprite(texture: Texture, label: string): Sprite {
    const sprite = new Sprite(texture)
    sprite.label = label
    sprite.eventMode = 'none'
    sprite.blendMode = 'add'
    sprite.tint = CONFIG.tint
    applyAnchoredPlacement(sprite, CONFIG.sprite)
    this.addChild(sprite)
    return sprite
  }
}
