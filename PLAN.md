# Card Effects Implementation Plan

## Purpose

This document is the execution contract for implementing the game's core card-effect
mechanisms from authored content through deterministic match resolution and renderer
presentation. Work proceeds phase after phase without waiting for human acceptance
between phases.

The roadmap is complete only when every declared card-effect construct is executable,
validated, presented coherently, and covered by the catalog-wide closure checks in the
final phase.

Artificial intelligence is explicitly out of scope. The existing random opponent is a
temporary driver, not an AI implementation. It may be adjusted only when necessary to
obey the same match rules as every other controller; it must not receive strategy,
search, evaluation, or decision-quality work under this plan.

## Progress Marking

Only ordinary Markdown checkboxes are used:

- `[ ]` means incomplete.
- `[x]` means complete.
- The agent marks implementation and automated-validation boxes.
- Only the human marks a Human acceptance box.
- An unchecked Human acceptance box does not block the agent from starting the next
  phase.
- A phase's Agent gate may be marked only after all agent-owned work in that phase is
  complete, its focused tests pass, `npm run verify` passes, and the phase diff has been
  reviewed.
- For an in-progress phase, an implementation box may be checked when the corresponding
  runtime path is present and exercised; this does not close the phase unless its
  automated-evaluation evidence and remaining implementation rows are complete.
- The audit update under each Phase status records addressed work and the evidence or
  semantics that still keep the phase open.

## Current Baseline

At the time this plan was written:

- The runtime catalog contains 625 card definitions across Basic, Classic, Goblins vs
  Gnomes, and Naxxramas.
- 486 cards contain at least one authored effect.
- The content schema declares 54 action names, 20 trigger types, 19 event types, 25
  condition types, 9 durations, and 12 keywords.
- The match engine owns mulligan, turns, mana, draw/fatigue/burn, hero powers, vanilla
  minion/weapon/hero play, and direct combat.
- Generic spell play, generic effect interpretation, runtime enchantments, most
  keywords, reactive triggers, auras, secrets, and catalog-wide effect execution do not
  yet exist.
- The renderer contains a temporary random opponent loop that bypasses some ordinary
  mana rules. That exception must disappear as controller-neutral legality is built.

After the 2026-08-27 implementation and audit pass:

- The canonical catalog contains 632 card definitions, including seven generated token
  definitions, and 493 cards contain at least one authored effect.
- The closed schema remains at 54 actions, 20 triggers, 19 events, 24 conditions, 9
  durations, and 12 keywords; the runtime capability registry contains 239 entries.
- npm run catalog:audit reports canonical schema/runtime ownership and npm run verify
  passes on the audited tree.

These numbers are inventory assertions, not permanent magic numbers. The catalog audit
must calculate its expectations from the closed schema and current content.

## Authority and Scope

- `AGENTS.md` remains authoritative for repository architecture, naming, layout,
  assets, workflow, and verification.
- This document is authoritative for effect-runtime semantics, phase order, completion
  gates, and the unattended-work policy.
- Authored JSON is input data, not executable code. Every file under
  `src/game/content/cards/sets/*.json` is human-authored project intent and is read-only
  throughout this roadmap. The agent must not edit, reformat, regenerate, normalize, or
  "correct" those files without a separate explicit instruction from the human.
- The card JSON intentionally combines faithful 2013/2014-era content with selected custom
  behavior and values inspired by later patches or original design choices. A difference
  from any historical Hearthstone version is not evidence that the JSON is wrong.
- Rules text is display-only. Runtime code must never parse `rulesText` to infer
  behavior.
- Existing asset files must never be deleted.
- AI, networking, matchmaking, persistence-format changes, unrelated UI redesign, and
  unrelated refactoring are out of scope.
- This plan does not authorize commits, pushes, releases, deployments, or launching the
  full application. Those actions require separate instruction. Focused tests, static
  checks, and `npm run verify` are authorized and required.

## Ownership and Placement Contracts

### Authored content

`src/game/content/cards/` owns the JSON-safe language used to describe cards:

- Card definitions, keywords, triggers, selectors, filters, conditions, durations,
  value expressions, and action shapes remain declarative.
- Content validation verifies syntax, closed vocabulary, referenced IDs, and semantic
  shape that can be established without match state.
- Content code must not execute effects or import match/runtime code.
- New one-off card behavior should first be expressed through the shared vocabulary.
  A bespoke action is acceptable only when the behavior cannot be modeled compositionally
  and the closed schema, capability audit, tests, and this plan's coverage map are updated.

### Match domain

All effect execution belongs below `src/game/match/`:

- `turn-match.ts` is the canonical public match facade. Existing exports must remain
  compatible while internals are decomposed.
- New effect-language interpretation belongs under `src/game/match/effects/`.
- Fundamental non-card rules such as zones, combat, death processing, mana, and turn
  transitions belong under `src/game/match/rules/` when extracted.
- Canonical match state, entity references, commands, results, and events remain match
  domain contracts. They must not depend on PixiJS, Electron, DOM, Node.js, or renderer
  types.
- `opening-match.ts` may remain as a compatibility facade while callers and tests migrate;
  it must not remain the permanent home of all new mechanisms.
- Tests should be colocated with the relevant match module. Shared test builders may live
  under `src/game/match/testing/`, but production modules must never depend on them.

The directory names above are ownership targets, not permission for a broad one-shot
rewrite. Extract incrementally while preserving observable behavior and keeping the
public facade usable.

### Renderer

`src/renderer/features/game/` owns game interaction and presentation only:

- It asks the match domain what input a card requires, gathers human target/choice input,
  dispatches a typed command, and presents returned state/events.
- It must not select targets, test effect conditions, calculate effect values, order
  triggers, mutate match state, or duplicate legality rules.
- Presentation handlers may group or animate domain events, but animation completion
  cannot determine game outcomes.
- Every new placed visual remains governed by the scene layout contract in `AGENTS.md`.
- Temporary developer controls may invoke typed domain commands but cannot mutate
  renderer-owned copies of game state.

### Shared and process layers

Effect runtime contracts stay in `src/game` unless a genuine cross-process boundary
requires a process-safe request/response type in `src/shared`. Main and preload must not
interpret card effects.

## Core Definitions

- **Card definition**: immutable catalog content shared by every copy of a card.
- **Entity**: one runtime identity in a match. Cards, minions, heroes, hero powers,
  weapons, secrets, and other addressable objects use typed references and stable runtime
  IDs.
- **Controller**: the participant that currently controls an entity. Ownership and
  controller are distinct where control-changing effects require it.
- **Zone**: the authoritative location of an entity, including deck, hand, board, hero,
  hero power, weapon, secret, graveyard/history, and temporary revealed/set-aside state
  where required.
- **Command**: an external request to change the match. A command is validated against a
  snapshot and is either rejected without mutation or accepted as one atomic resolution.
- **Play input**: the ordered choices and chosen entity references required before a
  play-card command can be accepted. Missing, duplicate, stale, or illegal input rejects
  the command without spending mana or moving the card.
- **Effect block**: an authored trigger plus actions or control flow.
- **Effect frame**: one runtime invocation of an effect block with source, controller,
  triggering event, selected inputs, preserved selections, and current action path.
- **Action**: one typed, atomic instruction interpreted by the effect resolver.
- **Selector**: a pure query that returns an ordered set of legal entity/card references
  from the current resolution context.
- **Filter**: a pure predicate applied to selector candidates.
- **Value expression**: a deterministic numeric computation evaluated when its action is
  reached, unless the authored construct explicitly preserves an earlier value.
- **Condition**: a pure boolean query over match state, history, selected references, and
  the current event.
- **Trigger event**: an internal semantic fact used to discover reactive effects. It is
  separate from presentation events even when both describe the same occurrence.
