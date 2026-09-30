/**
 * Geometry for the Card Preview scene (overlay backdrop, detail metadata panel,
 * and enlarged card presentation). All values are 1920x1080 design-canvas pixels at 1x.
 */

import {
  CENTER,
  TOP_LEFT,
  placement,
  type LayoutPoint
} from '../../../visual-components/layout'
import { GAME_HEIGHT, GAME_WIDTH } from '../../../visual-components/layout'
import { CARD_CANVAS } from '../../../visual-components/cards/card-layout'

const DETAILS_SCALE = 0.9
const UPGRADE_WIDTH = 422
const CARD_SCALE = 0.86
const CARD_CENTER_Y = 420
const CARD_MAX_HEIGHT = 700
const UPGRADE_TOP = 800

export const CARD_PREVIEW_LAYOUT = {
  name: 'Card preview',
  upgradePanel: placement(
    {
      x: (GAME_WIDTH - UPGRADE_WIDTH) / 2,
      y: UPGRADE_TOP
    },
    { width: 422, height: 250 },
    { anchor: TOP_LEFT, scale: 1 }
  ),
  upgradeBase: placement(
    { x: 0, y: 0 },
    { width: 422, height: 250 },
    { anchor: TOP_LEFT }
  ),
  disenchantButton: placement(
    { x: 105, y: 105 },
    { width: 154, height: 88 },
    { anchor: CENTER }
  ),
  upgradeButton: placement(
    { x: 338, y: 105 },
    { width: 154, height: 88 },
    { anchor: CENTER }
  ),
  refundValue: placement(
    { x: 140, y: 183 },
    { width: 110, height: 35 },
    { anchor: { x: 1, y: 0.5 }, note: 'Right edge before the refund dust icon.' }
  ),
  upgradeValue: placement(
    { x: 370, y: 183 },
    { width: 110, height: 35 },
    { anchor: { x: 1, y: 0.5 }, note: 'Right edge before the upgrade dust icon.' }
  ),
  dustBalance: placement(
    { x: 220, y: 235 },
    { width: 110, height: 35 },
    { anchor: CENTER }
  ),

  /** Fullscreen modal input surface; optional tint is disabled in the view. */
  backdrop: placement(
    { x: 0, y: 0 },
    { width: GAME_WIDTH, height: GAME_HEIGHT },
    {
      anchor: TOP_LEFT,
      note: 'Transparent fullscreen modal input surface.'
    }
  ),

  /** Existing metadata panel to the right, vertically centered beside the card. */
  detailsPanel: placement(
    { x: 1300, y: CARD_CENTER_Y - (678 * DETAILS_SCALE) / 2 },
    { width: 447, height: 678 },
    {
      anchor: TOP_LEFT,
      scale: DETAILS_SCALE,
      note: 'Unchanged metadata panel, positioned to the right of the card.'
    }
  ),

  /** Centered preview target for the inspected card. */
  cardCenter: {
    x: GAME_WIDTH / 2,
    y: CARD_CENTER_Y
  } satisfies LayoutPoint,

  /** Optional smaller generated-card preview shown left of the enlarged card. */
  generatedCard: placement({ x: 360, y: 435 }, CARD_CANVAS, {
    anchor: CENTER,
    scale: 0.7,
    note: 'Generated card centered in the open space left of the main card.'
  }),

  /** Reserve room below every card format for the full-size upgrade panel. */
  cardMaxSize: { width: 620, height: CARD_MAX_HEIGHT },

  /** Pointer range in pixels used for interactive parallax tilt. */
  pointerRange: { x: 480, y: 440 } satisfies LayoutPoint,

  /** Maximum scale multiplier for the enlarged card. */
  maxScale: CARD_SCALE,

  /** Open / close animation duration in seconds. */
  animationDuration: 0.28
} as const
