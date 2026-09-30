import { Container, Sprite, type Texture } from 'pixi.js'
import type { AnimationScope } from '../../../visual-components/animation/animations'
import {
  applyAnchoredPlacement,
  type LayoutPlacement,
  type LayoutPoint
} from '../../../visual-components/layout'
import { WARRIOR_TANK_UP as CONFIG } from './warrior-tank-up-layout'

export interface WarriorTankUpTextures {
  readonly hammer: Texture
  readonly particle: Texture
  readonly shockwave: Texture
  readonly flash: Texture
}

/**
 * The golden hammer slides in from the screen right, slams the power (shake,
 * particles, shockwave ring, flash), then retreats while fading away.
 */
export class WarriorTankUpEffect extends Container {
  readonly released: Promise<void>
  readonly finished: Promise<void>
  private readonly animation: gsap.core.Timeline
  private settle: () => void = () => undefined
  private settled = false

  constructor(
    textures: WarriorTankUpTextures,
    private readonly animations: Pick<AnimationScope, 'timeline' | 'cancel'>,
    onRelease: () => void
  ) {
    super()
    this.label = 'game.warrior-tank-up'
    this.eventMode = 'none'
    this.interactiveChildren = false

    let resolveRelease!: () => void
    let resolveFinished!: () => void
    this.released = new Promise((resolve) => {
      resolveRelease = resolve
    })
    this.finished = new Promise((resolve) => {
      resolveFinished = resolve
    })
    this.settle = () => {
      if (this.settled) return
      this.settled = true
      resolveRelease()
      this.removeFromParent()
      this.destroy({ children: true })
      resolveFinished()
    }

    // Glow elements first so the hammer renders above them; the radial burst
    // becomes visible at contact and intentionally sits on top of everything.
    const shockwave = this.glow(
      textures.shockwave,
      CONFIG.shockwave.ring,
      CONFIG.tint,
      'game.warrior-tank-up.shockwave'
    )
    const flash = this.glow(
      textures.flash,
      CONFIG.flash.sprite,
      CONFIG.flash.tint,
      'game.warrior-tank-up.flash'
    )
    const hammer = this.hammer(textures.hammer)

    const contactTime = CONFIG.timing.fadeIn + CONFIG.timing.approach
    this.animation = animations.timeline({
      onComplete: this.settle,
      onInterrupt: this.settle
    })
    this.animation.to(hammer, {
      alpha: 1,
      duration: CONFIG.timing.fadeIn,
      ease: 'none'
    })
    this.animation.to(
      hammer.position,
      {
        ...this.hammerPivot(CONFIG.contactOffset, CONFIG.tilt.approachEnd),
        duration: CONFIG.timing.approach,
        ease: 'power2.in'
      },
      CONFIG.timing.fadeIn
    )
    this.animation.to(
      hammer,
      {
        rotation: CONFIG.tilt.approachEnd,
        duration: CONFIG.timing.approach,
        ease: 'power1.inOut'
      },
      CONFIG.timing.fadeIn
    )
    this.animation.call(
      () => {
        shockwave.visible = true
        flash.visible = true
        onRelease()
        resolveRelease()
      },
      [],
      contactTime
    )
    // The ring ramps up, then expands away while fading to nothing.
    this.animation.to(
      shockwave,
      {
        alpha: CONFIG.shockwave.opacity,
        duration: CONFIG.shockwave.riseIn,
        ease: 'none'
      },
      contactTime
    )
    this.animation.to(
      shockwave,
      {
        alpha: 0,
        duration: Math.max(0.01, CONFIG.shockwave.duration - CONFIG.shockwave.riseIn),
        ease: 'power2.out'
      },
      contactTime + CONFIG.shockwave.riseIn
    )
    this.animation.to(
      shockwave.scale,
      {
        x: CONFIG.shockwave.endDiameter / CONFIG.shockwave.ring.size.width,
        y: CONFIG.shockwave.endDiameter / CONFIG.shockwave.ring.size.width,
        duration: CONFIG.shockwave.duration,
        ease: 'power2.out'
      },
      contactTime
    )
    this.animation.to(
      flash,
      {
        alpha: CONFIG.flash.peakOpacity,
        duration: CONFIG.flash.fadeIn,
        ease: 'power1.out'
      },
      contactTime
    )
    this.animation.to(
      flash,
      {
        alpha: 0,
        duration: CONFIG.flash.fadeOut,
        ease: 'power1.in'
      },
      contactTime + CONFIG.flash.fadeIn
    )
    this.animation.to(
      flash.scale,
      {
        x: CONFIG.flash.endScale,
        y: CONFIG.flash.endScale,
        duration: CONFIG.flash.fadeIn + CONFIG.flash.fadeOut,
        ease: 'power1.out'
      },
      contactTime
    )
    this.animation.to(
      hammer.position,
      {
        ...this.hammerPivot(CONFIG.retreatOffset, CONFIG.tilt.retreatEnd),
        duration: CONFIG.timing.retreat,
        ease: 'power1.out'
      },
      contactTime + CONFIG.timing.retreatDelay
    )
    // Owning the burst on this timeline keeps cleanup after its full fade.
    this.addBurst(textures.particle, contactTime)
    this.animation.to(
      hammer,
      {
        alpha: 0,
        duration: CONFIG.timing.retreat,
        ease: 'power1.out'
      },
      contactTime + CONFIG.timing.retreatDelay
    )
    this.animation.to(
      hammer,
      {
        rotation: CONFIG.tilt.retreatEnd,
        duration: CONFIG.timing.retreat,
        ease: 'power1.inOut'
      },
      contactTime + CONFIG.timing.retreatDelay
    )
  }

