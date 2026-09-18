/**
 * Geometry for the Game Scene (board, heroes, decks, deck counts, versus,
 * mulligan, remote hand, turn controls, mana, and the your-turn flag). All
 * values are 1920x1080 design-canvas pixels at 1x, except the fanned `cards` /
 * `remoteHand` spreads which document their own parameters.
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
  TOP_LEFT,
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

  /** Full-screen board art, including the wooden play surface. */
  board: placement(
    { x: 0, y: 0 },
    { width: 1920, height: 1080 },
    {
      anchor: TOP_LEFT,
      scale: 1,
      note: 'Full design-canvas board artwork with its table background.'
    }
  ),

  cardPlay: {
    /** Shared local design-canvas rectangle accepting any playable card. */
    localDropZone: {
      x: 350,
      y: 290,
      width: 1230,
      height: 530
    }
  },
  cardChoice: {
    /** Dynamic choice panel is centered over the play surface while input is collected. */
    centerX: 960,
    centerY: 430,
    panelWidth: 650,
    panelPadding: 24,
    headingHeight: 48,
    optionWidth: 590,
    optionHeight: 62,
    optionGap: 12
  },

  boardMinions: {
    /** Local row, raised toward the board center and aligned with its drop zone. */
    local: {
      centerX: 985,
      baselineY: 610,
      maxSpan: 900,
      maxStep: 150,
      minionScale: 1
    },
    /** Remote (top) minion row; presentation stays empty in this phase. */
    remote: {
      centerX: 985,
      baselineY: 400,
      maxSpan: 900,
      maxStep: 150,
      minionScale: 1
    },
    /** Arc used when an existing minion changes sides without being recreated. */
    controlTransfer: {
      arcHeight: 28
    },
    /** Full-card hover preview positioned relative to the live board minion. */
    cardPreview: {
      scale: 0.4,
      gap: 18,
      viewportPadding: 20,
      viewportWidth: 1920,
      viewportHeight: 1080,
      fadeDuration: 0.12
    }
  },

  heroes: {
    /** Local hero portrait in its board slot (bottom of the screen). */
    local: placement(
      { x: 985, y: 830 },
      { width: 345, height: 433 },
      {
        anchor: CENTER,
        scale: 0.5
      }
    ),
    /** Remote hero portrait in its board slot (top of the screen). */
    remote: placement(
      { x: 985, y: 175 },
      { width: 345, height: 433 },
      {
        anchor: CENTER,
        scale: 0.5
      }
    ),
    /** Local hero banner used by the pre-match "versus" intro. */
    localIntro: placement(
      { x: 600, y: 700 },
      { width: 345, height: 433 },
      {
        anchor: CENTER,
        scale: 1
      }
    ),
    /** Remote hero banner used by the pre-match "versus" intro. */
    remoteIntro: placement(
      { x: 1350, y: 280 },
      { width: 345, height: 433 },
      {
        anchor: CENTER,
        scale: 1
      }
    ),
    /** Vertical distance from an intro hero anchor to its name label, multiplied by hero scale. */
    introLabelOffset: 225
  },

  weapons: {
    /** Local equipped weapon, screen-left of the local hero frame. */
    local: placement(
      { x: 800, y: 855 },
      { width: 240, height: 210 },
      {
        anchor: CENTER,
        note: 'Weapon is placed to the screen-left of the local hero.'
      }
    ),
    /** Remote equipped weapon, screen-left of the remote hero frame. */
    remote: placement(
      { x: 800, y: 200 },
      { width: 240, height: 210 },
      {
        anchor: CENTER,
        note: 'Weapon is placed to the screen-left of the remote hero.'
      }
    )
  },

  decks: {
    /** Empty-deck X offsets in canvas pixels: negative moves left, positive right. */
    fatigueOffsetX: { local: -20, remote: -20 },
    /** Local player's deck pile. */
    local: placement(
      { x: 1675, y: 645 },
      { width: 83, height: 181 },
      {
        anchor: CENTER,
        scale: 0.9
      }
    ),
    /** Remote player's deck pile. */
    remote: placement(
      { x: 1675, y: 340 },
      { width: 83, height: 181 },
      {
        anchor: CENTER,
        scale: 0.9
      }
    ),
    /** Local deck card count label, just right of the pile. */
    localCount: placement(
      { x: 1660, y: 775 },
      { width: 90, height: 60 },
      {
        anchor: CENTER
      }
    ),
    /** Remote deck card count label, just right of the pile. */
    remoteCount: placement(
      { x: 1660, y: 205 },
      { width: 90, height: 60 },
      {
        anchor: CENTER
      }
    )
  },

  /**
   * The end turn button on the right edge of the board, centred on the dark
   * notch in the board art between the two deck piles. It shows the "End Turn"
   * texture during the local player's turn and the "Enemy Turn" texture during
   * the remote player's turn.
   */
  endTurnButton: placement(
    { x: 1595, y: 495 },
    { width: 157, height: 86 },
    {
      anchor: CENTER,
      scale: 1
    }
  ),

  /**
   * "Your turn" banner, always centred on the board. It fades in while growing
   * from `yourTurnStartScale` up to its full `scale`, holds briefly, and fades
   * out — it never slides.
   */
  yourTurnFlag: placement(
    { x: 960, y: 520 },
    { width: 856, height: 345 },
    {
      anchor: CENTER,
      scale: 1
    }
  ),
  yourTurnStartScale: 0.5,

  /** End-of-match result frame, local hero portrait, and continuation prompt. */
  matchResult: {
    dustText: placement(
      { x: 935, y: 900 },
      { width: 160, height: 60 },
      { anchor: CENTER }
    ),
    dustIcon: placement(
      { x: 1025, y: 900 },
      { width: 180, height: 243 },
      { anchor: CENTER, scale: 0.3 }
    ),
    rewardError: placement(
      { x: 960, y: 880 },
      { width: 800, height: 50 },
      { anchor: CENTER }
    ),
    frame: placement(
      { x: 960, y: 540 },
      { width: 1374, height: 1145 },
      {
        anchor: CENTER,
        scale: 1,
        note: 'Win or defeat artwork centered over the blurred gameplay board.'
      }
    ),
    localHero: placement(
      { x: 960, y: 430 },
      { width: 345, height: 433 },
      {
        anchor: CENTER,
        scale: 1,
        note: 'Existing local HeroView promoted in front of the result artwork.'
      }
    ),
    continuePrompt: placement(
      { x: 960, y: 1015 },
      { width: 480, height: 56 },
      {
        anchor: CENTER,
        note: 'Belwe continuation prompt at the bottom center.'
      }
    ),
    blurStrength: 3
  },

  /**
   * Mana crystal plus "available/maximum" label for each player. The local
   * display sits right of the local hero above the hand; the smaller remote
   * display sits right of the remote hero below the remote hand of card backs.
   */
  mana: {
    localLabel: placement(
      { x: 1280, y: 1010 },
      { width: 90, height: 50 },
      {
        anchor: CENTER
      }
    ),
    remoteLabel: placement(
      { x: 1270, y: 47 },
      { width: 90, height: 50 },
      {
        anchor: CENTER
      }
    ),
    /**
     * Local mana crystal tray: one crystal per maximum crystal point, laid out
     * left to right. NOT a single placement — it is a parameterized spread:
     * only `firstCrystalCenter`, `gap`, and the local `crystal` placement are
     * edited here; the per-crystal math lives in `mana-tray.ts`. The tray
     * shares the local label's Y and starts just right of it.
     */
    crystals: {
      firstCrystalCenter: { x: 1345, y: 1015 },
      pendingRowOffsetY: 40,
      overloadCrystal: placement(
        { x: 0, y: 0 },
        { width: 49, height: 48 },
        {
          anchor: CENTER,
          scale: 38 / 49,
          note: 'Locked crystal artwork shared by current and pending overload rows.'
        }
      ),
      /** Center-to-center spacing between crystals. */
      gap: 33,
      /** Native crystal size with a uniform scale, local to each crystal. */
      crystal: placement(
        { x: 0, y: 0 },
        { width: 45, height: 47 },
        {
          anchor: CENTER,
          scale: 1,
          note: 'Native available/highlighted size; spent artwork is 44 x 45 at the same scale.'
        }
      )
    }
  },

  /** "Start of game" versus plate, centered behind the intro heroes. */
  versus: placement(
    { x: 960, y: 540 },
    { width: 273, height: 279 },
    {
      anchor: CENTER
    }
  ),

  /**
   * Hero power cards on the right of each hero portrait. They sit there from
   * the moment the board is created (showing the back face) and never move
   * during the opening choreography; they only flip when the first turn
   * starts, when used, and at the start of each new turn.
   */
  heroPowers: {
    /** Local hero power card, right of the local hero portrait. */
    local: placement(
      { x: 1160, y: 835 },
      { width: 150, height: 150 },
      {
        anchor: CENTER,
        scale: 1,
        note: 'Front art is 150x150; the back is 148x162, so both faces share this center.'
      }
    ),
    /** Remote hero power card, right of the remote hero portrait. */
    remote: placement(
      { x: 1160, y: 200 },
      { width: 150, height: 150 },
      {
        anchor: CENTER,
        scale: 1
      }
    ),
    /**
     * The cost gem drawn on top of the "up" face: the mana crystal sits
     * slightly above the card center, and the cost label is centered on the
     * crystal. Both offsets are relative to the card center.
     */
    manaOverlay: {
      crystalOffset: { x: 0, y: -54 } satisfies LayoutPoint,
      costOffset: { x: 0, y: 0 } satisfies LayoutPoint
    }
  },

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
      scale: 0.35,
      anchor: BOTTOM_CENTER
    },
    /** The confirm button shown under the mulligan hand. */
    confirmButton: placement(
      { x: 960, y: 875 },
      { width: 235, height: 127 },
      {
        anchor: CENTER
      }
    ),
    /** Waiting banner that replaces Confirm after the local mulligan is locked. */
    opponentStillChoosing: placement(
      { x: 960, y: 875 },
      { width: 636, height: 198 },
      {
        anchor: CENTER,
        scale: 0.8
      }
    ),
    /** "Choose your cards" banner at the top of the screen (top-center). */
    announcement: placement(
      { x: 960, y: 160 },
      { width: 721, height: 223 },
      {
        anchor: TOP_CENTER,
        scale: 0.8
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

  /** Reusable three-card selection surface used by Tracking and future Discover cards. */
  cardSelection: {
    cards: {
      centerX: 960,
      baselineY: 720,
      gap: 300,
      scale: 0.42,
      anchor: BOTTOM_CENTER
    },
    toggleButton: placement(
      { x: 550, y: 830 },
      { width: 235, height: 127 },
      { anchor: CENTER, note: 'Switches between the card picker and board inspection.' }
    )
  },

  /** Fanned remote hand of card backs, anchored bottom-center. */
  remoteHand: {
    centerX: 960,
    baselineY: 72,
    gap: 82,
    /** Compressed centre-to-centre step at a full hand. */
    compactGap: 58,
    scale: 0.22,
    /** Compressed card scale at a full hand. */
    compactScale: 0.16,
    /** Hand size at which the compact fan starts. */
    compactStartCount: 4,
    /** Hand size at which the compact fan reaches its maximum. */
    compactFullCount: 10,
    /** Upward tuck applied to the outer cards. */
    edgeTuck: 26,
    anchor: BOTTOM_CENTER,
    /** Per-back rotation step around the fan (radians). */
    rotationStep: 0.11
  },

  /**
   * The squeezed pose a card adopts at the deck pile while being dealt.
   * These are the start values of the deal animation, not a resting pose.
   */
  cardTravel: {
    slotScale: { x: 0.08, y: 0.24 } satisfies LayoutPoint,
    backScale: { x: 0.08, y: 0.12 } satisfies LayoutPoint,
    /** Small, upright pose used when an effect generates a hand card. */
    generatedSlotScale: 0.12,
    generatedBackScale: 0.1
  }
} as const
