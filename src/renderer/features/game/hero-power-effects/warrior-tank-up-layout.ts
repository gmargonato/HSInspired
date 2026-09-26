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
      anchor: { x: 0.47, y: 0.21 },
      scale: 0.55,
      note: 'Golden hammer; authored art is already tilted head-up-left. The anchor sits on the hammer head (~140,100 of the texture) so rotation pivots the handle around the planted head.'
    }
  ),
  /** Hammer head offsets relative to the hero-power card center. */
  startOffset: { x: 180, y: -25 } satisfies LayoutPoint,
  contactOffset: { x: 0, y: 0 } satisfies LayoutPoint,
  retreatOffset: { x: 225, y: -50 } satisfies LayoutPoint,
  /** Radians; the head swings down on approach and back up on retreat. */
  tilt: {
    approachStart: -0.12,
    approachEnd: 0.1,
    retreatEnd: -0.16
  },
  /** Shared warm-gold tint for every glow element (particles, ring, flash). */
  tint: 0xffd75e,
  timing: {
    fadeIn: 0.06,
    approach: 0.32,
    /** Pause at the contact pose before the hammer retreats. */
    retreatDelay: 0.08,
    retreat: 0.45
  },
  burst: {
    count: 14,
    angleJitter: 0.12,
    travelDistance: 170,
    tint: 0xffd75e,
    opacity: 0.95,
    duration: 0.7,
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
  shake: { amplitude: 10, pulses: 3, duration: 0.18 }
} as const
