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
      { x: 400, y: 359 },
      { width: 620, height: 903 },
      {
        anchor: TOP_LEFT,
        scale: HISTORY_SOURCE_CARD_SCALE,
        note: 'Constructed hero-power card aligned with expanded card previews.'
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
  },
  remoteCardPlay: {
    origin: placement({ x: 985, y: 180 }, CARD_CANVAS, {
      anchor: CENTER,
      scale: 0.12,
      note: 'Remote card appears small at the center of the remote hero portrait.'
    }),
    travelDuration: 0.2,
    holdDuration: 1,
    fadeDuration: 0.1
  }
} as const
