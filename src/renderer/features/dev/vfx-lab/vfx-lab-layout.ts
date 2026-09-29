import { CENTER, TOP_LEFT, placement } from '../../../rendering/layout'
import { GAME_BOARD_LAYOUT } from '../../game/game-scene-layout'

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
    // Flame quads include room for broad billows. Logical target outlines stay
    // on the rows below; selecting both rows removes the internal seam.
    blasts: {
      enemyBoard: placement(
        { x: 754, y: 394 },
        { width: 1400, height: 370 },
        { anchor: CENTER }
      ),
      friendlyBoard: placement(
        { x: 754, y: 633 },
        { width: 1400, height: 370 },
        { anchor: CENTER }
      ),
      bothBoards: placement(
        { x: 754, y: 514 },
        { width: 1400, height: 700 },
        { anchor: CENTER }
      ),
      enemyHero: placement(
        { x: 754, y: 175 },
        { width: 280, height: 320 },
        { anchor: CENTER }
      ),
      friendlyHero: placement(
        { x: 754, y: 830 },
        { width: 280, height: 320 },
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
