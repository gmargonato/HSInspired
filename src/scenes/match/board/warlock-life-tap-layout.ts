import { CENTER, placement } from '../../../visual-components/layout'

/** Local hero-power pixels; seconds for timing and radians for rotation. */
export const WARLOCK_LIFE_TAP = {
  sprite: placement(
    { x: 0, y: 0 },
    { width: 256, height: 256 },
    { anchor: CENTER, note: 'Swirl texture centered on the power.' }
  ),
  duration: 2,
  swirl: {
    count: 4,
    startDiameter: 560,
    endDiameter: 4,
    sizeVariation: 0.12,
    rotationSpeed: 7.5,
    tints: [0xb452f0, 0x9330dd, 0x6a1fc0, 0x3c1080],
    blackAt: 0.85,
    fadeAt: 0.92
  }
} as const
