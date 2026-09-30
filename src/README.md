# Where to find the code

Start with the screen or behavior you want to change.

```text
src/
├── scenes/              Each screen and its complete workflow
├── visual-components/   Reusable graphics, controls, animation, and assets
├── game-rules/          Game content, deck rules, and match simulation
├── application/         Startup, navigation, and service connections
├── dev-tools/           Inspectors, visual labs, and debugging tools
└── desktop/             Windows, native menus, persistence, and the desktop bridge
```

| Change                                                    | Start here                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| Main-menu chest and buttons                               | `scenes/main-menu`                                           |
| Collection browsing and deck editing                      | `scenes/collection`                                          |
| Deck creation, including the separate New Deck route      | `scenes/collection/deck-builder`                             |
| Enlarged collection card preview and upgrade controls     | `scenes/collection/card-preview`                             |
| Deck selection, Arena, tavern brawl, settings             | The corresponding folder in `scenes`                         |
| Match board, heroes, minions, weapons, and powers         | `scenes/match/board`                                         |
| Hand placement and dragging                               | `scenes/match/hand`                                          |
| Targeting and attack gestures                             | `scenes/match/targeting`                                     |
| Combat motion and damage/heal feedback                    | `scenes/match/combat`                                        |
| AI decisions and workers used during a match              | `scenes/match/ai`                                            |
| Draw/play/reveal animation and event sequencing           | `scenes/match/presentation`                                  |
| Match loading, HUD, history, results                      | The corresponding folder in `scenes/match`                   |
| Opening hand and mulligan                                 | `scenes/match/game-mulligan-view.ts`                         |
| Card appearance across screens                            | `visual-components/cards`                                    |
| Textures, asset bundles, layout, common controls, effects | The corresponding folder in `visual-components`              |
| Card definitions, deck validation, and match rules        | `game-rules/content`, `game-rules/decks`, `game-rules/match` |
| Startup and concrete renderer services                    | `application/main.ts`, `application/services.ts`             |
| Routes, scene construction, and navigation                | `application/navigation`                                     |
| Injected service interfaces                               | `application/contracts`                                      |
| Session seed generation                                   | `application/match-seed.ts`                                  |
| Inspectors, labs, development runtime adapters            | `dev-tools`                                                  |
| Window lifecycle, native menus, files, desktop services   | `desktop/main`                                               |
| The bridge exposed to the game window                     | `desktop/preload`                                            |
| Message schemas shared by the desktop processes           | `desktop/contracts`                                          |

## Folder depth

Use one organizational level below each scene or subsystem as the default:
`scenes/match/board/*.ts`, `application/navigation/*.ts`, and
`visual-components/effects/*.ts`. Files with a common prefix stay together;
board heroes, minions, weapons, powers, and shadows are all directly in `board`.
The [board shadow guide](scenes/match/board/board-shadows.md) explains shadow tuning.

A folder earns its place by helping you find a group of related files. Usually
keep single-file helpers directly with their owner or in an existing related
group: the match seed is in `application`, deck-entry buttons are in `controls`,
and experimental outline directions are in `dev-tools/outline-lab`. Navigation
and contracts have several related files and remain useful groups.

Count depth from the owner, rather than from `src`. A collection workflow can
have `card-preview` and `deck-builder`; a match can have `hand` and `targeting`.
Keep these existing exceptions because their names describe distinct ownership
or required data conventions:

- `desktop/main`, `desktop/preload`, and `desktop/contracts` separate Electron
  processes and their message schemas. Main services and contract IPC schemas
  have one organizational level beneath those owners. Preload's implementation
  and type declaration stay together even though the folder is small.
- `game-rules/content` groups distinct catalogs. The card catalog keeps its
  expansion modules and JSON records together in `cards/sets`.
- `game-rules/match/__snapshots__` follows the test runner's snapshot convention.

Create folders for existing code. Review and document any new deeper nesting
here; do not add folders just to anticipate future work.

Keep a screen's scene adapter, views, controllers, layouts, and animations together.
A separately navigable screen can still belong to a larger workflow: collection
owns both deck creation and the full card-preview screen. The match's hover preview
belongs to match.

Reusable visual components belong in `visual-components`; scene-specific visuals
stay with their scene. Developer inspectors reusing a match component do not make
that component shared. Service contracts and route definitions belong to
`application`, rather than the visual component library. Visual lifecycle bases
may depend on injected contracts, but never on application service implementations.

`game-rules` runs without Electron, PixiJS, DOM, or Node APIs. `desktop/main` owns
platform services; `desktop/preload` exposes their narrow bridge. These process
boundaries remain enforced even though scenes now live directly under `src`.

Route IDs (including `game` and `new-deck`), class names, saved data, asset keys,
and layout/tuning values are independent of folder names. Binary assets remain at
the repository's root `assets` folder. Build output retains Electron's
`out/main`, `out/preload`, and `out/renderer` conventions.

See [AGENTS.md](../AGENTS.md) for ownership rules and
[the source-layout tracker](../docs/source-layout.md) for the move inventory,
validation results, and remaining adjacent issues.
