# Competitive Game AI Plan

## Objective and release policy

Competitive AI v2 should combine deterministic engine search with GPT-5.4 nano
ranking while always dispatching an engine-issued legal command. It intentionally
knows both original decklists and the opponent's exact current hand, but it must
not know remaining deck order, future random values, hidden entity-order fields,
or the identity of a facedown secret.

Competitive v2 remains behind the build-time `VITE_COMPETITIVE_AI_V2=true`
switch. The default production policy is still the legacy AI. Do not enable v2 by
default until every acceptance gate in this document passes.

## Current architecture

```text
authoritative deterministic match engine
                |
                +--> legal command enumeration and isolated analysis forks
                |
                +--> local tactical/search evaluation
                            |
                            +--> deterministic fallback
                            |
                            +--> bounded shortlist and dossiers
                                         |
                                         +--> GPT-5.4 nano rank
                                         +--> GPT-5.4 nano critic (v2 only)
                                                     |
                                                     v
                                  revision + membership + live-legality checks
                                                     |
                                                     v
                                         dispatch one atomic command
```

The game domain owns legality, deterministic transitions, evaluation, hashing,
and analysis forks. The renderer currently orchestrates search and decision
timing. A persistent Web Worker performs serializable dossier aggregation. The
Electron main process owns the Azure adapter, while shared code owns validated
IPC contracts.

After each accepted command, the next decision starts from the newly resolved
state while the previous command's presentation animation is playing. Dispatch
waits until presentation is idle, and stale decisions are discarded by revision.

## Match-scoped strategy

### Legacy policy

- Generates a version-1 plan from the AI's own deck.
- Planning starts during scene initialization and overlaps asset loading and the
  opening presentation.
- Mulligan ranking can proceed with the deterministic fallback while remote deck
  planning is still in flight.
- The plan tracks win conditions, phase priorities, card roles, combos, resource
  preservation and release rules, and mulligan priorities.

### Competitive-v2 policy

- Generates one version-2 matchup plan from both original decklists.
- Validates self-strategy card references against the AI deck and threat/removal
  references against the opponent deck.
- Tracks combo viability, reserved resources, opposing threats, and release
  conditions locally as the match revision changes.
- Uses a deterministic structured-effects fallback when the provider is
  unavailable or returns an invalid plan.

## Information policy

Competitive v2 exposes an `opponent-deck-and-hand` observation containing:

- both original unordered decklists;
- the exact current hands of both players;
- public board, hero, weapon, mana, graveyard, and revealed-secret information;
- only deck sizes, never remaining deck order.

The observation removes instance IDs and order-correlated fields from hidden
cards, along with creation ordinals, play-order metadata, and RNG cursor state.
Facedown secret identities remain `null`.

The provider receives only this sanitized observation and engine-issued action
IDs. It never receives the authoritative remaining deck order or secret identity.

## Legacy turn decision

The default legacy controller currently:

1. Enumerates legal actions and constructs bounded complete-turn candidate lines.
2. Searches to atomic depth 12 with beam width 32, a 4,000-node ceiling, and a
   250 ms local budget.
3. Simulates deterministic lines on restoring engine forks.
4. Scores and shortlists at most 12 strategically distinct candidates.
5. Bypasses the provider for an immediate simulated win or a single candidate.
6. Otherwise asks GPT-5.4 nano to choose one supplied candidate ID.
7. Uses the local plan-aware winner immediately if the request fails.
8. Dispatches only the selected line's first command, then plans again.

Legacy action decisions are attempted once; provider timeouts are not retried.

## Competitive-v2 turn decision

The gated controller currently performs the following sequence:

1. Enumerate canonical legal first commands, including every legal target,
   position, choice, attack, hero power, Discover choice, and end-turn command.
2. Run a deterministic guaranteed-lethal proof search.
3. For each retained first command, expand complete AI-turn continuations.
4. Collapse equivalent successor states by strategic hash and retain the best
   continuation for each distinct first command.
5. Expand the opponent's complete-turn responses and select the response with the
   lowest AI evaluation.
6. Build a dossier with the continuation, strongest response, tactical flags,
   component evaluation, resource usage, uncertainty, and matchup progress.
7. Send dossiers to the persistent worker for deterministic risk-weighted sorting
   and retain at most eight first actions.
8. Bypass GPT for proven lethal or a single remaining candidate.
9. Ask GPT-5.4 nano for a strict complete ranking of the supplied IDs.
10. If ranking succeeds, ask GPT-5.4 nano to criticize that ordering and either
    retain or replace the first choice with another supplied ID.
11. Validate the model, response schema, candidate membership, revision, deadline,
    and current legality.
12. Dispatch one atomic command and restart from the resolved state.

Production v2 limits are an eight-second local-search allowance, 50,000 nodes,
atomic depth 16, own-turn beam 64, opponent-turn beam 32, eight intended hidden
state determinizations, four intended relevant-random samples, and 50,000 cached
transposition entries per match.

Root actions must receive fair minimum coverage before any root receives deeper
analysis. Target enumeration order, card order, and 50 ms renderer slices must
not determine which commands reach the shortlist. After the minimum pass,
iterative deepening may spend additional time on the most promising roots.

