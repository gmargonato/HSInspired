import { CENTER, placement } from '../layout'

/** The local design space for one board minion. Its pivot is the canvas center. */
export const MINION_CANVAS = { width: 160, height: 210 } as const

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
  taunt: placement(
    { x: 80, y: 90 },
    { width: 136, height: 183 },
    {
      anchor: CENTER,
      note: 'Taunt ring hook, hidden until a future trait phase.'
    }
  ),
  divineShield: placement(
    { x: 80, y: 90 },
    { width: 125, height: 167 },
    {
      anchor: CENTER,
      note: 'Divine shield hook, hidden until a future trait phase.'
    }
  ),
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
    spawnIntervalMs: 950,
    driftX: 34,
    driftY: -30,
    duration: 2.9,
    startScale: 0.72,
    endScale: 1.32
  },
  selectionScale: 1.15
} as const
