import { CENTER, placement } from '../../../visual-components/layout'
import { GAME_BOARD_LAYOUT } from '../game-scene-layout'

/** The lab's authored blast quads, expressed on the unshifted match canvas. */
export const MATCH_VFX_LAYOUT = {
  missileMargin: 145,
  areas: {
    remoteBoard: placement(
      { x: GAME_BOARD_LAYOUT.boardMinions.remote.centerX, y: 394 },
      { width: 1400, height: 370 },
      { anchor: CENTER }
    ),
    localBoard: placement(
      { x: GAME_BOARD_LAYOUT.boardMinions.local.centerX, y: 633 },
      { width: 1400, height: 370 },
      { anchor: CENTER }
    ),
    bothBoards: placement(
      { x: GAME_BOARD_LAYOUT.boardMinions.local.centerX, y: 514 },
      { width: 1400, height: 700 },
      { anchor: CENTER }
    ),
    remoteHero: placement(
      GAME_BOARD_LAYOUT.heroes.remote.position,
      { width: 280, height: 320 },
      { anchor: CENTER }
    ),
    localHero: placement(
      GAME_BOARD_LAYOUT.heroes.local.position,
      { width: 280, height: 320 },
      { anchor: CENTER }
    )
  }
} as const
