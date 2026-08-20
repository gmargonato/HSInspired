/**
 * Geometry for the Collection scene. All values are 1920x1080 design-canvas
 * pixels at 1x.
 *
 * The scene composes several independent regions on top of one 1920x1080
 * background: a card "page" on the left, a deck list on the right, and a set of
 * mana/search filters along the bottom. Each region below documents its size,
 * anchor, and alignment so a position can be read and tuned on its own.
 *
 * The cover and its lock are `PerspectiveMesh` elements (hinged doors). Their
 * `x`/`y` values are the hinge/corner inputs to `createHingedDoorMesh`, not a
 * Sprite anchor point.
 */

import { GAME_HEIGHT } from '../app/config'

/** The card page region (left side of the collection spread). */
export const PAGE_LEFT = 250
export const PAGE_TOP = 80
export const PAGE_RIGHT = 1380
export const PAGE_BOTTOM = GAME_HEIGHT - 80
export const PAGE_CENTER_X = (PAGE_LEFT + PAGE_RIGHT) / 2
export const PAGE_HEIGHT = PAGE_BOTTOM - PAGE_TOP
/** Width of the invisible left/right strips used to flip pages. */
export const PAGE_NAV_ZONE_WIDTH = 90

export const COLLECTION_LAYOUT = {
  name: 'Collection',

  /** The card page area, in canvas coordinates. */
  page: {
    x: PAGE_LEFT,
    y: PAGE_TOP,
    width: PAGE_RIGHT - PAGE_LEFT,
    height: PAGE_HEIGHT
  },

  /** Class name heading, centered above the page. */
  classLabel: { x: PAGE_CENTER_X, y: 115 },

  /** Page number label, centered below the page. */
  pageLabel: { x: PAGE_CENTER_X, y: 940 },

  /** 4x2 grid of cards inside the page area. */
  cardGrid: { x: 305, y: 145, width: 1000, height: 770 },

  /** Bottom filter row (mana crystals + search), in canvas coordinates. */
  collectionFilters: {
    mana: {
      /** Center of the first (leftmost) mana crystal. */
      firstCrystalCenter: { x: 450, y: 1030 },
      /** Center-to-center spacing between crystals. */
      gap: 65,
      /** Display size of one crystal (the 153x181 source is scaled down). */
      crystal: { width: 44, height: 52 },
      /** Crystals are rotated a quarter turn. */
      rotation: Math.PI / 2,
      /** Text label offset from the crystal center. */
      labelOffset: { x: 0, y: 0 }
    },
    /** The HTML search input overlay (not a Pixi sprite). */
    searchInput: { x: 1090, y: 1006, width: 205, height: 43 },
    /** Search clear button, anchored center. */
    searchClear: { x: 1323, y: 1026, width: 30, height: 30 },
    /** "No results" state image, centered. */
    noResults: { x: PAGE_CENTER_X, y: 480 }
  },

  /**
   * The collection cover (hinged on its left edge). `x`/`y` are the hinge
   * corner passed to createHingedDoorMesh; the authored texture is 1157x1080.
   */
  cover: { x: 242, y: 0 },

  /** The lock on the cover (hinged on its right edge), offset from the cover. */
  coverLock: { x: 905, y: 418 },

  /** The right-hand deck list region. */
  deckList: { x: 1404, y: 120, width: 283, height: 870 },

  /** The vertical scrollbar track for the deck list. */
  deckSlider: { x: 1705, minY: 50, maxY: 900 }
} as const
