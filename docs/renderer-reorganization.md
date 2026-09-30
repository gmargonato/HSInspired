# Initial renderer reorganization

The source roots have since been renamed and flattened. See
[the current source guide](../src/README.md) and
[the follow-up tracker](source-layout.md). The inventory below keeps its original
source column and now points to final destinations. Validation below records the
initial migration; current results are in the follow-up tracker.

Scene-specific code lives beside its scene; reusable presentation lives in named
shared modules. Application composition and concrete service implementations stay
in app. Game rules, process contracts, route identifiers, layout values, assets,
and runtime behavior are preserved.

## Starting state

- Source revision: 10be351df119e0472b298296e353a3cac7b78ced.
- Working tree was clean before migration.
- Inventory: 359 renderer files, including tests and local documentation.
- Original file snapshots and validation logs: ignored .tmp/renderer-reorganization.

## Batches

| Batch       | Inventoried files | Status   |
| ----------- | ----------------- | -------- |
| main-menu   | 3                 | Verified |
| shared      | 72                | Verified |
| menus       | 53                | Verified |
| match       | 177               | Verified |
| development | 36                | Verified |

States: Planned, In progress, Awaiting validation, Verified, Blocked. Verified
requires updated consumers, passing relevant checks relative to the recorded
baseline, and diff review. Every
original file appears once below; extracted contracts/helpers are listed separately.

All 341 moves are complete. The remaining 18 original files keep their paths.
No required migration batch is pending; the separate issues below remain deferred.

## Decisions

- Scene adapters, views, controllers, and layouts remain separate classes/modules.
- Match components group by board, hand, targeting, combat, AI, presentation, HUD,
  history, results, loading, mulligan, and embedded tools.
- Minion/hero/weapon/power visuals belong to match; inspectors may reuse them.
- Deck creation is shared between collection and the new-deck screen.
- SceneManager belongs to app; Scene/Actor are shared lifecycle bases.
- Renderer navigation/service contracts are shared; implementations remain in app.
- Route IDs (including game), exported names, asset keys, and tuning numbers stay stable.
- Standalone development tools retain production-substituted aliases/entry guards.
- Embedded match debug commands retain their existing runtime availability.

## Validation

Validation completed on 2026-09-29. Evidence is kept in the ignored
`.tmp/renderer-reorganization` directory; generated application reports live in
`artifacts`. These artifacts are local evidence, not source dependencies.

| Check                      | Baseline                                                                                                   | Final outcome                                                                                                                                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File inventory             | 359 renderer files                                                                                         | Every original destination exists; 341 moved, 18 retained; four extracted modules and one renderer README added                                                                                                                                                           |
| Source preservation        | Snapshots from the clean starting revision                                                                 | All 1,752 original declarations preserved after normalizing source paths/formatting; no declaration or numeric-value changes; all non-renderer source hashes unchanged                                                                                                    |
| Dependency boundaries      | Passed                                                                                                     | Passed: 922 modules, 2,650 dependencies; valid/invalid fixtures exercised all 20 current rules, with no missing rule coverage                                                                                                                                             |
| Tests                      | 1,628 passed, 7 failed, 1 skipped across 107 files; two expensive AI suites excluded from the baseline run | Full run: 1,847 passed, the same 7 failures, 1 skipped across 109 files; every baseline test retains its status after remapping paths, and all 219 additionally covered tests pass                                                                                        |
| Type checks                | Node passed; web reported TS7030 in the hero-power animation lab                                           | Node passed; the same single TS7030 remains at its relocated path                                                                                                                                                                                                         |
| Lint                       | 277 errors and 6 warnings in the existing `.tmp/vfx-preview/preview.js` bundle                             | Same existing bundle failures; migrated source and changed configuration/scripts pass focused lint                                                                                                                                                                        |
| Formatting                 | Three existing files failed                                                                                | Two untouched existing files still fail; migrated source, new documentation, and changed metadata pass focused formatting checks                                                                                                                                          |
| Production build smoke     | Not run before moves                                                                                       | Passed; 13 renderer output files inspected, workers/assets resolved, standalone development markers excluded                                                                                                                                                              |
| Architecture checks        | Existing registry reviewed                                                                                 | Analyzer fixtures pass; atlas regenerated, every renderer file classified; one unchanged domain entrypoint is stale                                                                                                                                                       |
| Runtime screen walkthrough | Not run before moves                                                                                       | Passed: main menu, menu settings, collection, new deck, card preview, deck selection, Arena, tavern brawl, Card Inspector, and return to main menu load textures and reach active state; replaced roots are destroyed; preview pause/resume and overlay disposal verified |
| Runtime match smoke        | Not run before moves                                                                                       | Match loading/mulligan, normal/premium hand pickup, dragging, target cancellation, three pickup/return cycles, two restarts, and return/disposal exercised in an isolated profile; match screenshot inspected                                                             |

Evidence files: `invariants.json`, `boundary-results.json`, `test-comparison.json`,
`baseline-tests.json`, `final-tests.json`, `final-typecheck.log`, `final-lint.log`,
`final-verify.log`, `final-deps.log`, `final-build.log`,
`final-architecture-check.log`, `final-architecture-map.log`,
`final-source-lint.log`, `final-format.log`, and `runtime-walkthrough.json`.

The runtime match report is `artifacts/match-performance/renderer-walkthrough.json`.
Its timing acceptance result is **FAIL**: smoke samples miss timing thresholds and
the two idle samples report no valid input. Input-driven interaction samples were
valid. This is functional smoke evidence, not a passing performance acceptance run;
without a comparable pre-migration runtime sample, performance regression attribution
remains unverified. No tuning values were changed to satisfy the benchmark.

Electron's GPU child process failed inside the Codex sandbox; the actual runtime
checks completed outside that sandbox with disposable, isolated application data.
`npm run verify` still stops on the recorded formatting issues. Tests, lint, type
checks, dependency checks, and the build were therefore also run independently.

## Definition of done

- Every inventory destination exists; retired implementation folders/references are gone.
- Required batches are Verified; no temporary migration exports remain.
- No new test, type, lint, build, or dependency failures; baseline failures documented.
- Forbidden dependencies are rejected by exercised rules, not only by a clean report.
- Production assets/workers resolve and standalone development tools stay excluded.
- Documentation and architecture registry reflect the resulting ownership.
- Runtime transitions, match interactions, and scene resource cleanup are verified.

## Deferred adjacent issues

These issues are separate from the completed migration. Preserve human-authored
tuning values when addressing them in future work.

- Existing test failures: one seeded opening-match checkpoint snapshot, four IPC
  outline-tuning migration expectations, Mindbreaker hero-power availability,
  and a minion-outline test whose weapon mock lacks `hoverOutline.isEnabled`.
- Existing web type error: `src/renderer/dev/hero-power-anim/hero-power-anim-model.ts:53`
  has a callback without a return on every path (TS7030).
- Existing repository-wide lint failures come from `.tmp/vfx-preview/preview.js`.
  The lint command currently discovers that ignored generated bundle.
- Existing formatting failures remain in root `README.md` and
  `src/game/match/effects/effect-runtime.ts`; these files were left unchanged.
- The architecture registry's domain entrypoint
  `src/game/match/ai/policy-planner.ts` was already missing. Generated health
  findings and unresolved calls are review leads, not fixes included in this move.
- Match performance acceptance remains unverified, as described above.

## Extracted modules

