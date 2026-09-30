# Source layout migration

The source roots now use the approved names: scenes, visual-components, game-rules,
application, dev-tools, and desktop. Collection owns card-preview and deck-builder.
Service contracts and navigation definitions live in application; desktop message
contracts live in desktop/contracts. Assets and compiled output keep their paths.

## Stabilization checklist

The approved stabilization work preserves the current source layout and tuning.
Its starting inventory, asset hashes, Git status, and source/configuration snapshots
are in ignored `.tmp/source-stabilization`. The separate pre-existing modification
to `config/outline-tunings.json` and a deletion of `.github/workflows/ci.yml`
observed during verification remain outside the migration checkpoint.

| Work                                  | Status   | Completion gate                                                                                               |
| ------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| Starting inventory and known failures | Verified | Source/configuration captured; seven baseline failures reproduced                                             |
| Permanent artwork verification        | Verified | Actual Vite resolver checks all 1,623 files, 9 aliases and 4 served images; old mismatch rejected with exit 1 |
| Verification fixes                    | Verified | Six test failures corrected, seeded digests refreshed, types/lint/format pass; tuning unchanged               |
| Full validation                       | Verified | 1,854 tests passed, 1 skipped; formatting, lint, artwork, types, dependencies and production build pass       |
| Isolated runtime walkthrough          | Verified | Scene textures, overlay pause/resume, match input, mulligan, restarts and disposal pass                       |
| Documentation and Git checkpoint      | Verified | Results recorded, diff reviewed and complete migration committed locally                                      |

Large-file refactoring remains a separate follow-up.

### Stabilization results

`npm run verify` passes on the current layout, including both expensive AI suites
that were omitted from the earlier follow-up run. Dependency checks cover 922
modules and 2,652 dependencies. The production smoke check inspected 13 renderer
output files and confirmed that development-only code stays out of the build.

The seven captured test failures are resolved without changing gameplay or
manual tuning. Legacy outline migration tests now assert the migration of their
input rather than equality with independently tuned live presets. The weapon
outline mock implements its current interface, and the Mindbreaker availability
assertion agrees with the existing aura rule. Only six seeded snapshot digest
strings changed; both seeds retain their commands, legality, public events, and
effect traces. The checkpoint and preview/dispatch assertions remain in place.

The animation lab now handles friendly Beast targeting using its configured
preview minion. Generated `.tmp` artifacts are excluded from repository lint.
The effect runtime has formatting changes only, confirmed by syntax comparison.
All 586 source files and 109 existing test files remain accounted for; layout,
tuning, and asset bytes are unchanged from the stabilization baseline.

The permanent artwork check runs the actual resolver through Vite, checks every
artwork file and representative generated-card aliases, and compares served
image bytes for the four cards in the original gray-artwork report. An in-memory
fault reproducing the old path-prefix mismatch makes the check fail with exit 1.

The isolated Electron walkthrough passes across settings, main menu, collection,
new deck, card preview, deck selection, Arena, tavern brawl, and Card Inspector.
Scene textures, overlay pause/resume, and disposal of replaced roots are checked.
The match harness passes its functional assertions for opening/mulligan,
normal/premium hand input, target cancellation, pickup/return, two restarts, and
match disposal. Its 250 ms timing samples report a performance failure; this
smoke run establishes functionality, not performance acceptance. The temporary
profile is removed after the run, leaving the ordinary player profile untouched.

Architecture analyzer fixtures pass. The refreshed atlas has zero compiler
diagnostics and no configured dependency-boundary violations. Its existing
health findings and unresolved calls remain follow-up leads.

Evidence is in ignored `.tmp/source-stabilization`: `inventory.json`,
`baseline-tests.json`, `focused-tests.json`, `snapshot-comparison.json`,
`preview-check.log`, `artwork-fault.log`, `preservation.json`, `verify.log`,
`architecture-check.log`, `architecture-map.log`, `runtime.log`,
`runtime-walkthrough.json`, and `runtime-functional.json`. The match report is
`artifacts/match-performance/source-stabilization.json`. The move tables and
earlier validation sections below record the historical migration stages; the
checklist above reports the current stabilization status.

## Shallow layout follow-up

This follow-up uses one organizational level below each scene or subsystem owner
as the default. All board visuals and hero-power effects now live directly in
`scenes/match/board`; its shadow documentation is `board-shadows.md`. Single-file
wrappers were removed for the match seed, native menu, mulligan view, deck-entry
button, highlight filter, shadow caster, and experimental outline directions.
Navigation, contracts, collection workflows, and desktop process owners remain
meaningful groups. The source guide documents the catalog/data and test-framework
exceptions to the depth guideline.

The pre-follow-up state, all 586 source files, supporting configuration, and asset
hashes were captured in ignored `.tmp/shallow-source-layout`. There are 36 moves
and no application behavior or layout/tuning changes. The destination column in
the earlier complete move map below now points to the current layout.

### Definition of done for this follow-up

- Each of the 36 files has exactly one destination; all 586 source files and
  109 existing test files remain accounted for.
- Scenes and visual components have no extra organizational nesting; removed
  wrappers and empty folders are absent. Ownership/framework exceptions are named
  in the source guide.
- Source syntax is preserved except for the exact recorded path replacements.
  Card JSON, snapshots, styles, HTML, tuning, and binary assets are unchanged.
- Imports, desktop entry points, development aliases, asset lookups, and
  dependency boundaries resolve; the flattened seed exception allows only that
  helper, rather than other application implementations.
- Focused tests, type checks, lint, and formatting introduce no new failures
  relative to the captured baseline.
- The guide, architecture rules, and both migration inventories use current
  destinations; validation limitations and remaining work are explicit.

### Current status

All 36 moves are verified relative to the captured baseline. No implementation
work is pending for this follow-up. Thirteen folders were removed; the only
remaining folder containing just one file and no child folders is the test
runner's `__snapshots__` folder.

| Check               | Result                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preservation        | All 586 source files and 109 existing test files retained; all 3,239 declarations and complete source syntax preserved except for 145 recorded relative-path replacements; card JSON, snapshots, styles, HTML, and all 2,123 asset files unchanged                  |
| Depth               | Scenes have at most one organizational level below their owner; application, visual components, and dev-tools have at most one grouping level; no empty folders or retired paths remain                                                                             |
| Dependencies        | Passed: 922 modules and 2,650 dependencies; the scene-internals exception permits `application/match-seed.ts` while continuing to block concrete application services and navigation implementations                                                                |
| Focused tests       | 411 passed and the same existing minion-outline mock failure across 37 files and 412 tests; every test retains its previous status                                                                                                                                  |
| Type checks         | Node passes; web reports only the existing TS7030 in `dev-tools/hero-power-anim/hero-power-anim-model.ts:53`                                                                                                                                                        |
| Lint and formatting | Changed source, tooling, and documentation pass focused checks; the unrelated effect-runtime formatting issue remains untouched                                                                                                                                     |
| Vite and artwork    | All 35 relocated TypeScript modules transform; actual development and production alias targets exist and the production outline substitution remains intact; all 1,623 artwork files resolve through the actual Vite glob, including the four previously gray cards |
| Architecture        | Analyzer fixtures pass; the atlas is refreshed for the current paths                                                                                                                                                                                                |
| Documentation       | Both migration inventories point to existing final destinations; the source guide describes the shallow default, small-folder policy, and retained exceptions                                                                                                       |

This is targeted validation. The full suite, production build, and Electron
application were not rerun for this follow-up. Earlier production/runtime results
below describe the previous source-root migration. The in-memory Vite check
transforms modules and evaluates asset lookup without starting the application
or a listening development server. The existing test and web type errors remain
adjacent issues; no tuning values or unrelated behavior were changed.

Evidence is in ignored `.tmp/shallow-source-layout`: `inventory.json`,
`invariants.json`, `assets.json`, `tests.json`, `test-comparison.json`,
`deps.log`, `typecheck.log`, `lint.log`, `format-check.log`, `vite-check.json`,
`architecture-check.log`, and `architecture-map.log`.

### Move inventory

| Before                                                                       | After                                                    | Status   |
| ---------------------------------------------------------------------------- | -------------------------------------------------------- | -------- |
| `src/application/match-setup/match-seed.ts`                                  | `src/application/match-seed.ts`                          | Verified |
| `src/desktop/main/menu/dev-menu.ts`                                          | `src/desktop/main/dev-menu.ts`                           | Verified |
| `src/dev-tools/effects/outline-directions-dev.ts`                            | `src/dev-tools/outline-lab/outline-directions-dev.ts`    | Verified |
| `src/scenes/match/mulligan/game-mulligan-view.ts`                            | `src/scenes/match/game-mulligan-view.ts`                 | Verified |
| `src/visual-components/decks/deck-entry-button.ts`                           | `src/visual-components/controls/deck-entry-button.ts`    | Verified |
| `src/visual-components/effects/filters/highlight.ts`                         | `src/visual-components/effects/highlight.ts`             | Verified |
| `src/visual-components/effects/shadows/shadow-caster.ts`                     | `src/visual-components/effects/shadow-caster.ts`         | Verified |
| `src/scenes/match/board/hero-powers/effects/hero-power-effects-presenter.ts` | `src/scenes/match/board/hero-power-effects-presenter.ts` | Verified |
| `src/scenes/match/board/hero-powers/effects/priest-heal-effect.ts`           | `src/scenes/match/board/priest-heal-effect.ts`           | Verified |
| `src/scenes/match/board/hero-powers/effects/priest-heal-layout.ts`           | `src/scenes/match/board/priest-heal-layout.ts`           | Verified |
| `src/scenes/match/board/hero-powers/effects/shaman-totem-effect.ts`          | `src/scenes/match/board/shaman-totem-effect.ts`          | Verified |
| `src/scenes/match/board/hero-powers/effects/shaman-totem-layout.ts`          | `src/scenes/match/board/shaman-totem-layout.ts`          | Verified |
| `src/scenes/match/board/hero-powers/effects/warlock-life-tap-effect.ts`      | `src/scenes/match/board/warlock-life-tap-effect.ts`      | Verified |
| `src/scenes/match/board/hero-powers/effects/warlock-life-tap-layout.ts`      | `src/scenes/match/board/warlock-life-tap-layout.ts`      | Verified |
| `src/scenes/match/board/hero-powers/effects/warrior-armor-up-effect.ts`      | `src/scenes/match/board/warrior-armor-up-effect.ts`      | Verified |
| `src/scenes/match/board/hero-powers/effects/warrior-armor-up-layout.ts`      | `src/scenes/match/board/warrior-armor-up-layout.ts`      | Verified |
| `src/scenes/match/board/hero-powers/effects/warrior-tank-up-effect.ts`       | `src/scenes/match/board/warrior-tank-up-effect.ts`       | Verified |
| `src/scenes/match/board/hero-powers/effects/warrior-tank-up-layout.ts`       | `src/scenes/match/board/warrior-tank-up-layout.ts`       | Verified |
| `src/scenes/match/board/hero-powers/hero-power-layout.ts`                    | `src/scenes/match/board/hero-power-layout.ts`            | Verified |
| `src/scenes/match/board/hero-powers/hero-power-presentation.ts`              | `src/scenes/match/board/hero-power-presentation.ts`      | Verified |
| `src/scenes/match/board/heroes/hero-layout.ts`                               | `src/scenes/match/board/hero-layout.ts`                  | Verified |
| `src/scenes/match/board/heroes/hero-view.test.ts`                            | `src/scenes/match/board/hero-view.test.ts`               | Verified |
| `src/scenes/match/board/heroes/hero-view.ts`                                 | `src/scenes/match/board/hero-view.ts`                    | Verified |
| `src/scenes/match/board/minions/minion-layout.ts`                            | `src/scenes/match/board/minion-layout.ts`                | Verified |
| `src/scenes/match/board/minions/minion-outline-layering.test.ts`             | `src/scenes/match/board/minion-outline-layering.test.ts` | Verified |
| `src/scenes/match/board/minions/minion-outline-shape.ts`                     | `src/scenes/match/board/minion-outline-shape.ts`         | Verified |
| `src/scenes/match/board/minions/minion-stat-presentation.ts`                 | `src/scenes/match/board/minion-stat-presentation.ts`     | Verified |
| `src/scenes/match/board/minions/minion-view.test.ts`                         | `src/scenes/match/board/minion-view.test.ts`             | Verified |
| `src/scenes/match/board/minions/minion-view.ts`                              | `src/scenes/match/board/minion-view.ts`                  | Verified |
| `src/scenes/match/board/minions/sleeping-zs.ts`                              | `src/scenes/match/board/sleeping-zs.ts`                  | Verified |
| `src/scenes/match/board/shadows/board-shadow-layer.ts`                       | `src/scenes/match/board/board-shadow-layer.ts`           | Verified |
| `src/scenes/match/board/shadows/match-shadow-config.ts`                      | `src/scenes/match/board/match-shadow-config.ts`          | Verified |
| `src/scenes/match/board/shadows/README.md`                                   | `src/scenes/match/board/board-shadows.md`                | Verified |
| `src/scenes/match/board/weapons/weapon-layout.ts`                            | `src/scenes/match/board/weapon-layout.ts`                | Verified |
| `src/scenes/match/board/weapons/weapon-outline-shape.ts`                     | `src/scenes/match/board/weapon-outline-shape.ts`         | Verified |
| `src/scenes/match/board/weapons/weapon-view.ts`                              | `src/scenes/match/board/weapon-view.ts`                  | Verified |

