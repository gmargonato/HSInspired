import { CENTER, TOP_LEFT, placement } from '../../rendering/layout'
import { CARD_CANVAS } from '../../rendering/cards/card-layout'

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
    source: placement({ x: 400, y: 142.5 }, CARD_CANVAS, {
      anchor: TOP_LEFT,
      scale: 0.4,
      note: 'Expanded initiating card; its center aligns with the newest thumbnail center.'
    }),
    heroPowerSource: placement(
      { x: 524, y: 322.5 },
      { width: 150, height: 150 },
      {
        anchor: CENTER,
        scale: 1.4,
        note: 'Hero power face centered in the expanded source-card area.'
      }
    ),
    heroSourceScale: 0.5,
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
      scale: 0.27,
      arrow: {
        size: { width: 91, height: 92 },
        offsetY: 88,
        scale: 0.7,
        gapToCard: 95
      }
    },
    fallback: placement(
      { x: 315, y: 290 },
      { width: 235, height: 100 },
      {
        anchor: TOP_LEFT,
        note: 'Text-only hero power, hidden, and fatigue action source.'
      }
    ),
    outcomeBadge: {
      offsetX: 0,
      offsetY: 267,
      width: 150,
      height: 38
    },
    outcomeDeath: {
      offsetX: 75,
      offsetY: 62,
      scale: 0.58
    }
  }
} as const
