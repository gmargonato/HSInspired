import { Texture } from 'pixi.js'
import { describe, expect, it } from 'vitest'
import { gsap, AnimationScope } from '../src/renderer/src/animation/animations'
import { FlipCard } from '../src/renderer/src/ui/components/FlipCard'

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

describe('FlipCard', () => {
  it('can start on its back face for reverse scene choreography', () => {
    const card = new FlipCard(Texture.EMPTY, Texture.EMPTY, {
      initialFace: 'back',
      oneShot: true
    })

    expect(card.isFlipped).toBe(true)
    expect(card.front.visible).toBe(false)
    expect(card.back.visible).toBe(true)
    expect(card.eventMode).toBe('none')

    card.dispose()
  })
})
