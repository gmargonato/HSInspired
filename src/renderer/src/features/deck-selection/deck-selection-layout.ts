/**
 * Geometry for the Deck Selection screen. All values are 1920x1080
 * design-canvas pixels at 1x.
 *
 * The class deck grid is not a list of fixed placements; `frameStart` is the
 * grid origin and `frameGap`/`frameSize` drive the cell spacing computed in
 * `DeckSelectionView.createDeckGrid` and `buildDeckSelectionEntries`.
 */

import type { LayoutPoint, LayoutSize } from '../../rendering/layout'
import { CENTER, placement } from '../../rendering/layout'
import { GAME_HEIGHT, GAME_WIDTH } from '../../app/config'

export const DECK_SELECTION_LAYOUT = {
  name: 'Deck selection',

  /** Full-screen background panel, centered on the canvas. */
  panel: placement(
    { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 },
    { width: 1920, height: 1080 },
    { anchor: CENTER }
  ),

  /** Class deck grid. Buttons are centered in their cells. */
  deckGrid: {
    frameStart: { x: 360, y: 300 } satisfies LayoutPoint,
    frameGap: { x: 25, y: 100 } satisfies LayoutPoint,
    frameSize: { width: 239, height: 107 } satisfies LayoutSize
  },

  /**
   * Selected hero portrait. The portrait sprite is scaled non-uniformly
   * (0.85 * 1.1, 0.85 * 1.05) to fit the target frame; see
   * DeckSelectionView.createSelectionDetails.
   */
  heroPortrait: placement(
    { x: 1470, y: 490 },
    { width: 345, height: 433 },
    {
      anchor: CENTER
    }
  ),

  /** Selected hero's display name, below the portrait. */
  heroName: placement(
    { x: 1470, y: 720 },
    { width: 0, height: 0 },
    {
      anchor: CENTER,
      note: 'Text element; the size is measured at runtime and the position is its center.'
    }
  ),

  /** Round play button, shown once a deck is selected. */
  playButton: placement(
    { x: 1470, y: 930 },
    { width: 199, height: 199 },
    {
      anchor: CENTER
    }
  ),

  /** "Go to collection" button on the left side. */
  toCollectionButton: placement(
    { x: 752, y: 1033 },
    { width: 293, height: 47 },
    {
      anchor: CENTER
    }
  ),

  /** Back button on the right side. */
  backButton: placement(
    { x: 1670, y: 1044 },
    { width: 107, height: 47 },
    {
      anchor: CENTER
    }
  )
} as const
