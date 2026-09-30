/**
 * Geometry for the deck-deletion confirmation overlay, nested inside the
 * Collection scene. All values are 1920x1080 design-canvas pixels at 1x.
 *
 * The container art is a full-viewport image centered on screen; the confirm
 * and cancel buttons sit symmetrically along its bottom edge.
 */

import { CENTER, placement } from '../../visual-components/layout'

export const DELETE_DECK_LAYOUT = {
  name: 'Delete deck (confirmation overlay)',

  /** The confirmation panel, centered on screen. */
  container: placement(
    { x: 960, y: 540 },
    { width: 1920, height: 1080 },
    {
      anchor: CENTER,
      note: 'Full-viewport confirmation panel; authored 1920x1080.'
    }
  ),

  /** Confirms the deletion; left action at the bottom of the container. */
  confirmButton: placement(
    { x: 830, y: 630 },
    { width: 232, height: 67 },
    {
      anchor: CENTER,
      note: 'Symmetric pair with the cancel button around the screen center.'
    }
  ),

  /** Cancels the deletion; right action at the bottom of the container. */
  cancelButton: placement(
    { x: 1090, y: 630 },
    { width: 230, height: 65 },
    {
      anchor: CENTER,
      note: 'Symmetric pair with the confirm button around the screen center.'
    }
  )
} as const
