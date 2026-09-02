/**
 * Geometry for the Collection scene. All values are 1920x1080 design-canvas
 * pixels at 1x.
 *
 * The scene composes several independent regions on top of one 1920x1080
 * background: a card "page" on the left, a deck list on the right, mana/search
 * filters along the bottom, and an expansion filter tray that slides up from
 * off-screen. Each region is declared with an explicit position, anchor, and size
 * following the layout contract.
 */

import { GAME_HEIGHT } from '../../rendering/layout'
import {
  CENTER,
  TOP_LEFT,
  placement,
  type LayoutPlacement,
  type LayoutPoint
} from '../../rendering/layout'
import type { CollectionCardGridLayout } from './collection-card-grid'

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

  /** Asset-free class selector markers along the top of the book page. */
  classFilters: {
    first: placement(
      { x: 258, y: 24 },
      { width: 82, height: 42 },
      {
        anchor: TOP_LEFT,
        note: 'First class filter marker; later markers use the shared gap.'
      }
    ),
    gap: 7
  },

  /** The card page area, in canvas coordinates. */
  page: placement(
    { x: PAGE_LEFT, y: PAGE_TOP },
    { width: PAGE_RIGHT - PAGE_LEFT, height: PAGE_HEIGHT },
    {
      anchor: TOP_LEFT,
      note: 'Card page display area on the left side of the book spread.'
    }
  ),

  /** Class name heading, centered above the page. */
  classLabel: placement(
    { x: PAGE_CENTER_X, y: 115 },
    { width: 0, height: 0 },
    {
      anchor: CENTER,
      note: 'Class name heading centered above the active page.'
    }
  ),

  /** Page number label, centered below the page. */
  pageLabel: placement(
    { x: PAGE_CENTER_X, y: 940 },
    { width: 0, height: 0 },
    {
      anchor: CENTER,
      note: 'Page pagination label centered below the active page.'
    }
  ),

  /** 4x2 grid of cards inside the page area. */
  cardGrid: placement(
    { x: 305, y: 145 },
    { width: 1000, height: 770 },
    {
      anchor: TOP_LEFT,
      note: '4x2 grid bounds for card rendering within the active page.'
    }
  ),

  /** Bottom filter row (mana crystals + search), in canvas coordinates. */
  collectionFilters: {
    mana: {
      /** Center of the first (leftmost) mana crystal. */
      firstCrystalCenter: { x: 450, y: 1030 } satisfies LayoutPoint,
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
      labelOffset: { x: 0, y: 0 } satisfies LayoutPoint
    },
    /** The HTML search input overlay (not a Pixi sprite). */
    searchInput: placement(
      { x: 1090, y: 1006 },
      { width: 205, height: 43 },
      {
        anchor: TOP_LEFT,
        note: 'HTML DOM search input overlay bounds.'
      }
    ),
    /** Search clear button, anchored center. */
    searchClear: placement(
      { x: 1323, y: 1026 },
      { width: 30, height: 30 },
      {
        anchor: CENTER,
        note: 'Clear search query button.'
      }
    ),
    /** "No results" state image, centered. */
    noResults: placement(
      { x: PAGE_CENTER_X, y: 480 },
      { width: 328, height: 226 },
      {
        anchor: CENTER,
        note: 'Centered graphic displayed when search returns no matching cards.'
      }
    )
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
    },
    /** Five expansion rows are visible before the list begins scrolling. */
    viewport: placement(
      { x: 235, y: 375 },
      { width: 312, height: 540 },
      {
        anchor: TOP_LEFT,
        note: 'Cropped expansion list window; five 116px rows at a -10px gap.'
      }
    ),
    /** Scroll handle centered over the narrow rail baked into the tray art. */
    slider: {
      x: 572,
      minY: 427,
      maxY: 859,
      handle: placement(
        { x: 572, y: 427 },
        { width: 34, height: 94 },
        {
          anchor: CENTER,
          note: 'Expansion-list scrollbar handle; aligned to the tray rail.'
        }
      )
    }
  },

  /**
   * The collection cover (hinged on its left edge). `position` is the hinge
   * corner passed to createHingedDoorMesh; authored texture is 1157x1080.
   */
  cover: placement(
    { x: 242, y: 0 },
    { width: 1157, height: 1080 },
    {
      anchor: TOP_LEFT,
      note: 'Hinged book cover mesh origin.'
    }
  ),

  /** The lock on the cover (hinged on its right edge), offset from the cover. */
  coverLock: placement(
    { x: 905, y: 418 },
    { width: 254, height: 244 },
    {
      anchor: TOP_LEFT,
      note: 'Hinged cover lock mesh origin, offset relative to cover.'
    }
  ),

  /** The right-hand deck list region. */
  deckList: placement(
    { x: 1404, y: 120 },
    { width: 283, height: 870 },
    {
      anchor: TOP_LEFT,
      note: 'Right-hand deck card list panel.'
    }
  ),

  /** The vertical scrollbar track for the deck list. */
  deckSlider: {
    x: 1705,
    minY: 50,
    maxY: 900,
    handle: placement(
      { x: 1705, y: 50 },
      { width: 34, height: 94 },
      {
        anchor: CENTER,
        note: 'Scrollbar handle slider.'
      }
    )
  }
} as const

/** Durations for collection-owned choreography (seconds). */
export const COLLECTION_TIMING = {
  expansionTraySlide: 0.35
} as const

/** 4x2 card grid constants used to build the page card placement. */
export const CARD_GRID_COLUMNS = 4
export const CARD_GRID_ROWS = 2
export const CARD_SLOT_PADDING_X = 10
export const CARD_SLOT_PADDING_Y = 12
export const CARD_GRID_LAYOUT: CollectionCardGridLayout = {
  x: COLLECTION_LAYOUT.cardGrid.position.x,
  y: COLLECTION_LAYOUT.cardGrid.position.y,
  width: COLLECTION_LAYOUT.cardGrid.size.width,
  height: COLLECTION_LAYOUT.cardGrid.size.height,
  columns: CARD_GRID_COLUMNS,
  rows: CARD_GRID_ROWS,
  paddingX: CARD_SLOT_PADDING_X,
  paddingY: CARD_SLOT_PADDING_Y
}

/** Cover reveal choreography durations (seconds) and hinge depths. */
export const COVER_LOCK_OPEN_DURATION = 0.45
export const COVER_OPEN_DURATION = 0.6
export const DOOR_MIN_WIDTH = 1
export const COVER_LOCK_PERSPECTIVE_DEPTH = 10
export const COVER_PERSPECTIVE_DEPTH = 14

/** Cards already at their deck copy limit are dimmed to this alpha. */
export const COMPLETED_COLLECTION_CARD_ALPHA = 0.25
/** Blur strength applied to the collection when the card preview opens. */
export const COLLECTION_PREVIEW_BLUR_STRENGTH = 4

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
