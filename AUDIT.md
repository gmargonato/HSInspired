# Code audit and improvement plan

Reviewed: 2026-09-06. Status: planning complete; implementation has not started.

## Objective and scope

Make the working game easier to understand, maintain, and change, and remove demonstrably redundant work. Preserve gameplay, AI decisions, presentation, and persistence behavior. This document records a source-reviewed improvement plan, not a list of confirmed gameplay bugs.

The architecture is broadly sound. The strongest opportunities are unused legacy implementations, redundant forwarding, unnecessary state copies, and concentrated ownership in the match engine and board view. A rewrite, new framework, or arbitrary file-size target is not part of this plan.

Use `- [ ]` for pending work and `- [x]` only after implementation and its acceptance checks are complete. Record validation evidence under each phase when closing it. If a conditional task is declined after investigation, record the reason explicitly rather than marking an unimplemented change as completed.

## Evidence and second-pass corrections

The starting evidence is [the architecture report](artifacts/architecture/health-report.md), [the complete evidence](artifacts/architecture/code-health.json), and their [documented limitations](docs/architecture/README.md). The generated snapshot contains 332 review candidates and is partially stale. Current code and resolved callers take precedence. File sizes below include whitespace and comments and are observations, not acceptance targets.

| Finding                                      | Second-pass conclusion                                                                                                                                                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy hero-power and combat implementations | Confirmed inactive internal functions. Live dispatch uses the effect runtime. Preserve live compatibility command adapters.                                                                                                            |
| Always-true combat predicates                | Confirmed redundant conditions. Their permissive behavior is intentional and must remain.                                                                                                                                              |
| Collection deck controller                   | Nine methods forward unchanged; deletion confirmation is real behavior and must be preserved. Other controllers that own state are not equivalent.                                                                                     |
| State transaction copies                     | Confirmed three clones inside the current construct/replace/commit usage. The generic transaction implementation is not inherently broken; its match-facade usage is unnecessarily expensive.                                          |
| Board/HUD turn-banner ownership              | Both components manage the sprite, but cleanup already exists. This is an ownership improvement, not a demonstrated leak or crash.                                                                                                     |
| Large effect runtime and board view          | Confirmed mixed responsibilities. Their size alone does not establish incorrect behavior.                                                                                                                                              |
| Persistence duplication                      | Common write and queue mechanics exist. Recovery, initialization, and write scheduling differ and must remain repository-specific.                                                                                                     |
| Test gaps                                    | No direct references to `GameBoardView`, `AiTurnController`, `GameBoardSession`, `MatchRecorder`, or `MatchLogRepository` were found in current `src/**/*.test.ts`. This is a static observation, not proof of zero indirect coverage. |

The second pass also identified a missing structural opportunity: `opening-match.ts` combines command parsing, history projection, public-information masking, query caching, and command orchestration. Phase 4 addresses those existing responsibilities without changing its public API.

## Constraints for every phase

- Preserve card definitions, balance values, authored effect semantics, command acceptance/rejection, and AI policy ranking and fallback decisions.
- Preserve RNG consumption and restoration, entity IDs and counters, target iteration, trigger/death ordering, complete event sequences, history, and information visibility.
- Preserve layouts, labels, scales, animation timing, input behavior, and the ability to submit legal commands while presentation is queued.
- Preserve saved-data formats, migrations, corruption recovery, confirmation dialogs, logging, and error behavior.
- Follow [AGENTS.md](AGENTS.md), read applicable READMEs, and preserve unrelated worktree changes. Never delete existing assets.
- Use focused validation. Do not launch the application, performance runner, full build, or deployment automatically; follow the repository's authorization and necessity rules.
- Remove temporary test files and fixtures created for a run. Preserve existing tests and manual live-number adjustments. Prefer extending existing test files where useful.
- Inspect each phase's diff for behavior changes, unrelated cleanup, and new coupling before marking it complete.

## Phase overview

