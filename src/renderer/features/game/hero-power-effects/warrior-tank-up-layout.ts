import { CENTER, placement, type LayoutPoint } from '../../../rendering/layout'

/**
 * Local design pixels around the hero-power button (origin = card center);
 * timings are in seconds. The hammer enters from the screen right, slams the
 * power, and retreats while the impact bursts out radially.
 */
export const WARRIOR_TANK_UP = {
  /** Authored tank-up.png dimensions; the sprite is scaled down from them. */
  hammer: placement(
    { x: 0, y: 0 },
    { width: 300, height: 474 },
    {
      anchor: { x: 0.77, y: 0.96 },
      scale: 0.55,
      note: 'Golden hammer; pivot at the bottom of the handle (~231,455 of the texture), letting the head swing counterclockwise on impact.'
    }
  ),
  /** Normalized head contact point in the artwork, independent of the pivot. */
  headPoint: { x: 0.47, y: 0.21 },
  /** Hammer head offsets relative to the hero-power card center. */
  startOffset: { x: 180, y: -25 } satisfies LayoutPoint,
  contactOffset: { x: 0, y: 0 } satisfies LayoutPoint,
  retreatOffset: { x: 225, y: -50 } satisfies LayoutPoint,
  /** Radians; decreasing angles swing counterclockwise in screen coordinates. */
  tilt: {
    approachStart: 0.12,
    approachEnd: -0.1,
    retreatEnd: 0.16
  },
  /** Warm-gold shockwave tint. */
  tint: 0xffd75e,
  timing: {
    fadeIn: 0.06,
    approach: 0.32,
    /** Pause at the contact pose before the hammer retreats. */
    retreatDelay: 0.08,
    retreat: 0.45
  },
  burst: {
    count: 36,
    angleJitter: 0.04,
    travelDistance: 170,
    startTint: '#ffffff',
    endTint: '#ffe033',
    coolingDuration: 0.4,
    brightHold: 0.12,
    opacity: 1,
    duration: 0.9,
    particle: placement(
      { x: 0, y: 0 },
      { width: 256, height: 256 },
      {
        anchor: CENTER,
        scale: 0.1,
        note: 'Fixed 1/10 scale; radial particles move without growing.'
      }
    )
  },
  shockwave: {
    startDiameter: 40,
    endDiameter: 380,
    opacity: 0.55,
    /** Quick ramp to full opacity before the ring expands away. */
    riseIn: 0.05,
    duration: 0.45,
    ring: placement(
      { x: 0, y: 0 },
      { width: 256, height: 256 },
      {
        anchor: CENTER,
        note: 'effects/circle-01 authored size; the effect drives scale.'
      }
    )
  },
  flash: {
    tint: 0xfff0b8,
    startScale: 0.8,
    endScale: 1.3,
    peakOpacity: 0.85,
    fadeIn: 0.05,
    fadeOut: 0.18,
    sprite: placement(
      { x: 0, y: 0 },
      { width: 256, height: 256 },
      { anchor: CENTER, note: 'playSpotlight-01 authored size; effect drives scale.' }
    )
  },
  shake: { amplitude: 18, pulses: 6, duration: 0.48 }
} as const
