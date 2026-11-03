/**
 * Geometry for the Settings scenes (Menu Settings & Game Settings overlay).
 * All values are 1920x1080 design-canvas pixels at 1x.
 */

import { CENTER, TOP_LEFT, placement } from '../../visual-components/layout'
import { GAME_HEIGHT, GAME_WIDTH } from '../../visual-components/layout'

export const SETTINGS_LAYOUT = {
  name: 'Settings overlay',
  boardCorners: {
    title: placement(
      { x: 781.5, y: 660 },
      { width: 344, height: 54 },
      { anchor: TOP_LEFT }
    ),
    field: placement(
      { x: 970, y: 745 },
      { width: 377, height: 80 },
      { anchor: CENTER }
    ),
    value: placement(
      { x: 928, y: 745 },
      { width: 208, height: 42 },
      { anchor: CENTER }
    ),
    button: placement(
      { x: 1068, y: 745 },
      { width: 69, height: 51 },
      { anchor: CENTER }
    ),
    options: placement(
      { x: 850, y: 785 },
      { width: 240, height: 0 },
      {
        anchor: TOP_LEFT,
        note: 'One vertical list below Board; its height follows the available themes.'
      }
    ),
    screenMargin: 24,
    rowHeight: 40
  },

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
    { x: 530, y: 335 },
    { width: 344, height: 54 },
    {
      anchor: TOP_LEFT,
      note: 'Warm yellow Franklin heading for the native window resolution setting.'
    }
  ),

  resolutionField: placement(
    { x: 702, y: 420 },
    { width: 377, height: 80 },
    {
      anchor: CENTER,
      scale: 344 / 377,
      note: 'Closed resolution selector field, centered in the Graphics section.'
    }
  ),

  resolutionValue: placement(
    { x: 660, y: 420 },
    { width: 208, height: 42 },
    {
      anchor: CENTER,
      note: 'Selected resolution text centered within the parchment portion of the field.'
    }
  ),

  resolutionButton: placement(
    { x: 791, y: 420 },
    { width: 69, height: 51 },
    {
      anchor: CENTER,
      scale: 62 / 69,
      note: 'Arrow button fitted into the dark socket at the field right edge.'
    }
  ),

  resolutionOptions: placement(
    { x: 582, y: 456 },
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
    { x: 1040, y: 335 },
    { width: 344, height: 54 },
    { anchor: TOP_LEFT, note: 'Difficulty heading in the Game section.' }
  ),
  aiModeField: placement(
    { x: 1212, y: 420 },
    { width: 377, height: 80 },
    { anchor: CENTER, scale: 344 / 377, note: 'Closed AI mode selector.' }
  ),
  aiModeValue: placement(
    { x: 1170, y: 420 },
    { width: 208, height: 42 },
    { anchor: CENTER, note: 'Selected AI mode within the field.' }
  ),
  aiModeButton: placement(
    { x: 1301, y: 420 },
    { width: 69, height: 51 },
    { anchor: CENTER, scale: 62 / 69, note: 'AI mode selector arrow.' }
  ),
  aiModeOptions: placement(
    { x: 1092, y: 456 },
    { width: 240, height: 156 },
    { anchor: TOP_LEFT, note: 'Three-row Easy, Expert, and API mode dropdown.' }
  ),
  aiModeOption: placement(
    { x: 20, y: 26 },
    { width: 200, height: 52 },
    { anchor: CENTER, note: 'Local text placement within an AI mode option.' }
  ),
  cursorSizeTitle: placement(
    { x: 788, y: 730 },
    { width: 344, height: 54 },
    { anchor: TOP_LEFT, note: 'Cursor Size heading.' }
  ),
  cursorSlider: placement(
    { x: 960, y: 815 },
    { width: 379, height: 83 },
    { anchor: CENTER, scale: 344 / 379, note: 'Cursor size track.' }
  ),
  cursorSliderHandle: placement(
    { x: 960, y: 815 },
    { width: 35, height: 77 },
    { anchor: CENTER, scale: 344 / 379, note: 'Handle centered on the recessed track.' }
  ),
  cursorSliderTravel: { minX: 858, maxX: 1062 },
  aiCheats: {
    checkbox: placement(
      { x: 1040, y: 515 },
      { width: 39, height: 36 },
      { anchor: TOP_LEFT }
    ),
    title: placement(
      { x: 1094, y: 511 },
      { width: 260, height: 44 },
      { anchor: TOP_LEFT }
    )
  },
  /** Match-only action frames and buttons, centered inside the game settings panel. */
  gameDivider: placement(
    { x: 781.5, y: 625 },
    { width: 377, height: 1 },
    {
      anchor: TOP_LEFT,
      note: 'Brown separator between match actions and Board settings.'
    }
  ),
  gameDividerColor: 0x28170d,
  gameActions: {
    concedeFrame: placement(
      { x: 970, y: 395 },
      { width: 398, height: 109 },
      {
        anchor: CENTER,
        note: 'Large base frame behind the Concede action.'
      }
    ),
    concedeButton: placement(
      { x: 970, y: 395 },
      { width: 294, height: 97 },
      {
        anchor: CENTER,
        note: 'Match settings Concede button centered over its base frame.'
      }
    ),
    quitFrame: placement(
      { x: 970, y: 535 },
      { width: 398, height: 109 },
      {
        anchor: CENTER,
        note: 'Large base frame behind the Quit action.'
      }
    ),
    quitButton: placement(
      { x: 970, y: 535 },
      { width: 294, height: 97 },
      {
        anchor: CENTER,
        note: 'Match settings Quit button centered over its base frame.'
      }
    )
  }
} as const
