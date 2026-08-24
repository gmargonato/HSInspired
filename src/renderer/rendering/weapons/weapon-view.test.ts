import { Container, Text, Texture } from 'pixi.js'
import { describe, expect, it } from 'vitest'
import { WeaponView } from './weapon-view'

const textures = {
  frame: Texture.EMPTY,
  attack: Texture.EMPTY,
  durability: Texture.EMPTY
}

function childWithLabel(container: Container, label: string): Container | Text {
  const child = container.children.find((candidate) => candidate.label === label)
  if (!child) throw new Error(`Missing child ${label}.`)
  return child as Container | Text
}

describe('WeaponView', () => {
  it('builds masked artwork, frame, and scaled stat layers in order', async () => {
    const view = await WeaponView.create(
      { label: 'weapon:test', attack: 3, durability: 2 },
      textures,
      Texture.EMPTY
    )

    const artwork = childWithLabel(view, 'weapon.artwork') as Container
    expect(artwork.mask).toBeDefined()
    expect(
      view.children.findIndex((child) => child.label === 'weapon.frame')
    ).toBeGreaterThan(
      view.children.findIndex((child) => child.label === 'weapon.artwork')
    )
    expect(
      view.children.findIndex((child) => child.label === 'weapon.stat-attack')
    ).toBeGreaterThan(
      view.children.findIndex((child) => child.label === 'weapon.frame')
    )
    expect(
      view.children.findIndex((child) => child.label === 'weapon.stat-durability')
    ).toBeGreaterThan(
      view.children.findIndex((child) => child.label === 'weapon.stat-attack')
    )
    expect((childWithLabel(view, 'weapon.stat-attack') as Container).scale.x).toBe(0.24)
    expect((childWithLabel(view, 'weapon.stat-durability') as Container).scale.x).toBe(
      0.24
    )
    expect(view.eventMode).toBe('none')
    expect(view.children.every((child) => child.eventMode === 'none')).toBe(true)

    view.destroy({ children: true })
  })

  it('updates attack and durability values and supports missing artwork', async () => {
    const view = await WeaponView.create(
      { label: 'weapon:test', attack: 3, durability: 2 },
      textures,
      undefined
    )
    const artwork = childWithLabel(view, 'weapon.artwork') as Container
    expect(
      artwork.children.some((child) => child.label === 'weapon.artwork-placeholder')
    ).toBe(true)

    view.setStats(5, 1)
    const attackGroup = childWithLabel(view, 'weapon.stat-attack') as Container
    const durabilityGroup = childWithLabel(view, 'weapon.stat-durability') as Container
    expect(
      (
        attackGroup.children.find(
          (child) => child.label === 'weapon.stat-attack-value'
        ) as Text
      ).text
    ).toBe('5')
    expect(
      (
        durabilityGroup.children.find(
          (child) => child.label === 'weapon.stat-durability-value'
        ) as Text
      ).text
    ).toBe('1')

    view.destroy({ children: true })
  })
})
