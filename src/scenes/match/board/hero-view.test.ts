vi.mock('pixi.js', async (original) => {
  const actual = await original<typeof import('pixi.js')>()
  return {
    ...actual,
    Shader: {
      from: (options: { resources: Record<string, unknown> }) =>
        new actual.Shader({
          resources: options.resources,
          glProgram: undefined as unknown as InstanceType<typeof actual.GlProgram>
        })
    }
  }
})
import { gsap } from '../../../visual-components/animation/animations'
import { Sprite, Text, Texture } from 'pixi.js'
import {
  outlinedTextStyle,
  type TextOutline
} from '../../../visual-components/text-style'
import { HeroPortrait } from '../../../visual-components/hero-portrait'
import { hasPremiumHeroPortrait } from '../../../visual-components/hero-portrait-appearance'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../visual-components/effects/animated-outline', () => ({
  AnimatedOutline: class {
    constructor(private readonly target: import('pixi.js').Container) {}
    setEnabled(enabled: boolean): void {
      this.target.visible = enabled
    }
    dispose(): void {}
  }
}))

import { HERO_HEALTH_COLORS, HeroView } from './hero-view'

describe('hero identity presentation', () => {
  it.each(['local', 'remote'])(
    'keeps %s hero hover independent of targeting and other white cues',
    (side) => {
      const view = HeroView.create(
        {
          label: `game.hero.${side}`,
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
      try {
        const white = view.getChildByLabel('hero.attention-outline-proxy') as Sprite
        view.setHoverable(true)
        view.setTargetable(false)
        expect(view.eventMode).toBe('static')
        expect(view.cursor).toBe('default')
        expect(view.isTargetable()).toBe(false)
        expect(view.isCanAttack()).toBe(false)
        expect(white.visible).toBe(false)
        view.setHoverAura(true)
        expect(white.visible).toBe(true)
        view.setAiAttention(true)
        view.setHoverAura(false)
        expect(white.visible).toBe(true)
        view.setAttackWarning(true)
        view.setAiAttention(false)
        expect(white.visible).toBe(true)
        view.setHoverAura(true)
        view.setAttackWarning(false)
        expect(white.visible).toBe(true)
        view.setFrame(Texture.WHITE)
        expect(white.texture).toBe(Texture.WHITE)
        expect(white.visible).toBe(true)
        view.setHoverAura(false)
        expect(white.visible).toBe(false)
        view.setTargetable(true)
        view.setHoverable(false)
        expect(view.eventMode).toBe('static')
        expect(view.cursor).toBe('pointer')
        view.setTargetable(false)
        expect(view.eventMode).toBe('none')
      } finally {
        view.destroy({ children: true })
      }
    }
  )
  it('keeps armor and health outlines proportional through updates and repeated pulses', () => {
    const view = HeroView.create(
      {
        label: 'hero',
        attack: 2,
        health: 27,
        maxHealth: 30,
        armor: 5,
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
    try {
      view.setHealthVisible(true)
      const group = view.getChildByLabel('hero.stat-health')!
      const health = group.getChildByLabel('hero.stat-health-value') as Text
      const armorGroup = view.getChildByLabel('hero.stat-armor')!
      const armor = armorGroup.getChildByLabel('hero.stat-armor-value') as Text
      const reference = outlinedTextStyle('number', health.style.fontSize)
      const ratio = reference.stroke.width / reference.fontSize
      for (const value of [health, armor]) {
        expect(
          (value.style.stroke as TextOutline).width / value.style.fontSize
        ).toBeCloseTo(ratio)
      }
      expect(health.style).not.toBe(armor.style)
      const baseScale = group.scale.clone()
      view.pulseHealth()
      view.pulseHealth()
      gsap.globalTimeline.progress(1)
      expect(group.scale.x).toBe(baseScale.x)
      expect(group.scale.y).toBe(baseScale.y)
      view.setHealthAndArmor(30, 100, 30)
      expect(health.style.fill).toBe(HERO_HEALTH_COLORS.normal)
      expect(armor.text).toBe('100')
      expect(armor.style.fill).toBe(0xffffff)
      expect(
        (armor.style.stroke as TextOutline).width / armor.style.fontSize
      ).toBeCloseTo(ratio)
      view.setHealthAndArmor(29, 0, 30)
      expect(health.style.fill).toBe(HERO_HEALTH_COLORS.damaged)
      expect(armorGroup.visible).toBe(false)
      view.setHealthVisible(false)
      expect(group.visible).toBe(false)
    } finally {
      view.destroy({ children: true })
    }
  })
  it('unlocks only the local class at 500 or more wins', () => {
    let mageWins = 499
    const stats = { getWins: (classId: string) => (classId === 'Mage' ? mageWins : 0) }
    expect(hasPremiumHeroPortrait(stats, 'jaina')).toBe(false)
    mageWins = 500
    expect(hasPremiumHeroPortrait(stats, 'jaina')).toBe(true)
    expect(hasPremiumHeroPortrait(stats, 'jaina-frost-lich')).toBe(true)
    expect(hasPremiumHeroPortrait(stats, 'guldan')).toBe(false)
    expect(hasPremiumHeroPortrait(stats, 'jaina', false)).toBe(false)
    expect(hasPremiumHeroPortrait(undefined, 'jaina')).toBe(false)
    mageWins = 501
    expect(hasPremiumHeroPortrait(stats, 'jaina')).toBe(true)
  })
  it('flips the assembled portrait while preserving stats and overlays', async () => {
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
    expect(frame).toBeInstanceOf(HeroPortrait)
    expect((frame as HeroPortrait).texture).toBe(Texture.WHITE)
    expect((frame as HeroPortrait).scale.x).toBe(1)
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
      gsap.globalTimeline.time(gsap.globalTimeline.time() + 1.1)
      expect(front.visible || rear.visible).toBe(false)
      view.setWindfury(true)
      expect(front.visible && rear.visible).toBe(true)
    } finally {
      view.destroy({ children: true })
    }
    expect(front.destroyed && rear.destroyed).toBe(true)
  })
})
