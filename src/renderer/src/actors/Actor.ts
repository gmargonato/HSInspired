import { Container } from 'pixi.js'
import { gsap } from 'gsap'

export abstract class Actor extends Container {
  private readonly tweens: gsap.core.Animation[] = []

  protected tweenTo(
    target: gsap.TweenTarget,
    vars: gsap.TweenVars
  ): gsap.core.Tween {
    const tween = gsap.to(target, vars)
    this.tweens.push(tween)
    return tween
  }

  protected tweenFromTo(
    target: gsap.TweenTarget,
    fromVars: gsap.TweenVars,
    toVars: gsap.TweenVars
  ): gsap.core.Tween {
    const tween = gsap.fromTo(target, fromVars, toVars)
    this.tweens.push(tween)
    return tween
  }

  protected timeline(vars?: gsap.TimelineVars): gsap.core.Timeline {
    const timeline = gsap.timeline(vars)
    this.tweens.push(timeline)
    return timeline
  }

  killTweens(): void {
    for (const tween of this.tweens) {
      tween.kill()
    }
    this.tweens.length = 0
  }

  dispose(): void {
    this.killTweens()
    this.destroy({ children: true })
  }
}