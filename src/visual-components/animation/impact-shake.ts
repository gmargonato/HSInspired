import type { Container } from 'pixi.js'
import type { AnimationScope } from './animations'
import { IMPACT_SHAKE_LAYOUT as L } from './impact-shake-layout'

/** Impact impulses share a clock and use the strongest active envelope.
 * Pivot offsets leave position-based combat animations free to run concurrently.
 */
export class ImpactShakeController {
  private animation?: gsap.core.Timeline
  private impulses: { start: number; intensity: number }[] = []
  private baseX = 0
  private baseY = 0
  private disposed = false

  constructor(
    private readonly target: Container,
    private readonly animations: Pick<AnimationScope, 'timeline' | 'cancel'>
  ) {}

  trigger(intensity = 1): void {
    if (
      this.disposed ||
      this.target.destroyed ||
      !Number.isFinite(intensity) ||
      intensity <= 0
    )
      return
    if (!this.animation) {
      this.baseX = this.target.pivot.x
      this.baseY = this.target.pivot.y
      const animation = this.animations.timeline({
        onUpdate: () => this.apply(animation.time()),
        onComplete: () => this.finish(animation),
        onInterrupt: () => this.finish(animation)
      })
      this.animation = animation
    }
    const start = this.animation.time()
    this.impulses.push({ start, intensity: Math.min(L.maxIntensity, intensity) })
    this.animation.to(
      { progress: 0 },
      { progress: 1, duration: L.duration, ease: 'none' },
      start
    )
  }

  reset(): void {
    const animation = this.animation
    if (!animation) return
    this.animation = undefined
    this.animations.cancel(animation)
    this.impulses = []
    if (!this.target.destroyed) this.target.pivot.set(this.baseX, this.baseY)
  }

  dispose(): void {
    this.reset()
    this.disposed = true
  }

  private finish(animation: gsap.core.Timeline): void {
    if (this.animation === animation) this.reset()
  }

  private apply(seconds: number): void {
    if (this.target.destroyed) {
      this.reset()
      return
    }
    this.impulses = this.impulses.filter(({ start }) => seconds - start < L.duration)
    const intensity = this.impulses.reduce((max, impulse) => {
      const progress = Math.max(0, (seconds - impulse.start) / L.duration)
      return Math.max(max, impulse.intensity * (1 - progress) ** 2)
    }, 0)
    const amplitude = L.amplitude * intensity
    const phase = (seconds / L.duration) * L.pulses * Math.PI * 2
    this.target.pivot.set(
      this.baseX - Math.sin(phase) * amplitude,
      this.baseY - Math.sin(phase * L.verticalFrequency) * amplitude * L.verticalScale
    )
  }
}
