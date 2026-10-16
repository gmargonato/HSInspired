import { CENTER, placement } from '../../../visual-components/layout'
import { HERO_CANVAS } from '../board/hero-layout'

export const HERO_DESTRUCTION_LAYOUT = {
  crackFrameDuration: 0.2,
  crackFadeDuration: 0.3,
  crackPeakHold: 0.15,
  crack: placement(
    { x: HERO_CANVAS.width / 2, y: HERO_CANVAS.height / 2 },
    { width: 256, height: 256 },
    {
      anchor: { x: 128 / 256, y: 138 / 256 },
      scale: { x: HERO_CANVAS.width / 130, y: HERO_CANVAS.height / 184 },
      note: 'Fit the bright arch inside the image to the portrait; rays extend beyond it.'
    }
  ),
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
      scale: 1
    }
  ),
  remote: placement(
    { x: 0, y: 0 },
    { width: 718, height: 379 },
    {
      anchor: { x: 0.5, y: 0.36 },
      scale: 1
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