  dispose(): void {
    this.animations.cancel(this.animation)
    this.settle()
  }

  private addBurst(particleTexture: Texture, contactTime: number): void {
    const particles: Sprite[] = []
    const color = { tint: CONFIG.burst.startTint as string }
    for (let index = 0; index < CONFIG.burst.count; index++) {
      const alternatingJitter = index % 2 === 0 ? 1 : -1
      const angle =
        (index / CONFIG.burst.count) * Math.PI * 2 +
        alternatingJitter * CONFIG.burst.angleJitter
      const directionX = Math.cos(angle)
      const directionY = Math.sin(angle)
      const particle = new Sprite(particleTexture)
      particle.label = `game.warrior-tank-up-particle-${index}`
      particle.eventMode = 'none'
      particle.tint = color.tint
      particle.blendMode = 'add'
      particle.alpha = CONFIG.burst.opacity
      particle.visible = false
      applyAnchoredPlacement(particle, CONFIG.burst.particle)
      this.addChild(particle)
      particles.push(particle)
      this.animation.set(particle, { visible: true }, contactTime)
      this.animation.to(
        particle,
        {
          x: directionX * CONFIG.burst.travelDistance,
          y: directionY * CONFIG.burst.travelDistance,
          duration: CONFIG.burst.duration,
          ease: 'power1.out'
        },
        contactTime
      )
      this.animation.to(
        particle,
        {
          alpha: 0,
          duration: CONFIG.burst.duration - CONFIG.burst.brightHold,
          ease: 'power1.in'
        },
        contactTime + CONFIG.burst.brightHold
      )
    }
    // GSAP interpolates color strings channel by channel, not packed RGB integers.
    this.animation.to(
      color,
      {
        tint: CONFIG.burst.endTint,
        duration: CONFIG.burst.coolingDuration,
        ease: 'none',
        onUpdate: () => {
          for (const particle of particles) particle.tint = color.tint
        }
      },
      contactTime
    )
  }

  private hammer(texture: Texture): Sprite {
    const sprite = new Sprite(texture)
    sprite.label = 'game.warrior-tank-up.hammer'
    sprite.eventMode = 'none'
    applyAnchoredPlacement(sprite, CONFIG.hammer)
    const start = this.hammerPivot(CONFIG.startOffset, CONFIG.tilt.approachStart)
    sprite.position.set(start.x, start.y)
    sprite.rotation = CONFIG.tilt.approachStart
    sprite.alpha = 0
    this.addChild(sprite)
    return sprite
  }

  /** Position the bottom pivot so the rotated head lands at the authored offset. */
  private hammerPivot(head: LayoutPoint, rotation: number): LayoutPoint {
    const { anchor, size, scale } = CONFIG.hammer
    const x = (CONFIG.headPoint.x - anchor.x) * size.width * (scale?.x ?? 1)
    const y = (CONFIG.headPoint.y - anchor.y) * size.height * (scale?.y ?? 1)
    return {
      x: head.x - (x * Math.cos(rotation) - y * Math.sin(rotation)),
      y: head.y - (x * Math.sin(rotation) + y * Math.cos(rotation))
    }
  }

  /** Adds an additive, tinted glow sprite hidden until the impact fires it. */
  private glow(
    texture: Texture,
    layout: LayoutPlacement,
    tint: number,
    label: string
  ): Sprite {
    const sprite = new Sprite(texture)
    sprite.label = label
    sprite.eventMode = 'none'
    sprite.tint = tint
    sprite.blendMode = 'add'
    applyAnchoredPlacement(sprite, layout)
    sprite.visible = false
    sprite.alpha = 0
    this.addChild(sprite)
    return sprite
  }
}
