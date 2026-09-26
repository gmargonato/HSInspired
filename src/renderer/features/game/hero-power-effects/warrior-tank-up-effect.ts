import { Container, Sprite, type Texture } from 'pixi.js'
import type { AnimationScope } from '../../../animation/animations'
import { applyAnchoredPlacement, type LayoutPlacement } from '../../../rendering/layout'
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
  private burstAnimation: gsap.core.Timeline | null = null
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
      if (this.burstAnimation) this.animations.cancel(this.burstAnimation)
      resolveRelease()
      this.removeFromParent()
      this.destroy({ children: true })
      resolveFinished()
    }

    // Glow elements first so the hammer renders above them; the radial burst
    // is created at contact and intentionally sits on top of everything.
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
        x: CONFIG.contactOffset.x,
        y: CONFIG.contactOffset.y,
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
        this.emitBurst(textures.particle)
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
        x: CONFIG.retreatOffset.x,
        y: CONFIG.retreatOffset.y,
        duration: CONFIG.timing.retreat,
        ease: 'power1.out'
      },
      contactTime + CONFIG.timing.retreatDelay
    )
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

  private emitBurst(particleTexture: Texture): void {
    if (this.settled) return
    this.burstAnimation = this.animations.timeline()
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

  private hammer(texture: Texture): Sprite {
    const sprite = new Sprite(texture)
    sprite.label = 'game.warrior-tank-up.hammer'
    sprite.eventMode = 'none'
    applyAnchoredPlacement(sprite, CONFIG.hammer)
    sprite.position.set(CONFIG.startOffset.x, CONFIG.startOffset.y)
    sprite.rotation = CONFIG.tilt.approachStart
    sprite.alpha = 0
    this.addChild(sprite)
    return sprite
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
