import { CENTER, placement } from '../../../rendering/layout'

/** Local hero-power pixels; seconds for timing and radians for rotation. */
export const PRIEST_HEAL = {
  sprite: placement(
    { x: 0, y: 0 },
    { width: 256, height: 256 },
    { anchor: CENTER, note: 'Sunlight centered behind the unscaled power button.' }
  ),
  tint: 0xffd45c,
  timing: { brighten: 0.25, grow: 0.35, fade: 0.45, cycle: 24, spotlightRotation: 60 },
  startOpacity: 0.6,
  spotlight: { diameter: 280, opacity: 1, pulse: 0.04, stack: 3 },
  aura: { count: 3, diameter: 260, pulse: 0.12, period: 3 },
  confirmation: { scale: 1.6, auraOpacity: 0.8 }
} as const
