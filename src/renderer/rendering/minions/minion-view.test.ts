import { Container, Text, Texture } from 'pixi.js'
import { describe, expect, it } from 'vitest'
import { MINION_HEALTH_COLORS, MinionView } from './minion-view'

const textures = {
  frame: Texture.EMPTY,
  legendaryFrame: Texture.EMPTY,
  taunt: Texture.EMPTY,
  divineShield: Texture.EMPTY,
  attack: Texture.EMPTY,
  health: Texture.EMPTY
}

function childWithLabel(container: Container, label: string): Container | Text {
  const child = container.children.find((candidate) => candidate.label === label)
  if (!child) throw new Error(`Missing child ${label}.`)
  return child as Container | Text
}

describe('MinionView', () => {
  it('builds the artwork, frame, overlays, and topmost stat layers in order', async () => {
    const view = await MinionView.create(
      {
        label: 'minion:test',
        attack: 2,
        health: 1,
        legendary: true,
        taunt: false,
        divineShield: false
      },
      textures,
      Texture.EMPTY
    )

    const artwork = childWithLabel(view, 'minion.artwork')
    expect(artwork).toBeInstanceOf(Container)
    expect((artwork as Container).mask).toBeDefined()
    expect(
      view.children.findIndex((child) => child.label === 'minion.frame')
    ).toBeGreaterThan(
      view.children.findIndex((child) => child.label === 'minion.artwork')
    )
    expect(
      view.children.findIndex((child) => child.label === 'minion.stat-attack')
    ).toBeGreaterThan(
      view.children.findIndex((child) => child.label === 'minion.frame')
    )
    expect(
      view.children.findIndex((child) => child.label === 'minion.stat-health')
    ).toBeGreaterThan(
      view.children.findIndex((child) => child.label === 'minion.stat-attack')
    )
    expect(childWithLabel(view, 'minion.frame-legendary').visible).toBe(true)
    expect(view.eventMode).toBe('none')
    expect(view.children.every((child) => child.eventMode === 'none')).toBe(true)
    expect(childWithLabel(view, 'minion.attack-outline-proxy')).toBeDefined()
    expect(childWithLabel(view, 'minion.sleeping-zs-root')).toBeDefined()

    view.destroy({ children: true })
  })

  it('keeps optional trait overlays hidden until toggled', async () => {
    const view = await MinionView.create(
      {
        label: 'minion:test',
        attack: 1,
        health: 1,
        legendary: false,
        taunt: false,
        divineShield: false
      },
      textures,
      undefined
    )

    expect(childWithLabel(view, 'minion.frame-legendary').visible).toBe(false)
    expect(childWithLabel(view, 'minion.taunt').visible).toBe(false)
    expect(childWithLabel(view, 'minion.divine-shield').visible).toBe(false)

    view.setTaunt(true)
    view.setDivineShield(true)
    expect(childWithLabel(view, 'minion.taunt').visible).toBe(true)
    expect(childWithLabel(view, 'minion.divine-shield').visible).toBe(true)

    view.destroy({ children: true })
  })

  it('updates both stat labels and supports missing artwork with a placeholder', async () => {
    const view = await MinionView.create(
      {
        label: 'minion:test',
        attack: 3,
        health: 2,
        legendary: false,
        taunt: false,
        divineShield: false
      },
      textures,
      undefined
    )
    const artwork = childWithLabel(view, 'minion.artwork') as Container
    expect(
      artwork.children.some((child) => child.label === 'minion.artwork-placeholder')
    ).toBe(true)

    view.setStats(12, 10)
    const attackGroup = childWithLabel(view, 'minion.stat-attack') as Container
    const healthGroup = childWithLabel(view, 'minion.stat-health') as Container
    const attackValue = attackGroup.children.find(
      (child) => child.label === 'minion.stat-attack-value'
    )
    const healthValue = healthGroup.children.find(
      (child) => child.label === 'minion.stat-health-value'
    )
    expect((attackValue as Text).text).toBe('12')
    expect((healthValue as Text).text).toBe('10')

    view.destroy({ children: true })
  })

  it('tints current health relative to the original health', async () => {
    const view = await MinionView.create(
      {
        label: 'minion:test',
        attack: 3,
        health: 2,
        originalHealth: 3,
        legendary: false,
        taunt: false,
        divineShield: false
      },
      textures,
      undefined
    )
    const healthGroup = childWithLabel(view, 'minion.stat-health') as Container
    const healthValue = healthGroup.children.find(
      (child) => child.label === 'minion.stat-health-value'
    ) as Text

    expect(healthValue.style.fill).toBe(MINION_HEALTH_COLORS.damaged)
    view.setStats(3, 1)
    expect(healthValue.style.fill).toBe(MINION_HEALTH_COLORS.damaged)
    view.setStats(3, 3)
    expect(healthValue.style.fill).toBe(MINION_HEALTH_COLORS.normal)
    view.setStats(3, 4)
    expect(healthValue.style.fill).toBe(MINION_HEALTH_COLORS.increased)
    view.setStats(3, 2)
    expect(healthValue.style.fill).toBe(MINION_HEALTH_COLORS.damaged)

    view.destroy({ children: true })
  })

  it('keeps target input independent from attacker readiness', async () => {
    const view = await MinionView.create(
      {
        label: 'minion:test',
        attack: 2,
        health: 2,
        legendary: false,
        taunt: false,
        divineShield: false
      },
      textures,
      undefined
    )

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
