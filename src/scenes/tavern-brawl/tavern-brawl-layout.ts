import { CENTER, placement } from '../../visual-components/layout'
import { GAME_HEIGHT, GAME_WIDTH } from '../../visual-components/layout'

export const TAVERN_BRAWL_LAYOUT = {
  name: 'Tavern Brawl',
  background: placement(
    { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 },
    { width: GAME_WIDTH, height: GAME_HEIGHT },
    { anchor: CENTER }
  ),
  playButton: placement(
    { x: 1587, y: 871 },
    { width: 259, height: 259 },
    {
      anchor: CENTER,
      note: 'Centered over the glowing portal drawn into the background.'
    }
  ),
  wins: placement(
    { x: 880, y: 963 },
    { width: 0, height: 0 },
    {
      anchor: CENTER,
      note: 'Numeric lifetime wins centered in the field below the baked-in Wins label.'
    }
  ),
  backButton: placement(
    { x: 1665, y: 1048 },
    { width: 107, height: 47 },
    { anchor: CENTER }
  )
} as const
