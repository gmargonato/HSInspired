# Card Lab

Card Lab is an isolated card-data and rendering harness. It does not import the
game's scene manager or production actors. The game uses the same renderer for
an in-collection contextual preview without coupling card composition to
gameplay scenes.

## Run it

```text
npm run card-lab:dev
```

Then choose any card ID from the input. The lab currently loads all Basic and
Classic card records (Hero Powers are kept out of the card catalog).

## In-game preview

Run the game in development mode and open the Collection:

```text
npm run dev
```

Right-click a card to open the contextual `CardViewScene` preview; the card
grows from its collection slot while the metadata panel appears beside it.
Click the backdrop or press Escape to return to the Collection.

For a deterministic PNG export, build first and run:

```text
npm run card-lab:build
node scripts/render-card.cjs --card-id classic_abomination --output artifacts/classic_abomination.png
```

The renderer uses one standard frame and stat set for every card. Card names are
white with a black outline; weapon rules/effect text is white while other card
types keep the standard dark rules text.

## Rendering boundary

The renderer is intentionally split into four small boundaries:

1. `card-catalog.ts` normalizes the JSON files into a stable card definition.
2. `card-render-plan.ts` converts a card definition into a pure, inspectable
   render plan. All card profiles use the same semantic tree in
   `card-minion-template.ts`.
3. `card-asset-manifest.ts` resolves only assets referenced by that plan.
4. `card-view.ts` turns either plan representation into a Pixi display object
   and accepts an artwork texture rendered behind the frame and cropped to the
   shared square bounds.

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
after the card has been composed. Artwork is a shared native-size 454 x 454
square behind the frame; a simple rectangular crop prevents legacy artwork
from bleeding outside the card while assets are being regenerated.

Dynamic stat icons and rarity gems are loaded at their source dimensions. The
frame is the one intentional exception: it is fitted to the canonical 620 x
900 card canvas. Rarity gems share one centered anchor directly below the card
title, leaving the rules area below them.

For manual label placement, edit `CARD_STAT_LABEL_OFFSETS` in
`card-minion-template.ts`. The `name` offset moves only the card name text,
while the mana, attack, health, armor, and durability offsets move only their
numbers relative to their icons. The profile positions move an icon and its
label together.

For weapon stat labels, edit the `attack` and `durability` entries in
`CARD_STAT_LABEL_OFFSETS`. Those offsets move the numbers over the weapon attack
and durability assets without moving the assets themselves. To move an entire
weapon asset and its number together, edit `SHARED_STATS.weaponAttack` or
`SHARED_STATS.weaponDefense` instead.

The shared card tree is organized as:

```text
card
|-- artwork
|-- frame
|-- name-banner
|-- name
|-- rules
|-- stats
|   |-- mana
|   |-- attack
|   `-- health/armor-or-durability
|-- rarity
`-- overlays
```

When running Card Lab, enable Debug geometry to see the component boxes. The
Card Builder exposes the node tree for every profile. Select a node by clicking
it or by using the tree, drag it on the card, edit its geometry or typography,
toggle visibility, reset edits, and copy the current override values. Builder
edits are kept in browser local storage; export mode intentionally ignores them
for deterministic PNGs.
