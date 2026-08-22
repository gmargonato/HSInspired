/**
 * Geometry for the Card Preview scene (overlay backdrop, detail metadata panel,
 * and enlarged card presentation). All values are 1920x1080 design-canvas pixels at 1x.
 */

import { TOP_LEFT, placement, type LayoutPoint } from '../../rendering/layout'
import { GAME_HEIGHT, GAME_WIDTH } from '../../app/config'

export const CARD_PREVIEW_LAYOUT = {
  name: 'Card preview',

  /** Fullscreen dark backdrop overlay. */
  backdrop: placement(
    { x: 0, y: 0 },
    { width: GAME_WIDTH, height: GAME_HEIGHT },
    {
      anchor: TOP_LEFT,
      note: 'Fullscreen modal tint backdrop.'
    }
  ),

  /** Metadata panel on the left side of the screen. */
  detailsPanel: placement(
    { x: 150, y: 201 },
    { width: 447, height: 678 },
    {
      anchor: TOP_LEFT,
      note: 'Card metadata container on the left side of the screen.'
    }
  ),

  /** Centered preview target for the inspected card. */
  cardCenter: { x: 1080, y: GAME_HEIGHT / 2 } satisfies LayoutPoint,

  /** Pointer range in pixels used for interactive parallax tilt. */
  pointerRange: { x: 480, y: 440 } satisfies LayoutPoint,

  /** Maximum scale multiplier for the enlarged card. */
  maxScale: 0.86,

  /** Open / close animation duration in seconds. */
  animationDuration: 0.28
} as const