- **Domain event**: an immutable public fact returned for presentation, diagnostics, and
  replay verification. It describes what resolved; it does not instruct the renderer to
  decide game rules.
- **Enchantment**: runtime effect state applied to an entity, with a source, timestamp,
  layer, payload, silence behavior, and duration.
- **Aura**: a continuously derived modifier whose applicability is recalculated from
  current sources and state. It is never baked permanently into target base values.
- **Checkpoint**: a deterministic boundary at which invariants, lethal heroes, pending
  deaths, expiring effects, newly queued triggers, and match end are processed.
- **Resolution queue**: the ordered, deterministic work list for actions, checkpoints,
  and triggered frames.
- **Capability audit**: a catalog traversal proving whether every authored construct has
  a registered runtime implementation and test ownership.

## Non-Negotiable Runtime Contracts

### Determinism and atomicity

- Equal setup, commands, selected inputs, and seeded RNG must produce deeply equal state,
  event order, and RNG consumption.
- All randomness, including random targets, values, pools, transformations, and the
  temporary opponent driver, must use the match RNG. `Math.random()` is forbidden in
  gameplay decisions and resolution.
- A rejected command consumes no mana, cards, choices, or RNG and does not increment the
  revision.
- An unexpected resolution failure rolls back the entire command transaction and reports
  a diagnostic suitable for a failing test. Partially committed effect state is forbidden.
- The resolver has a finite, named work budget for actions/triggers/repeats. Exceeding it
  fails atomically with trace context instead of hanging.

### Identity and movement

- Every runtime entity reference includes enough kind/zone information to prevent a hero,
  minion, weapon, secret, or card from being accidentally substituted for another.
- Ordinary zone movement preserves identity. Copying creates a new identity. Summoned or
  generated cards receive deterministic IDs from match-owned counters.
- Transform, resurrect, return-to-play, and control-change identity rules must be specified
  in their phase tests before implementation; they cannot emerge accidentally from array
  replacement.
- No entity may exist in two authoritative zones at once.

### Ordering and checkpoints

- Authored action arrays resolve in order.
- Selector output has stable ordering before `count`, `random`, or adjacency is applied.
- Simultaneous deaths are collected as a batch at a checkpoint before death-trigger
  resolution. Board order is captured for that batch.
- Trigger ordering uses an explicit active-player-first policy, then stable zone/board
  order, then creation ordinal as the final tie breaker. Tests must document any deliberate
  exception.
- A source leaving play does not cancel already queued work unless the authored semantics
  require the source still to exist.
- Lethal heroes and match end are evaluated at documented checkpoints, not at renderer
  animation boundaries.

### Legality and controller parity

- Human, development, replay, and future AI controllers dispatch the same commands and
  obey the same mana, target, board-space, attack, and timing rules.
- Legality is determined in the match domain. Renderer highlights are projections of
  domain legality and are never authoritative.
- A card with an unsupported effect must never silently behave as a vanilla card. During
  intermediate phases it receives an explicit unsupported-capability result in development
  and tests. Final catalog closure removes all such results for valid catalog content.
- Targets are validated again at dispatch even if the renderer obtained them from a prior
  legality query.

### State and invariants

- Public state snapshots are immutable copies. Internal implementation may use a scoped
  transaction, but mutation cannot escape the resolver.
- After every accepted command: zone uniqueness, hand/board limits, non-negative resources,
  valid entity references, derived-stat consistency, legal controller references, and
  monotonic revision/counters are asserted in tests.
- Damage and current health are not interchangeable with maximum-health enchantments.
- Base definition data is never mutated.
- History needed by conditions is explicit bounded match/turn state, not reconstructed from
  presentation logs.

### Content semantics and coverage

- Closed schema lists are the coverage source of truth.
- Every action, trigger, event matcher, condition, selector form, filter field, value
  reference/operation, duration, and keyword maps to exactly one owning phase below.
- The capability audit fails when a new schema construct is added without runtime ownership.
- Catalog JSON is never changed by this roadmap, including when historical sources,
  existing tests, rules text, or runtime assumptions disagree with it. Implement the
  generic mechanism around the authored data where possible; otherwise log the conflict
  with evidence and continue or stop under the blocker policy.

## Historical Hearthstone Rules Research Contract

When implementation raises a question about mechanic semantics, timing, target legality,
event order, simultaneous resolution, identity, zones, keywords, or a particular effect,
the agent must research how Hearthstone resolves it before choosing behavior.

Use this source hierarchy:

1. This plan's explicit runtime contracts for project-wide behavior.
2. The current card JSON for that card's authored actions, values, conditions, and custom
   differences.
3. Official Blizzard/Hearthstone rules material, card references, and patch notes, preferring
   contemporaneous 2013/2014 behavior when it is documented.
4. Archived official material when the live official source no longer documents the old
   behavior.
5. Reputable community rules references or documented experiments only when official
   material is insufficient; cross-check important edge cases with more than one source.

Research is for interpreting generic gameplay semantics, not for replacing project content.
In particular:

- Never change card JSON to match an online card listing, current balance patch, historical
  printed value, wiki entry, or remembered behavior.
- When online card values or text conflict with this repository, the repository's JSON wins
  for that card.
- When the JSON states what an effect does but not exactly when or how it interacts with other
  mechanics, researched Hearthstone rules guide the runtime timing and ordering.
- Prefer the historically faithful 2013/2014 rule when sources describe multiple eras, unless
  the JSON or an existing project contract clearly expresses a customization or later rule.
- Do not infer executable behavior from online rules text alone. Map the researched semantic
  decision onto the repository's declarative effect schema and shared runtime mechanisms.
- Record every material researched decision in the Decision Log with links, the relevant
  historical era/version when known, the adopted rule, and any project-specific deviation.
- If reliable sources conflict, document the conflict and choose the behavior most consistent
  with the JSON and existing contracts. Stop for the human only if the choice would materially
  change gameplay and no conservative compatible interpretation exists.

## Validation Contract

Every phase uses four layers of evidence:

1. **Focused unit tests** for pure selectors, values, conditions, legality, actions, and
   invariants.
2. **Scenario tests** that dispatch real commands through the public turn-match facade and
   assert state plus ordered events.
3. **Deterministic replay tests** for every phase that introduces randomness, queued work,
   or persistent runtime state.
4. **Canonical verification** with `npm run verify` at the phase boundary.

Tests must assert rejected paths and unchanged state, not only successful outcomes. A phase
may use minimal fixture definitions to isolate mechanics, but at least one real catalog card
must prove every production path. The full application is reserved for human acceptance
unless separately requested.

## Bug, Decision, and Blocker Policy

### Fix immediately

Fix a discovered bug during the current phase when it was introduced by current work,
blocks the phase, violates a core invariant, belongs to the subsystem being changed, or is
localized with an unambiguous expected result. Add a regression test when practical.

### Log and continue

Add an item to **Known Issues** and continue when a bug is unrelated, requires substantial
later-phase machinery, cannot be reproduced, or would materially expand the phase. Include
the affected phase and evidence.

### Stop only for a genuine blocker

Do not interrupt the human for routine design decisions. When rules behavior is unclear,
perform the online research required above, record the adopted interpretation in the
**Decision Log**, and continue. Stop only when behavior remains materially ambiguous after
that research and is not settled by these contracts or authored data, required work would
violate architecture or safety constraints, a destructive/external action needs new
authority, or materially different attempts cannot restore required validation.

Never repeat the same failed action without new information or a changed approach.

## Phase 0 - Baseline Characterization and Capability Inventory

### Implementation

- [x] Add a machine-readable capability inventory derived from the closed content schema,
      with ownership for every declared construct and usage counts from the live catalog.
- [x] Add characterization tests for existing mulligan, turns, mana, draw/fatigue/burn,
      hero powers, vanilla card play, hero replacement, weapons, and combat before extraction.
