import { Container } from 'pixi.js'
import { AnimationScope } from '../animation/animations'

export abstract class Actor extends Container {
  protected readonly animationScope = new AnimationScope()

  protected tweenTo(target: gsap.TweenTarget, vars: gsap.TweenVars): gsap.core.Tween {
    return this.animationScope.to(target, vars)
  }

  protected tweenFromTo(
    target: gsap.TweenTarget,
    fromVars: gsap.TweenVars,
    toVars: gsap.TweenVars
  ): gsap.core.Tween {
    return this.animationScope.fromTo(target, fromVars, toVars)
  }

  protected timeline(vars?: gsap.TimelineVars): gsap.core.Timeline {
    return this.animationScope.timeline(vars)
  }

  protected killTweensOf(target: gsap.TweenTarget): void {
    this.animationScope.kill(target)
  }

  pauseAnimations(): void {
    this.animationScope.pause()
  }

  resumeAnimations(): void {
    this.animationScope.resume()
  }

  killAnimations(): void {
    this.animationScope.kill()
  }

  killTweens(): void {
    this.killAnimations()
  }

  dispose(): void {
    this.killAnimations()
    this.destroy({ children: true })
  }
}
