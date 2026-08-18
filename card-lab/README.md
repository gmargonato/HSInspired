# Card Lab

Card Lab is an isolated card-data and rendering harness. It does not import the
game's scene manager or production actors. The game has a separate development
bridge, `CardViewScene`, that uses the same renderer without touching gameplay or
the Collection scene.

## Run it

```text
npm run card-lab:dev
```

Then choose any card ID from the input. The lab currently loads all 465 Basic
and Classic cards.

## In-game view

Run the game in development mode:

```text
npm run dev
```

Open the native `Scenes` menu and choose `Card View`. The left side contains a
scrollable button for every Basic and Classic card; clicking one renders it on
the right. Leaving the scene unloads the temporary view and its display tree.

For a deterministic PNG export, build first and run:

```text
npm run card-lab:build
node scripts/render-card.cjs --card-id classic_abomination --output artifacts/classic_abomination.png
```

Add `--premium` to exercise the premium asset path. Standard and premium cards
use one complete frame sprite. Card names are white with a black outline in
both modes; premium cards also switch their rules/effect text to white.

## Rendering boundary

The renderer is intentionally split into four small boundaries:

1. `card-catalog.ts` normalizes the JSON files into a stable card definition.
2. `card-render-plan.ts` converts a card definition into a pure, inspectable
   render plan. All card profiles use the same semantic tree in
   `card-minion-template.ts`.
3. `card-asset-manifest.ts` resolves only assets referenced by that plan.
4. `card-view.ts` turns either plan representation into a Pixi display object
   and accepts an artwork texture clipped to the art bounds.

This makes the plan testable without a renderer and makes the final `CardView`
usable in the collection scene or a game board later. A card is a display
object, not a scene: the same view can be instantiated many times for a hand,
board, preview, or tooltip.

The catalog has no artwork field, so cards without a matching `<card-id>.jpg`
file in `assets/images/artwork` render a neutral art placeholder. The artwork
resolver discovers ID-named JPGs automatically, while cards without artwork
remain unmapped. Artwork is passed to `CardView` without changing card data
normalization or layout rules.

## Card coordinate system

Every card uses a 620 x 900 design canvas. Source frame images are normalized to
that canvas at render time. Preview scaling in the lab is uniform and happens
after the card has been composed. Individual images, text boxes, masks, and
groups have their own named positions and dimensions.

Dynamic stat icons and rarity gems are loaded at their source dimensions. The
frame is the one intentional exception: it is fitted to the canonical 620 x
900 card canvas.

For manual number placement, edit `CARD_STAT_LABEL_OFFSETS` in
`card-minion-template.ts`. These offsets move only the mana, attack, health, or
durability text relative to its icon; the profile stat positions move the icon
and label together.

The shared card tree is organized as:

```text
card
|-- artwork
|-- frame
|-- name
|-- rules
|-- stats
|   |-- mana
|   |-- attack
|   `-- health-or-durability
|-- rarity
`-- overlays
```

When running Card Lab, enable Debug geometry to see the component boxes. The
Card Builder exposes the node tree for every profile. Select a node by clicking
it or by using the tree, drag it on the card, edit its geometry or typography,
toggle visibility, reset edits, and copy the current override values. Builder
edits are kept in browser local storage; export mode intentionally ignores them
for deterministic PNGs.
