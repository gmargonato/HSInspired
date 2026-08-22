/**
 * Geometry for the Settings scenes (Menu Settings & Game Settings overlay).
 * All values are 1920x1080 design-canvas pixels at 1x.
 */

import { TOP_LEFT, placement } from '../../rendering/layout'
import { GAME_HEIGHT, GAME_WIDTH } from '../../app/config'

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
  )
} as const
