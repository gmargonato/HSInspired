import { CENTER, placement } from '../../../visual-components/layout'

export const SUMMON_GLOW_LAYOUT = {
  name: 'Summon glow',
  glow: placement(
    { x: 80, y: 90 },
    { width: 256, height: 256 },
    { anchor: CENTER, note: 'Centered over the board minion frame.' }
  ),
  buildup: 0.25,
  peak: 0.08,
  fade: 0.3
} as const
