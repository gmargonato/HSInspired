import { CENTER, TOP_LEFT, placement } from '../../../visual-components/layout'
import { CARD_CANVAS } from '../../../visual-components/cards/card-layout'

const HISTORY_SOURCE_CARD_SCALE = 0.4

/** Geometry for the Hearthstone-style action history overlay. */
export const MATCH_HISTORY_LAYOUT = {
  name: 'Match history',
  rail: {
    frame: placement(
      { x: 287, y: 270 },
      { width: 75, height: 75 },
      {
        anchor: TOP_LEFT,
        note: 'Newest history thumbnail; older entries spread down.'
      }
    ),
    capacity: 7,
    gap: 65,
    entryAnimation: {
      duration: 0.22,
      incomingOffsetX: -75
    },
    artworkInset: 9,
    artworkSize: 57
  },
  preview: {
    source: placement({ x: 400, y: 360 }, CARD_CANVAS, {
      anchor: TOP_LEFT,
      scale: HISTORY_SOURCE_CARD_SCALE,
      note: 'Expanded initiating card centered vertically on the 1920x1080 canvas.'
    }),
    // Also used by the existing remote Secret preview.
    historyCard: { scale: CARD_CANVAS.height / 392 },
    arrow: placement(
      { x: 722, y: 540 },
      { width: 91, height: 92 },
      { anchor: CENTER, scale: 0.7 }
    )
  },
  remoteCardPlay: {
    localOrigin: placement({ x: 985, y: 825 }, CARD_CANVAS, {
      anchor: CENTER,
      scale: 0.12,
      note: 'Automatic local spell appears at the local hero portrait.'
    }),
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

/** Padded card footprint includes protruding mana and stat badges. */
export const HISTORY_GRID = {
  x: 790,
  y: 160,
  width: 1080,
  height: 760,
  cellWidth: 740,
  cellHeight: 1020,
  insetX: 60,
  insetY: 60,
  maxScale: HISTORY_SOURCE_CARD_SCALE,
  arrow: { x: 722, y: 540 }
} as const

export function historyTargetPlacements(
  count: number
): readonly { x: number; y: number; scale: number }[] {
  if (count <= 0) return []
  let columns = 1,
    rows = count,
    scale = 0
  for (let candidate = 1; candidate <= count; candidate++) {
    const candidateRows = Math.ceil(count / candidate)
    const fit = Math.min(
      HISTORY_GRID.maxScale,
      HISTORY_GRID.width / (candidate * HISTORY_GRID.cellWidth),
      HISTORY_GRID.height / (candidateRows * HISTORY_GRID.cellHeight)
    )
    if (fit > scale + 1e-9 || (Math.abs(fit - scale) < 1e-9 && candidateRows < rows)) {
      columns = candidate
      rows = candidateRows
      scale = fit
    }
  }
  const top =
    HISTORY_GRID.y + (HISTORY_GRID.height - rows * HISTORY_GRID.cellHeight * scale) / 2
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns),
      column = index % columns
    const rowCount = Math.min(columns, count - row * columns)
    return {
      x:
        HISTORY_GRID.x +
        (((columns - rowCount) * HISTORY_GRID.cellWidth) / 2 +
          column * HISTORY_GRID.cellWidth +
          HISTORY_GRID.insetX) *
          scale,
      y: top + (row * HISTORY_GRID.cellHeight + HISTORY_GRID.insetY) * scale,
      scale
    }
  })
}

/** Local positions within a 620x900 historical card. */
export const HISTORY_CARD_DETAILS = {
  size: CARD_CANVAS,
  hero: placement(
    { x: 310, y: 450 },
    { width: 358, height: 410 },
    { anchor: CENTER, scale: 620 / 358 }
  ),
  damage: placement(
    { x: 310, y: 635 },
    { width: 159, height: 163 },
    { anchor: CENTER, scale: 2.4 }
  ),
  heal: placement({ x: 310, y: 605 }, { width: 260, height: 120 }, { anchor: CENTER }),
  mixedHeal: placement(
    { x: 310, y: 760 },
    { width: 260, height: 120 },
    { anchor: CENTER }
  ),
  hits: placement({ x: 465, y: 710 }, { width: 130, height: 60 }, { anchor: CENTER }),
  death: placement({ x: 310, y: 200 }, { width: 200, height: 200 }, { anchor: CENTER }),
  heroStats: {
    health: { x: 570, y: 735 },
    armor: { x: 570, y: 600 },
    attack: { x: 50, y: 735 },
    badgeHeight: 140
  }
} as const