| Phase | Outcome                                            | Risk                    | Prerequisites                                |
| ----- | -------------------------------------------------- | ----------------------- | -------------------------------------------- |
| 0     | Establish behavior baselines and comparison checks | Low                     | None                                         |
| 1     | Remove inactive rule implementations               | Low                     | 0                                            |
| 2     | Remove inert conditions and redundant forwarding   | Low                     | 0                                            |
| 3     | Simplify state commit ownership and copying        | Medium                  | 0, preferably 1                              |
| 4     | Separate match-facade responsibilities             | Medium                  | 1, 3                                         |
| 5     | Give board components cohesive state and lifetimes | Medium/high             | 0, 2                                         |
| 6     | Decompose effect-runtime responsibilities          | High                    | 0, 3, 4                                      |
| 7     | Strengthen validated effect types incrementally    | Medium/high             | 6 for the affected action family             |
| 8     | Share matching persistence mechanics               | Low/medium              | 0; independent of renderer/engine extraction |
| 9     | Verify preservation and close the audit            | Proportional to changes | All adopted phases                           |

Complete small steps independently. Do not combine engine extraction, type redesign, and renderer changes in one patch.

## Phase 0 — Establish preservation evidence

Why: a refactor can preserve final health totals while changing events, RNG, hidden information, or input timing. Existing tests are useful but do not prove equivalence across all those boundaries.

Sources: [checkpoint tests](src/game/match/opening-match-checkpoint.test.ts), [match fuzz tests](src/game/match/match-fuzz.test.ts), [resolution presentation tests](src/game/match/effects/resolution-presentation.integration.test.ts), [gesture tests](src/renderer/features/game/hand-play-gesture.test.ts), and [presentation queue tests](src/renderer/features/game/presentation-queue.test.ts).

- [ ] Record the actual starting worktree and selected scenarios immediately before implementation; do not use stale artifact hashes as the baseline.
- [ ] Reuse existing scenarios for mulligan, draw/burn/fatigue, hero powers, combat, secrets, choices, auras, transformations, control changes, and chained deaths. Add focused cases only where an upcoming change lacks meaningful coverage.
- [ ] Capture reproducible seeded command sequences and compare accepted/rejected results, states, complete ordered events, legality, history, checkpoints, RNG state, and entity sequencing before and after engine changes.
- [ ] Check rejected commands, failed resolutions, preview/analyze restoration, and branches with equal revisions but different state identities.
- [ ] Check public state/events for both participants so hidden cards and secrets remain masked exactly as before.
- [ ] Before changing renderer orchestration, establish checks for multiple queued actions, targeting cancellation, choices, scene exit, and animation disposal. Use the existing game as the visual/input reference when runtime validation is required.
- [ ] Before touching AI/session/logging orchestration, add focused checks around the affected boundary using controlled responses; preserve current policy continuation, revision checks, fallback decisions, and recorded output without making live model requests.
- [ ] Record baseline results and any pre-existing failures. Treat intentional live-number differences as fixture drift, not authorization to change the game.

Acceptance: each proposed behavioral boundary change has a relevant comparison/check, with current behavior recorded independently of the refactored implementation. Baseline work does not need to block simple unused-code cleanup behind unrelated new test infrastructure.

## Phase 1 — Remove inactive rule implementations

Why: roughly 700 lines of unused hero-power and combat logic sit beside the working implementation, making it easy to maintain the wrong code.

Sources: [opening-match.ts](src/game/match/opening-match.ts), specifically the three `void apply...` references, `applyUseHeroPower`, `applyAttackCharacter`, `applyAttackMinion`, and `resolveAttackCharacter`. Live `dispatch` calls `resolveHeroPower` and `resolveAttack` from [effect-runtime.ts](src/game/match/effects/effect-runtime.ts).

- [ ] Recheck references immediately before removal, including exports, tests, and development commands.
- [ ] Remove the inactive functions and the three artificial `void` references.
- [ ] Remove supporting helpers/imports only when their remaining callers are also exclusively inactive.
- [ ] Preserve active compatibility adapters and current command/event shapes, including legacy attack commands accepted by live dispatch.
- [ ] Run focused hero-power/combat and checkpoint checks, TypeScript checks, and dependency validation.

Acceptance: commands follow the same live resolution path; no duplicate inactive implementation remains; observable command results and events are unchanged.

## Phase 2 — Simplify inert conditions and forwarding

Why: conditional-looking APIs and repeated interfaces add navigation and maintenance cost without providing corresponding behavior.

Sources: [combat-input-window.ts](src/renderer/features/game/combat-input-window.ts), [collection-deck-controller.ts](src/renderer/features/collection/collection-deck-controller.ts), [DeckStore](src/renderer/ui/deck-store.ts), [collection-scene.ts](src/renderer/scenes/collection-scene.ts), and [deck-panel-view.ts](src/renderer/features/collection/deck-panel-view.ts).

