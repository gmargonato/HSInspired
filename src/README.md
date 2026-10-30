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

## Match layers and inspection

Match tables use `assets/images/table/board.png`, native-size local/remote golden
frames, and transparent 1920 x 1080 `corner-*.png` overlays. The asset registry
discovers corners at development startup/build and sorts their filename suffixes
numerically; there is no fixed theme count. Restart development or rebuild a
release after adding/removing files. The `game-table` bundle loads and uploads all
themes during match warm-up so the Pause menu can switch them immediately.
Each match starts with a random theme; Pause selections last for that match only.
With no corner files, the base still renders and the selector is hidden.
`scenes/match/board/table-view.ts` shares the composition between loading and play;
`table-layout.ts` owns cropped gold-frame placement. Gold follows the existing
500 class-win local unlock, including refresh when the match crosses the threshold.
Remote gold has a separate layer but remains disabled without opponent eligibility.

Match-wide stacking is declared in `scenes/match/match-layers.ts` and assigned by
`GameBoardView.mountMatchLayers`. Board/HUD/history thumbnails sit below transit
and combat, followed by indicators, passive previews and reveals, hands, pending
card selections, targeting arrows, and modal choices. Loading, settings and results
cover the match. Targeting arrows sit above selected minions and landing effects.
Mulligan transport temporarily sits above its dimmer until the opening completes.
The hand also stays above the dimmer during its opening slide and the dimmer fade.
Internal card/component z-indices only order siblings inside their own layer.
Outgoing choice controls use a dedicated modal-exit layer below hands.
Outgoing mulligan controls use a separate exit layer above the mulligan dimmer
and transport, but below new modal choices.

History keeps a fixed rail parent/depth when inspected. Hover desaturation applies
to gameplay layers without promoting the rail. The match's passive-inspection
predicate blocks history, deck details and board previews during card, attack and
hero-power gestures, including return animations. Delayed previews check the same
predicate before activation; modal choices can explicitly expose board inspection.

Expert AI attention samples provisional search candidates as brief, single-object
inspection gestures. Hand plays move only the considered card back downward,
preserving the fan's stacking order; board gestures highlight either the source
or a target, never both. After a 350 ms initial delay, gestures last 600-1000 ms
with 2-4 seconds of quiet between them. Consecutive gestures on the same object
are spaced at least 8 seconds apart. Cosmetic randomness does not use the match
or search RNG. Quiet gaps persist across decisions. Completion clears attention
immediately without delaying play. Timing lives in
`scenes/match/ai/ai-attention-controller.ts`; the downward hand offset lives in
`GAME_BOARD_LAYOUT.remoteHand.attentionDrop`. Easy and API modes do not emit
attention updates. Opponent backs retain card-instance associations internally
through draw, play, discard, and return presentation; faces remain concealed.

Committed opponent attacks independently highlight their actual defender in white
during wind-up and lunge, clearing at impact or interruption. This combat cue
applies to all opponent modes and never delays the attack. With the current
`BOARD_TIMING` values it lasts about 0.26 seconds.

## Card appearance tuning

`visual-components/cards/card-layout.ts` owns positions, sizes, typography, curves,
and layer order. `CARD_PROFILES` groups the settings by minion, spell, weapon, and
hero; differing finishes have adjacent `standard` and `premium` entries.

Coordinates use the 620 x 900 card canvas. Positive Y moves down. Name and rarity
children are relative to their assembly's `position`: move that position to move
the whole assembly, or change a child's placement to move only that element.
For example, `CARD_PROFILES.minion.rarity.premium.gem` adjusts the golden minion
gem, and `slot` adjusts its surround. Premium hero slots are built into the frame.

The asset registry owns authored image dimensions. Display-size adjustments stay
in the layout. `card-render-builder.ts` selects assets and constructs the semantic
render tree; it contains no visual calibration values. Restart the development
session to apply source changes.

Tradeable banners use `CARD_TRADEABLE_LAYOUT` at native size. In a match, the
banner's green outline indicates a legal trade independently of the card's play
outline, including during dragging. App startup and match loading retain the
banner's outline field and warm its shader before interaction.
`cards/tradeable-aura.ts` shares a card-width silhouette so the banner glow matches
the frame aura's thickness. The aura samples the current cost icon's alpha to
stay behind mana/health symbols without splitting the cached card face; the same
mask follows the card's perspective during dragging.

## Startup

Normal startup shows the HTML `app-start.png` splash while application-owned
menu resources load and upload to the GPU. `application/prepare-menu-resources.ts`
holds their asset scope and GPU residency for the renderer lifetime, including
shared card frames but excluding individual card artwork and match-only bundles.
Only selectable hero portraits belong to `deck-presentation`; transformation
portraits load with `game` and are combined with the menu portraits for matches.
Hero artwork and the shared frame are assembled during bundle acquisition, before
GPU uploads. `visual-components/hero-portrait-layout.ts` preserves the former
358 x 410 canvas and each artwork crop. The former outer-shadow margin stays
transparent; the supplied frame retains its inner shadow. `hero-artwork-mask.png`
clips art to the frame opening. Live `HeroPortrait` containers keep art and frame
together; complete composed textures serve history thumbnails, outlines and
shadow silhouettes. Bundle ownership releases generated textures after the final
scene releases them. Whole-portrait filters target the container; premium saturation
breathes only on the artwork. Both frame variants load before use. At least 500
class wins unlock the premium portrait and hero power for the local player only.
Menus use the displayed hero's class; matches retain the starting class's unlock
through hero/power replacements. The winning match refreshes its presentation when
it crosses the threshold. Deck-button artwork uses the same saturation unlock.
The deck-frame, nine New Deck portraits, Play-button, and Collection expansion-toggle
outline fields stay cached so silhouette generation happens during startup instead
of on menu visits.
Fonts, cached menu data, and texture loading overlap, with asset bundles decoded
in pairs and GPU uploads processed sequentially. Decks, player statistics, and
progression fill their renderer caches; preferences prime the main-process cache
while later reads still see current values. Failed data preloads remain retryable
by the menus instead of preventing the application from starting.
Menu shader paths are warmed offscreen before the first menu frame; the splash
then fades out over 1000 ms before input and queued navigation are enabled.
Development direct-start routes keep their existing preparation path.

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
