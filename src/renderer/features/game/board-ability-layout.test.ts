import { describe, expect, it } from 'vitest'
import {
  MINION_CANVAS,
  MINION_LAYOUT,
  minionTemporaryAbilityBadgePlacement
} from '../../rendering/minions/minion-layout'
import {
  WEAPON_CANVAS,
  WEAPON_LAYOUT,
  weaponTemporaryAbilityBadgePlacement
} from '../../rendering/weapons/weapon-layout'
import type { LayoutPlacement } from '../../rendering/layout'

function expectInsideCanvas(
  placement: LayoutPlacement,
  canvas: { readonly width: number; readonly height: number }
): void {
  const width = placement.size.width * (placement.scale?.x ?? 1)
  const height = placement.size.height * (placement.scale?.y ?? 1)
  const left = placement.position.x - width * placement.anchor.x
  const top = placement.position.y - height * placement.anchor.y

  expect(left).toBeGreaterThanOrEqual(0)
  expect(top).toBeGreaterThanOrEqual(0)
  expect(left + width).toBeLessThanOrEqual(canvas.width)
  expect(top + height).toBeLessThanOrEqual(canvas.height)
}

describe('board ability badge layouts', () => {
  it('shares one bottom-center minion slot without clipping either badge', () => {
    expect(MINION_LAYOUT.trigger.position).toEqual({ x: 80, y: 160 })
    expect(MINION_LAYOUT.deathrattle.position).toEqual({ x: 75, y: 160 })
    expectInsideCanvas(MINION_LAYOUT.trigger, MINION_CANVAS)
    expectInsideCanvas(MINION_LAYOUT.deathrattle, MINION_CANVAS)
  })

  it('shares one bottom-center weapon slot without clipping either badge', () => {
    expect(WEAPON_LAYOUT.trigger.position).toEqual({ x: 120, y: 153 })
    expect(WEAPON_LAYOUT.deathrattle.position).toEqual({ x: 120, y: 153 })
    expectInsideCanvas(WEAPON_LAYOUT.trigger, WEAPON_CANVAS)
    expectInsideCanvas(WEAPON_LAYOUT.deathrattle, WEAPON_CANVAS)
  })

  it('keeps authored board asset dimensions with tuned badge scaling', () => {
    expect(MINION_LAYOUT.taunt).toMatchObject({
      size: { width: 136, height: 183 }
    })
    expect(MINION_LAYOUT.divineShield).toMatchObject({
      size: { width: 125, height: 167 }
    })
    expect(MINION_LAYOUT.trigger).toMatchObject({
      size: { width: 41, height: 44 }
    })
    expect(MINION_LAYOUT.deathrattle).toMatchObject({
      size: { width: 80, height: 53 }
    })
    expect(MINION_LAYOUT.taunt.scale).toBeUndefined()
    expect(MINION_LAYOUT.divineShield.scale).toBeUndefined()
    expect(MINION_LAYOUT.trigger.scale).toEqual({ x: 0.75, y: 0.75 })
    expect(MINION_LAYOUT.deathrattle.scale).toEqual({ x: 0.75, y: 0.75 })
    expect(WEAPON_LAYOUT.trigger.scale).toBeUndefined()
    expect(WEAPON_LAYOUT.deathrattle.scale).toBeUndefined()
  })

  it('spreads temporary minion badges across a centered bottom row', () => {
    const placements = [0, 1].map((index) =>
      minionTemporaryAbilityBadgePlacement(index, 2)
    )

    expect(placements.map((value) => value.position)).toEqual([
      { x: 60, y: 190 },
      { x: 100, y: 190 }
    ])
    placements.forEach((value) => expectInsideCanvas(value, MINION_CANVAS))
  })

  it('spreads temporary weapon badges across a centered bottom row', () => {
    const placements = [0, 1].map((index) =>
      weaponTemporaryAbilityBadgePlacement(index, 2)
    )

    expect(placements.map((value) => value.position)).toEqual([
      { x: 100, y: 190 },
      { x: 140, y: 190 }
    ])
    placements.forEach((value) => expectInsideCanvas(value, WEAPON_CANVAS))
  })
})