## Evaluation

The version-2 deterministic evaluator normalizes and weights:

- terminal outcome and lethal pressure;
- effective health and incoming reach;
- board attack, health, keywords, initiative, and open board slots;
- hand quality, card advantage, mana efficiency, and future curve;
- weapons, hero power, removal, draw, fatigue, and burn risk;
- matchup progress, combo progress, threat exposure, and reserved-resource cost.

Weights are versioned runtime configuration. Final tuning must be performed
offline through seeded self-play; runtime evaluation must remain deterministic
and must not call another model.

Evaluation must distinguish strategically justified costs from destructive
waste. Damage to the AI hero or friendly characters, discarded resources, and
other negative self-effects require an identified compensating outcome such as
proven lethal, survival, board swing, or validated combo progress. Merely
spending mana, casting a card, or triggering a generic spell synergy is not
enough to make self-harm profitable.

## Provider and reliability policy

Only the configured GPT-5.4-nano Azure deployment is accepted. Configuration and
provider metadata identifying another model are rejected.

| Request          |    Timeout | Reasoning | Retry |
| ---------------- | ---------: | --------- | ----- |
| Legacy deck plan | 30 seconds | Low       | None  |
| Legacy mulligan  | 25 seconds | Low       | None  |
| Legacy Discover  | 15 seconds | Low       | None  |
| Legacy turn      | 20 seconds | Low       | None  |
| V2 matchup plan  | 30 seconds | Medium    | None  |
| V2 rank pass     | 10 seconds | Medium    | None  |
| V2 critic pass   | 10 seconds | Medium    | None  |

The v2 action budget remains 30 seconds: up to 8 seconds for local search, up to
10 seconds for ranking, up to 10 seconds for criticism, and at least 2 seconds
for validation and dispatch.

Provider failures cross Electron IPC as serializable failure results rather than
rejected main-process handlers. The renderer logs the failure and uses the
appropriate deterministic fallback without producing Electron handler stack
traces.

Matchup-planning failure is isolated from action-ranking failure. A planning
HTTP error or timeout may select the deterministic matchup plan, but it must not
disable rank or critic calls for the rest of the match. Likewise, critic failure
retains the validated rank winner rather than invalidating the entire decision.

## Live validation findings

The first manual competitive-v2 validation after removing Azure-incompatible
`uniqueItems` schema keywords confirmed that the schema rejection was gone and
that failure isolation worked. Matchup planning timed out after approximately
29.9 seconds, the mulligan rank pass succeeded in approximately 7.3 seconds,
and the critic timed out after approximately 10 seconds. The game continued with
the deterministic matchup plan and validated rank winner, but only one of three
intended provider stages completed. Provider latency and startup delay therefore
remain unresolved production blockers.

A subsequent manual turn exposed a decision-quality failure: the AI legally cast
Darkbomb on its own hero without an evident compensating benefit. The engine is
correct to preserve legal friendly and self targets, but competitive search did
not prove the action useful or dominated before allowing it into the final
decision path. Short renderer-thread search slices currently process roots
sequentially, so early target variants can consume a slice before equivalent
enemy-target or end-turn roots receive comparable analysis. This makes command
and target enumeration order an unintended strategic bias.

The console image alone does not establish whether the local winner, rank pass,
or critic ultimately chose Darkbomb. That distinction does not change the
required invariant: provider-assisted and deterministic fallback paths must both
reject a proven dominated self-hit.

## Known implementation gaps

Competitive v2 is a foundation, not yet the accepted production system.

1. **Hidden-state correctness:** the configured determinization and random-sample
   counts are currently dossier metadata. The search does not yet hydrate eight
   independent hidden orders or four independent relevant RNG outcomes. Mean,
   downside, and worst-case values therefore normally share one deterministic
   score.
2. **Authoritative-state leakage risk:** engine search currently forks the live
   authoritative match. Although provider observations are sanitized and uncertain
   actions are marked incomplete, local simulations are not yet guaranteed to be
   invariant to actual deck order, secret identity, or future RNG.
3. **Worker ownership:** engine branching still runs in short renderer-thread
   slices. The worker currently performs only serializable dossier sorting. Full
   search must move behind a hydratable analysis-state boundary.
4. **Tactical integration:** guaranteed lethal is integrated as a global proof
   pass. Board-clear, efficient-trade, combo-order, and profitable-action helpers
   exist, but they are not all integrated as complete global proofs. Avoidable
   forced defeat remains incomplete.
5. **Scenario aggregation:** the downside and worst-case formula exists, but it
   does not yet aggregate real determinization and RNG samples.
6. **Benchmark completion:** the opt-in six-archetype, 600-game, seat-swapped
   benchmark harness exists, but a complete valid run and the required 65% score
   have not been obtained.
7. **Performance acceptance:** renderer responsiveness and the absolute 30-second
   deadline still require production-profile measurement after worker migration.
