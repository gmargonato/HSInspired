import { describe, expect, it } from 'vitest'
import { GAME_BOARD_LAYOUT } from './game-scene-layout'
import { CARD_CANVAS } from '../../rendering/cards/card-layout'
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
  it('mirrors the local marker rail above the remote hero portrait', () => {
    const localTopGap =
      SECRET_LAYOUT.badges.local.position.y -
      edge(GAME_BOARD_LAYOUT.heroes.local, 'top')
    const remoteTopGap =
      edge(GAME_BOARD_LAYOUT.heroes.remote, 'top') -
      SECRET_LAYOUT.badges.remote.position.y

    expect(SECRET_LAYOUT.badges.remote.position.y).toBeLessThan(
      edge(GAME_BOARD_LAYOUT.heroes.remote, 'top')
    )
    expect(Math.abs(localTopGap - remoteTopGap)).toBeLessThanOrEqual(0.5)
  })

  it('centers the Belwe count over each Secret badge', () => {
    expect(SECRET_LAYOUT.count.position).toEqual({ x: 0, y: -5 })
    expect(SECRET_LAYOUT.countTextStyle).toMatchObject({
      fontFamily: 'Belwe',
      fill: 0xffffff,
      stroke: { color: 0x000000 }
    })
  })

  it('spaces the Quest cards around the full-size arrow and labels progress above it', () => {
    const preview = SECRET_LAYOUT.questPreview
    const arrowHalfWidth = preview.arrow.size.width / 2
    const arrowTop = preview.arrow.position.y - preview.arrow.size.height / 2
    expect(preview.arrow.position.x - arrowHalfWidth).toBeGreaterThan(
      preview.leftCard.x + CARD_CANVAS.width * preview.scale + 50
    )
    expect(preview.rightCard.x).toBeGreaterThan(
      preview.arrow.position.x + arrowHalfWidth + 50
    )
    expect(preview.progress.position.x).toBe(preview.arrow.position.x)
    expect(preview.progress.position.y + preview.progress.size.height / 2).toBeLessThan(
      arrowTop
    )
  })

  it('centers the cropped reveal banner and readable card on the game canvas', () => {
    expect(SECRET_LAYOUT.reveal.position).toEqual({ x: 960, y: 540 })
    expect(SECRET_LAYOUT.reveal.size).toEqual({ width: 761, height: 409 })
    expect(SECRET_LAYOUT.reveal.scale).toEqual({ x: 1, y: 1 })
    expect(SECRET_LAYOUT.revealCard.position).toEqual({ x: 960, y: 540 })
  })
})
