import { CENTER, placement } from '../../../visual-components/layout'

/** Local design pixels around the hero-power button; timings are in seconds. */
export const WARRIOR_ARMOR_UP = {
  aura: placement(
    { x: 0, y: 0 },
    { width: 256, height: 256 },
    { anchor: CENTER, note: 'Shared authored dimensions of aura-01 through aura-04.' }
  ),
  tint: 0xfff1cb,
  timing: { concentrate: 0.78, release: 0.68 },
  swirl: {
    count: 8,
    startDiameter: 800,
    concentratedDiameter: 76,
    releasedDiameter: 400,
    startOrbit: 12,
    concentratedOrbit: 14,
    releasedOrbit: 8,
    startOpacity: 0.22,
    concentratedOpacity: 0.75,
    /** Continuous radians per second, independent of contraction/expansion easing. */
    rotationSpeed: 6.5,
    sizeVariation: 0.2
  },
  rays: {
    count: 9,
    stagger: 0.018,
    startDiameter: 100,
    endDiameter: 460,
    opacity: 0.4,
    rotation: 0.35
  },
  shake: { amplitude: 8, pulses: 3, duration: 0.18 }
} as const