- [ ] Remove calls to the always-true combat predicates and simplify only the conditions made constant by those calls.
- [ ] Trace remaining reads before removing any combat flags. `combatInProgress` currently has other consumers and must not be removed wholesale.
- [ ] Preserve engine legality checks and immediate submission of legal attacks while earlier visuals are queued.
- [ ] Use the existing renderer-facing `DeckStore` interface for collection persistence operations instead of duplicating it through nine forwarding methods.
- [ ] Preserve the existing deletion confirmation, cancellation, error reporting, and subscription behavior through explicit dependencies at the collection boundary.
- [ ] Remove the redundant controller/interface only after updating all consumers, then check collection create/edit/delete flows and relevant input tests.

Acceptance: fewer forwarding methods and inert checks, with unchanged user flows. Features continue to depend on a lower-layer interface, never the concrete app store.

## Phase 3 — Simplify state commit copying

Why: `commitState` constructs a transaction that clones the old state, immediately discards that draft, clones the replacement, then clones it again on commit. Returned command snapshots are copied separately. The first copy is demonstrably unused in this call pattern; other copies require an ownership argument before removal.

Sources: `commitState`, `getQueryRuntime`, and preview/analyze methods in [opening-match.ts](src/game/match/opening-match.ts); [runtime-state.ts](src/game/match/rules/runtime-state.ts); and [runtime-state tests](src/game/match/rules/runtime-state.test.ts).

- [ ] Document who can retain or mutate the resolver result, internal committed state, returned snapshot, and preview state.
- [ ] Replace the construct/replace/commit pattern with a small validated commit operation that creates an isolated next state before publishing it.
- [ ] Remove additional copies only when alias isolation, validation ordering, and rollback guarantees are demonstrated to remain intact.
- [ ] Preserve query caching by both state identity and revision; preserve all RNG and counter restoration behavior.
- [ ] Recheck consumers of `StateTransaction` and `runStateTransaction` after the change. Remove obsolete generic machinery only if it no longer serves a supported use; move relevant assertions into existing match tests.
- [ ] Compare states, events, checkpoints, failed commands, and hypothetical branches against Phase 0, including mutation of returned snapshots.
- [ ] If reporting a performance improvement, measure representative command/simulation allocation or timing before and after. Without measurement, report only the confirmed reduction in copying.

Acceptance: the unnecessary old-state clone is eliminated, ownership is explicit, and all external snapshots and hypothetical branches retain their current isolation.

## Phase 4 — Separate match-facade responsibilities

Why: even after dead-code removal, [opening-match.ts](src/game/match/opening-match.ts) combines several independently understandable transformations with authoritative state ownership. It currently has 3,162 lines and repeated resolution-result handling across command paths.

- [ ] Extract command parsing into a pure domain module, preserving accepted shapes, optional-field handling, and rejection behavior.
- [ ] Extract history snapshot/event projection helpers into a cohesive domain module, preserving ordering and before/after-state selection.
- [ ] Extract public-state/event masking while retaining the existing [history visibility](src/game/match/history-visibility.ts) behavior and privacy checks.
- [ ] Review repeated resolver-result handling for a small shared operation only where rejection mapping, RNG restoration, commit, and counter handling are identical. Keep command-specific history/event additions explicit.
- [ ] Keep authoritative state, RNG, checkpoints, query-cache lifecycle, and dispatch coordination under one clear owner.
- [ ] Preserve exports and compatibility aliases in [turn-match.ts](src/game/match/turn-match.ts); avoid a repository-wide naming migration.
- [ ] Run command parsing, public-information, history, checkpoint, and dependency checks after each extraction.

Acceptance: the facade primarily coordinates the match; extracted helpers have explicit inputs and no circular value imports; public contracts and results remain identical.

## Phase 5 — Give board components cohesive ownership

Why: [GameBoardView](src/renderer/features/game/game-board-view.ts) currently spans approximately 8,044 lines and 245 method declarations. It mixes hand/mulligan interaction, targeting, combat presentation, AI scheduling, HUD coordination, and cleanup. The concrete starting point is the turn-banner sprite jointly managed with [GameHudView](src/renderer/features/game/game-hud-view.ts).