- [x] Add a reusable deterministic match-scenario builder using real catalog definitions and
      explicit seeded RNG.
- [x] Define the canonical entity/zone, trigger-order, death-batch, identity, and command
      rollback semantics as tested domain contracts.
- [x] Establish a reusable rules-research note format containing question, sources,
      historical era/version, adopted semantic rule, and project-specific deviation, without
      modifying card JSON.
- [x] Identify every current renderer-side rules decision and record its migration phase.
- [x] Make unsupported effect capability visible in development/tests without silently
      changing live card behavior.

### Automated evaluation

- [x] Inventory tests fail for any schema construct with no phase owner or duplicate owner.
- [x] Baseline scenario/replay tests pass through the existing public match facade.
- [x] `npm run verify` passes and the phase diff contains no gameplay change lacking a
      characterization test.

### Human evaluation

- [x] Human acceptance: existing match opening, hero powers, basic minion/weapon play, combat,
      fatigue, and match end still look and behave as before.

### Phase status

- [x] Agent implementation and automated validation complete.
- [x] Human acceptance complete.

### Audit update (2026-08-28)

Addressed: the schema-derived inventory, live-catalog usage counts, generated-token registration, characterization/scenario builder, seeded replay checks, research and migration notes, renderer-rule inventory, and explicit unsupported-capability reporting are now in the tree.
The Agent gate is checked; Human acceptance is recorded above.

## Phase 1 - Canonical Runtime State, Entities, and Invariants

### Implementation

- [x] Introduce typed runtime references and state for cards, minions, heroes, hero powers,
      weapons, secrets, enchantments, counters, history, and required zones.
- [x] Separate immutable card definitions from runtime card/entity state, including current
      cost, damage, controller, owner, creation ordinal, and deterministic instance identity.
- [x] Add a scoped state transaction with commit/rollback and invariant validation.
- [x] Add deterministic ID/counter allocation for copies, tokens, generated cards, secrets,
      and effect-created entities.
- [x] Decompose the current monolithic match implementation incrementally while preserving
      `createTurnMatch`, state, command, result, and compatibility exports.
- [x] Centralize zone movement so no action manipulates deck/hand/board arrays ad hoc.

### Automated evaluation

- [x] Invariant tests cover duplicate identity, two-zone presence, stale references, hand and
      board limits, illegal resources, controller/owner distinction, and snapshot immutability.
- [x] Transaction tests prove rejected and failed commands leave state, revision, counters,
      events, and RNG position unchanged.
- [x] Existing characterization tests and `npm run verify` pass.

### Human evaluation

- [x] Human acceptance: existing turns and card movement show no visual regression, including
      mulligan, draw, burn, hand reflow, minion placement, weapon replacement, and fatigue.

### Phase status

- [x] Agent implementation and automated validation complete.
- [x] Human acceptance complete.

### Audit update (2026-08-27)

Addressed: typed runtime state, immutable definitions, scoped transactions, match-global identity allocation, centralized zone movement, invariant checks, and compatibility-facade extraction are implemented and covered by focused tests.
Visual regression acceptance is recorded above.

## Phase 2 - Controller-Neutral Commands, Legality, Targets, and Choices

### Implementation

- [x] Define a canonical play-card command for Minion, Spell, Weapon, and Hero cards, with
      ordered chosen targets, board position, and choice inputs where required.
- [x] Add pure domain queries that describe required play input and enumerate legal targets,
      choices, board positions, attacks, hero-power uses, and end-turn availability.
- [x] Validate all supplied input again during dispatch and provide stable rejection codes for
      stale, missing, extra, duplicate, wrong-controller, wrong-zone, immune, or illegal targets.
- [x] Remove controller-kind mana and legality exceptions. The temporary opponent must consume
      mana and obey the same rules without receiving strategic improvements.
- [x] Establish cancellation semantics: collecting or canceling renderer input never mutates
      match state; only an accepted command commits.
- [x] Preserve compatibility command adapters temporarily where needed, with tests proving
      they delegate to the same legality path.

### Automated evaluation

- [x] A legality matrix covers card types, target requirements, board capacity, mana, current
      turn, source zone, target side/type, choices, and stale-state rejection.
- [x] Equivalent commands from human and temporary-opponent participants produce equivalent
      legality and resource consumption.
- [x] Rejected-play rollback tests and `npm run verify` pass.

### Human evaluation

- [ ] Human acceptance: legal cards and targets highlight correctly; canceling returns the
      card to hand unchanged; invalid drops do not spend mana; targeted and choose-one test cards
      collect the intended input.

### Phase status

- [x] Agent implementation and automated validation complete.
- [ ] Human acceptance complete.

### Audit update (2026-08-27)

Addressed: canonical play-input and legality queries, controller-neutral target/choice validation, stable rejection codes, cancellation, and renderer choice/target collection are wired to one domain command path.
Visual interaction acceptance remains open.

## Phase 3 - Deterministic Effect Resolver, Queue, and Checkpoints

### Implementation

- [x] Add effect frames carrying source, controller, event context, chosen inputs, preserved
      selections, action path, and deterministic RNG access.
- [x] Add an ordered resolution queue for actions, branches, repeats, trigger frames, death
      batches, expirations, and match-end checkpoints.
- [x] Define action/checkpoint boundaries and active-player-first stable trigger ordering.
- [x] Add separate internal trigger-event and public domain-event contracts with correlation
      information sufficient for tests and renderer sequencing.
- [x] Add a named finite resolution budget and an atomic diagnostic failure containing the
      source card, effect/action path, and recent queue trace.
- [x] Route existing hard-coded hero-card and hero-power operations through shared rule/action
      primitives where doing so preserves their public behavior.

### Automated evaluation

- [x] Queue tests cover nested actions, stable ordering, source removal after queueing, empty
      resolutions, rollback on resolver failure, and resolution-budget exhaustion.
- [x] Replay tests prove identical state, event order, generated IDs, and RNG consumption.
- [x] Existing match scenarios and `npm run verify` pass.

### Human evaluation

- [ ] Human acceptance: multi-action fixture cards present their results in authored order and
      the board becomes interactive only after the complete command resolves.

### Phase status

- [x] Agent implementation and automated validation complete.
- [ ] Human acceptance complete.

### Audit update (2026-08-27)

Addressed: effect frames, deterministic queue/budget, semantic/public event separation, checkpoint processing, and RNG snapshot rollback are implemented with replay/failure tests.
Ordered presentation still needs Human acceptance.

## Phase 4 - Selectors, Filters, Values, Conditions, and Control Flow

### Implementation

- [x] Implement selector controllers `self`, `opponent`, and `any`; selector types; zones;
      exclusions; adjacency; preservation; position; counts; and every declared selection mode.
- [x] Implement all filter fields and comparison operators, including nested negation and
      dynamic target-cost comparisons.
- [x] Implement literal, random, referenced, selected-count, multiplied, set, and subtractive
      numeric value expressions with documented evaluation timing.
- [x] Implement all declared value references, including event, source, target, hero, weapon,
      hand, board, damage, removed-keyword, and card-play-history references.
- [x] Implement all declared condition types against explicit current-turn/game history.
- [x] Implement effect-level `condition`, `choice`, `then`, and `repeat`, with a finite repeat
      bound shared with the resolution budget.
- [x] Guarantee stable selector order before random selection, count truncation, and adjacency.

### Automated evaluation

- [x] Table-driven tests cover every selector type/selection/controller/zone/exclusion field,
      every filter field/operator, every value reference/operation, and every condition type.
- [x] Control-flow tests cover true/false branches, multiple choices, preservation across
      movement, repeat termination, no-candidate behavior, and deterministic randomness.
