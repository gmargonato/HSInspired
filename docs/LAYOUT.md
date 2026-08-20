# Scene layout

This document explains how the renderer describes the position, size, anchor,
and scale of every on-screen element, and how to read and tune those values.
It is the reference for both humans editing layouts and AI agents touching
renderer code.

## The problem this solves

A bare `{ x: 0, y: -145 }` is meaningless on its own. To understand a position
you also need to know:

1. **which reference frame** it lives in (a container at some screen point),
2. **where the element's anchor is** (`(0,0)` top-left .. `(1,1)` bottom-right),
3. **how large the element is** (its display size at scale 1), and
4. **whether it is scaled**.

The layout system bundles all four into one self-describing structure so a
layout number can be read and tuned without reading the surrounding animation
or input logic.

## The contract (`src/renderer/src/rendering/layout`)

Every layout entry is a `LayoutPlacement`:

```ts
interface LayoutPlacement {
  position: LayoutPoint // where the element's anchor point sits
  anchor: LayoutPoint // (0,0) top-left .. (1,1) bottom-right, like Pixi
  size: LayoutSize // display size at scale 1 (usually authored asset size)
  scale?: number // optional uniform scale; final size = size * scale
  note?: string // human hint
}
```

Build entries with the `placement(position, size, options?)` factory and the
anchor constants `TOP_LEFT`, `TOP_CENTER`, `CENTER`, `BOTTOM_CENTER`.

```ts
import { CENTER, placement } from '../rendering/layout'

play: placement(
  { x: 0, y: -145 },
  { width: 355, height: 65 },
  {
    anchor: CENTER,
    note: 'Play button, centered under the chest lid.'
  }
)
```

Apply a placement to a Pixi object with the helpers (use them for new code;
existing scenes also set `position`/`anchor`/`scale` directly while sourcing the
numbers from the layout module):

```ts
applyPlacement(sprite, value) // sets position + uniform scale
applyAnchor(sprite.anchor, value) // sets anchor
```

## Where layout lives

**One layout module per scene/feature, next to the feature that owns it.**
This matches the README rule "layout values belong beside the feature that
owns them."

| Scene / feature               | Layout module                                                       |
| ----------------------------- | ------------------------------------------------------------------- |
| Main menu                     | `src/renderer/src/scenes/main-menu-layout.ts`                       |
| Game board (opening sequence) | `src/renderer/src/features/game/game-scene-layout.ts`               |
| Hand fan math                 | `src/renderer/src/features/game/hand-layout.ts`                     |
| Deck selection                | `src/renderer/src/features/deck-selection/deck-selection-layout.ts` |
| New deck overlay              | `src/renderer/src/features/deck-builder/new-deck-layout.ts`         |
| Collection                    | `src/renderer/src/scenes/collection-layout.ts`                      |

Card rendering is the gold standard and lives under
`src/renderer/src/rendering/cards/card-layout.ts`: it uses a named 620x900 design
canvas (`CARD_CANVAS`), named regions per template (`nameBox`, `rulesBox`,
`stats.mana`, …), and label offsets relative to their icon
(`CARD_STAT_LABEL_OFFSETS`). Imitate it for any new richly-composed element.

## Two shapes of layout

1. **Fixed placements** use `placement()` — one element, one anchor, one size.
   Use these for backgrounds, heroes, decks, buttons, banners.
2. **Fanned / dynamic spreads** are not single placements. They are
   parameterized: a named config (`centerX`, `baselineY`, `gap`, `scale`,
   `anchor`) drives a pure function of the card count. The mulligan hand (3 or
   4 cards depending on seat) and the remote hand of card backs are both fanned
   spreads — never solve "3 vs 4 cards" by moving individual cards; tune the
   parameters and let `hand-layout.ts` (or the scene's fan math) handle the rest.

## Conventions

- All positions are on the **1920x1080 design canvas at 1x**, unless a layout
  module explicitly documents a local reference frame (e.g. the Main Menu chest
  pieces are offsets from the `screenCenter` frame at `(960, 540)`).
- `anchor` is normalized exactly like Pixi `Sprite.anchor`.
- `size` is the display size at scale 1 (usually the authored asset size from
  `src/renderer/src/ui/asset-registry`). Final on-screen size is `size * scale`.
- Sizes/anchors for each asset are available in the asset registry
  (`authoredWidth`/`authoredHeight`); the layout module is where they are
  recorded next to positions.
- Set a `label` on every placed Pixi object using the `zone.element` naming
  convention (e.g. `'game.board'`, `'chest.box'`). The dev overlay reads labels.
  Do not rename labels that are looked up by `getChildByLabel` (e.g.
  `'mulligan-announcement'`, `'mulligan-dark-overlay'`).
- Do not change layout values as a side effect of refactoring; the existing
  values are correct. Refactors reorganize and annotate, they do not move pixels.

## The dev layout overlay (F2)

`src/renderer/src/features/dev/layout-inspector` is a development-only overlay
that, for the active scene, annotates every labelled Pixi object with its name,
its bounding box, and its anchor ("registration") point. Toggle it with **F2**
while running `npm run dev`.

It is the live counterpart to the layout modules: open a `*-layout.ts` file to
read and tune values, then toggle the overlay to see them on screen.

The overlay is dev-only. `main.ts` imports it behind `import.meta.env.DEV` and
the `@dev-layout-inspector` alias resolves to an empty placeholder in
production, so it never reaches a production build. `npm run build:smoke`
verifies that dev-only markers do not leak.

## Adding a new scene

1. Create `*-layout.ts` next to the scene declaring a `*_LAYOUT` object with
   `placement()` entries, a documented reference frame, and notes.
2. Set `label` on every placed Pixi object, matching the layout keys.
3. Source all position/anchor/scale numbers from the module; keep animation
   timings in a separate `*_TIMING` block (do not mix geometry and timing).
4. For fanned/dynamic content, add a named config and keep the per-item math in
   one pure function (see `hand-layout.ts`).
5. Run `npm run verify`. Typecheck, deps:check, and the build smoke test will
   catch import-direction and dev-leak regressions.
