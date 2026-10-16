import { CENTER, placement } from '../../../visual-components/layout'

/** Local power pixels, seconds, and signed turns. Shared by Life Tap and Soul Tap. */
export const WARLOCK_LIFE_TAP = {
  wisp: placement(
    { x: 0, y: 0 },
    { width: 512, height: 512 },
    { anchor: CENTER, scale: 400 / 512 }
  ),
  core: placement(
    { x: 0, y: 0 },
    { width: 64, height: 64 },
    { anchor: CENTER, scale: 4.2 }
  ),
  coreLayers: { count: 3, radius: 18, opacity: 0.9 },
  duration: 1.75,
  fadeIn: 0.1,
  peakHold: 0.35,
  collapseDelay: 0.25,
  rotationTurns: -0.8,
  wispTint: 0x4a008b,
  coreTint: 0x43007f,
  wisps: [
    { small: false, scale: 1, angle: 0, delay: 0, life: 1.5, opacity: 0.9 },
    { small: true, scale: 0.8, angle: 0.37, delay: 0.06, life: 1.3, opacity: 0.8 },
    { small: false, scale: 0.72, angle: 0.65, delay: 0.16, life: 1.2, opacity: 0.65 },
    { small: true, scale: 0.55, angle: 0.12, delay: 0.28, life: 1.1, opacity: 0.7 },
    { small: false, scale: 0.95, angle: 0.22, delay: 0.24, life: 1.4, opacity: 0.85 },
    { small: true, scale: 0.85, angle: 0.78, delay: 0.3, life: 1.35, opacity: 0.8 },
    { small: false, scale: 0.7, angle: 0.43, delay: 0.38, life: 1.3, opacity: 0.8 },
    { small: true, scale: 0.65, angle: 0.91, delay: 0.45, life: 1.3, opacity: 0.75 },
    { small: true, scale: 0.42, angle: 0.18, delay: 0.05, life: 1.5, opacity: 0.9 },
    { small: false, scale: 0.5, angle: 0.55, delay: 0.12, life: 1.5, opacity: 0.9 },
    { small: true, scale: 0.36, angle: 0.72, delay: 0.25, life: 1.4, opacity: 0.85 }
  ],
  motes: {
    count: 36,
    radius: 170,
    innerRadius: 8,
    turns: -0.65,
    size: 18,
    life: 1.05,
    stagger: 0.4
  },
  composite: { intensity: 2.5, rampIntensity: 0.95, opacity: 1, padding: 24 }
} as const
