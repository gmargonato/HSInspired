import { describe, expect, it } from 'vitest'
import { GAME_BOARD_LAYOUT } from '../game-scene-layout'
import { CARD_CANVAS } from '../../../visual-components/cards/card-layout'
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
  it('keeps both marker rails near the top inside their hero portraits', () => {
    for (const side of ['local', 'remote'] as const) {
      const hero = GAME_BOARD_LAYOUT.heroes[side]
      const badge = SECRET_LAYOUT.badges[side]
      expect(badge.position.x).toBe(hero.position.x)
      expect(badge.position.y).toBeGreaterThan(edge(hero, 'top'))
      expect(badge.position.y).toBeLessThan(hero.position.y)
    }
  })

  it('centers the Belwe count over each Secret badge', () => {
    expect(SECRET_LAYOUT.count.position).toEqual({ x: 0, y: -5 })
    expect(SECRET_LAYOUT.countTextStyle).toMatchObject({
      fontFamily: 'Belwe',
      fill: 0xffffff,
      stroke: { color: 0x000000 }
    })
  })

  it('spaces the Quest cards around the full-size arrow and centers progress on it', () => {
    const preview = SECRET_LAYOUT.questPreview
    const arrowHalfWidth = preview.arrow.size.width / 2
    expect(preview.arrow.position.x - arrowHalfWidth).toBeGreaterThan(
      preview.leftCard.x + CARD_CANVAS.width * preview.scale + 50
    )
    expect(preview.rightCard.x).toBeGreaterThan(
      preview.arrow.position.x + arrowHalfWidth + 50
    )
    expect(preview.progress.position.x).toBe(preview.arrow.position.x)
    expect(preview.progress.position.y).toBe(preview.arrow.position.y)
  })

  it('centers the cropped reveal banner and readable card on the game canvas', () => {
    expect(SECRET_LAYOUT.reveal.position).toEqual({ x: 960, y: 540 })
    expect(SECRET_LAYOUT.reveal.size).toEqual({ width: 761, height: 409 })
    expect(SECRET_LAYOUT.reveal.scale).toEqual({ x: 1, y: 1 })
    expect(SECRET_LAYOUT.revealCard.position).toEqual({ x: 960, y: 540 })
  })
})
