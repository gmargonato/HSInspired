import { Container, Sprite, type Texture } from 'pixi.js'
import { Actor } from '../../ui/components/actor'
import { GHOST_AURA_CONFIG } from './outline-tuning'
import { createGhostMistFilter, type GhostMistValues } from './ghost-mist-filter'
import { createMistParticles } from './ghost-mist-particles'
import type {
  GhostAuraTuning,
  GhostAuraPalette
} from '../../../shared/ipc/outline-tuning'

export interface GhostAuraOptions {
  readonly noise: Texture
  readonly dissolve: Texture
  readonly spotlight: Texture
  /** Artwork silhouette; the filtered target may also contain a button label. */
  readonly silhouette?: Sprite
}
export const GHOST_DISAPPEARANCE_SECONDS = 1.8

/** Owns the live mist, foreground particles and interruptible disappearance. */
export class GhostAura extends Actor {
  private static readonly instances = new Set<GhostAura>()
  private static suppressed = false
  static setDebugSuppressed(suppressed: boolean): void {
    if (!import.meta.env.DEV) return
    this.suppressed = suppressed
    for (const effect of this.instances) effect.syncVisibility()
  }

  private readonly values: GhostMistValues = {
    ...GHOST_AURA_CONFIG.tuning,
    ...GHOST_AURA_CONFIG.palette,
    progress: 0
  }
  private readonly mist: ReturnType<typeof createGhostMistFilter>
  private readonly particles: ReturnType<typeof createMistParticles>
  private readonly clock = { time: 0 }
  private lastTime = 0
  private enabled = true
  private exit: {
    parent: Container
    index: number
    layer: Container
    x: number
    y: number
    scaleX: number
    scaleY: number
    skewX: number
    skewY: number
    rotation: number
    alpha: number
    eventMode: Container['eventMode']
    interactiveChildren: Container['interactiveChildren']
  } | null = null
  private disappearing = false
  private disappearance: gsap.core.Tween | null = null
  private timeTween: gsap.core.Tween

  constructor(
    private readonly target: Container,
    options: GhostAuraOptions
  ) {
    super()
    const silhouette = options.silhouette ?? (target instanceof Sprite ? target : null)
    if (!silhouette) throw new Error('Ghost Mist requires a sprite silhouette')
    this.label = 'ghost-mist.effect'
    this.mist = createGhostMistFilter(options.noise, options.dissolve, this.values)
    this.particles = createMistParticles(silhouette, this.values, options.spotlight)
    this.particles.refresh()
    target.filters = [...(target.filters ?? []), this.mist.filter]
    this.timeTween = this.tweenTo(this.clock, {
      time: 1,
      duration: 1,
      repeat: -1,
      ease: 'none',
      onUpdate: () => {
        const time = this.timeTween.totalTime()
        const delta = Math.max(0, time - this.lastTime)
        this.lastTime = time
        if (!this.syncVisibility()) return
        this.mist.update(delta)
        this.particles.refresh()
        this.particles.update(time)
      }
    })
    GhostAura.instances.add(this)
    this.syncVisibility()
  }

  setEnabled(enabled: boolean): void {
    if (this.destroyed) return
    if (enabled) this.restore()
    else {
      this.cancelDisappearance()
      this.enabled = false
      this.target.visible = false
      this.timeTween.pause()
      this.syncVisibility()
    }
  }
  isEnabled(): boolean {
    return this.enabled
  }
  getPadding(): number {
    return this.mist.filter.padding
  }
  setTuning(tuning: GhostAuraTuning): void {
    Object.assign(this.values, tuning)
    this.mist.sync()
    this.syncVisibility()
  }
  setPalette(palette: GhostAuraPalette): void {
    Object.assign(this.values, palette)
    this.mist.sync()
  }

  restore(): void {
    if (this.destroyed) return
    this.cancelDisappearance()
    this.enabled = true
    this.values.progress = 0
    this.target.visible = true
    this.mist.sync()
    this.timeTween.resume()
    this.syncVisibility()
  }

