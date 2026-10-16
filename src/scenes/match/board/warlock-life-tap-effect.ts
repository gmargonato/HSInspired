import { Container, Sprite, type Texture } from 'pixi.js'
import type { AnimationScope } from '../../../visual-components/animation/animations'
import { applyAnchoredPlacement } from '../../../visual-components/layout'
import { WARLOCK_LIFE_TAP as CONFIG } from './warlock-life-tap-layout'
import { createWarlockTapFilter } from './warlock-tap-filter'

interface TapTextures {
  wispLarge: Texture
  wispSmall: Texture
  soft: Texture
  bright: Texture
  ramp: Texture
}

/** Shared inward vortex; gameplay outcomes run alongside its visual tail. */
export class WarlockLifeTapEffect extends Container {
  readonly released = Promise.resolve()
  readonly finished: Promise<void>
  private readonly animation: gsap.core.Timeline
  private readonly rampFilter: ReturnType<typeof createWarlockTapFilter>
  private resolveFinished!: () => void
  private settled = false
  private readonly body = new Container()
  private readonly accents = new Container()

  constructor(
    textures: TapTextures,
    private readonly animations: Pick<AnimationScope, 'timeline' | 'cancel'>
  ) {
    super()
    this.label = 'game.warlock-life-tap'
    this.eventMode = 'none'
    this.interactiveChildren = false
    this.finished = new Promise((resolve) => {
      this.resolveFinished = resolve
    })
    this.rampFilter = createWarlockTapFilter(textures.ramp)
    this.body.label = 'game.warlock-tap-body'
    this.accents.label = 'game.warlock-tap-accents'
    this.body.filters = [this.rampFilter]
    this.addChild(this.body, this.accents)
    this.animation = animations.timeline({
      onComplete: () => this.settle(),
      onInterrupt: () => this.settle()
    })

    for (let index = 0; index < CONFIG.coreLayers.count; index++) {
      const core = this.sprite(textures.soft, `core-${index}`, CONFIG.coreTint)
      applyAnchoredPlacement(core, CONFIG.core)
      const angle = (index * Math.PI * 2) / CONFIG.coreLayers.count
      core.position.set(
        Math.cos(angle) * CONFIG.coreLayers.radius,
        Math.sin(angle) * CONFIG.coreLayers.radius
      )
      this.envelope(core, 0, CONFIG.duration, CONFIG.coreLayers.opacity)
      this.animation.to(
        core.scale,
        {
          x: 0,
          y: 0,
          duration: CONFIG.duration - CONFIG.collapseDelay,
          ease: 'power2.in'
        },
        CONFIG.collapseDelay
      )
      this.animation.to(
        core.position,
        { x: 0, y: 0, duration: CONFIG.duration, ease: 'power1.in' },
        0
      )
    }

    for (const [index, layer] of CONFIG.wisps.entries()) {
      const wisp = this.sprite(
        layer.small ? textures.wispSmall : textures.wispLarge,
        `wisp-${index}`,
        CONFIG.wispTint
      )
      wisp.blendMode = 'add'
      applyAnchoredPlacement(wisp, CONFIG.wisp)
      wisp.scale.set(wisp.scale.x * layer.scale)
      wisp.rotation = layer.angle * Math.PI * 2
      this.envelope(wisp, layer.delay, layer.life, layer.opacity)
      this.animation.to(
        wisp.scale,
        { x: 0, y: 0, duration: layer.life - CONFIG.collapseDelay, ease: 'power2.in' },
        layer.delay + CONFIG.collapseDelay
      )
      this.animation.to(
        wisp,
        {
          rotation: wisp.rotation + CONFIG.rotationTurns * Math.PI * 2,
          duration: layer.life,
          ease: 'none'
        },
        layer.delay
      )
    }

    const m = CONFIG.motes
    for (let index = 0; index < m.count; index++) {
      const bright = index % 3 === 0
      const mote = this.sprite(
        bright ? textures.bright : textures.soft,
        `mote-${index}`,
        bright ? 0xffc1f2 : CONFIG.wispTint,
        bright
      )
      mote.blendMode = bright ? 'add' : 'normal'
      const variation = ((index * 17) % m.count) / m.count
      const radius = m.radius * (0.65 + variation * 0.35)
      const angle = index * 2.39996323
      const size = m.size * (bright ? 0.45 : 1) * (0.7 + variation * 0.6)
      mote.scale.set(size / mote.texture.width)
      const state = { progress: 0 }
      const update = (): void => {
        const r = radius * (1 - state.progress) + m.innerRadius * state.progress
        const a = angle + m.turns * Math.PI * 2 * state.progress
        mote.position.set(Math.cos(a) * r, Math.sin(a) * r)
      }
      update()
      const delay = variation * m.stagger
      this.envelope(mote, delay, m.life, bright ? 1 : 0.7)
      this.animation.to(
        state,
        { progress: 1, duration: m.life, ease: 'none', onUpdate: update },
        delay
      )
      this.animation.to(
        mote.scale,
        { x: 0, y: 0, duration: m.life, ease: 'power1.in' },
        delay
      )
    }
  }

  private sprite(texture: Texture, name: string, tint: number, accent = false): Sprite {
    const sprite = new Sprite(texture)
    sprite.label = `game.warlock-tap-${name}`
    sprite.eventMode = 'none'
    sprite.anchor.set(0.5)
    sprite.tint = tint
    sprite.alpha = 0
    ;(accent ? this.accents : this.body).addChild(sprite)
    return sprite
  }

  private envelope(sprite: Sprite, delay: number, life: number, opacity: number): void {
    this.animation.to(
      sprite,
      { alpha: opacity, duration: CONFIG.fadeIn, ease: 'sine.out' },
      delay
    )
    this.animation.to(
      sprite,
      { alpha: 0, duration: life - CONFIG.fadeIn - CONFIG.peakHold, ease: 'sine.in' },
      delay + CONFIG.fadeIn + CONFIG.peakHold
    )
  }

  dispose(): void {
    if (this.settled) return
    this.animations.cancel(this.animation)
    this.settle()
  }

  private settle(): void {
    if (this.settled) return
    this.settled = true
    this.body.filters = []
    this.rampFilter.destroy()
    this.removeFromParent()
    this.destroy({ children: true })
    this.resolveFinished()
  }
}
