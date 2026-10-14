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

  /** Slot centers and spacing are independent of portrait and label dimensions. */
  classGrid: {
    columns: 3,
    firstCenter: { x: 530, y: 322 } satisfies LayoutPoint,
    step: { x: 230, y: 250 } satisfies LayoutPoint,
    hitArea: { x: -115, y: -130, width: 220, height: 255 }
  },
  classPortrait: placement(
    { x: -1, y: -2.8 },
    { width: 205.2, height: 237.6 },
    {
      anchor: CENTER,
      note: 'Fit each hero frame proportionally inside these slot bounds.'
    }
  ),
  classLabel: placement(
    { x: -10, y: 84 },
    { width: 198, height: 57 },
    {
      anchor: CENTER,
      scale: 0.92,
      note: 'Class icon and name layered over the portrait near its base.'
    }
  ),

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
