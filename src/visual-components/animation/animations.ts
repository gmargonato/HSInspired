import { gsap } from 'gsap'

gsap.config({ nullTargetWarn: false })

export { gsap }

export interface Animations {
  to(target: gsap.TweenTarget, vars: gsap.TweenVars): gsap.core.Tween
  from(target: gsap.TweenTarget, vars: gsap.TweenVars): gsap.core.Tween
  fromTo(
    target: gsap.TweenTarget,
    fromVars: gsap.TweenVars,
    toVars: gsap.TweenVars
  ): gsap.core.Tween
  timeline(vars?: gsap.TimelineVars): gsap.core.Timeline
  set(target: gsap.TweenTarget, vars: gsap.TweenVars): gsap.core.Tween
}

type TrackedAnimation = {
  animation: gsap.core.Animation
  target?: gsap.TweenTarget
}

/**
 * Owns GSAP animations for one scene or actor. It tracks arbitrary targets,
 * including plain state objects used by filters, so lifecycle cleanup does
 * not depend on a display object being present in the scene graph.
 */
export class AnimationScope implements Animations {
  private readonly tracked = new Set<TrackedAnimation>()
  private paused = false

  to(target: gsap.TweenTarget, vars: gsap.TweenVars): gsap.core.Tween {
    return this.track(gsap.to(target, vars), target)
  }

  from(target: gsap.TweenTarget, vars: gsap.TweenVars): gsap.core.Tween {
    return this.track(gsap.from(target, vars), target)
  }

  fromTo(
    target: gsap.TweenTarget,
    fromVars: gsap.TweenVars,
    toVars: gsap.TweenVars
  ): gsap.core.Tween {
    return this.track(gsap.fromTo(target, fromVars, toVars), target)
  }

  timeline(vars?: gsap.TimelineVars): gsap.core.Timeline {
    return this.track(gsap.timeline(vars))
  }

  set(target: gsap.TweenTarget, vars: gsap.TweenVars): gsap.core.Tween {
    return this.track(gsap.set(target, vars), target)
  }

  pause(): void {
    this.paused = true
    this.prune()
    for (const { animation } of this.tracked) {
      animation.pause()
    }
  }

  resume(): void {
    this.paused = false
    this.prune()
    for (const { animation } of this.tracked) {
      if (animation.paused()) animation.resume()
    }
  }

  kill(target?: gsap.TweenTarget): void {
    for (const item of [...this.tracked]) {
      if (target !== undefined && item.target !== target) continue

      item.animation.kill()
      this.tracked.delete(item)
    }

    if (target === undefined) this.paused = false
  }

  /** Cancels one owned timeline/tween and releases its tracked targets immediately. */
  cancel(animation: gsap.core.Animation): void {
    for (const item of this.tracked) {
      if (item.animation !== animation) continue
      item.animation.kill()
      this.tracked.delete(item)
      return
    }
  }

  private track<T extends gsap.core.Animation>(
    animation: T,
    target?: gsap.TweenTarget
  ): T {
    this.prune()
    const item = { animation, target }
    this.tracked.add(item)
    if (this.paused) animation.pause()
    return animation
  }

  private prune(): void {
    for (const item of this.tracked) {
      if (!item.animation.isActive() && item.animation.progress() >= 1) {
        this.tracked.delete(item)
      }
    }
  }
}
