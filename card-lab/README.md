# Card Lab

Card Lab is an isolated card-data and rendering harness. It does not import the
game's scene manager or production actors. The game has a separate development
bridge, `CardViewScene`, that uses the same renderer without touching gameplay or
the Collection scene.

## Run it

```text
npm run card-lab:dev
```

Then choose any card ID from the input. The lab currently loads all 475 Basic
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

Add `--premium` to exercise the premium asset path. Premium frame fragments
are included as an experimental layer; their animation/compositing can be
calibrated independently of the normal card renderer.

## Rendering boundary

The renderer is intentionally split into four small boundaries:

1. `card-catalog.ts` normalizes the JSON files into a stable card definition.
2. `card-render-plan.ts` converts a card definition into a pure, inspectable
   list of positioned texture, text, and placeholder layers.
3. `card-asset-manifest.ts` resolves only assets referenced by that plan.
4. `card-view.ts` turns the plan into a Pixi display object and can later accept
   an artwork texture clipped to the art bounds.

This makes the plan testable without a renderer and makes the final `CardView`
usable in the collection scene or a game board later. A card is a display
object, not a scene: the same view can be instantiated many times for a hand,
board, preview, or tooltip.

The current catalog has no artwork field, so cards render a neutral art
placeholder. Artwork can be added later by passing a texture to `CardView`
without changing card data normalization or layout rules.
