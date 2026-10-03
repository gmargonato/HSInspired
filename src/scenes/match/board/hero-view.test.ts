import { Sprite, Text, Texture } from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'
import { gsap } from '../../../visual-components/animation/animations'

vi.mock('../../../visual-components/effects/animated-outline', () => ({
  AnimatedOutline: class {
    setEnabled(): void {}
    dispose(): void {}
  }
}))

import { HERO_HEALTH_COLORS, HeroView } from './hero-view'

describe('hero identity presentation', () => {
  it('flips only the portrait frame when the hero is replaced', async () => {
    const view = HeroView.create(
      {
        label: 'game.hero.local',
        attack: 2,
        health: 8,
        maxHealth: 8,
        armor: 5,
        frozen: true,
        immune: true
      },
      {
        frame: Texture.EMPTY,
        attack: Texture.EMPTY,
        health: Texture.EMPTY,
        armor: Texture.EMPTY,
        frozen: Texture.EMPTY,
        immune: Texture.EMPTY
      }
    )
    const healthScale = view.getChildByLabel('hero.stat-health')!.scale.clone()
    const frozen = view.getChildByLabel('hero.frozen')!
    const immune = view.getChildByLabel('hero.immune')!
    const frozenScale = frozen.scale.clone()
    const immuneScale = immune.scale.clone()

    expect({ x: immune.position.x, y: immune.position.y }).toEqual({
      x: frozen.position.x,
      y: frozen.position.y
    })
    expect({ x: immune.scale.x, y: immune.scale.y }).toEqual({
      x: frozen.scale.x,
      y: frozen.scale.y
    })
    expect(view.getChildIndex(immune)).toBeGreaterThan(
      view.getChildIndex(view.getChildByLabel('hero.frame')!)
    )
    expect(view.getChildIndex(immune)).toBeLessThan(
      view.getChildIndex(view.getChildByLabel('hero.stat-health')!)
    )

    const replacement = view.replaceFrame(Texture.WHITE)
    gsap.globalTimeline.progress(1)
    await replacement

    const frame = view.getChildByLabel('hero.frame')
    expect(frame).toBeInstanceOf(Sprite)
    expect((frame as Sprite).texture).toBe(Texture.WHITE)
    expect((frame as Sprite).scale.x).toBe(1)
    expect(view.getChildByLabel('hero.stat-health')!.scale).toEqual(healthScale)
    expect(view.getChildByLabel('hero.frozen')!.scale).toEqual(frozenScale)
    expect(view.getChildByLabel('hero.immune')!.scale).toEqual(immuneScale)
    expect(immune.visible).toBe(true)
    view.setImmune(false)
    expect(immune.visible).toBe(false)
    view.destroy({ children: true })
  })

  it('uses the latest maximum health when coloring the health value', () => {
    const view = HeroView.create(
      {
        label: 'game.hero.local',
        attack: 0,
        health: 30,
        maxHealth: 30,
        armor: 0,
        frozen: false,
        immune: false
      },
      {
        frame: Texture.EMPTY,
        attack: Texture.EMPTY,
        health: Texture.EMPTY,
        armor: Texture.EMPTY,
        frozen: Texture.EMPTY,
        immune: Texture.EMPTY
      }
    )
    const healthGroup = view.getChildByLabel('hero.stat-health')!
    const healthLabel = healthGroup.getChildByLabel('hero.stat-health-value') as Text

    view.setStats(0, 30, 0, 35)
    expect(healthLabel.style.fill).toBe(HERO_HEALTH_COLORS.damaged)
    view.setStats(0, 35, 0, 35)
    expect(healthLabel.style.fill).toBe(HERO_HEALTH_COLORS.normal)
    view.setStats(0, 36, 0, 35)
    expect(healthLabel.style.fill).toBe(HERO_HEALTH_COLORS.increased)
    view.destroy({ children: true })
  })
})

describe('hero Windfury wind', () => {
  it('fits the hero frame and remains visible through freeze and exhaustion', () => {
    const view = HeroView.create(
      {
        label: 'hero',
        attack: 2,
        health: 30,
        maxHealth: 30,
        armor: 0,
        frozen: true,
        immune: true,
        windfury: true
      },
      {
        frame: Texture.EMPTY,
        attack: Texture.EMPTY,
        health: Texture.EMPTY,
        armor: Texture.EMPTY,
        frozen: Texture.EMPTY,
        immune: Texture.EMPTY
      }
    )
    const rear = view.getChildByLabel('hero.windfury.rear')!
    const front = view.getChildByLabel('hero.windfury.front')!
    try {
      const index = (label: string) => view.getChildIndex(view.getChildByLabel(label)!)
      expect(index('hero.windfury.rear')).toBeLessThan(index('hero.frame'))
      expect(index('hero.windfury.front')).toBeGreaterThan(index('hero.immune'))
      expect(index('hero.windfury.front')).toBeLessThan(index('hero.stat-attack'))
      view.setCanAttack(false)
      view.setFrozen(true)
      view.setBaseScale(0.5)
      expect(front.visible && rear.visible).toBe(true)
      expect(front.parent).toBe(view)
      expect(rear.parent).toBe(view)
      view.setWindfury(false)
      expect(front.visible || rear.visible).toBe(false)
      view.setWindfury(true)
      expect(front.visible && rear.visible).toBe(true)
    } finally {
      view.destroy({ children: true })
    }
    expect(front.destroyed && rear.destroyed).toBe(true)
  })
})
