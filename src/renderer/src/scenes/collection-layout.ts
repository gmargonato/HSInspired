/**
 * Geometry for the Collection scene. All values are 1920x1080 design-canvas
 * pixels at 1x.
 *
 * The scene composes several independent regions on top of one 1920x1080
 * background: a card "page" on the left, a deck list on the right, mana/search
 * filters along the bottom, and an expansion filter tray that slides up from
 * off-screen. Each region below documents its size, anchor, and alignment so a
 * position can be read and tuned on its own.
 *
 * The cover and its lock are `PerspectiveMesh` elements (hinged doors). Their
 * `x`/`y` values are the hinge/corner inputs to `createHingedDoorMesh`, not a
 * Sprite anchor point.
 */

import { GAME_HEIGHT } from '../app/config'
import { CENTER, TOP_LEFT, placement, type LayoutPlacement } from '../rendering/layout'

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
      /** Native crystal size with a uniform scale, local to each control. */
      crystal: placement(
        { x: 0, y: 0 },
        { width: 171, height: 165 },
        {
          anchor: CENTER,
          scale: 0.287,
          note: 'Native mana asset dimensions; placement is local to the control.'
        }
      ),
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
   * Expansion filter: a bottom-bar toggle that slides the set tray up from
   * below the 1080 canvas. Row buttons are a parameterized stack; do not
   * hand-place individual expansions.
   */
  expansionFilter: {
    toggle: placement(
      { x: 320, y: 1025 },
      { width: 102, height: 77 },
      {
        anchor: CENTER,
        note: 'Tray open/close toggle on the bottom filter bar.'
      }
    ),
    trayOpen: placement(
      { x: 243, y: 335 },
      { width: 369, height: 657 },
      {
        anchor: TOP_LEFT,
        note: 'Resting pose after the tray slides up from below the canvas.'
      }
    ),
    trayClosed: placement(
      { x: 243, y: GAME_HEIGHT },
      { width: 369, height: 657 },
      {
        anchor: TOP_LEFT,
        note: 'Fully below the 1080 canvas; only y is animated.'
      }
    ),
    buttons: {
      first: placement(
        { x: 235, y: 375 },
        { width: 312, height: 116 },
        {
          anchor: TOP_LEFT,
          note: 'First expansion row, canvas space. Later rows use gap.'
        }
      ),
      gap: -10
    }
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

/** Durations for collection-owned choreography (seconds). */
export const COLLECTION_TIMING = {
  expansionTraySlide: 0.35
} as const

/** Canvas-space placement for one expansion row in the sliding tray. */
export function getExpansionFilterButtonPlacement(index: number): LayoutPlacement {
  const { first, gap } = COLLECTION_LAYOUT.expansionFilter.buttons
  return placement(
    {
      x: first.position.x,
      y: first.position.y + index * (first.size.height + gap)
    },
    first.size,
    {
      anchor: first.anchor,
      note: 'Stacked expansion row; index 0 is Basic.'
    }
  )
}
