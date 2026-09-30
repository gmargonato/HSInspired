/**
 * Geometry for the "new deck" hero-selection overlay, nested inside the
 * Collection scene. All values are 1920x1080 design-canvas pixels at 1x.
 *
 * The whole creation panel is moved with `panel.offsetX` while the controls
 * below stay relative to the selection artwork, so the panel can be nudged as
 * one unit without re-deriving each control's position.
 */

import type { LayoutPoint } from '../../../visual-components/layout'
import { CENTER, placement } from '../../../visual-components/layout'

export const NEW_DECK_LAYOUT = {
  name: 'New deck (hero selection overlay)',

  /** The sliding selection panel that holds everything else. */
  panel: {
    /** Horizontal offset applied when centering the selection background. */
    offsetX: 0,
    /** Slide-in / slide-out duration in seconds. */
    slideDuration: 0.5
  },

  /** Class hero grid (3 columns). Buttons are centered in their cells. */
  classGrid: {
    frameStart: { x: 360, y: 190 } satisfies LayoutPoint,
    frameGap: { x: 25, y: -20 } satisfies LayoutPoint
  },

  /** Selected hero portrait */
  heroPortrait: placement(
    { x: 1470, y: 490 },
    { width: 345, height: 433 },
    {
      anchor: CENTER,
      scale: { x: 1, y: 1 }
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

  /** Confirm-class button, shown once a class is selected. */
  selectClassButton: placement(
    { x: 1470, y: 935 },
    { width: 199, height: 199 },
    {
      anchor: CENTER
    }
  ),

  /** Cancel button at the bottom-right of the overlay. */
  cancelButton: placement(
    { x: 1670, y: 1045 },
    { width: 107, height: 47 },
    {
      anchor: CENTER
    }
  )
} as const
