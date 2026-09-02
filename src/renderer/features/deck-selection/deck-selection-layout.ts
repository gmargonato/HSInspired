/**
 * Geometry for the Deck Selection screen. All values are 1920x1080
 * design-canvas pixels at 1x.
 *
 * The class deck grid is not a list of fixed placements; `frameStart` is the
 * grid origin and `frameGap`/`frameSize` drive the cell spacing computed in
 * `DeckSelectionView.createDeckGrid` and `buildDeckSelectionEntries`.
 */

import type { LayoutPoint } from '../../rendering/layout'
import { CENTER, placement } from '../../rendering/layout'
import { GAME_HEIGHT, GAME_WIDTH } from '../../rendering/layout'

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
    frameStart: { x: 377, y: 300 } satisfies LayoutPoint,
    frameGap: { x: 10, y: 110 } satisfies LayoutPoint
  },

  /** Selected hero portrait, widened slightly to fit its frame. */
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

  /** Persistent win total for the selected hero's class. */
  classWins: placement(
    { x: 1470, y: 780 },
    { width: 0, height: 0 },
    {
      anchor: CENTER,
      note: 'Small centered Belwe text between the hero name and Play button.'
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

  /** Current page label in the bottom-center footer recess. */
  pageLabel: placement(
    { x: 752, y: 1030 },
    { width: 0, height: 0 },
    {
      anchor: CENTER
    }
  ),

  /** Previous-page arrow, mirrored from the supplied next-page asset. */
  previousPageButton: placement(
    { x: 620, y: 1030 },
    { width: 88, height: 49 },
    { anchor: CENTER }
  ),

  /** Next-page arrow beside the page label. */
  nextPageButton: placement(
    { x: 895, y: 1030 },
    { width: 88, height: 49 },
    { anchor: CENTER }
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
