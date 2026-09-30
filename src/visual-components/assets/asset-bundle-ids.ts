/** Lazy asset bundles loaded by scene/feature ownership. */
export const ASSET_BUNDLE_IDS = {
  mainMenu: 'main-menu',
  arena: 'arena',
  tavernBrawl: 'tavern-brawl',
  deckSelection: 'deck-selection',
  deckPresentation: 'deck-presentation',
  game: 'game',
  gameLoading: 'game-loading',
  menuSettings: 'menu-settings',
  gameSettings: 'game-settings',
  collection: 'collection',
  cardPreview: 'card-preview',
  sharedUI: 'shared-ui',
  cardRendering: 'card-rendering'
} as const

/** Each board can be acquired before the full match bundle. */
export const GAME_BOARD_BUNDLE_IDS = [
  'game-board-1',
  'game-board-2',
  'game-board-3',
  'game-board-4',
  'game-board-5',
  'game-board-6',
  'game-board-7',
  'game-board-8',
  'game-board-9'
] as const
