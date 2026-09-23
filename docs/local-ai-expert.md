# Local Expert AI: direction and evidence

## Decision

Use bounded Monte Carlo Tree Search (MCTS) for Expert over the existing
TypeScript match engine. Do not add Silverfish or SabberStone as runtime
dependencies, or build a second rules engine. The custom engine already
provides legal actions, effect resolution, seeded randomness, fair
observations, and isolated simulation branches. MCTS can use those directly.
No third-party AI source was copied.

Retire the old deterministic sequence-and-reply scorer from the Expert path.
It grew into a large set of hand-tuned exceptions and did not establish strong
Midrange play. Keep Easy V1 available as the comparison baseline, including
shared helpers until it can be separated without changing Easy's behavior.

## Architecture

The authoritative rules remain in `src/game/match/opening-match.ts`,
`src/game/match/effects/effect-runtime.ts`, and
`src/game/match/ai/legal-commands.ts`. Seeded randomness and fair observations
come from `src/game/match/rng.ts`, `src/game/match/ai/observation.ts`, and
`src/game/match/ai/fair-hypothesis-checkpoint.ts`. The MCTS implementation is
in `src/game/match/ai/information-set-mcts.ts`; Expert decision and rollout
policy live in `src/renderer/features/game/local-ai-decision-api.ts`.

`src/renderer/features/game/expert-ai.worker.ts` runs the planner off the UI
thread. `expert-ai-decision-api.ts`, `expert-ai-consensus.ts`, and
`expert-ai-worker-protocol.ts` build and combine fair hidden-information
hypotheses. `ai-turn-controller.ts` validates each selected root action
against current legal actions and replans after execution. Visible turn
presentation is handled in `game-board-view.ts` and `src/renderer/scenes/game-scene.ts`.

The Expert tree uses the acting player's fair observation as its information
key, progressively widens legal actions, selects with a PUCT-style score,
and backs up values from the root player's perspective. It searches the
current root turn and a bounded public opponent response, with at most 4,000
iterations and 48 selected actions per simulation. Each sampled hidden-world
hypothesis currently has its own tree; this is determinized MCTS, not shared-
tree ISMCTS or a learned deck-belief model. Artifact decisions use a fixed 64
iterations for reproducibility.

The controller owns a cumulative 10-second turn budget, reserving 2 seconds
for presentation and 500 ms for dispatch. A single search is capped at 6
seconds and total search allowance at 7.5 seconds. These worker limits do not
include visible Pixi animations in the headless benchmark.

## Validation and comparison

The 200 cases in `Artifacts/hearthstone_ai_tests_*.md` are mirrored as
executable TypeScript scenarios in
`src/renderer/features/game/local-ai-artifact-scenarios.test.ts`; they are not
parsed from Markdown at runtime. A parity check confirms every source `DEV-*`
ID has exactly one scenario. The latest `npm.cmd run test:local-ai` run passed
**312 of 326 checks**, including **186 of 200 artifact scenarios**. The 14
remaining artifact failures are:

`DEV-044, 052, 054, 066, 095, 105, 113, 146, 147, 152, 168, 170, 180, 184`.

They cover aura and Enrage trades, attack reduction, Equality/Pyromancer and
Circle-of-Healing sequencing, secret ordering, Shadowstep/healing reuse,
resource preservation around Doomsayer, and lifesteal or survival trades.
The fixture also keeps live-value mismatches and unsupported effects explicit
as rules/support gates instead of forcing historical card data.

The previous documented run was 149/200 artifact scenarios; the current
implementation is better on that tactical checklist. That is not evidence of
a higher match win rate. Easy V1 has not yet been compared against Expert in a
large, completed, seeded Midrange matchup set, so relative player strength is
still unproven.

The version-3 benchmark reports MCTS iterations, opponent actions and card
plays simulated, cache activity, tree/rollout depth, search profile timings,
invalid actions, timeouts, and headless turn latencies. A smoke run with two
mirrored games, an eight-unit work budget, and a 60-action cap produced two
capped games, zero invalid selections, zero rejected commands, and zero
timeouts. It recorded 472 total MCTS iterations, 1,956 simulated opponent
actions, and 850 simulated opponent card plays. The expert's measured headless
decision latency was p50 301 ms / p95 676 ms / max 1,152 ms; full-turn latency
was p50 964 ms / p95 2,871 ms / max 2,871 ms. Both games were capped before a
winner, and the intentionally tiny workload is only a wiring/performance
smoke test, not strength evidence.

Run the checks with:

```powershell
npm.cmd run test:local-ai
npm.cmd run benchmark:local-ai -- --games 2 --baseline easy --max-actions 60 --work-budget 8
```

`npm.cmd run typecheck:web` currently reports 49 TypeScript diagnostics across
the worktree. The updated decision API and benchmark file report no remaining
type errors, but AI controller/fixture and renderer diagnostics still keep a
clean web typecheck from being established.

## What to keep and build next

Keep the authoritative engine, complete legal-action generation, fair
observation boundary, worker cancellation/fallback, and Easy V1 baseline.
Do not restore the broad deterministic Expert scorer or add individual
card-name exceptions to force artifacts green.

The next work should use the 14 failing cases as grouped evidence:

1. Improve generic combat ordering and survival evaluation for Enrage, aura,
   attack-reduction, lifesteal, and Divine Shield trades.
2. Improve multi-action planning for Equality/Auchenai, secret probes, and
   returned-card healing effects. Add effect-driven priors only when they
   improve a group without regressing the full 200-case suite.
3. Run a larger paired-seed complete-match benchmark against Easy V1 and a
   simple random-legal baseline, rotating both seats and retaining completed,
   capped, invalid-action, and timeout counts. Use enough games to report
   uncertainty, not just a point win rate.
4. Measure complete visible turns on the target machine before claiming the
   ten-second requirement. The current benchmark excludes animation time.
5. Consider shared-tree ISMCTS only if profiles show hypothesis sampling
   variance is the main limit. This small smoke profile's largest search costs
   were action-prior scoring, legal-action generation, and simulation dispatch.

Do not call the Expert player finished until the authored tactical suite has
no unexplained regressions and a sufficiently large completed-match benchmark
shows an improvement over Easy V1 within the turn-time budget.