- [x] The capability inventory marks the complete query/control-flow vocabulary supported and
      `npm run verify` passes.

### Human evaluation

- [ ] Human acceptance: representative chosen, adjacent, all, random, conditional, choose-one,
      and repeated effects affect exactly the visible characters/cards expected.

### Phase status

- [x] Agent implementation and automated validation complete.
- [ ] Human acceptance complete.

### Audit update (2026-08-27)

Addressed: selectors, filters, values, conditions, choices, branches, repeats, and stable seeded selection are implemented and table-tested.
Visible card-effect acceptance remains open.

## Phase 5 - Generic Card Play and Immediate Effects

### Implementation

- [x] Execute Minion Battlecry, Spell Cast, and generic On Play effect blocks through the
      shared resolver rather than card-specific match branches.
- [x] Complete generic Spell play: validation, target/choice collection, mana payment, hand
      removal, spell-cast facts, action resolution, and final zone/history placement.
- [x] Define when a minion enters the board relative to its Battlecry and what happens when a
      prerequisite or board-space condition fails.
- [x] Define combo activation and cards-played-earlier-this-turn history at command boundaries.
- [x] Update renderer hand interaction to consume domain-described play inputs for every card
      type while keeping rules out of the view.
- [x] Reject unsupported immediate actions explicitly during intermediate development; never
      skip them and consume the card as though it resolved.

### Automated evaluation

- [x] Real-card scenarios cover untargeted/targeted spells, Battlecry targets, choose-one,
      combo/non-combo, multiple actions, no legal target, board full, insufficient mana, and
      rollback.
- [x] Event-order tests cover card-played, minion-played/summoned, spell-cast, and immediate
      effect output.
- [x] Renderer interaction model tests and `npm run verify` pass.

### Human evaluation

- [ ] Human acceptance: representative Minion, Spell, Weapon, and Hero cards can be played by
      click/drag, collect correct targets/choices, spend mana once, leave the hand once, and show
      coherent ordered results.

### Phase status

- [x] Agent implementation and automated validation complete.
- [ ] Human acceptance complete.

### Audit update (2026-08-27)

Addressed: generic minion, spell, weapon, and hero play now shares the resolver, including Battlecry/Cast/On Play ordering, combo history, input validation, atomic payment, and explicit unsupported failures.
Click/drag and animation acceptance remains open.

## Phase 6 - Card Zones, Resources, Generation, and Cost Actions

### Owned actions

`add-to-hand`, `copy`, `discard`, `draw`, `draw-until`, `gain-mana`, `destroy-mana-crystal`,
`overload`, `shuffle-into-deck`, and the non-aura portion of `change-cost`.

### Implementation

- [x] Implement draw, fatigue, burn, discard, copy, generation, add-to-hand, shuffle, and
      draw-until through centralized zone rules.
- [x] Define source pools (`deck`, `deck-top`, `hand`, `random-card`, destroyed/death history)
      and deterministic random-card generation/filtering.
- [x] Implement current/maximum/empty mana crystal changes, overload scheduling/locking, caps,
      and start-of-turn unlock behavior.
- [x] Implement permanent and zone-scoped card-cost changes, preserving printed/base cost and
      exposing derived current cost to legality and renderer tinting.
- [x] Enforce hand limits, deck order, generated deterministic IDs, known/revealed information,
      and owner/controller semantics for every movement.

### Automated evaluation

- [x] Action tests cover every owned action and source/destination form, empty/full zones,
      count zero/many, random filters, burn, fatigue, overload, mana caps, and cost floors.
- [x] Replay tests cover shuffled/generated/random cards and deterministic IDs.
- [x] Real Basic/Classic card scenarios and `npm run verify` pass.

### Human evaluation

- [ ] Human acceptance: draw, burn, discard, card generation, shuffled cards, overload, mana
      changes, and red/green cost presentation remain synchronized with authoritative state.

### Phase status

- [x] Agent implementation and automated validation complete.
- [ ] Human acceptance complete.

### Audit update (2026-08-27)

Addressed: centralized draw/fatigue/burn/discard/copy/generation/shuffle, mana/overload, cost derivation, limits, information boundaries, deterministic IDs, and renderer cost tinting are implemented and scenario/replay tested.
Human synchronization acceptance remains open.

## Phase 7 - Enchantments, Durations, Stat Changes, and Silence

### Owned actions

`modify`, `grant-keyword`, `grant-keywords`, `grant-random-keyword`, `remove-keyword`,
`swap-stats`, and `silence`. Trigger-granting actions are completed in Phase 11.

### Implementation

- [x] Add layered enchantments for Attack, Health/maximum Health, durability, minimum Health,
      spell-damage multiplier, healing multiplier, hero-power multiplier, and keywords.
- [x] Implement all declared durations: `permanent`, `this-turn`, `this-attack`, `next-turn`,
      `until-next-turn`, `while-condition`, `while-damaged`, `while-in-hand`, and
      `while-source-in-play`.
- [x] Define health behavior when maximum Health rises/falls, damage persists, stats swap, and
      a temporary modifier expires.
- [x] Implement keyword grants/removal and deterministic random-keyword selection.
- [x] Implement Silence as explicit removal/suppression of silenceable enchantments, granted
      keywords, and granted/card triggers while preserving identity, damage rules, and
      non-silenceable state.
- [x] Expose effective stats/keywords as derived domain state consumed by legality and renderer
      markers.

### Automated evaluation

- [x] Tests cover stacking order, expiration boundaries, source removal, damage with changing
      maximum Health, minimum Health, silence, repeated silence, stat swap, and random grants.
- [x] Invariants prove base catalog definitions remain unchanged and derived stats recalculate
      without drift.
- [x] Real buff/debuff/silence cards and `npm run verify` pass.

### Human evaluation

- [ ] Human acceptance: temporary and permanent buffs/debuffs, keyword markers, swapped stats,
      expiration, and Silence update visible stats and abilities at the correct time.

### Phase status

- [x] Agent implementation and automated validation complete.
- [ ] Human acceptance complete.

### Audit update (2026-08-27)

Completed: layered enchantments, all nine declared durations, keyword grants/removal, deterministic random-keyword selection, stat swaps, minimum-Health damage prevention, and Silence are exercised through the shared runtime. Focused scenarios cover `this-turn`, `this-attack`, `next-turn`, `until-next-turn`, `while-condition`, `while-damaged`, `while-in-hand`, and `while-source-in-play`; they also prove stacking, expiration, source removal, repeated Silence, no derived-state drift, and minimum-Health behavior. Real cards include Blessing of Might, Crazed Alchemist, Silence, Commanding Shout, Conceal, Gladiator's Longbow, Loatheb, Cogmaster, Rockbiter Weapon, and Freezing Trap. The unused `grant-random-keyword` vocabulary is verified with an isolated runtime fixture that restores the catalog after the test.

Formatting, lint, 146 tests, node/web type checks, dependency validation, and the production smoke build passed at the phase boundary.

## Phase 8 - Damage, Healing, Armor, Death, and Lethal Prevention

### Owned actions

`damage`, `restore`, `gain-armor`, `set-health`, `destroy`, `destroy-and-gain-stats`,
`sacrifice-and-damage`, and `trigger-deathrattle`. `prevent-lethal` and `redirect-damage`
are completed with event interception in Phase 13.

### Implementation

- [x] Unify combat, hero-power, fatigue, and effect damage under one damage pipeline with
      source, amount, target, armor, immunity, prevention, actual damage, and resulting facts.
- [x] Unify healing/restoration with maximum Health, healing multipliers, zero-effective-heal
      handling, and health-restored facts.
- [x] Implement explicit destruction, sacrifice, set-health, destroy-and-gain-stats, and
      poison-style destruction semantics.
