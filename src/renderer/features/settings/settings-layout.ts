/**
 * Geometry for the Settings scenes (Menu Settings & Game Settings overlay).
 * All values are 1920x1080 design-canvas pixels at 1x.
 */

import { CENTER, TOP_LEFT, placement } from '../../rendering/layout'
import { GAME_HEIGHT, GAME_WIDTH } from '../../rendering/layout'

export const SETTINGS_LAYOUT = {
  name: 'Settings overlay',

  /** Fullscreen background panel covering the viewport. */
  background: placement(
    { x: 0, y: 0 },
    { width: GAME_WIDTH, height: GAME_HEIGHT },
    {
      anchor: TOP_LEFT,
      note: 'Fullscreen background image for settings overlay.'
    }
  ),

  resolutionTitle: placement(
    { x: 790, y: 320 },
    { width: 344, height: 54 },
    {
      anchor: TOP_LEFT,
      note: 'White Belwe heading for the native window resolution setting.'
    }
  ),

  resolutionField: placement(
    { x: 960, y: 420 },
    { width: 344, height: 76 },
    {
      anchor: CENTER,
      note: 'Closed resolution selector field, centered in the settings panel.'
    }
  ),

  resolutionValue: placement(
    { x: 918, y: 420 },
    { width: 208, height: 42 },
    {
      anchor: CENTER,
      note: 'Selected resolution text centered within the parchment portion of the field.'
    }
  ),

  resolutionButton: placement(
    { x: 1050, y: 420 },
    { width: 62, height: 42 },
    {
      anchor: CENTER,
      note: 'Arrow button fitted into the dark socket at the field right edge.'
    }
  ),

  resolutionOptions: placement(
    { x: 840, y: 440 },
    { width: 240, height: 260 },
    {
      anchor: TOP_LEFT,
      note: 'Expanded five-row Pixi resolution menu directly below the selector.'
    }
  ),

  resolutionOption: placement(
    { x: 20, y: 26 },
    { width: 304, height: 52 },
    {
      anchor: CENTER,
      note: 'Local placement for a text row inside the expanded options menu.'
    }
  )
} as const
