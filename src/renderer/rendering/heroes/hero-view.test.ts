import { Container, Text, Texture } from 'pixi.js'
import { describe, expect, it } from 'vitest'
import { findLayoutLabelViolations } from '../layout/contract'
import { HERO_LAYOUT } from './hero-layout'
import { HERO_HEALTH_COLORS, HeroView } from './hero-view'

const textures = {
  frame: Texture.EMPTY,
  attack: Texture.EMPTY,
  health: Texture.EMPTY
}

function childWithLabel(container: Container, label: string): Container | Text {
  const child = container.children.find((candidate) => candidate.label === label)
  if (!child) throw new Error(`Missing child ${label}.`)
  return child as Container | Text
}

describe('HeroView', () => {
  it('builds the portrait, Health, and conditional Attack layers', () => {
    const view = HeroView.create(
      { label: 'hero:test', attack: 0, health: 30, maxHealth: 30 },
      textures
    )

    expect(childWithLabel(view, 'hero.frame')).toBeDefined()
    const healthLayoutGroup = childWithLabel(view, 'hero.stat-health') as Container
    expect(healthLayoutGroup).toBeDefined()
    expect(healthLayoutGroup.position).toMatchObject(HERO_LAYOUT.healthBadge.position)
    expect(healthLayoutGroup.scale.x).toBe(HERO_LAYOUT.healthBadge.scale?.x)
    expect(healthLayoutGroup.scale.y).toBe(HERO_LAYOUT.healthBadge.scale?.y)
    expect(childWithLabel(view, 'hero.stat-attack').visible).toBe(false)
    expect(view.eventMode).toBe('none')
    expect(view.children.every((child) => child.eventMode === 'none')).toBe(true)
    expect(findLayoutLabelViolations(view)).toEqual([])

    view.setStats(3, 27)
    const attackGroup = childWithLabel(view, 'hero.stat-attack') as Container
    const healthGroup = childWithLabel(view, 'hero.stat-health') as Container
    expect(attackGroup.visible).toBe(true)
    expect(
      (
        attackGroup.children.find(
          (child) => child.label === 'hero.stat-attack-value'
        ) as Text
      ).text
    ).toBe('3')
    expect(
      (
        healthGroup.children.find(
          (child) => child.label === 'hero.stat-health-value'
        ) as Text
      ).text
    ).toBe('27')

    view.destroy({ children: true })
  })

  it('colors Health by damage and keeps targeting separate from attack readiness', () => {
    const view = HeroView.create(
      { label: 'hero:test', attack: 1, health: 30, maxHealth: 30 },
      textures
    )
    const healthValue = childWithLabel(view, 'hero.stat-health').children.find(
      (child) => child.label === 'hero.stat-health-value'
    ) as Text

    view.setStats(1, 29)
    expect(healthValue.style.fill).toBe(HERO_HEALTH_COLORS.damaged)
    view.setStats(1, 30)
    expect(healthValue.style.fill).toBe(HERO_HEALTH_COLORS.normal)

    view.setCanAttack(false)
    view.setTargetable(true)
    expect(view.isCanAttack()).toBe(false)
    expect(view.isTargetable()).toBe(true)
    expect(view.eventMode).toBe('static')

    view.setTargetable(false)
    expect(view.eventMode).toBe('none')
    view.destroy({ children: true })
  })
})
