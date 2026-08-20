# HSInspired

HSInspired is an Electron, TypeScript, and PixiJS card-game shell. The current
scope establishes production content, deck persistence, renderer composition,
and the first playable Game Scene opening sequence. Card play and full gameplay
rules remain future work.

## Setup and commands

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run content:check   # validate all registered JSON sets
npm run deps:check      # enforce dependency direction
npm run build:smoke     # build and inspect renderer output
npm run verify          # formatting, lint, types, architecture, tests, build smoke
```

The normal renderer starts at the Main Menu. To open the read-only developer
Card Inspector directly during renderer development:

```bash
VITE_DEV_START_ROUTE=card-inspector npm run dev
```

The startup branch is development-only, and `npm run build:smoke` fails if its
route or module markers appear in the production renderer output.

## Ownership map

- `src/game`: platform-neutral content, decks, validation, and match contracts.
- `src/shared`: small process-boundary contracts such as deck IPC and scene requests.
- `src/main`: Electron lifecycle, filesystem deck persistence, and IPC adapters.
- `src/preload`: the narrow runtime bridge exposed to the renderer.
- `src/renderer/src/app`: service composition, route types, and scene construction.
- `src/renderer/src/scenes`: lifecycle orchestration and full-screen scene adapters.
- `src/renderer/src/features`: feature-local views and state.
- `src/renderer/src/rendering`: production card layout and rendering.
- `src/renderer/src/ui`: reusable presentation infrastructure and asset registry.

See [ARCHITECTURE.md](ARCHITECTURE.md) for durable dependency rules and
[AGENTS.md](AGENTS.md) for the shortest navigation guide.

## Content and assets

Card JSON lives in `src/game/content/cards/sets`. Each set has a typed
registration module, and the runtime catalog runs the same validator used by
`content:check`. Classes, heroes, hero powers, and expansions have independent
catalogs. Card behavior is not parsed from English `rulesText`.

Runtime assets stay under `assets/images` and use semantic subdirectories.
Bespoke renderer assets are registered in
`src/renderer/src/ui/asset-registry`; card artwork is convention-driven by
exact `CardId`. Editable source material lives under `assets/source`, pending
artwork under `assets/images/card-artwork-to-do`, and obsolete card assets under
`assets/card-assets-archive`; these source-only paths are excluded from runtime
packages.

The renderer uses 1920 x 1080 scene coordinates and a 620 x 900 complete-card
coordinate system. Layout values belong beside the feature that owns them.

## Navigation and match readiness

Scenes emit typed `AppRoute` values. `SceneNavigator` is the app-level factory
that constructs destinations and injects `AppServices`; scenes do not construct
other concrete scenes. Decks persist as version 2 records with a required
`heroId`, and class legality is derived from the hero catalog. Supported legacy
version 1 deck files are migrated, while unsupported files are backed up before
a replacement version 2 file is initialized.

`MatchSetup` contains exactly two participant setups and an optional seed. The
opening match boundary now deals the Hearthstone opening hands, accepts
mulligan confirmations, grants the second player the Coin, and emits the first
turn draw as ordered serializable events. See [docs/MATCH.md](docs/MATCH.md).
