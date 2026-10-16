import { CENTER, TOP_LEFT, placement } from '../../visual-components/layout'
import { MATCH_VFX_LAYOUT } from '../../scenes/match/presentation/match-vfx-layout'
import { GAME_BOARD_LAYOUT } from '../../scenes/match/game-scene-layout'

const CANVAS_SIZE = { width: 1920, height: 1080 }
const PREVIEW_PANEL = placement(
  { x: 40, y: 104 },
  { width: 1378, height: 936 },
  { anchor: TOP_LEFT }
)
const BOARD_OFFSET_X =
  PREVIEW_PANEL.position.x + PREVIEW_PANEL.size.width / 2 - CANVAS_SIZE.width / 2

export const VFX_LAB_LAYOUT = {
  name: 'VFX Lab',
  canvas: CANVAS_SIZE,
  board: placement(
    { x: BOARD_OFFSET_X, y: 0 },
    { width: CANVAS_SIZE.width, height: CANVAS_SIZE.height },
    {
      anchor: TOP_LEFT,
      note: 'Shifted to center the play surface in the visible preview panel.'
    }
  ),
  previewPanel: PREVIEW_PANEL,
  controls: placement(
    { x: 1458, y: 20 },
    { width: 442, height: 1040 },
    { anchor: TOP_LEFT }
  ),
  missile: {
    source: placement(
      {
        x: GAME_BOARD_LAYOUT.heroes.local.position.x + BOARD_OFFSET_X,
        y: GAME_BOARD_LAYOUT.heroes.local.position.y
      },
      { width: 76, height: 76 },
      { anchor: CENTER }
    ),
    target: placement(
      {
        x: GAME_BOARD_LAYOUT.heroes.remote.position.x + BOARD_OFFSET_X,
        y: GAME_BOARD_LAYOUT.heroes.remote.position.y
      },
      { width: 76, height: 76 },
      { anchor: CENTER }
    ),
    margin: 145,
    height: 176
  },
  aoe: {
    previewTargets: { gap: 140, maxPerRow: 7 },
    // Flame quads include room for broad billows. Logical target outlines stay
    // on the rows below; selecting both rows removes the internal seam.
    blasts: {
      enemyBoard: placement(
        {
          x: MATCH_VFX_LAYOUT.areas.remoteBoard.position.x + BOARD_OFFSET_X,
          y: MATCH_VFX_LAYOUT.areas.remoteBoard.position.y
        },
        MATCH_VFX_LAYOUT.areas.remoteBoard.size,
        { anchor: CENTER }
      ),
      friendlyBoard: placement(
        {
          x: MATCH_VFX_LAYOUT.areas.localBoard.position.x + BOARD_OFFSET_X,
          y: MATCH_VFX_LAYOUT.areas.localBoard.position.y
        },
        MATCH_VFX_LAYOUT.areas.localBoard.size,
        { anchor: CENTER }
      ),
      bothBoards: placement(
        {
          x: MATCH_VFX_LAYOUT.areas.bothBoards.position.x + BOARD_OFFSET_X,
          y: MATCH_VFX_LAYOUT.areas.bothBoards.position.y
        },
        MATCH_VFX_LAYOUT.areas.bothBoards.size,
        { anchor: CENTER }
      )
    },
    // Match rows and heroes, translated with the preview board artwork.
    zones: {
      enemyBoard: placement(
        {
          x: GAME_BOARD_LAYOUT.boardMinions.remote.centerX + BOARD_OFFSET_X,
          y: GAME_BOARD_LAYOUT.boardMinions.remote.baselineY
        },
        { width: 1100, height: 200 },
        { anchor: CENTER, note: 'Enemy minion row only.' }
      ),
      friendlyBoard: placement(
        {
          x: GAME_BOARD_LAYOUT.boardMinions.local.centerX + BOARD_OFFSET_X,
          y: GAME_BOARD_LAYOUT.boardMinions.local.baselineY
        },
        { width: 1100, height: 200 },
        { anchor: CENTER, note: 'Friendly minion row only.' }
      ),
      enemyHero: placement(
        {
          x: GAME_BOARD_LAYOUT.heroes.remote.position.x + BOARD_OFFSET_X,
          y: GAME_BOARD_LAYOUT.heroes.remote.position.y
        },
        { width: 220, height: 230 },
        { anchor: CENTER }
      ),
      friendlyHero: placement(
        {
          x: GAME_BOARD_LAYOUT.heroes.local.position.x + BOARD_OFFSET_X,
          y: GAME_BOARD_LAYOUT.heroes.local.position.y
        },
        { width: 220, height: 230 },
        { anchor: CENTER }
      )
    }
  },
  loopPauseMS: 500
} as const