8. **Unfair root coverage:** search runs groups of roots in short synchronous
   slices but expands each group sequentially. Expensive early roots can starve
   later cards, targets, attacks, and end-turn alternatives, so shortlist quality
   can depend on enumeration order rather than position value.
9. **Self-destructive action protection:** friendly-target and self-target actions
   are legal and correctly enumerated, but there is no complete dominance proof
   or sufficiently strong outcome penalty preventing unjustified direct
   self-damage. The observed Darkbomb-to-own-hero play confirms this gap in a
   live match.
10. **Provider latency:** live Azure validation has produced 30-second matchup
    planning timeouts and 10-second critic timeouts. Fallback behavior is safe,
    but the intended two-pass system and acceptable match-start latency are not
    yet reliable at the configured limits.

## Next implementation phases

### Phase 1: independent analysis state

- Define a serializable analysis snapshot containing only allowed observation
  information plus deterministic public engine state.
- Hydrate independent analysis matches without copying authoritative deck order,
  facedown secret identity, RNG cursor, event buffers, revisions, or entity counters.
- Generate seeded hidden deck orders, secret candidates, and relevant random
  outcomes from the observation and deterministic sample seed.
- Prove observation and search invariance with paired hidden-state fixtures.

### Phase 2: worker-owned search

- Move legal-command expansion, tactical solving, evaluation, state hashing, and
  complete-turn/opponent-response search into the persistent worker.
- Replace sequential root consumption with round-robin or equivalent fair
  iterative deepening. Give every retained first command and target variant a
  bounded initial evaluation before deepening any one root.
- Make partial results record which roots were reached, and never present an
  unevaluated action as equivalent to a fully searched action.
- Return partial deterministic results on timeout or worker failure.
- Reuse reachable transposition entries after each atomic action without allowing
  stale revision data to cross matches.
- Measure animation frame responsiveness under production search limits.

### Phase 3: tactical and scenario completeness

- Integrate guaranteed lethal, forced survival, board clear, efficient trade,
  required combo order, and unconditional-profit proofs into the root search.
- Require every relevant deterministic or sampled branch before marking a result
  proven; incomplete trees remain annotations.
- Aggregate real samples into mean, downside, worst-case, and survival values.
- Hard-prune only proven illegal, dominated, or self-destructive commands.
- Add an outcome-based self-harm classifier covering damage to the AI hero,
  damage or destruction of friendly minions, discard, and reserved-resource
  consumption. Preserve unusual synergy actions with a penalty until their
  compensating value is verified; hard-prune them only when dominance or
  self-destruction is proven.
- Compare targeted variants of the same card directly. An own-hero damage target
  must not survive when an otherwise equivalent enemy target or no-action line
  produces a strictly better state, unless a concrete synergy changes the
  resolved outcome.

### Phase 4: fixtures and reliability

- Complete tactical fixtures for lethal, survival, clears, trades, combo release,
  fatigue, secrets, random effects, and tempting blunders.
- Add targeted-spell regression fixtures for Darkbomb on the AI hero, friendly
  minions, enemy minions, and the enemy hero. Cover both local fallback and
  provider-selected IDs, plus positions where self-damage is genuinely required
  for lethal or survival so legitimate synergy is not over-pruned.
- Add root-order permutation fixtures proving that reordering cards, targets, or
  otherwise equivalent legal-command enumeration does not change the selected
  strategic action.
- Verify worker isolation, deterministic seeded results, hash equivalence, cache
  reuse, timeout partial results, and full restoration of authoritative engine state.
- Cover rank/critic failures, stale responses, malformed IDs, model allowlisting,
  worker crashes, budget sharing, and deterministic fallback.
- Measure live Azure latency separately for matchup planning, mulligan ranking,
  turn ranking, and criticism. Reduce prompt/schema payloads or revise which
  decision classes require criticism if the configured deadlines cannot be met
  reliably; do not hide persistent timeouts behind fallback-only testing.

### Phase 5: benchmark and tuning

- Make the benchmark fast enough to finish reliably under a fixed node budget.
- Run all 600 seeded, seat-swapped games across six validated archetypes.
- Tune evaluator weights offline without changing runtime determinism.
- Record seeds, deck versions, configuration versions, score, confidence interval,
  node counts, cache hits, and elapsed time for reproducibility.

### Phase 6: activation

Enable competitive v2 by default only when:

- every forced tactical fixture passes;
- the 600-game score against frozen legacy is at least 65%, with draws worth half;
- observation and search results are invariant to unavailable hidden information;
- every retained root receives fair minimum analysis independent of enumeration
  order, and partial-search metadata identifies any uncovered roots;
- proven dominated self-damage is never dispatched by either local fallback or
  provider selection, while validated self-damage synergies remain available;
- renderer animation remains responsive under production limits;
- no action exceeds the absolute 30-second deadline;
- live provider validation demonstrates that the configured planning, rank, and
  critic policies complete reliably within their allocated budgets, or the
  policy is deliberately revised and re-accepted;
- type, lint, dependency-boundary, build, and existing engine tests pass.

Until then, keep the legacy policy as the default and treat competitive v2 as an
explicit development/benchmark mode.
