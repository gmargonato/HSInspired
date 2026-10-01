import { CENTER, placement } from '../layout'

export const ARENA_REWARDS_LAYOUT = {
  name: 'Arena Rewards',
  overlayAlpha: 0.65,
  confirm: placement(
    { x: 960, y: 540 },
    { width: 235, height: 127 },
    { anchor: CENTER }
  ),
  spread: { centerX: 960, centerY: 540, radiusX: 440, radiusY: 300 },
  box: placement(
    { x: 0, y: 0 },
    { width: 1254, height: 1254 },
    { anchor: CENTER, scale: 300 / 1254 }
  ),
  dust: placement({ x: 0, y: 0 }, { width: 180, height: 243 }, { anchor: CENTER }),
  amount: placement({ x: 0, y: 0 }, { width: 0, height: 0 }, { anchor: CENTER }),
  cardScale: 0.35,
  entryDuration: 0.35,
  stagger: 0.08,
  revealDuration: 0.2,
  shrinkDuration: 0.35,
  backdropFadeDuration: 0.45
} as const

export function arenaRewardPosition(
  index: number,
  count: number
): { x: number; y: number } {
  const angle = (count === 2 ? 0 : -Math.PI / 2) + (index * Math.PI * 2) / count
  const spread = ARENA_REWARDS_LAYOUT.spread
  return {
    x: spread.centerX + Math.cos(angle) * spread.radiusX,
    y: spread.centerY + Math.sin(angle) * spread.radiusY
  }
}