- shared/navigation/app-route.ts: AppRoute and SceneRouter contracts.
- shared/navigation/scene-transition-options.ts: transition options contract.
- shared/contracts/dialog-service.ts: injected dialog contract.
- shared/match-setup/match-seed.ts: existing match seed generator.

## Complete original file map

| Source                                                                          | Destination                                                       | Batch       |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------- |
| `src/renderer/animation/animations.ts`                                          | `src/visual-components/animation/animations.ts`                   | shared      |
| `src/renderer/animation/kill-display-tweens.ts`                                 | `src/visual-components/animation/kill-display-tweens.ts`          | shared      |
| `src/renderer/app/ai-bridge-recovery.test.ts`                                   | `src/application/ai-bridge-recovery.test.ts`                      | stays       |
| `src/renderer/app/ai-decision-api.ts`                                           | `src/application/ai-decision-api.ts`                              | stays       |
| `src/renderer/app/ai-retry-notice.test.ts`                                      | `src/application/ai-retry-notice.test.ts`                         | stays       |
| `src/renderer/app/arena-store.ts`                                               | `src/application/arena-store.ts`                                  | stays       |
| `src/renderer/app/config.ts`                                                    | `src/application/config.ts`                                       | stays       |
| `src/renderer/app/deck-store.ts`                                                | `src/application/deck-store.ts`                                   | stays       |
| `src/renderer/app/dev-command-handler.ts`                                       | `src/dev-tools/runtime/dev-command-handler.ts`                    | development |
| `src/renderer/app/dev-dust-dialog.ts`                                           | `src/dev-tools/runtime/dev-dust-dialog.ts`                        | development |
| `src/renderer/app/dev-filter-toggle.ts`                                         | `src/dev-tools/runtime/dev-filter-toggle.ts`                      | development |
| `src/renderer/app/dev-match-performance.ts`                                     | `src/dev-tools/runtime/dev-match-performance.ts`                  | development |
| `src/renderer/app/dev-scene-sync.ts`                                            | `src/dev-tools/runtime/dev-scene-sync.ts`                         | development |
| `src/renderer/app/logger.ts`                                                    | `src/application/logger.ts`                                       | stays       |
| `src/renderer/app/player-stats-store.test.ts`                                   | `src/application/player-stats-store.test.ts`                      | stays       |
| `src/renderer/app/player-stats-store.ts`                                        | `src/application/player-stats-store.ts`                           | stays       |
| `src/renderer/app/progression-store.ts`                                         | `src/application/progression-store.ts`                            | stays       |
| `src/renderer/app/renderer-production-placeholder.ts`                           | `src/application/renderer-production-placeholder.ts`              | stays       |
| `src/renderer/app/router.ts`                                                    | `src/application/navigation/router.ts`                            | stays       |
| `src/renderer/app/scene-navigator.ts`                                           | `src/application/navigation/scene-navigator.ts`                   | stays       |
| `src/renderer/app/services.ts`                                                  | `src/application/services.ts`                                     | stays       |
| `src/renderer/env.d.ts`                                                         | `src/application/env.d.ts`                                        | stays       |
| `src/renderer/features/arena/arena-layout.ts`                                   | `src/scenes/arena/arena-layout.ts`                                | menus       |
| `src/renderer/features/arena/arena-model.test.ts`                               | `src/scenes/arena/arena-model.test.ts`                            | menus       |
| `src/renderer/features/arena/arena-model.ts`                                    | `src/scenes/arena/arena-model.ts`                                 | menus       |
| `src/renderer/features/arena/arena-rewards-layout.ts`                           | `src/scenes/arena/arena-rewards-layout.ts`                        | menus       |
| `src/renderer/features/arena/arena-rewards-view.ts`                             | `src/scenes/arena/arena-rewards-view.ts`                          | menus       |
| `src/renderer/features/arena/arena-view.ts`                                     | `src/scenes/arena/arena-view.ts`                                  | menus       |
| `src/renderer/features/card-preview/card-assembly-effects.ts`                   | `src/scenes/collection/card-preview/card-assembly-effects.ts`     | menus       |
| `src/renderer/features/card-preview/card-assembly-layout.ts`                    | `src/scenes/collection/card-preview/card-assembly-layout.ts`      | menus       |
| `src/renderer/features/card-preview/card-detail-panel.ts`                       | `src/scenes/collection/card-preview/card-detail-panel.ts`         | menus       |
| `src/renderer/features/card-preview/card-preview-layout.ts`                     | `src/scenes/collection/card-preview/card-preview-layout.ts`       | menus       |
| `src/renderer/features/card-preview/card-preview-route.ts`                      | `src/application/navigation/card-preview-route.ts`                | shared      |
| `src/renderer/features/card-preview/card-preview-view.ts`                       | `src/scenes/collection/card-preview/card-preview-view.ts`         | menus       |
| `src/renderer/features/card-preview/generated-card-preview.ts`                  | `src/scenes/collection/card-preview/generated-card-preview.ts`    | menus       |
| `src/renderer/features/card-preview/premium-upgrade-panel.ts`                   | `src/scenes/collection/card-preview/premium-upgrade-panel.ts`     | menus       |
| `src/renderer/features/collection/choreography/card-add-flight.ts`              | `src/visual-components/animation/card-add-flight.ts`              | shared      |
| `src/renderer/features/collection/collection-card-grid.ts`                      | `src/scenes/collection/collection-card-grid.ts`                   | menus       |
| `src/renderer/features/collection/collection-filters.ts`                        | `src/scenes/collection/collection-filters.ts`                     | menus       |
| `src/renderer/features/collection/collection-layout.ts`                         | `src/scenes/collection/collection-layout.ts`                      | menus       |
| `src/renderer/features/collection/collection-page-view.ts`                      | `src/scenes/collection/collection-page-view.ts`                   | menus       |
| `src/renderer/features/collection/collection-pages.test.ts`                     | `src/scenes/collection/collection-pages.test.ts`                  | menus       |
| `src/renderer/features/collection/collection-pages.ts`                          | `src/scenes/collection/collection-pages.ts`                       | menus       |
| `src/renderer/features/collection/collection-preview-cache.test.ts`             | `src/scenes/collection/collection-preview-cache.test.ts`          | menus       |
| `src/renderer/features/collection/collection-preview-cache.ts`                  | `src/scenes/collection/collection-preview-cache.ts`               | menus       |
| `src/renderer/features/collection/collection-query-controller.ts`               | `src/scenes/collection/collection-query-controller.ts`            | menus       |
| `src/renderer/features/collection/collection-query.test.ts`                     | `src/scenes/collection/collection-query.test.ts`                  | menus       |
| `src/renderer/features/collection/collection-query.ts`                          | `src/scenes/collection/collection-query.ts`                       | menus       |
| `src/renderer/features/collection/collection-view.ts`                           | `src/scenes/collection/collection-view.ts`                        | menus       |
| `src/renderer/features/collection/deck-editor-layout.ts`                        | `src/scenes/collection/deck-editor-layout.ts`                     | menus       |
| `src/renderer/features/collection/deck-editor-model.ts`                         | `src/scenes/collection/deck-editor-model.ts`                      | menus       |
| `src/renderer/features/collection/deck-list-model.ts`                           | `src/scenes/collection/deck-list-model.ts`                        | menus       |
| `src/renderer/features/collection/deck-list-view.ts`                            | `src/scenes/collection/deck-list-view.ts`                         | menus       |
| `src/renderer/features/collection/deck-name-input.ts`                           | `src/scenes/collection/deck-name-input.ts`                        | menus       |
| `src/renderer/features/collection/deck-panel-view.ts`                           | `src/scenes/collection/deck-panel-view.ts`                        | menus       |
| `src/renderer/features/collection/delete-deck-layout.ts`                        | `src/scenes/collection/delete-deck-layout.ts`                     | menus       |
| `src/renderer/features/collection/delete-deck-view.ts`                          | `src/scenes/collection/delete-deck-view.ts`                       | menus       |
| `src/renderer/features/collection/expansion-tray.ts`                            | `src/scenes/collection/expansion-tray.ts`                         | menus       |
| `src/renderer/features/collection/search-input.ts`                              | `src/scenes/collection/search-input.ts`                           | menus       |
| `src/renderer/features/deck-builder/new-deck-layout.ts`                         | `src/scenes/collection/deck-builder/new-deck-layout.ts`           | shared      |
| `src/renderer/features/deck-builder/new-deck-view.ts`                           | `src/scenes/collection/deck-builder/new-deck-view.ts`             | shared      |
| `src/renderer/features/deck-selection/deck-selection-layout.ts`                 | `src/scenes/deck-selection/deck-selection-layout.ts`              | menus       |
| `src/renderer/features/deck-selection/deck-selection-model.test.ts`             | `src/scenes/deck-selection/deck-selection-model.test.ts`          | menus       |
| `src/renderer/features/deck-selection/deck-selection-model.ts`                  | `src/scenes/deck-selection/deck-selection-model.ts`               | menus       |
| `src/renderer/features/deck-selection/deck-selection-view.ts`                   | `src/scenes/deck-selection/deck-selection-view.ts`                | menus       |
| `src/renderer/features/dev/card-inspector/card-inspector-controls.ts`           | `src/dev-tools/card-inspector/card-inspector-controls.ts`         | development |
| `src/renderer/features/dev/card-inspector/card-inspector-model.test.ts`         | `src/dev-tools/card-inspector/card-inspector-model.test.ts`       | development |
| `src/renderer/features/dev/card-inspector/card-inspector-model.ts`              | `src/dev-tools/card-inspector/card-inspector-model.ts`            | development |
| `src/renderer/features/dev/card-inspector/card-inspector.ts`                    | `src/dev-tools/card-inspector/card-inspector.ts`                  | development |
| `src/renderer/features/dev/card-inspector/index.ts`                             | `src/dev-tools/card-inspector/index.ts`                           | development |
| `src/renderer/features/dev/hero-power-anim/hero-power-anim-controls.ts`         | `src/dev-tools/hero-power-anim/hero-power-anim-controls.ts`       | development |
| `src/renderer/features/dev/hero-power-anim/hero-power-anim-fixtures.ts`         | `src/dev-tools/hero-power-anim/hero-power-anim-fixtures.ts`       | development |
| `src/renderer/features/dev/hero-power-anim/hero-power-anim-layout.ts`           | `src/dev-tools/hero-power-anim/hero-power-anim-layout.ts`         | development |
| `src/renderer/features/dev/hero-power-anim/hero-power-anim-model.ts`            | `src/dev-tools/hero-power-anim/hero-power-anim-model.ts`          | development |
| `src/renderer/features/dev/hero-power-anim/hero-power-anim.ts`                  | `src/dev-tools/hero-power-anim/hero-power-anim.ts`                | development |
| `src/renderer/features/dev/layout-inspector/index.ts`                           | `src/dev-tools/layout-inspector/index.ts`                         | development |
| `src/renderer/features/dev/layout-inspector/layout-inspector.ts`                | `src/dev-tools/layout-inspector/layout-inspector.ts`              | development |
| `src/renderer/features/dev/outline-lab/aura-lab-elements.ts`                    | `src/dev-tools/outline-lab/aura-lab-elements.ts`                  | development |
| `src/renderer/features/dev/outline-lab/index.ts`                                | `src/dev-tools/outline-lab/index.ts`                              | development |
| `src/renderer/features/dev/outline-lab/outline-lab-board.ts`                    | `src/dev-tools/outline-lab/outline-lab-board.ts`                  | development |
| `src/renderer/features/dev/outline-lab/outline-lab-hand.ts`                     | `src/dev-tools/outline-lab/outline-lab-hand.ts`                   | development |
| `src/renderer/features/dev/outline-lab/outline-lab-layout.ts`                   | `src/dev-tools/outline-lab/outline-lab-layout.ts`                 | development |
| `src/renderer/features/dev/outline-lab/outline-lab-palettes.ts`                 | `src/dev-tools/outline-lab/outline-lab-palettes.ts`               | development |
| `src/renderer/features/dev/outline-lab/outline-lab-shader-controls.ts`          | `src/dev-tools/outline-lab/outline-lab-shader-controls.ts`        | development |
| `src/renderer/features/dev/outline-lab/outline-lab.ts`                          | `src/dev-tools/outline-lab/outline-lab.ts`                        | development |
| `src/renderer/features/dev/outline-lab/shatter-lab.ts`                          | `src/dev-tools/outline-lab/shatter-lab.ts`                        | development |
| `src/renderer/features/dev/vfx-lab/index.ts`                                    | `src/dev-tools/vfx-lab/index.ts`                                  | development |
| `src/renderer/features/dev/vfx-lab/vfx-lab-controls.ts`                         | `src/dev-tools/vfx-lab/vfx-lab-controls.ts`                       | development |
| `src/renderer/features/dev/vfx-lab/vfx-lab-layout.ts`                           | `src/dev-tools/vfx-lab/vfx-lab-layout.ts`                         | development |
| `src/renderer/features/dev/vfx-lab/vfx-lab-model.ts`                            | `src/dev-tools/vfx-lab/vfx-lab-model.ts`                          | development |
| `src/renderer/features/dev/vfx-lab/vfx-lab.ts`                                  | `src/dev-tools/vfx-lab/vfx-lab.ts`                                | development |
| `src/renderer/features/game/add-card-picker-layout.ts`                          | `src/scenes/match/tools/add-card-picker-layout.ts`                | match       |
| `src/renderer/features/game/add-card-picker-model.ts`                           | `src/scenes/match/tools/add-card-picker-model.ts`                 | match       |
| `src/renderer/features/game/add-card-picker-view.ts`                            | `src/scenes/match/tools/add-card-picker-view.ts`                  | match       |
| `src/renderer/features/game/ai-action-intent.test.ts`                           | `src/scenes/match/ai/ai-action-intent.test.ts`                    | match       |
| `src/renderer/features/game/ai-action-intent.ts`                                | `src/scenes/match/ai/ai-action-intent.ts`                         | match       |
| `src/renderer/features/game/ai-compact-context.ts`                              | `src/scenes/match/ai/ai-compact-context.ts`                       | match       |
| `src/renderer/features/game/ai-context.test.ts`                                 | `src/scenes/match/ai/ai-context.test.ts`                          | match       |
| `src/renderer/features/game/ai-context.ts`                                      | `src/scenes/match/ai/ai-context.ts`                               | match       |
| `src/renderer/features/game/ai-fact-checks.test.ts`                             | `src/scenes/match/ai/ai-fact-checks.test.ts`                      | match       |
| `src/renderer/features/game/ai-fact-checks.ts`                                  | `src/scenes/match/ai/ai-fact-checks.ts`                           | match       |
| `src/renderer/features/game/ai-feedback.ts`                                     | `src/scenes/match/ai/ai-feedback.ts`                              | match       |
| `src/renderer/features/game/ai-forced-command.test.ts`                          | `src/scenes/match/ai/ai-forced-command.test.ts`                   | match       |
| `src/renderer/features/game/ai-forced-command.ts`                               | `src/scenes/match/ai/ai-forced-command.ts`                        | match       |
| `src/renderer/features/game/ai-prompts.ts`                                      | `src/scenes/match/ai/ai-prompts.ts`                               | match       |
| `src/renderer/features/game/ai-turn-controller.ts`                              | `src/scenes/match/ai/ai-turn-controller.ts`                       | match       |
| `src/renderer/features/game/attack-line.ts`                                     | `src/scenes/match/targeting/attack-line.ts`                       | match       |
| `src/renderer/features/game/board-ability-layout.test.ts`                       | `src/scenes/match/board/board-ability-layout.test.ts`             | match       |
| `src/renderer/features/game/board-ability-markers.test.ts`                      | `src/scenes/match/board/board-ability-markers.test.ts`            | match       |
| `src/renderer/features/game/board-ability-markers.ts`                           | `src/scenes/match/board/board-ability-markers.ts`                 | match       |
| `src/renderer/features/game/board-layout.ts`                                    | `src/scenes/match/board/board-layout.ts`                          | match       |
| `src/renderer/features/game/board-minion-card-preview.test.ts`                  | `src/scenes/match/board/board-minion-card-preview.test.ts`        | match       |
| `src/renderer/features/game/board-minion-card-preview.ts`                       | `src/scenes/match/board/board-minion-card-preview.ts`             | match       |
| `src/renderer/features/game/board-position-controller.ts`                       | `src/scenes/match/board/board-position-controller.ts`             | match       |
| `src/renderer/features/game/board-selection.test.ts`                            | `src/scenes/match/board/board-selection.test.ts`                  | match       |
| `src/renderer/features/game/board-selection.ts`                                 | `src/scenes/match/board/board-selection.ts`                       | match       |
| `src/renderer/features/game/card-choice-presentation.test.ts`                   | `src/scenes/match/presentation/card-choice-presentation.test.ts`  | match       |
| `src/renderer/features/game/card-choice-presentation.ts`                        | `src/scenes/match/presentation/card-choice-presentation.ts`       | match       |
| `src/renderer/features/game/card-departure-animation.ts`                        | `src/scenes/match/presentation/card-departure-animation.ts`       | match       |
| `src/renderer/features/game/card-departure-layout.ts`                           | `src/scenes/match/presentation/card-departure-layout.ts`          | match       |
| `src/renderer/features/game/card-draw-animation.ts`                             | `src/scenes/match/presentation/card-draw-animation.ts`            | match       |
| `src/renderer/features/game/card-draw-layout.ts`                                | `src/scenes/match/presentation/card-draw-layout.ts`               | match       |
| `src/renderer/features/game/card-play-animation.ts`                             | `src/scenes/match/presentation/card-play-animation.ts`            | match       |
| `src/renderer/features/game/card-play-layout.ts`                                | `src/scenes/match/presentation/card-play-layout.ts`               | match       |
| `src/renderer/features/game/card-reveal-layout.ts`                              | `src/scenes/match/presentation/card-reveal-layout.ts`             | match       |
| `src/renderer/features/game/card-reveal-presenter.ts`                           | `src/scenes/match/presentation/card-reveal-presenter.ts`          | match       |
| `src/renderer/features/game/card-selection-overlay.ts`                          | `src/scenes/match/presentation/card-selection-overlay.ts`         | match       |
| `src/renderer/features/game/character-indicator-presentation.ts`                | `src/scenes/match/combat/character-indicator-presentation.ts`     | match       |
| `src/renderer/features/game/combat-attack-warp.ts`                              | `src/scenes/match/combat/combat-attack-warp.ts`                   | match       |
| `src/renderer/features/game/combat-impact.ts`                                   | `src/scenes/match/combat/combat-impact.ts`                        | match       |
| `src/renderer/features/game/damage-indicator-layout.ts`                         | `src/scenes/match/combat/damage-indicator-layout.ts`              | match       |
| `src/renderer/features/game/damage-indicator-view.test.ts`                      | `src/scenes/match/combat/damage-indicator-view.test.ts`           | match       |
| `src/renderer/features/game/damage-indicator-view.ts`                           | `src/scenes/match/combat/damage-indicator-view.ts`                | match       |
| `src/renderer/features/game/deck-info-layout.ts`                                | `src/scenes/match/hud/deck-info-layout.ts`                        | match       |
| `src/renderer/features/game/deck-info-view.ts`                                  | `src/scenes/match/hud/deck-info-view.ts`                          | match       |
| `src/renderer/features/game/deck-stack-layout.ts`                               | `src/scenes/match/hud/deck-stack-layout.ts`                       | match       |
| `src/renderer/features/game/deck-stack-view.ts`                                 | `src/scenes/match/hud/deck-stack-view.ts`                         | match       |
| `src/renderer/features/game/deck-tracker-layout.ts`                             | `src/scenes/match/hud/deck-tracker-layout.ts`                     | match       |
| `src/renderer/features/game/deck-tracker-model.test.ts`                         | `src/scenes/match/hud/deck-tracker-model.test.ts`                 | match       |
| `src/renderer/features/game/deck-tracker-model.ts`                              | `src/scenes/match/hud/deck-tracker-model.ts`                      | match       |
| `src/renderer/features/game/deck-tracker-view.ts`                               | `src/scenes/match/hud/deck-tracker-view.ts`                       | match       |
| `src/renderer/features/game/dev-match-command-dispatch.test.ts`                 | `src/scenes/match/tools/dev-match-command-dispatch.test.ts`       | match       |
| `src/renderer/features/game/dev-match-command-dispatch.ts`                      | `src/scenes/match/tools/dev-match-command-dispatch.ts`            | match       |
| `src/renderer/features/game/drag-rotator.test.ts`                               | `src/scenes/match/hand/drag-rotator.test.ts`                      | match       |
| `src/renderer/features/game/drag-rotator.ts`                                    | `src/scenes/match/hand/drag-rotator.ts`                           | match       |
| `src/renderer/features/game/event-presentation-policy.test.ts`                  | `src/scenes/match/presentation/event-presentation-policy.test.ts` | match       |
| `src/renderer/features/game/event-presentation-policy.ts`                       | `src/scenes/match/presentation/event-presentation-policy.ts`      | match       |
| `src/renderer/features/game/expert-ai-action-safety.ts`                         | `src/scenes/match/ai/expert-ai-action-safety.ts`                  | match       |
| `src/renderer/features/game/expert-ai-consensus.ts`                             | `src/scenes/match/ai/expert-ai-consensus.ts`                      | match       |
| `src/renderer/features/game/expert-ai-decision-api.test.ts`                     | `src/scenes/match/ai/expert-ai-decision-api.test.ts`              | match       |
| `src/renderer/features/game/expert-ai-decision-api.ts`                          | `src/scenes/match/ai/expert-ai-decision-api.ts`                   | match       |
| `src/renderer/features/game/expert-ai-timeout-fallback.test.ts`                 | `src/scenes/match/ai/expert-ai-timeout-fallback.test.ts`          | match       |
| `src/renderer/features/game/expert-ai-timeout-fallback.ts`                      | `src/scenes/match/ai/expert-ai-timeout-fallback.ts`               | match       |
| `src/renderer/features/game/expert-ai-worker-protocol.ts`                       | `src/scenes/match/ai/expert-ai-worker-protocol.ts`                | match       |
| `src/renderer/features/game/expert-ai-world-pool.test.ts`                       | `src/scenes/match/ai/expert-ai-world-pool.test.ts`                | match       |
| `src/renderer/features/game/expert-ai-world-pool.ts`                            | `src/scenes/match/ai/expert-ai-world-pool.ts`                     | match       |
| `src/renderer/features/game/expert-ai-world-runner.ts`                          | `src/scenes/match/ai/expert-ai-world-runner.ts`                   | match       |
| `src/renderer/features/game/expert-ai-world.worker.ts`                          | `src/scenes/match/ai/expert-ai-world.worker.ts`                   | match       |
| `src/renderer/features/game/expert-ai.worker.ts`                                | `src/scenes/match/ai/expert-ai.worker.ts`                         | match       |
| `src/renderer/features/game/expert-coin-hero-power-policy.ts`                   | `src/scenes/match/ai/expert-coin-hero-power-policy.ts`            | match       |
| `src/renderer/features/game/expert-deck-evaluation.ts`                          | `src/scenes/match/ai/expert-deck-evaluation.ts`                   | match       |
| `src/renderer/features/game/expert-tactics.ts`                                  | `src/scenes/match/ai/expert-tactics.ts`                           | match       |
| `src/renderer/features/game/fatigue-layout.ts`                                  | `src/scenes/match/hud/fatigue-layout.ts`                          | match       |
| `src/renderer/features/game/fatigue-view.test.ts`                               | `src/scenes/match/hud/fatigue-view.test.ts`                       | match       |
| `src/renderer/features/game/fatigue-view.ts`                                    | `src/scenes/match/hud/fatigue-view.ts`                            | match       |
| `src/renderer/features/game/game-board-session.ts`                              | `src/scenes/match/game-board-session.ts`                          | match       |
| `src/renderer/features/game/game-board-view.ts`                                 | `src/scenes/match/board/game-board-view.ts`                       | match       |
| `src/renderer/features/game/game-card-slot.ts`                                  | `src/scenes/match/hand/game-card-slot.ts`                         | match       |
| `src/renderer/features/game/game-card-targeting-types.ts`                       | `src/scenes/match/targeting/game-card-targeting-types.ts`         | match       |
| `src/renderer/features/game/game-card-targeting.ts`                             | `src/scenes/match/targeting/game-card-targeting.ts`               | match       |
| `src/renderer/features/game/game-combat-presentation.ts`                        | `src/scenes/match/combat/game-combat-presentation.ts`             | match       |
| `src/renderer/features/game/game-hand-drag.ts`                                  | `src/scenes/match/hand/game-hand-drag.ts`                         | match       |
| `src/renderer/features/game/game-hand-entry.ts`                                 | `src/scenes/match/hand/game-hand-entry.ts`                        | match       |
| `src/renderer/features/game/game-hand-view.ts`                                  | `src/scenes/match/hand/game-hand-view.ts`                         | match       |
| `src/renderer/features/game/game-hud-view.ts`                                   | `src/scenes/match/hud/game-hud-view.ts`                           | match       |
| `src/renderer/features/game/game-loading-layout.ts`                             | `src/scenes/match/loading/game-loading-layout.ts`                 | match       |
| `src/renderer/features/game/game-loading-view.ts`                               | `src/scenes/match/loading/game-loading-view.ts`                   | match       |
| `src/renderer/features/game/game-mulligan-view.ts`                              | `src/scenes/match/game-mulligan-view.ts`                          | match       |
| `src/renderer/features/game/game-presentation-animation.ts`                     | `src/scenes/match/presentation/game-presentation-animation.ts`    | match       |
| `src/renderer/features/game/game-presentation-timing.ts`                        | `src/scenes/match/presentation/game-presentation-timing.ts`       | match       |
| `src/renderer/features/game/game-route.test.ts`                                 | `src/application/navigation/game-route.test.ts`                   | shared      |
| `src/renderer/features/game/game-route.ts`                                      | `src/application/navigation/game-route.ts`                        | shared      |
| `src/renderer/features/game/game-scene-layout.ts`                               | `src/scenes/match/game-scene-layout.ts`                           | match       |
| `src/renderer/features/game/hand-card-perspective-pool.ts`                      | `src/scenes/match/hand/hand-card-perspective-pool.ts`             | match       |
| `src/renderer/features/game/hand-card-perspective.ts`                           | `src/scenes/match/hand/hand-card-perspective.ts`                  | match       |
| `src/renderer/features/game/hand-discard-presentation.ts`                       | `src/scenes/match/hand/hand-discard-presentation.ts`              | match       |
| `src/renderer/features/game/hand-drag.ts`                                       | `src/scenes/match/hand/hand-drag.ts`                              | match       |
| `src/renderer/features/game/hand-layout.test.ts`                                | `src/scenes/match/hand/hand-layout.test.ts`                       | match       |
| `src/renderer/features/game/hand-layout.ts`                                     | `src/scenes/match/hand/hand-layout.ts`                            | match       |
| `src/renderer/features/game/hand-play-gesture.test.ts`                          | `src/scenes/match/hand/hand-play-gesture.test.ts`                 | match       |
| `src/renderer/features/game/hand-play-gesture.ts`                               | `src/scenes/match/hand/hand-play-gesture.ts`                      | match       |
| `src/renderer/features/game/heal-indicator-layout.ts`                           | `src/scenes/match/combat/heal-indicator-layout.ts`                | match       |
| `src/renderer/features/game/heal-indicator-view.ts`                             | `src/scenes/match/combat/heal-indicator-view.ts`                  | match       |
| `src/renderer/features/game/hero-power-effects/hero-power-effects-presenter.ts` | `src/scenes/match/board/hero-power-effects-presenter.ts`          | match       |
| `src/renderer/features/game/hero-power-effects/priest-heal-effect.ts`           | `src/scenes/match/board/priest-heal-effect.ts`                    | match       |
| `src/renderer/features/game/hero-power-effects/priest-heal-layout.ts`           | `src/scenes/match/board/priest-heal-layout.ts`                    | match       |
| `src/renderer/features/game/hero-power-effects/shaman-totem-effect.ts`          | `src/scenes/match/board/shaman-totem-effect.ts`                   | match       |
| `src/renderer/features/game/hero-power-effects/shaman-totem-layout.ts`          | `src/scenes/match/board/shaman-totem-layout.ts`                   | match       |
| `src/renderer/features/game/hero-power-effects/warlock-life-tap-effect.ts`      | `src/scenes/match/board/warlock-life-tap-effect.ts`               | match       |
| `src/renderer/features/game/hero-power-effects/warlock-life-tap-layout.ts`      | `src/scenes/match/board/warlock-life-tap-layout.ts`               | match       |
| `src/renderer/features/game/hero-power-effects/warrior-armor-up-effect.ts`      | `src/scenes/match/board/warrior-armor-up-effect.ts`               | match       |
| `src/renderer/features/game/hero-power-effects/warrior-armor-up-layout.ts`      | `src/scenes/match/board/warrior-armor-up-layout.ts`               | match       |
| `src/renderer/features/game/hero-power-effects/warrior-tank-up-effect.ts`       | `src/scenes/match/board/warrior-tank-up-effect.ts`                | match       |
| `src/renderer/features/game/hero-power-effects/warrior-tank-up-layout.ts`       | `src/scenes/match/board/warrior-tank-up-layout.ts`                | match       |
| `src/renderer/features/game/hero-power-targeting.test.ts`                       | `src/scenes/match/targeting/hero-power-targeting.test.ts`         | match       |
| `src/renderer/features/game/hero-power-targeting.ts`                            | `src/scenes/match/targeting/hero-power-targeting.ts`              | match       |
| `src/renderer/features/game/hero-power-view.ts`                                 | `src/scenes/match/board/hero-power-view.ts`                       | match       |
| `src/renderer/features/game/hover-preview-controller.test.ts`                   | `src/scenes/match/targeting/hover-preview-controller.test.ts`     | match       |
| `src/renderer/features/game/hover-preview-controller.ts`                        | `src/scenes/match/targeting/hover-preview-controller.ts`          | match       |
| `src/renderer/features/game/local-ai-artifact-scenarios.test.ts`                | `src/scenes/match/ai/local-ai-artifact-scenarios.test.ts`         | match       |
| `src/renderer/features/game/local-ai-decision-api.test.ts`                      | `src/scenes/match/ai/local-ai-decision-api.test.ts`               | match       |
| `src/renderer/features/game/local-ai-decision-api.ts`                           | `src/scenes/match/ai/local-ai-decision-api.ts`                    | match       |
| `src/renderer/features/game/local-ai-matchup-benchmark.test.ts`                 | `src/scenes/match/ai/local-ai-matchup-benchmark.test.ts`          | match       |
| `src/renderer/features/game/local-ai-policy.ts`                                 | `src/scenes/match/ai/local-ai-policy.ts`                          | match       |
| `src/renderer/features/game/local-ai-scenarios.test.ts`                         | `src/scenes/match/ai/local-ai-scenarios.test.ts`                  | match       |
| `src/renderer/features/game/local-ai-turn-planning.test.ts`                     | `src/scenes/match/ai/local-ai-turn-planning.test.ts`              | match       |
| `src/renderer/features/game/mana-tray.ts`                                       | `src/scenes/match/hud/mana-tray.ts`                               | match       |
| `src/renderer/features/game/match-artwork-warmup.ts`                            | `src/scenes/match/loading/match-artwork-warmup.ts`                | match       |
| `src/renderer/features/game/match-history-layout.ts`                            | `src/scenes/match/history/match-history-layout.ts`                | match       |
| `src/renderer/features/game/match-history-model.test.ts`                        | `src/scenes/match/history/match-history-model.test.ts`            | match       |
| `src/renderer/features/game/match-history-model.ts`                             | `src/scenes/match/history/match-history-model.ts`                 | match       |
| `src/renderer/features/game/match-history-view.ts`                              | `src/scenes/match/history/match-history-view.ts`                  | match       |
| `src/renderer/features/game/match-log-capture.ts`                               | `src/scenes/match/history/match-log-capture.ts`                   | match       |
| `src/renderer/features/game/match-premium-appearance.test.ts`                   | `src/scenes/match/presentation/match-premium-appearance.test.ts`  | match       |
| `src/renderer/features/game/match-premium-appearance.ts`                        | `src/scenes/match/presentation/match-premium-appearance.ts`       | match       |
| `src/renderer/features/game/match-recorder.ts`                                  | `src/scenes/match/history/match-recorder.ts`                      | match       |
| `src/renderer/features/game/match-result-overlay.ts`                            | `src/scenes/match/results/match-result-overlay.ts`                | match       |
| `src/renderer/features/game/match-result-state.test.ts`                         | `src/scenes/match/results/match-result-state.test.ts`             | match       |
| `src/renderer/features/game/match-result-state.ts`                              | `src/scenes/match/results/match-result-state.ts`                  | match       |
| `src/renderer/features/game/match-win-tracking.test.ts`                         | `src/scenes/match/results/match-win-tracking.test.ts`             | match       |
| `src/renderer/features/game/match-win-tracking.ts`                              | `src/scenes/match/results/match-win-tracking.ts`                  | match       |
| `src/renderer/features/game/presentation-queue.test.ts`                         | `src/scenes/match/presentation/presentation-queue.test.ts`        | match       |
| `src/renderer/features/game/presentation-queue.ts`                              | `src/scenes/match/presentation/presentation-queue.ts`             | match       |
| `src/renderer/features/game/quest-preview-view.ts`                              | `src/scenes/match/board/quest-preview-view.ts`                    | match       |
| `src/renderer/features/game/random-spell-presentation.ts`                       | `src/scenes/match/presentation/random-spell-presentation.ts`      | match       |
| `src/renderer/features/game/remote-card-play-preview.test.ts`                   | `src/scenes/match/presentation/remote-card-play-preview.test.ts`  | match       |
| `src/renderer/features/game/remote-card-play-preview.ts`                        | `src/scenes/match/presentation/remote-card-play-preview.ts`       | match       |
| `src/renderer/features/game/remote-hand-layout.ts`                              | `src/scenes/match/hand/remote-hand-layout.ts`                     | match       |
| `src/renderer/features/game/remote-target-preview.ts`                           | `src/scenes/match/targeting/remote-target-preview.ts`             | match       |
| `src/renderer/features/game/return-presentation.ts`                             | `src/scenes/match/presentation/return-presentation.ts`            | match       |
| `src/renderer/features/game/screen-shake.ts`                                    | `src/scenes/match/combat/screen-shake.ts`                         | match       |
| `src/renderer/features/game/secret-layout.test.ts`                              | `src/scenes/match/board/secret-layout.test.ts`                    | match       |
| `src/renderer/features/game/secret-layout.ts`                                   | `src/scenes/match/board/secret-layout.ts`                         | match       |
| `src/renderer/features/game/secret-preview-view.ts`                             | `src/scenes/match/board/secret-preview-view.ts`                   | match       |
| `src/renderer/features/game/secret-view.ts`                                     | `src/scenes/match/board/secret-view.ts`                           | match       |
| `src/renderer/features/game/summon-presentation.ts`                             | `src/scenes/match/presentation/summon-presentation.ts`            | match       |
| `src/renderer/features/game/target-gesture.test.ts`                             | `src/scenes/match/targeting/target-gesture.test.ts`               | match       |
| `src/renderer/features/game/target-gesture.ts`                                  | `src/scenes/match/targeting/target-gesture.ts`                    | match       |
| `src/renderer/features/game/turn-action-availability.test.ts`                   | `src/scenes/match/targeting/turn-action-availability.test.ts`     | match       |
| `src/renderer/features/game/turn-action-availability.ts`                        | `src/scenes/match/targeting/turn-action-availability.ts`          | match       |
| `src/renderer/features/main-menu/main-menu-layout.ts`                           | `src/scenes/main-menu/main-menu-layout.ts`                        | main-menu   |
| `src/renderer/features/main-menu/main-menu-view.ts`                             | `src/scenes/main-menu/main-menu-view.ts`                          | main-menu   |
| `src/renderer/features/settings/ai-mode-selector.ts`                            | `src/scenes/settings/ai-mode-selector.ts`                         | menus       |
| `src/renderer/features/settings/expert-deck-strategy-toggle.ts`                 | `src/scenes/settings/expert-deck-strategy-toggle.ts`              | menus       |
| `src/renderer/features/settings/resolution-selector.ts`                         | `src/scenes/settings/resolution-selector.ts`                      | menus       |
| `src/renderer/features/settings/settings-layout.ts`                             | `src/scenes/settings/settings-layout.ts`                          | menus       |
| `src/renderer/features/tavern-brawl/tavern-brawl-layout.ts`                     | `src/scenes/tavern-brawl/tavern-brawl-layout.ts`                  | menus       |
| `src/renderer/features/tavern-brawl/tavern-brawl-model.test.ts`                 | `src/scenes/tavern-brawl/tavern-brawl-model.test.ts`              | menus       |
| `src/renderer/features/tavern-brawl/tavern-brawl-model.ts`                      | `src/scenes/tavern-brawl/tavern-brawl-model.ts`                   | menus       |
| `src/renderer/index.html`                                                       | `src/application/index.html`                                      | stays       |
| `src/renderer/main.ts`                                                          | `src/application/main.ts`                                         | stays       |
| `src/renderer/rendering/cards/card-cost-presentation.test.ts`                   | `src/visual-components/cards/card-cost-presentation.test.ts`      | shared      |
| `src/renderer/rendering/cards/card-cost-presentation.ts`                        | `src/visual-components/cards/card-cost-presentation.ts`           | shared      |
| `src/renderer/rendering/cards/card-layout.ts`                                   | `src/visual-components/cards/card-layout.ts`                      | shared      |
| `src/renderer/rendering/cards/card-parallax.ts`                                 | `src/visual-components/cards/card-parallax.ts`                    | shared      |
| `src/renderer/rendering/cards/card-render-tree.ts`                              | `src/visual-components/cards/card-render-tree.ts`                 | shared      |
| `src/renderer/rendering/cards/card-text-markup.ts`                              | `src/visual-components/cards/card-text-markup.ts`                 | shared      |
| `src/renderer/rendering/cards/card-title-fit.ts`                                | `src/visual-components/cards/card-title-fit.ts`                   | shared      |
| `src/renderer/rendering/cards/card-view.ts`                                     | `src/visual-components/cards/card-view.ts`                        | shared      |
| `src/renderer/rendering/cards/class-frame-colors.ts`                            | `src/visual-components/cards/class-frame-colors.ts`               | shared      |
| `src/renderer/rendering/effects/animated-outline.ts`                            | `src/visual-components/effects/animated-outline.ts`               | shared      |
| `src/renderer/rendering/effects/aoe-vfx-shader.ts`                              | `src/visual-components/effects/aoe-vfx-shader.ts`                 | shared      |
| `src/renderer/rendering/effects/aura-distance-field.ts`                         | `src/visual-components/effects/aura-distance-field.ts`            | shared      |
| `src/renderer/rendering/effects/aura-field-cache.ts`                            | `src/visual-components/effects/aura-field-cache.ts`               | shared      |
| `src/renderer/rendering/effects/aura-filter.ts`                                 | `src/visual-components/effects/aura-filter.ts`                    | shared      |
| `src/renderer/rendering/effects/aura-projection.ts`                             | `src/visual-components/effects/aura-projection.ts`                | shared      |
| `src/renderer/rendering/effects/aura-shader-wgsl.ts`                            | `src/visual-components/effects/aura-shader-wgsl.ts`               | shared      |
| `src/renderer/rendering/effects/aura-shader.ts`                                 | `src/visual-components/effects/aura-shader.ts`                    | shared      |
| `src/renderer/rendering/effects/burn.ts`                                        | `src/visual-components/effects/burn.ts`                           | shared      |
| `src/renderer/rendering/effects/fire-vfx-shader-common.ts`                      | `src/visual-components/effects/fire-vfx-shader-common.ts`         | shared      |
| `src/renderer/rendering/effects/ghost-aura-shader.ts`                           | `src/visual-components/effects/ghost-aura-shader.ts`              | shared      |
| `src/renderer/rendering/effects/ghost-aura.ts`                                  | `src/visual-components/effects/ghost-aura.ts`                     | shared      |
| `src/renderer/rendering/effects/ghost-mist-filter.ts`                           | `src/visual-components/effects/ghost-mist-filter.ts`              | shared      |
| `src/renderer/rendering/effects/ghost-mist-particles.ts`                        | `src/visual-components/effects/ghost-mist-particles.ts`           | shared      |
| `src/renderer/rendering/effects/hinged-door.ts`                                 | `src/visual-components/effects/hinged-door.ts`                    | shared      |
| `src/renderer/rendering/effects/missile-vfx-shader.ts`                          | `src/visual-components/effects/missile-vfx-shader.ts`             | shared      |
| `src/renderer/rendering/effects/outline-directions-dev.ts`                      | `src/dev-tools/outline-lab/outline-directions-dev.ts`             | development |
| `src/renderer/rendering/effects/outline-directions-placeholder.ts`              | `src/visual-components/effects/outline-directions-placeholder.ts` | shared      |
| `src/renderer/rendering/effects/outline-tuning.test.ts`                         | `src/visual-components/effects/outline-tuning.test.ts`            | shared      |
| `src/renderer/rendering/effects/outline-tuning.ts`                              | `src/visual-components/effects/outline-tuning.ts`                 | shared      |
| `src/renderer/rendering/effects/premium-artwork-breath.ts`                      | `src/visual-components/effects/premium-artwork-breath.ts`         | shared      |
| `src/renderer/rendering/effects/shatter.ts`                                     | `src/visual-components/effects/shatter.ts`                        | shared      |
| `src/renderer/rendering/filters/highlight.ts`                                   | `src/visual-components/effects/highlight.ts`                      | shared      |
| `src/renderer/rendering/hero-powers/hero-power-layout.ts`                       | `src/scenes/match/board/hero-power-layout.ts`                     | match       |
| `src/renderer/rendering/hero-powers/hero-power-presentation.ts`                 | `src/scenes/match/board/hero-power-presentation.ts`               | match       |
| `src/renderer/rendering/heroes/hero-layout.ts`                                  | `src/scenes/match/board/hero-layout.ts`                           | match       |
| `src/renderer/rendering/heroes/hero-view.test.ts`                               | `src/scenes/match/board/hero-view.test.ts`                        | match       |
| `src/renderer/rendering/heroes/hero-view.ts`                                    | `src/scenes/match/board/hero-view.ts`                             | match       |
| `src/renderer/rendering/layout/contract.ts`                                     | `src/visual-components/layout/contract.ts`                        | shared      |
| `src/renderer/rendering/layout/index.ts`                                        | `src/visual-components/layout/index.ts`                           | shared      |
| `src/renderer/rendering/minions/minion-layout.ts`                               | `src/scenes/match/board/minion-layout.ts`                         | match       |
| `src/renderer/rendering/minions/minion-outline-layering.test.ts`                | `src/scenes/match/board/minion-outline-layering.test.ts`          | match       |
| `src/renderer/rendering/minions/minion-outline-shape.ts`                        | `src/scenes/match/board/minion-outline-shape.ts`                  | match       |
| `src/renderer/rendering/minions/minion-stat-presentation.ts`                    | `src/scenes/match/board/minion-stat-presentation.ts`              | match       |
| `src/renderer/rendering/minions/minion-view.test.ts`                            | `src/scenes/match/board/minion-view.test.ts`                      | match       |
| `src/renderer/rendering/minions/minion-view.ts`                                 | `src/scenes/match/board/minion-view.ts`                           | match       |
| `src/renderer/rendering/minions/sleeping-zs.ts`                                 | `src/scenes/match/board/sleeping-zs.ts`                           | match       |
| `src/renderer/rendering/premium-appearance.ts`                                  | `src/visual-components/cards/premium-appearance.ts`               | shared      |
| `src/renderer/rendering/shadows/board-shadow-layer.ts`                          | `src/scenes/match/board/board-shadow-layer.ts`                    | match       |
| `src/renderer/rendering/shadows/match-shadow-config.ts`                         | `src/scenes/match/board/match-shadow-config.ts`                   | match       |
| `src/renderer/rendering/shadows/README.md`                                      | `src/scenes/match/board/board-shadows.md`                         | match       |
| `src/renderer/rendering/shadows/shadow-caster.ts`                               | `src/visual-components/effects/shadow-caster.ts`                  | shared      |
| `src/renderer/rendering/temporary-ability-badge.ts`                             | `src/scenes/match/board/temporary-ability-badge.ts`               | match       |
| `src/renderer/rendering/weapons/weapon-layout.ts`                               | `src/scenes/match/board/weapon-layout.ts`                         | match       |
| `src/renderer/rendering/weapons/weapon-outline-shape.ts`                        | `src/scenes/match/board/weapon-outline-shape.ts`                  | match       |
| `src/renderer/rendering/weapons/weapon-view.ts`                                 | `src/scenes/match/board/weapon-view.ts`                           | match       |
| `src/renderer/scenes/arena-scene.ts`                                            | `src/scenes/arena/arena-scene.ts`                                 | menus       |
| `src/renderer/scenes/card-view-scene.ts`                                        | `src/scenes/collection/card-preview/card-view-scene.ts`           | menus       |
| `src/renderer/scenes/collection-scene.ts`                                       | `src/scenes/collection/collection-scene.ts`                       | menus       |
| `src/renderer/scenes/deck-selection-scene.ts`                                   | `src/scenes/deck-selection/deck-selection-scene.ts`               | menus       |
| `src/renderer/scenes/dev/card-inspector-scene.ts`                               | `src/dev-tools/card-inspector/card-inspector-scene.ts`            | development |
| `src/renderer/scenes/dev/hero-power-anim-scene.ts`                              | `src/dev-tools/hero-power-anim/hero-power-anim-scene.ts`          | development |
| `src/renderer/scenes/dev/outline-lab-scene.ts`                                  | `src/dev-tools/outline-lab/outline-lab-scene.ts`                  | development |
| `src/renderer/scenes/dev/vfx-lab-scene.ts`                                      | `src/dev-tools/vfx-lab/vfx-lab-scene.ts`                          | development |
| `src/renderer/scenes/game-scene.ts`                                             | `src/scenes/match/game-scene.ts`                                  | match       |
| `src/renderer/scenes/main-menu-scene.ts`                                        | `src/scenes/main-menu/main-menu-scene.ts`                         | main-menu   |
| `src/renderer/scenes/new-deck-scene.ts`                                         | `src/scenes/collection/deck-builder/new-deck-scene.ts`            | menus       |
| `src/renderer/scenes/scene-manager-port.ts`                                     | `src/application/contracts/scene-manager-port.ts`                 | shared      |
| `src/renderer/scenes/scene-manager.ts`                                          | `src/application/navigation/scene-manager.ts`                     | shared      |
| `src/renderer/scenes/scene.ts`                                                  | `src/visual-components/lifecycle/scene.ts`                        | shared      |
| `src/renderer/scenes/settings-scenes.ts`                                        | `src/scenes/settings/settings-scenes.ts`                          | menus       |
| `src/renderer/scenes/tavern-brawl-scene.ts`                                     | `src/scenes/tavern-brawl/tavern-brawl-scene.ts`                   | menus       |
| `src/renderer/scenes/transitions/scene-transition-host.ts`                      | `src/visual-components/transitions/scene-transition-host.ts`      | shared      |
| `src/renderer/styles.css`                                                       | `src/application/styles.css`                                      | stays       |
| `src/renderer/ui/arena-store.ts`                                                | `src/application/contracts/arena-store.ts`                        | shared      |
| `src/renderer/ui/asset-registry/asset-bundle-ids.ts`                            | `src/visual-components/assets/asset-bundle-ids.ts`                | shared      |
| `src/renderer/ui/asset-registry/asset-definition.ts`                            | `src/visual-components/assets/asset-definition.ts`                | shared      |
| `src/renderer/ui/asset-registry/asset-scope.ts`                                 | `src/visual-components/assets/asset-scope.ts`                     | shared      |
| `src/renderer/ui/asset-registry/card-asset-resolver.ts`                         | `src/visual-components/assets/card-asset-resolver.ts`             | shared      |
| `src/renderer/ui/asset-registry/card-assets.ts`                                 | `src/visual-components/assets/card-assets.ts`                     | shared      |
| `src/renderer/ui/asset-registry/deck-frames.ts`                                 | `src/visual-components/assets/deck-frames.ts`                     | shared      |
| `src/renderer/ui/asset-registry/deck-portraits.test.ts`                         | `src/visual-components/assets/deck-portraits.test.ts`             | shared      |
| `src/renderer/ui/asset-registry/deck-portraits.ts`                              | `src/visual-components/assets/deck-portraits.ts`                  | shared      |
| `src/renderer/ui/asset-registry/gadgetzan-artwork-aliases.ts`                   | `src/visual-components/assets/gadgetzan-artwork-aliases.ts`       | shared      |
| `src/renderer/ui/asset-registry/hero-assets.ts`                                 | `src/visual-components/assets/hero-assets.ts`                     | shared      |
| `src/renderer/ui/asset-registry/hero-power-asset-keys.ts`                       | `src/visual-components/assets/hero-power-asset-keys.ts`           | shared      |
| `src/renderer/ui/asset-registry/hero-power-assets.test.ts`                      | `src/visual-components/assets/hero-power-assets.test.ts`          | shared      |
| `src/renderer/ui/asset-registry/hero-power-assets.ts`                           | `src/visual-components/assets/hero-power-assets.ts`               | shared      |
| `src/renderer/ui/asset-registry/index.ts`                                       | `src/visual-components/assets/index.ts`                           | shared      |
| `src/renderer/ui/asset-registry/rank-medals.ts`                                 | `src/visual-components/assets/rank-medals.ts`                     | shared      |
| `src/renderer/ui/components/actor.ts`                                           | `src/visual-components/lifecycle/actor.ts`                        | shared      |
| `src/renderer/ui/components/button.ts`                                          | `src/visual-components/controls/button.ts`                        | shared      |
| `src/renderer/ui/components/cursor.ts`                                          | `src/visual-components/controls/cursor.ts`                        | shared      |
| `src/renderer/ui/components/deck-entry-button.ts`                               | `src/visual-components/controls/deck-entry-button.ts`             | shared      |
| `src/renderer/ui/components/flip-card.ts`                                       | `src/visual-components/controls/flip-card.ts`                     | shared      |
| `src/renderer/ui/deck-store.ts`                                                 | `src/application/contracts/deck-store.ts`                         | shared      |
| `src/renderer/ui/logger.ts`                                                     | `src/application/contracts/logger.ts`                             | shared      |
| `src/renderer/ui/player-stats-store.ts`                                         | `src/application/contracts/player-stats-store.ts`                 | shared      |
| `src/renderer/ui/progression-store.ts`                                          | `src/application/contracts/progression-store.ts`                  | shared      |
