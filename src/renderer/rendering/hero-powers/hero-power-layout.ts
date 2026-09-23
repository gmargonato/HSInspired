import { CENTER, TOP_LEFT, placement } from '../layout'

export const HERO_POWER_ICON_CANVAS = { width: 150, height: 150 } as const
export const HERO_POWER_CARD_CANVAS = { width: 620, height: 903 } as const

/** Authored geometry shared by board, discovery, and history presentations. */
export const HERO_POWER_PRESENTATION_LAYOUT = {
  name: 'Hero power presentation',
  icon: {
    artwork: placement(
      { x: 75, y: 77 },
      { width: 500, height: 500 },
      {
        anchor: CENTER,
        scale: 0.18,
        note: 'Raw artwork scaled beneath the compact circular opening.'
      }
    ),
    artworkRadius: 60,
    frame: placement({ x: 0, y: 0 }, HERO_POWER_ICON_CANVAS, {
      anchor: TOP_LEFT
    })
  },
  card: {
    artwork: placement(
      { x: 310, y: 254 },
      { width: 500, height: 500 },
      {
        anchor: CENTER,
        scale: 0.56,
        note: 'Raw artwork cover-cropped behind the detailed circular opening.'
      }
    ),
    artworkRadius: 140,
    frame: placement({ x: 0, y: 0 }, HERO_POWER_CARD_CANVAS, {
      anchor: TOP_LEFT
    }),
    cost: placement(
      { x: 310, y: 70 },
      { width: 90, height: 84 },
      {
        anchor: CENTER
      }
    ),
    title: placement(
      { x: 310, y: 462 },
      { width: 430, height: 70 },
      {
        anchor: CENTER
      }
    ),
    rules: placement(
      { x: 310, y: 665 },
      { width: 420, height: 235 },
      {
        anchor: CENTER
      }
    )
  }
} as const