## Starting state

- This follow-up preserves the existing uncommitted scene-first migration.
- Inventory: 586 source files, all captured before the follow-up.
- Snapshots, path map, and validation evidence: ignored `.tmp/source-organization`.
- The initial migration and its baseline issues are recorded in
  [renderer-reorganization.md](renderer-reorganization.md).

## Batches

| Destination       | Files | Status   |
| ----------------- | ----- | -------- |
| Source guide      | 1     | Verified |
| application       | 31    | Verified |
| desktop           | 61    | Verified |
| dev-tools         | 36    | Verified |
| game-rules        | 161   | Verified |
| scenes            | 235   | Verified |
| visual-components | 61    | Verified |

Every source file has one final destination below. No game rules, card content,
layout numbers, tuning settings, saved-data formats, routes, or class names are
changed. Retired roots and empty scene dev/transitions folders are removed.

## Definition of done

- Exactly the six approved source directories exist.
- Collection owns its card preview and deck creation implementations.
- All inventoried destinations exist; source declarations and numeric values are preserved.
- Imports, workers, assets, desktop entry points, build aliases, and tooling resolve.
- Dependency rules enforce the new ownership, with valid and invalid examples exercised.
- Relevant tests, type checks, lint, and formatting introduce no new failures.
- Production build excludes standalone development tools.
- Runtime startup, desktop bridge, navigation, overlays, and disposal work.
- Documentation reflects the actual paths and validation limitations.

## Validation

Validation completed on 2026-09-29. Evidence files are local, ignored artifacts
under `.tmp/source-organization`; they are not application dependencies.

| Check                      | Result                                                                                                                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Inventory and preservation | All 586 source files moved exactly once; no missing or unexpected files; all 109 existing test files retained; all 3,239 declarations preserved after normalizing paths/formatting; card JSON, snapshots, HTML, and styles unchanged                                                             |
| Source structure           | Exactly six source directories; no retired renderer/game/main/preload/shared roots or empty scene dev/transitions directories                                                                                                                                                                    |
| Dependencies               | Passed: 922 modules and 2,650 dependencies; valid fixtures produce zero violations and invalid fixtures exercise all 18 current rules                                                                                                                                                            |
| Tests                      | 1,628 passed, the same 7 pre-existing failures, 1 skipped across 107 files; every rerun test retains its status from the prior full run                                                                                                                                                          |
| Type checks                | Node passes; web has only the existing TS7030 at `src/dev-tools/hero-power-anim/hero-power-anim-model.ts:53`                                                                                                                                                                                     |
| Lint                       | Source and changed tooling pass focused lint; repository-wide lint still discovers the existing ignored preview bundle, with 277 errors and 6 warnings                                                                                                                                           |
| Formatting                 | Changed code and documentation pass; the existing formatting issue in `src/game-rules/match/effects/effect-runtime.ts` remains                                                                                                                                                                   |
| Production build           | Passed; explicit main, preload, and browser entry points work; 13 output text files inspected, standalone development markers excluded; workers/assets resolve                                                                                                                                   |
| Architecture               | Analyzer fixtures pass; atlas regenerated with no unclassified presentation or desktop files and no boundary violations; existing domain health findings and the single compiler diagnostic remain                                                                                               |
| Runtime                    | Actual Electron startup and bridge exercised in an isolated profile; settings, main menu, collection, new deck, card preview, deck selection, Arena, tavern brawl, Card Inspector, and return to main menu load textures and become active; overlay pause/resume and replaced-root disposal pass |

Two expensive, unchanged AI suites (`local-ai-artifact-scenarios.test.ts` and
`local-ai-decision-api.test.ts`, 219 tests) were not rerun in this follow-up. They
passed in the prior full run and their declarations are unchanged. The current
follow-up test run is not a new full-suite run.

The existing match harness also exercises normal/premium hand interactions,
target cancellation, pickup/return, two restarts, and match disposal before the
navigation walkthrough. Its short timing sample reports **FAIL**, as did the
earlier smoke runs; this verifies runtime functionality, not performance
acceptance. The separate navigation assertions report **PASS**. The application
data profile is disposable; the ordinary player profile is not used. Electron
was run outside the Codex sandbox because its GPU child process previously failed
inside that sandbox.

Evidence: `inventory.json`, `invariants.json`, `boundary-results.json`,
`test-comparison.json`, `tests.json`, `typecheck.log`, `deps.log`, `lint.log`,
`full-lint.log`, `final-format.log`, `build.log`, `architecture-check.log`,
`architecture-map.log`, `runtime.log`, and `runtime-walkthrough.json`.
The match diagnostic report is `artifacts/match-performance/source-layout.json`.

Every migration batch is complete and verified relative to the recorded baseline.
No implementation migration is pending. The remaining issues below are separate
from this reorganization.

## Remaining adjacent issues

The test, type, lint, and formatting issues recorded in the earlier validation
sections are resolved by the stabilization work above. No new `.test` files
remain in the repository.

- Large implementation files still need separate, behavior-preserving refactoring;
  the folder migration does not reduce their internal complexity.
- The architecture registry's missing domain entrypoint is now named
  `src/game-rules/match/ai/policy-planner.ts`; it was already missing before this
  follow-up. Existing unmapped domain files and health findings are review leads.
- Full performance acceptance requires a comparable baseline and is not
  established by short navigation/match smoke checks.

## Complete follow-up move map