- [ ] Move turn-banner creation, animation, replacement, and cleanup under one HUD-owned operation; keep the sprite private to its owner.
- [ ] Preserve pause/resume/kill propagation when moving animation ownership. Existing cleanup is functional and must not be lost during extraction.
- [ ] Extract a cohesive hand/mulligan component with its state, listeners, preview objects, and disposal together.
- [ ] Extract cohesive combat/targeting presentation responsibilities with their owned views, pending work, and cleanup.
- [ ] Keep match/AI scheduling coordination explicit and preserve disposal and stale-result checks when moving any of that behavior.
- [ ] Keep the board coordinator small through responsibility boundaries. Do not pass the entire `GameBoardView` into extracted objects or reproduce its fields in a shared mutable bag.
- [ ] Preserve the distinction between authoritative state and the snapshot for the active presentation job, along with event handling and FIFO presentation order.
- [ ] Validate queued attacks, hand drops, hover/target cancellation, choice overlays, turn changes, scene exit, and restart. Confirm identical labels, layering, layout numbers, timings, and cursor behavior through appropriate runtime checks when required.

Acceptance: each extracted component owns a coherent behavior and its lifetime; coordinator and components preserve all current input/presentation behavior. Helper-only tests do not establish complete Pixi lifecycle equivalence.

## Phase 6 — Decompose the effect runtime

Why: [effect-runtime.ts](src/game/match/effects/effect-runtime.ts) currently has approximately 10,498 lines; `runAction` spans approximately 2,037. Selection, value evaluation, mutation, combat, triggers, and continuous effects share one implementation. Many branches are necessary card semantics, so reducing branch count is not itself the objective.

- [ ] Map dependencies and mutation requirements of selectors, value evaluation, conditions, action execution, combat, and continuous-effect derivation.
- [ ] Extract selector/value/condition responsibilities first, using narrow explicit context dependencies and preserving any counters, caches, or diagnostic side effects.
- [ ] Extract action families incrementally, keeping authored action traversal and dispatch visible and deterministic.
- [ ] Keep one resolution context responsible for draft state, RNG, entity counters, resolution budget, and trigger/death ordering.
- [ ] Preserve action paths, diagnostic labels, event correlations, rejection behavior, and trace content as well as game state.
- [ ] Preserve the existing [resolution queue](src/game/match/effects/resolution-queue.ts), including nested execution semantics. Do not replace it with a generic event bus or asynchronous scheduler.
- [ ] Update affected query tests to exercise extracted APIs instead of casts into private `EffectRuntime` methods where appropriate.
- [ ] Run focused tests for each extracted action family and Phase 0 comparisons for random effects, auras, secrets, choices, replacement effects, and death chains.

Acceptance: responsibilities become independently reviewable without new ownership ambiguity, shared global state, or changed resolution semantics. Keep extraction separate from the type changes in Phase 7.

## Phase 7 — Strengthen validated effect types

Why: [CardAction and CardEffectBlock](src/game/content/cards/card-effects.ts) have known discriminators but mostly generic recursive JSON fields. The interpreter repeatedly inspects unknown records. Stronger internal types can catch incompatible fields earlier while retaining JSON validation at the content boundary.

- [ ] Select one extracted action family and enumerate its currently supported field shapes, defaults, extensions, and optional values from the validator, catalog, and runtime.
- [ ] Add action-specific discriminated types for that family and narrow validated values into them without changing authored JSON.
- [ ] Remove only shape checks/casts made redundant by the established internal contract. Preserve validation of external or unknown inputs.
- [ ] Preserve [card-validator.ts](src/game/content/cards/card-validator.ts) acceptance, normalization, defaults, and diagnostic behavior; do not make this a schema migration.
- [ ] Keep unmigrated action families supported explicitly while progressing incrementally. Do not claim full type safety through broad assertions.
- [ ] Validate all existing card sets and the affected action scenarios after each family, then repeat for families where stronger types reduce complexity.

Acceptance: migrated handlers gain useful compiler guarantees, all current content behaves identically, and no new parser framework or competing source of card semantics is introduced.

## Phase 8 — Share matching persistence mechanisms

Why: [player stats](src/main/services/player-stats-repository.ts), [arena](src/main/services/arena-repository.ts), and [decks](src/main/services/deck-repository.ts) duplicate temporary-write/rename/cleanup and mutation-queue mechanics. Their recovery behavior differs; deck persistence also has a separate write queue.