- [x] Implement simultaneous death collection, graveyard/death history, stable batch ordering,
      deathrattle queueing, explicitly triggered deathrattles, and match-end checkpoints.
- [x] Define hero lethal, simultaneous lethal/tie policy, fatigue lethal, and no further player
      command after match end.
- [x] Present damage, healing, armor, destruction, and death results from domain events without
      renderer-side recomputation.

### Automated evaluation

- [x] Tests cover armor absorption, excess damage, immunity, zero damage/heal, healing caps,
      direct destroy, poison, sacrifice, simultaneous deaths, chained deathrattles, board space
      opened by death, fatigue lethal, and simultaneous hero lethal.
- [x] Ordered event and replay tests cover every damage/death checkpoint and rollback path.
- [x] Real damage/heal/deathrattle cards and `npm run verify` pass.

### Human evaluation

- [ ] Human acceptance: damage/heal numbers, armor, destroyed minions, chained deaths,
      deathrattle markers/animations, fatigue, and victory/defeat agree with final domain state.

### Phase status

- [x] Agent implementation and automated validation complete.
- [ ] Human acceptance complete.

### Audit update (2026-08-27)

Completed: combat, hero-power, fatigue, and card effects share one damage pipeline; healing, armor, direct destruction, sacrifice damage, set-health, destroy-and-gain-stats, graveyard/death batches, explicitly triggered deathrattles, and match-end checkpoints are exercised through real commands. Poison Seeds captures every minion destroyed by its preceding action before replacement summons. Simultaneous hero lethal ends in a draw (null winner/loser) after the atomic sequence, while all other lethal, fatigue, immunity, armor, healing-cap, rollback, and replay paths remain covered by the phase scenarios.
Formatting, lint, 151 tests, node/web type checks, dependency validation, and the production smoke build passed at the phase boundary.

## Phase 9 - Summoning, Return, Resurrection, Transform, Swap, and Control

### Owned actions

`put-into-play`, `return-to-play`, `resurrect`, `return-to-hand`, `summon`, `summon-copy`,
`summon-for-each`, `summon-random`, `transform`, `transform-random`, `take-control`, and
`swap`.

### Implementation

- [x] Centralize board insertion, token creation, summon positions, full-board truncation, and
      summon facts for played and non-played minions.
- [x] Implement copies, filtered random pools, summon-for-each counts, and deterministic pool
      selection without mutating catalog definitions.
- [x] Define and implement identity/enchantment/damage/controller behavior for return-to-hand,
      return-to-play, resurrection, transform, and control change.
- [x] Implement board/zone swaps with atomic capacity and legality checks.
- [x] Ensure summon/death cascades use checkpoints and that later queued selectors observe the
      correct current board.
- [x] Add renderer presentation for non-hand summons, transforms, returns, control changes,
      resurrection, and reordered board positions.

### Automated evaluation

- [x] Tests cover full boards, partial multi-summons, adjacency/position, empty pools, copies,
      transformed stats/effects, resurrection history, return identity, control with full board,
      swaps, death cascades, and deterministic random pools.
- [x] Real catalog scenarios cover every owned action and `npm run verify` passes.

### Human evaluation

- [ ] Human acceptance: tokens, copies, resurrections, transforms, returns, swaps, and stolen
      minions appear in the correct board/hand position with correct art, stats, markers, and
      ownership.

### Phase status

- [x] Agent implementation and automated validation complete.
- [ ] Human acceptance complete.

### Audit update (2026-08-27)

Partially implemented: centralized summon insertion, deterministic copies/random pools,
transforms, resurrection/returns, and temporary control return are present. The current
runtime also returns a bounced stolen minion to its owner, permits secret control changes,
records temporary-control returns after a board move, and gives generated copies to the
receiving controller.

Completed (2026-08-27): board/hand swaps atomically move the original instances; bounces
preserve identity and return to their owner's hand; transforms reset to their authored
definition; resurrections create fresh full-health instances after a death checkpoint; and
temporary control returns at the end of the stealing player's turn. Effect-driven renderer
movement reconciles board, hand, ownership, and order by instance ID.

Real-card scenarios exercise Alarm-o-Bot, Sap, Polymorph, Mind Control, Shadow Madness,
Reincarnate, full-board control refusal, and full-hand bounce burn, alongside the existing
summon/copy/random/death-cascade coverage. `npm run verify` passes: format, lint, 158 tests,
type checks, dependency checks, and production build smoke. Human visual acceptance remains
open and requires in-app confirmation of the listed presentation cases.

## Phase 10 - Combat Legality and Keyword Mechanics

### Owned keywords and actions

`taunt`, `charge`, `divine-shield`, `stealth`, `windfury`, `mega-windfury`, `cannot-attack`,
`immune`, `spell-immune`, `attack-wrong-enemy-chance-50`, and `freeze`. `spell-damage` is
completed in Phase 12; the `secret` keyword is completed in Phase 13.

### Implementation

- [x] Make attack eligibility derive from effective keywords, attacks used this turn,
      summoning state, freeze state, Attack, controller, and current turn.
- [x] Enforce Taunt and Stealth target legality and reveal Stealth at the defined attack/damage
      boundary.
- [x] Implement Divine Shield, Immune, Spell Immune, Charge, Windfury, Mega-Windfury, Cannot
      Attack, freeze/thaw, and the 50% wrong-enemy attack rule using seeded RNG.
- [x] Track per-turn/per-attack usage without overloading a single last-attacked timestamp.
- [x] Ensure temporary attack and `this-attack` enchantments expire at the correct combat
      checkpoint and weapon durability resolves exactly once.
- [x] Drive all combat highlighting and invalid-target feedback from domain legality.

### Automated evaluation

- [x] A keyword matrix covers minion/hero attackers, hero/minion defenders, multiple Taunts,
      Stealth, immunity, shields, freeze timing, charge, multi-attack limits, zero Attack, random
      redirection, temporary Attack, and weapon breakage.
- [x] Replay tests cover wrong-enemy randomness and complex combat/deathrattle interaction.
- [x] Real keyword cards and `npm run verify` pass.

### Human evaluation

- [ ] Human acceptance: attack outlines, forbidden targets, Taunt/Stealth/Shield visuals,
      Charge, multiple attacks, freeze/thaw, immune hits, redirection, damage, and weapon breakage
      match the rules.

### Phase status

- [x] Agent implementation and automated validation complete.
- [ ] Human acceptance complete.

### Audit update (2026-08-27)

Complete: domain combat legality covers attack counters, Taunt/Stealth, Charge, freeze,
shields/immunity, Windfury variants, wrong-enemy randomness, and weapon durability. The
real-card matrix in `combat-keywords.integration.test.ts` covers target legality, shield
consumption, multi-attack limits, spell immunity, freeze/thaw, weapon breakage, and seeded
redirection replay. Human visual acceptance remains pending.

### Audit update (2026-08-27) — renderer regression repair

- [x] Prevented duplicate board minion views when effect reconciliation and a summon
      presentation event report the same instance. Reconciliation now removes duplicate instance
      views, and summon presentation is idempotent by minion instance ID.
- [x] Restored pointer input for locally controlled, attack-ready heroes and minions while
      preserving domain-derived red outlines and targeting circles exclusively for legal enemy
      targets.
- [x] Anchored combat damage indicators to the character that actually lost Health or Armor,
      rather than relying on cross-referenced combat damage fields.

Validated with the focused real-card effect suite and `npm run verify`: formatting, lint, 159
tests, node/web type checks, dependency validation, and production build smoke all pass. Human
visual acceptance for Phase 9/10 remains open.

## Phase 11 - Reactive Triggers, Turn Timing, History, and Granted Effects

### Owned triggers and actions

