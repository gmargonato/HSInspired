import { placement } from '../../visual-components/layout'
import { GAME_BOARD_LAYOUT } from '../../scenes/match/game-scene-layout'

export const HERO_POWER_ANIM_LAYOUT = {
  name: 'Hero Power Anim',
  canvas: { width: 1920, height: 1080 },
  controls: placement({ x: 20, y: 20 }, { width: 350, height: 1040 }),
  board: GAME_BOARD_LAYOUT.board,
  heroes: GAME_BOARD_LAYOUT.heroes,
  minions: GAME_BOARD_LAYOUT.boardMinions,
  power: GAME_BOARD_LAYOUT.heroPowers.local,
  manaOverlay: GAME_BOARD_LAYOUT.heroPowers.manaOverlay,
  loopPauseMS: 750,
  hero: { health: 20, maxHealth: 30, armor: 0, attack: 0 },
  minion: { cardId: 'basic_chillwind_yeti', health: 2 }
} as const
