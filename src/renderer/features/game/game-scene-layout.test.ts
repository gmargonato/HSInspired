import { describe, expect, it } from 'vitest'
import { GAME_BOARD_LAYOUT } from './game-scene-layout'
import { WEAPON_LAYOUT } from '../../rendering/weapons/weapon-layout'

describe('game weapon layout', () => {
  it('keeps the match result frame, local hero, and prompt on the design canvas', () => {
    expect(GAME_BOARD_LAYOUT.matchResult.frame).toMatchObject({
      position: { x: 960, y: 485 },
      size: { width: 1374, height: 1145 },
      anchor: { x: 0.5, y: 0.5 },
      scale: { x: 0.72, y: 0.72 }
    })
    expect(GAME_BOARD_LAYOUT.matchResult.localHero).toMatchObject({
      position: { x: 960, y: 485 },
      size: { width: 345, height: 433 },
      anchor: { x: 0.5, y: 0.5 }
    })
    expect(GAME_BOARD_LAYOUT.matchResult.continuePrompt.position).toEqual({
      x: 960,
      y: 1015
    })
  })

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