  /** Move only the outgoing visual out of a closing overlay; never delay game logic. */
  disappear(exitParent: Container | null = this.target.parent): void {
    if (this.destroyed || this.disappearing || !this.enabled || !this.target.visible)
      return
    const parent = this.target.parent
    if (!parent || !exitParent || exitParent.destroyed) {
      this.setEnabled(false)
      return
    }
    const layer = new Container()
    layer.label = 'ghost-mist.disappearance'
    layer.eventMode = 'none'
    layer.interactiveChildren = false
    layer.zIndex = 20000
    this.exit = {
      parent,
      index: parent.getChildIndex(this.target),
      layer,
      x: this.target.x,
      y: this.target.y,
      scaleX: this.target.scale.x,
      scaleY: this.target.scale.y,
      skewX: this.target.skew.x,
      skewY: this.target.skew.y,
      rotation: this.target.rotation,
      alpha: this.target.alpha,
      eventMode: this.target.eventMode,
      interactiveChildren: this.target.interactiveChildren
    }
    const alpha = this.target.getGlobalAlpha()
    const transform = this.target.getGlobalTransform()
    exitParent.addChild(layer)
    transform.prepend(layer.getGlobalTransform().invert())
    layer.addChild(this.target)
    this.target.setFromMatrix(transform)
    this.target.position.x +=
      this.target.pivot.x * transform.a + this.target.pivot.y * transform.c
    this.target.position.y +=
      this.target.pivot.x * transform.b + this.target.pivot.y * transform.d
    this.target.alpha = alpha / (layer.getGlobalAlpha() || 1)
    this.target.eventMode = 'none'
    this.target.interactiveChildren = false
    this.disappearing = true
    this.values.progress = 0
    this.syncVisibility()
    this.disappearance = this.tweenTo(this.values, {
      progress: 1,
      duration: GHOST_DISAPPEARANCE_SECONDS,
      ease: 'none',
      onUpdate: () => this.mist.sync(),
      onComplete: () => {
        this.disappearance = null
        this.returnToParent()
        this.disappearing = false
        this.enabled = false
        this.target.visible = false
        this.timeTween.pause()
        this.syncVisibility()
      }
    })
  }

  private cancelDisappearance(): void {
    this.disappearance?.kill()
    this.disappearance = null
    this.returnToParent()
    this.disappearing = false
  }
  private returnToParent(): void {
    const exit = this.exit
    if (!exit) return
    this.exit = null
    this.particles.container.removeFromParent()
    if (!this.target.destroyed) {
      if (!exit.parent.destroyed)
        exit.parent.addChildAt(
          this.target,
          Math.min(exit.index, exit.parent.children.length)
        )
      else this.target.removeFromParent()
      this.target.position.set(exit.x, exit.y)
      this.target.scale.set(exit.scaleX, exit.scaleY)
      this.target.skew.set(exit.skewX, exit.skewY)
      this.target.rotation = exit.rotation
      this.target.alpha = exit.alpha
      this.target.eventMode = exit.eventMode
      this.target.interactiveChildren = exit.interactiveChildren
    }
    exit.layer.destroy({ children: true })
  }
  private syncVisibility(): boolean {
    const particles = this.particles.container
    if (this.target.destroyed) {
      particles.visible = false
      return false
    }
    const parent = this.target.parent
    if (parent && particles.parent !== parent) parent.addChild(particles)
    let visible = this.enabled && !GhostAura.suppressed
    for (let node: Container | null = this.target; node; node = node.parent)
      visible &&= node.visible && node.renderable && node.alpha > 0
    particles.visible = visible && this.values.particlesEnabled
    particles.alpha = parent
      ? this.target.getGlobalAlpha() / (parent.getGlobalAlpha() || 1)
      : 0
    particles.zIndex = this.target.zIndex
    this.mist.filter.enabled = !GhostAura.suppressed
    return visible
  }
  override dispose(): void {
    if (this.destroyed) return
    this.cancelDisappearance()
    GhostAura.instances.delete(this)
    if (!this.target.destroyed)
      this.target.filters = (this.target.filters ?? []).filter(
        (filter) => filter !== this.mist.filter
      )
    this.particles.destroy()
    this.mist.destroy()
    super.dispose()
  }
}
