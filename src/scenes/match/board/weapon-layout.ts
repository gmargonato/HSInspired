import {
  CENTER,
  placement,
  type LayoutPlacement
} from '../../../visual-components/layout'

/** The local design space for one equipped board weapon. Its pivot is centered. */
export const WEAPON_CANVAS = { width: 240, height: 210 } as const

/** Fixed geometry for the feature-agnostic equipped weapon render stack. */
export const WEAPON_LAYOUT = {
  name: 'Equipped board weapon',
  artwork: placement(
    { x: WEAPON_CANVAS.width / 2, y: 88 },
    { width: 122, height: 112 },
    {
      anchor: CENTER,
      note: 'Artwork aperture centered inside the board weapon frame.'
    }
  ),
  frame: placement(
    { x: WEAPON_CANVAS.width / 2, y: 88 },
    { width: 172, height: 146 },
    {
      anchor: CENTER,
      note: 'Native board weapon frame.'
    }
  ),
  trigger: placement(
    { x: WEAPON_CANVAS.width / 2, y: 153 },
    { width: 41, height: 44 },
    {
      anchor: CENTER,
      note: 'Bottom-center Trigger badge, layered above Deathrattle.'
    }
  ),
  lifesteal: placement(
    { x: WEAPON_CANVAS.width / 2, y: 153 },
    { width: 43, height: 41 },
    {
      anchor: CENTER,
      note: 'Bottom-center Lifesteal badge, sharing the weapon ability slot.'
    }
  ),
  deathrattle: placement(
    { x: WEAPON_CANVAS.width / 2, y: 153 },
    { width: 80, height: 53 },
    {
      anchor: CENTER,
      note: 'Bottom-center Deathrattle badge, layered below Trigger.'
    }
  ),
  temporaryAbilityBadges: {
    centerX: WEAPON_CANVAS.width / 2,
    centerY: 190,
    size: { width: 36, height: 36 },
    gap: 4,
    note: 'Centered row of temporary text badges below the authored ability art.'
  },
  attackBadge: placement(
    { x: 75, y: 145 },
    { width: 171, height: 180 },
    {
      anchor: CENTER,
      scale: 0.24,
      note: 'Scaled card weapon-attack badge.'
    }
  ),
  durabilityBadge: placement(
    { x: 175, y: 145 },
    { width: 164, height: 179 },
    {
      anchor: CENTER,
      scale: 0.24,
      note: 'Scaled card weapon-durability badge.'
    }
  ),
  artworkOval: {
    center: { x: 0, y: 0 },
    radiusX: 65,
    radiusY: 65
  },
  statText: {
    fontFamily: 'Belwe',
    // The entire stat group is scaled to 24%; author the number at card scale
    // so it remains legible beside the compact board weapon.
    fontSize: 150,
    fill: 0xffffff,
    stroke: { color: 0x17120f, width: 8 },
    align: 'center' as const
  }
} as const

/** Parameterized bottom row so weapons with multiple missing visuals remain readable. */
export function weaponTemporaryAbilityBadgePlacement(
  index: number,
  count: number
): LayoutPlacement {
  const row = WEAPON_LAYOUT.temporaryAbilityBadges
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
