/**
 * Geometry for the right-hand deck panel (deck list + deck editor) inside the
 * Collection scene. All values are 1920x1080 design-canvas pixels at 1x.
 */

import { GAME_HEIGHT, GAME_WIDTH } from '../../visual-components/layout'
import { CENTER, placement } from '../../visual-components/layout'
import { COLLECTION_LAYOUT } from './collection-layout'

/** Height of one deck entry button, including its transparent padding. */
export const DECK_BUTTON_HEIGHT = 151
// The button textures include transparent padding around their visible frames.
// A negative layout gap brings the visible frames closer together.
export const DECK_BUTTON_GAP = -30

export const DECK_EDITOR_CARD_ROW_HEIGHT = 34
export const DECK_EDITOR_CARD_ROW_GAP = 1
export const DECK_EDITOR_ROW_INSET = 2
export const DECK_EDITOR_CARD_LIST_VISIBLE_ROWS = 25
export const DECK_EDITOR_CARD_LIST_HEIGHT =
  DECK_EDITOR_CARD_ROW_HEIGHT * DECK_EDITOR_CARD_LIST_VISIBLE_ROWS +
  DECK_EDITOR_ROW_INSET

export const DECK_EDITOR_LAYOUT = {
  header: placement(
    {
      x:
        COLLECTION_LAYOUT.deckList.position.x +
        COLLECTION_LAYOUT.deckList.size.width / 2,
      y: 64
    },
    { width: COLLECTION_LAYOUT.deckList.size.width, height: DECK_BUTTON_HEIGHT },
    { anchor: CENTER, note: 'Deck frame preview in the editor header.' }
  ),
  deckNameInput: placement(
    { x: 1525, y: 94 },
    { width: 230, height: 32 },
    { anchor: CENTER, note: 'Editable deck name over the locked deck frame.' }
  ),
  count: placement(
    { x: 1495, y: 1038 },
    { width: 180, height: 40 },
    { anchor: CENTER, note: 'Deck card-count label.' }
  ),
  cardList: placement(
    {
      x: COLLECTION_LAYOUT.deckList.position.x + 10,
      y: 132
    },
    {
      width: COLLECTION_LAYOUT.deckList.size.width - 20,
      height: DECK_EDITOR_CARD_LIST_HEIGHT
    },
    { note: 'Scrollable deck-card rows.' }
  ),
  footerButton: placement(
    { x: 1660, y: 1038 },
    { width: 220, height: 70 },
    { anchor: CENTER, note: 'Finish editing the selected deck.' }
  )
} as const

export const DECK_EDITOR_COST_WIDTH = 27
export const DECK_EDITOR_COPIES_WIDTH = 24
export const DECK_EDITOR_TRANSITION_DURATION = 0.45
export const DECK_EDITOR_CONTENT_FADE_DURATION = 0.2
export const DECK_EDITOR_FRAME_TARGET_WIDTH = COLLECTION_LAYOUT.deckList.size.width
export const DECK_EDITOR_FRAME_CARD_LIST_GAP = 4
export const DECK_EDITOR_ROW_REMOVE_DURATION = 0.22
export const DECK_EDITOR_ROW_COLLAPSE_DURATION = 0.18
export const DECK_EDITOR_PREVIEW = {
  maxWidth: 190,
  maxHeight: 345,
  gap: 18,
  viewportPadding: 16
} as const

export const DECK_EDITOR_COUNT_FILL = 0xffffff

/** Collection-card-to-deck choreography, in seconds and design-canvas pixels. */
export const CARD_ADD_CHOREOGRAPHY = {
  flightDuration: 0.34,
  landingDuration: 0.1,
  rowStartScale: 0.88,
  rowLandingScale: 1.05,
  sourceGlowScale: 1.28
} as const

export const FULL_VIEWPORT = {
  x: 0,
  y: 0,
  width: GAME_WIDTH,
  height: GAME_HEIGHT
} as const
