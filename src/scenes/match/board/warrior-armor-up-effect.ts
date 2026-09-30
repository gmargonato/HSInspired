import { Container, Sprite, type Texture } from 'pixi.js'
import type { AnimationScope } from '../../../visual-components/animation/animations'
import { applyAnchoredPlacement } from '../../../visual-components/layout'
import { WARRIOR_ARMOR_UP as CONFIG } from './warrior-armor-up-layout'

export interface WarriorArmorUpTextures {
  readonly swirl: Texture
  readonly rays: readonly [Texture, Texture, Texture]
}

/** Brightness comes only from overlapping aura sprites; no separate flash. */
export class WarriorArmorUpEffect extends Container {
  readonly released: Promise<void>
  readonly finished: Promise<void>
  private readonly animation: gsap.core.Timeline
  private settle: () => void = () => undefined

  constructor(
    textures: WarriorArmorUpTextures,
    private readonly animations: Pick<AnimationScope, 'timeline' | 'cancel'>,
    onRelease: () => void
  ) {
    super()
    this.label = 'game.warrior-armor-up'
    this.eventMode = 'none'
    this.interactiveChildren = false
    const swirl = Array.from({ length: CONFIG.swirl.count }, (_, index) =>
      this.aura(textures.swirl, `game.warrior-swirl-${index}`)
    )
    const rays = Array.from({ length: CONFIG.rays.count }, (_, index) =>
      this.aura(
        textures.rays[index % textures.rays.length],
        `game.warrior-rays-${index}`
      )
    )
    const motion = {
      diameter: CONFIG.swirl.startDiameter as number,
      orbit: CONFIG.swirl.startOrbit as number,
      opacity: CONFIG.swirl.startOpacity as number,
      elapsed: 0
    }
    let released = false
    let settled = false
    let resolveRelease!: () => void
    let resolveFinished!: () => void
    this.released = new Promise((resolve) => {
      resolveRelease = resolve
    })
    this.finished = new Promise((resolve) => {
      resolveFinished = resolve
    })
    this.settle = () => {
      if (settled) return
      settled = true
      resolveRelease()
      this.removeFromParent()
      this.destroy({ children: true })
      resolveFinished()
    }
    const update = (): void => {
      const rotation = motion.elapsed * CONFIG.swirl.rotationSpeed
      for (const [index, sprite] of swirl.entries()) {
        const angle = (index / swirl.length) * Math.PI * 2 + rotation
        const variation = 1 - (index % 3) * CONFIG.swirl.sizeVariation
        const orbit = motion.orbit * (0.5 + (index % 3) * 0.25)
        sprite.position.set(Math.cos(angle) * orbit, Math.sin(angle) * orbit)
        sprite.scale.set((motion.diameter / CONFIG.aura.size.width) * variation)
        sprite.rotation = angle + (index % 2) * rotation * 0.25
        sprite.alpha = motion.opacity
      }
      for (const [index, sprite] of rays.entries()) {
        const age =
          motion.elapsed - CONFIG.timing.concentrate - index * CONFIG.rays.stagger
        const duration = CONFIG.timing.release - index * CONFIG.rays.stagger
        const progress = Math.max(0, Math.min(1, age / duration))
        const expansion = 1 - (1 - progress) ** 2
        const diameter =
          CONFIG.rays.startDiameter +
          (CONFIG.rays.endDiameter - CONFIG.rays.startDiameter) * expansion
        sprite.visible = released && age > 0 && progress < 1
        sprite.scale.set(diameter / CONFIG.aura.size.width)
        sprite.rotation =
          (index / rays.length) * Math.PI * 2 + progress * CONFIG.rays.rotation
        sprite.alpha = Math.sin(Math.PI * progress) * CONFIG.rays.opacity
      }
    }
    update()
    this.animation = animations.timeline({
      onUpdate: update,
      onComplete: this.settle,
      onInterrupt: this.settle
    })
    const duration = CONFIG.timing.concentrate + CONFIG.timing.release
    // A separate linear clock keeps the spin and ray staggering moving through impact.
    this.animation.to(
      motion,
      {
        elapsed: duration,
        duration,
        ease: 'none'
      },
      0
    )
    // Start visible at the authored diameter and contract without an intermediate stop.
    this.animation.to(
      motion,
      {
        diameter: CONFIG.swirl.concentratedDiameter,
        orbit: CONFIG.swirl.concentratedOrbit,
        opacity: CONFIG.swirl.concentratedOpacity,
        duration: CONFIG.timing.concentrate,
        ease: 'none'
      },
      0
    )
    this.animation.call(
      () => {
        released = true
        onRelease()
        resolveRelease()
      },
      [],
      CONFIG.timing.concentrate
    )
    this.animation.to(
      motion,
      {
        diameter: CONFIG.swirl.releasedDiameter,
        orbit: CONFIG.swirl.releasedOrbit,
        opacity: 0,
        duration: CONFIG.timing.release,
        ease: 'power1.out'
      },
      CONFIG.timing.concentrate
    )
  }

  dispose(): void {
    this.animations.cancel(this.animation)
    // Also settles a timeline canceled before its first rendered frame.
    this.settle()
  }

  private aura(texture: Texture, label: string): Sprite {
    const sprite = new Sprite(texture)
    sprite.label = label
    sprite.eventMode = 'none'
    sprite.blendMode = 'add'
    sprite.tint = CONFIG.tint
    applyAnchoredPlacement(sprite, CONFIG.aura)
    this.addChild(sprite)
    return sprite
  }
}
