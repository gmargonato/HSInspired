import { CENTER, placement } from '../../../visual-components/layout'

/** Local hero-power pixels, seconds for timing, and signed turns for rotation. */
export const WARLOCK_LIFE_TAP = {
  sprite: placement(
    { x: 0, y: 0 },
    { width: 256, height: 256 },
    {
      anchor: CENTER,
      scale: 320 / 256,
      note: 'Transparent swirl-02 texture centered on the power; the largest layer starts at 320 px.'
    }
  ),
  revealDuration: 0.08,
  shrinkDuration: 2,
  rotationTurns: -1,
  layers: [
    {
      tint: 0xb452f0,
      blendMode: 'normal',
      opacity: 0.85,
      scale: 1,
      startRotationTurns: 0
    },
    {
      tint: 0xc23ccc,
      blendMode: 'screen',
      opacity: 0.3,
      scale: 0.9,
      startRotationTurns: 45 / 360
    },
    {
      tint: 0x6a3dff,
      blendMode: 'add',
      opacity: 0.15,
      scale: 0.8,
      startRotationTurns: 100 / 360
    }
  ]
} as const
