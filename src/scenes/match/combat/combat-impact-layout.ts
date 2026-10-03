import { CENTER, placement } from '../../../visual-components/layout'
import { DAMAGE_INDICATOR_CANVAS } from './damage-indicator-layout'

/** Impact-local geometry; travel distances are in the board's design pixels. */
export const COMBAT_IMPACT_LAYOUT = {
  name: 'Combat impact',
  flash: placement(
    { x: 0, y: 0 },
    { width: 256, height: 256 },
    { anchor: CENTER, scale: 1.6, note: 'Overlapping white rays at contact.' }
  ),
  flashRotation: Math.PI / 4,
  flashCopies: 3,
  flashDuration: 0.1,
  flashExpansion: 1.35,
  glow: placement(
    { x: DAMAGE_INDICATOR_CANVAS.width / 2, y: DAMAGE_INDICATOR_CANVAS.height / 2 },
    { width: 256, height: 256 },
    { anchor: CENTER, scale: 1.05, note: 'Golden rays behind the damage burst.' }
  ),
  glowTint: 0xffcf32,
  glowDuration: 0.48,
  embers: {
    count: 28,
    anchor: CENTER,
    coneHalfAngle: Math.PI / 5,
    spawnRadius: 20,
    distanceMin: 140,
    distanceMax: 360,
    durationMin: 0.32,
    durationMax: 0.68,
    widthMin: 8,
    widthMax: 15,
    lengthMin: 22,
    lengthMax: 42,
    tint: 0xffdd65
  }
} as const
