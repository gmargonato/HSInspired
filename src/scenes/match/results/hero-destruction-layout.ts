import { CENTER, placement } from '../../../visual-components/layout'

export const HERO_DESTRUCTION_LAYOUT = {
  duration: 3,
  fractureDuration: 0.28,
  fractureProgress: 0.025,
  travelDistance: 1800,
  fadeStart: 0.8,
  shake: { amplitude: 28, pulses: 16, duration: 3, damped: true },
  // Align the crater centers, rather than the centers of the asymmetric debris.
  local: placement(
    { x: 0, y: 0 },
    { width: 718, height: 438 },
    {
      anchor: { x: 0.5, y: 0.63 },
      scale: 0.8
    }
  ),
  remote: placement(
    { x: 0, y: 0 },
    { width: 718, height: 379 },
    {
      anchor: { x: 0.5, y: 0.36 },
      scale: 0.8
    }
  ),
  burst: placement(
    { x: 0, y: 0 },
    { width: 256, height: 256 },
    {
      anchor: CENTER,
      scale: 0.8
    }
  ),
  burstPeakScale: 2.2,
  burstRise: 0.28,
  burstFade: 1.2
} as const
