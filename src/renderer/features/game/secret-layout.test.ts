import { describe, expect, it } from 'vitest'
import { GAME_BOARD_LAYOUT } from './game-scene-layout'
import { SECRET_LAYOUT } from './secret-layout'

function edge(
  placement: (typeof GAME_BOARD_LAYOUT)['heroes']['local'],
  side: 'top' | 'bottom'
) {
  return (
    placement.position.y -
    (side === 'top' ? placement.anchor.y : placement.anchor.y - 1) *
      placement.size.height *
      (placement.scale?.y ?? 1)
  )
}

describe('Secret layout', () => {
  it('places badges clear of the local hero frame and remote hand', () => {
    expect(
      Math.abs(
        SECRET_LAYOUT.badges.local.position.y -
          (edge(GAME_BOARD_LAYOUT.heroes.local, 'top') + 20)
      )
    ).toBeLessThanOrEqual(0.5)
    expect(
      Math.abs(
        SECRET_LAYOUT.badges.remote.position.y -
          edge(GAME_BOARD_LAYOUT.heroes.remote, 'bottom')
      )
    ).toBeLessThanOrEqual(0.5)
  })

  it('centers the Belwe count over each Secret badge', () => {
    expect(SECRET_LAYOUT.count.position).toEqual({ x: 0, y: -5 })
    expect(SECRET_LAYOUT.countTextStyle).toMatchObject({
      fontFamily: 'Belwe',
      fill: 0xffffff,
      stroke: { color: 0x000000 }
    })
  })

  it('centers the temporary reveal screen on the game canvas', () => {
    expect(SECRET_LAYOUT.reveal.position).toEqual({ x: 960, y: 540 })
    expect(SECRET_LAYOUT.reveal.size).toEqual({ width: 1920, height: 1080 })
    expect(SECRET_LAYOUT.reveal.scale).toEqual({ x: 1, y: 1 })
    expect(SECRET_LAYOUT.revealCard.position).toEqual({ x: 960, y: 620 })
  })
})
