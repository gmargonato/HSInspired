import { CENTER, placement } from '../../../visual-components/layout'
import { GAME_BOARD_LAYOUT } from '../game-scene-layout'

/** The lab's authored blast quads, expressed on the unshifted match canvas. */
export const MATCH_VFX_LAYOUT = {
  missileMargin: 145,
  // Unity's 0.1 world-unit shake is calibrated to design pixels on our 2D board.
  fireShake: { amplitude: 3, pulses: 9, duration: 2.15, damped: true },
  areas: {
    remoteBoard: placement(
      { x: GAME_BOARD_LAYOUT.boardMinions.remote.centerX, y: 365 },
      { width: 1180, height: 235 },
      { anchor: CENTER }
    ),
    localBoard: placement(
      { x: GAME_BOARD_LAYOUT.boardMinions.local.centerX, y: 645 },
      { width: 1180, height: 265 },
      {
        anchor: CENTER,
        note: 'Extend 30px toward the lower rim; keep the top edge fixed.'
      }
    ),
    bothBoards: placement(
      { x: GAME_BOARD_LAYOUT.boardMinions.local.centerX, y: 505 },
      { width: 1180, height: 500 },
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