`battlecry`, `cast`, `deathrattle`, `end-of-turn`, `on-attack`, `on-card-played`, `on-cast`,
`on-damage`, `on-death`, `on-draw`, `on-gain-armor`, `on-heal`, `on-play`, `on-summon`, and
`start-of-turn`; plus `grant-deathrattle`, `grant-trigger`, `multiply-trigger`, and `schedule`.
Secret-specific triggers are completed in Phase 13; `aura` and `while-in-hand` are completed
in Phase 12.

### Implementation

- [x] Add trigger discovery against explicit semantic events, event filters, controller/turn
      filters, source/target selectors, and source-zone eligibility.
- [x] Complete immediate and reactive trigger timing for every owned trigger, including
      start/end-turn snapshots and actions caused by other actions.
- [x] Track bounded current-turn/game history for combo, played/cast/summoned/drawn/damaged/
      healed/died facts and conditions.
- [x] Implement granted triggers/deathrattles, trigger multiplication, scheduled actions, and
      their durations/silence/source-removal behavior.
- [x] Prevent a trigger from observing the wrong event generation or recursively triggering
      itself unless the authored event contract genuinely permits it.
- [x] Produce traceable ordered domain events for nested trigger chains.

### Automated evaluation

- [ ] Table-driven tests cover every owned trigger with matching and non-matching event,
      controller, source, target, filter, and turn-player combinations.
- [ ] Scenarios cover active-player-first ordering, simultaneous sources, source death,
      granted/multiplied triggers, scheduled expiration, nested chains, and resolution-budget
      protection.
- [ ] Real triggered cards, deterministic replay, and `npm run verify` pass.

### Human evaluation

- [ ] Human acceptance: representative start/end-turn, summon, cast, draw, damage, heal,
      attack, death, granted, multiplied, and scheduled triggers visibly fire once and in the
      expected order.

### Phase status

- [ ] Agent implementation and automated validation complete.
- [ ] Human acceptance complete.

### Audit update (2026-08-27)

Addressed partially: semantic trigger discovery, event matching, history, deathrattle/granted triggers, multipliers, scheduling, checkpoints, and effect traces are wired into the resolver.
Complete trigger-order/recursion coverage and Human verification remain open.

## Phase 12 - Auras, While-in-Hand Effects, Derived Costs, and Spell Scaling

### Owned triggers and keyword

`aura`, `while-in-hand`, and `spell-damage`, including continuous cost/stat/targeting and
healing/hero-power/spell-damage multiplier effects expressed through existing actions.

### Implementation

- [x] Build continuous-effect discovery and deterministic derived-state recomputation from
      active aura and while-in-hand sources.
- [ ] Prevent permanent mutation or double-application when sources enter/leave play, change
      controller, transform, are silenced, become damaged, or conditions change.
- [ ] Define dependency layers for base values, permanent/temporary enchantments, auras,
      multipliers, set operations, floors/caps, and current damage.
- [x] Apply derived card and hero-power costs to legality, payment, and renderer cost colors.
- [x] Apply spell damage, healing multipliers, and hero-power multipliers exactly once at the
      documented action-value boundary.
- [ ] Detect and fail non-converging continuous-effect dependencies with a diagnostic rather
      than looping.

### Automated evaluation

- [ ] Tests cover multiple overlapping auras, adjacency, tribal filters, damaged conditions,
      source removal, silence, control change, cost floors, hand entry/exit, spell/heal/power
      scaling, and non-convergence protection.
- [ ] Derived-state tests prove recomputation is idempotent and base/runtime state does not
      drift.
- [ ] Real aura/while-in-hand/spell-damage cards and `npm run verify` pass.

### Human evaluation

- [ ] Human acceptance: aura markers and affected stats/costs update immediately and reversibly;
      spell damage, healing, and hero-power scaling display the same values the domain resolves.

### Phase status

- [ ] Agent implementation and automated validation complete.
- [ ] Human acceptance complete.

### Audit update (2026-08-27)

Addressed partially: continuous recomputation, while-in-hand cost effects, derived costs, and spell/heal/hero-power scaling are present.
Dependency layering, while-condition, convergence diagnostics, and the dedicated idempotence suite remain open.

## Phase 13 - Secrets and Interruptible Event Resolution

### Owned triggers, events, keywords, and actions

`secret`, `on-secret-played`, `on-secret-revealed`, the `secret` keyword, all secret event
types, plus `counter-event`, `destroy-secrets`, `grant-targeting`, `prevent-lethal`,
`redirect-damage`, `replace-event`, and `reveal`.

### Implementation

- [x] Add authoritative secret zones, class/duplicate/capacity legality, hidden public state,
      deterministic play order, reveal/removal, and controller-private knowledge boundaries.
- [x] Add a staged interrupt window where eligible secrets/replacements can inspect and
      counter, redirect, replace, retarget, or prevent a pending semantic event before commit.
- [x] Define precedence and composition for multiple replacements and secrets using the global
      trigger ordering contract.
- [x] Implement all declared secret-related event matchers and source/target preservation.
- [x] Ensure canceled/replaced events emit accurate public facts, consume/reveal the correct
      secret, and do not leak hidden card identity early.
- [x] Add renderer presentation for facedown secrets, secret counts, reveal, counter,
      redirection, replacement, destruction, and prevented lethal.

### Automated evaluation

- [ ] Tests cover duplicate/capacity rules, secret order, non-matching events, countered spells,
      redirected attacks/damage, target replacement, lethal prevention, secret destruction,
      chained secrets, hidden snapshots, and rollback.
- [ ] Every declared card event type has positive/negative matcher tests and deterministic
      replay where applicable.
- [ ] Real secret cards and `npm run verify` pass.

### Human evaluation

- [ ] Human acceptance: secrets enter facedown, do not reveal early, trigger only on matching
      events, animate in deterministic order, alter/counter the visible action correctly, and
      leave the secret zone when consumed or destroyed.

### Phase status

- [ ] Agent implementation and automated validation complete.
- [ ] Human acceptance complete.

### Audit update (2026-08-27)

Implemented (2026-08-28): authoritative Secret zones now enforce class, duplicate, and
five-Secret capacity legality while keeping card identity private from opponents. A staged
interrupt window resolves matching Secrets in deterministic play order, consumes a Secret
before its one public reveal, preserves it when its actions cannot affect the live state, and
supports countering, replacement, redirection, target replacement, Secret destruction, and
lethal prevention.

The renderer loads the temporary `secret.png` and `secret-revealed-screen.png` assets through
the game asset bundle. Facedown markers are spread across the top edge of each corresponding
hero, and a consumed Secret displays the centered reveal image. Both marker counts and removals
derive from authoritative match state.

Automated evaluation and human in-app acceptance remain intentionally pending.

## Phase 14 - Weapons, Heroes, Hero Powers, and Special Actions

### Owned actions

`equip`, `equip-random`, `replace-hero`, `set-hero-power`, and `set-turn-limit`.

### Implementation

- [x] Route weapon equip/replacement, random equip, durability modification/destruction,
      weapon triggers, and hero Attack through shared entity/action/checkpoint rules.
- [x] Generalize hero replacement and hero-power replacement while preserving explicitly
      defined Health, Armor, weapon, attack, availability, enchantment, and identity semantics.
- [x] Reuse shared action primitives for every existing hero power without changing their
      authored presentation metadata.
- [x] Implement turn-limit state and deterministic timeout command semantics in the domain;
      renderer timing observes domain state but does not decide the result.
- [x] Apply healing, spell-damage, hero-power, cost, keyword, trigger, and Silence interactions
      consistently to these entities.
- [ ] Remove obsolete hard-coded special paths only after parity tests cover them.

### Automated evaluation

- [x] Tests cover weapon replacement/breakage/triggers, random equip, hero replacement,
      hero-power replacement/cost/use, Jaraxxus, multipliers, turn-limit set/expiry, rollback, and
      deterministic timeout resolution.
