import { CENTER, placement } from '../../rendering/layout'
import { CARD_CANVAS } from '../../rendering/cards/card-layout'

/** Authored dimensions of the temporary Secret presentation assets. */
export const SECRET_CANVAS = { width: 112, height: 112 } as const

/** Quest and Secret badges share a centered marker rail for each hero. */
export const SECRET_LAYOUT = {
  name: 'Secrets',
  preview: {
    scale: 0.4,
    gap: 18,
    badgeGap: 18,
    viewportPadding: 20,
    viewportWidth: 1920,
    viewportHeight: 1080,
    fadeDuration: 0.12
  },
  badges: {
    local: placement({ x: 985, y: 737 }, SECRET_CANVAS, {
      anchor: CENTER,
      scale: 1,
      note: 'Centered just below the local hero top edge.'
    }),
    remote: placement({ x: 985, y: 100 }, SECRET_CANVAS, {
      anchor: CENTER,
      scale: 1,
      note: 'Centered just above the remote hero top edge, mirroring the local rail.'
    })
  },
  count: placement(
    { x: 0, y: -5 },
    { width: 56, height: 56 },
    {
      anchor: CENTER,
      note: 'Belwe Secret count centered on its badge in the badge local frame.'
    }
  ),
  countTextStyle: {
    fontFamily: 'Belwe',
    fontSize: 50,
    fill: 0xffffff,
    stroke: { color: 0x000000, width: 5 },
    align: 'center' as const
  },
  questProgressTextStyle: {
    fontFamily: 'Belwe',
    fontSize: 32,
    fill: 0xffffff,
    stroke: { color: 0x000000, width: 4 },
    align: 'center' as const
  },
  pairedBadgeOffset: 42,
  questPreview: {
    leftCard: { x: 540, y: 338 },
    rightCard: { x: 1140, y: 338 },
    arrow: placement(
      { x: 960, y: 518 },
      { width: 206, height: 198 },
      {
        anchor: CENTER,
        scale: 1,
        note: 'Full-size Quest reward arrow centered between the preview cards.'
      }
    ),
    progress: placement(
      { x: 960, y: 518 },
      { width: 150, height: 60 },
      {
        anchor: CENTER,
        note: 'Current Quest progress centered on the full-size arrow.'
      }
    ),
    progressTextStyle: {
      fontFamily: 'Belwe',
      fontSize: 48,
      fill: 0xffffff,
      stroke: { color: 0x000000, width: 5 },
      align: 'center' as const
    },
    scale: 0.4
  },
  reveal: placement(
    { x: 960, y: 540 },
    { width: 761, height: 409 },
    {
      anchor: CENTER,
      scale: 1,
      note: 'Cropped Secret banner at its authored 1x size.'
    }
  ),
  revealMotion: { bannerStartScale: 0.2, cardStartScale: 0.12 },
  revealCard: placement({ x: 960, y: 540 }, CARD_CANVAS, {
    anchor: CENTER,
    scale: 0.6,
    note: 'Revealed Secret card grows from its hero badge to the screen center.'
  })
} as const

/** A count-driven, centered row in the game design canvas. */
export function secretPreviewPositions(
  count: number,
  cardWidth: number,
  cardHeight: number
): readonly { x: number; y: number }[] {
  const layout = SECRET_LAYOUT.preview
  const badge = SECRET_LAYOUT.badges.local
  const width = cardWidth * layout.scale
  const height = cardHeight * layout.scale
  const rowWidth = count * width + Math.max(0, count - 1) * layout.gap
  const x = Math.max(
    layout.viewportPadding,
    Math.min(
      badge.position.x - rowWidth / 2,
      layout.viewportWidth - layout.viewportPadding - rowWidth
    )
  )
  const y = Math.max(
    layout.viewportPadding,
    Math.min(
      badge.position.y - badge.size.height / 2 - layout.badgeGap - height,
      layout.viewportHeight - layout.viewportPadding - height
    )
  )
  return Array.from({ length: count }, (_, index) => ({
    x: x + index * (width + layout.gap),
    y
  }))
}
