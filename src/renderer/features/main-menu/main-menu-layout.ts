/**
 * Geometric and motion tuning for the Main Menu chest scene.
 *
 * Reference frames (all values are 1920x1080 design-canvas pixels at 1x):
 *   - `screen.origin` (0,0)      -> the full-screen table background.
 *   - `screenCenter` (960,540)   -> the `boxLayer` / `menuGroup` containers in
 *                                   MainMenuScene; the chest and its buttons are
 *                                   all declared as offsets from this point.
 *
 * The two chest lids are `PerspectiveMesh` elements driven by the hinged-door
 * choreography, so they do not have a single "position" like a Sprite. Their
 * tunable inputs are the `innerEdge` values below; the per-frame mesh geometry
 * is derived in `MainMenuScene.updateLidMeshes`.
 */

import type { LayoutPoint } from '../../rendering/layout'
import { CENTER, TOP_LEFT, placement } from '../../rendering/layout'
import { GAME_HEIGHT, GAME_WIDTH } from '../../rendering/layout'

export interface TransitionInsetRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export const MAIN_MENU_LAYOUT = {
  name: 'Main menu (chest)',
  screen: {
    origin: { x: 0, y: 0 } satisfies LayoutPoint,
    screenCenter: { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 } satisfies LayoutPoint,
    /** Full-screen felt background. */
    table: placement(
      { x: 0, y: 0 },
      { width: GAME_WIDTH, height: GAME_HEIGHT },
      {
        anchor: TOP_LEFT,
        note: 'Drawn at native 1920x1080, top-left anchored, filling the viewport.'
      }
    )
  },
  chest: {
    /** Wooden chest body, centered on the canvas. */
    box: placement(
      { x: 0, y: 0 },
      { width: 1345, height: 988 },
      {
        anchor: CENTER,
        note: 'Offsets are relative to screenCenter (960,540).'
      }
    ),
    /**
     * Inner edges of the closed lids, measured from the canvas center.
     * Positive x is rightward. MainMenuScene.createLidMesh converts these into
     * the mesh corner coordinates handed to createHingedDoorMesh.
     */
    leftLidInnerEdge: { x: 30, y: 0 } satisfies LayoutPoint,
    rightLidInnerEdge: { x: 0, y: 0 } satisfies LayoutPoint,
    /** Flip-card mount offset applied on the right lid's free edge. */
    centerPartOffset: { x: 0, y: 0 } satisfies LayoutPoint
  },
  menuButtons: {
    /** Play button, centered horizontally under the closed chest. */
    play: placement(
      { x: 0, y: -145 },
      { width: 355, height: 65 },
      {
        anchor: CENTER,
        note: 'Offsets are relative to screenCenter (960,540).'
      }
    ),
    /** Collection button, directly below the Play button. */
    collection: placement(
      { x: 0, y: -52 },
      { width: 426, height: 73 },
      {
        anchor: CENTER,
        note: 'Offsets are relative to screenCenter (960,540).'
      }
    )
  }
} as const

/** Durations for the chest opening and menu reveal choreography (seconds). */
export const MAIN_MENU_TIMING = {
  lidOpen: 0.6,
  menuReveal: 0.15
} as const

/** Hinged-door physics constants consumed by updateHingedDoor. */
export const MAIN_MENU_HINGE = {
  minWidth: 1,
  perspectiveDepth: 14
} as const

/** The inset the outgoing main menu collapses into during a transition. */
export const SCENE_SELECTION_GAP: TransitionInsetRect = {
  x: (GAME_WIDTH - 1090) / 2,
  y: (GAME_HEIGHT - 735) / 2,
  width: 1090,
  height: 735
}