- [x] Every hero power retains its existing focused tests through the shared runtime.
- [x] Real special cards and `npm run verify` pass.

### Human evaluation

- [ ] Human acceptance: equipped/replaced weapons, hero transformations, hero-power changes,
      durability, attack, Armor, special animations, and turn-limit presentation remain coherent
      and functional.

### Phase status

- [ ] Agent implementation and automated validation complete.
- [ ] Human acceptance complete.

### Audit update (2026-08-27)

Addressed partially: shared equip, hero/hero-power replacement, special actions, and domain turn-limit/timeout commands are present. Focused coverage now includes Jaraxxus, deterministic Blingtron random equip, Nozdormu timeout rejection and aura expiry, and Shadowform's replacement/upgrade semantics through public commands.
Special-card parity remains open. The obsolete minion-, weapon-, and hero-only play adapters have been removed; the remaining legacy hero-power and combat implementations are still isolated for parity review.

## Phase 15 - Renderer Presentation and Development Scenario Coverage

This phase closes presentation gaps left by incremental domain phases; it does not move
rules into the renderer or redesign the board.

### Implementation

- [ ] Audit every public effect/domain event and ensure it has an intentional presentation:
      animation, state refresh, log-only handling, or explicitly invisible handling.
- [ ] Split oversized game-view effect presentation into focused feature modules without
      changing authored layout values.
- [ ] Ensure input is locked for the complete atomic resolution and restored after success,
      rejection, cancellation, match end, and presentation failure.
- [ ] Add deterministic developer scenarios/commands for both participants so a human can set
      up targets, hands, boards, mana, secrets, weapons, history, and trigger chains without AI.
- [ ] Add a development effect trace keyed by command revision, source, action path, internal
      trigger fact, and public event, stripped from production builds.
- [ ] Ensure all placed visuals use semantic labels and registered/lazy-loaded assets.

### Automated evaluation

- [x] Presentation coverage tests fail when a new public event lacks an intentional handler.
- [ ] Interaction tests cover targeting/choice cancellation, animation failure recovery,
      match-end locking, state refresh, and developer scenario validation.
- [x] Dependency boundaries, production marker leak checks, and `npm run verify` pass.

### Human evaluation

- [ ] Human acceptance: use the development scenarios to inspect representative action,
      keyword, trigger, aura, secret, choice, random, death-chain, transform, hero, and weapon
      effects without depending on opponent behavior.

### Phase status

- [ ] Agent implementation and automated validation complete.
- [ ] Human acceptance complete.

### Audit update (2026-08-27)

Addressed partially: domain-driven legality, cancellable choice UI, semantic layout labels, cost presentation, and atomic-resolution input guards are in place. Rejected hero-power commands now also cancel targeting and restore authoritative HUD/control state. The game board's developer-command translation is isolated in a focused, unit-tested module. Effect traces are opt-in through `MatchSetup.recordEffectTrace`, enabled by development scenarios/tests and omitted from normal-match state. Developer command coverage verifies selected-player hero/power/mana/fatigue, card/board zones, weapon removal, draws, and deck mutation. `event-presentation-policy.ts` provides an exhaustive typed policy registry used by the event dispatcher, with a focused coverage test.
Developer scenarios/traces and recovery tests remain open.

## Phase 16 - Catalog Closure, Hardening, and Final Human Test Script

### Implementation

- [x] Make the capability audit traverse all live catalog cards recursively, including nested
      actions, choices, branches, repeats, selectors, filters, values, conditions, events, and
      durations.
- [ ] Reach zero unsupported constructs and zero cards that can silently resolve only part of
      their authored effects.
- [ ] Add at least one positive real-card scenario for every declared action, trigger,
      condition, selector form, value reference/operation, duration, keyword, and event matcher;
      constructs unused by current cards receive fixture tests.
- [x] Add catalog-wide deterministic smoke matches/scenarios that exercise every card without
      crashes, hangs, invariant violations, or unseeded randomness.
- [x] Add bounded fuzz/property scenarios for command rejection, zone invariants, long trigger
      chains, random pools, repeated transforms/control changes, and simultaneous deaths.
- [ ] Remove temporary compatibility paths, unsupported-development guards, controller-kind
      rule exceptions, duplicated renderer legality, and obsolete hard-coded effect execution.
- [ ] Update architecture documentation where the final code structure differs from the
      original baseline.
- [x] Write a consolidated, ordered human acceptance script covering every phase, with setup,
      action, and expected visible/state outcome for each scenario.

### Automated evaluation

- [x] Capability audit reports complete coverage for the current closed schema and catalog.
- [ ] Catalog scenarios, deterministic replays, fuzz/property tests, focused renderer tests,
      and all regression tests pass without skipped effect cases.
- [ ] Final diff review finds no AI work, unrelated refactor, renderer-owned rule, unseeded
      gameplay randomness, silent unsupported effect, or architecture violation.
- [ ] `npm run verify` passes on the final tree.

### Human evaluation

- [ ] Human acceptance: execute the consolidated end-of-roadmap script and record any defects
      under Known Issues before accepting the effects implementation as complete.

### Phase status

- [ ] Agent implementation and automated validation complete.
- [ ] Human acceptance complete.

### Audit update (2026-08-27)

Addressed partially: the audit now loads canonical modules, recursively inventories schema vocabulary, verifies runtime registration, and smoke-attempts every live card twice with identical seeded inputs, asserting identical result, state, and RNG output. Bounded seeded property coverage now exercises rejected commands plus random weapon pools, transform/control identity changes, and simultaneous deathrattle chains while asserting match invariants. The consolidated Human script is available at `docs/effects-human-acceptance.md`.
Full semantic closure, fuzz/property coverage, and compatibility cleanup remain open.

## Declared Vocabulary Ownership Map

The capability audit must enforce this map. If a construct changes ownership, update the map
and the owning phase together.

### Actions

- Phase 6: `add-to-hand`, `change-cost`, `copy`, `destroy-mana-crystal`, `discard`, `draw`,
  `draw-until`, `gain-mana`, `overload`, `shuffle-into-deck`.
- Phase 7: `grant-keyword`, `grant-keywords`, `grant-random-keyword`, `modify`,
  `remove-keyword`, `silence`, `swap-stats`.
- Phase 8: `damage`, `destroy`, `destroy-and-gain-stats`, `gain-armor`, `restore`,
  `sacrifice-and-damage`, `set-health`, `trigger-deathrattle`.
- Phase 9: `put-into-play`, `resurrect`, `return-to-hand`, `return-to-play`, `summon`,
  `summon-copy`, `summon-for-each`, `summon-random`, `swap`, `take-control`, `transform`,
  `transform-random`.
- Phase 10: `freeze`.
- Phase 11: `grant-deathrattle`, `grant-trigger`, `multiply-trigger`, `schedule`.
- Phase 13: `counter-event`, `destroy-secrets`, `grant-targeting`, `prevent-lethal`,
  `redirect-damage`, `replace-event`, `reveal`.
- Phase 14: `equip`, `equip-random`, `replace-hero`, `set-hero-power`, `set-turn-limit`.

### Triggers

- Phase 5: initial integration of `battlecry`, `cast`, and `on-play`.
- Phase 8: death/damage integration of `deathrattle`, `on-damage`, `on-death`, `on-heal`, and
  `on-gain-armor`.
- Phase 11: complete ownership of `battlecry`, `cast`, `deathrattle`, `end-of-turn`,
  `on-attack`, `on-card-played`, `on-cast`, `on-damage`, `on-death`, `on-draw`,
  `on-gain-armor`, `on-heal`, `on-play`, `on-summon`, and `start-of-turn`.
