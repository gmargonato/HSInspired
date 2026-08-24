import { describe, expect, it } from 'vitest'
import { GAME_BOARD_LAYOUT } from './game-scene-layout'
import { WEAPON_LAYOUT } from '../../rendering/weapons/weapon-layout'

describe('game weapon layout', () => {
  it('exposes one shared local drop zone for all playable cards', () => {
    expect(GAME_BOARD_LAYOUT.cardPlay.localDropZone).toEqual({
      x: 350,
      y: 290,
      width: 1230,
      height: 530
    })
  })

  it('keeps both equipped weapons screen-left of their hero frames', () => {
    expect(GAME_BOARD_LAYOUT.weapons.local.position.x).toBeLessThan(
      GAME_BOARD_LAYOUT.heroes.local.position.x
    )
    expect(GAME_BOARD_LAYOUT.weapons.remote.position.x).toBeLessThan(
      GAME_BOARD_LAYOUT.heroes.remote.position.x
    )
    expect(GAME_BOARD_LAYOUT.weapons.local.position.y).toBe(
      GAME_BOARD_LAYOUT.heroes.local.position.y
    )
    expect(GAME_BOARD_LAYOUT.weapons.remote.position.y).toBe(
      GAME_BOARD_LAYOUT.heroes.remote.position.y
    )
  })

  it('uses compact scaled card stat badges in the weapon view', () => {
    expect(WEAPON_LAYOUT.attackBadge.scale).toEqual({ x: 0.24, y: 0.24 })
    expect(WEAPON_LAYOUT.durabilityBadge.scale).toEqual({ x: 0.24, y: 0.24 })
    expect(WEAPON_LAYOUT.attackBadge.position).toEqual({ x: 65, y: 153 })
    expect(WEAPON_LAYOUT.durabilityBadge.position).toEqual({ x: 175, y: 153 })
    expect(WEAPON_LAYOUT.artwork.size).toEqual({ width: 122, height: 112 })
    expect(WEAPON_LAYOUT.artworkOval.radiusX).toBeGreaterThan(0)
    expect(WEAPON_LAYOUT.artworkOval.radiusY).toBe(56)
  })
})
