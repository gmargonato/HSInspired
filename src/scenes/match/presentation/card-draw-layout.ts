import { CARD_CANVAS } from '../../../visual-components/cards/card-layout'
import { CENTER, placement } from '../../../visual-components/layout'
import { GAME_BOARD_LAYOUT } from '../game-scene-layout'

/** Flight-only geometry in design-canvas pixels; resting placements are unchanged. */
export const CARD_DRAW_LAYOUT = {
  name: 'Card draw flight',
  // Original local mulligan choreography; playback stretches this reference clock.
  localMulligan: {
    approach: 0.8,
    settle: 0.5,
    peakTangentScale: 0.15,
    revealY: [640, 605, 580, 560],
    revealRotation: [0, -8, -25, -22, -15],
    settleRotation: [-9, -3]
  },
  // Exposed back in deck.png (83 × 181). Gold to its right is stack thickness.
  deckFace: [
    { x: 0, y: 19 },
    { x: 40, y: 9 },
    { x: 42, y: 178 },
    { x: 0, y: 168 }
  ],
  localReveal: {
    // Authored checkpoint times; playback stretches each profile's final approach.
    duration: 1.05,
    normalAscentDuration: 1,
    normalDescentDuration: 10 / 21, // Preserve the existing ~0.476-second landing.
    // Normal draws hold the revealed card here; mulligan deals stay continuous.
    peakHold: 0.75,
    burnDuration: 1,
    // Angles are authored in degrees: yaw 0 shows the back, 180 the front.
    // Plane rotation is applied before perspective; 90 starts the back landscape.
    // Departure size/orientation comes from the shared full-card deck pose.
    reveal: [
      {
        at: 0.175,
        pose: placement({ x: 1710, y: 640 }, CARD_CANVAS, {
          anchor: CENTER,
          scale: 0.22
        }),
        rotation: 0,
        planeRotation: 90,
        yaw: 30
      },
      {
        at: 0.3375,
        pose: placement({ x: 1730, y: 605 }, CARD_CANVAS, {
          anchor: CENTER,
          scale: 0.28
        }),
        rotation: -8,
        planeRotation: 65,
        yaw: 55
      },
      {
        at: 0.475,
        pose: placement({ x: 1700, y: 555 }, CARD_CANVAS, {
          anchor: CENTER,
          scale: 0.32
        }),
        rotation: -25,
        planeRotation: 35,
        yaw: 90
      },
      {
        at: 0.65,
        pose: placement({ x: 1580, y: 505 }, CARD_CANVAS, {
          anchor: CENTER,
          scale: 0.34
        }),
        rotation: -22,
        planeRotation: 10,
        yaw: 145
      },
      {
        at: 0.8,
        pose: placement({ x: 1500, y: 490 }, CARD_CANVAS, {
          anchor: CENTER,
          scale: GAME_BOARD_LAYOUT.mulligan.cards.scale,
          note: 'Local draw reveal peak before descending into the hand.'
        }),
        rotation: 0,
        planeRotation: 0,
        yaw: 180
      }
    ],
    // Destination-relative checkpoints land in the hand fan.
    descent: [
      {
        at: 0.91,
        handProgress: 0.35,
        drop: 33,
        scaleProgress: 0.4,
        rotationProgress: 0.44
      },
      {
        at: 1.01,
        handProgress: 0.82,
        drop: 4,
        scaleProgress: 5 / 6,
        rotationProgress: 0.87
      }
    ]
  }
} as const