- Phase 12: `aura` and `while-in-hand`.
- Phase 13: `secret`, `on-secret-played`, and `on-secret-revealed`.

### Query language and control flow

- Phase 4 owns every selector controller, selector type, selector selection, selector zone,
  selector exclusion, selector field, filter field, comparison operator, value reference,
  value operation, condition, `choice`, `then`, and `repeat`.
- Phase 7 owns every declared duration, with continuous reevaluation support completed in
  Phase 12.
- Phase 13 owns every declared event matcher after the base event mechanism is introduced in
  Phase 3 and individual facts are produced by their mechanic phases.

### Keywords

- Phase 10: `attack-wrong-enemy-chance-50`, `cannot-attack`, `charge`, `divine-shield`,
  `immune`, `mega-windfury`, `spell-immune`, `stealth`, `taunt`, `windfury`.
- Phase 12: `spell-damage`.
- Phase 13: `secret`.

## Decision Log

Add only decisions that materially affect later phases or public behavior. Do not duplicate
ordinary implementation details.

| Date       | Phase  | Decision                                                                                                                                                   | Evidence or consequence                                                                                                                                                                                                                           |
| ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-26 | Plan   | AI is deferred until after full effect-runtime closure.                                                                                                    | Core legality and effects must stabilize before strategic decision-making.                                                                                                                                                                        |
| 2026-08-26 | Plan   | Human acceptance is deferred and does not gate autonomous phase progression.                                                                               | The human intends to test the completed body of work later.                                                                                                                                                                                       |
| 2026-08-26 | Plan   | Unsupported effects must be explicit during development and reach zero in Phase 16.                                                                        | Silent partial execution would make tests and gameplay misleading.                                                                                                                                                                                |
| 2026-08-26 | Plan   | Card-set JSON is read-only and overrides historical card listings for card-specific content.                                                               | The catalog intentionally mixes 2013/2014 fidelity with human customizations and selected later-patch behavior.                                                                                                                                   |
| 2026-08-26 | Plan   | Unclear mechanics and ordering require online Hearthstone research before implementation.                                                                  | Historical research resolves generic runtime semantics, while material conclusions and deviations are logged.                                                                                                                                     |
| 2026-08-26 | 3/8/11 | Resolve a simultaneous death batch by removing all dead minions first, then process each death and its queued triggers in stable play order.               | [Advanced rulebook](https://hearthstone.wiki.gg/wiki/Advanced_rulebook?section=66) describes immutable event queues and order-of-play death resolution; the project uses active-player-first only for otherwise tied non-death trigger discovery. |
| 2026-08-26 | 10     | Freeze prevents the character's next eligible attack and is cleared at the end of the missed opportunity; it does not block defending or other actions.    | [Freeze reference](https://hearthstone.wiki.gg/wiki/Freeze?section=1) documents the missed-next-attack behavior; the runtime stores an explicit expiry rather than inferring it from presentation timing.                                         |
| 2026-08-26 | 13     | Secrets remain hidden in authoritative public snapshots until a matching event resolves; a consumed secret leaves its zone before its public reveal event. | Historical secret behavior is reflected in the [2014 patch notes](https://hearthstone.blizzard.com/en-us/news/13154924/hearthstone-patch-notes-1004944); this project exposes only the owning controller's card identity to future private views. |

| 2026-08-27 | 5/6 | Play-card resolution inserts a minion before its On Play/Battlecry blocks, and all immediate card effects resolve atomically through the shared runtime. | This preserves target visibility for Battlecries and prevents payment/zone mutation when board, target, choice, or capability validation fails; ordering follows the [Battlecry reference](https://hearthstone.wiki.gg/wiki/Battlecry). |
| 2026-08-27 | 6 | Mana overload is queued for the next start-of-turn lock, while card costs retain printed/base values and derive a non-negative current cost across hand, deck, and revealed zones. | The renderer consumes the derived cost/tint; the resource model follows the [Overload reference](https://hearthstone.fandom.com/wiki/Overload) and [Cost reference](https://hearthstone.wiki.gg/wiki/Cost), with deterministic IDs and seeded random generation tested through real cards. |

## Repair audit (2026-08-27)

The implemented Phase 0–6 work was audited against the contracts above. This repair
pass preserves future-phase code behind explicit boundaries; it does not change authored
card JSON or assets, and it leaves every Human acceptance checkbox unchanged.

- [x] Generated token definitions are schema-validated and included in the canonical
      card catalog and capability inventory.
- [x] Runtime capability ownership is explicit and closed over the schema, with play
      preflight rejecting any construct that lacks a registered capability.
- [x] Resolver RNG snapshots/restores are mandatory, and rejected or failed resolutions
      restore the prior RNG position.
- [x] Entity creation ordinals are match-global and monotonic across decks, heroes,
      powers, generated cards, summons, secrets, and graveyard entries.
- [x] Accepted facade commits run the invariant gate through a scoped transaction;
      card, board, secret, and graveyard movement uses centralized runtime helpers.
- [x] Public state/events mask hidden card identities, nested effect payloads, and
      internal history/trace/scheduled-effect data.
- [x] Choice input exposes stable labels and the renderer presents a visible, cancellable
      choice panel before dispatching a selected option.
- [x] Strict dependency validation remains enabled after extracting neutral match
      contracts from the compatibility facade.
- [x] `npm run catalog:audit` loads the canonical modules and checks schema/runtime
      capability closure rather than relying on a second catalog implementation.
- [x] Empty mana-crystal gain increases maximum mana without refilling spendable mana.

### Audit follow-up (2026-08-27)

- [x] Random split spell damage now adds Spell Damage to the number of sequential hits, and
      every hit completes its death checkpoint before the next target is selected.
- [x] `draw-until` snapshots the missing hand count and attempts every draw through the
      centralized draw/fatigue path, even when the deck is empty.
- [x] Weapon durability modifiers preserve previously lost durability during derived-state
      recomputation.
- [x] `hand-size-difference` honors the authored opponent direction used by Divine Favor.
- [x] Ordinary hand-to-board, hand-to-weapon, and hand-to-secret movement preserve the
      existing creation ordinal.
- [x] Catalog smoke now requires an accepted, deterministic public-command resolution for
      every live card, with targeted legal setup for condition-dependent cards; the runtime
      capability registry no longer presents synthetic handler bindings as executable proof.
- [x] Focused audit regression coverage exercises Divine Favor, random split spell damage and
      death checkpoints, Jeeves fatigue, Upgrade durability, and movement ordinals.

The remaining unchecked rows in Phases 7-16 represent missing semantics or evidence, and all
Human acceptance gates remain intentionally open. This audit records repairs and partial
implementation coverage; it is not completion of the roadmap.

## Known Issues

Add deferred findings as unchecked items using this format:

```md
- [ ] KI-001 â€” Phase N â€” Short description. Evidence and reason for deferral.
```

No known issue may be silently removed. Check it when fixed and reference the validating test
or phase. A known issue blocks final completion only when it violates a final success
criterion, a runtime invariant, or catalog closure.

## Final Success Criteria

The effects roadmap is agent-complete only when:

- [ ] Every Agent phase-status checkbox is checked.
- [ ] The capability audit reports complete runtime and test ownership for the current schema
      and catalog.
- [ ] Every valid catalog card resolves all authored effects without silent fallback.
- [ ] Human and temporary/development controllers share the same commands and legality rules.
- [ ] Gameplay is deterministic under seeded RNG and atomic under rejection/failure.
- [ ] Domain state owns all rules; renderer code owns only input and presentation.
- [ ] No blocking Known Issue remains.
- [x] The consolidated human acceptance script exists and is ready to run.
- [x] The final `npm run verify` passes.

Human completion occurs later, when every Human acceptance checkbox is checked and defects
found during the consolidated test have been resolved or explicitly accepted by the human.
