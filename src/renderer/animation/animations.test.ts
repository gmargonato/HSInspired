import { describe, expect, it } from 'vitest'
import { gsap, AnimationScope } from './animations'

describe('AnimationScope', () => {
  it('pauses, resumes, and kills arbitrary animation targets', () => {
    const target = { value: 0 }
    const scope = new AnimationScope()
    const tween = scope.to(target, { value: 1, duration: 1 })

    scope.pause()
    expect(tween.paused()).toBe(true)

    scope.resume()
    expect(tween.paused()).toBe(false)

    scope.kill()
    expect(gsap.getTweensOf(target)).toHaveLength(0)
  })

  it('replaces a target-specific animation without touching other targets', () => {
    const firstTarget = { value: 0 }
    const secondTarget = { value: 0 }
    const scope = new AnimationScope()
    scope.to(firstTarget, { value: 1, duration: 1 })
    scope.to(secondTarget, { value: 1, duration: 1 })

    scope.kill(firstTarget)

    expect(gsap.getTweensOf(firstTarget)).toHaveLength(0)
    expect(gsap.getTweensOf(secondTarget)).toHaveLength(1)
    scope.kill()
  })
})