- [ ] Compare serialization timing, directory creation, queue ordering, rejection propagation, and temporary-file cleanup for each proposed consumer.
- [ ] Extract a small main-process atomic-file replacement helper for matching mechanics, preserving unique temporary names and exact serialized output.
- [ ] Share serialized-operation mechanics only where ordering and failure recovery match; preserve existing queue topology unless separately proven redundant.
- [ ] Leave schema validation, initialization, migrations, corruption backups, default values, and domain operations in their repositories.
- [ ] Check concurrent mutations, write failures, rejected operations followed by successful ones, and publish-to-memory-after-write behavior using isolated fixtures.
- [ ] Record why any superficially similar consumer is intentionally excluded, particularly match logging with its own serialization and batching requirements.

Acceptance: shared helpers reduce duplication without a generic repository hierarchy, changed save formats, or changed recovery/error semantics.

## Phase 9 — Verify and close

Why: completion means simpler code with preserved behavior, not simply smaller files or green structural metrics.

- [ ] Review all adopted phases against their acceptance criteria and record commands/results next to completed work.
- [ ] Run the relevant existing tests and Phase 0 comparisons on the final worktree, including match state/events, public visibility, AI/session behavior where touched, and persistence behavior where touched.
- [ ] Run TypeScript and dependency checks; lint and format the changed files. Record unrelated pre-existing failures without silently fixing them.
- [ ] Complete visual/input validation for renderer changes and production build verification where required under repository rules. Do not report unrun gates as passing.
- [ ] Refresh architecture artifacts after implementation and inspect the resulting dependencies and ownership. Treat remaining findings as hypotheses, not an automatic cleanup backlog.
- [ ] Report measured performance changes separately from maintainability improvements; no FPS, memory, or AI-latency claim without supporting measurement.
- [ ] Remove temporary test/benchmark fixtures created for this work and inspect the final diff for asset, card-content, layout, and unrelated modifications.
- [ ] Leave any incomplete or deferred work explicitly documented; close phases only when their actual acceptance criteria are satisfied.

## Reviewed designs to retain

- Domain/process/renderer boundaries and typed navigation: current dependency validation passes. A small port with one implementation can still be a useful boundary.
- [Actor](src/renderer/ui/components/actor.ts) and animation scopes: forwarding here establishes animation ownership and cancellation.
- [AssetScope](src/renderer/ui/asset-registry/asset-scope.ts) and [baked outline reference counting](src/renderer/rendering/effects/baked-animated-outline.ts): shared resource lifetimes justify this machinery. Acquire/release functions both writing a reference count is not automatically an ownership defect.
- Engine resolution and renderer [presentation queues](src/renderer/features/game/presentation-queue.ts): they preserve different execution guarantees and should not be unified.
- Revision-and-identity query caching: it already reduces repeated derivation and distinguishes hypothetical branches.
- [Deck parsing](src/game/decks/deck-validation.ts): its validation branches are understandable and do not warrant an abstraction solely to lower a metric.
- Declarative assets, layouts, card data, development placeholders, and compatibility exports: length, forwarding, or absent production consumers alone do not justify deletion.

## Deferred observations and limitations

- The artifact's cycle between `opening-match-types.ts` and `ai/ai-types.ts` is type-only in the inspected code, not a runtime initialization cycle. Revisit contract placement only if it helps Phase 4; it is not an urgent repair.
- `boardThreat` in [ai-turn-controller.ts](src/renderer/features/game/ai-turn-controller.ts) derives fallback ranking features from `rulesText`. This couples AI behavior to display wording and deserves separate consideration alongside the repository's display-only-text principle. Replacing it with semantic metadata could change AI decisions, so this preservation plan does not authorize that change.
- `DeckPanelView` and other sizeable views remain secondary review candidates. Optimistic additions, async artwork, and transition cancellation are real behaviors; do not copy the board extraction plan onto them based on size alone.
- Logging/session/AI test-reference gaps justify targeted preservation checks before those boundaries change. They are not evidence that recording, privacy, or AI behavior is currently broken.
- This was a targeted architecture and source audit supported by static relationships and focused tests, not exhaustive runtime coverage, a security audit, or a performance profile. Future source changes can invalidate findings; recheck before implementing them.

## Validation history

- Initial audit: both TypeScript targets passed; dependency validation reported no violations; 50 tests across eight selected checkpoint, fuzz, query, resolution, queue, and gesture suites passed.
- Second pass: source/caller checks reconfirmed the actionable findings and qualified the ownership/persistence claims; `npm.cmd run deps:check` passed with 548 modules and 1,343 dependencies inspected.
- No refactor, full application launch, full build, or performance measurement was performed to create this plan. Initial-audit checks are historical evidence, not a replacement for the implementation baseline in Phase 0.
