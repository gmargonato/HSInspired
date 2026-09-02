import { Sprite, Texture } from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'
import { gsap } from '../../animation/animations'

vi.mock('../effects/animated-outline', () => ({
  AnimatedOutline: class {
    setEnabled(): void {}
    dispose(): void {}
  }
}))

import { HeroView } from './hero-view'

describe('hero identity presentation', () => {
  it('flips only the portrait frame when the hero is replaced', async () => {
    const view = HeroView.create(
      {
        label: 'game.hero.local',
        attack: 2,
        health: 8,
        maxHealth: 8,
        armor: 5,
        frozen: true
      },
      {
        frame: Texture.EMPTY,
        attack: Texture.EMPTY,
        health: Texture.EMPTY,
        armor: Texture.EMPTY,
        frozen: Texture.EMPTY
      }
    )
    const healthScale = view.getChildByLabel('hero.stat-health')!.scale.clone()
    const frozenScale = view.getChildByLabel('hero.frozen')!.scale.clone()

    const replacement = view.replaceFrame(Texture.WHITE)
    gsap.globalTimeline.progress(1)
    await replacement

    const frame = view.getChildByLabel('hero.frame')
    expect(frame).toBeInstanceOf(Sprite)
    expect((frame as Sprite).texture).toBe(Texture.WHITE)
    expect((frame as Sprite).scale.x).toBe(1)
    expect(view.getChildByLabel('hero.stat-health')!.scale).toEqual(healthScale)
    expect(view.getChildByLabel('hero.frozen')!.scale).toEqual(frozenScale)
    view.destroy({ children: true })
  })
})
