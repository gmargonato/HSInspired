/**
 * Geometry for the developer Add Card to Hand picker.
 *
 * The picker is rendered as a DOM overlay above the Pixi canvas, but its
 * geometry still lives on the canonical 1920x1080 design canvas. The DOM
 * adapter converts these placements to CSS coordinates whenever the canvas
 * changes size.
 */

import { GAME_HEIGHT, GAME_WIDTH } from '../../app/config'
import { CENTER, TOP_LEFT, placement } from '../../rendering/layout'

export const ADD_CARD_PICKER_LAYOUT = {
  name: 'Add card picker overlay',

  overlay: placement(
    { x: 0, y: 0 },
    { width: GAME_WIDTH, height: GAME_HEIGHT },
    {
      anchor: TOP_LEFT,
      note: 'DOM overlay bounds aligned to the visible game design canvas.'
    }
  ),

  panel: placement(
    { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 },
    { width: 1180, height: 820 },
    {
      anchor: CENTER,
      note: 'Centered CSS panel containing search, filters, and results.'
    }
  ),

  title: placement(
    { x: 50, y: 35 },
    { width: 820, height: 42 },
    {
      anchor: TOP_LEFT,
      note: 'Local to the panel; title aligned to its content inset.'
    }
  ),

  closeButton: placement(
    { x: 1138, y: 36 },
    { width: 40, height: 40 },
    {
      anchor: CENTER,
      note: 'Local to the panel; close button in the upper-right corner.'
    }
  ),

  searchInput: placement(
    { x: 50, y: 90 },
    { width: 540, height: 56 },
    {
      anchor: TOP_LEFT,
      note: 'Local to the panel; fuzzy card-name search field.'
    }
  ),

  classFilter: placement(
    { x: 610, y: 90 },
    { width: 260, height: 56 },
    {
      anchor: TOP_LEFT,
      note: 'Local to the panel; card class filter select.'
    }
  ),

  expansionFilter: placement(
    { x: 890, y: 90 },
    { width: 260, height: 56 },
    {
      anchor: TOP_LEFT,
      note: 'Local to the panel; expansion/set filter select.'
    }
  ),

  collectibleFilter: placement(
    { x: 50, y: 168 },
    { width: 260, height: 32 },
    {
      anchor: TOP_LEFT,
      note: 'Local to the panel; optional collectible-only checkbox.'
    }
  ),

  status: placement(
    { x: 330, y: 168 },
    { width: 560, height: 32 },
    {
      anchor: TOP_LEFT,
      note: 'Local to the panel; inline validation and action status message.'
    }
  ),

  resultCount: placement(
    { x: 890, y: 168 },
    { width: 260, height: 32 },
    {
      anchor: TOP_LEFT,
      note: 'Local to the panel; number of cards matching the current filters.'
    }
  ),

  resultsViewport: placement(
    { x: 50, y: 215 },
    { width: 1100, height: 565 },
    {
      anchor: TOP_LEFT,
      note: 'Local to the panel; scrollable card result list.'
    }
  )
} as const

/** Dynamic result rows are a parameterized vertical spread. */
export const ADD_CARD_PICKER_ROW_LAYOUT = {
  height: 68,
  gap: 6,
  costWidth: 54,
  metadataWidth: 390
} as const
