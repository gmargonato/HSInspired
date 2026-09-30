import { describe, expect, it } from 'vitest'
import { MINION_CANVAS, MINION_LAYOUT } from './minion-layout'
import {
  WEAPON_CANVAS,
  WEAPON_LAYOUT,
  weaponTemporaryAbilityBadgePlacement
} from './weapon-layout'
import type { LayoutPlacement } from '../../../visual-components/layout'

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
  it('shares one bottom-center minion slot without clipping any badge', () => {
    expect(MINION_LAYOUT.trigger.position).toEqual({ x: 80, y: 160 })
    expect(MINION_LAYOUT.inspire.position).toEqual(MINION_LAYOUT.trigger.position)
    expect(MINION_LAYOUT.lifesteal.position).toEqual(MINION_LAYOUT.trigger.position)
    expect(MINION_LAYOUT.deathrattle.position).toEqual({ x: 75, y: 160 })
    expectInsideCanvas(MINION_LAYOUT.trigger, MINION_CANVAS)
    expectInsideCanvas(MINION_LAYOUT.inspire, MINION_CANVAS)
    expectInsideCanvas(MINION_LAYOUT.lifesteal, MINION_CANVAS)
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
    expect(MINION_LAYOUT.inspire).toMatchObject({
      size: { width: 43, height: 38 }
    })
    expect(MINION_LAYOUT.lifesteal).toMatchObject({
      size: { width: 43, height: 41 }
    })
    expect(MINION_LAYOUT.deathrattle).toMatchObject({
      size: { width: 80, height: 53 }
    })
    expect(MINION_LAYOUT.taunt.scale).toBeUndefined()
    expect(MINION_LAYOUT.divineShield.scale).toEqual({ x: 1.2, y: 1.2 })
    expect(MINION_LAYOUT.trigger.scale).toEqual({ x: 0.75, y: 0.75 })
    expect(MINION_LAYOUT.inspire.scale).toEqual({ x: 0.75, y: 0.75 })
    expect(MINION_LAYOUT.lifesteal.scale).toEqual({ x: 0.75, y: 0.75 })
    expect(MINION_LAYOUT.deathrattle.scale).toEqual({ x: 0.75, y: 0.75 })
    expect(WEAPON_LAYOUT.trigger.scale).toBeUndefined()
    expect(WEAPON_LAYOUT.deathrattle.scale).toBeUndefined()
  })

  it('keeps badges inside the canvas and shares the enlarged immunity cocoon', () => {
    for (const key of [
      'windfury',
      'spellDamage',
      'lifesteal',
      'aura',
      'elusive'
    ] as const) {
      expectInsideCanvas(MINION_LAYOUT[key], MINION_CANVAS)
    }
    expect(MINION_LAYOUT.immune.position).toEqual(MINION_LAYOUT.divineShield.position)
    expect(MINION_LAYOUT.immune.size).toEqual(MINION_LAYOUT.divineShield.size)
    expect(MINION_LAYOUT.immune.scale).toEqual(MINION_LAYOUT.divineShield.scale)
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

  it('places Aura at the top of the minion instead of in the bottom badge row', () => {
    expect(MINION_LAYOUT.aura.position).toEqual({ x: 80, y: 20 })
    expect(MINION_LAYOUT.aura).toMatchObject({
      size: { width: 38, height: 38 }
    })
    expect(MINION_LAYOUT.aura.position.y).toBeLessThan(MINION_LAYOUT.trigger.position.y)
    expectInsideCanvas(MINION_LAYOUT.aura, MINION_CANVAS)
  })
})
