/**
 * Geometry for the Game Scene opening sequence (board, heroes, decks, versus,
 * mulligan, and remote hand). All values are 1920x1080 design-canvas pixels at
 * 1x, except the fanned `cards` / `remoteHand` spreads which document their own
 * parameters.
 *
 * Fanned layouts (mulligan hand of 3 or 4 cards, remote hand of card backs) are
 * NOT single placements: they are parameterized spreads. Only the parameters
 * are edited here; the per-card math lives in `hand-layout.ts` and
 * `GameBoardView.layoutRemoteHand`, so "three vs four cards" is never solved by
 * moving individual cards.
 */

import {
  BOTTOM_CENTER,
  CENTER,
  TOP_CENTER,
  placement,
  type LayoutPoint
} from '../../rendering/layout'

export const GAME_BOARD_LAYOUT = {
  name: 'Game board (opening sequence)',

  /** Reference frame: the design canvas is 1920x1080, origin top-left. */
  frame: {
    center: { x: 960, y: 540 } satisfies LayoutPoint,
    topLeft: { x: 0, y: 0 } satisfies LayoutPoint
  },

  /** The wooden play surface; board art is centered on the canvas. */
  board: placement(
    { x: 960, y: 540 },
    { width: 1443, height: 1046 },
    {
      anchor: CENTER,
      scale: 1,
      note: 'Board artwork is 1443x1046 authored and drawn at 1x.'
    }
  ),

  heroes: {
    /** Local hero portrait in its board slot (bottom of the screen). */
    local: placement(
      { x: 960, y: 852 },
      { width: 345, height: 433 },
      {
        anchor: CENTER,
        scale: 0.46
      }
    ),
    /** Remote hero portrait in its board slot (top of the screen). */
    remote: placement(
      { x: 960, y: 184 },
      { width: 345, height: 433 },
      {
        anchor: CENTER,
        scale: 0.46
      }
    ),
    /** Local hero banner used by the pre-match "versus" intro. */
    localIntro: placement(
      { x: 350, y: 665 },
      { width: 345, height: 433 },
      {
        anchor: CENTER,
        scale: 1
      }
    ),
    /** Remote hero banner used by the pre-match "versus" intro. */
    remoteIntro: placement(
      { x: 1540, y: 250 },
      { width: 345, height: 433 },
      {
        anchor: CENTER,
        scale: 1
      }
    ),
    /** Vertical distance from an intro hero anchor to its name label, multiplied by hero scale. */
    introLabelOffset: 265
  },

  decks: {
    /** Local player's deck pile. */
    local: placement(
      { x: 1650, y: 640 },
      { width: 83, height: 181 },
      {
        anchor: CENTER,
        scale: 0.82
      }
    ),
    /** Remote player's deck pile. */
    remote: placement(
      { x: 1650, y: 390 },
      { width: 83, height: 181 },
      {
        anchor: CENTER,
        scale: 0.82
      }
    )
  },

  /** "Start of game" versus plate, centered behind the intro heroes. */
  versus: placement(
    { x: 960, y: 540 },
    { width: 273, height: 279 },
    {
      anchor: CENTER
    }
  ),

  mulligan: {
    /**
     * Fanned local mulligan hand. The card origin is its bottom-center, so
     * `baselineY` is the shared bottom edge. The hand is 3 or 4 cards depending
     * on which seat is player two.
     */
    cards: {
      centerX: 960,
      baselineY: 710,
      gap: 250,
      scale: 0.38,
      anchor: BOTTOM_CENTER
    },
    /** The confirm button shown under the mulligan hand. */
    confirmButton: placement(
      { x: 960, y: 855 },
      { width: 235, height: 127 },
      {
        anchor: CENTER
      }
    ),
    /** "Choose your cards" banner at the top of the screen (top-center). */
    announcement: placement(
      { x: 960, y: 72 },
      { width: 721, height: 223 },
      {
        anchor: TOP_CENTER
      }
    ),
    /** Coin announcement shown when the local player goes second. */
    coinAnnouncement: placement(
      { x: 1450, y: 590 },
      { width: 646, height: 455 },
      {
        anchor: CENTER,
        scale: 0.55
      }
    ),
    /**
     * A single interactive mulligan card slot. Its origin (0,0) matches the
     * card's bottom-center, so a 620x900 card hangs above and centered on the
     * origin. The replace cross and label are drawn relative to that origin.
     */
    slot: {
      anchor: BOTTOM_CENTER,
      cardOffset: { x: -310, y: -900 } satisfies LayoutPoint, // -620/2, -900
      hitArea: { x: -310, y: -900, width: 620, height: 900 },
      replaceCrossOffset: { x: 0, y: -450 } satisfies LayoutPoint,
      replacedLabelOffset: { x: 0, y: 24 } satisfies LayoutPoint,
      overlayScale: 2
    }
  },

  /** Fanned remote hand of card backs, anchored bottom-center. */
  remoteHand: {
    centerX: 960,
    baselineY: 92,
    gap: 52,
    scale: 0.22,
    anchor: BOTTOM_CENTER,
    /** Per-back rotation step around the fan (radians). */
    rotationStep: 0.05
  },

  /**
   * The squeezed pose a card adopts at the deck pile while being dealt.
   * These are the start values of the deal animation, not a resting pose.
   */
  cardTravel: {
    slotScale: { x: 0.08, y: 0.24 } satisfies LayoutPoint,
    backScale: { x: 0.08, y: 0.12 } satisfies LayoutPoint
  }
} as const
