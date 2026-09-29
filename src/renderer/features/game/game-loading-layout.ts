import { TOP_LEFT, placement } from '../../rendering/layout'

export const GAME_LOADING_LAYOUT = {
  name: 'Match loading',
  overlay: placement(
    { x: 0, y: 0 },
    { width: 1920, height: 1080 },
    { anchor: TOP_LEFT }
  ),
  progress: placement(
    { x: 724, y: 548 },
    { width: 474, height: 40 },
    { anchor: TOP_LEFT, note: 'Plain fill inside the loading overlay bar well.' }
  ),
  progressColor: 0x36b6b0
} as const
