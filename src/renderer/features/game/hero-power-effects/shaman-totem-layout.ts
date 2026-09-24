import { CENTER, placement } from '../../../rendering/layout'

/** Artwork placement around the hero-power button; fade duration is in seconds. */
export const SHAMAN_TOTEM = {
  artwork: placement(
    { x: 0, y: 0 },
    { width: 242, height: 237 },
    { anchor: CENTER, note: "Centered at the PNG asset's authored 1x dimensions." }
  ),
  fadeDuration: 2,
  burst: {
    delay: 1,
    duration: 1,
    count: 12,
    angleJitter: 0.12,
    travelDistance: 150,
    tint: 0xb8eaff,
    opacity: 0.9,
    particle: placement(
      { x: 0, y: 0 },
      { width: 256, height: 256 },
      {
        anchor: CENTER,
        scale: 0.1,
        note: 'Fixed 1/10 scale; radial particles move without growing.'
      }
    )
  }
} as const
