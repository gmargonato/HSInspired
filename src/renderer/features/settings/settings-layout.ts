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
    { x: 1058, y: 420 },
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
  ),

  aiModeTitle: placement(
    { x: 790, y: 535 },
    { width: 344, height: 54 },
    { anchor: TOP_LEFT, note: 'AI mode heading below Resolution.' }
  ),
  aiModeField: placement(
    { x: 960, y: 635 },
    { width: 344, height: 76 },
    { anchor: CENTER, note: 'Closed AI mode selector.' }
  ),
  aiModeValue: placement(
    { x: 918, y: 635 },
    { width: 208, height: 42 },
    { anchor: CENTER, note: 'Selected AI mode within the field.' }
  ),
  aiModeButton: placement(
    { x: 1058, y: 635 },
    { width: 62, height: 42 },
    { anchor: CENTER, note: 'AI mode selector arrow.' }
  ),
  aiModeOptions: placement(
    { x: 840, y: 655 },
    { width: 240, height: 104 },
    { anchor: TOP_LEFT, note: 'Two-row AI mode dropdown.' }
  ),
  aiModeOption: placement(
    { x: 20, y: 26 },
    { width: 200, height: 52 },
    { anchor: CENTER, note: 'Local text placement within an AI mode option.' }
  ),
  aiModeNote: placement(
    { x: 960, y: 785 },
    { width: 440, height: 25 },
    { anchor: CENTER, note: 'Explains the saved local-versus-API AI routing choice.' }
  ),

  /** Match-only action frames and buttons, centered inside the game settings panel. */
  gameActions: {
    concedeFrame: placement(
      { x: 960, y: 400 },
      { width: 398, height: 109 },
      {
        anchor: CENTER,
        note: 'Large base frame behind the Concede action.'
      }
    ),
    concedeButton: placement(
      { x: 960, y: 400 },
      { width: 294, height: 97 },
      {
        anchor: CENTER,
        note: 'Match settings Concede button centered over its base frame.'
      }
    ),
    restartFrame: placement(
      { x: 960, y: 540 },
      { width: 398, height: 109 },
      {
        anchor: CENTER,
        note: 'Large base frame behind the Restart action.'
      }
    ),
    restartButton: placement(
      { x: 960, y: 540 },
      { width: 294, height: 97 },
      {
        anchor: CENTER,
        note: 'Match settings Restart button centered over its base frame.'
      }
    ),
    quitFrame: placement(
      { x: 960, y: 680 },
      { width: 398, height: 109 },
      {
        anchor: CENTER,
        note: 'Large base frame behind the Quit action.'
      }
    ),
    quitButton: placement(
      { x: 960, y: 680 },
      { width: 294, height: 97 },
      {
        anchor: CENTER,
        note: 'Match settings Quit button centered over its base frame.'
      }
    )
  }
} as const
