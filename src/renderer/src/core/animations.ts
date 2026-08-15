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

export function createAnimations(): Animations {
  return {
    to(target, vars) {
      return gsap.to(target, vars)
    },
    from(target, vars) {
      return gsap.from(target, vars)
    },
    fromTo(target, fromVars, toVars) {
      return gsap.fromTo(target, fromVars, toVars)
    },
    timeline(vars) {
      return gsap.timeline(vars)
    },
    set(target, vars) {
      return gsap.set(target, vars)
    }
  }
}