| Before                                                                                | After                                                                      |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `src/game/arena/arena-opponent-pool.ts`                                               | `src/game-rules/arena/arena-opponent-pool.ts`                              |
| `src/game/arena/arena-rewards.ts`                                                     | `src/game-rules/arena/arena-rewards.ts`                                    |
| `src/game/arena/arena.test.ts`                                                        | `src/game-rules/arena/arena.test.ts`                                       |
| `src/game/arena/arena.ts`                                                             | `src/game-rules/arena/arena.ts`                                            |
| `src/game/arena/index.ts`                                                             | `src/game-rules/arena/index.ts`                                            |
| `src/game/content/cards/capability-inventory.test.ts`                                 | `src/game-rules/content/cards/capability-inventory.test.ts`                |
| `src/game/content/cards/capability-inventory.ts`                                      | `src/game-rules/content/cards/capability-inventory.ts`                     |
| `src/game/content/cards/card-catalog.ts`                                              | `src/game-rules/content/cards/card-catalog.ts`                             |
| `src/game/content/cards/card-definition.ts`                                           | `src/game-rules/content/cards/card-definition.ts`                          |
| `src/game/content/cards/card-effects.ts`                                              | `src/game-rules/content/cards/card-effects.ts`                             |
| `src/game/content/cards/card-validator.ts`                                            | `src/game-rules/content/cards/card-validator.ts`                           |
| `src/game/content/cards/generated-card-definitions.ts`                                | `src/game-rules/content/cards/generated-card-definitions.ts`               |
| `src/game/content/cards/index.ts`                                                     | `src/game-rules/content/cards/index.ts`                                    |
| `src/game/content/cards/sets/basic.json`                                              | `src/game-rules/content/cards/sets/basic.json`                             |
| `src/game/content/cards/sets/basic.ts`                                                | `src/game-rules/content/cards/sets/basic.ts`                               |
| `src/game/content/cards/sets/blackrock-mountain.json`                                 | `src/game-rules/content/cards/sets/blackrock-mountain.json`                |
| `src/game/content/cards/sets/blackrock-mountain.ts`                                   | `src/game-rules/content/cards/sets/blackrock-mountain.ts`                  |
| `src/game/content/cards/sets/classic.json`                                            | `src/game-rules/content/cards/sets/classic.json`                           |
| `src/game/content/cards/sets/classic.ts`                                              | `src/game-rules/content/cards/sets/classic.ts`                             |
| `src/game/content/cards/sets/gadgetzan-generated-content.ts`                          | `src/game-rules/content/cards/sets/gadgetzan-generated-content.ts`         |
| `src/game/content/cards/sets/goblins-vs-gnomes.json`                                  | `src/game-rules/content/cards/sets/goblins-vs-gnomes.json`                 |
| `src/game/content/cards/sets/goblins-vs-gnomes.ts`                                    | `src/game-rules/content/cards/sets/goblins-vs-gnomes.ts`                   |
| `src/game/content/cards/sets/index.ts`                                                | `src/game-rules/content/cards/sets/index.ts`                               |
| `src/game/content/cards/sets/journey-to-ungoro.json`                                  | `src/game-rules/content/cards/sets/journey-to-ungoro.json`                 |
| `src/game/content/cards/sets/journey-to-ungoro.ts`                                    | `src/game-rules/content/cards/sets/journey-to-ungoro.ts`                   |
| `src/game/content/cards/sets/knights-of-the-frozen-throne.json`                       | `src/game-rules/content/cards/sets/knights-of-the-frozen-throne.json`      |
| `src/game/content/cards/sets/knights-of-the-frozen-throne.ts`                         | `src/game-rules/content/cards/sets/knights-of-the-frozen-throne.ts`        |
| `src/game/content/cards/sets/league-of-explorers.json`                                | `src/game-rules/content/cards/sets/league-of-explorers.json`               |
| `src/game/content/cards/sets/league-of-explorers.ts`                                  | `src/game-rules/content/cards/sets/league-of-explorers.ts`                 |
| `src/game/content/cards/sets/mean-streets-of-gadgetzan.json`                          | `src/game-rules/content/cards/sets/mean-streets-of-gadgetzan.json`         |
| `src/game/content/cards/sets/mean-streets-of-gadgetzan.ts`                            | `src/game-rules/content/cards/sets/mean-streets-of-gadgetzan.ts`           |
| `src/game/content/cards/sets/naxxramas.json`                                          | `src/game-rules/content/cards/sets/naxxramas.json`                         |
| `src/game/content/cards/sets/naxxramas.ts`                                            | `src/game-rules/content/cards/sets/naxxramas.ts`                           |
| `src/game/content/cards/sets/one-night-in-karazhan.json`                              | `src/game-rules/content/cards/sets/one-night-in-karazhan.json`             |
| `src/game/content/cards/sets/one-night-in-karazhan.ts`                                | `src/game-rules/content/cards/sets/one-night-in-karazhan.ts`               |
| `src/game/content/cards/sets/the-grand-tournament.json`                               | `src/game-rules/content/cards/sets/the-grand-tournament.json`              |
| `src/game/content/cards/sets/the-grand-tournament.ts`                                 | `src/game-rules/content/cards/sets/the-grand-tournament.ts`                |
| `src/game/content/cards/sets/whispers-of-the-old-gods.json`                           | `src/game-rules/content/cards/sets/whispers-of-the-old-gods.json`          |
| `src/game/content/cards/sets/whispers-of-the-old-gods.ts`                             | `src/game-rules/content/cards/sets/whispers-of-the-old-gods.ts`            |
| `src/game/content/cards/spell-damage-text.ts`                                         | `src/game-rules/content/cards/spell-damage-text.ts`                        |
| `src/game/content/cards/zombeast.ts`                                                  | `src/game-rules/content/cards/zombeast.ts`                                 |
| `src/game/content/classes/class-catalog.ts`                                           | `src/game-rules/content/classes/class-catalog.ts`                          |
| `src/game/content/classes/index.ts`                                                   | `src/game-rules/content/classes/index.ts`                                  |
| `src/game/content/expansions/expansion-catalog.ts`                                    | `src/game-rules/content/expansions/expansion-catalog.ts`                   |
| `src/game/content/expansions/index.ts`                                                | `src/game-rules/content/expansions/index.ts`                               |
| `src/game/content/hero-powers/hero-power-catalog.ts`                                  | `src/game-rules/content/hero-powers/hero-power-catalog.ts`                 |
| `src/game/content/hero-powers/index.ts`                                               | `src/game-rules/content/hero-powers/index.ts`                              |
| `src/game/content/heroes/hero-catalog.ts`                                             | `src/game-rules/content/heroes/hero-catalog.ts`                            |
| `src/game/content/heroes/index.ts`                                                    | `src/game-rules/content/heroes/index.ts`                                   |
| `src/game/content/index.ts`                                                           | `src/game-rules/content/index.ts`                                          |
| `src/game/decks/curated-opponent-decks.ts`                                            | `src/game-rules/decks/curated-opponent-decks.ts`                           |
| `src/game/decks/curated-opponent-selection.ts`                                        | `src/game-rules/decks/curated-opponent-selection.ts`                       |
| `src/game/decks/deck-repository.ts`                                                   | `src/game-rules/decks/deck-repository.ts`                                  |
| `src/game/decks/deck-rules.ts`                                                        | `src/game-rules/decks/deck-rules.ts`                                       |
| `src/game/decks/deck-validation.test.ts`                                              | `src/game-rules/decks/deck-validation.test.ts`                             |
| `src/game/decks/deck-validation.ts`                                                   | `src/game-rules/decks/deck-validation.ts`                                  |
| `src/game/decks/deck.ts`                                                              | `src/game-rules/decks/deck.ts`                                             |
| `src/game/decks/expert-deck-strategy.ts`                                              | `src/game-rules/decks/expert-deck-strategy.ts`                             |
| `src/game/decks/index.ts`                                                             | `src/game-rules/decks/index.ts`                                            |
| `src/game/decks/opponent-archetype.ts`                                                | `src/game-rules/decks/opponent-archetype.ts`                               |
| `src/game/decks/opponent-archetypes.ts`                                               | `src/game-rules/decks/opponent-archetypes.ts`                              |
| `src/game/decks/opponent-assembly.ts`                                                 | `src/game-rules/decks/opponent-assembly.ts`                                |
| `src/game/decks/opponent-card-ratings.ts`                                             | `src/game-rules/decks/opponent-card-ratings.ts`                            |
| `src/game/decks/opponent-curated-assessment.ts`                                       | `src/game-rules/decks/opponent-curated-assessment.ts`                      |
| `src/game/decks/opponent-deck-draft.ts`                                               | `src/game-rules/decks/opponent-deck-draft.ts`                              |
| `src/game/decks/opponent-fill-pool.ts`                                                | `src/game-rules/decks/opponent-fill-pool.ts`                               |
| `src/game/decks/opponent-floors.ts`                                                   | `src/game-rules/decks/opponent-floors.ts`                                  |
| `src/game/decks/opponent-generator.test.ts`                                           | `src/game-rules/decks/opponent-generator.test.ts`                          |
| `src/game/decks/opponent-generator.ts`                                                | `src/game-rules/decks/opponent-generator.ts`                               |
| `src/game/decks/opponent-profiles.ts`                                                 | `src/game-rules/decks/opponent-profiles.ts`                                |
| `src/game/decks/opponent-strategy.ts`                                                 | `src/game-rules/decks/opponent-strategy.ts`                                |
| `src/game/decks/opponent-support.ts`                                                  | `src/game-rules/decks/opponent-support.ts`                                 |
| `src/game/index.ts`                                                                   | `src/game-rules/index.ts`                                                  |
| `src/game/match/ai/ai-types.ts`                                                       | `src/game-rules/match/ai/ai-types.ts`                                      |
| `src/game/match/ai/event-narrative.test.ts`                                           | `src/game-rules/match/ai/event-narrative.test.ts`                          |
| `src/game/match/ai/event-narrative.ts`                                                | `src/game-rules/match/ai/event-narrative.ts`                               |
| `src/game/match/ai/fair-hypothesis-checkpoint.test.ts`                                | `src/game-rules/match/ai/fair-hypothesis-checkpoint.test.ts`               |
| `src/game/match/ai/fair-hypothesis-checkpoint.ts`                                     | `src/game-rules/match/ai/fair-hypothesis-checkpoint.ts`                    |
| `src/game/match/ai/index.ts`                                                          | `src/game-rules/match/ai/index.ts`                                         |
| `src/game/match/ai/information-set-mcts.test.ts`                                      | `src/game-rules/match/ai/information-set-mcts.test.ts`                     |
| `src/game/match/ai/information-set-mcts.ts`                                           | `src/game-rules/match/ai/information-set-mcts.ts`                          |
| `src/game/match/ai/legal-commands.ts`                                                 | `src/game-rules/match/ai/legal-commands.ts`                                |
| `src/game/match/ai/observation.ts`                                                    | `src/game-rules/match/ai/observation.ts`                                   |
| `src/game/match/ai/tactical-search.ts`                                                | `src/game-rules/match/ai/tactical-search.ts`                               |
| `src/game/match/ai-bonuses.ts`                                                        | `src/game-rules/match/ai-bonuses.ts`                                       |
| `src/game/match/contracts.test.ts`                                                    | `src/game-rules/match/contracts.test.ts`                                   |
| `src/game/match/contracts.ts`                                                         | `src/game-rules/match/contracts.ts`                                        |
| `src/game/match/cthun.ts`                                                             | `src/game-rules/match/cthun.ts`                                            |
| `src/game/match/dev-deck-commands.test.ts`                                            | `src/game-rules/match/dev-deck-commands.test.ts`                           |
| `src/game/match/effects/audit-gaps.integration.test.ts`                               | `src/game-rules/match/effects/audit-gaps.integration.test.ts`              |
| `src/game/match/effects/audit-regressions.integration.test.ts`                        | `src/game-rules/match/effects/audit-regressions.integration.test.ts`       |
| `src/game/match/effects/battlecry-condition-preview.test.ts`                          | `src/game-rules/match/effects/battlecry-condition-preview.test.ts`         |
| `src/game/match/effects/battlecry-presentation.integration.test.ts`                   | `src/game-rules/match/effects/battlecry-presentation.integration.test.ts`  |
| `src/game/match/effects/capability.test.ts`                                           | `src/game-rules/match/effects/capability.test.ts`                          |
| `src/game/match/effects/capability.ts`                                                | `src/game-rules/match/effects/capability.ts`                               |
| `src/game/match/effects/catalog-smoke.test.ts`                                        | `src/game-rules/match/effects/catalog-smoke.test.ts`                       |
| `src/game/match/effects/combat-keywords.integration.test.ts`                          | `src/game-rules/match/effects/combat-keywords.integration.test.ts`         |
| `src/game/match/effects/continuous-effects.test.ts`                                   | `src/game-rules/match/effects/continuous-effects.test.ts`                  |
| `src/game/match/effects/effect-context.ts`                                            | `src/game-rules/match/effects/effect-context.ts`                           |
| `src/game/match/effects/effect-primitives.ts`                                         | `src/game-rules/match/effects/effect-primitives.ts`                        |
| `src/game/match/effects/effect-queries.ts`                                            | `src/game-rules/match/effects/effect-queries.ts`                           |
| `src/game/match/effects/effect-runtime.integration.test.ts`                           | `src/game-rules/match/effects/effect-runtime.integration.test.ts`          |
| `src/game/match/effects/effect-runtime.ts`                                            | `src/game-rules/match/effects/effect-runtime.ts`                           |
| `src/game/match/effects/hero-power-targeting.integration.test.ts`                     | `src/game-rules/match/effects/hero-power-targeting.integration.test.ts`    |
| `src/game/match/effects/hero-power-use-limit.ts`                                      | `src/game-rules/match/effects/hero-power-use-limit.ts`                     |
| `src/game/match/effects/index.ts`                                                     | `src/game-rules/match/effects/index.ts`                                    |
| `src/game/match/effects/journey-to-ungoro.integration.test.ts`                        | `src/game-rules/match/effects/journey-to-ungoro.integration.test.ts`       |
| `src/game/match/effects/league-of-explorers.integration.test.ts`                      | `src/game-rules/match/effects/league-of-explorers.integration.test.ts`     |
| `src/game/match/effects/mana-actions.ts`                                              | `src/game-rules/match/effects/mana-actions.ts`                             |
| `src/game/match/effects/phase5-6.integration.test.ts`                                 | `src/game-rules/match/effects/phase5-6.integration.test.ts`                |
| `src/game/match/effects/query-runtime.test.ts`                                        | `src/game-rules/match/effects/query-runtime.test.ts`                       |
| `src/game/match/effects/reactive-triggers.integration.test.ts`                        | `src/game-rules/match/effects/reactive-triggers.integration.test.ts`       |
| `src/game/match/effects/resolution-presentation.integration.test.ts`                  | `src/game-rules/match/effects/resolution-presentation.integration.test.ts` |
| `src/game/match/effects/resolution-queue.test.ts`                                     | `src/game-rules/match/effects/resolution-queue.test.ts`                    |
| `src/game/match/effects/resolution-queue.ts`                                          | `src/game-rules/match/effects/resolution-queue.ts`                         |
| `src/game/match/effects/secrets.integration.test.ts`                                  | `src/game-rules/match/effects/secrets.integration.test.ts`                 |
| `src/game/match/effects/summon-actions.ts`                                            | `src/game-rules/match/effects/summon-actions.ts`                           |
| `src/game/match/effects/summon-placement.integration.test.ts`                         | `src/game-rules/match/effects/summon-placement.integration.test.ts`        |
| `src/game/match/effects/the-grand-tournament.integration.test.ts`                     | `src/game-rules/match/effects/the-grand-tournament.integration.test.ts`    |
| `src/game/match/effects/three-sets.integration.test.ts`                               | `src/game-rules/match/effects/three-sets.integration.test.ts`              |
| `src/game/match/effects/wiki-rules.integration.test.ts`                               | `src/game-rules/match/effects/wiki-rules.integration.test.ts`              |
| `src/game/match/history-recorder.ts`                                                  | `src/game-rules/match/history-recorder.ts`                                 |
| `src/game/match/history-visibility.ts`                                                | `src/game-rules/match/history-visibility.ts`                               |
| `src/game/match/index.ts`                                                             | `src/game-rules/match/index.ts`                                            |
| `src/game/match/kazakus-potion.ts`                                                    | `src/game-rules/match/kazakus-potion.ts`                                   |
| `src/game/match/match-command-parser.ts`                                              | `src/game-rules/match/match-command-parser.ts`                             |
| `src/game/match/match-fuzz.test.ts`                                                   | `src/game-rules/match/match-fuzz.test.ts`                                  |
| `src/game/match/match-history.ts`                                                     | `src/game-rules/match/match-history.ts`                                    |
| `src/game/match/match-public-projection.ts`                                           | `src/game-rules/match/match-public-projection.ts`                          |
| `src/game/match/match-setup.ts`                                                       | `src/game-rules/match/match-setup.ts`                                      |
| `src/game/match/match-state-snapshot.ts`                                              | `src/game-rules/match/match-state-snapshot.ts`                             |
| `src/game/match/match-types.ts`                                                       | `src/game-rules/match/match-types.ts`                                      |
| `src/game/match/match-validation.ts`                                                  | `src/game-rules/match/match-validation.ts`                                 |
| `src/game/match/match.ts`                                                             | `src/game-rules/match/match.ts`                                            |
| `src/game/match/opening-match-checkpoint.test.ts`                                     | `src/game-rules/match/opening-match-checkpoint.test.ts`                    |
| `src/game/match/opening-match-types.ts`                                               | `src/game-rules/match/opening-match-types.ts`                              |
| `src/game/match/opening-match.test.ts`                                                | `src/game-rules/match/opening-match.test.ts`                               |
| `src/game/match/opening-match.ts`                                                     | `src/game-rules/match/opening-match.ts`                                    |
| `src/game/match/prince-malchezaar.ts`                                                 | `src/game-rules/match/prince-malchezaar.ts`                                |
| `src/game/match/proof.ts`                                                             | `src/game-rules/match/proof.ts`                                            |
| `src/game/match/rng.ts`                                                               | `src/game-rules/match/rng.ts`                                              |
| `src/game/match/rules/card-cost-resource.ts`                                          | `src/game-rules/match/rules/card-cost-resource.ts`                         |
| `src/game/match/rules/index.ts`                                                       | `src/game-rules/match/rules/index.ts`                                      |
| `src/game/match/rules/invariants.test.ts`                                             | `src/game-rules/match/rules/invariants.test.ts`                            |
| `src/game/match/rules/invariants.ts`                                                  | `src/game-rules/match/rules/invariants.ts`                                 |
| `src/game/match/rules/minion-abilities.ts`                                            | `src/game-rules/match/rules/minion-abilities.ts`                           |
| `src/game/match/rules/minion-attack-state.ts`                                         | `src/game-rules/match/rules/minion-attack-state.ts`                        |
| `src/game/match/rules/runtime-state.test.ts`                                          | `src/game-rules/match/rules/runtime-state.test.ts`                         |
| `src/game/match/rules/zone-state.test.ts`                                             | `src/game-rules/match/rules/zone-state.test.ts`                            |
| `src/game/match/rules/zone-state.ts`                                                  | `src/game-rules/match/rules/zone-state.ts`                                 |
| `src/game/match/special-actions.integration.test.ts`                                  | `src/game-rules/match/special-actions.integration.test.ts`                 |
| `src/game/match/spell-damage.ts`                                                      | `src/game-rules/match/spell-damage.ts`                                     |
| `src/game/match/testing/ai-scenario-builder.ts`                                       | `src/game-rules/match/testing/ai-scenario-builder.ts`                      |
| `src/game/match/testing/match-scenario-builder.test.ts`                               | `src/game-rules/match/testing/match-scenario-builder.test.ts`              |
| `src/game/match/testing/match-scenario-builder.ts`                                    | `src/game-rules/match/testing/match-scenario-builder.ts`                   |
| `src/game/match/turn-match.ts`                                                        | `src/game-rules/match/turn-match.ts`                                       |
| `src/game/match/__snapshots__/opening-match-checkpoint.test.ts.snap`                  | `src/game-rules/match/__snapshots__/opening-match-checkpoint.test.ts.snap` |
| `src/game/progression/arcane-dust.ts`                                                 | `src/game-rules/progression/arcane-dust.ts`                                |
| `src/game/progression/premium-support.ts`                                             | `src/game-rules/progression/premium-support.ts`                            |
| `src/game/ranking/constructed-ranking.test.ts`                                        | `src/game-rules/ranking/constructed-ranking.test.ts`                       |
| `src/game/ranking/constructed-ranking.ts`                                             | `src/game-rules/ranking/constructed-ranking.ts`                            |
| `src/main/index.ts`                                                                   | `src/desktop/main/index.ts`                                                |
| `src/main/menu/dev-menu.ts`                                                           | `src/desktop/main/dev-menu.ts`                                             |
| `src/main/services/ai-config.ts`                                                      | `src/desktop/main/services/ai-config.ts`                                   |
| `src/main/services/ai-conversation-transcript.ts`                                     | `src/desktop/main/services/ai-conversation-transcript.ts`                  |
| `src/main/services/ai-decision-service.test.ts`                                       | `src/desktop/main/services/ai-decision-service.test.ts`                    |
| `src/main/services/ai-decision-service.ts`                                            | `src/desktop/main/services/ai-decision-service.ts`                         |
| `src/main/services/ai-ipc.ts`                                                         | `src/desktop/main/services/ai-ipc.ts`                                      |
| `src/main/services/ai-log.ts`                                                         | `src/desktop/main/services/ai-log.ts`                                      |
| `src/main/services/ai-provider-recovery.ts`                                           | `src/desktop/main/services/ai-provider-recovery.ts`                        |
| `src/main/services/ai-transport.test.ts`                                              | `src/desktop/main/services/ai-transport.test.ts`                           |
| `src/main/services/ai-transport.ts`                                                   | `src/desktop/main/services/ai-transport.ts`                                |
| `src/main/services/arena-ipc.ts`                                                      | `src/desktop/main/services/arena-ipc.ts`                                   |
| `src/main/services/arena-repository.test.ts`                                          | `src/desktop/main/services/arena-repository.test.ts`                       |
| `src/main/services/arena-repository.ts`                                               | `src/desktop/main/services/arena-repository.ts`                            |
| `src/main/services/atomic-file.ts`                                                    | `src/desktop/main/services/atomic-file.ts`                                 |
| `src/main/services/card-class-builder-ipc.ts`                                         | `src/desktop/main/services/card-class-builder-ipc.ts`                      |
| `src/main/services/card-class-builder-repository.test.ts`                             | `src/desktop/main/services/card-class-builder-repository.test.ts`          |
| `src/main/services/card-class-builder-repository.ts`                                  | `src/desktop/main/services/card-class-builder-repository.ts`               |
| `src/main/services/deck-ipc.ts`                                                       | `src/desktop/main/services/deck-ipc.ts`                                    |
| `src/main/services/deck-repository.ts`                                                | `src/desktop/main/services/deck-repository.ts`                             |
| `src/main/services/match-log-ipc.ts`                                                  | `src/desktop/main/services/match-log-ipc.ts`                               |
| `src/main/services/match-log-metadata.ts`                                             | `src/desktop/main/services/match-log-metadata.ts`                          |
| `src/main/services/match-log-model-attribution.test.ts`                               | `src/desktop/main/services/match-log-model-attribution.test.ts`            |
| `src/main/services/match-log-repository.ts`                                           | `src/desktop/main/services/match-log-repository.ts`                        |
| `src/main/services/match-log-transcript.ts`                                           | `src/desktop/main/services/match-log-transcript.ts`                        |
| `src/main/services/outline-tuning-ipc.ts`                                             | `src/desktop/main/services/outline-tuning-ipc.ts`                          |
| `src/main/services/outline-tuning-repository.test.ts`                                 | `src/desktop/main/services/outline-tuning-repository.test.ts`              |
| `src/main/services/outline-tuning-repository.ts`                                      | `src/desktop/main/services/outline-tuning-repository.ts`                   |
| `src/main/services/player-stats-ipc.ts`                                               | `src/desktop/main/services/player-stats-ipc.ts`                            |
| `src/main/services/player-stats-repository.test.ts`                                   | `src/desktop/main/services/player-stats-repository.test.ts`                |
| `src/main/services/player-stats-repository.ts`                                        | `src/desktop/main/services/player-stats-repository.ts`                     |
| `src/main/services/preferences-ipc.ts`                                                | `src/desktop/main/services/preferences-ipc.ts`                             |
| `src/main/services/preferences-repository.test.ts`                                    | `src/desktop/main/services/preferences-repository.test.ts`                 |
| `src/main/services/preferences-repository.ts`                                         | `src/desktop/main/services/preferences-repository.ts`                      |
| `src/main/services/serial-operation-queue.ts`                                         | `src/desktop/main/services/serial-operation-queue.ts`                      |
| `src/main/services/window-settings-ipc.ts`                                            | `src/desktop/main/services/window-settings-ipc.ts`                         |
| `src/main/services/window-settings-repository.ts`                                     | `src/desktop/main/services/window-settings-repository.ts`                  |
| `src/preload/index.d.ts`                                                              | `src/desktop/preload/index.d.ts`                                           |
| `src/preload/index.ts`                                                                | `src/desktop/preload/index.ts`                                             |
| `src/renderer/app/ai-bridge-recovery.test.ts`                                         | `src/application/ai-bridge-recovery.test.ts`                               |
| `src/renderer/app/ai-decision-api.ts`                                                 | `src/application/ai-decision-api.ts`                                       |
| `src/renderer/app/ai-retry-notice.test.ts`                                            | `src/application/ai-retry-notice.test.ts`                                  |
| `src/renderer/app/arena-store.ts`                                                     | `src/application/arena-store.ts`                                           |
| `src/renderer/app/config.ts`                                                          | `src/application/config.ts`                                                |
| `src/renderer/app/deck-store.ts`                                                      | `src/application/deck-store.ts`                                            |
| `src/renderer/app/logger.ts`                                                          | `src/application/logger.ts`                                                |
| `src/renderer/app/player-stats-store.test.ts`                                         | `src/application/player-stats-store.test.ts`                               |
| `src/renderer/app/player-stats-store.ts`                                              | `src/application/player-stats-store.ts`                                    |
| `src/renderer/app/progression-store.ts`                                               | `src/application/progression-store.ts`                                     |
| `src/renderer/app/renderer-production-placeholder.ts`                                 | `src/application/renderer-production-placeholder.ts`                       |
| `src/renderer/app/router.ts`                                                          | `src/application/navigation/router.ts`                                     |
| `src/renderer/app/scene-manager.ts`                                                   | `src/application/navigation/scene-manager.ts`                              |
| `src/renderer/app/scene-navigator.ts`                                                 | `src/application/navigation/scene-navigator.ts`                            |
| `src/renderer/app/services.ts`                                                        | `src/application/services.ts`                                              |
| `src/renderer/dev/card-inspector/card-inspector-controls.ts`                          | `src/dev-tools/card-inspector/card-inspector-controls.ts`                  |
| `src/renderer/dev/card-inspector/card-inspector-model.test.ts`                        | `src/dev-tools/card-inspector/card-inspector-model.test.ts`                |
| `src/renderer/dev/card-inspector/card-inspector-model.ts`                             | `src/dev-tools/card-inspector/card-inspector-model.ts`                     |
| `src/renderer/dev/card-inspector/card-inspector-scene.ts`                             | `src/dev-tools/card-inspector/card-inspector-scene.ts`                     |
| `src/renderer/dev/card-inspector/card-inspector.ts`                                   | `src/dev-tools/card-inspector/card-inspector.ts`                           |
| `src/renderer/dev/card-inspector/index.ts`                                            | `src/dev-tools/card-inspector/index.ts`                                    |
| `src/renderer/dev/effects/outline-directions-dev.ts`                                  | `src/dev-tools/outline-lab/outline-directions-dev.ts`                      |
| `src/renderer/dev/hero-power-anim/hero-power-anim-controls.ts`                        | `src/dev-tools/hero-power-anim/hero-power-anim-controls.ts`                |
| `src/renderer/dev/hero-power-anim/hero-power-anim-fixtures.ts`                        | `src/dev-tools/hero-power-anim/hero-power-anim-fixtures.ts`                |
| `src/renderer/dev/hero-power-anim/hero-power-anim-layout.ts`                          | `src/dev-tools/hero-power-anim/hero-power-anim-layout.ts`                  |
| `src/renderer/dev/hero-power-anim/hero-power-anim-model.ts`                           | `src/dev-tools/hero-power-anim/hero-power-anim-model.ts`                   |
| `src/renderer/dev/hero-power-anim/hero-power-anim-scene.ts`                           | `src/dev-tools/hero-power-anim/hero-power-anim-scene.ts`                   |
| `src/renderer/dev/hero-power-anim/hero-power-anim.ts`                                 | `src/dev-tools/hero-power-anim/hero-power-anim.ts`                         |
| `src/renderer/dev/layout-inspector/index.ts`                                          | `src/dev-tools/layout-inspector/index.ts`                                  |
| `src/renderer/dev/layout-inspector/layout-inspector.ts`                               | `src/dev-tools/layout-inspector/layout-inspector.ts`                       |
| `src/renderer/dev/outline-lab/aura-lab-elements.ts`                                   | `src/dev-tools/outline-lab/aura-lab-elements.ts`                           |
| `src/renderer/dev/outline-lab/index.ts`                                               | `src/dev-tools/outline-lab/index.ts`                                       |
| `src/renderer/dev/outline-lab/outline-lab-board.ts`                                   | `src/dev-tools/outline-lab/outline-lab-board.ts`                           |
| `src/renderer/dev/outline-lab/outline-lab-hand.ts`                                    | `src/dev-tools/outline-lab/outline-lab-hand.ts`                            |
| `src/renderer/dev/outline-lab/outline-lab-layout.ts`                                  | `src/dev-tools/outline-lab/outline-lab-layout.ts`                          |
| `src/renderer/dev/outline-lab/outline-lab-palettes.ts`                                | `src/dev-tools/outline-lab/outline-lab-palettes.ts`                        |
| `src/renderer/dev/outline-lab/outline-lab-scene.ts`                                   | `src/dev-tools/outline-lab/outline-lab-scene.ts`                           |
| `src/renderer/dev/outline-lab/outline-lab-shader-controls.ts`                         | `src/dev-tools/outline-lab/outline-lab-shader-controls.ts`                 |
| `src/renderer/dev/outline-lab/outline-lab.ts`                                         | `src/dev-tools/outline-lab/outline-lab.ts`                                 |
| `src/renderer/dev/outline-lab/shatter-lab.ts`                                         | `src/dev-tools/outline-lab/shatter-lab.ts`                                 |
| `src/renderer/dev/runtime/dev-command-handler.ts`                                     | `src/dev-tools/runtime/dev-command-handler.ts`                             |
| `src/renderer/dev/runtime/dev-dust-dialog.ts`                                         | `src/dev-tools/runtime/dev-dust-dialog.ts`                                 |
| `src/renderer/dev/runtime/dev-filter-toggle.ts`                                       | `src/dev-tools/runtime/dev-filter-toggle.ts`                               |
| `src/renderer/dev/runtime/dev-match-performance.ts`                                   | `src/dev-tools/runtime/dev-match-performance.ts`                           |
| `src/renderer/dev/runtime/dev-scene-sync.ts`                                          | `src/dev-tools/runtime/dev-scene-sync.ts`                                  |
| `src/renderer/dev/vfx-lab/index.ts`                                                   | `src/dev-tools/vfx-lab/index.ts`                                           |
| `src/renderer/dev/vfx-lab/vfx-lab-controls.ts`                                        | `src/dev-tools/vfx-lab/vfx-lab-controls.ts`                                |
| `src/renderer/dev/vfx-lab/vfx-lab-layout.ts`                                          | `src/dev-tools/vfx-lab/vfx-lab-layout.ts`                                  |
| `src/renderer/dev/vfx-lab/vfx-lab-model.ts`                                           | `src/dev-tools/vfx-lab/vfx-lab-model.ts`                                   |
| `src/renderer/dev/vfx-lab/vfx-lab-scene.ts`                                           | `src/dev-tools/vfx-lab/vfx-lab-scene.ts`                                   |
| `src/renderer/dev/vfx-lab/vfx-lab.ts`                                                 | `src/dev-tools/vfx-lab/vfx-lab.ts`                                         |
| `src/renderer/env.d.ts`                                                               | `src/application/env.d.ts`                                                 |
| `src/renderer/index.html`                                                             | `src/application/index.html`                                               |
| `src/renderer/main.ts`                                                                | `src/application/main.ts`                                                  |
| `src/renderer/README.md`                                                              | `src/README.md`                                                            |
| `src/renderer/scenes/arena/arena-layout.ts`                                           | `src/scenes/arena/arena-layout.ts`                                         |
| `src/renderer/scenes/arena/arena-model.test.ts`                                       | `src/scenes/arena/arena-model.test.ts`                                     |
| `src/renderer/scenes/arena/arena-model.ts`                                            | `src/scenes/arena/arena-model.ts`                                          |
| `src/renderer/scenes/arena/arena-rewards-layout.ts`                                   | `src/scenes/arena/arena-rewards-layout.ts`                                 |
| `src/renderer/scenes/arena/arena-rewards-view.ts`                                     | `src/scenes/arena/arena-rewards-view.ts`                                   |
| `src/renderer/scenes/arena/arena-scene.ts`                                            | `src/scenes/arena/arena-scene.ts`                                          |
| `src/renderer/scenes/arena/arena-view.ts`                                             | `src/scenes/arena/arena-view.ts`                                           |
| `src/renderer/scenes/card-preview/card-assembly-effects.ts`                           | `src/scenes/collection/card-preview/card-assembly-effects.ts`              |
| `src/renderer/scenes/card-preview/card-assembly-layout.ts`                            | `src/scenes/collection/card-preview/card-assembly-layout.ts`               |
| `src/renderer/scenes/card-preview/card-detail-panel.ts`                               | `src/scenes/collection/card-preview/card-detail-panel.ts`                  |
| `src/renderer/scenes/card-preview/card-preview-layout.ts`                             | `src/scenes/collection/card-preview/card-preview-layout.ts`                |
| `src/renderer/scenes/card-preview/card-preview-view.ts`                               | `src/scenes/collection/card-preview/card-preview-view.ts`                  |
| `src/renderer/scenes/card-preview/card-view-scene.ts`                                 | `src/scenes/collection/card-preview/card-view-scene.ts`                    |
| `src/renderer/scenes/card-preview/generated-card-preview.ts`                          | `src/scenes/collection/card-preview/generated-card-preview.ts`             |
| `src/renderer/scenes/card-preview/premium-upgrade-panel.ts`                           | `src/scenes/collection/card-preview/premium-upgrade-panel.ts`              |
| `src/renderer/scenes/collection/collection-card-grid.ts`                              | `src/scenes/collection/collection-card-grid.ts`                            |
| `src/renderer/scenes/collection/collection-filters.ts`                                | `src/scenes/collection/collection-filters.ts`                              |
| `src/renderer/scenes/collection/collection-layout.ts`                                 | `src/scenes/collection/collection-layout.ts`                               |
| `src/renderer/scenes/collection/collection-page-view.ts`                              | `src/scenes/collection/collection-page-view.ts`                            |
| `src/renderer/scenes/collection/collection-pages.test.ts`                             | `src/scenes/collection/collection-pages.test.ts`                           |
| `src/renderer/scenes/collection/collection-pages.ts`                                  | `src/scenes/collection/collection-pages.ts`                                |
| `src/renderer/scenes/collection/collection-preview-cache.test.ts`                     | `src/scenes/collection/collection-preview-cache.test.ts`                   |
| `src/renderer/scenes/collection/collection-preview-cache.ts`                          | `src/scenes/collection/collection-preview-cache.ts`                        |
| `src/renderer/scenes/collection/collection-query-controller.ts`                       | `src/scenes/collection/collection-query-controller.ts`                     |
| `src/renderer/scenes/collection/collection-query.test.ts`                             | `src/scenes/collection/collection-query.test.ts`                           |
| `src/renderer/scenes/collection/collection-query.ts`                                  | `src/scenes/collection/collection-query.ts`                                |
| `src/renderer/scenes/collection/collection-scene.ts`                                  | `src/scenes/collection/collection-scene.ts`                                |
| `src/renderer/scenes/collection/collection-view.ts`                                   | `src/scenes/collection/collection-view.ts`                                 |
| `src/renderer/scenes/collection/deck-editor-layout.ts`                                | `src/scenes/collection/deck-editor-layout.ts`                              |
| `src/renderer/scenes/collection/deck-editor-model.ts`                                 | `src/scenes/collection/deck-editor-model.ts`                               |
| `src/renderer/scenes/collection/deck-list-model.ts`                                   | `src/scenes/collection/deck-list-model.ts`                                 |
| `src/renderer/scenes/collection/deck-list-view.ts`                                    | `src/scenes/collection/deck-list-view.ts`                                  |
| `src/renderer/scenes/collection/deck-name-input.ts`                                   | `src/scenes/collection/deck-name-input.ts`                                 |
| `src/renderer/scenes/collection/deck-panel-view.ts`                                   | `src/scenes/collection/deck-panel-view.ts`                                 |
| `src/renderer/scenes/collection/delete-deck-layout.ts`                                | `src/scenes/collection/delete-deck-layout.ts`                              |
| `src/renderer/scenes/collection/delete-deck-view.ts`                                  | `src/scenes/collection/delete-deck-view.ts`                                |
| `src/renderer/scenes/collection/expansion-tray.ts`                                    | `src/scenes/collection/expansion-tray.ts`                                  |
| `src/renderer/scenes/collection/search-input.ts`                                      | `src/scenes/collection/search-input.ts`                                    |
| `src/renderer/scenes/deck-builder/new-deck-scene.ts`                                  | `src/scenes/collection/deck-builder/new-deck-scene.ts`                     |
| `src/renderer/scenes/deck-selection/deck-selection-layout.ts`                         | `src/scenes/deck-selection/deck-selection-layout.ts`                       |
| `src/renderer/scenes/deck-selection/deck-selection-model.test.ts`                     | `src/scenes/deck-selection/deck-selection-model.test.ts`                   |
| `src/renderer/scenes/deck-selection/deck-selection-model.ts`                          | `src/scenes/deck-selection/deck-selection-model.ts`                        |
| `src/renderer/scenes/deck-selection/deck-selection-scene.ts`                          | `src/scenes/deck-selection/deck-selection-scene.ts`                        |
| `src/renderer/scenes/deck-selection/deck-selection-view.ts`                           | `src/scenes/deck-selection/deck-selection-view.ts`                         |
| `src/renderer/scenes/main-menu/main-menu-layout.ts`                                   | `src/scenes/main-menu/main-menu-layout.ts`                                 |
| `src/renderer/scenes/main-menu/main-menu-scene.ts`                                    | `src/scenes/main-menu/main-menu-scene.ts`                                  |
| `src/renderer/scenes/main-menu/main-menu-view.ts`                                     | `src/scenes/main-menu/main-menu-view.ts`                                   |
| `src/renderer/scenes/match/ai/ai-action-intent.test.ts`                               | `src/scenes/match/ai/ai-action-intent.test.ts`                             |
| `src/renderer/scenes/match/ai/ai-action-intent.ts`                                    | `src/scenes/match/ai/ai-action-intent.ts`                                  |
| `src/renderer/scenes/match/ai/ai-compact-context.ts`                                  | `src/scenes/match/ai/ai-compact-context.ts`                                |
| `src/renderer/scenes/match/ai/ai-context.test.ts`                                     | `src/scenes/match/ai/ai-context.test.ts`                                   |
| `src/renderer/scenes/match/ai/ai-context.ts`                                          | `src/scenes/match/ai/ai-context.ts`                                        |
| `src/renderer/scenes/match/ai/ai-fact-checks.test.ts`                                 | `src/scenes/match/ai/ai-fact-checks.test.ts`                               |
| `src/renderer/scenes/match/ai/ai-fact-checks.ts`                                      | `src/scenes/match/ai/ai-fact-checks.ts`                                    |
| `src/renderer/scenes/match/ai/ai-feedback.ts`                                         | `src/scenes/match/ai/ai-feedback.ts`                                       |
| `src/renderer/scenes/match/ai/ai-forced-command.test.ts`                              | `src/scenes/match/ai/ai-forced-command.test.ts`                            |
| `src/renderer/scenes/match/ai/ai-forced-command.ts`                                   | `src/scenes/match/ai/ai-forced-command.ts`                                 |
| `src/renderer/scenes/match/ai/ai-prompts.ts`                                          | `src/scenes/match/ai/ai-prompts.ts`                                        |
| `src/renderer/scenes/match/ai/ai-turn-controller.ts`                                  | `src/scenes/match/ai/ai-turn-controller.ts`                                |
| `src/renderer/scenes/match/ai/expert-ai-action-safety.ts`                             | `src/scenes/match/ai/expert-ai-action-safety.ts`                           |
| `src/renderer/scenes/match/ai/expert-ai-consensus.ts`                                 | `src/scenes/match/ai/expert-ai-consensus.ts`                               |
| `src/renderer/scenes/match/ai/expert-ai-decision-api.test.ts`                         | `src/scenes/match/ai/expert-ai-decision-api.test.ts`                       |
| `src/renderer/scenes/match/ai/expert-ai-decision-api.ts`                              | `src/scenes/match/ai/expert-ai-decision-api.ts`                            |
| `src/renderer/scenes/match/ai/expert-ai-timeout-fallback.test.ts`                     | `src/scenes/match/ai/expert-ai-timeout-fallback.test.ts`                   |
| `src/renderer/scenes/match/ai/expert-ai-timeout-fallback.ts`                          | `src/scenes/match/ai/expert-ai-timeout-fallback.ts`                        |
| `src/renderer/scenes/match/ai/expert-ai-worker-protocol.ts`                           | `src/scenes/match/ai/expert-ai-worker-protocol.ts`                         |
| `src/renderer/scenes/match/ai/expert-ai-world-pool.test.ts`                           | `src/scenes/match/ai/expert-ai-world-pool.test.ts`                         |
| `src/renderer/scenes/match/ai/expert-ai-world-pool.ts`                                | `src/scenes/match/ai/expert-ai-world-pool.ts`                              |
| `src/renderer/scenes/match/ai/expert-ai-world-runner.ts`                              | `src/scenes/match/ai/expert-ai-world-runner.ts`                            |
| `src/renderer/scenes/match/ai/expert-ai-world.worker.ts`                              | `src/scenes/match/ai/expert-ai-world.worker.ts`                            |
| `src/renderer/scenes/match/ai/expert-ai.worker.ts`                                    | `src/scenes/match/ai/expert-ai.worker.ts`                                  |
| `src/renderer/scenes/match/ai/expert-coin-hero-power-policy.ts`                       | `src/scenes/match/ai/expert-coin-hero-power-policy.ts`                     |
| `src/renderer/scenes/match/ai/expert-deck-evaluation.ts`                              | `src/scenes/match/ai/expert-deck-evaluation.ts`                            |
| `src/renderer/scenes/match/ai/expert-tactics.ts`                                      | `src/scenes/match/ai/expert-tactics.ts`                                    |
| `src/renderer/scenes/match/ai/local-ai-artifact-scenarios.test.ts`                    | `src/scenes/match/ai/local-ai-artifact-scenarios.test.ts`                  |
| `src/renderer/scenes/match/ai/local-ai-decision-api.test.ts`                          | `src/scenes/match/ai/local-ai-decision-api.test.ts`                        |
| `src/renderer/scenes/match/ai/local-ai-decision-api.ts`                               | `src/scenes/match/ai/local-ai-decision-api.ts`                             |
| `src/renderer/scenes/match/ai/local-ai-matchup-benchmark.test.ts`                     | `src/scenes/match/ai/local-ai-matchup-benchmark.test.ts`                   |
| `src/renderer/scenes/match/ai/local-ai-policy.ts`                                     | `src/scenes/match/ai/local-ai-policy.ts`                                   |
| `src/renderer/scenes/match/ai/local-ai-scenarios.test.ts`                             | `src/scenes/match/ai/local-ai-scenarios.test.ts`                           |
| `src/renderer/scenes/match/ai/local-ai-turn-planning.test.ts`                         | `src/scenes/match/ai/local-ai-turn-planning.test.ts`                       |
| `src/renderer/scenes/match/board/board-ability-layout.test.ts`                        | `src/scenes/match/board/board-ability-layout.test.ts`                      |
| `src/renderer/scenes/match/board/board-ability-markers.test.ts`                       | `src/scenes/match/board/board-ability-markers.test.ts`                     |
| `src/renderer/scenes/match/board/board-ability-markers.ts`                            | `src/scenes/match/board/board-ability-markers.ts`                          |
| `src/renderer/scenes/match/board/board-layout.ts`                                     | `src/scenes/match/board/board-layout.ts`                                   |
| `src/renderer/scenes/match/board/board-minion-card-preview.test.ts`                   | `src/scenes/match/board/board-minion-card-preview.test.ts`                 |
| `src/renderer/scenes/match/board/board-minion-card-preview.ts`                        | `src/scenes/match/board/board-minion-card-preview.ts`                      |
| `src/renderer/scenes/match/board/board-position-controller.ts`                        | `src/scenes/match/board/board-position-controller.ts`                      |
| `src/renderer/scenes/match/board/board-selection.test.ts`                             | `src/scenes/match/board/board-selection.test.ts`                           |
| `src/renderer/scenes/match/board/board-selection.ts`                                  | `src/scenes/match/board/board-selection.ts`                                |
| `src/renderer/scenes/match/board/game-board-view.ts`                                  | `src/scenes/match/board/game-board-view.ts`                                |
| `src/renderer/scenes/match/board/hero-power-view.ts`                                  | `src/scenes/match/board/hero-power-view.ts`                                |
| `src/renderer/scenes/match/board/hero-powers/effects/hero-power-effects-presenter.ts` | `src/scenes/match/board/hero-power-effects-presenter.ts`                   |
| `src/renderer/scenes/match/board/hero-powers/effects/priest-heal-effect.ts`           | `src/scenes/match/board/priest-heal-effect.ts`                             |
| `src/renderer/scenes/match/board/hero-powers/effects/priest-heal-layout.ts`           | `src/scenes/match/board/priest-heal-layout.ts`                             |
| `src/renderer/scenes/match/board/hero-powers/effects/shaman-totem-effect.ts`          | `src/scenes/match/board/shaman-totem-effect.ts`                            |
| `src/renderer/scenes/match/board/hero-powers/effects/shaman-totem-layout.ts`          | `src/scenes/match/board/shaman-totem-layout.ts`                            |
| `src/renderer/scenes/match/board/hero-powers/effects/warlock-life-tap-effect.ts`      | `src/scenes/match/board/warlock-life-tap-effect.ts`                        |
| `src/renderer/scenes/match/board/hero-powers/effects/warlock-life-tap-layout.ts`      | `src/scenes/match/board/warlock-life-tap-layout.ts`                        |
| `src/renderer/scenes/match/board/hero-powers/effects/warrior-armor-up-effect.ts`      | `src/scenes/match/board/warrior-armor-up-effect.ts`                        |
| `src/renderer/scenes/match/board/hero-powers/effects/warrior-armor-up-layout.ts`      | `src/scenes/match/board/warrior-armor-up-layout.ts`                        |
| `src/renderer/scenes/match/board/hero-powers/effects/warrior-tank-up-effect.ts`       | `src/scenes/match/board/warrior-tank-up-effect.ts`                         |
| `src/renderer/scenes/match/board/hero-powers/effects/warrior-tank-up-layout.ts`       | `src/scenes/match/board/warrior-tank-up-layout.ts`                         |
| `src/renderer/scenes/match/board/hero-powers/hero-power-layout.ts`                    | `src/scenes/match/board/hero-power-layout.ts`                              |
| `src/renderer/scenes/match/board/hero-powers/hero-power-presentation.ts`              | `src/scenes/match/board/hero-power-presentation.ts`                        |
| `src/renderer/scenes/match/board/heroes/hero-layout.ts`                               | `src/scenes/match/board/hero-layout.ts`                                    |
| `src/renderer/scenes/match/board/heroes/hero-view.test.ts`                            | `src/scenes/match/board/hero-view.test.ts`                                 |
| `src/renderer/scenes/match/board/heroes/hero-view.ts`                                 | `src/scenes/match/board/hero-view.ts`                                      |
| `src/renderer/scenes/match/board/minions/minion-layout.ts`                            | `src/scenes/match/board/minion-layout.ts`                                  |
| `src/renderer/scenes/match/board/minions/minion-outline-layering.test.ts`             | `src/scenes/match/board/minion-outline-layering.test.ts`                   |
| `src/renderer/scenes/match/board/minions/minion-outline-shape.ts`                     | `src/scenes/match/board/minion-outline-shape.ts`                           |
| `src/renderer/scenes/match/board/minions/minion-stat-presentation.ts`                 | `src/scenes/match/board/minion-stat-presentation.ts`                       |
| `src/renderer/scenes/match/board/minions/minion-view.test.ts`                         | `src/scenes/match/board/minion-view.test.ts`                               |
| `src/renderer/scenes/match/board/minions/minion-view.ts`                              | `src/scenes/match/board/minion-view.ts`                                    |
| `src/renderer/scenes/match/board/minions/sleeping-zs.ts`                              | `src/scenes/match/board/sleeping-zs.ts`                                    |
| `src/renderer/scenes/match/board/quest-preview-view.ts`                               | `src/scenes/match/board/quest-preview-view.ts`                             |
| `src/renderer/scenes/match/board/secret-layout.test.ts`                               | `src/scenes/match/board/secret-layout.test.ts`                             |
| `src/renderer/scenes/match/board/secret-layout.ts`                                    | `src/scenes/match/board/secret-layout.ts`                                  |
| `src/renderer/scenes/match/board/secret-preview-view.ts`                              | `src/scenes/match/board/secret-preview-view.ts`                            |
| `src/renderer/scenes/match/board/secret-view.ts`                                      | `src/scenes/match/board/secret-view.ts`                                    |
| `src/renderer/scenes/match/board/shadows/board-shadow-layer.ts`                       | `src/scenes/match/board/board-shadow-layer.ts`                             |
| `src/renderer/scenes/match/board/shadows/match-shadow-config.ts`                      | `src/scenes/match/board/match-shadow-config.ts`                            |
| `src/renderer/scenes/match/board/shadows/README.md`                                   | `src/scenes/match/board/board-shadows.md`                                  |
| `src/renderer/scenes/match/board/temporary-ability-badge.ts`                          | `src/scenes/match/board/temporary-ability-badge.ts`                        |
| `src/renderer/scenes/match/board/weapons/weapon-layout.ts`                            | `src/scenes/match/board/weapon-layout.ts`                                  |
| `src/renderer/scenes/match/board/weapons/weapon-outline-shape.ts`                     | `src/scenes/match/board/weapon-outline-shape.ts`                           |
| `src/renderer/scenes/match/board/weapons/weapon-view.ts`                              | `src/scenes/match/board/weapon-view.ts`                                    |
| `src/renderer/scenes/match/combat/character-indicator-presentation.ts`                | `src/scenes/match/combat/character-indicator-presentation.ts`              |
| `src/renderer/scenes/match/combat/combat-attack-warp.ts`                              | `src/scenes/match/combat/combat-attack-warp.ts`                            |
| `src/renderer/scenes/match/combat/combat-impact.ts`                                   | `src/scenes/match/combat/combat-impact.ts`                                 |
| `src/renderer/scenes/match/combat/damage-indicator-layout.ts`                         | `src/scenes/match/combat/damage-indicator-layout.ts`                       |
| `src/renderer/scenes/match/combat/damage-indicator-view.test.ts`                      | `src/scenes/match/combat/damage-indicator-view.test.ts`                    |
| `src/renderer/scenes/match/combat/damage-indicator-view.ts`                           | `src/scenes/match/combat/damage-indicator-view.ts`                         |
| `src/renderer/scenes/match/combat/game-combat-presentation.ts`                        | `src/scenes/match/combat/game-combat-presentation.ts`                      |
| `src/renderer/scenes/match/combat/heal-indicator-layout.ts`                           | `src/scenes/match/combat/heal-indicator-layout.ts`                         |
| `src/renderer/scenes/match/combat/heal-indicator-view.ts`                             | `src/scenes/match/combat/heal-indicator-view.ts`                           |
| `src/renderer/scenes/match/combat/screen-shake.ts`                                    | `src/scenes/match/combat/screen-shake.ts`                                  |
| `src/renderer/scenes/match/game-board-session.ts`                                     | `src/scenes/match/game-board-session.ts`                                   |
| `src/renderer/scenes/match/game-scene-layout.ts`                                      | `src/scenes/match/game-scene-layout.ts`                                    |
| `src/renderer/scenes/match/game-scene.ts`                                             | `src/scenes/match/game-scene.ts`                                           |
| `src/renderer/scenes/match/hand/drag-rotator.test.ts`                                 | `src/scenes/match/hand/drag-rotator.test.ts`                               |
| `src/renderer/scenes/match/hand/drag-rotator.ts`                                      | `src/scenes/match/hand/drag-rotator.ts`                                    |
| `src/renderer/scenes/match/hand/game-card-slot.ts`                                    | `src/scenes/match/hand/game-card-slot.ts`                                  |
| `src/renderer/scenes/match/hand/game-hand-drag.ts`                                    | `src/scenes/match/hand/game-hand-drag.ts`                                  |
| `src/renderer/scenes/match/hand/game-hand-entry.ts`                                   | `src/scenes/match/hand/game-hand-entry.ts`                                 |
| `src/renderer/scenes/match/hand/game-hand-view.ts`                                    | `src/scenes/match/hand/game-hand-view.ts`                                  |
| `src/renderer/scenes/match/hand/hand-card-perspective-pool.ts`                        | `src/scenes/match/hand/hand-card-perspective-pool.ts`                      |
| `src/renderer/scenes/match/hand/hand-card-perspective.ts`                             | `src/scenes/match/hand/hand-card-perspective.ts`                           |
| `src/renderer/scenes/match/hand/hand-discard-presentation.ts`                         | `src/scenes/match/hand/hand-discard-presentation.ts`                       |
| `src/renderer/scenes/match/hand/hand-drag.ts`                                         | `src/scenes/match/hand/hand-drag.ts`                                       |
| `src/renderer/scenes/match/hand/hand-layout.test.ts`                                  | `src/scenes/match/hand/hand-layout.test.ts`                                |
| `src/renderer/scenes/match/hand/hand-layout.ts`                                       | `src/scenes/match/hand/hand-layout.ts`                                     |
| `src/renderer/scenes/match/hand/hand-play-gesture.test.ts`                            | `src/scenes/match/hand/hand-play-gesture.test.ts`                          |
| `src/renderer/scenes/match/hand/hand-play-gesture.ts`                                 | `src/scenes/match/hand/hand-play-gesture.ts`                               |
| `src/renderer/scenes/match/hand/remote-hand-layout.ts`                                | `src/scenes/match/hand/remote-hand-layout.ts`                              |
| `src/renderer/scenes/match/history/match-history-layout.ts`                           | `src/scenes/match/history/match-history-layout.ts`                         |
| `src/renderer/scenes/match/history/match-history-model.test.ts`                       | `src/scenes/match/history/match-history-model.test.ts`                     |
| `src/renderer/scenes/match/history/match-history-model.ts`                            | `src/scenes/match/history/match-history-model.ts`                          |
| `src/renderer/scenes/match/history/match-history-view.ts`                             | `src/scenes/match/history/match-history-view.ts`                           |
| `src/renderer/scenes/match/history/match-log-capture.ts`                              | `src/scenes/match/history/match-log-capture.ts`                            |
| `src/renderer/scenes/match/history/match-recorder.ts`                                 | `src/scenes/match/history/match-recorder.ts`                               |
| `src/renderer/scenes/match/hud/deck-info-layout.ts`                                   | `src/scenes/match/hud/deck-info-layout.ts`                                 |
| `src/renderer/scenes/match/hud/deck-info-view.ts`                                     | `src/scenes/match/hud/deck-info-view.ts`                                   |
| `src/renderer/scenes/match/hud/deck-stack-layout.ts`                                  | `src/scenes/match/hud/deck-stack-layout.ts`                                |
| `src/renderer/scenes/match/hud/deck-stack-view.ts`                                    | `src/scenes/match/hud/deck-stack-view.ts`                                  |
| `src/renderer/scenes/match/hud/deck-tracker-layout.ts`                                | `src/scenes/match/hud/deck-tracker-layout.ts`                              |
| `src/renderer/scenes/match/hud/deck-tracker-model.test.ts`                            | `src/scenes/match/hud/deck-tracker-model.test.ts`                          |
| `src/renderer/scenes/match/hud/deck-tracker-model.ts`                                 | `src/scenes/match/hud/deck-tracker-model.ts`                               |
| `src/renderer/scenes/match/hud/deck-tracker-view.ts`                                  | `src/scenes/match/hud/deck-tracker-view.ts`                                |
| `src/renderer/scenes/match/hud/fatigue-layout.ts`                                     | `src/scenes/match/hud/fatigue-layout.ts`                                   |
| `src/renderer/scenes/match/hud/fatigue-view.test.ts`                                  | `src/scenes/match/hud/fatigue-view.test.ts`                                |
| `src/renderer/scenes/match/hud/fatigue-view.ts`                                       | `src/scenes/match/hud/fatigue-view.ts`                                     |
| `src/renderer/scenes/match/hud/game-hud-view.ts`                                      | `src/scenes/match/hud/game-hud-view.ts`                                    |
| `src/renderer/scenes/match/hud/mana-tray.ts`                                          | `src/scenes/match/hud/mana-tray.ts`                                        |
| `src/renderer/scenes/match/loading/game-loading-layout.ts`                            | `src/scenes/match/loading/game-loading-layout.ts`                          |
| `src/renderer/scenes/match/loading/game-loading-view.ts`                              | `src/scenes/match/loading/game-loading-view.ts`                            |
| `src/renderer/scenes/match/loading/match-artwork-warmup.ts`                           | `src/scenes/match/loading/match-artwork-warmup.ts`                         |
| `src/renderer/scenes/match/mulligan/game-mulligan-view.ts`                            | `src/scenes/match/game-mulligan-view.ts`                                   |
| `src/renderer/scenes/match/presentation/card-choice-presentation.test.ts`             | `src/scenes/match/presentation/card-choice-presentation.test.ts`           |
| `src/renderer/scenes/match/presentation/card-choice-presentation.ts`                  | `src/scenes/match/presentation/card-choice-presentation.ts`                |
| `src/renderer/scenes/match/presentation/card-departure-animation.ts`                  | `src/scenes/match/presentation/card-departure-animation.ts`                |
| `src/renderer/scenes/match/presentation/card-departure-layout.ts`                     | `src/scenes/match/presentation/card-departure-layout.ts`                   |
| `src/renderer/scenes/match/presentation/card-draw-animation.ts`                       | `src/scenes/match/presentation/card-draw-animation.ts`                     |
| `src/renderer/scenes/match/presentation/card-draw-layout.ts`                          | `src/scenes/match/presentation/card-draw-layout.ts`                        |
| `src/renderer/scenes/match/presentation/card-play-animation.ts`                       | `src/scenes/match/presentation/card-play-animation.ts`                     |
| `src/renderer/scenes/match/presentation/card-play-layout.ts`                          | `src/scenes/match/presentation/card-play-layout.ts`                        |
| `src/renderer/scenes/match/presentation/card-reveal-layout.ts`                        | `src/scenes/match/presentation/card-reveal-layout.ts`                      |
| `src/renderer/scenes/match/presentation/card-reveal-presenter.ts`                     | `src/scenes/match/presentation/card-reveal-presenter.ts`                   |
| `src/renderer/scenes/match/presentation/card-selection-overlay.ts`                    | `src/scenes/match/presentation/card-selection-overlay.ts`                  |
| `src/renderer/scenes/match/presentation/event-presentation-policy.test.ts`            | `src/scenes/match/presentation/event-presentation-policy.test.ts`          |
| `src/renderer/scenes/match/presentation/event-presentation-policy.ts`                 | `src/scenes/match/presentation/event-presentation-policy.ts`               |
| `src/renderer/scenes/match/presentation/game-presentation-animation.ts`               | `src/scenes/match/presentation/game-presentation-animation.ts`             |
| `src/renderer/scenes/match/presentation/game-presentation-timing.ts`                  | `src/scenes/match/presentation/game-presentation-timing.ts`                |
| `src/renderer/scenes/match/presentation/match-premium-appearance.test.ts`             | `src/scenes/match/presentation/match-premium-appearance.test.ts`           |
| `src/renderer/scenes/match/presentation/match-premium-appearance.ts`                  | `src/scenes/match/presentation/match-premium-appearance.ts`                |
| `src/renderer/scenes/match/presentation/presentation-queue.test.ts`                   | `src/scenes/match/presentation/presentation-queue.test.ts`                 |
| `src/renderer/scenes/match/presentation/presentation-queue.ts`                        | `src/scenes/match/presentation/presentation-queue.ts`                      |
| `src/renderer/scenes/match/presentation/random-spell-presentation.ts`                 | `src/scenes/match/presentation/random-spell-presentation.ts`               |
| `src/renderer/scenes/match/presentation/remote-card-play-preview.test.ts`             | `src/scenes/match/presentation/remote-card-play-preview.test.ts`           |
| `src/renderer/scenes/match/presentation/remote-card-play-preview.ts`                  | `src/scenes/match/presentation/remote-card-play-preview.ts`                |
| `src/renderer/scenes/match/presentation/return-presentation.ts`                       | `src/scenes/match/presentation/return-presentation.ts`                     |
| `src/renderer/scenes/match/presentation/summon-presentation.ts`                       | `src/scenes/match/presentation/summon-presentation.ts`                     |
| `src/renderer/scenes/match/results/match-result-overlay.ts`                           | `src/scenes/match/results/match-result-overlay.ts`                         |
| `src/renderer/scenes/match/results/match-result-state.test.ts`                        | `src/scenes/match/results/match-result-state.test.ts`                      |
| `src/renderer/scenes/match/results/match-result-state.ts`                             | `src/scenes/match/results/match-result-state.ts`                           |
| `src/renderer/scenes/match/results/match-win-tracking.test.ts`                        | `src/scenes/match/results/match-win-tracking.test.ts`                      |
| `src/renderer/scenes/match/results/match-win-tracking.ts`                             | `src/scenes/match/results/match-win-tracking.ts`                           |
| `src/renderer/scenes/match/targeting/attack-line.ts`                                  | `src/scenes/match/targeting/attack-line.ts`                                |
| `src/renderer/scenes/match/targeting/game-card-targeting-types.ts`                    | `src/scenes/match/targeting/game-card-targeting-types.ts`                  |
| `src/renderer/scenes/match/targeting/game-card-targeting.ts`                          | `src/scenes/match/targeting/game-card-targeting.ts`                        |
| `src/renderer/scenes/match/targeting/hero-power-targeting.test.ts`                    | `src/scenes/match/targeting/hero-power-targeting.test.ts`                  |
| `src/renderer/scenes/match/targeting/hero-power-targeting.ts`                         | `src/scenes/match/targeting/hero-power-targeting.ts`                       |
| `src/renderer/scenes/match/targeting/hover-preview-controller.test.ts`                | `src/scenes/match/targeting/hover-preview-controller.test.ts`              |
| `src/renderer/scenes/match/targeting/hover-preview-controller.ts`                     | `src/scenes/match/targeting/hover-preview-controller.ts`                   |
| `src/renderer/scenes/match/targeting/remote-target-preview.ts`                        | `src/scenes/match/targeting/remote-target-preview.ts`                      |
| `src/renderer/scenes/match/targeting/target-gesture.test.ts`                          | `src/scenes/match/targeting/target-gesture.test.ts`                        |
| `src/renderer/scenes/match/targeting/target-gesture.ts`                               | `src/scenes/match/targeting/target-gesture.ts`                             |
| `src/renderer/scenes/match/targeting/turn-action-availability.test.ts`                | `src/scenes/match/targeting/turn-action-availability.test.ts`              |
| `src/renderer/scenes/match/targeting/turn-action-availability.ts`                     | `src/scenes/match/targeting/turn-action-availability.ts`                   |
| `src/renderer/scenes/match/tools/add-card-picker-layout.ts`                           | `src/scenes/match/tools/add-card-picker-layout.ts`                         |
| `src/renderer/scenes/match/tools/add-card-picker-model.ts`                            | `src/scenes/match/tools/add-card-picker-model.ts`                          |
| `src/renderer/scenes/match/tools/add-card-picker-view.ts`                             | `src/scenes/match/tools/add-card-picker-view.ts`                           |
| `src/renderer/scenes/match/tools/dev-match-command-dispatch.test.ts`                  | `src/scenes/match/tools/dev-match-command-dispatch.test.ts`                |
| `src/renderer/scenes/match/tools/dev-match-command-dispatch.ts`                       | `src/scenes/match/tools/dev-match-command-dispatch.ts`                     |
| `src/renderer/scenes/settings/ai-mode-selector.ts`                                    | `src/scenes/settings/ai-mode-selector.ts`                                  |
| `src/renderer/scenes/settings/expert-deck-strategy-toggle.ts`                         | `src/scenes/settings/expert-deck-strategy-toggle.ts`                       |
| `src/renderer/scenes/settings/resolution-selector.ts`                                 | `src/scenes/settings/resolution-selector.ts`                               |
| `src/renderer/scenes/settings/settings-layout.ts`                                     | `src/scenes/settings/settings-layout.ts`                                   |
| `src/renderer/scenes/settings/settings-scenes.ts`                                     | `src/scenes/settings/settings-scenes.ts`                                   |
| `src/renderer/scenes/tavern-brawl/tavern-brawl-layout.ts`                             | `src/scenes/tavern-brawl/tavern-brawl-layout.ts`                           |
| `src/renderer/scenes/tavern-brawl/tavern-brawl-model.test.ts`                         | `src/scenes/tavern-brawl/tavern-brawl-model.test.ts`                       |
| `src/renderer/scenes/tavern-brawl/tavern-brawl-model.ts`                              | `src/scenes/tavern-brawl/tavern-brawl-model.ts`                            |
| `src/renderer/scenes/tavern-brawl/tavern-brawl-scene.ts`                              | `src/scenes/tavern-brawl/tavern-brawl-scene.ts`                            |
| `src/renderer/shared/animation/animations.ts`                                         | `src/visual-components/animation/animations.ts`                            |
| `src/renderer/shared/animation/card-add-flight.ts`                                    | `src/visual-components/animation/card-add-flight.ts`                       |
| `src/renderer/shared/animation/kill-display-tweens.ts`                                | `src/visual-components/animation/kill-display-tweens.ts`                   |
| `src/renderer/shared/assets/asset-bundle-ids.ts`                                      | `src/visual-components/assets/asset-bundle-ids.ts`                         |
| `src/renderer/shared/assets/asset-definition.ts`                                      | `src/visual-components/assets/asset-definition.ts`                         |
| `src/renderer/shared/assets/asset-scope.ts`                                           | `src/visual-components/assets/asset-scope.ts`                              |
| `src/renderer/shared/assets/card-asset-resolver.ts`                                   | `src/visual-components/assets/card-asset-resolver.ts`                      |
| `src/renderer/shared/assets/card-assets.ts`                                           | `src/visual-components/assets/card-assets.ts`                              |
| `src/renderer/shared/assets/deck-frames.ts`                                           | `src/visual-components/assets/deck-frames.ts`                              |
| `src/renderer/shared/assets/deck-portraits.test.ts`                                   | `src/visual-components/assets/deck-portraits.test.ts`                      |
| `src/renderer/shared/assets/deck-portraits.ts`                                        | `src/visual-components/assets/deck-portraits.ts`                           |
| `src/renderer/shared/assets/gadgetzan-artwork-aliases.ts`                             | `src/visual-components/assets/gadgetzan-artwork-aliases.ts`                |
| `src/renderer/shared/assets/hero-assets.ts`                                           | `src/visual-components/assets/hero-assets.ts`                              |
| `src/renderer/shared/assets/hero-power-asset-keys.ts`                                 | `src/visual-components/assets/hero-power-asset-keys.ts`                    |
| `src/renderer/shared/assets/hero-power-assets.test.ts`                                | `src/visual-components/assets/hero-power-assets.test.ts`                   |
| `src/renderer/shared/assets/hero-power-assets.ts`                                     | `src/visual-components/assets/hero-power-assets.ts`                        |
| `src/renderer/shared/assets/index.ts`                                                 | `src/visual-components/assets/index.ts`                                    |
| `src/renderer/shared/assets/rank-medals.ts`                                           | `src/visual-components/assets/rank-medals.ts`                              |
| `src/renderer/shared/cards/card-cost-presentation.test.ts`                            | `src/visual-components/cards/card-cost-presentation.test.ts`               |
| `src/renderer/shared/cards/card-cost-presentation.ts`                                 | `src/visual-components/cards/card-cost-presentation.ts`                    |
| `src/renderer/shared/cards/card-layout.ts`                                            | `src/visual-components/cards/card-layout.ts`                               |
| `src/renderer/shared/cards/card-parallax.ts`                                          | `src/visual-components/cards/card-parallax.ts`                             |
| `src/renderer/shared/cards/card-render-tree.ts`                                       | `src/visual-components/cards/card-render-tree.ts`                          |
| `src/renderer/shared/cards/card-text-markup.ts`                                       | `src/visual-components/cards/card-text-markup.ts`                          |
| `src/renderer/shared/cards/card-title-fit.ts`                                         | `src/visual-components/cards/card-title-fit.ts`                            |
| `src/renderer/shared/cards/card-view.ts`                                              | `src/visual-components/cards/card-view.ts`                                 |
| `src/renderer/shared/cards/class-frame-colors.ts`                                     | `src/visual-components/cards/class-frame-colors.ts`                        |
| `src/renderer/shared/cards/premium-appearance.ts`                                     | `src/visual-components/cards/premium-appearance.ts`                        |
| `src/renderer/shared/contracts/arena-store.ts`                                        | `src/application/contracts/arena-store.ts`                                 |
| `src/renderer/shared/contracts/deck-store.ts`                                         | `src/application/contracts/deck-store.ts`                                  |
| `src/renderer/shared/contracts/dialog-service.ts`                                     | `src/application/contracts/dialog-service.ts`                              |
| `src/renderer/shared/contracts/logger.ts`                                             | `src/application/contracts/logger.ts`                                      |
| `src/renderer/shared/contracts/player-stats-store.ts`                                 | `src/application/contracts/player-stats-store.ts`                          |
| `src/renderer/shared/contracts/progression-store.ts`                                  | `src/application/contracts/progression-store.ts`                           |
| `src/renderer/shared/contracts/scene-manager-port.ts`                                 | `src/application/contracts/scene-manager-port.ts`                          |
| `src/renderer/shared/controls/button.ts`                                              | `src/visual-components/controls/button.ts`                                 |
| `src/renderer/shared/controls/cursor.ts`                                              | `src/visual-components/controls/cursor.ts`                                 |
| `src/renderer/shared/controls/flip-card.ts`                                           | `src/visual-components/controls/flip-card.ts`                              |
| `src/renderer/shared/decks/deck-entry-button.ts`                                      | `src/visual-components/controls/deck-entry-button.ts`                      |
| `src/renderer/shared/decks/new-deck-layout.ts`                                        | `src/scenes/collection/deck-builder/new-deck-layout.ts`                    |
| `src/renderer/shared/decks/new-deck-view.ts`                                          | `src/scenes/collection/deck-builder/new-deck-view.ts`                      |
| `src/renderer/shared/effects/animated-outline.ts`                                     | `src/visual-components/effects/animated-outline.ts`                        |
| `src/renderer/shared/effects/aoe-vfx-shader.ts`                                       | `src/visual-components/effects/aoe-vfx-shader.ts`                          |
| `src/renderer/shared/effects/aura-distance-field.ts`                                  | `src/visual-components/effects/aura-distance-field.ts`                     |
| `src/renderer/shared/effects/aura-field-cache.ts`                                     | `src/visual-components/effects/aura-field-cache.ts`                        |
| `src/renderer/shared/effects/aura-filter.ts`                                          | `src/visual-components/effects/aura-filter.ts`                             |
| `src/renderer/shared/effects/aura-projection.ts`                                      | `src/visual-components/effects/aura-projection.ts`                         |
| `src/renderer/shared/effects/aura-shader-wgsl.ts`                                     | `src/visual-components/effects/aura-shader-wgsl.ts`                        |
| `src/renderer/shared/effects/aura-shader.ts`                                          | `src/visual-components/effects/aura-shader.ts`                             |
| `src/renderer/shared/effects/burn.ts`                                                 | `src/visual-components/effects/burn.ts`                                    |
| `src/renderer/shared/effects/filters/highlight.ts`                                    | `src/visual-components/effects/highlight.ts`                               |
| `src/renderer/shared/effects/fire-vfx-shader-common.ts`                               | `src/visual-components/effects/fire-vfx-shader-common.ts`                  |
| `src/renderer/shared/effects/ghost-aura-shader.ts`                                    | `src/visual-components/effects/ghost-aura-shader.ts`                       |
| `src/renderer/shared/effects/ghost-aura.ts`                                           | `src/visual-components/effects/ghost-aura.ts`                              |
| `src/renderer/shared/effects/ghost-mist-filter.ts`                                    | `src/visual-components/effects/ghost-mist-filter.ts`                       |
| `src/renderer/shared/effects/ghost-mist-particles.ts`                                 | `src/visual-components/effects/ghost-mist-particles.ts`                    |
| `src/renderer/shared/effects/hinged-door.ts`                                          | `src/visual-components/effects/hinged-door.ts`                             |
| `src/renderer/shared/effects/missile-vfx-shader.ts`                                   | `src/visual-components/effects/missile-vfx-shader.ts`                      |
| `src/renderer/shared/effects/outline-directions-placeholder.ts`                       | `src/visual-components/effects/outline-directions-placeholder.ts`          |
| `src/renderer/shared/effects/outline-tuning.test.ts`                                  | `src/visual-components/effects/outline-tuning.test.ts`                     |
| `src/renderer/shared/effects/outline-tuning.ts`                                       | `src/visual-components/effects/outline-tuning.ts`                          |
| `src/renderer/shared/effects/premium-artwork-breath.ts`                               | `src/visual-components/effects/premium-artwork-breath.ts`                  |
| `src/renderer/shared/effects/shadows/shadow-caster.ts`                                | `src/visual-components/effects/shadow-caster.ts`                           |
| `src/renderer/shared/effects/shatter.ts`                                              | `src/visual-components/effects/shatter.ts`                                 |
| `src/renderer/shared/layout/contract.ts`                                              | `src/visual-components/layout/contract.ts`                                 |
| `src/renderer/shared/layout/index.ts`                                                 | `src/visual-components/layout/index.ts`                                    |
| `src/renderer/shared/lifecycle/actor.ts`                                              | `src/visual-components/lifecycle/actor.ts`                                 |
| `src/renderer/shared/lifecycle/scene.ts`                                              | `src/visual-components/lifecycle/scene.ts`                                 |
| `src/renderer/shared/match-setup/match-seed.ts`                                       | `src/application/match-seed.ts`                                            |
| `src/renderer/shared/navigation/app-route.ts`                                         | `src/application/navigation/app-route.ts`                                  |
| `src/renderer/shared/navigation/card-preview-route.ts`                                | `src/application/navigation/card-preview-route.ts`                         |
| `src/renderer/shared/navigation/game-route.test.ts`                                   | `src/application/navigation/game-route.test.ts`                            |
| `src/renderer/shared/navigation/game-route.ts`                                        | `src/application/navigation/game-route.ts`                                 |
| `src/renderer/shared/navigation/scene-transition-host.ts`                             | `src/visual-components/transitions/scene-transition-host.ts`               |
| `src/renderer/shared/navigation/scene-transition-options.ts`                          | `src/visual-components/transitions/scene-transition-options.ts`            |
| `src/renderer/styles.css`                                                             | `src/application/styles.css`                                               |
| `src/shared/dev-menu.test.ts`                                                         | `src/desktop/contracts/dev-menu.test.ts`                                   |
| `src/shared/dev-menu.ts`                                                              | `src/desktop/contracts/dev-menu.ts`                                        |
| `src/shared/ipc/ai-deliberation.test.ts`                                              | `src/desktop/contracts/ipc/ai-deliberation.test.ts`                        |
| `src/shared/ipc/ai-deliberation.ts`                                                   | `src/desktop/contracts/ipc/ai-deliberation.ts`                             |
| `src/shared/ipc/ai.ts`                                                                | `src/desktop/contracts/ipc/ai.ts`                                          |
| `src/shared/ipc/arena-rewards.ts`                                                     | `src/desktop/contracts/ipc/arena-rewards.ts`                               |
| `src/shared/ipc/arena.ts`                                                             | `src/desktop/contracts/ipc/arena.ts`                                       |
| `src/shared/ipc/card-class-builder.test.ts`                                           | `src/desktop/contracts/ipc/card-class-builder.test.ts`                     |
| `src/shared/ipc/card-class-builder.ts`                                                | `src/desktop/contracts/ipc/card-class-builder.ts`                          |
| `src/shared/ipc/decks.ts`                                                             | `src/desktop/contracts/ipc/decks.ts`                                       |
| `src/shared/ipc/index.ts`                                                             | `src/desktop/contracts/ipc/index.ts`                                       |
| `src/shared/ipc/match-logs.ts`                                                        | `src/desktop/contracts/ipc/match-logs.ts`                                  |
| `src/shared/ipc/outline-tuning.test.ts`                                               | `src/desktop/contracts/ipc/outline-tuning.test.ts`                         |
| `src/shared/ipc/outline-tuning.ts`                                                    | `src/desktop/contracts/ipc/outline-tuning.ts`                              |
| `src/shared/ipc/player-stats.test.ts`                                                 | `src/desktop/contracts/ipc/player-stats.test.ts`                           |
| `src/shared/ipc/player-stats.ts`                                                      | `src/desktop/contracts/ipc/player-stats.ts`                                |
| `src/shared/ipc/preferences.ts`                                                       | `src/desktop/contracts/ipc/preferences.ts`                                 |
| `src/shared/ipc/progression.ts`                                                       | `src/desktop/contracts/ipc/progression.ts`                                 |
| `src/shared/ipc/window-settings.test.ts`                                              | `src/desktop/contracts/ipc/window-settings.test.ts`                        |
| `src/shared/ipc/window-settings.ts`                                                   | `src/desktop/contracts/ipc/window-settings.ts`                             |
| `src/shared/scene-navigation.test.ts`                                                 | `src/desktop/contracts/scene-navigation.test.ts`                           |
| `src/shared/scene-navigation.ts`                                                      | `src/desktop/contracts/scene-navigation.ts`                                |
