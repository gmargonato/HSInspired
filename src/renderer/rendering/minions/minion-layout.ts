import { CENTER, placement } from '../layout'

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
    { x: 80, y: 90 },
    { width: 160, height: 210 },
    {
      anchor: CENTER,
      note: 'Frozen overlay above minion frames and Stealth, below Divine Shield.'
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
  battlecry: placement(
    { x: 80, y: 90 },
    { width: 284, height: 274 },
    {
      anchor: CENTER,
      note: 'Battlecry burst overlay, above taunt and artwork, below Stealth and the frame.'
    }
  ),
  enrage: placement(
    { x: 80, y: 90 },
    { width: 105, height: 141 },
    { anchor: CENTER, note: 'Active Enrage overlay surrounding the portrait.' }
  ),
  divineShield: placement(
    { x: 83, y: 88 },
    { width: 125, height: 167 },
    {
      anchor: CENTER,
	  scale: 1.2,
      note: 'Divine Shield cocoon surrounding the portrait.'
    }
  ),
  stealth: placement(
    { x: 80, y: 85 },
    { width: 113, height: 153 },
    {
      anchor: CENTER,
      note: 'Stealth veil surrounding the portrait, between artwork and minion frames.'
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
  windfury: placement(
    { x: 80, y: 160 },
    { width: 51, height: 48 },
    {
      anchor: CENTER,
      scale: 0.75,
      note: 'Bottom-center Windfury and Mega Windfury badge, sharing the Trigger position.'
    }
  ),
  spellDamage: placement(
    { x: 80, y: 160 },
    { width: 43, height: 45 },
    {
      anchor: CENTER,
      scale: 0.75,
      note: 'Bottom-center Spell Damage badge, sharing the Trigger position.'
    }
  ),
  lifesteal: placement(
    { x: 80, y: 160 },
    { width: 43, height: 41 },
    {
      anchor: CENTER,
      scale: 0.75,
      note: 'Bottom-center Lifesteal badge, sharing the Trigger position.'
    }
  ),
  aura: placement(
    { x: 80, y: 20 },
    { width: 38, height: 38 },
    {
      anchor: CENTER,
      note: 'Top-center Aura badge, layered above every other minion mark.'
    }
  ),
  elusive: placement(
    { x: 80, y: 88 },
    { width: 113, height: 155 },
    { anchor: CENTER, note: 'Elusive portrait overlay.' }
  ),
  immune: placement(
    { x: 83, y: 88 },
    { width: 125, height: 167 },
    {
      anchor: CENTER,
	  scale: 1.2,
	  note: 'Immune portrait overlay.' }
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
  /** Label nudges in minion-local pixels from each badge center; positive y moves down. */
  statValueOffsets: {
    attack: { x: 3, y: 3 },
    health: { x: 0, y: 3 }
  },
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
  /** Battlecry banner: grows to authored scale, then fades once the trigger resolves. */
  battlecryBanner: {
    startScale: 0.35,
    growDuration: 0.3,
    fadeDuration: 0.2
  },
  /** Taunt shield pop: grows from zero past authored scale, then settles. */
  tauntPop: {
    overshootScale: 1.1,
    growDuration: 0.22,
    settleDuration: 0.14
  },
  selectionScale: 1.15
} as const
