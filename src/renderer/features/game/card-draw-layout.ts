import { CARD_CANVAS } from '../../rendering/cards/card-layout'
import { CENTER, placement } from '../../rendering/layout'
import { GAME_BOARD_LAYOUT } from './game-scene-layout'

const mulliganCenterY =
  GAME_BOARD_LAYOUT.mulligan.cards.baselineY -
  (CARD_CANVAS.height * GAME_BOARD_LAYOUT.mulligan.cards.scale) / 2

/** Flight-only geometry in design-canvas pixels; resting placements are unchanged. */
export const CARD_DRAW_LAYOUT = {
  name: 'Card draw flight',
  // Exposed back in deck.png (83 × 181). Gold to its right is stack thickness.
  deckFace: [
    { x: 0, y: 19 },
    { x: 40, y: 9 },
    { x: 42, y: 178 },
    { x: 0, y: 168 }
  ],
  arc: { x: -35, y: -75 },
  perspectiveDepth: 1600,
  pitch: 0.12,
  liftFraction: 0.35,
  localReveal: {
    // Authored checkpoint times; playback stretches each profile's final approach.
    duration: 1.05,
    mulliganDescentDuration: 0.5,
    normalAscentDuration: 1,
    normalDescentDuration: 10 / 21, // Preserve the existing ~0.476-second landing.
    // Normal draws hold the revealed card here; mulligan deals stay continuous.
    peakHold: 1,
    // Angles are authored in degrees: yaw 0 shows the back, 180 the front.
    // Plane rotation is applied before perspective; 90 starts the back landscape.
    // Taper is bottom width / top width before the sideways perspective turn.
    departureTaper: 0.8,
    // Slide and grow the deck silhouette before blending into the perspective turn.
    departureTurnStart: 0.175,
    departureRelease: 0.3375,
    peakTangentScale: 0.15,
    reveal: [
      {
        at: 0.175,
        mulliganY: 640,
        mulliganRotation: 0,
        pose: placement({ x: 1710, y: 640 }, CARD_CANVAS, {
          anchor: CENTER,
          scale: 0.22
        }),
        rotation: 0,
        planeRotation: 90,
        yaw: 30,
        taper: 0.8
      },
      {
        at: 0.3375,
        mulliganY: 605,
        mulliganRotation: -8,
        pose: placement({ x: 1730, y: 605 }, CARD_CANVAS, {
          anchor: CENTER,
          scale: 0.28
        }),
        rotation: -8,
        planeRotation: 65,
        yaw: 55,
        taper: 0.85
      },
      {
        at: 0.475,
        mulliganY: 580,
        mulliganRotation: -25,
        pose: placement({ x: 1700, y: 555 }, CARD_CANVAS, {
          anchor: CENTER,
          scale: 0.32
        }),
        rotation: -25,
        planeRotation: 35,
        yaw: 90,
        taper: 0.89
      },
      {
        at: 0.65,
        mulliganY: 560,
        mulliganRotation: -22,
        pose: placement({ x: 1580, y: 505 }, CARD_CANVAS, {
          anchor: CENTER,
          scale: 0.34
        }),
        rotation: -22,
        planeRotation: 10,
        yaw: 145,
        taper: 0.93
      },
      {
        at: 0.8,
        // Meet the mulligan row at its center, without the normal hand's drop.
        mulliganY: mulliganCenterY,
        // Keep the card tilted in transit; straighten only as it settles.
        mulliganRotation: -15,
        pose: placement({ x: 1500, y: 490 }, CARD_CANVAS, {
          anchor: CENTER,
          scale: GAME_BOARD_LAYOUT.mulligan.cards.scale,
          note: 'Local draw reveal peak before descending into the hand.'
        }),
        rotation: 0,
        planeRotation: 0,
        yaw: 180,
        taper: 1
      }
    ],
    // Destination-relative checkpoints support both the hand fan and mulligan slots.
    descent: [
      {
        at: 0.91,
        mulliganRotation: -9,
        handProgress: 0.35,
        drop: 33,
        scaleProgress: 0.4,
        rotationProgress: 0.44
      },
      {
        at: 1.01,
        mulliganRotation: -3,
        handProgress: 0.82,
        drop: 4,
        scaleProgress: 5 / 6,
        rotationProgress: 0.87
      }
    ]
  }
} as const
