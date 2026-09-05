import { CENTER, placement, type LayoutPlacement } from '../layout'

/** The local design space for one board minion. Its pivot is the canvas center. */
export const MINION_CANVAS = { width: 160, height: 210 } as const

/**
 * Interactive footprint, inset to the widest intended visual (the Taunt ring).
 * Keeping this narrower than the canvas prevents adjacent minion targets from
 * overlapping when their board slots are at the minimum spacing.
 */
export const MINION_HIT_AREA = { x: 12, y: 5, width: 136, height: 184 } as const

/** Fixed geometry for the feature-agnostic minion render stack. */
export const MINION_LAYOUT = {
  name: 'Board minion',
  artwork: placement(
    { x: 80, y: 78 },
    { width: 98, height: 124 },
    {
      anchor: CENTER,
      note: 'Enlarged oval artwork aperture, still inset inside the minion frame.'
    }
  ),
  frame: placement(
    { x: 80, y: 90 },
    { width: 119, height: 161 },
    {
      anchor: CENTER,
      note: 'Base oval minion frame.'
    }
  ),
  legendaryFrame: placement(
    { x: 95, y: 45 },
    { width: 136, height: 99 },
    {
      anchor: CENTER,
      note: 'Legendary frame overlay, hidden for non-legendary minions.'
    }
  ),
  frozen: placement(
    { x: 80, y: 105 },
    { width: 160, height: 210 },
    {
      anchor: CENTER,
      note: 'Frozen overlay above minion frames and below Stealth and Divine Shield.'
    }
  ),
  taunt: placement(
    { x: 80, y: 97 },
    { width: 136, height: 183 },
    {
      anchor: CENTER,
      note: 'Taunt ring surrounding the board minion.'
    }
  ),
  divineShield: placement(
    { x: 80, y: 85 },
    { width: 125, height: 167 },
    {
      anchor: CENTER,
      note: 'Divine Shield cocoon surrounding the portrait.'
    }
  ),
  stealth: placement(
    { x: 80, y: 85 },
    { width: 113, height: 153 },
    {
      anchor: CENTER,
      note: 'Stealth veil surrounding the portrait, below Divine Shield.'
    }
  ),
  trigger: placement(
    { x: 80, y: 160 },
    { width: 41, height: 44 },
    {
      anchor: CENTER,
      scale: 0.75,
      note: 'Bottom-center Trigger badge, layered above Deathrattle.'
    }
  ),
  inspire: placement(
    { x: 80, y: 160 },
    { width: 43, height: 38 },
    {
      anchor: CENTER,
      scale: 0.75,
      note: 'Bottom-center Inspire badge, sharing the Trigger position and layered above it.'
    }
  ),
  deathrattle: placement(
    { x: 75, y: 160 },
    { width: 80, height: 53 },
    {
      anchor: CENTER,
      scale: 0.75,
      note: 'Bottom-center Deathrattle badge, layered below Trigger.'
    }
  ),
  poisonous: placement(
    { x: 80, y: 160 },
    { width: 39, height: 55 },
    {
      anchor: CENTER,
      scale: 0.75,
      note: 'Bottom-center Poisonous flask, layered above Deathrattle and below Trigger.'
    }
  ),
  temporaryAbilityBadges: {
    centerX: 80,
    centerY: 190,
    size: { width: 36, height: 36 },
    gap: 4,
    note: 'Centered row of temporary text badges below the authored ability art.'
  },
  attackBadge: placement(
    { x: 35, y: 130 },
    { width: 44, height: 51 },
    {
      anchor: CENTER,
      note: 'Attack badge.'
    }
  ),
  healthBadge: placement(
    { x: 125, y: 130 },
    { width: 38, height: 54 },
    {
      anchor: CENTER,
      note: 'Health badge.'
    }
  ),
  artworkOval: {
    center: { x: 0, y: 10 },
    radiusX: 55,
    radiusY: 70
  },
  statText: {
    fontFamily: 'Belwe',
    fontSize: 30,
    fill: 0xffffff,
    stroke: { color: 0x17120f, width: 5 },
    align: 'center' as const
  },
  /** Sleeping Zzz origin inside the artwork (towards center) drifting diagonally up-right. */
  sleepingZ: {
    origin: { x: 114, y: 42 },
    baseFontSize: 38,
    spawnIntervalMs: 1500,
    driftX: 34,
    driftY: -30,
    duration: 2.9,
    startScale: 0.72,
    endScale: 1.32
  },
  selectionScale: 1.15
} as const

/** Parameterized bottom row so cards with multiple missing visuals remain readable. */
export function minionTemporaryAbilityBadgePlacement(
  index: number,
  count: number
): LayoutPlacement {
  const row = MINION_LAYOUT.temporaryAbilityBadges
  const step = row.size.width + row.gap
  return placement(
    {
      x: row.centerX + (index - (count - 1) / 2) * step,
      y: row.centerY
    },
    row.size,
    { anchor: CENTER, note: row.note }
  )
}
