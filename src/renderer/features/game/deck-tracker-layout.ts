import { GAME_HEIGHT } from '../../app/config'
import { TOP_LEFT, placement } from '../../rendering/layout'

/**
 * Geometry for the optional match deck tracker on the left side of the board.
 * The transparent tracker owns the full design-canvas height so its dynamic
 * card rows can be vertically centered as the remaining deck changes.
 */
export const DECK_TRACKER_LAYOUT = {
  panel: placement(
    { x: 0, y: 0 },
    { width: 320, height: GAME_HEIGHT },
    {
      anchor: TOP_LEFT,
      note: 'Transparent row overlay anchored to the left edge of the board.'
    }
  ),
  viewport: placement(
    { x: 0, y: 0 },
    { width: 320, height: GAME_HEIGHT },
    {
      anchor: TOP_LEFT,
      note: 'Full-height viewport for dynamic vertical centering and scrolling.'
    }
  )
} as const

/** Row geometry intentionally matches the collection deck-editor rows. */
export const DECK_TRACKER_ROW_LAYOUT = {
  height: 34,
  gap: 1,
  inset: 0,
  costWidth: 27,
  copiesWidth: 24
} as const
