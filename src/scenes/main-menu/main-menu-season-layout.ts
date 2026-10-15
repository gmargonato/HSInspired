import { CENTER, TOP_LEFT, placement } from '../../visual-components/layout'

export const MAIN_MENU_SEASON_LAYOUT = {
  name: 'Main menu season reward',
  overlay: placement(
    { x: 0, y: 0 },
    { width: 1920, height: 1080 },
    { anchor: TOP_LEFT }
  ),
  medal: placement(
    { x: 960, y: 435 },
    { width: 512, height: 512 },
    {
      anchor: CENTER,
      scale: 0.66,
      note: '512px canvas; visible medal fitted to the approximately 285 by 325 socket.'
    }
  ),
  legendMedal: placement(
    { x: 957, y: 435 },
    { width: 512, height: 512 },
    {
      anchor: CENTER,
      scale: 0.66,
      note: '512px canvas; Legend gem fitted to the black hexagonal socket.'
    }
  ),
  legendRankNumber: placement(
    { x: 960, y: 425 },
    { width: 0, height: 0 },
    { anchor: CENTER, scale: 2.2, note: 'Legend position over the gem.' }
  ),
  rankLabel: placement({ x: 960, y: 775 }, { width: 0, height: 0 }, { anchor: CENTER }),
  collect: placement({ x: 955, y: 968 }, { width: 178, height: 97 }, { anchor: CENTER })
} as const
