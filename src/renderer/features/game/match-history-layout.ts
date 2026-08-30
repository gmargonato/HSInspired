import { CENTER, TOP_LEFT, placement } from '../../rendering/layout'
import { CARD_CANVAS } from '../../rendering/cards/card-layout'

const HISTORY_SOURCE_CARD_SCALE = 0.4
const HISTORY_TARGET_CARD_SCALE = 0.27
const HERO_FRAME_SIZE = { width: 358, height: 410 } as const

/** Geometry for the Hearthstone-style action history overlay. */
export const MATCH_HISTORY_LAYOUT = {
  name: 'Match history',
  rail: {
    frame: placement(
      { x: 295, y: 285 },
      { width: 75, height: 75 },
      {
        anchor: TOP_LEFT,
        note: 'Newest history thumbnail; older entries spread down.'
      }
    ),
    capacity: 7,
    gap: 65,
    artworkInset: 9,
    artworkSize: 57
  },
  preview: {
    source: placement({ x: 400, y: 360 }, CARD_CANVAS, {
      anchor: TOP_LEFT,
      scale: HISTORY_SOURCE_CARD_SCALE,
      note: 'Expanded initiating card centered vertically on the 1920x1080 canvas.'
    }),
    heroPowerSource: placement(
      { x: 524, y: 540 },
      { width: 150, height: 150 },
      {
        anchor: CENTER,
        scale: 1.4,
        note: 'Hero power face centered in the expanded source-card area.'
      }
    ),
    heroSource: placement({ x: 524, y: 540 }, HERO_FRAME_SIZE, {
      anchor: CENTER,
      scale: (CARD_CANVAS.height * HISTORY_SOURCE_CARD_SCALE) / HERO_FRAME_SIZE.height,
      note: 'Hero portrait matched to the expanded card height.'
    }),
    historyCard: {
      scale: CARD_CANVAS.height / 392,
      burnScale: CARD_CANVAS.height / 656,
      fatigueDamage: { x: 191, y: 520, scale: 1.75 }
    },
    targetGrid: {
      origin: { x: 825, y: 185 },
      singleRowY: 325,
      gapX: 185,
      gapY: 280,
      scale: HISTORY_TARGET_CARD_SCALE,
      cardSize: {
        width: CARD_CANVAS.width * HISTORY_TARGET_CARD_SCALE,
        height: CARD_CANVAS.height * HISTORY_TARGET_CARD_SCALE
      },
      arrow: {
        size: { width: 91, height: 92 },
        offsetY: 88,
        scale: 0.7,
        gapToCard: 95
      }
    },
    fallback: placement(
      { x: 315, y: 490 },
      { width: 235, height: 100 },
      {
        anchor: TOP_LEFT,
        note: 'Centered text-only hero power, hidden, and fatigue action source.'
      }
    ),
    heroOutcome: {
      scale: (CARD_CANVAS.height * HISTORY_TARGET_CARD_SCALE) / HERO_FRAME_SIZE.height
    },
    outcomeBadge: {
      offsetX: 0,
      offsetY: 267,
      width: 150,
      height: 38
    },
    outcomeDamage: {
      offsetX: 75,
      offsetY: 167,
      scale: 0.62
    },
    outcomeDeath: {
      offsetX: 95,
      offsetY: 82,
      scale: 0.58
    }
  }
} as const
