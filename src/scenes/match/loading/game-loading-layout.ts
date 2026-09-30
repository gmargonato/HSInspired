import { CENTER, TOP_LEFT, placement } from '../../../visual-components/layout'

export const GAME_LOADING_LAYOUT = {
  name: 'Match loading',
  panel: placement(
    { x: 960, y: 540 },
    { width: 855, height: 338 },
    {
      anchor: CENTER,
      note: 'Panel and progress shrink together around screen center.'
    }
  ),
  overlay: placement({ x: 0, y: 0 }, { width: 855, height: 338 }, { anchor: CENTER }),
  progress: placement(
    { x: -244, y: 3 },
    { width: 474, height: 46 },
    { anchor: TOP_LEFT, note: 'Plain fill inside the loading overlay bar well.' }
  ),
  progressColor: 0x36b6b0
} as const
